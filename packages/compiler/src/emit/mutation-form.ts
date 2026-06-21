import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type * as CoreGraph from '@kovojs/core/internal/graph';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import type { GeneratedOutputWriteFact } from '../output-context-facts.js';
import { mutationInputFactsFromSource, type LocalMutationInputFact } from '../mutation-inputs.js';
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
  mutationFormErrorIdExpression,
  mutationFormErrorProps,
  renderAttributeWithName,
  staticStringAttributeValue,
  writerConflictDiagnostic,
} from './server-emit-shared.js';

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

  for (const element of model.jsxElements) {
    if (element.tag !== 'FieldError' && element.tag !== 'FormError') continue;

    const form = enclosingEnhancedMutationForm(model, element);
    if (!form) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> must be rendered inside an enhanced mutation form`,
        ),
      );
      continue;
    }

    const binding = enhancedMutationFormBinding(form);
    if (!binding) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> must be rendered inside a form with mutation={...} or mutationFormAttributes(...)`,
        ),
      );
      continue;
    }

    const slotsParam = componentRenderSlotsParam(model);
    const slotName = componentMutationSlotName(model, binding.localName);
    if (!slotName) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          element.openingTagNameStart,
          element.openingTagNameEnd - element.openingTagNameStart,
          `<${element.tag}> could not resolve the component-local mutation slot for ${binding.localName}`,
        ),
      );
      continue;
    }

    if (element.tag === 'FieldError') {
      diagnostics.push(...fieldErrorDiagnostics(model, element, binding.localName, options));
    }
    if (!slotsParam) continue;

    const lowered = lowerMutationFormErrorElement(model, element, form, slotName, slotsParam.name);
    replacements.push(...lowered.replacements);
  }

  return { diagnostics, replacements };
}

export function mutationFormExplainFacts(
  model: ComponentModuleModel,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): CoreGraph.MutationFormExplain[] {
  const forms: CoreGraph.MutationFormExplain[] = [];

  for (const form of model.jsxElements) {
    if (form.tag !== 'form') continue;
    const binding = enhancedMutationFormBinding(form);
    if (!binding) continue;

    const mutationKey = localMutationKey(model, binding.localName, options.registryFacts);
    const mutationInput = mutationInputFactForForm(model, binding.localName, options);
    if (!mutationKey && !mutationInput) continue;

    const slot = componentMutationSlotName(model, binding.localName) ?? binding.localName;
    const fieldErrors = mutationFormFieldErrorFacts(model, form, slot);
    const formErrors = mutationFormErrorFacts(model, form);

    forms.push({
      ...(fieldErrors.length === 0 ? {} : { fieldErrors }),
      ...(mutationInput === null
        ? {}
        : { fields: mutationInput.fields.map((field) => field.name) }),
      ...(formErrors.length === 0 ? {} : { formErrors }),
      mutation: mutationInput?.key ?? mutationKey ?? binding.localName,
      slot,
    });
  }

  return forms;
}

function mutationFormFieldErrorFacts(
  model: ComponentModuleModel,
  form: JsxElementModel,
  slot: string,
): CoreGraph.MutationFormFieldErrorExplain[] {
  return model.jsxElements
    .filter(
      (element) =>
        element.tag === 'FieldError' && enclosingEnhancedMutationForm(model, element) === form,
    )
    .flatMap((element) => {
      const name = staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'name'),
      );
      if (!name) return [];
      const authoredId = staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'id'),
      );
      const generatedId = mutationFormErrorIdExpression(form, slot, name).source;
      const id = authoredId ?? generatedId.replace(/^"|"$/g, '');

      return [{ id, name }];
    });
}

function mutationFormErrorFacts(
  model: ComponentModuleModel,
  form: JsxElementModel,
): CoreGraph.MutationFormErrorExplain[] {
  return model.jsxElements
    .filter(
      (element) =>
        element.tag === 'FormError' && enclosingEnhancedMutationForm(model, element) === form,
    )
    .map((element) => {
      const code = staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'code'),
      );
      return code ? { code } : {};
    });
}

