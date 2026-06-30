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

    const attrs = body.slice(nameEnd, openingEnd);
    tokens.push({
      attrs,
      attributes: readWireAttributes(attrs),
      closeStart: end.closeStart,
      content: body.slice(openingEnd + 1, end.closeStart),
      end: end.end,
      openingEnd,
      start,
      tagName: body.slice(start + 1, nameEnd),
    });
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

    const name = attrs.slice(start, index);
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
        value = attrs.slice(valueStart, valueEnd);
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
        value = attrs.slice(valueStart, valueEnd);
      }
    }

    attributes.push({
      end: index,
      hasValue,
      name,
      start,
      value: unescapeHtml(value),
      ...(valueStart === undefined ? {} : { valueStart }),
      ...(valueEnd === undefined ? {} : { valueEnd }),
    });
  }

  return attributes;
}

export function readWireElementAttribute(
  element: { attrs?: string; attributes?: readonly WireAttribute[] } | string,
  name: string,
): WireAttributeLookup {
  const expected = name.toLowerCase();
  const attributes =
    typeof element === 'string'
      ? readWireAttributes(element)
      : (element.attributes ?? readWireAttributes(element.attrs ?? ''));
  const attribute = attributes.find((candidate) => candidate.name.toLowerCase() === expected);
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
    } else if (!/\/\s*>$/.test(body.slice(tagStart, close + 1))) {
      depth += 1;
    }

    cursor = close + 1;
  }

  return null;
}

function findWireClosingTagStart(body: string, tagName: string, offset: number): number {
  let cursor = offset;
  while (cursor < body.length) {
    const start = body.indexOf('</', cursor);
    if (start < 0) return -1;
    if (matchesWireTagName(body, start + 2, tagName)) return start;
    cursor = start + 2;
  }
  return -1;
}

function findWireTagStart(body: string, tagName: string, offset: number): number {
  let cursor = offset;
  while (cursor < body.length) {
    const start = body.indexOf('<', cursor);
    if (start < 0) return -1;
    const nameStart = body[start + 1] === '/' ? start + 2 : start + 1;
    if (matchesWireTagName(body, nameStart, tagName)) return start;
    cursor = start + 1;
  }
  return -1;
}

function matchesWireTagName(body: string, nameStart: number, tagName: string): boolean {
  if (body.slice(nameStart, nameStart + tagName.length).toLowerCase() !== tagName.toLowerCase()) {
    return false;
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
  return value
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}
