import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  outputContextForAttribute,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import type { ComponentModuleModel, JsxAttributeModel, JsxElementModel } from '../scan/parse.js';
import { componentOptionObjectEntries, componentRenderSlotsParam } from '../scan/parse.js';
import { mutationInputFactsFromSource } from '../scan/mutation-inputs.js';
import { escapeAttribute, kebabCase, type SourceReplacement } from '../shared.js';
import type { MutationInputFieldFact, RegistryFacts } from '../types.js';

export function componentMutationSlotName(
  model: ComponentModuleModel,
  mutationLocalName: string,
): string | null {
  const entries = componentOptionObjectEntries(model, 'mutations');
  const exact = entries.find((entry) => entry.key === mutationLocalName);
  if (exact) return exact.key;

  const valueMatch = entries.find((entry) => entry.value === mutationLocalName);
  if (valueMatch) return valueMatch.key;

  if (entries.length === 1) return entries[0]?.key ?? null;
  return mutationLocalName;
}

export function enclosingEnhancedMutationForm(
  model: ComponentModuleModel,
  child: JsxElementModel,
): JsxElementModel | null {
  const forms = model.jsxElements
    .filter(
      (element) =>
        element.tag === 'form' &&
        child.start >= element.openingEnd &&
        child.end <= element.closingStart &&
        enhancedMutationFormBinding(element),
    )
    .sort((left, right) => right.start - left.start);

  return forms[0] ?? null;
}

export function mutationFormErrorProps(
  element: JsxElementModel,
  form: JsxElementModel,
  localName: string,
  slotsParamName: string,
): string {
  const entries = [
    `"failure": ${slotsParamName}.forms.${localName}.failure`,
    ...element.attributes.map((attribute) => jsxAttributeObjectEntry(attribute)),
  ];
  if (!element.attributes.some((attribute) => attribute.name === 'id')) {
    const name = staticStringAttributeValue(
      element.attributes.find((attribute) => attribute.name === 'name'),
    );
    if (name)
      entries.push(`"id": ${mutationFormErrorIdExpression(form, localName, name).expression}`);
  }
  const children = jsxElementChildrenExpression(element);
  if (children) entries.push(`"children": ${children}`);
  return `{ ${entries.filter(Boolean).join(', ')} }`;
}

export function jsxAttributeObjectEntry(attribute: JsxAttributeModel): string {
  const key = JSON.stringify(attribute.name);
  if (attribute.value !== undefined) return `${key}: ${JSON.stringify(attribute.value)}`;
  if (attribute.expression !== undefined) return `${key}: ${attribute.expression}`;
  const staticValue = attribute.expressionStaticValue;
  if (staticValue !== undefined) return `${key}: ${JSON.stringify(staticValue)}`;
  return `${key}: true`;
}

