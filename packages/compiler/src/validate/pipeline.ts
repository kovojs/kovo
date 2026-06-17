import type { CompilerDiagnostic } from '../diagnostics.js';
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
  validateHtmlContentModel,
  validateIdrefs,
  validateResidualStamps,
  validateStaticIds,
} from './markup.js';
import { validateLiteralHrefs } from './navigation.js';
import { validateOutputContexts } from '../security/output-context.js';
import { queryShapeFactDiagnostics } from '../types.js';

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

type CompilerValidator = (context: ValidatorContext) => readonly CompilerDiagnostic[];

const compilerValidators: readonly CompilerValidator[] = [
  ({ diagnosticSource, model, options, sourceOffsetMap }) =>
    validateServerFactsInLocalState(diagnosticSource, model, options.fileName, sourceOffsetMap),
  ({ model, options, source }) => validateReservedQueryNames(source, model, options.fileName),
  ({ model, options, source }) =>
    validateRemovedFragmentTargetOption(source, model, options.fileName),
  ({ model, options, source }) =>
    validateHandAuthoredFragmentTargetStamp(source, model, options.fileName),
  ({ model, options, source }) => validateComponentNameUniqueness(source, model, options),
  ({ model, options, source }) => validateFragmentTargetNameUniqueness(source, model, options),
  ({ options, originalModel }) =>
    validateStaticViewTransitionNameUniqueness(options.source, originalModel, options),
  ({ options }) => queryShapeFactDiagnostics(options.fileName, options.queryShapeFacts ?? []),
  ({ model, options, source }) => validateFragmentTargetInputs(source, model, options.fileName),
  ({ model, options, source }) => validateFragmentTargetChildren(source, model, options.fileName),
  ({ model, options, source }) => validateDataBindings(source, model, options),
  ({ options, originalModel }) =>
    validateStampExpressionDrift(options.source, originalModel, options),
  ({ model, options, source }) => validateEventPayloads(source, model, options),
  ({ model, options, source }) => validateDirectDbAccess(source, model, options.fileName),
  ({ options, originalModel }) =>
    validateIdrefs(
      options.source,
      originalModel,
      options.fileName,
      options.packageComponentPrefixes,
    ),
  ({ model, options, source }) => validateStaticIds(source, model, options.fileName),
  ({ model, options, source }) => validateLiteralHrefs(source, model, options),
  ({ options, originalModel, styleOwnedSpans }) =>
    validateOutputContexts(options.source, originalModel, options, styleOwnedSpans),
  ({ model, options, source }) => validateHtmlContentModel(source, model, options.fileName),
  ({ model, options, source }) => validateEventTriggerNames(source, model, options.fileName),
  ({ model, options, source }) => validateResidualStamps(source, model, options),
  ({ model, options, source }) => validateAttributeMergeConflicts(source, model, options.fileName),
  ({ diagnosticSource, options, sourceOffsetMap, updateCoverage }) =>
    unhandledUpdateCoverageDiagnostics(
      diagnosticSource,
      options.fileName,
      updateCoverage,
      sourceOffsetMap,
    ),
];

export function collectCompilerDiagnostics(context: ValidatorContext): CompilerDiagnostic[] {
  return compilerValidators.flatMap((validator) => validator(context));
}
