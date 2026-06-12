import type { CompilerDiagnostic } from '../diagnostics.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import type { CompileComponentOptions, QueryUpdateCoverageFact } from '../types.js';
import { validateDataBindings, validateStampExpressionDrift } from './bindings.js';
import {
  unhandledUpdateCoverageDiagnostics,
  validateDirectDbAccess,
  validateEventPayloads,
  validateFragmentTargetChildren,
  validateFragmentTargetInputs,
  validateServerFactsInLocalState,
} from './component-contracts.js';
import { validateEventTriggerNames } from './event-triggers.js';
import {
  validateAttributeMergeConflicts,
  validateHtmlContentModel,
  validateIdrefs,
  validateResidualStamps,
  validateStaticIds,
} from './markup.js';
import { validateLiteralHrefs } from './navigation.js';

interface ValidatorContext {
  componentName: string;
  model: ComponentModuleModel;
  options: CompileComponentOptions;
  originalModel: ComponentModuleModel;
  source: string;
  updateCoverage: readonly QueryUpdateCoverageFact[];
}

type CompilerValidator = (context: ValidatorContext) => readonly CompilerDiagnostic[];

const compilerValidators: readonly CompilerValidator[] = [
  ({ model, options, source }) => validateServerFactsInLocalState(source, model, options.fileName),
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
  ({ model, options, source }) => validateHtmlContentModel(source, model, options.fileName),
  ({ model, options, source }) => validateEventTriggerNames(source, model, options.fileName),
  ({ componentName, model, options, source }) =>
    validateResidualStamps(source, model, options, componentName),
  ({ model, options, source }) => validateAttributeMergeConflicts(source, model, options.fileName),
  ({ options, source, updateCoverage }) =>
    unhandledUpdateCoverageDiagnostics(source, options.fileName, updateCoverage),
];

export function collectCompilerDiagnostics(context: ValidatorContext): CompilerDiagnostic[] {
  return compilerValidators.flatMap((validator) => validator(context));
}
