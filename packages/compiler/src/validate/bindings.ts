import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { collectDataBindListStamps } from '../analyze/query-updates.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerCreateSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import { dedupeBy } from '../shared.js';
import {
  callExpressions,
  componentModelForSourceSpan,
  componentStateReturnObjectModel,
  jsxElements,
  soleJsxExpressionChild,
  type ComponentModel,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import {
  componentQueryShapes,
  isRelativeBindingPath,
  knownQueryNames,
  listItemShapeAtBindingPath,
  parseBindingPath,
  queryNameFromPath,
  queryPathUsesKnownQuery,
  relativeBindingPath,
  validateListBindingInQueryShapes,
  validatePathInQueryShapes,
  validatePathInShape,
  type PathShapeValidation,
} from '../analyze/query-shapes.js';
import type { CompileComponentOptions, QueryShape, QueryTemplateStampFact } from '../types.js';

interface DataBindAttribute {
  index: number;
  length: number;
  name: string;
  path: string;
  query: string | null;
  relativeReadPath: string | null;
}

export function validateDataBindings(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);

  const listStamps = collectDataBindListStamps(model);
  const listBindings = dataBindListAttributes(model);
  const bindingAttributes = dataBindAttributes(model);
  const output: CompilerDiagnostic[] = [];
  const bindings = compilerSnapshotDenseArray(
    bindingAttributes,
    'Compiler binding validation attributes',
  );
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index]!;
    if (queryShapes !== null && binding.query !== null && binding.query !== 'state') {
      const result = validatePathInQueryShapes(binding.path, queryShapes);
      if (!result.exists) {
        compilerArrayAppend(
          output,
          diagnostics.at('KV302', { start: binding.index, length: binding.length }, binding.path),
          'Compiler binding diagnostics',
        );
      } else if (result.nullableTraversal) {
        compilerArrayAppend(
          output,
          kv227Diagnostic(diagnostics, binding, result.nullableTraversal),
          'Compiler binding diagnostics',
        );
      }
    }

    if (binding.query === 'state' && !validateStateBindingPath(binding, model).exists) {
      compilerArrayAppend(
        output,
        diagnostics.at('KV302', { start: binding.index, length: binding.length }, binding.path),
        'Compiler state binding diagnostics',
      );
    }
  }

  if (queryShapes !== null) {
    const stamps = compilerSnapshotDenseArray(
      listStamps,
      'Compiler binding validation list stamps',
    );
    for (let index = 0; index < stamps.length; index += 1) {
      const stamp = stamps[index]!;
      const binding = findBindingForPath(listBindings, stamp.list);
      const result = validateListStampInQueryShapes(stamp, queryShapes);
      if (!result.exists) {
        compilerArrayAppend(
          output,
          diagnostics.at('KV302', { start: binding?.index, length: binding?.length }, stamp.list),
          'Compiler list binding diagnostics',
        );
      } else if (result.nullableTraversal && binding) {
        compilerArrayAppend(
          output,
          kv227Diagnostic(diagnostics, binding, result.nullableTraversal),
          'Compiler list binding diagnostics',
        );
      }
    }

    appendAll(
      output,
      nullableItemBindingDiagnostics(
        diagnostics,
        model,
        bindingAttributes,
        listStamps,
        queryShapes,
      ),
      'Compiler nullable item binding diagnostics',
    );
  }

  return output;
}

export function validateStampExpressionDrift(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const knownQueries = knownQueryNames(model, options);
  const output: CompilerDiagnostic[] = [];
  const stamps = compilerSnapshotDenseArray(
    bindingExpressionStamps(model),
    'Compiler binding-expression stamps',
  );
  for (let index = 0; index < stamps.length; index += 1) {
    const stamp = stamps[index]!;
    if (
      !queryPathUsesKnownQuery(stamp.binding, knownQueries) ||
      !queryPathUsesKnownQuery(stamp.expression, knownQueries)
    ) {
      continue;
    }
    compilerArrayAppend(
      output,
      diagnostics.at(
        stamp.binding === stamp.expression ? 'KV223' : 'KV222',
        { start: stamp.index, length: stamp.length },
        `data-bind="${stamp.binding}" wraps {${stamp.expression}}`,
      ),
      'Compiler binding-expression diagnostics',
    );
  }
  return output;
}

function bindingExpressionStamps(
  model: ComponentModuleModel,
): Array<{ binding: string; expression: string; index: number; length: number }> {
  const output: Array<{ binding: string; expression: string; index: number; length: number }> = [];
  const elements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler binding-expression elements',
  );
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    const attribute = findAttribute(element, 'data-bind');
    const binding = attribute?.value;
    if (!attribute || !binding || element.selfClosing) continue;

    const expression = soleJsxExpressionChild(element, model)?.solePropertyAccessPath ?? null;
    if (expression) {
      compilerArrayAppend(
        output,
        { binding, expression, index: attribute.start, length: attribute.end - attribute.start },
        'Compiler binding-expression stamps',
      );
    }
  }
  return output;
}

function dataBindAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  const output: DataBindAttribute[] = [];
  const attributes = compilerSnapshotDenseArray(
    jsxAttributes(model),
    'Compiler data-bind attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (
      !isBindingAttribute(attribute.name) ||
      attribute.value === undefined ||
      attribute.value === ''
    ) {
      continue;
    }
    compilerArrayAppend(
      output,
      dataBindAttributeFact(attribute.name, attribute.value, attribute),
      'Compiler data-bind attributes',
    );
  }
  return output;
}

function dataBindListAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  const output: DataBindAttribute[] = [];
  const attributes = compilerSnapshotDenseArray(
    jsxAttributes(model),
    'Compiler data-bind-list attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (
      attribute.name !== 'data-bind-list' ||
      attribute.value === undefined ||
      attribute.value === ''
    ) {
      continue;
    }
    compilerArrayAppend(
      output,
      dataBindAttributeFact(attribute.name, attribute.value, attribute),
      'Compiler data-bind-list attributes',
    );
  }
  return output;
}

function dataBindAttributeFact(
  name: string,
  path: string,
  attribute: { end: number; start: number },
): DataBindAttribute {
  return {
    index: attribute.start,
    length: attribute.end - attribute.start,
    name,
    path,
    query: isRelativeBindingPath(path) ? null : queryNameFromPath(path),
    relativeReadPath: isRelativeBindingPath(path) ? relativeBindingPath(path) : null,
  };
}

function validateListStampInQueryShapes(
  stamp: QueryTemplateStampFact,
  queryShapes: Record<string, QueryShape>,
): ReturnType<typeof validateListBindingInQueryShapes> {
  const itemBindingPaths: string[] = [];
  const placeholders = compilerSnapshotDenseArray(
    stamp.itemBindingPlaceholders ?? [],
    'Compiler list-stamp item placeholders',
  );
  for (let index = 0; index < placeholders.length; index += 1) {
    compilerArrayAppend(
      itemBindingPaths,
      placeholders[index]!.path,
      'Compiler list-stamp item binding paths',
    );
  }
  return validateListBindingInQueryShapes(stamp.list, stamp.key, itemBindingPaths, queryShapes);
}

function validateStateBindingPath(
  binding: DataBindAttribute,
  model: ComponentModuleModel,
): PathShapeValidation {
  const { path } = binding;
  const segments = parseBindingPath(path);
  const root = segments[0];
  const firstSegment = segments[1];
  if (root?.name !== 'state') return { exists: true };

  const bindingComponent = componentModelForSourceSpan(model, {
    start: binding.index,
    end: binding.index + binding.length,
  });
  const stateObject = stateReturnObjectForBindingComponent(model, bindingComponent);
  const allowedRoots = compilerCreateSet<string>();
  let hasAllowedRoot = false;
  const entries = compilerSnapshotDenseArray(
    stateObject?.entries ?? [],
    'Compiler state binding entries',
  );
  for (let index = 0; index < entries.length; index += 1) {
    compilerSetAdd(allowedRoots, entries[index]!.key);
    hasAllowedRoot = true;
  }
  const derives = compilerSnapshotDenseArray(
    exportedStateDeriveNames(model),
    'Compiler exported state derive names',
  );
  for (let index = 0; index < derives.length; index += 1) {
    compilerSetAdd(allowedRoots, derives[index]!);
    hasAllowedRoot = true;
  }
  if (firstSegment === undefined) return { exists: hasAllowedRoot };

  return { exists: compilerSetHas(allowedRoots, firstSegment.name) };
}

function stateReturnObjectForBindingComponent(
  model: ComponentModuleModel,
  component: ComponentModel | null,
): ReturnType<typeof componentStateReturnObjectModel> {
  return component?.stateReturnObject ?? componentStateReturnObjectModel(model);
}

function exportedStateDeriveNames(model: ComponentModuleModel): string[] {
  const names: string[] = [];
  const calls = compilerSnapshotDenseArray(callExpressions(model), 'Compiler state derive calls');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.name !== 'derive' || call.exportedConstName === undefined) continue;
    const firstArgument = compilerOwnDataValue(
      call.argumentStringLiteralArrayValues,
      0,
      'Compiler state derive argument arrays',
    );
    if (!compilerArrayIsArray(firstArgument)) continue;
    const firstValue = compilerOwnDataValue(
      firstArgument,
      0,
      'Compiler state derive argument values',
    );
    if (firstValue !== 'state') continue;
    compilerArrayAppend(names, call.exportedConstName, 'Compiler exported state derive names');
  }
  return names;
}

