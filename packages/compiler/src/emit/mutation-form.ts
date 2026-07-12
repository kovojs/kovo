import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  compilerCreateMap,
  compilerCreateSet,
  compilerJsonStringify,
  compilerMapGet,
  compilerMapSet,
  compilerRegExpExec,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringToLowerCase,
} from '../compiler-security-intrinsics.js';
import type { GeneratedOutputWriteFact } from '../output-context-facts.js';
import {
  mutationInputFactsFromSource,
  type LocalMutationInputFact,
} from '../scan/mutation-inputs.js';
import {
  componentRenderSlotsParam,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import type { SourceReplacement } from '../shared.js';
import type { RegistryFacts } from '../types.js';
import {
  attributeValueExpression,
  componentMutationSlotName,
  enclosingEnhancedMutationForm,
  enhancedMutationFormBinding,
  enhancedMutationFormLowering,
  formLoweringOutputContext,
  importsMutationCsrfField,
  localMutationKey,
  mutationInputFileFieldsForLocalName,
  mutationFormErrorIdExpression,
  mutationFormErrorProps,
  renderAttributeWithName,
  staticStringAttributeValue,
  writerConflictDiagnostic,
} from './server-emit-shared.js';

function appendMutationValues<Value>(
  target: Value[],
  values: readonly Value[],
  label: string,
): void {
  const snapshot = compilerSnapshotDenseArray(values, label);
  for (let index = 0; index < snapshot.length; index += 1) {
    target[target.length] = snapshot[index]!;
  }
}

function mutationFormAttribute(
  element: JsxElementModel,
  name: string,
): JsxAttributeModel | undefined {
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Mutation form attributes');
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function joinMutationStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) output += separator;
    output += values[index]!;
  }
  return output;
}

function mutationJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}

export function mutationFormErrorRenderLowering(
  model: ComponentModuleModel,
  options?: { fileName: string; registryFacts?: RegistryFacts; source: string },
): {
  diagnostics: readonly CompilerDiagnostic[];
  replacements: readonly SourceReplacement[];
} {
  if (!options) return { diagnostics: [], replacements: [] };

  const diagnostics: CompilerDiagnostic[] = [];
  const replacements: SourceReplacement[] = [];
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Mutation form error elements');

  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    if (element.tag !== 'FieldError' && element.tag !== 'FormError') continue;

    const form = enclosingEnhancedMutationForm(model, element);
    if (!form) {
      diagnostics[diagnostics.length] = formFieldDiagnostic(
        options,
        element.openingTagNameStart,
        element.openingTagNameEnd - element.openingTagNameStart,
        `<${element.tag}> must be rendered inside an enhanced mutation form`,
      );
      continue;
    }

    const binding = enhancedMutationFormBinding(form);
    if (!binding) {
      diagnostics[diagnostics.length] = formFieldDiagnostic(
        options,
        element.openingTagNameStart,
        element.openingTagNameEnd - element.openingTagNameStart,
        `<${element.tag}> must be rendered inside a form with mutation={...} or mutationFormAttributes(...)`,
      );
      continue;
    }

    const slotsParam = componentRenderSlotsParam(model);
    const slotName = componentMutationSlotName(model, binding.localName);
    if (!slotName) {
      diagnostics[diagnostics.length] = formFieldDiagnostic(
        options,
        element.openingTagNameStart,
        element.openingTagNameEnd - element.openingTagNameStart,
        `<${element.tag}> could not resolve the component-local mutation slot for ${binding.localName}`,
      );
      continue;
    }

    if (element.tag === 'FieldError') {
      appendMutationValues(
        diagnostics,
        fieldErrorDiagnostics(model, element, binding.localName, options),
        'Field error diagnostics',
      );
    }
    if (!slotsParam) continue;

    const lowered = lowerMutationFormErrorElement(model, element, form, slotName, slotsParam.name);
    appendMutationValues(
      replacements,
      lowered.replacements,
      'Mutation form error replacements',
    );
  }

  return { diagnostics, replacements };
}

