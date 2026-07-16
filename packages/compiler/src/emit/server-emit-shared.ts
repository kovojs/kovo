import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerCreateSet,
  compilerJsonStringify,
  compilerMapGet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringReplaceAll,
  compilerStringStartsWith,
  compilerStringToLowerCase,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  outputContextForAttribute,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import type { ComponentModuleModel, JsxAttributeModel, JsxElementModel } from '../scan/parse.js';
import { componentOptionObjectEntries, componentRenderSlotsParam } from '../scan/parse.js';
import { mutationInputFactsFromSource } from '../scan/mutation-inputs.js';
import { deriveMutationKey } from '../mutation-names.js';
import {
  enhancedMutationFormBinding,
  isIntrinsicHtmlElement,
} from '../mutation-form-provenance.js';
import { escapeAttribute, kebabCase, type SourceReplacement } from '../shared.js';
import type { MutationInputFieldFact, RegistryFacts } from '../types.js';

function serverEmitAttribute(
  element: JsxElementModel,
  name: string,
): JsxAttributeModel | undefined {
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Server emit JSX attributes');
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

function joinServerEmitStrings(values: readonly string[], separator: string): string {
  let output = '';
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) output += separator;
    output += values[index]!;
  }
  return output;
}

function serverEmitJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}

function serverEmitStringSet(values: readonly string[]): ReadonlySet<string> {
  const set = compilerCreateSet<string>();
  const snapshot = compilerSnapshotDenseArray(values, 'Server emit string set');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerSetAdd(set, snapshot[index]!);
  }
  return set;
}

export function componentMutationSlotName(
  model: ComponentModuleModel,
  mutationLocalName: string,
): string | null {
  const entries = compilerSnapshotDenseArray(
    componentOptionObjectEntries(model, 'mutations'),
    'Component mutation slots',
  );
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]!.key === mutationLocalName) return entries[index]!.key;
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]!.value === mutationLocalName) return entries[index]!.key;
  }

  if (entries.length === 1) return entries[0]?.key ?? null;
  return mutationLocalName;
}

export function enclosingEnhancedMutationForm(
  model: ComponentModuleModel,
  child: JsxElementModel,
): JsxElementModel | null {
  const elements = compilerSnapshotDenseArray(model.jsxElements, 'Enclosing mutation forms');
  let form: JsxElementModel | null = null;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (
      isIntrinsicHtmlElement(element, 'form') &&
      child.start >= element.openingEnd &&
      child.end <= element.closingStart &&
      enhancedMutationFormBinding(element) !== null &&
      (form === null || element.start > form.start)
    ) {
      form = element;
    }
  }
  return form;
}

