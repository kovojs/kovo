// Data-bind collection + data-bind-list template-stamp assembly (offset math).
// Extracted verbatim from `analyze/query-updates.ts` for the FN10 decomposition.
// SPEC.md §5.x query-update facts. Behavior-neutral: emitted bytes and the hidden
// non-enumerable `outputContext` channel are unchanged.
import { parseBindingPath } from './query-shapes.js';
import {
  compilerArrayAppend,
  compilerMapGet,
  compilerMapSet,
  compilerSnapshotDenseArray,
  compilerStringLocaleCompare,
  compilerStringSlice,
} from '../compiler-security-intrinsics.js';
import {
  dataBindAttributeFact,
  isBindingAttribute,
  isWithinElement,
  hasJsxAttribute,
  jsxAttributes,
  jsxStaticAttributeValue,
  withOutputContext,
  type DataBindAttribute,
} from './query-internal.js';
import {
  jsxElementChildBody,
  jsxElements,
  type ComponentModuleModel,
  type JsxElementChildBody,
  type JsxElementModel,
} from '../scan/parse.js';
import {
  outputContextForAttribute,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import type {
  BindingPathSegmentFact,
  QueryTemplateStampBindingPlaceholder,
  QueryTemplateStampFact,
} from '../types.js';

export function dataBindAttributes(model: ComponentModuleModel): DataBindAttribute[] {
  const output: DataBindAttribute[] = [];
  const attributes = compilerSnapshotDenseArray(
    jsxAttributes(model),
    'Compiler query data-bind attributes',
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
      {
        ...dataBindAttributeFact(attribute.name, attribute.value),
        end: attribute.end,
        start: attribute.start,
      },
      'Compiler query data-bind attributes',
    );
  }
  return output;
}

export function dataBindOutputContextFact(binding: DataBindAttribute): GeneratedOutputWriteFact {
  if (binding.name === 'data-bind') {
    return {
      context: 'text',
      expression: binding.path,
      sink: 'textContent',
      source: 'client-query',
      writer: 'query text binding',
    };
  }

  const attr = compilerStringSlice(binding.name, 'data-bind:'.length);
  return {
    context: outputContextForAttribute(attr),
    expression: binding.path,
    sink: attr,
    source: 'client-query',
    writer: 'query attribute binding',
  };
}

export function pushOutputContext(
  factsByQuery: Map<string, GeneratedOutputWriteFact[]>,
  query: string,
  fact: GeneratedOutputWriteFact,
): void {
  const facts = compilerMapGet(factsByQuery, query) ?? [];
  // The map and its arrays are compiler-owned locals for one plan assembly. Append through the
  // pinned intrinsic so a large set of bindings for one query stays linear instead of cloning the
  // entire descriptor-checked prefix for every fact (SPEC §5.2).
  compilerArrayAppend(facts, fact, 'Compiler query output contexts');
  compilerMapSet(factsByQuery, query, facts);
}

export function collectDataBindListStamps(model: ComponentModuleModel): QueryTemplateStampFact[] {
  const elements = compilerSnapshotDenseArray(
    jsxElements(model),
    'Compiler query list-stamp elements',
  );
  const stamps: QueryTemplateStampFact[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    const list = jsxStaticAttributeValue(element, 'data-bind-list');
    const key = jsxStaticAttributeValue(element, 'kovo-key');
    if (!list || !key) continue;

    const template = templateStampElement(elements, element);
    const templateBody = template ? jsxElementChildBody(template) : null;
    const itemBindingPlaceholders =
      template && templateBody
        ? templateItemBindingPlaceholders(elements, template, templateBody)
        : [];
    if (itemBindingPlaceholders.length === 0) continue;

    compilerArrayAppend(
      stamps,
      withOutputContext(
        {
          itemBindingPlaceholders,
          key,
          list,
          listReadPath: queryRelativePath(list),
          listReadSegments: queryRelativeSegments(list),
          selector: `[data-bind-list="${list}"]`,
          template: templateBody?.source ?? '',
        },
        {
          context: 'html-fragment',
          expression: list,
          sink: 'template.innerHTML',
          source: 'template-stamp',
          writer: 'template stamp assembly',
        },
      ),
      'Compiler query list stamps',
    );
  }
  return stamps;
}