export function mutationFormExplainFacts(
  model: ComponentModuleModel,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): CoreGraph.MutationFormExplain[] {
  const forms: CoreGraph.MutationFormExplain[] = [];
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Mutation form explain elements');

  for (let formIndex = 0; formIndex < elements.length; formIndex += 1) {
    const form = elements[formIndex]!;
    if (form.tag !== 'form') continue;
    const binding = enhancedMutationFormBinding(form);
    if (!binding) continue;

    const mutationKey = localMutationKey(
      model,
      binding.localName,
      options.registryFacts,
      options.fileName,
    );
    const mutationInput = mutationInputFactForForm(model, binding.localName, options);
    if (!mutationKey && !mutationInput) continue;

    const slot = componentMutationSlotName(model, binding.localName) ?? binding.localName;
    const fileFields = mutationInputFileFieldsForLocalName(model, binding.localName, options);
    const fieldErrors = mutationFormFieldErrorFacts(model, form, slot);
    const formErrors = mutationFormErrorFacts(model, form);

    const mutationFields: string[] = [];
    if (mutationInput !== null) {
      const fields = compilerSnapshotDenseArray(
        mutationInput.fields,
        'Mutation form explain fields',
      );
      for (let index = 0; index < fields.length; index += 1) {
        mutationFields[mutationFields.length] = fields[index]!.name;
      }
    }
    forms[forms.length] = {
      ...(fieldErrors.length === 0 ? {} : { fieldErrors }),
      ...(mutationInput === null ? {} : { fields: mutationFields }),
      ...(fileFields.length === 0 ? {} : { enctype: 'multipart/form-data' as const, fileFields }),
      ...(formErrors.length === 0 ? {} : { formErrors }),
      mutation: mutationInput?.key ?? mutationKey ?? binding.localName,
      slot,
    };
  }

  return forms;
}

function mutationFormFieldErrorFacts(
  model: ComponentModuleModel,
  form: JsxElementModel,
  slot: string,
): CoreGraph.MutationFormFieldErrorExplain[] {
  const facts: CoreGraph.MutationFormFieldErrorExplain[] = [];
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Mutation field-error facts');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.tag !== 'FieldError' || enclosingEnhancedMutationForm(model, element) !== form) {
      continue;
    }
    const name = staticStringAttributeValue(mutationFormAttribute(element, 'name'));
    if (!name) continue;
    const authoredId = staticStringAttributeValue(mutationFormAttribute(element, 'id'));
    const generatedId = mutationFormErrorIdExpression(form, slot, name).source;
    const id = authoredId ?? compilerRegExpReplace(/^"|"$/g, generatedId, '');
    facts[facts.length] = { id, name };
  }
  return facts;
}

function mutationFormErrorFacts(
  model: ComponentModuleModel,
  form: JsxElementModel,
): CoreGraph.MutationFormErrorExplain[] {
  const facts: CoreGraph.MutationFormErrorExplain[] = [];
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Mutation form-error facts');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.tag !== 'FormError' || enclosingEnhancedMutationForm(model, element) !== form) {
      continue;
    }
    const code = staticStringAttributeValue(mutationFormAttribute(element, 'code'));
    facts[facts.length] = code ? { code } : {};
  }
  return facts;
}

function fieldErrorDiagnostics(
  model: ComponentModuleModel,
  element: JsxElementModel,
  localName: string,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): CompilerDiagnostic[] {
  const nameAttribute = mutationFormAttribute(element, 'name');
  if (!nameAttribute) {
    return [
      formFieldDiagnostic(
        options,
        element.openingTagNameStart,
        element.openingTagNameEnd - element.openingTagNameStart,
        '<FieldError> requires a literal name from the enclosing mutation input schema',
      ),
    ];
  }

  const name = staticStringAttributeValue(nameAttribute);
  if (!name) {
    return [
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        'dynamic field error names are not supported; use a literal name from the mutation input schema',
      ),
    ];
  }

  const mutation = mutationInputFactForForm(model, localName, options);
  if (!mutation) return [];

  const fieldNames = compilerCreateSet<string>();
  const fieldNameList: string[] = [];
  const fields = compilerSnapshotDenseArray(mutation.fields, 'Mutation input fields');
  for (let index = 0; index < fields.length; index += 1) {
    const fieldName = fields[index]!.name;
    compilerSetAdd(fieldNames, fieldName);
    fieldNameList[fieldNameList.length] = fieldName;
  }
  if (compilerSetHas(fieldNames, name)) return [];

  return [
    formFieldDiagnostic(
      options,
      nameAttribute.start,
      nameAttribute.end - nameAttribute.start,
      `unknown field "${name}" for mutation "${mutation.key}". Expected fields: ${joinMutationStrings(fieldNameList, ', ')}`,
    ),
  ];
}