export function mutationFormErrorProps(
  element: JsxElementModel,
  form: JsxElementModel,
  localName: string,
  slotsParamName: string,
): string {
  const entries = [`"failure": ${slotsParamName}.forms.${localName}.failure`];
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Mutation error attributes');
  for (let index = 0; index < attributes.length; index += 1) {
    compilerArrayAppend(
      entries,
      jsxAttributeObjectEntry(attributes[index]!),
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  if (serverEmitAttribute(element, 'id') === undefined) {
    const name = staticStringAttributeValue(serverEmitAttribute(element, 'name'));
    if (name)
      compilerArrayAppend(
        entries,
        `"id": ${mutationFormErrorIdExpression(form, localName, name).expression}`,
        'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
      );
  }
  const children = jsxElementChildrenExpression(element);
  if (children)
    compilerArrayAppend(
      entries,
      `"children": ${children}`,
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  return `{ ${joinServerEmitStrings(entries, ', ')} }`;
}

export function jsxAttributeObjectEntry(attribute: JsxAttributeModel): string {
  const key = serverEmitJsonSource(attribute.name, 'JSX attribute name');
  if (attribute.value !== undefined)
    return `${key}: ${serverEmitJsonSource(attribute.value, 'JSX attribute value')}`;
  if (attribute.expression !== undefined) return `${key}: ${attribute.expression}`;
  const staticValue = attribute.expressionStaticValue;
  if (staticValue !== undefined)
    return `${key}: ${serverEmitJsonSource(staticValue, 'JSX static attribute value')}`;
  return `${key}: true`;
}

export function jsxElementChildrenExpression(element: JsxElementModel): string | null {
  if (element.selfClosing || !element.childBody) return null;
  const childSource = compilerStringTrim(element.childBody.source);
  if (!childSource) return null;
  if (!compilerRegExpTest(/[<{]/, childSource))
    return serverEmitJsonSource(childSource, 'JSX child text');
  return `<>${element.childBody.source}</>`;
}

export function mutationFormErrorIdExpression(
  form: JsxElementModel,
  localName: string,
  fieldName: string,
): { expression: string; source: string } {
  const base = `${kebabCase(localName)}-${fieldName}-error`;
  const keyAttribute = serverEmitAttribute(form, 'key');
  if (!keyAttribute) {
    const literal = serverEmitJsonSource(base, 'Mutation form error id');
    return { expression: literal, source: literal };
  }

  const key = staticAttributeScalar(keyAttribute);
  if (key !== null) {
    const literal = serverEmitJsonSource(`${base}-${key}`, 'Mutation form keyed error id');
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
  if (!isIntrinsicHtmlElement(element, 'form')) return null;

  const mutationAttribute = serverEmitAttribute(element, 'mutation');
  if (!mutationAttribute?.expressionBareIdentifierName) return null;

  const mutationKey = localMutationKey(
    model,
    mutationAttribute.expressionBareIdentifierName,
    options?.registryFacts,
    options?.fileName,
  );
  if (!mutationKey) return null;

  const fileFields = mutationInputFileFieldsForLocalName(
    model,
    mutationAttribute.expressionBareIdentifierName,
    options,
  );
  const multipart = fileFields.length > 0;
  const enctypeAttribute = serverEmitAttribute(element, 'enctype');
  const conflicts = compilerSnapshotDenseArray(
    enhancedMutationFormConflicts(element),
    'Enhanced mutation form conflicts',
  );
  if (
    multipart &&
    enctypeAttribute &&
    staticStringAttributeValue(enctypeAttribute) !== 'multipart/form-data'
  ) {
    compilerArrayAppend(
      conflicts,
      { attribute: enctypeAttribute },
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  if (conflicts.length > 0) {
    return {
      conflicts,
      generatedAttributeNames: serverEmitStringSet([]),
      importsMutationCsrfField: false,
      outputContexts: [],
      replacements: [],
      semanticAttributes: [],
    };
  }

  const methodAttribute = serverEmitAttribute(element, 'method');
  const keyAttribute = serverEmitAttribute(element, 'key');
  const streamAttribute = serverEmitAttribute(element, 'stream');
  const streaming = streamAttribute !== undefined;
  if (!keyAttribute && element.repeatable) return null;
  const generateEnctype = multipart && !enctypeAttribute;
  const preserveRuntimeMutation = !componentRenderSlotsParam(model);
  const targetBase = kebabCase(mutationAttribute.expressionBareIdentifierName);
  const generatedInMutationSlot: string[] = [];
  if (preserveRuntimeMutation) {
    compilerArrayAppend(
      generatedInMutationSlot,
      `mutation={${mutationAttribute.expressionBareIdentifierName}}`,
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  if (!methodAttribute)
    compilerArrayAppend(
      generatedInMutationSlot,
      'method="post"',
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  if (generateEnctype)
    compilerArrayAppend(
      generatedInMutationSlot,
      'enctype="multipart/form-data"',
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  compilerArrayAppend(
    generatedInMutationSlot,
    `action="${escapeAttribute(`/_m/${mutationKey}`)}"`,
    'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
  );
  compilerArrayAppend(
    generatedInMutationSlot,
    `data-mutation="${escapeAttribute(mutationKey)}"`,
    'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
  );
  if (streaming)
    compilerArrayAppend(
      generatedInMutationSlot,
      'data-mutation-stream="true"',
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  compilerArrayAppend(
    generatedInMutationSlot,
    submittedFormTargetAttribute(targetBase, keyAttribute),
    'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
  );
  const replacements: SourceReplacement[] = [
    {
      end: mutationAttribute.end,
      replacement: joinServerEmitStrings(generatedInMutationSlot, ' '),
      start: mutationAttribute.start,
    },
  ];
  if (streamAttribute) {
    compilerArrayAppend(
      replacements,
      {
        end: streamAttribute.end,
        replacement: '',
        start: streamAttribute.leadingStart,
      },
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  if (keyAttribute)
    compilerArrayAppend(
      replacements,
      submittedFormKeyReplacement(keyAttribute),
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  if (!preserveRuntimeMutation) {
    compilerArrayAppend(
      replacements,
      submittedFormCsrfReplacement(element, mutationAttribute.expressionBareIdentifierName),
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  const semanticAttributes: string[] = [];
  if (!methodAttribute)
    compilerArrayAppend(
      semanticAttributes,
      ' method="post"',
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  if (generateEnctype)
    compilerArrayAppend(
      semanticAttributes,
      ' enctype="multipart/form-data"',
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  compilerArrayAppend(
    semanticAttributes,
    ` action="${escapeAttribute(`/_m/${mutationKey}`)}"`,
    'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
  );
  compilerArrayAppend(
    semanticAttributes,
    ` data-mutation="${escapeAttribute(mutationKey)}"`,
    'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
  );
  if (streaming)
    compilerArrayAppend(
      semanticAttributes,
      ' data-mutation-stream="true"',
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  const generatedAttributeNameValues = ['action', 'data-mutation', 'data-mutation-stream'];
  if (generateEnctype)
    compilerArrayAppend(
      generatedAttributeNameValues,
      'enctype',
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  const generatedAttributeNameTail = [
    'key',
    'kovo-fragment-target',
    'kovo-key',
    'mutation',
    'stream',
  ];
  for (let index = 0; index < generatedAttributeNameTail.length; index += 1) {
    compilerArrayAppend(
      generatedAttributeNameValues,
      generatedAttributeNameTail[index]!,
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  if (!methodAttribute)
    compilerArrayAppend(
      generatedAttributeNameValues,
      'method',
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  const generatedAttributeNames = serverEmitStringSet(generatedAttributeNameValues);
  const outputContexts: GeneratedOutputWriteFact[] = [];
  if (!methodAttribute) {
    compilerArrayAppend(
      outputContexts,
      formLoweringOutputContext('method', 'post', 'typed mutation form lowering'),
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  if (generateEnctype) {
    compilerArrayAppend(
      outputContexts,
      formLoweringOutputContext(
        'enctype',
        'multipart/form-data',
        'typed mutation file form lowering',
      ),
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  compilerArrayAppend(
    outputContexts,
    formLoweringOutputContext('action', `/_m/${mutationKey}`, 'typed mutation form lowering'),
    'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
  );
  compilerArrayAppend(
    outputContexts,
    formLoweringOutputContext('data-mutation', mutationKey, 'typed mutation form lowering'),
    'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
  );
  if (streaming) {
    compilerArrayAppend(
      outputContexts,
      formLoweringOutputContext('data-mutation-stream', 'true', 'streaming mutation form lowering'),
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }
  compilerArrayAppend(
    outputContexts,
    formLoweringOutputContext(
      'kovo-fragment-target',
      submittedFormTargetExpression(targetBase, keyAttribute),
      'typed mutation form lowering',
    ),
    'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
  );
  if (keyAttribute) {
    compilerArrayAppend(
      outputContexts,
      formLoweringOutputContext(
        'kovo-key',
        attributeValueExpression(keyAttribute),
        'typed mutation form lowering',
      ),
      'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
    );
  }

  return {
    conflicts,
    generatedAttributeNames,
    importsMutationCsrfField: !preserveRuntimeMutation,
    outputContexts,
    replacements,
    semanticAttributes,
  };
}

export function mutationInputFileFieldsForLocalName(
  model: ComponentModuleModel,
  localName: string,
  options?: { fileName?: string; registryFacts?: RegistryFacts; source?: string },
): readonly string[] {
  const fields = compilerSnapshotDenseArray(
    mutationInputFieldsForLocalName(model, localName, options),
    'Mutation input fields',
  );
  const fileFields: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.coercion === 'file')
      compilerArrayAppend(
        fileFields,
        field.name,
        'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
      );
  }
  return fileFields;
}

function mutationInputFieldsForLocalName(
  model: ComponentModuleModel,
  localName: string,
  options?: { fileName?: string; registryFacts?: RegistryFacts; source?: string },
): readonly MutationInputFieldFact[] {
  if (options?.source && options.fileName) {
    const localMutation = compilerMapGet(
      mutationInputFactsFromSource(options.fileName, options.source),
      localName,
    );
    if (localMutation) return localMutation.fields;
  }

  const mutationKey = localMutationKey(model, localName, options?.registryFacts, options?.fileName);
  if (!mutationKey || options?.registryFacts?.mutationInputs === undefined) return [];
  const fields = compilerOwnDataValue(
    options.registryFacts.mutationInputs,
    mutationKey,
    'Registry mutation input fields',
  );
  return compilerArrayIsArray(fields) ? (fields as readonly MutationInputFieldFact[]) : [];
}

export function importsMutationCsrfField(model: ComponentModuleModel): boolean {
  // Compiler-emitted helper import de-dupe: this checks for the exact internal CSRF helper import
  // already present in lowered output, not a security decision about app-authored source.
  const imports = compilerSnapshotDenseArray(model.namedImports, 'Mutation CSRF imports');
  for (let index = 0; index < imports.length; index += 1) {
    const entry = imports[index]!;
    if (
      entry.moduleSpecifier === '@kovojs/server/internal/csrf' &&
      entry.importedName === 'renderMutationCsrfField'
    ) {
      return true;
    }
  }
  return false;
}

export function enhancedMutationFormConflicts(
  element: JsxElementModel,
): EnhancedMutationFormConflict[] {
  const names = serverEmitStringSet([
    'action',
    'data-mutation',
    'data-mutation-stream',
    'kovo-fragment-target',
    'kovo-key',
  ]);
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Mutation form conflicts');
  const conflicts: EnhancedMutationFormConflict[] = [];
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    const attributeName =
      element.intrinsicTagName === undefined
        ? attribute.name
        : compilerStringToLowerCase(attribute.name);
    if (compilerSetHas(names, attributeName))
      compilerArrayAppend(
        conflicts,
        { attribute },
        'Compiler packages/compiler/src/emit/server-emit-shared.ts collection',
      );
  }
  return conflicts;
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
  fileName?: string,
): string | null {
  const calls = compilerSnapshotDenseArray(model.calls, 'Mutation declaration calls');
  for (let index = 0; index < calls.length; index += 1) {
    const candidate = calls[index]!;
    if (
      candidate.name === 'mutation' &&
      candidate.exportedConstName === localName &&
      typeof candidate.argumentStaticValues[0] === 'string'
    ) {
      return candidate.argumentStaticValues[0] as string;
    }
  }

  for (let index = 0; index < calls.length; index += 1) {
    const candidate = calls[index]!;
    if (candidate.name !== 'mutation' || candidate.exportedConstName !== localName) continue;
    const args = compilerSnapshotDenseArray(candidate.arguments, 'Mutation call arguments');
    if (
      args.length === 1 &&
      compilerStringStartsWith(compilerRegExpReplace(/^\s+/, args[0]!, ''), '{') &&
      fileName
    ) {
      return deriveMutationKey(fileName, localName);
    }
  }

  const mutations = registryFacts?.mutations;
  if (mutations === undefined) return null;
  const keys = compilerObjectKeys(mutations);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const typeSource = compilerOwnDataValue(mutations, key, 'Registry mutation type');
    if (
      typeof typeSource === 'string' &&
      compilerStringTrim(typeSource) === `typeof ${localName}`
    ) {
      return key;
    }
  }
  return null;
}

export { enhancedMutationFormBinding };

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
  if (typeof staticValue === 'string') return staticValue;
  if (typeof staticValue === 'number')
    return serverEmitJsonSource(staticValue, 'Static numeric attribute');
  return null;
}

export function escapeTemplateLiteral(value: string): string {
  return compilerStringReplaceAll(
    compilerStringReplaceAll(compilerStringReplaceAll(value, '\\', '\\\\'), '`', '\\`'),
    '${',
    '\\${',
  );
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
