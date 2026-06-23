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

const compilerValidators: readonly CompilerValidator[] = [
  ({ mappedDiagnostics, model }) => validateServerFactsInLocalState(mappedDiagnostics, model),
  ({ loweredDiagnostics, model }) => validateReservedQueryNames(loweredDiagnostics, model),
  ({ loweredDiagnostics, model }) => validateRemovedFragmentTargetOption(loweredDiagnostics, model),
  ({ loweredDiagnostics, model }) =>
    validateHandAuthoredFragmentTargetStamp(loweredDiagnostics, model),
  ({ loweredDiagnostics, model, options }) =>
    validateComponentNameUniqueness(loweredDiagnostics, model, options),
  ({ loweredDiagnostics, model, options }) =>
    validateFragmentTargetNameUniqueness(loweredDiagnostics, model, options),
  ({ originalDiagnostics, originalModel, options }) =>
    validateStaticViewTransitionNameUniqueness(originalDiagnostics, originalModel, options),
  ({ options }) => queryShapeFactDiagnostics(options.fileName, options.queryShapeFacts ?? []),
  ({ loweredDiagnostics, model }) => validateFragmentTargetInputs(loweredDiagnostics, model),
  ({ loweredDiagnostics, model }) => validateIsomorphicSlotComposition(loweredDiagnostics, model),
  ({ loweredDiagnostics, model }) => validateFragmentTargetChildren(loweredDiagnostics, model),
  ({ loweredDiagnostics, model, options }) =>
    validateNestedStatefulIslandInRefreshTarget(loweredDiagnostics, model, options),
  ({ loweredDiagnostics, model, options }) =>
    validateDataBindings(loweredDiagnostics, model, options),
  ({ originalDiagnostics, originalModel, options }) =>
    validateStampExpressionDrift(originalDiagnostics, originalModel, options),
  ({ loweredDiagnostics, model, options }) =>
    validateEventPayloads(loweredDiagnostics, model, options),
  ({ loweredDiagnostics, model }) => validateDirectDbAccess(loweredDiagnostics, model),
  ({ originalDiagnostics, originalModel, options }) =>
    validateDeclaredClockReadsInRender(originalDiagnostics, originalModel, options),
  ({ loweredDiagnostics, model }) =>
    validateUntrackedClockReadsInDerives(loweredDiagnostics, model),
  ({ originalDiagnostics, originalModel, options }) =>
    validateIdrefs(originalDiagnostics, originalModel, options.packageComponentPrefixes),
  ({ loweredDiagnostics, model }) => validateStaticIds(loweredDiagnostics, model),
  ({ loweredDiagnostics, model, options }) =>
    validateLiteralHrefs(loweredDiagnostics, model, options),
  ({ originalDiagnostics, originalModel, styleOwnedSpans }) =>
    validateOutputContexts(originalDiagnostics, originalModel, styleOwnedSpans),
  ({ loweredDiagnostics, model }) => validateHtmlContentModel(loweredDiagnostics, model),
  ({ loweredDiagnostics, model }) => validateEventTriggerNames(loweredDiagnostics, model),
  ({ loweredDiagnostics, model }) =>
    validateHandAuthoredNavigationSegmentStamps(loweredDiagnostics, model),
  ({ loweredDiagnostics, model, options }) =>
    validateResidualStamps(loweredDiagnostics, model, options),
  ({ loweredDiagnostics, model }) => validateAttributeMergeConflicts(loweredDiagnostics, model),
  ({ mappedDiagnostics, updateCoverage }) =>
    unhandledUpdateCoverageDiagnostics(mappedDiagnostics, updateCoverage),
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
