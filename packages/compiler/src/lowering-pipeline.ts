import { navigationStandaloneHrefLowering } from './lower/navigation.js';
import { lowerStructuralJsx } from './lower/structural-jsx.js';
import { applyModelPatchPass, type ComponentPipelineState } from './model-pipeline.js';
import { parseComponentModule, type ComponentModuleModel } from './scan/parse.js';
import { composeSourceOffsetMaps, type SourceOffsetMap, type SourceReplacement } from './shared.js';
import { extractKovoStyles } from './style.js';
import type { CompileComponentOptions } from './types.js';

/**
 * @internal FN5 (plans/compiler-refactoring.md): the lowering stage of the compile
 * pipeline expressed as a declarative, ordered pass list instead of an inline imperative
 * sequence in `compile.ts`. Each pass reads/contributes to a shared {@link LoweringPipelineContext};
 * `reparse` passes apply the accumulated `SourceReplacement`s and re-parse (the source-patch +
 * reparse seam, SPEC.md §5.2). The list encodes TODAY's exact order and the two reparse
 * boundaries — it is behavior-neutral plumbing, proven by the golden corpus + render-equivalence
 * + fact-hash gates (NOT fixpoint, which short-circuits on the IR header).
 */

type StyleExtraction = ReturnType<typeof extractKovoStyles>;
type StructuralLowering = ReturnType<typeof lowerStructuralJsx>;

interface LoweringPipelineContext {
  readonly fileName: string;
  readonly componentName: string;
  readonly options: CompileComponentOptions;
  state: ComponentPipelineState<ComponentModuleModel>;
  pending: SourceReplacement[];
  readonly offsetMaps: SourceOffsetMap[];
  styleSpanProbe?: StyleExtraction;
  structuralLowering?: StructuralLowering;
  styleExtraction?: StyleExtraction;
}

interface LoweringPass {
  readonly name: string;
  readonly kind: 'probe' | 'lower' | 'reparse';
  run(ctx: LoweringPipelineContext): void;
}

function reparse(ctx: LoweringPipelineContext): void {
  const patch = applyModelPatchPass(ctx.state, ctx.pending, parseComponentModule);
  ctx.state = patch.state;
  ctx.offsetMaps.push(patch.sourceOffsetMap);
  ctx.pending = [];
}

/**
 * @internal The ordered lowering passes. Enumerable and individually inspectable so later
 * capability passes (derived optimism, `<kovo-live>`, defer) can be slotted at a declared
 * position rather than hand-wired into the orchestrator.
 */
export const LOWERING_PASSES: readonly LoweringPass[] = [
  // Probe StyleX spans up front so structural lowering can skip inline attribute derives the
  // style pass will own (the probe reads the still-original model).
  {
    name: 'style-span-probe',
    kind: 'probe',
    run(ctx) {
      ctx.styleSpanProbe = extractKovoStyles(
        ctx.fileName,
        ctx.state.source,
        ctx.state.model,
        ctx.componentName,
        ctx.options,
      );
    },
  },
  {
    name: 'structural-jsx',
    kind: 'lower',
    run(ctx) {
      ctx.structuralLowering = lowerStructuralJsx(ctx.state.model, ctx.componentName, {
        ...ctx.options,
        skipInlineAttributeDeriveSpans: ctx.styleSpanProbe!.handledSpans,
      });
      ctx.pending.push(...ctx.structuralLowering.replacements);
    },
  },
  {
    name: 'navigation-standalone-href',
    kind: 'lower',
    run(ctx) {
      ctx.pending.push(...navigationStandaloneHrefLowering(ctx.state.model));
    },
  },
  // Reparse boundary 1: structural + standalone-href patches applied to the original source.
  { name: 'reparse-structural', kind: 'reparse', run: reparse },
  {
    name: 'style-extraction',
    kind: 'lower',
    run(ctx) {
      ctx.styleExtraction = extractKovoStyles(
        ctx.fileName,
        ctx.state.source,
        ctx.state.model,
        ctx.componentName,
        ctx.options,
      );
      ctx.pending.push(...ctx.styleExtraction.replacements);
    },
  },
  // Reparse boundary 2: StyleX-extraction patches applied to the structurally-lowered source.
  { name: 'reparse-style', kind: 'reparse', run: reparse },
];

/** @internal The lowered result threaded into the rest of `compileComponentModule`. */
export interface LoweringPipelineResult {
  source: string;
  model: ComponentModuleModel;
  validationOffsetMap: SourceOffsetMap;
  terminalState: ComponentPipelineState<ComponentModuleModel>;
  styleSpanProbe: StyleExtraction;
  structuralLowering: StructuralLowering;
  styleExtraction: StyleExtraction;
}

/**
 * @internal Run {@link LOWERING_PASSES} over a freshly-parsed component, returning the final
 * lowered source/model, the composed validation offset map (original → lowered), the terminal
 * pipeline state for terminal emit patches, and the per-stage contributions the orchestrator
 * still consumes (style probe, structural lowering, style extraction).
 */
export function runLoweringPipeline(
  originalState: ComponentPipelineState<ComponentModuleModel>,
  componentName: string,
  options: CompileComponentOptions,
): LoweringPipelineResult {
  const ctx: LoweringPipelineContext = {
    fileName: originalState.fileName,
    componentName,
    options,
    state: originalState,
    pending: [],
    offsetMaps: [],
  };

  for (const pass of LOWERING_PASSES) pass.run(ctx);

  return {
    source: ctx.state.source,
    model: ctx.state.model,
    validationOffsetMap: composeSourceOffsetMaps(ctx.offsetMaps[0]!, ctx.offsetMaps[1]!),
    terminalState: ctx.state,
    styleSpanProbe: ctx.styleSpanProbe!,
    structuralLowering: ctx.structuralLowering!,
    styleExtraction: ctx.styleExtraction!,
  };
}