function lowerMutationFormErrorElement(
  model: ComponentModuleModel,
  element: JsxElementModel,
  form: JsxElementModel,
  localName: string,
  slotsParamName: string,
): { replacements: readonly SourceReplacement[] } {
  const props = mutationFormErrorProps(element, form, localName, slotsParamName);
  const replacements: SourceReplacement[] = [
    {
      end: element.end,
      replacement: `{${element.tag}(${props})}`,
      start: element.start,
    },
  ];

  if (element.tag === 'FieldError') {
    const name = staticStringAttributeValue(mutationFormAttribute(element, 'name'));
    const id = staticStringAttributeValue(mutationFormAttribute(element, 'id'));
    if (name) {
      const errorId = id
        ? {
            expression: mutationJsonSource(id, 'Mutation form error id'),
            source: mutationJsonSource(id, 'Mutation form error id'),
          }
        : mutationFormErrorIdExpression(form, localName, name);
      appendMutationValues(
        replacements,
        fieldControlDescribedByReplacements(model, form, name, errorId),
        'Field aria-describedby replacements',
      );
    }
  }

  return { replacements };
}

function fieldControlDescribedByReplacements(
  model: ComponentModuleModel,
  form: JsxElementModel,
  name: string,
  errorId: { expression: string; source: string },
): SourceReplacement[] {
  const replacements: SourceReplacement[] = [];
  const controls = formControlElements(model, form, name);
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]!;
    if (mutationFormAttribute(control, 'aria-describedby')) continue;
    const position = openingTagAttributePosition(control);
    replacements[replacements.length] = {
      end: position,
      replacement: ` aria-describedby=${errorId.source}`,
      start: position,
    };
  }
  return replacements;
}

function formControlElements(
  model: ComponentModuleModel,
  form: JsxElementModel,
  name: string,
): JsxElementModel[] {
  const formEnd = form.selfClosing ? form.end : form.closingStart;
  const controls: JsxElementModel[] = [];
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Mutation form controls');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.tag !== 'input' && element.tag !== 'select' && element.tag !== 'textarea') continue;
    if (element.start < form.openingEnd || element.end > formEnd) continue;
    if (mutationFormAttribute(element, 'disabled')) continue;
    const rawType = staticStringAttributeValue(mutationFormAttribute(element, 'type'));
    const type = rawType === null ? undefined : compilerStringToLowerCase(rawType);
    if (element.tag === 'input' && type === 'hidden') continue;
    if (staticStringAttributeValue(mutationFormAttribute(element, 'name')) !== name) continue;
    controls[controls.length] = element;
  }
  return controls;
}

function openingTagAttributePosition(element: JsxElementModel): number {
  if (!element.selfClosing) return element.openingEnd - 1;
  return element.openingEnd - (element.selfClosingSlashHasLeadingWhitespace ? 2 : 1);
}

