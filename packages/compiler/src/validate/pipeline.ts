import {
  createDiagnosticFactory,
  type CompilerDiagnostic,
  type DiagnosticFactory,
} from '../diagnostics.js';
import type { ComponentModuleModel, SourceSpan } from '../scan/parse.js';
import type { SourceOffsetMap } from '../shared.js';
import type { CompileComponentOptions, QueryUpdateCoverageFact } from '../types.js';
import { validateDataBindings, validateStampExpressionDrift } from './bindings.js';
import {
  unhandledUpdateCoverageDiagnostics,
  validateDirectDbAccess,
  validateEventPayloads,
  validateFragmentTargetChildren,
  validateFragmentTargetInputs,
  validateHandAuthoredFragmentTargetStamp,
  validateIsomorphicSlotComposition,
  validateNestedStatefulIslandInRefreshTarget,
  validateRemovedFragmentTargetOption,
  validateReservedQueryNames,
  validateServerFactsInLocalState,
} from './component-contracts.js';
import {
  validateDuplicateComponentNames as validateComponentNameUniqueness,
  validateDuplicateFragmentTargetNames as validateFragmentTargetNameUniqueness,
  validateDuplicateStaticViewTransitionNames as validateStaticViewTransitionNameUniqueness,
} from './component-names.js';
import { validateEventTriggerNames } from './event-triggers.js';
import { validateDeferJsxChildren } from './defer-jsx.js';
import {
  validateAttributeMergeConflicts,
  validateHandAuthoredNavigationSegmentStamps,
  validateHtmlContentModel,
  validateIdrefs,
  validateResidualStamps,
  validateStaticIds,
} from './markup.js';
import { validateLiteralHrefs } from './navigation.js';
import { validateOutputContexts } from '../security/output-context.js';
import { queryShapeFactDiagnostics } from '../types.js';
import { validateClientHandlerSecretCapture } from './client-capture.js';
import { validateTrustedHtmlProvenance } from './trusted-html-provenance.js';
import { validateNonLiteralPattern } from './redos-pattern.js';
import { validateSecretQueryWire } from './confidentiality.js';
import {
  validateDeclaredClockReadsInRender,
  validateUntrackedClockReadsInDerives,
} from './temporal.js';

interface ValidatorContext {
  componentName: string;
  diagnosticSource: string;
  model: ComponentModuleModel;
  options: CompileComponentOptions;
  originalModel: ComponentModuleModel;
  styleOwnedSpans: readonly SourceSpan[];
  source: string;
  sourceOffsetMap: SourceOffsetMap;
  updateCoverage: readonly QueryUpdateCoverageFact[];
}

// FN9 (SPEC.md §5.2): each validator receives a DiagnosticFactory already bound to the correct
// `(source, offsetMap)` pair plus the typed model it validates — none of these validators use raw
// source for an accept/reject decision, only for offset→line/col positioning, so the source string
// no longer needs to cross the boundary. The three factories below pin the three position frames
// the validators previously hand-paired by argument order:
//   * lowered  — spans measured against the post-lowering `model`/`source`.
//   * original — spans measured against the pre-lowering `originalModel`/`options.source`.
//   * mapped   — generated offsets (from `model` or coverage facts) mapped back through
//     `sourceOffsetMap` onto the original source before positioning.
interface ResolvedValidatorContext extends ValidatorContext {
  loweredDiagnostics: DiagnosticFactory;
  originalDiagnostics: DiagnosticFactory;
  mappedDiagnostics: DiagnosticFactory;
}

type CompilerValidator = (context: ResolvedValidatorContext) => readonly CompilerDiagnostic[];

interface FramedValidatorContext extends ValidatorContext {
  diagnostics: DiagnosticFactory;
}

interface ModelValidatorContext extends FramedValidatorContext {
  model: ComponentModuleModel;
}

type ModelValidator = (context: ModelValidatorContext) => readonly CompilerDiagnostic[];
type GraphValidator = (context: ValidatorContext) => readonly CompilerDiagnostic[];

function loweredValidator(run: ModelValidator): CompilerValidator {
  return (context) =>
    run({ ...context, diagnostics: context.loweredDiagnostics, model: context.model });
}

function originalValidator(run: ModelValidator): CompilerValidator {
  return (context) =>
    run({ ...context, diagnostics: context.originalDiagnostics, model: context.originalModel });
}

function mappedValidator(run: ModelValidator): CompilerValidator {
  return (context) =>
    run({ ...context, diagnostics: context.mappedDiagnostics, model: context.model });
}

function graphValidator(run: GraphValidator): CompilerValidator {
  return (context) => run(context);
}