function nullableItemBindingDiagnostics(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  bindingAttributes: readonly DataBindAttribute[],
  listStamps: readonly QueryTemplateStampFact[],
  queryShapes: Record<string, QueryShape>,
): CompilerDiagnostic[] {
  const elements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler nullable item elements',
  );
  const found: CompilerDiagnostic[] = [];
  const stamps = compilerSnapshotDenseArray(listStamps, 'Compiler nullable item list stamps');
  const bindings = compilerSnapshotDenseArray(
    bindingAttributes,
    'Compiler nullable item binding attributes',
  );

  for (let stampIndex = 0; stampIndex < stamps.length; stampIndex += 1) {
    const stamp = stamps[stampIndex]!;
    const itemShape = listItemShapeAtBindingPath(stamp.list, queryShapes);
    if (itemShape === undefined) continue;

    for (let containerIndex = 0; containerIndex < elements.length; containerIndex += 1) {
      const container = elements[containerIndex]!;
      if (
        jsxStaticAttributeValue(container, 'data-bind-list') !== stamp.list ||
        jsxStaticAttributeValue(container, 'kovo-key') !== stamp.key
      ) {
        continue;
      }
      for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
        const binding = bindings[bindingIndex]!;
        if (binding.relativeReadPath === null) continue;
        const element = findElementForBinding(elements, binding);
        if (!element || !isWithinElement(element, container)) continue;

        const result = validatePathInShape(
          itemShape,
          parseBindingPath(binding.relativeReadPath ?? ''),
        );
        if (result.exists && result.nullableTraversal) {
          compilerArrayAppend(
            found,
            kv227Diagnostic(diagnostics, binding, result.nullableTraversal),
            'Compiler nullable item binding diagnostics',
          );
        }
      }
    }
  }

  return dedupeBy(
    found,
    (diagnostic) =>
      `${diagnostic.code}:${diagnostic.fileName}:${diagnostic.start?.line}:${diagnostic.start?.column}`,
  );
}

function kv227Diagnostic(
  diagnostics: DiagnosticFactory,
  binding: DataBindAttribute,
  traversal: { segment: string },
): CompilerDiagnostic {
  return {
    ...diagnostics.at(
      'KV227',
      { start: binding.index, length: binding.length },
      `${binding.path} (segment: ${traversal.segment})`,
    ),
    help: diagnosticDefinitions.KV227.help,
  };
}

function jsxAttributes(model: ComponentModuleModel) {
  const attributes: ReturnType<typeof jsxElements>[number]['attributes'][number][] = [];
  const elements = compilerSnapshotDenseArray(jsxElements(model), 'Compiler JSX elements');
  for (let index = 0; index < elements.length; index += 1) {
    appendAll(attributes, elements[index]!.attributes, 'Compiler JSX attributes');
  }
  return attributes;
}

function jsxStaticAttributeValue(element: JsxElementModel, name: string): string | undefined {
  return findAttribute(element, name)?.value;
}

function isWithinElement(candidate: JsxElementModel, container: JsxElementModel): boolean {
  return candidate.start > container.start && candidate.end < container.end;
}

function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || compilerStringStartsWith(name, 'data-bind:');
}

function findBindingForPath(
  bindings: readonly DataBindAttribute[],
  path: string,
): DataBindAttribute | undefined {
  const snapshot = compilerSnapshotDenseArray(bindings, 'Compiler binding path lookup');
  for (let index = 0; index < snapshot.length; index += 1) {
    if (snapshot[index]!.path === path) return snapshot[index]!;
  }
  return undefined;
}

function findAttribute(
  element: JsxElementModel,
  name: string,
): JsxElementModel['attributes'][number] | undefined {
  const attributes = compilerSnapshotDenseArray(
    element.attributes,
    'Compiler JSX attribute lookup',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    if (attributes[index]!.name === name) return attributes[index]!;
  }
  return undefined;
}

function findElementForBinding(
  elements: readonly JsxElementModel[],
  binding: DataBindAttribute,
): JsxElementModel | undefined {
  const snapshot = compilerSnapshotDenseArray(elements, 'Compiler binding element lookup');
  for (let index = 0; index < snapshot.length; index += 1) {
    const element = snapshot[index]!;
    const attributes = compilerSnapshotDenseArray(
      element.attributes,
      'Compiler binding element attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex]!;
      if (attribute.start === binding.index && attribute.end === binding.index + binding.length) {
        return element;
      }
    }
  }
  return undefined;
}

function appendAll<Value>(target: Value[], values: readonly Value[], label: string): void {
  const snapshot = compilerSnapshotDenseArray(values, label);
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, label);
  }
}
