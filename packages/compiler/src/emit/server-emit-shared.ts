import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import {
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
import { escapeAttribute, kebabCase, type SourceReplacement } from '../shared.js';
import type { MutationInputFieldFact, RegistryFacts } from '../types.js';

function serverEmitAttribute(
  element: JsxElementModel,
  name: string,
): JsxAttributeModel | undefined {
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Server emit JSX attributes');
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.name === name) return attribute;
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
      element.tag === 'form' &&
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
    entries[entries.length] = jsxAttributeObjectEntry(attributes[index]!);
  }
  if (serverEmitAttribute(element, 'id') === undefined) {
    const name = staticStringAttributeValue(serverEmitAttribute(element, 'name'));
    if (name)
      entries[entries.length] =
        `"id": ${mutationFormErrorIdExpression(form, localName, name).expression}`;
  }
  const children = jsxElementChildrenExpression(element);
  if (children) entries[entries.length] = `"children": ${children}`;
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
  if (element.tag !== 'form') return null;

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
    conflicts[conflicts.length] = { attribute: enctypeAttribute };
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
    generatedInMutationSlot[generatedInMutationSlot.length] =
      `mutation={${mutationAttribute.expressionBareIdentifierName}}`;
  }
  if (!methodAttribute) generatedInMutationSlot[generatedInMutationSlot.length] = 'method="post"';
  if (generateEnctype)
    generatedInMutationSlot[generatedInMutationSlot.length] = 'enctype="multipart/form-data"';
  generatedInMutationSlot[generatedInMutationSlot.length] =
    `action="${escapeAttribute(`/_m/${mutationKey}`)}"`;
  generatedInMutationSlot[generatedInMutationSlot.length] =
    `data-mutation="${escapeAttribute(mutationKey)}"`;
  if (streaming)
    generatedInMutationSlot[generatedInMutationSlot.length] = 'data-mutation-stream="true"';
  generatedInMutationSlot[generatedInMutationSlot.length] = submittedFormTargetAttribute(
    targetBase,
    keyAttribute,
  );
  const replacements: SourceReplacement[] = [
    {
      end: mutationAttribute.end,
      replacement: joinServerEmitStrings(generatedInMutationSlot, ' '),
      start: mutationAttribute.start,
    },
  ];
  if (streamAttribute) {
    replacements[replacements.length] = {
      end: streamAttribute.end,
      replacement: '',
      start: streamAttribute.leadingStart,
    };
  }
  if (keyAttribute) replacements[replacements.length] = submittedFormKeyReplacement(keyAttribute);
  if (!preserveRuntimeMutation) {
    replacements[replacements.length] = submittedFormCsrfReplacement(
      element,
      mutationAttribute.expressionBareIdentifierName,
    );
  }
  const semanticAttributes: string[] = [];
  if (!methodAttribute) semanticAttributes[semanticAttributes.length] = ' method="post"';
  if (generateEnctype)
    semanticAttributes[semanticAttributes.length] = ' enctype="multipart/form-data"';
  semanticAttributes[semanticAttributes.length] =
    ` action="${escapeAttribute(`/_m/${mutationKey}`)}"`;
  semanticAttributes[semanticAttributes.length] =
    ` data-mutation="${escapeAttribute(mutationKey)}"`;
  if (streaming)
    semanticAttributes[semanticAttributes.length] = ' data-mutation-stream="true"';
  const generatedAttributeNameValues = [
    'action',
    'data-mutation',
    'data-mutation-stream',
  ];
  if (generateEnctype) generatedAttributeNameValues[generatedAttributeNameValues.length] = 'enctype';
  const generatedAttributeNameTail = [
    'key',
    'kovo-fragment-target',
    'kovo-key',
    'mutation',
    'stream',
  ];
  for (let index = 0; index < generatedAttributeNameTail.length; index += 1) {
    generatedAttributeNameValues[generatedAttributeNameValues.length] =
      generatedAttributeNameTail[index]!;
  }
  if (!methodAttribute) generatedAttributeNameValues[generatedAttributeNameValues.length] = 'method';
  const generatedAttributeNames = serverEmitStringSet(generatedAttributeNameValues);
  const outputContexts: GeneratedOutputWriteFact[] = [];
  if (!methodAttribute) {
    outputContexts[outputContexts.length] = formLoweringOutputContext(
      'method',
      'post',
      'typed mutation form lowering',
    );
  }
  if (generateEnctype) {
    outputContexts[outputContexts.length] = formLoweringOutputContext(
      'enctype',
      'multipart/form-data',
      'typed mutation file form lowering',
    );
  }
  outputContexts[outputContexts.length] = formLoweringOutputContext(
    'action',
    `/_m/${mutationKey}`,
    'typed mutation form lowering',
  );
  outputContexts[outputContexts.length] = formLoweringOutputContext(
    'data-mutation',
    mutationKey,
    'typed mutation form lowering',
  );
  if (streaming) {
    outputContexts[outputContexts.length] = formLoweringOutputContext(
      'data-mutation-stream',
      'true',
      'streaming mutation form lowering',
    );
  }
  outputContexts[outputContexts.length] = formLoweringOutputContext(
    'kovo-fragment-target',
    submittedFormTargetExpression(targetBase, keyAttribute),
    'typed mutation form lowering',
  );
  if (keyAttribute) {
    outputContexts[outputContexts.length] = formLoweringOutputContext(
      'kovo-key',
      attributeValueExpression(keyAttribute),
      'typed mutation form lowering',
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
    if (field.coercion === 'file') fileFields[fileFields.length] = field.name;
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
    if (compilerSetHas(names, attribute.name)) conflicts[conflicts.length] = { attribute };
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
    if (typeof typeSource === 'string' && compilerStringTrim(typeSource) === `typeof ${localName}`) {
      return key;
    }
  }
  return null;
}

export function enhancedMutationFormBinding(
  element: JsxElementModel,
): { end: number; localName: string; start: number } | null {
  const mutationAttribute = serverEmitAttribute(element, 'mutation');
  if (mutationAttribute?.expressionBareIdentifierName) {
    return {
      end: mutationAttribute.end,
      localName: mutationAttribute.expressionBareIdentifierName,
      start: mutationAttribute.start,
    };
  }

  const spreads = compilerSnapshotDenseArray(
    element.spreadAttributes,
    'Mutation form spread attributes',
  );
  let spread: (typeof spreads)[number] | undefined;
  for (let index = 0; index < spreads.length; index += 1) {
    const attribute = spreads[index]!;
    if (
      attribute.expressionCallImportedName === 'mutationFormAttributes' &&
      attribute.expressionCallModuleSpecifier === '@kovojs/server' &&
      attribute.expressionCallArgumentBareIdentifierName
    ) {
      spread = attribute;
      break;
    }
  }
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