function queryRelativePath(path: string): string {
  return bindingPathSegmentsToPath(queryRelativeSegments(path));
}

function queryRelativeSegments(path: string): BindingPathSegmentFact[] {
  const parsed = compilerSnapshotDenseArray(
    parseBindingPath(path),
    'Compiler query-relative path segments',
  );
  const output: BindingPathSegmentFact[] = [];
  for (let index = 1; index < parsed.length; index += 1) {
    compilerArrayAppend(output, parsed[index]!, 'Compiler query-relative path segments');
  }
  return output;
}

function bindingPathSegmentsToPath(segments: readonly BindingPathSegmentFact[]): string {
  const source = compilerSnapshotDenseArray(segments, 'Compiler binding path segments');
  let output = '';
  for (let index = 0; index < source.length; index += 1) {
    if (index > 0) output += '.';
    const segment = source[index]!;
    output += segment.optional ? `${segment.name}?` : segment.name;
  }
  return output;
}

function templateItemBindingPlaceholders(
  elements: readonly JsxElementModel[],
  template: JsxElementModel,
  templateBody: JsxElementChildBody,
): QueryTemplateStampBindingPlaceholder[] {
  const placeholders: QueryTemplateStampBindingPlaceholder[] = [];
  const sourceElements = compilerSnapshotDenseArray(elements, 'Compiler template-stamp elements');
  for (let index = 0; index < sourceElements.length; index += 1) {
    const candidate = sourceElements[index]!;
    if (!isWithinElement(candidate, template)) continue;
    const attributes = compilerSnapshotDenseArray(
      candidate.attributes,
      'Compiler template-stamp attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex]!;
      // SPEC §5.x: Only TEXT bindings (data-bind, no colon suffix) produce a child-body
      // placeholders. Attribute bindings are applied by the runtime property path.
      if (
        attribute.name !== 'data-bind' ||
        attribute.value === undefined ||
        attribute.value === ''
      ) {
        continue;
      }
      const fact = dataBindAttributeFact(attribute.name, attribute.value);
      if (fact.relativeReadPath === null) continue;
      const childBody = jsxElementChildBody(candidate);
      const templateStart = childBody ? childBody.offset - templateBody.offset : 0;
      const templateEnd = templateStart + (childBody?.source.length ?? 0);
      compilerArrayAppend(
        placeholders,
        withOutputContext(
          {
            path: fact.path,
            readPath: fact.relativeReadPath,
            readSegments: parseBindingPath(fact.relativeReadPath),
            templateEnd,
            templateStart,
            value: childBody?.source ?? '',
          },
          {
            context: 'html-fragment',
            expression: fact.path,
            sink: 'template item placeholder',
            source: 'template-stamp',
            writer: 'template stamp interpolation',
          },
        ),
        'Compiler template-stamp placeholders',
      );
    }
  }
  sortPlaceholders(placeholders);
  return placeholders;
}

function templateStampElement(
  elements: readonly JsxElementModel[],
  container: JsxElementModel,
): JsxElementModel | undefined {
  const source = compilerSnapshotDenseArray(elements, 'Compiler template-stamp lookup elements');
  for (let index = 0; index < source.length; index += 1) {
    const element = source[index]!;
    if (
      element.tag === 'template' &&
      isWithinElement(element, container) &&
      hasJsxAttribute(element, 'kovo-stamp')
    ) {
      return element;
    }
  }
  return undefined;
}

function sortPlaceholders(values: QueryTemplateStampBindingPlaceholder[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    let insertion = index;
    while (
      insertion > 0 &&
      compilerStringLocaleCompare(value.path, values[insertion - 1]!.path) < 0
    ) {
      values[insertion] = values[insertion - 1]!;
      insertion -= 1;
    }
    values[insertion] = value;
  }
}
