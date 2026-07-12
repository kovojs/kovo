import { buildRoutePatternHref } from '@kovojs/core/internal/route-pattern';

import {
  generatedJsxIrAttribute,
  jsxIrAttributeValue,
  markJsxIrChanged,
  removeJsxIrAttribute,
  setJsxIrAttribute,
  type JsxIrAttribute,
  type JsxIrElement,
} from '../jsx-ir.js';
import type { ComponentModuleModel, JsxAttributeModel } from '../scan/parse.js';
import type { StaticLiteralValue } from '../scan/object.js';
import { staticHrefAttributeValue } from './navigation.js';
import type { StructuralJsxLoweringOptions } from './structural-jsx.js';
import {
  compilerArrayLength,
  compilerDefineOwnDataProperty,
  compilerObjectKeys,
  compilerOwnDataValue,
} from '../compiler-security-intrinsics.js';

export function lowerNavigationLinks(
  elements: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
): void {
  const length = compilerArrayLength(elements, 'Link navigation elements');
  for (let index = 0; index < length; index += 1) {
    const link = compilerOwnDataValue(
      elements,
      index,
      'Link navigation elements',
    ) as JsxIrElement;
    if (link.tag !== 'Link') continue;
    const toAttribute = attributeByName(link, 'to');
    if (!toAttribute?.source || !('name' in toAttribute.source)) continue;
    const target =
      jsxIrAttributeValue(toAttribute) ??
      staticStringValue(toAttribute.source.expressionStaticValue);
    if (!target && toAttribute.source.expression === undefined) continue;
    const params = navigationObjectValue(link, 'params') ?? {};
    const search = navigationObjectValue(link, 'search') ?? {};

    link.tag = 'a';
    link.closingName = 'a';
    removeJsxIrAttribute(link, 'params');
    removeJsxIrAttribute(link, 'search');
    replaceJsxIrAttribute(
      link,
      'to',
      generatedJsxIrAttribute(
        'href',
        target
          ? { kind: 'string', value: buildStaticHref(target, params, search) }
          : { kind: 'expression', source: toAttribute.source.expression ?? '' },
        'Link navigation lowering',
        options,
      ),
    );
    sortHrefFirstForStaticLink(link, target !== null && target !== '');
    markJsxIrChanged(link);
  }
}

export function lowerHrefAttributes(
  model: ComponentModuleModel,
  elements: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
): void {
  const length = compilerArrayLength(elements, 'Href navigation elements');
  for (let index = 0; index < length; index += 1) {
    const element = compilerOwnDataValue(
      elements,
      index,
      'Href navigation elements',
    ) as JsxIrElement;
    const attribute = attributeByName(element, 'href');
    if (!attribute?.source || !('name' in attribute.source)) continue;
    const target = staticHrefAttributeValue(model, attribute.source);
    if (target === null) continue;

    setJsxIrAttribute(
      element,
      generatedJsxIrAttribute(
        'href',
        { kind: 'string', value: target },
        'href navigation lowering',
        options,
      ),
    );
  }
}

function attributeByName(element: JsxIrElement, name: string): JsxIrAttribute | undefined {
  const length = compilerArrayLength(element.attributes, 'Navigation IR attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'Navigation IR attributes',
    ) as JsxIrAttribute;
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function replaceJsxIrAttribute(
  element: JsxIrElement,
  oldName: string,
  attribute: JsxIrAttribute,
): void {
  const next: JsxIrAttribute[] = [];
  let replaced = false;
  const length = compilerArrayLength(element.attributes, 'Navigation IR attributes');
  for (let index = 0; index < length; index += 1) {
    const item = compilerOwnDataValue(
      element.attributes,
      index,
      'Navigation IR attributes',
    ) as JsxIrAttribute;
    appendNavigationIrFact(
      next,
      !replaced && item.name === oldName ? attribute : item,
      'Navigation IR attributes',
    );
    if (!replaced && item.name === oldName) replaced = true;
  }
  if (!replaced) {
    setJsxIrAttribute(element, attribute);
    return;
  }
  element.attributes = next;
  markJsxIrChanged(element);
}

function navigationObjectValue(
  element: JsxIrElement,
  name: string,
): Record<string, string | number | boolean | null> | null | undefined {
  const attribute = attributeByName(element, name)?.source;
  if (!attribute || !('expressionStaticValue' in attribute)) return undefined;
  return staticNavigationObjectValue(attribute.expressionStaticValue);
}

function staticNavigationObjectValue(
  value: StaticLiteralValue | undefined,
): Record<string, string | number | boolean | null> | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return null;
  const keys = compilerObjectKeys(value);
  const length = compilerArrayLength(keys, 'Static Link object keys');
  for (let index = 0; index < length; index += 1) {
    const key = compilerOwnDataValue(keys, index, 'Static Link object keys') as string;
    const entry = compilerOwnDataValue(value, key, 'Static Link object');
    if (typeof entry === 'object' && entry !== null) return null;
  }
  return value as Record<string, string | number | boolean | null>;
}

function buildStaticHref(
  path: string,
  params: Record<string, string | number | boolean | null>,
  searchValues: Record<string, string | number | boolean | null>,
): string {
  return buildRoutePatternHref(path, { params, search: searchValues });
}

function sortHrefFirstForStaticLink(element: JsxIrElement, staticHref: boolean): void {
  if (!staticHref) return;
  const href = attributeByName(element, 'href');
  if (!href) return;
  const sorted: JsxIrAttribute[] = [];
  appendNavigationIrFact(sorted, href, 'Navigation IR attributes');
  const length = compilerArrayLength(element.attributes, 'Navigation IR attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'Navigation IR attributes',
    ) as JsxIrAttribute;
    if (attribute !== href) {
      appendNavigationIrFact(sorted, attribute, 'Navigation IR attributes');
    }
  }
  element.attributes = sorted;
  markJsxIrChanged(element);
}

function staticStringValue(value: StaticLiteralValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function appendNavigationIrFact<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}