export function enhancedMutationFormRenderLowering(
  model: ComponentModuleModel,
  options?: { fileName: string; registryFacts?: RegistryFacts; source: string },
): {
  diagnostics: readonly CompilerDiagnostic[];
  outputContexts: readonly GeneratedOutputWriteFact[];
  replacements: readonly SourceReplacement[];
} {
  const diagnostics: CompilerDiagnostic[] = [];
  const replacements: SourceReplacement[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  let needsCsrfImport = false;
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Enhanced mutation form elements');

  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const repeatableDiagnostic = repeatableMutationFormDiagnostic(model, element, options);
    if (repeatableDiagnostic) {
      diagnostics[diagnostics.length] = repeatableDiagnostic;
      continue;
    }

    if (options) {
      appendMutationValues(
        diagnostics,
        mutationFormFieldDiagnostics(model, element, options),
        'Mutation form field diagnostics',
      );
    }

    const lowering = enhancedMutationFormLowering(model, element, options);
    if (!lowering) continue;

    appendMutationValues(replacements, lowering.replacements, 'Enhanced mutation form replacements');
    needsCsrfImport ||= lowering.importsMutationCsrfField;
    appendMutationValues(
      outputContexts,
      lowering.outputContexts,
      'Enhanced mutation form output contexts',
    );
    if (options) {
      const conflicts = compilerSnapshotDenseArray(
        lowering.conflicts,
        'Enhanced mutation form conflicts',
      );
      for (let index = 0; index < conflicts.length; index += 1) {
        const conflict = conflicts[index]!;
        diagnostics[diagnostics.length] = writerConflictDiagnostic(
          options,
          conflict.attribute,
          conflict.attribute.name,
          'author JSX',
          'typed mutation form lowering',
        );
      }
    }
  }

  if (needsCsrfImport && options && !importsMutationCsrfField(model)) {
    const start = compilerHelperImportInsertionOffset(options.source);
    replacements[replacements.length] = {
      end: start,
      // SPEC.md §10.3:1063/1065: also import renderMutationIdemField so each
      // emitted form body includes a per-submit idempotency token alongside CSRF.
      replacement:
        "import { renderMutationCsrfField as __kovoRenderMutationCsrfField, renderMutationIdemField as __kovoRenderMutationIdemField } from '@kovojs/server/internal/csrf';\n",
      start,
    };
  }

  return { diagnostics, outputContexts, replacements };
}

export function streamTextTargetRenderLowering(
  model: ComponentModuleModel,
  options?: { fileName: string; registryFacts?: RegistryFacts; source: string },
): {
  diagnostics: readonly CompilerDiagnostic[];
  outputContexts: readonly GeneratedOutputWriteFact[];
  replacements: readonly SourceReplacement[];
} {
  const diagnostics: CompilerDiagnostic[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  const replacements: SourceReplacement[] = [];
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Stream text target elements');

  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const streamText = mutationFormAttribute(element, 'streamText');
    const residual = mutationFormAttribute(element, 'data-stream-text');

    if (streamText && residual && options) {
      diagnostics[diagnostics.length] = writerConflictDiagnostic(
        options,
        residual,
        'data-stream-text',
        'author JSX',
        'stream text target lowering',
      );
    }

    const targetAttribute = streamText ?? residual;
    if (!targetAttribute) continue;

    const literalTarget = staticStringAttributeValue(targetAttribute);
    if (options && literalTarget !== null && !isValidStreamTextTarget(literalTarget)) {
      diagnostics[diagnostics.length] = streamTextTargetDiagnostic(
        options,
        targetAttribute,
        literalTarget,
      );
    }

    if (streamText) {
      replacements[replacements.length] = {
        end: streamText.end,
        replacement: renderAttributeWithName('data-stream-text', streamText),
        start: streamText.start,
      };
      outputContexts[outputContexts.length] = formLoweringOutputContext(
        'data-stream-text',
        attributeValueExpression(streamText),
        'stream text target lowering',
      );
    }
  }

  return { diagnostics, outputContexts, replacements };
}

function isValidStreamTextTarget(target: string): boolean {
  return compilerRegExpTest(/^[A-Za-z][A-Za-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]*$/, target);
}

function streamTextTargetDiagnostic(
  options: { fileName: string; source: string },
  attribute: JsxAttributeModel,
  target: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(
      options.fileName,
      'KV243',
      options.source,
      attribute.start,
      attribute.end - attribute.start,
    ),
    message: `${diagnosticDefinitions.KV243.message} "${target}" is not a stream source id; expected "source:id", not a selector or unscoped id.`,
  };
}

type MutationInputFact = LocalMutationInputFact;

function compilerHelperImportInsertionOffset(source: string): number {
  const jsxImportSource = compilerRegExpExec(/^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/, source);
  return jsxImportSource?.[0].length ?? 0;
}