export function jsxElementChildrenExpression(element: JsxElementModel): string | null {
  if (element.selfClosing || !element.childBody) return null;
  const childSource = element.childBody.source.trim();
  if (!childSource) return null;
  if (!/[<{]/.test(childSource)) return JSON.stringify(childSource);
  return `<>${element.childBody.source}</>`;
}

export function mutationFormErrorIdExpression(
  form: JsxElementModel,
  localName: string,
  fieldName: string,
): { expression: string; source: string } {
  const base = `${kebabCase(localName)}-${fieldName}-error`;
  const keyAttribute = form.attributes.find((attribute) => attribute.name === 'key');
  if (!keyAttribute) {
    const literal = JSON.stringify(base);
    return { expression: literal, source: literal };
  }

  const key = staticAttributeScalar(keyAttribute);
  if (key !== null) {
    const literal = JSON.stringify(`${base}-${key}`);
    return { expression: literal, source: literal };
  }

  const expression = `\`${escapeTemplateLiteral(base)}-\${${keyAttribute.expression ?? ''}}\``;
  return { expression, source: `{${expression}}` };
}

export interface EnhancedMutationFormConflict {
  attribute: JsxAttributeModel;
}

export interface EnhancedMutationFormLowering {
  conflicts: readonly EnhancedMutationFormConflict[];
  generatedAttributeNames: ReadonlySet<string>;
  importsMutationCsrfField: boolean;
  outputContexts: readonly GeneratedOutputWriteFact[];
  replacements: readonly SourceReplacement[];
  semanticAttributes: readonly string[];
}

export function enhancedMutationFormLowering(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options?: { fileName?: string; registryFacts?: RegistryFacts; source?: string },
): EnhancedMutationFormLowering | null {
  if (element.tag !== 'form') return null;

  const mutationAttribute = element.attributes.find((attribute) => attribute.name === 'mutation');
  if (!mutationAttribute?.expressionBareIdentifierName) return null;

  const mutationKey = localMutationKey(
    model,
    mutationAttribute.expressionBareIdentifierName,
    options?.registryFacts,
  );
  if (!mutationKey) return null;

  const fileFields = mutationInputFileFieldsForLocalName(
    model,
    mutationAttribute.expressionBareIdentifierName,
    options,
  );
  const multipart = fileFields.length > 0;
  const enctypeAttribute = element.attributes.find((attribute) => attribute.name === 'enctype');
  const enctypeConflict =
    multipart &&
    enctypeAttribute &&
    staticStringAttributeValue(enctypeAttribute) !== 'multipart/form-data'
      ? [{ attribute: enctypeAttribute }]
      : [];
  const conflicts = [...enhancedMutationFormConflicts(element), ...enctypeConflict];
  if (conflicts.length > 0) {
    return {
      conflicts,
      generatedAttributeNames: new Set(),
      importsMutationCsrfField: false,
      outputContexts: [],
      replacements: [],
      semanticAttributes: [],
    };
  }

  const methodAttribute = element.attributes.find((attribute) => attribute.name === 'method');
  const keyAttribute = element.attributes.find((attribute) => attribute.name === 'key');
  const streamAttribute = element.attributes.find((attribute) => attribute.name === 'stream');
  const streaming = streamAttribute !== undefined;
  if (!keyAttribute && element.repeatable) return null;
  const generateEnctype = multipart && !enctypeAttribute;
  const preserveRuntimeMutation = !componentRenderSlotsParam(model);
  const targetBase = kebabCase(mutationAttribute.expressionBareIdentifierName);
  const generatedInMutationSlot = [
    ...(preserveRuntimeMutation
      ? [`mutation={${mutationAttribute.expressionBareIdentifierName}}`]
      : []),
    ...(methodAttribute ? [] : ['method="post"']),
    ...(generateEnctype ? ['enctype="multipart/form-data"'] : []),
    `action="${escapeAttribute(`/_m/${mutationKey}`)}"`,
    `data-mutation="${escapeAttribute(mutationKey)}"`,
    ...(streaming ? ['data-mutation-stream="true"'] : []),
    submittedFormTargetAttribute(targetBase, keyAttribute),
  ];
  const replacements = [
    {
      end: mutationAttribute.end,
      replacement: generatedInMutationSlot.join(' '),
      start: mutationAttribute.start,
    },
    ...(streamAttribute
      ? [
          {
            end: streamAttribute.end,
            replacement: '',
            start: streamAttribute.leadingStart,
          },
        ]
      : []),
    ...(keyAttribute ? [submittedFormKeyReplacement(keyAttribute)] : []),
    ...(preserveRuntimeMutation
      ? []
      : [submittedFormCsrfReplacement(element, mutationAttribute.expressionBareIdentifierName)]),
  ];
  const semanticAttributes = [
    ...(methodAttribute ? [] : [' method="post"']),
    ...(generateEnctype ? [' enctype="multipart/form-data"'] : []),
    ` action="${escapeAttribute(`/_m/${mutationKey}`)}"`,
    ` data-mutation="${escapeAttribute(mutationKey)}"`,
    ...(streaming ? [' data-mutation-stream="true"'] : []),
  ];
  const generatedAttributeNames = new Set([
    'action',
    'data-mutation',
    'data-mutation-stream',
    ...(generateEnctype ? ['enctype'] : []),
    'key',
    'kovo-fragment-target',
    'kovo-key',
    'mutation',
    'stream',
    ...(methodAttribute ? [] : ['method']),
  ]);

  return {
    conflicts,
    generatedAttributeNames,
    importsMutationCsrfField: !preserveRuntimeMutation,
    outputContexts: [
      ...(methodAttribute
        ? []
        : [formLoweringOutputContext('method', 'post', 'typed mutation form lowering')]),
      ...(generateEnctype
        ? [
            formLoweringOutputContext(
              'enctype',
              'multipart/form-data',
              'typed mutation file form lowering',
            ),
          ]
        : []),
      formLoweringOutputContext('action', `/_m/${mutationKey}`, 'typed mutation form lowering'),
      formLoweringOutputContext('data-mutation', mutationKey, 'typed mutation form lowering'),
      ...(streaming
        ? [
            formLoweringOutputContext(
              'data-mutation-stream',
              'true',
              'streaming mutation form lowering',
            ),
          ]
        : []),
      formLoweringOutputContext(
        'kovo-fragment-target',
        submittedFormTargetExpression(targetBase, keyAttribute),
        'typed mutation form lowering',
      ),
      ...(keyAttribute
        ? [
            formLoweringOutputContext(
              'kovo-key',
              attributeValueExpression(keyAttribute),
              'typed mutation form lowering',
            ),
          ]
        : []),
    ],
    replacements,
    semanticAttributes,
  };
}

export function mutationInputFileFieldsForLocalName(
  model: ComponentModuleModel,
  localName: string,
  options?: { fileName?: string; registryFacts?: RegistryFacts; source?: string },
): readonly string[] {
  const fields = mutationInputFieldsForLocalName(model, localName, options);
  return fields.filter((field) => field.coercion === 'file').map((field) => field.name);
}

function mutationInputFieldsForLocalName(
  model: ComponentModuleModel,
  localName: string,
  options?: { fileName?: string; registryFacts?: RegistryFacts; source?: string },
): readonly MutationInputFieldFact[] {
  if (options?.source && options.fileName) {
    const localMutation = mutationInputFactsFromSource(options.fileName, options.source).get(
      localName,
    );
    if (localMutation) return localMutation.fields;
  }

  const mutationKey = localMutationKey(model, localName, options?.registryFacts);
  return mutationKey ? (options?.registryFacts?.mutationInputs?.[mutationKey] ?? []) : [];
}

export function importsMutationCsrfField(model: ComponentModuleModel): boolean {
  return model.namedImports.some(
    (entry) =>
      entry.moduleSpecifier === '@kovojs/server/internal/csrf' &&
      entry.importedName === 'renderMutationCsrfField',
  );
}

export function enhancedMutationFormConflicts(
  element: JsxElementModel,
): EnhancedMutationFormConflict[] {
  return element.attributes
    .filter((attribute) =>
      [
        'action',
        'data-mutation',
        'data-mutation-stream',
        'kovo-fragment-target',
        'kovo-key',
      ].includes(attribute.name),
    )
    .map((attribute) => ({ attribute }));
}

export function submittedFormCsrfReplacement(
  element: JsxElementModel,
  localName: string,
): SourceReplacement {
  const position = element.childBody
    ? element.childBody.offset + element.childBody.source.length
    : element.closingStart;
  // SPEC.md §10.3:1063/1065: emit both the CSRF token and a per-submit idem field
  // so the server replay store can deduplicate no-JS double-submits / Back-resubmits.
  return {
    end: position,
    replacement: `{__kovoRenderMutationCsrfField(${localName})}{__kovoRenderMutationIdemField()}`,
    start: position,
  };
}

export function localMutationKey(
  model: ComponentModuleModel,
  localName: string,
  registryFacts?: RegistryFacts,
): string | null {
  const call = model.calls.find(
    (candidate) =>
      candidate.name === 'mutation' &&
      candidate.exportedConstName === localName &&
      typeof candidate.argumentStaticValues[0] === 'string',
  );
  const key = call?.argumentStaticValues[0];
  if (typeof key === 'string') return key;

  const registryEntry = Object.entries(registryFacts?.mutations ?? {}).find(
    ([, typeSource]) => typeSource.trim() === `typeof ${localName}`,
  );
  return registryEntry?.[0] ?? null;
}

export function enhancedMutationFormBinding(
  element: JsxElementModel,
): { end: number; localName: string; start: number } | null {
  const mutationAttribute = element.attributes.find((attribute) => attribute.name === 'mutation');
  if (mutationAttribute?.expressionBareIdentifierName) {
    return {
      end: mutationAttribute.end,
      localName: mutationAttribute.expressionBareIdentifierName,
      start: mutationAttribute.start,
    };
  }

  const spread = element.spreadAttributes.find(
    (attribute) =>
      attribute.expressionCallName === 'mutationFormAttributes' &&
      attribute.expressionCallArgumentBareIdentifierName,
  );
  if (!spread?.expressionCallArgumentBareIdentifierName) return null;

  return {
    end: spread.end,
    localName: spread.expressionCallArgumentBareIdentifierName,
    start: spread.start,
  };
}

export function staticStringAttributeValue(
  attribute: JsxAttributeModel | undefined,
): string | null {
  if (!attribute) return null;
  if (attribute.value !== undefined) return attribute.value;
  if (typeof attribute.expressionStaticValue === 'string') return attribute.expressionStaticValue;
  return null;
}

export function submittedFormKeyReplacement(attribute: JsxAttributeModel): SourceReplacement {
  return {
    end: attribute.end,
    replacement: renderAttributeWithName('kovo-key', attribute),
    start: attribute.start,
  };
}

export function submittedFormTargetAttribute(
  base: string,
  keyAttribute: JsxAttributeModel | undefined,
): string {
  const expression = submittedFormTargetExpression(base, keyAttribute);
  if (!keyAttribute || keyAttribute.expression !== undefined) {
    return keyAttribute?.expression === undefined
      ? `kovo-fragment-target="${escapeAttribute(expression)}"`
      : `kovo-fragment-target={\`${escapeTemplateLiteral(base)}:\${${keyAttribute.expression}}\`}`;
  }

  return `kovo-fragment-target="${escapeAttribute(expression)}"`;
}

export function submittedFormTargetExpression(
  base: string,
  keyAttribute: JsxAttributeModel | undefined,
): string {
  if (!keyAttribute) return base;
  const key = staticAttributeScalar(keyAttribute);
  return key === null ? `${base}:\${${keyAttribute.expression ?? ''}}` : `${base}:${key}`;
}

export function renderAttributeWithName(name: string, attribute: JsxAttributeModel): string {
  if (attribute.value !== undefined) {
    return `${name}="${escapeAttribute(attribute.value)}"`;
  }
  if (attribute.expression !== undefined) {
    return `${name}={${attribute.expression}}`;
  }
  const staticValue = attribute.expressionStaticValue;
  if (
    staticValue !== undefined &&
    staticValue !== true &&
    staticValue !== false &&
    staticValue !== null
  ) {
    return `${name}="${escapeAttribute(staticAttributeScalar(attribute) ?? '')}"`;
  }
  return name;
}

export function attributeValueExpression(attribute: JsxAttributeModel): string {
  const staticValue = staticAttributeScalar(attribute);
  if (staticValue !== null) return staticValue;
  return attribute.expression ?? '';
}

export function staticAttributeScalar(attribute: JsxAttributeModel): string | null {
  if (attribute.value !== undefined) return attribute.value;
  const staticValue = attribute.expressionStaticValue;
  if (typeof staticValue === 'string' || typeof staticValue === 'number')
    return String(staticValue);
  return null;
}

export function escapeTemplateLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

export function formLoweringOutputContext(
  sink: string,
  expression: string,
  writer: GeneratedOutputWriteFact['writer'],
): GeneratedOutputWriteFact {
  return {
    context: outputContextForAttribute(sink),
    expression,
    sink,
    source: 'server-render',
    writer,
  };
}

export function writerConflictDiagnostic(
  options: { fileName: string; source: string },
  attribute: JsxAttributeModel,
  detail: string,
  firstWriter: string,
  secondWriter: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(
      options.fileName,
      'KV231',
      options.source,
      attribute.start,
      attribute.end - attribute.start,
    ),
    message: `${diagnosticDefinitions.KV231.message} ${detail} (writers: ${firstWriter}, ${secondWriter})`,
  };
}
