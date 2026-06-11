import {
  callExpressions,
  jsxElements,
  parseComponentModule,
  type JsxElementModel,
} from '../scan/parse.js';
import { literalStringValue, parseLiteralObject, type StaticLiteralValue } from '../scan/object.js';
import { escapeAttribute } from '../shared.js';

export function lowerNavigationSugar(source: string): { source: string } {
  return {
    source: normalizeStaticHrefAttributes(lowerStaticHrefCalls(lowerStaticLinks(source))),
  };
}

function lowerStaticLinks(source: string): string {
  let output = source;

  for (const link of jsxElements(parseComponentModule('component.tsx', source))
    .filter((element) => element.tag === 'Link' && !element.selfClosing)
    .sort((left, right) => right.start - left.start)) {
    const target = jsxStaticAttributeValue(link, 'to');
    if (!target) continue;

    const params = navigationObjectAttributeValue(link, 'params');
    const search = navigationObjectAttributeValue(link, 'search');
    if (params === null || search === null) continue;

    const opening = output.slice(link.start, link.openingEnd);
    const tagPrefix = '<Link';
    const attributes = opening.slice(tagPrefix.length, -1);
    const anchorAttributes = removeJsxAttributes(
      attributes,
      link.attributes
        .filter((attribute) => ['params', 'search', 'to'].includes(attribute.name))
        .map((attribute) => ({
          end: attribute.end - link.start - tagPrefix.length,
          start: attribute.start - link.start - tagPrefix.length,
        })),
    );
    const spacing = anchorAttributes.trim() === '' ? '' : anchorAttributes;
    const href = buildStaticHref(target, params ?? {}, search ?? {});
    const children = output.slice(link.openingEnd, link.closingStart);

    output = `${output.slice(0, link.start)}<a${spacing} href="${escapeAttribute(href)}">${children}</a>${output.slice(link.end)}`;
  }

  return output;
}

function lowerStaticHrefCalls(source: string): string {
  let output = source;

  for (const call of callExpressions(parseComponentModule('component.tsx', source))
    .filter((item) => item.name === 'href')
    .sort((left, right) => right.start - left.start)) {
    const lowered = lowerStaticHrefCall(call.arguments);
    if (!lowered) continue;

    output = `${output.slice(0, call.start)}${JSON.stringify(lowered)}${output.slice(call.end)}`;
  }

  return output;
}

function normalizeStaticHrefAttributes(source: string): string {
  let output = source;

  for (const attribute of jsxElements(parseComponentModule('component.tsx', source))
    .flatMap((element) => [...element.attributes])
    .filter((item) => item.name === 'href' && item.expression !== undefined)
    .sort((left, right) => right.start - left.start)) {
    const target = literalStringValue(attribute.expression ?? '');
    if (target === null) continue;

    output = `${output.slice(0, attribute.start)}href="${escapeAttribute(target)}"${output.slice(attribute.end)}`;
  }

  return output;
}

function lowerStaticHrefCall(args: readonly string[]): string | null {
  const [pathArg, optionsArg] = args.map((arg) => arg.trim());
  const path = literalStringValue(pathArg ?? '');
  if (!path) return null;

  const options = parseLiteralObject(optionsArg ?? '{}');
  if (options === null) return null;

  const params = objectRecordValue(options.params);
  const search = objectRecordValue(options.search);
  if (params === null || search === null) return null;

  return buildStaticHref(path, params ?? {}, search ?? {});
}

type StaticNavigationValue = string | number | boolean | null;
type StaticNavigationObject = Record<string, StaticNavigationValue>;

function navigationObjectAttributeValue(
  element: JsxElementModel,
  name: string,
): StaticNavigationObject | null | undefined {
  const expression = element.attributes.find((attribute) => attribute.name === name)?.expression;
  if (expression === undefined) return undefined;
  const value = parseLiteralObject(expression);
  return value ? navigationObjectValue(value) : null;
}

function objectRecordValue(
  value: StaticLiteralValue | undefined,
): StaticNavigationObject | null | undefined {
  if (value === undefined) return undefined;
  return navigationObjectValue(value);
}

function navigationObjectValue(value: StaticLiteralValue | null): StaticNavigationObject | null {
  if (typeof value !== 'object' || value === null) return null;
  return Object.values(value).every((entry) => typeof entry !== 'object' || entry === null)
    ? (value as StaticNavigationObject)
    : null;
}

function buildStaticHref(
  path: string,
  params: Record<string, string | number | boolean | null>,
  searchValues: Record<string, string | number | boolean | null>,
): string {
  const pathname = path.replace(/:([A-Za-z_$][\w$]*)/g, (_match, key: string) =>
    encodeURIComponent(String(params[key] ?? '')),
  );
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(searchValues)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function jsxStaticAttributeValue(element: JsxElementModel, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}

function removeJsxAttribute(attributes: string, start: number, end: number): string {
  let removeStart = start;
  while (removeStart > 0 && /\s/.test(attributes[removeStart - 1] ?? '')) {
    removeStart -= 1;
  }

  return `${attributes.slice(0, removeStart)}${attributes.slice(end)}`;
}

function removeJsxAttributes(
  attributes: string,
  ranges: readonly { end: number; start: number }[],
): string {
  return [...ranges]
    .sort((left, right) => right.start - left.start)
    .reduce((next, range) => removeJsxAttribute(next, range.start, range.end), attributes);
}
