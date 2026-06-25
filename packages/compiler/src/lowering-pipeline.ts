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

type LoweringPipelineProduct =
  | 'style-span-probe'
  | 'structural-lowering'
  | 'structural-reparse'
  | 'style-extraction'
  | 'style-reparse';

interface LoweringPass {
  readonly name: string;
  readonly kind: 'probe' | 'lower' | 'reparse';
  readonly provides?: readonly LoweringPipelineProduct[];
  readonly requires?: readonly LoweringPipelineProduct[];
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
    provides: ['style-span-probe'],
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
    provides: ['structural-lowering'],
    requires: ['style-span-probe'],
    run(ctx) {
      const styleSpanProbe = requireStyleSpanProbe(ctx, 'structural-jsx');
      ctx.structuralLowering = lowerStructuralJsx(ctx.state.model, ctx.componentName, {
        ...ctx.options,
        skipInlineAttributeDeriveSpans: styleSpanProbe.handledSpans,
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
  {
    name: 'reparse-structural',
    kind: 'reparse',
    provides: ['structural-reparse'],
    requires: ['structural-lowering'],
    run: reparse,
  },
  {
    name: 'style-extraction',
    kind: 'lower',
    provides: ['style-extraction'],
    requires: ['structural-reparse'],
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
  {
    name: 'reparse-style',
    kind: 'reparse',
    provides: ['style-reparse'],
    requires: ['style-extraction'],
    run: reparse,
  },
];

export function validateLoweringPipelinePassContracts(
  passes: readonly LoweringPass[] = LOWERING_PASSES,
): void {
  const produced = new Set<LoweringPipelineProduct>();
  for (const pass of passes) {
    assertPassRequirements(pass, produced);
    for (const product of pass.provides ?? []) produced.add(product);
  }
}

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

  const produced = new Set<LoweringPipelineProduct>();
  for (const pass of LOWERING_PASSES) {
    assertPassRequirements(pass, produced);
    pass.run(ctx);
    assertPassProducts(pass, ctx);
    for (const product of pass.provides ?? []) produced.add(product);
  }

  return {
    source: ctx.state.source,
    model: ctx.state.model,
    validationOffsetMap: composeSourceOffsetMaps(
      requireOffsetMap(ctx, 0, 'final validation offset map'),
      requireOffsetMap(ctx, 1, 'final validation offset map'),
    ),
    terminalState: ctx.state,
    styleSpanProbe: requireStyleSpanProbe(ctx, 'final result'),
    structuralLowering: requireStructuralLowering(ctx, 'final result'),
    styleExtraction: requireStyleExtraction(ctx, 'final result'),
  };
}

function assertPassRequirements(
  pass: Pick<LoweringPass, 'name' | 'requires'>,
  produced: ReadonlySet<LoweringPipelineProduct>,
): void {
  for (const product of pass.requires ?? []) {
    if (produced.has(product)) continue;
    throw new Error(
      `Lowering pipeline pass "${pass.name}" requires "${product}" before it runs (SPEC.md §5.2).`,
    );
  }
}

function assertPassProducts(pass: LoweringPass, ctx: LoweringPipelineContext): void {
  for (const product of pass.provides ?? []) {
    if (hasPipelineProduct(ctx, product)) continue;
    throw new Error(
      `Lowering pipeline pass "${pass.name}" declared "${product}" but did not produce it (SPEC.md §5.2).`,
    );
  }
}

function hasPipelineProduct(
  ctx: LoweringPipelineContext,
  product: LoweringPipelineProduct,
): boolean {
  switch (product) {
    case 'style-span-probe':
      return ctx.styleSpanProbe !== undefined;
    case 'structural-lowering':
      return ctx.structuralLowering !== undefined;
    case 'structural-reparse':
      return ctx.offsetMaps.length >= 1;
    case 'style-extraction':
      return ctx.styleExtraction !== undefined;
    case 'style-reparse':
      return ctx.offsetMaps.length >= 2;
  }
}

function requireStyleSpanProbe(
  ctx: LoweringPipelineContext,
  consumer: string,
): StyleExtraction {
  if (ctx.styleSpanProbe !== undefined) return ctx.styleSpanProbe;
  throw missingProductError(consumer, 'style-span-probe');
}

function requireStructuralLowering(
  ctx: LoweringPipelineContext,
  consumer: string,
): StructuralLowering {
  if (ctx.structuralLowering !== undefined) return ctx.structuralLowering;
  throw missingProductError(consumer, 'structural-lowering');
}

function requireStyleExtraction(
  ctx: LoweringPipelineContext,
  consumer: string,
): StyleExtraction {
  if (ctx.styleExtraction !== undefined) return ctx.styleExtraction;
  throw missingProductError(consumer, 'style-extraction');
}

function requireOffsetMap(
  ctx: LoweringPipelineContext,
  index: number,
  consumer: string,
): SourceOffsetMap {
  const offsetMap = ctx.offsetMaps[index];
  if (offsetMap !== undefined) return offsetMap;
  throw missingProductError(
    consumer,
    index === 0 ? 'structural-reparse' : 'style-reparse',
  );
}

function missingProductError(
  consumer: string,
  product: LoweringPipelineProduct,
): Error {
  return new Error(
    `Lowering pipeline consumer "${consumer}" requires missing product "${product}" (SPEC.md §5.2).`,
  );
}
