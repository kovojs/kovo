import { securityArrayAppend } from './security-witness-intrinsics.js'; /** Parsed attribute metadata for raw Kovo wire elements (SPEC §9.4). */
export interface WireAttribute {
  end: number;
  hasValue: boolean;
  name: string;
  start: number;
  value: string;
  valueEnd?: number;
  valueStart?: number;
}

export interface WireAttributeLookup {
  attribute?: WireAttribute;
  hasValue: boolean;
  present: boolean;
  value: string | null;
}

export interface WireElementToken {
  attrs: string;
  attributes: readonly WireAttribute[];
  closeStart: number;
  content: string;
  end: number;
  openingEnd: number;
  start: number;
  tagName: string;
}

export interface ReadWireElementTokensOptions {
  nested?: boolean;
  onMalformed?: (reason: string) => void;
}

export function tagClose(source: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') return index;
  }

  return undefined;
}

export function readWireElementTokens(
  body: string,
  tagName: string,
  options: ReadWireElementTokensOptions = {},
): WireElementToken[] {
  const tokens: WireElementToken[] = [];
  let offset = 0;

  while (offset < body.length) {
    const start = findWireTagStart(body, tagName, offset);
    if (start < 0) break;
    if (body[start + 1] === '/') {
      offset = start + tagName.length + 2;
      continue;
    }

    const nameEnd = start + tagName.length + 1;
    const openingEnd = tagClose(body, nameEnd);
    if (openingEnd === undefined) {
      options.onMalformed?.('missing opening tag close');
      break;
    }

    const end = matchingWireElementEnd(body, tagName, start, openingEnd, options.nested ?? false);
    if (!end) {
      options.onMalformed?.('missing closing tag');
      break;
    }

    const attrs = wireStringRange(body, nameEnd, openingEnd);
    securityArrayAppend(
      tokens,
      {
        attrs,
        attributes: readWireAttributes(attrs),
        closeStart: end.closeStart,
        content: wireStringRange(body, openingEnd + 1, end.closeStart),
        end: end.end,
        openingEnd,
        start,
        tagName: wireStringRange(body, start + 1, nameEnd),
      },
      'Browser packages/browser/src/wire-tokenizer.ts collection',
    );
    offset = end.end;
  }

  return tokens;
}

export function readWireAttributes(attrs: string): WireAttribute[] {
  const attributes: WireAttribute[] = [];
  let index = 0;

  while (index < attrs.length) {
    while (index < attrs.length && isHtmlAttributeWhitespace(attrs[index] ?? '')) index += 1;
    if (index >= attrs.length || attrs[index] === '/' || attrs[index] === '>') break;

    const start = index;
    while (index < attrs.length && !isHtmlAttributeNameTerminator(attrs[index] ?? '')) index += 1;
    if (index === start) {
      index += 1;
      continue;
    }

    const name = wireStringRange(attrs, start, index);
    while (index < attrs.length && isHtmlAttributeWhitespace(attrs[index] ?? '')) index += 1;

    let value = '';
    let valueStart: number | undefined;
    let valueEnd: number | undefined;
    let hasValue = false;
    if (attrs[index] === '=') {
      hasValue = true;
      index += 1;
      while (index < attrs.length && isHtmlAttributeWhitespace(attrs[index] ?? '')) index += 1;
      const quote = attrs[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        valueStart = index;
        while (index < attrs.length && attrs[index] !== quote) index += 1;
        valueEnd = index;
        value = wireStringRange(attrs, valueStart, valueEnd);
        if (attrs[index] === quote) index += 1;
      } else {
        valueStart = index;
        while (
          index < attrs.length &&
          !isHtmlAttributeWhitespace(attrs[index] ?? '') &&
          attrs[index] !== '>'
        ) {
          index += 1;
        }
        valueEnd = index;
        value = wireStringRange(attrs, valueStart, valueEnd);
      }
    }

    securityArrayAppend(
      attributes,
      {
        end: index,
        hasValue,
        name,
        start,
        value: unescapeHtml(value),
        ...(valueStart === undefined ? {} : { valueStart }),
        ...(valueEnd === undefined ? {} : { valueEnd }),
      },
      'Browser packages/browser/src/wire-tokenizer.ts collection',
    );
  }

  return attributes;
}

export function readWireElementAttribute(
  element: { attrs?: string; attributes?: readonly WireAttribute[] } | string,
  name: string,
): WireAttributeLookup {
  const expected = wireAsciiLower(name);
  const attributes =
    typeof element === 'string'
      ? readWireAttributes(element)
      : (element.attributes ?? readWireAttributes(element.attrs ?? ''));
  let attribute: WireAttribute | undefined;
  for (let index = 0; index < attributes.length; index += 1) {
    const candidate = attributes[index];
    if (candidate !== undefined && wireAsciiLower(candidate.name) === expected) {
      attribute = candidate;
      break;
    }
  }
  if (!attribute) return { hasValue: false, present: false, value: null };
  return {
    attribute,
    hasValue: attribute.hasValue,
    present: true,
    value: attribute.value,
  };
}

