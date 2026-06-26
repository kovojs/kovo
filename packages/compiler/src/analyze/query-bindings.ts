// Data-bind collection + data-bind-list template-stamp assembly (offset math).
// Extracted verbatim from `analyze/query-updates.ts` for the FN10 decomposition.
// SPEC.md §5.x query-update facts. Behavior-neutral: emitted bytes and the hidden
// non-enumerable `outputContext` channel are unchanged.
import { parseBindingPath } from './query-shapes.js';
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
  return jsxAttributes(model)
    .filter(
      (attribute) =>
        isBindingAttribute(attribute.name) &&
        attribute.value !== undefined &&
        attribute.value !== '',
    )
    .map((attribute) => dataBindAttributeFact(attribute.name, attribute.value ?? ''));
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

  const attr = binding.name.slice('data-bind:'.length);
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
  factsByQuery.set(query, [...(factsByQuery.get(query) ?? []), fact]);
}

export function collectDataBindListStamps(model: ComponentModuleModel): QueryTemplateStampFact[] {
  const elements = jsxElements(model);

  return elements
    .flatMap((element) => {
      const list = jsxStaticAttributeValue(element, 'data-bind-list');
      const key = jsxStaticAttributeValue(element, 'kovo-key');
      if (!list || !key) return [];

      const template = templateStampElement(elements, element);
      const templateBody = template ? jsxElementChildBody(template) : null;
      const itemBindingPlaceholders =
        template && templateBody
          ? templateItemBindingPlaceholders(elements, template, templateBody)
          : [];

      return [
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
      ];
    })
    .filter((stamp) => (stamp.itemBindingPlaceholders?.length ?? 0) > 0);
}

function queryRelativePath(path: string): string {
  return bindingPathSegmentsToPath(queryRelativeSegments(path));
}

function queryRelativeSegments(path: string): BindingPathSegmentFact[] {
  return parseBindingPath(path).slice(1);
}

function bindingPathSegmentsToPath(segments: readonly BindingPathSegmentFact[]): string {
  return segments
    .map((segment) => (segment.optional ? `${segment.name}?` : segment.name))
    .join('.');
}

function templateItemBindingPlaceholders(
  elements: readonly JsxElementModel[],
  template: JsxElementModel,
  templateBody: JsxElementChildBody,
): QueryTemplateStampBindingPlaceholder[] {
  return elements
    .filter((candidate) => isWithinElement(candidate, template))
    .flatMap((candidate) =>
      candidate.attributes
        // SPEC §5.x: Only TEXT bindings (data-bind, no colon suffix) produce a child-body
        // placeholder. Attribute bindings (data-bind:href, data-bind:hidden, …) are applied
        // by the runtime applyItemRelativeBindings/setBoundAttribute path — interpolating them
        // into the element child body would clobber the element's own label text (bugz L3).
        .filter(
          (attribute) =>
            attribute.name === 'data-bind' &&
            attribute.value !== undefined &&
            attribute.value !== '' &&
            dataBindAttributeFact(attribute.name, attribute.value).relativeReadPath !== null,
        )
        .map((attribute) => {
          const fact = dataBindAttributeFact(attribute.name, attribute.value ?? '');
          const childBody = jsxElementChildBody(candidate);
          const templateStart = childBody ? childBody.offset - templateBody.offset : 0;
          const templateEnd = templateStart + (childBody?.source.length ?? 0);
          return withOutputContext(
            {
              path: fact.path,
              readPath: fact.relativeReadPath ?? '',
              readSegments: parseBindingPath(fact.relativeReadPath ?? ''),
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
          );
        }),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
}

function templateStampElement(
  elements: readonly JsxElementModel[],
  container: JsxElementModel,
): JsxElementModel | undefined {
  return elements.find(
    (element) =>
      element.tag === 'template' &&
      isWithinElement(element, container) &&
      hasJsxAttribute(element, 'kovo-stamp'),
  );
}
