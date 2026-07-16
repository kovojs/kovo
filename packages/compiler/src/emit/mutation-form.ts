import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  compilerArrayAppend,
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
  isIntrinsicHtmlElement,
  mutationSubmitterTransportAttributeName,
} from '../mutation-form-provenance.js';
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
    compilerArrayAppend(
      target,
      snapshot[index]!,
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }
}

function mutationFormAttribute(
  element: JsxElementModel,
  name: string,
): JsxAttributeModel | undefined {
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Mutation form attributes');
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (
      attribute.name === name ||
      (element.intrinsicTagName !== undefined && compilerStringToLowerCase(attribute.name) === name)
    ) {
      return attribute;
    }
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
      compilerArrayAppend(
        diagnostics,
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> must be rendered inside an enhanced mutation form`,
        ),
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
      continue;
    }

    const binding = enhancedMutationFormBinding(form);
    if (!binding) {
      compilerArrayAppend(
        diagnostics,
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> must be rendered inside a form with mutation={...} or mutationFormAttributes(...)`,
        ),
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
      continue;
    }

    const slotsParam = componentRenderSlotsParam(model);
    const slotName = componentMutationSlotName(model, binding.localName);
    if (!slotName) {
      compilerArrayAppend(
        diagnostics,
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> could not resolve the component-local mutation slot for ${binding.localName}`,
        ),
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
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
    appendMutationValues(replacements, lowered.replacements, 'Mutation form error replacements');
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
    if (!isIntrinsicHtmlElement(form, 'form')) continue;
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
        compilerArrayAppend(
          mutationFields,
          fields[index]!.name,
          'Compiler packages/compiler/src/emit/mutation-form.ts collection',
        );
      }
    }
    compilerArrayAppend(
      forms,
      {
        ...(fieldErrors.length === 0 ? {} : { fieldErrors }),
        ...(mutationInput === null ? {} : { fields: mutationFields }),
        ...(fileFields.length === 0 ? {} : { enctype: 'multipart/form-data' as const, fileFields }),
        ...(formErrors.length === 0 ? {} : { formErrors }),
        mutation: mutationInput?.key ?? mutationKey ?? binding.localName,
        slot,
      },
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
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
    compilerArrayAppend(
      facts,
      { id, name },
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
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
    compilerArrayAppend(
      facts,
      code ? { code } : {},
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
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
    compilerArrayAppend(
      fieldNameList,
      fieldName,
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
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
    compilerArrayAppend(
      replacements,
      {
        end: position,
        replacement: ` aria-describedby=${errorId.source}`,
        start: position,
      },
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
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
    if (
      !isIntrinsicHtmlElement(element, 'input') &&
      !isIntrinsicHtmlElement(element, 'select') &&
      !isIntrinsicHtmlElement(element, 'textarea')
    )
      continue;
    if (element.start < form.openingEnd || element.end > formEnd) continue;
    if (mutationFormAttribute(element, 'disabled')) continue;
    const rawType = staticStringAttributeValue(mutationFormAttribute(element, 'type'));
    const type = rawType === null ? undefined : compilerStringToLowerCase(rawType);
    if (isIntrinsicHtmlElement(element, 'input') && type === 'hidden') continue;
    if (staticStringAttributeValue(mutationFormAttribute(element, 'name')) !== name) continue;
    compilerArrayAppend(
      controls,
      element,
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
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
      compilerArrayAppend(
        diagnostics,
        repeatableDiagnostic,
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
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

    appendMutationValues(
      replacements,
      lowering.replacements,
      'Enhanced mutation form replacements',
    );
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
        compilerArrayAppend(
          diagnostics,
          writerConflictDiagnostic(
            options,
            conflict.attribute,
            conflict.attribute.name,
            'author JSX',
            'typed mutation form lowering',
          ),
          'Compiler packages/compiler/src/emit/mutation-form.ts collection',
        );
      }
    }
  }

  if (needsCsrfImport && options && !importsMutationCsrfField(model)) {
    const start = compilerHelperImportInsertionOffset(options.source);
    compilerArrayAppend(
      replacements,
      {
        end: start,
        // SPEC.md §10.3:1063/1065: also import renderMutationIdemField so each
        // emitted form body includes a per-submit idempotency token alongside CSRF.
        replacement:
          "import { renderMutationCsrfField as __kovoRenderMutationCsrfField, renderMutationIdemField as __kovoRenderMutationIdemField } from '@kovojs/server/internal/csrf';\n",
        start,
      },
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
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
      compilerArrayAppend(
        diagnostics,
        writerConflictDiagnostic(
          options,
          residual,
          'data-stream-text',
          'author JSX',
          'stream text target lowering',
        ),
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
    }

    const targetAttribute = streamText ?? residual;
    if (!targetAttribute) continue;

    const literalTarget = staticStringAttributeValue(targetAttribute);
    if (options && literalTarget !== null && !isValidStreamTextTarget(literalTarget)) {
      compilerArrayAppend(
        diagnostics,
        streamTextTargetDiagnostic(options, targetAttribute, literalTarget),
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
    }

    if (streamText) {
      compilerArrayAppend(
        replacements,
        {
          end: streamText.end,
          replacement: renderAttributeWithName('data-stream-text', streamText),
          start: streamText.start,
        },
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
      compilerArrayAppend(
        outputContexts,
        formLoweringOutputContext(
          'data-stream-text',
          attributeValueExpression(streamText),
          'stream text target lowering',
        ),
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
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
  if (!options || !isIntrinsicHtmlElement(element, 'form') || !element.repeatable) return null;
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
  if (!isIntrinsicHtmlElement(element, 'form')) return [];

  const binding = enhancedMutationFormBinding(element);
  if (!binding) return [];

  const controls = compilerSnapshotDenseArray(
    successfulFormControls(model, element, options),
    'Successful mutation form controls',
  );
  const diagnostics: CompilerDiagnostic[] = [];
  for (let index = 0; index < controls.length; index += 1) {
    appendMutationValues(
      diagnostics,
      controls[index]!.diagnostics,
      'Mutation form control diagnostics',
    );
  }

  const mutation = mutationInputFactForForm(model, binding.localName, options);
  if (!mutation) return diagnostics;

  const fields = compilerSnapshotDenseArray(mutation.fields, 'Mutation form schema fields');
  const fieldNames = compilerCreateSet<string>();
  const fieldNameList: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const fieldName = fields[index]!.name;
    compilerSetAdd(fieldNames, fieldName);
    compilerArrayAppend(
      fieldNameList,
      fieldName,
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }
  const controlNames = compilerCreateSet<string>();
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]!;
    compilerSetAdd(controlNames, control.name);
  }

  for (let index = 0; index < controls.length; index += 1) {
    const control = controls[index]!;
    if (!control.name) continue;
    if (compilerSetHas(fieldNames, control.name)) continue;
    compilerArrayAppend(
      diagnostics,
      formFieldDiagnostic(
        options,
        control.start,
        control.length,
        `unknown field "${control.name}" for mutation "${mutation.key}". Expected fields: ${joinMutationStrings(fieldNameList, ', ')}`,
      ),
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (!field.required || compilerSetHas(controlNames, field.name)) continue;
    compilerArrayAppend(
      diagnostics,
      formFieldDiagnostic(
        options,
        binding.start,
        binding.end - binding.start,
        `missing required field "${field.name}" for mutation "${mutation.key}". Expected fields: ${joinMutationStrings(fieldNameList, ', ')}`,
      ),
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
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
      !isIntrinsicHtmlElement(element, 'button') &&
      !isIntrinsicHtmlElement(element, 'input') &&
      !isIntrinsicHtmlElement(element, 'select') &&
      !isIntrinsicHtmlElement(element, 'textarea')
    ) {
      continue;
    }
    if (mutationFormAttribute(element, 'disabled')) continue;

    const descendant = element.start >= form.openingEnd && element.end <= formEnd;
    const externalFormAttribute = mutationFormAttribute(element, 'form');
    const externalForm = staticStringAttributeValue(externalFormAttribute);
    if (!descendant && (!formId || externalForm !== formId)) continue;

    const nameAttribute = mutationFormAttribute(element, 'name');
    const diagnostics = mutationSubmitterTransportOverrideDiagnostics(element, options);
    if (!descendant || externalFormAttribute) {
      compilerArrayAppend(
        diagnostics,
        formFieldDiagnostic(
          options,
          (externalFormAttribute ?? element).start,
          (externalFormAttribute ?? element).end - (externalFormAttribute ?? element).start,
          'external form-associated controls are not supported for enhanced mutation field validation; keep controls inside the submitted form',
        ),
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
    }

    const name = staticStringAttributeValue(nameAttribute);
    if (!nameAttribute) {
      if (diagnostics.length > 0) {
        compilerArrayAppend(
          controls,
          {
            diagnostics,
            length: element.openingTagNameEnd - element.openingTagNameStart,
            name: '',
            start: element.openingTagNameStart,
          },
          'Compiler packages/compiler/src/emit/mutation-form.ts collection',
        );
      }
      continue;
    }
    if (!name) {
      compilerArrayAppend(
        diagnostics,
        formFieldDiagnostic(
          options,
          nameAttribute.start,
          nameAttribute.end - nameAttribute.start,
          'dynamic field names are not supported for enhanced mutation field validation; use a literal name from the mutation input schema',
        ),
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
      compilerArrayAppend(
        controls,
        {
          diagnostics,
          length: nameAttribute.end - nameAttribute.start,
          name: '',
          start: nameAttribute.start,
        },
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
      continue;
    }

    appendMutationValues(
      diagnostics,
      unsupportedControlDiagnostics(element, name, nameAttribute, options),
      'Unsupported mutation control diagnostics',
    );

    compilerArrayAppend(
      controls,
      {
        diagnostics,
        length: nameAttribute.end - nameAttribute.start,
        name,
        start: nameAttribute.start,
      },
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
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
      compilerArrayAppend(
        result,
        control,
        'Compiler packages/compiler/src/emit/mutation-form.ts collection',
      );
      continue;
    }
    const repeatedDiagnostics = compilerSnapshotDenseArray(
      control.diagnostics,
      'Repeated form control diagnostics',
    );
    compilerArrayAppend(
      repeatedDiagnostics,
      formFieldDiagnostic(
        options,
        control.start,
        control.length,
        `repeated field "${control.name}" is not supported for enhanced mutation field validation; declare one control per mutation input field`,
      ),
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
    compilerArrayAppend(
      result,
      {
        ...control,
        diagnostics: repeatedDiagnostics,
      },
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }
  return result;
}

function mutationSubmitterTransportOverrideDiagnostics(
  element: JsxElementModel,
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const attributes = compilerSnapshotDenseArray(
    element.attributes,
    'Mutation submitter transport attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    const transport = mutationSubmitterTransportAttributeName(attribute.name);
    if (transport !== 'formaction' && transport !== 'formmethod') continue;
    compilerArrayAppend(
      diagnostics,
      formFieldDiagnostic(
        options,
        attribute.start,
        attribute.end - attribute.start,
        `${attribute.name} cannot override a typed enhanced mutation transport; use a separate native form for a different action or method`,
      ),
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }
  return diagnostics;
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
    compilerArrayAppend(
      diagnostics,
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `nested field path "${name}" is not supported for enhanced mutation field validation; use a flat mutation input field name`,
      ),
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }

  if (isIntrinsicHtmlElement(element, 'input') && type === 'file') {
    compilerArrayAppend(
      diagnostics,
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `file input field "${name}" is not supported for enhanced mutation field validation`,
      ),
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }

  if (isIntrinsicHtmlElement(element, 'input') && (type === 'checkbox' || type === 'radio')) {
    compilerArrayAppend(
      diagnostics,
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `${type} field "${name}" is not supported for enhanced mutation field validation; use a single scalar input or a later multivalue form primitive`,
      ),
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }

  if (isIntrinsicHtmlElement(element, 'select') && mutationFormAttribute(element, 'multiple')) {
    compilerArrayAppend(
      diagnostics,
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `multiple select field "${name}" is not supported for enhanced mutation field validation; use a single-value select or a later multivalue form primitive`,
      ),
      'Compiler packages/compiler/src/emit/mutation-form.ts collection',
    );
  }

  return diagnostics;
}