function matchingWireElementEnd(
  body: string,
  tagName: string,
  start: number,
  openingEnd: number,
  nested: boolean,
): { closeStart: number; end: number } | null {
  if (!nested) {
    const closeStart = findWireClosingTagStart(body, tagName, openingEnd + 1);
    if (closeStart < 0) return null;
    const close = tagClose(body, closeStart + tagName.length + 2);
    return close === undefined ? null : { closeStart, end: close + 1 };
  }

  let cursor = start;
  let depth = 0;
  while (cursor < body.length) {
    const tagStart = findWireTagStart(body, tagName, cursor);
    if (tagStart < 0) return null;
    const nameEnd = tagStart + tagName.length + (body[tagStart + 1] === '/' ? 2 : 1);
    const close = tagClose(body, nameEnd);
    if (close === undefined) return null;

    if (body[tagStart + 1] === '/') {
      depth -= 1;
      if (depth === 0) return { closeStart: tagStart, end: close + 1 };
    } else if (!wireTagIsSelfClosing(body, tagStart, close)) {
      depth += 1;
    }

    cursor = close + 1;
  }

  return null;
}

function findWireClosingTagStart(body: string, tagName: string, offset: number): number {
  let cursor = offset;
  while (cursor < body.length) {
    const start = wireFindSubstring(body, '</', cursor);
    if (start < 0) return -1;
    if (matchesWireTagName(body, start + 2, tagName)) return start;
    cursor = start + 2;
  }
  return -1;
}

function findWireTagStart(body: string, tagName: string, offset: number): number {
  let cursor = offset;
  while (cursor < body.length) {
    const start = wireFindSubstring(body, '<', cursor);
    if (start < 0) return -1;
    const nameStart = body[start + 1] === '/' ? start + 2 : start + 1;
    if (matchesWireTagName(body, nameStart, tagName)) return start;
    cursor = start + 1;
  }
  return -1;
}

function matchesWireTagName(body: string, nameStart: number, tagName: string): boolean {
  if (nameStart + tagName.length > body.length) return false;
  for (let index = 0; index < tagName.length; index += 1) {
    if (
      wireAsciiLowerChar(body[nameStart + index] ?? '') !== wireAsciiLowerChar(tagName[index] ?? '')
    ) {
      return false;
    }
  }
  const next = body[nameStart + tagName.length] ?? '';
  return next === '' || isHtmlAttributeWhitespace(next) || next === '/' || next === '>';
}

function isHtmlAttributeWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f';
}

function isHtmlAttributeNameTerminator(char: string): boolean {
  return (
    isHtmlAttributeWhitespace(char) ||
    char === '=' ||
    char === '/' ||
    char === '>' ||
    char === '"' ||
    char === "'" ||
    char === '<'
  );
}

export function unescapeHtml(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '&') {
      result += value[index];
      continue;
    }
    const entity =
      wireSubstringAt(value, index, '&#39;') || wireSubstringAt(value, index, '&apos;')
        ? { length: wireSubstringAt(value, index, '&#39;') ? 5 : 6, value: "'" }
        : wireSubstringAt(value, index, '&quot;')
          ? { length: 6, value: '"' }
          : wireSubstringAt(value, index, '&gt;')
            ? { length: 4, value: '>' }
            : wireSubstringAt(value, index, '&lt;')
              ? { length: 4, value: '<' }
              : wireSubstringAt(value, index, '&amp;')
                ? { length: 5, value: '&' }
                : undefined;
    if (!entity) {
      result += '&';
      continue;
    }
    result += entity.value;
    index += entity.length - 1;
  }
  return result;
}

// The tokenizer is extracted into the inline loader as readable source, so its
// transport-byte operations deliberately use only primitive indexing and loops.
// App code can replace String/Array prototype methods in the shared browser realm;
// no such replacement may alter the bytes attested by the fragment carrier
// (SPEC.md §6.6/§9.4).
function wireStringRange(value: string, start: number, end: number): string {
  let result = '';
  const limit = end < value.length ? end : value.length;
  for (let index = start; index < limit; index += 1) result += value[index] ?? '';
  return result;
}

function wireAsciiLower(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    result += wireAsciiLowerChar(value[index] ?? '');
  }
  return result;
}

function wireAsciiLowerChar(value: string): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < upper.length; index += 1) {
    if (value === upper[index]) return lower[index] ?? value;
  }
  return value;
}

function wireSubstringAt(value: string, start: number, expected: string): boolean {
  if (start + expected.length > value.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (value[start + index] !== expected[index]) return false;
  }
  return true;
}

function wireFindSubstring(value: string, search: string, start: number): number {
  for (let index = start; index + search.length <= value.length; index += 1) {
    if (wireSubstringAt(value, index, search)) return index;
  }
  return -1;
}

function wireTagIsSelfClosing(value: string, tagStart: number, close: number): boolean {
  let index = close - 1;
  while (index > tagStart && isHtmlAttributeWhitespace(value[index] ?? '')) index -= 1;
  return value[index] === '/';
}
