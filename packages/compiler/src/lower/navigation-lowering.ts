import {
  generatedJsxIrAttribute,
  jsxIrAttributeValue,
  markJsxIrChanged,
  removeJsxIrAttribute,
  setJsxIrAttribute,
  type JsxIrAttribute,
  type JsxIrElement,
} from '../jsx-ir.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import type { StaticLiteralValue } from '../scan/object.js';
import { staticHrefAttributeValue } from './navigation.js';
import type { StructuralJsxLoweringOptions } from './structural-jsx.js';

export function lowerNavigationLinks(
  elements: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
): void {
  for (const link of elements) {
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
    sortHrefFirstForStaticLink(link, Boolean(target));
    markJsxIrChanged(link);
  }
}

export function lowerHrefAttributes(
  model: ComponentModuleModel,
  elements: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
): void {
  for (const element of elements) {
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
  return element.attributes.find((attribute) => attribute.name === name);
}

function replaceJsxIrAttribute(
  element: JsxIrElement,
  oldName: string,
  attribute: JsxIrAttribute,
): void {
  const index = element.attributes.findIndex((item) => item.name === oldName);
  if (index === -1) {
    setJsxIrAttribute(element, attribute);
    return;
  }
  element.attributes.splice(index, 1, attribute);
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
  return Object.values(value).every((entry) => typeof entry !== 'object' || entry === null)
    ? (value as Record<string, string | number | boolean | null>)
    : null;
}

function buildStaticHref(
  path: string,
  params: Record<string, string | number | boolean | null>,
  searchValues: Record<string, string | number | boolean | null>,
): string {
  const pathname = substituteStaticRouteParams(path, params);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(searchValues)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

// H1 (bugs-part4 L6-1): keep this structural-JSX scanner's `:param` grammar
// identical to lower/navigation.ts, core's `buildHref`/`PathParamNames`, and the
// runtime matcher (server match.ts `parseRouteSegment`). A `:param` name is the
// whole segment after `:` up to the next `/`, `?`, or `#`; a narrower `\w`-only
// name dropped hyphen/dot params (`:user-id` -> `/users/-id`).
function substituteStaticRouteParams(
  path: string,
  params: Record<string, string | number | boolean | null>,
): string {
  let output = '';
  let index = 0;
  while (index < path.length) {
    const char = path[index];
    const next = path[index + 1];
    if (char !== ':' || next === undefined || isRouteParamNameTerminator(next)) {
      output += char;
      index += 1;
      continue;
    }
    let end = index + 2;
    while (end < path.length && !isRouteParamNameTerminator(path[end] ?? '')) end += 1;
    const key = path.slice(index + 1, end);
    output += encodeURIComponent(String(params[key] ?? ''));
    index = end;
  }
  return output;
}

function sortHrefFirstForStaticLink(element: JsxIrElement, staticHref: boolean): void {
  if (!staticHref) return;
  const href = attributeByName(element, 'href');
  if (!href) return;
  element.attributes = [href, ...element.attributes.filter((attribute) => attribute !== href)];
  markJsxIrChanged(element);
}

function staticStringValue(value: StaticLiteralValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function isRouteParamNameTerminator(char: string): boolean {
  return char === '/' || char === '?' || char === '#';
}