function repeatableMutationFormDiagnostic(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string } | undefined,
): CompilerDiagnostic | null {
  if (!options || element.tag !== 'form' || !element.repeatable) return null;
  if (mutationFormAttribute(element, 'key')) return null;

  const binding = enhancedMutationFormBinding(element);
  if (!binding) return null;
  if (!localMutationKey(model, binding.localName, options.registryFacts, options.fileName)) {
    return null;
  }

  return {
    ...diagnosticFor(
      options.fileName,
      'KV238',
      options.source,
      binding.start,
      binding.end - binding.start,
    ),
    message: `${diagnosticDefinitions.KV238.message} repeatable enhanced mutation form needs authored key identity`,
  };
}

function mutationFormFieldDiagnostics(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): CompilerDiagnostic[] {
  if (element.tag !== 'form') return [];

  const binding = enhancedMutationFormBinding(element);
  if (!binding) return [];

  const mutation = mutationInputFactForForm(model, binding.localName, options);
  if (!mutation) return [];

  const controls = compilerSnapshotDenseArray(
    successfulFormControls(model, element, options),
    'Successful mutation form controls',
  );
  const fields = compilerSnapshotDenseArray(mutation.fields, 'Mutation form schema fields');
  const fieldNames = compilerCreateSet<string>();
  const fieldNameList: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const fieldName = fields[index]!.name;
    compilerSetAdd(fieldNames, fieldName);
    fieldNameList[fieldNameList.length] = fieldName;
  }
  const controlNames = compilerCreateSet<string>();
  const diagnostics: CompilerDiagnostic[] = [];
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]!;
    compilerSetAdd(controlNames, control.name);
    appendMutationValues(
      diagnostics,
      control.diagnostics,
      'Mutation form control diagnostics',
    );
  }

  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]!;
    if (!control.name) continue;
    if (compilerSetHas(fieldNames, control.name)) continue;
    diagnostics[diagnostics.length] = formFieldDiagnostic(
      options,
      control.start,
      control.length,
      `unknown field "${control.name}" for mutation "${mutation.key}". Expected fields: ${joinMutationStrings(fieldNameList, ', ')}`,
    );
  }

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (!field.required || compilerSetHas(controlNames, field.name)) continue;
    diagnostics[diagnostics.length] = formFieldDiagnostic(
      options,
      binding.start,
      binding.end - binding.start,
      `missing required field "${field.name}" for mutation "${mutation.key}". Expected fields: ${joinMutationStrings(fieldNameList, ', ')}`,
    );
  }

  return diagnostics;
}

function mutationInputFactForForm(
  model: ComponentModuleModel,
  localName: string,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): MutationInputFact | null {
  const localMutation = compilerMapGet(
    mutationInputFactsFromSource(options.fileName, options.source),
    localName,
  );
  if (localMutation) return localMutation;

  const mutationKey = localMutationKey(model, localName, options.registryFacts, options.fileName);
  const registryFields = mutationKey
    ? options.registryFacts?.mutationInputs?.[mutationKey]
    : undefined;
  if (!mutationKey || !registryFields) return null;

  return {
    fields: registryFields,
    key: mutationKey,
    localName,
  };
}

function formFieldDiagnostic(
  options: { fileName: string; source: string },
  start: number,
  length: number,
  detail: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(options.fileName, 'KV242', options.source, start, length),
    message: `${diagnosticDefinitions.KV242.message} ${detail}`,
  };
}