function fieldErrorDiagnostics(
  model: ComponentModuleModel,
  element: JsxElementModel,
  localName: string,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): CompilerDiagnostic[] {
  const nameAttribute = element.attributes.find((attribute) => attribute.name === 'name');
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

  const fieldNames = new Set(mutation.fields.map((field) => field.name));
  if (fieldNames.has(name)) return [];

  return [
    formFieldDiagnostic(
      options,
      nameAttribute.start,
      nameAttribute.end - nameAttribute.start,
      `unknown field "${name}" for mutation "${mutation.key}". Expected fields: ${[
        ...fieldNames,
      ].join(', ')}`,
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
    const name = staticStringAttributeValue(
      element.attributes.find((attribute) => attribute.name === 'name'),
    );
    const id = staticStringAttributeValue(
      element.attributes.find((attribute) => attribute.name === 'id'),
    );
    if (name) {
      const errorId = id
        ? { expression: JSON.stringify(id), source: JSON.stringify(id) }
        : mutationFormErrorIdExpression(form, localName, name);
      replacements.push(...fieldControlDescribedByReplacements(model, form, name, errorId));
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
  return formControlElements(model, form, name).flatMap((control) => {
    if (control.attributes.some((attribute) => attribute.name === 'aria-describedby')) return [];
    const position = openingTagAttributePosition(control);
    return [
      {
        end: position,
        replacement: ` aria-describedby=${errorId.source}`,
        start: position,
      },
    ];
  });
}

function formControlElements(
  model: ComponentModuleModel,
  form: JsxElementModel,
  name: string,
): JsxElementModel[] {
  const formEnd = form.selfClosing ? form.end : form.closingStart;
  return model.jsxElements.filter((element) => {
    if (!['input', 'select', 'textarea'].includes(element.tag)) return false;
    if (element.start < form.openingEnd || element.end > formEnd) return false;
    if (element.attributes.some((attribute) => attribute.name === 'disabled')) return false;
    const type = staticStringAttributeValue(
      element.attributes.find((attribute) => attribute.name === 'type'),
    )?.toLowerCase();
    if (element.tag === 'input' && type === 'hidden') return false;
    return (
      staticStringAttributeValue(
        element.attributes.find((attribute) => attribute.name === 'name'),
      ) === name
    );
  });
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

  for (const element of model.jsxElements) {
    const repeatableDiagnostic = repeatableMutationFormDiagnostic(model, element, options);
    if (repeatableDiagnostic) {
      diagnostics.push(repeatableDiagnostic);
      continue;
    }

    if (options) diagnostics.push(...mutationFormFieldDiagnostics(model, element, options));

    const lowering = enhancedMutationFormLowering(model, element, options?.registryFacts);
    if (!lowering) continue;

    replacements.push(...lowering.replacements);
    needsCsrfImport ||= lowering.importsMutationCsrfField;
    outputContexts.push(...lowering.outputContexts);
    if (options) {
      diagnostics.push(
        ...lowering.conflicts.map((conflict) =>
          writerConflictDiagnostic(
            options,
            conflict.attribute,
            conflict.attribute.name,
            'author JSX',
            'typed mutation form lowering',
          ),
        ),
      );
    }
  }

  if (needsCsrfImport && options && !importsMutationCsrfField(model)) {
    const start = compilerHelperImportInsertionOffset(options.source);
    replacements.push({
      end: start,
      // SPEC.md §10.3:1063/1065: also import renderMutationIdemField so each
      // emitted form body includes a per-submit idempotency token alongside CSRF.
      replacement:
        "import { renderMutationCsrfField as __kovoRenderMutationCsrfField, renderMutationIdemField as __kovoRenderMutationIdemField } from '@kovojs/server/internal/csrf';\n",
      start,
    });
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

  for (const element of model.jsxElements) {
    const streamText = element.attributes.find((attribute) => attribute.name === 'streamText');
    const residual = element.attributes.find((attribute) => attribute.name === 'data-stream-text');

    if (streamText && residual && options) {
      diagnostics.push(
        writerConflictDiagnostic(
          options,
          residual,
          'data-stream-text',
          'author JSX',
          'stream text target lowering',
        ),
      );
    }

    const targetAttribute = streamText ?? residual;
    if (!targetAttribute) continue;

    const literalTarget = staticStringAttributeValue(targetAttribute);
    if (options && literalTarget !== null && !isValidStreamTextTarget(literalTarget)) {
      diagnostics.push(streamTextTargetDiagnostic(options, targetAttribute, literalTarget));
    }

    if (streamText) {
      replacements.push({
        end: streamText.end,
        replacement: renderAttributeWithName('data-stream-text', streamText),
        start: streamText.start,
      });
      outputContexts.push(
        formLoweringOutputContext(
          'data-stream-text',
          attributeValueExpression(streamText),
          'stream text target lowering',
        ),
      );
    }
  }

  return { diagnostics, outputContexts, replacements };
}

function isValidStreamTextTarget(target: string): boolean {
  return /^[A-Za-z][A-Za-z0-9-]*:[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(target);
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
  const jsxImportSource = /^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/.exec(source);
  return jsxImportSource?.[0].length ?? 0;
}

function repeatableMutationFormDiagnostic(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string } | undefined,
): CompilerDiagnostic | null {
  if (!options || element.tag !== 'form' || !element.repeatable) return null;
  if (element.attributes.some((attribute) => attribute.name === 'key')) return null;

  const binding = enhancedMutationFormBinding(element);
  if (!binding) return null;
  if (!localMutationKey(model, binding.localName, options.registryFacts)) {
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

  const controls = successfulFormControls(model, element, options);
  const fieldNames = new Set(mutation.fields.map((field) => field.name));
  const controlNames = new Set(controls.map((control) => control.name));
  const diagnostics: CompilerDiagnostic[] = controls.flatMap((control) => control.diagnostics);

  for (const control of controls) {
    if (!control.name) continue;
    if (fieldNames.has(control.name)) continue;
    diagnostics.push(
      formFieldDiagnostic(
        options,
        control.start,
        control.length,
        `unknown field "${control.name}" for mutation "${mutation.key}". Expected fields: ${[
          ...fieldNames,
        ].join(', ')}`,
      ),
    );
  }

  for (const field of mutation.fields) {
    if (!field.required || controlNames.has(field.name)) continue;
    diagnostics.push(
      formFieldDiagnostic(
        options,
        binding.start,
        binding.end - binding.start,
        `missing required field "${field.name}" for mutation "${mutation.key}". Expected fields: ${[
          ...fieldNames,
        ].join(', ')}`,
      ),
    );
  }

  return diagnostics;
}

function mutationInputFactForForm(
  model: ComponentModuleModel,
  localName: string,
  options: { fileName: string; registryFacts?: RegistryFacts; source: string },
): MutationInputFact | null {
  const localMutation = mutationInputFactsFromSource(options.fileName, options.source).get(
    localName,
  );
  if (localMutation) return localMutation;

  const mutationKey = localMutationKey(model, localName, options.registryFacts);
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
  const formId = staticStringAttributeValue(
    form.attributes.find((attribute) => attribute.name === 'id'),
  );
  const controls: {
    diagnostics: readonly CompilerDiagnostic[];
    length: number;
    name: string;
    start: number;
  }[] = [];

  for (const element of model.jsxElements) {
    if (element === form) continue;
    if (!['button', 'input', 'select', 'textarea'].includes(element.tag)) continue;
    if (element.attributes.some((attribute) => attribute.name === 'disabled')) continue;

    const descendant = element.start >= form.openingEnd && element.end <= formEnd;
    const externalFormAttribute = element.attributes.find((attribute) => attribute.name === 'form');
    const externalForm = staticStringAttributeValue(externalFormAttribute);
    if (!descendant && (!formId || externalForm !== formId)) continue;

    const nameAttribute = element.attributes.find((attribute) => attribute.name === 'name');
    const diagnostics: CompilerDiagnostic[] = [];
    if (!descendant || externalFormAttribute) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          (externalFormAttribute ?? element).start,
          (externalFormAttribute ?? element).end - (externalFormAttribute ?? element).start,
          'external form-associated controls are not supported for enhanced mutation field validation; keep controls inside the submitted form',
        ),
      );
    }

    const name = staticStringAttributeValue(nameAttribute);
    if (!nameAttribute) continue;
    if (!name) {
      diagnostics.push(
        formFieldDiagnostic(
          options,
          nameAttribute.start,
          nameAttribute.end - nameAttribute.start,
          'dynamic field names are not supported for enhanced mutation field validation; use a literal name from the mutation input schema',
        ),
      );
      controls.push({
        diagnostics,
        length: nameAttribute.end - nameAttribute.start,
        name: '',
        start: nameAttribute.start,
      });
      continue;
    }

    diagnostics.push(...unsupportedControlDiagnostics(element, name, nameAttribute, options));

    controls.push({
      diagnostics,
      length: nameAttribute.end - nameAttribute.start,
      name,
      start: nameAttribute.start,
    });
  }

  const counts = new Map<string, number>();
  for (const control of controls) {
    if (!control.name) continue;
    counts.set(control.name, (counts.get(control.name) ?? 0) + 1);
  }

  return controls.map((control) => {
    if (!control.name || (counts.get(control.name) ?? 0) <= 1) return control;
    return {
      ...control,
      diagnostics: [
        ...control.diagnostics,
        formFieldDiagnostic(
          options,
          control.start,
          control.length,
          `repeated field "${control.name}" is not supported for enhanced mutation field validation; declare one control per mutation input field`,
        ),
      ],
    };
  });
}

function unsupportedControlDiagnostics(
  element: JsxElementModel,
  name: string,
  nameAttribute: JsxAttributeModel,
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const type = staticStringAttributeValue(
    element.attributes.find((attribute) => attribute.name === 'type'),
  )?.toLowerCase();

  if (/[.[\]]/.test(name)) {
    diagnostics.push(
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `nested field path "${name}" is not supported for enhanced mutation field validation; use a flat mutation input field name`,
      ),
    );
  }

  if (element.tag === 'input' && type === 'file') {
    diagnostics.push(
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `file input field "${name}" is not supported for enhanced mutation field validation`,
      ),
    );
  }

  if (element.tag === 'input' && (type === 'checkbox' || type === 'radio')) {
    diagnostics.push(
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `${type} field "${name}" is not supported for enhanced mutation field validation; use a single scalar input or a later multivalue form primitive`,
      ),
    );
  }

  if (
    element.tag === 'select' &&
    element.attributes.some((attribute) => attribute.name === 'multiple')
  ) {
    diagnostics.push(
      formFieldDiagnostic(
        options,
        nameAttribute.start,
        nameAttribute.end - nameAttribute.start,
        `multiple select field "${name}" is not supported for enhanced mutation field validation; use a single-value select or a later multivalue form primitive`,
      ),
    );
  }

  return diagnostics;
}
