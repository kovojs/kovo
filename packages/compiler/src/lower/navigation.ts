import {
  callExpressions,
  jsxElements,
  parseComponentModule,
  type JsxElementModel,
} from '../scan/parse.js';
import { findStringEnd } from '../scan/text.js';
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
type StaticLiteralValue = StaticNavigationValue | StaticLiteralObject;

interface StaticLiteralObject {
  [key: string]: StaticLiteralValue;
}

function navigationObjectAttributeValue(
  element: JsxElementModel,
  name: string,
): StaticNavigationObject | null | undefined {
  const expression = element.attributes.find((attribute) => attribute.name === name)?.expression;
  if (expression === undefined) return undefined;
  const value = parseLiteralObject(expression);
  return value ? navigationObjectValue(value) : null;
}

function parseLiteralObject(source: string): StaticLiteralObject | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

  const entries: Record<string, StaticLiteralValue> = {};
  for (const entry of topLevelObjectEntries(trimmed)) {
    const value = literalValue(entry.value);
    if (value === undefined) return null;
    entries[entry.key] = value;
  }

  return entries;
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

function literalValue(value: string): StaticLiteralValue | undefined {
  const trimmed = value.trim().replace(/,$/, '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parseLiteralObject(trimmed) ?? undefined;
  }

  const stringValue = literalStringValue(trimmed);
  if (stringValue !== null) return stringValue;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  return undefined;
}

function literalStringValue(value: string): string | null {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return null;
  return trimmed.slice(1, -1);
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

function topLevelObjectEntries(objectSource: string): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  let index = 1;

  while (index < objectSource.length - 1) {
    index = skipWhitespaceAndComments(objectSource, index);
    if (objectSource[index] === ',') {
      index += 1;
      continue;
    }

    const key = readObjectKey(objectSource, index);
    if (!key) {
      index = skipObjectValue(objectSource, index);
      continue;
    }

    const afterKey = skipWhitespaceAndComments(objectSource, key.end);
    if (objectSource[afterKey] !== ':') {
      index = skipObjectValue(objectSource, afterKey);
      continue;
    }

    const valueStart = skipWhitespaceAndComments(objectSource, afterKey + 1);
    const valueEnd = skipObjectValue(objectSource, valueStart);
    entries.push({ key: key.name, value: objectSource.slice(valueStart, valueEnd).trim() });
    index = valueEnd;
  }

  return entries;
}

function readObjectKey(source: string, start: number): { name: string; end: number } | null {
  const char = source[start];
  if (char === '"' || char === "'") {
    const end = findStringEnd(source, start, char);
    if (end === -1) return null;

    return {
      end: end + 1,
      name: source.slice(start + 1, end),
    };
  }

  const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(start));
  if (!identifier?.[0]) return null;

  return {
    end: start + identifier[0].length,
    name: identifier[0],
  };
}

function skipObjectValue(source: string, start: number): number {
  let index = start;
  let curlyDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;

  while (index < source.length - 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length - 1 : end + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length - 1 : nextLine + 1;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length - 1 : commentEnd + 2;
      continue;
    }

    if (char === '{') curlyDepth += 1;
    if (char === '}') {
      if (curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) return index;
      curlyDepth -= 1;
    }

    if (char === '[') squareDepth += 1;
    if (char === ']') squareDepth -= 1;
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;

    if (char === ',' && curlyDepth === 0 && squareDepth === 0 && parenDepth === 0) {
      return index + 1;
    }

    index += 1;
  }

  return index;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index] ?? '')) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 2;
      continue;
    }
    break;
  }

  return index;
}