function successfulFormControls(
  model: ComponentModuleModel,
  form: JsxElementModel,
  options: { fileName: string; source: string },
): { diagnostics: readonly CompilerDiagnostic[]; length: number; name: string; start: number }[] {
  const formEnd = form.selfClosing ? form.end : form.closingStart;
  const formId = staticStringAttributeValue(mutationFormAttribute(form, 'id'));
  const controls: {
    diagnostics: readonly CompilerDiagnostic[];
    length: number;
    name: string;
    start: number;
  }[] = [];
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Successful form controls');

  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    if (element === form) continue;
    if (
      element.tag !== 'button' &&
      element.tag !== 'input' &&
      element.tag !== 'select' &&
      element.tag !== 'textarea'
    ) {
      continue;
    }
    if (mutationFormAttribute(element, 'disabled')) continue;

    const descendant = element.start >= form.openingEnd && element.end <= formEnd;
    const externalFormAttribute = mutationFormAttribute(element, 'form');
    const externalForm = staticStringAttributeValue(externalFormAttribute);
    if (!descendant && (!formId || externalForm !== formId)) continue;

    const nameAttribute = mutationFormAttribute(element, 'name');
    const diagnostics: CompilerDiagnostic[] = [];
    if (!descendant || externalFormAttribute) {
      diagnostics[diagnostics.length] = formFieldDiagnostic(
        options,
        (externalFormAttribute ?? element).start,
        (externalFormAttribute ?? element).end - (externalFormAttribute ?? element).start,
        'external form-associated controls are not supported for enhanced mutation field validation; keep controls inside the submitted form',
      );
    }

    const name = staticStringAttributeValue(nameAttribute);
    if (!nameAttribute) continue;
    if (!name) {
      diagnostics[diagnostics.length] = formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        'dynamic field names are not supported for enhanced mutation field validation; use a literal name from the mutation input schema',
      );
      controls[controls.length] = {
        diagnostics,
        length: nameAttribute.end - nameAttribute.start,
        name: '',
        start: nameAttribute.start,
      };
      continue;
    }

    appendMutationValues(
      diagnostics,
      unsupportedControlDiagnostics(element, name, nameAttribute, options),
      'Unsupported mutation control diagnostics',
    );

    controls[controls.length] = {
      diagnostics,
      length: nameAttribute.end - nameAttribute.start,
      name,
      start: nameAttribute.start,
    };
  }

  const counts = compilerCreateMap<string, number>();
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]!;
    if (!control.name) continue;
    compilerMapSet(counts, control.name, (compilerMapGet(counts, control.name) ?? 0) + 1);
  }

  const result: typeof controls = [];
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]!;
    if (!control.name || (compilerMapGet(counts, control.name) ?? 0) <= 1) {
      result[result.length] = control;
      continue;
    }
    const repeatedDiagnostics = compilerSnapshotDenseArray(
      control.diagnostics,
      'Repeated form control diagnostics',
    );
    repeatedDiagnostics[repeatedDiagnostics.length] = formFieldDiagnostic(
      options,
      control.start,
      control.length,
      `repeated field "${control.name}" is not supported for enhanced mutation field validation; declare one control per mutation input field`,
    );
    result[result.length] = {
      ...control,
      diagnostics: repeatedDiagnostics,
    };
  }
  return result;
}

function unsupportedControlDiagnostics(
  element: JsxElementModel,
  name: string,
  nameAttribute: JsxAttributeModel,
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const rawType = staticStringAttributeValue(mutationFormAttribute(element, 'type'));
  const type = rawType === null ? undefined : compilerStringToLowerCase(rawType);

  if (compilerRegExpTest(/[.[\]]/, name)) {
    diagnostics[diagnostics.length] = formFieldDiagnostic(
      options,
      nameAttribute.start,
      nameAttribute.end - nameAttribute.start,
      `nested field path "${name}" is not supported for enhanced mutation field validation; use a flat mutation input field name`,
    );
  }

  if (element.tag === 'input' && type === 'file') {
    diagnostics[diagnostics.length] = formFieldDiagnostic(
      options,
      nameAttribute.start,
      nameAttribute.end - nameAttribute.start,
      `file input field "${name}" is not supported for enhanced mutation field validation`,
    );
  }

  if (element.tag === 'input' && (type === 'checkbox' || type === 'radio')) {
    diagnostics[diagnostics.length] = formFieldDiagnostic(
      options,
      nameAttribute.start,
      nameAttribute.end - nameAttribute.start,
      `${type} field "${name}" is not supported for enhanced mutation field validation; use a single scalar input or a later multivalue form primitive`,
    );
  }

  if (element.tag === 'select' && mutationFormAttribute(element, 'multiple')) {
    diagnostics[diagnostics.length] = formFieldDiagnostic(
      options,
      nameAttribute.start,
      nameAttribute.end - nameAttribute.start,
      `multiple select field "${name}" is not supported for enhanced mutation field validation; use a single-value select or a later multivalue form primitive`,
    );
  }

  return diagnostics;
}