const compilerValidators: readonly CompilerValidator[] = [
  mappedValidator(({ diagnostics, model }) => validateServerFactsInLocalState(diagnostics, model)),
  loweredValidator(({ diagnostics, model }) => validateReservedQueryNames(diagnostics, model)),
  loweredValidator(({ diagnostics, model }) =>
    validateRemovedFragmentTargetOption(diagnostics, model),
  ),
  loweredValidator(({ diagnostics, model }) =>
    validateHandAuthoredFragmentTargetStamp(diagnostics, model),
  ),
  loweredValidator(({ diagnostics, model, options }) =>
    validateComponentNameUniqueness(diagnostics, model, options),
  ),
  loweredValidator(({ diagnostics, model, options }) =>
    validateFragmentTargetNameUniqueness(diagnostics, model, options),
  ),
  originalValidator(({ diagnostics, model, options }) =>
    validateStaticViewTransitionNameUniqueness(diagnostics, model, options),
  ),
  graphValidator(({ options }) =>
    queryShapeFactDiagnostics(options.fileName, options.queryShapeFacts ?? []),
  ),
  loweredValidator(({ diagnostics, model }) => validateFragmentTargetInputs(diagnostics, model)),
  loweredValidator(({ diagnostics, model }) =>
    validateIsomorphicSlotComposition(diagnostics, model),
  ),
  loweredValidator(({ diagnostics, model }) => validateFragmentTargetChildren(diagnostics, model)),
  loweredValidator(({ diagnostics, model, options }) =>
    validateNestedStatefulIslandInRefreshTarget(diagnostics, model, options),
  ),
  originalValidator(({ diagnostics, model, options }) =>
    validateSecretQueryWire(diagnostics, model, options),
  ),
  // SPEC §6.6/§6.2 + secure-framework Phase 4 / Tier 0: KV437 fires on the authored source so the
  // diagnostic site is the real capture, not a lowered rewrite (peer of the KV435 query-wire gate).
  originalValidator(({ diagnostics, model }) =>
    validateClientHandlerSecretCapture(diagnostics, model),
  ),
  // SPEC §6.6/§9.5 + secure-framework Phase 6 (Tier 3): KV434 fires on the authored source so the
  // diagnostic site is the real `s.string().pattern(<non-literal>)` call — the compile-time half of
  // the ReDoS gate whose runtime half (linear matchers + literal reject + step-budget) already ships.
  originalValidator(({ diagnostics, model }) => validateNonLiteralPattern(diagnostics, model)),
  loweredValidator(({ diagnostics, model, options }) =>
    validateDataBindings(diagnostics, model, options),
  ),
  originalValidator(({ diagnostics, model, options }) =>
    validateStampExpressionDrift(diagnostics, model, options),
  ),
  loweredValidator(({ diagnostics, model, options }) =>
    validateEventPayloads(diagnostics, model, options),
  ),
  loweredValidator(({ diagnostics, model }) => validateDirectDbAccess(diagnostics, model)),
  originalValidator(({ diagnostics, model, options }) =>
    validateDeclaredClockReadsInRender(diagnostics, model, options),
  ),
  loweredValidator(({ diagnostics, model }) =>
    validateUntrackedClockReadsInDerives(diagnostics, model),
  ),
  originalValidator(({ diagnostics, model, options }) =>
    validateIdrefs(diagnostics, model, options.packageComponentPrefixes),
  ),
  loweredValidator(({ diagnostics, model }) => validateStaticIds(diagnostics, model)),
  loweredValidator(({ diagnostics, model, options }) =>
    validateLiteralHrefs(diagnostics, model, options),
  ),
  originalValidator(({ diagnostics, model, styleOwnedSpans }) =>
    validateOutputContexts(diagnostics, model, styleOwnedSpans),
  ),
  // SPEC §9.1/§5.2 #10/§4.8 (KV236/KV426 family): trustedHtml() branding provably request/query-
  // derived data is a by-construction XSS sink. Runs on the authored source so the diagnostic site
  // is the real trustedHtml(...) call (peer of the KV437 client-capture and KV435 query-wire gates).
  originalValidator(({ diagnostics, model }) => validateTrustedHtmlProvenance(diagnostics, model)),
  loweredValidator(({ diagnostics, model }) => validateHtmlContentModel(diagnostics, model)),
  loweredValidator(({ diagnostics, model }) => validateEventTriggerNames(diagnostics, model)),
  originalValidator(({ diagnostics, model }) => validateDeferJsxChildren(diagnostics, model)),
  loweredValidator(({ diagnostics, model }) =>
    validateHandAuthoredNavigationSegmentStamps(diagnostics, model),
  ),
  loweredValidator(({ diagnostics, model, options }) =>
    validateResidualStamps(diagnostics, model, options),
  ),
  loweredValidator(({ diagnostics, model }) => validateAttributeMergeConflicts(diagnostics, model)),
  mappedValidator(({ diagnostics, updateCoverage }) =>
    unhandledUpdateCoverageDiagnostics(diagnostics, updateCoverage),
  ),
];

export function collectCompilerDiagnostics(context: ValidatorContext): CompilerDiagnostic[] {
  const resolved: ResolvedValidatorContext = {
    ...context,
    loweredDiagnostics: createDiagnosticFactory(context.options.fileName, context.source),
    originalDiagnostics: createDiagnosticFactory(
      context.options.fileName,
      context.diagnosticSource,
    ),
    mappedDiagnostics: createDiagnosticFactory(
      context.options.fileName,
      context.diagnosticSource,
      context.sourceOffsetMap,
    ),
  };
  return compilerValidators.flatMap((validator) => validator(resolved));
}
