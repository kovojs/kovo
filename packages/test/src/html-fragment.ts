export function fragmentHtml(html: string, target: string): string {
  const explicitFragment = explicitFragmentHtml(html, target);
  if (explicitFragment !== undefined) return explicitFragment;

  const stampedElement = findFragmentTargetElement(html, target);
  if (!stampedElement) return '';

  const end = matchingElementEnd(html, stampedElement);
  if (end === undefined) return '';

  return html.slice(stampedElement.index, end);
}

export interface HtmlElementFact {
  attrs: Record<string, string>;
  html: string;
  innerHtml: string;
  tag: string;
}

export interface HtmlElementSelector {
  attrs?: Record<string, string | true>;
  tag?: string;
}

export interface FwQueryFact {
  attrs: Record<string, string>;
  html: string;
  json: unknown;
  name: string;
  rawJson: string;
  tag: string;
}

export interface FwFragmentFact {
  attrs: Record<string, string>;
  html: string;
  innerHtml: string;
  stylesheetHrefs: string[];
  target: string;
}

export function htmlElementFacts(
  html: string,
  selector: HtmlElementSelector = {},
): HtmlElementFact[] {
  const facts: HtmlElementFact[] = [];
  const tag = selector.tag?.toLowerCase();
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) return facts;

    const element = readOpeningElement(html, start);
    if (!element) {
      offset = start + 1;
      continue;
    }

    const end = elementFactEnd(html, element);
    if (end === undefined) {
      offset = element.end;
      continue;
    }

    const attrs = readHtmlAttributes(element.attrs);
    if (
      (tag === undefined || element.tag === tag) &&
      selectorAttributesMatch(attrs, selector.attrs)
    ) {
      facts.push({
        attrs,
        html: html.slice(element.index, end),
        innerHtml: html.slice(element.end, end - closingTagLength(element)),
        tag: element.tag,
      });
    }

    offset = element.end;
  }

  return facts;
}

export function fwQueryFacts(html: string, name?: string): FwQueryFact[] {
  return htmlElementFacts(html)
    .filter(
      (element) =>
        element.tag === 'fw-query' ||
        (element.tag === 'script' && element.attrs['fw-query'] !== undefined),
    )
    .map((element) => {
      const queryName = element.attrs.name ?? element.attrs['fw-query'] ?? '';
      return {
        attrs: element.attrs,
        html: element.html,
        json: JSON.parse(element.innerHtml),
        name: queryName,
        rawJson: element.innerHtml,
        tag: element.tag,
      };
    })
    .filter((fact) => name === undefined || fact.name === name);
}

export function fwFragmentFacts(html: string, target?: string): FwFragmentFact[] {
  return htmlElementFacts(html, { tag: 'fw-fragment' })
    .map((element) => ({
      attrs: element.attrs,
      html: element.html,
      innerHtml: element.innerHtml,
      stylesheetHrefs: htmlElementFacts(element.innerHtml, {
        attrs: { rel: 'stylesheet' },
        tag: 'link',
      }).map((link) => link.attrs.href ?? ''),
      target: element.attrs.target ?? '',
    }))
    .filter((fact) => target === undefined || fact.target === target);
}

function explicitFragmentHtml(html: string, target: string): string | undefined {
  const fragmentStart = findOpeningElement(
    html,
    (element) =>
      element.tag === 'fw-fragment' && readHtmlAttribute(element.attrs, 'target') === target,
  );
  if (!fragmentStart) return undefined;

  const end = matchingElementEnd(html, fragmentStart);
  if (end === undefined) return undefined;

  return html.slice(fragmentStart.end, end - '</fw-fragment>'.length);
}

interface OpeningElement {
  attrs: string;
  end: number;
  index: number;
  tag: string;
}

function findFragmentTargetElement(html: string, target: string): OpeningElement | undefined {
  return findOpeningElement(html, (element) => {
    const fragmentTarget = readHtmlAttribute(element.attrs, 'fw-fragment-target');
    const id = readHtmlAttribute(element.attrs, 'id');

    // SPEC.md §9.1: fragment chunks address the runtime target by name; the
    // browser runtime resolves that name with id / fw-fragment-target only.
    return fragmentTarget === target || id === target;
  });
}

function findOpeningElement(
  html: string,
  predicate: (element: OpeningElement) => boolean,
): OpeningElement | undefined {
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) return undefined;

    const element = readOpeningElement(html, start);
    if (element) {
      if (predicate(element)) return element;
      offset = element.end;
    } else {
      offset = start + 1;
    }
  }

  return undefined;
}

function readOpeningElement(html: string, start: number): OpeningElement | undefined {
  const head = /^<(?<tag>[a-z][a-z0-9-]*)\b/i.exec(html.slice(start));
  if (!head?.groups?.tag) return undefined;

  const close = tagClose(html, start + head[0].length);
  if (close === undefined) return undefined;

  return {
    attrs: html.slice(start + head[0].length, close),
    end: close + 1,
    index: start,
    tag: head.groups.tag.toLowerCase(),
  };
}

function tagClose(html: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

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

function matchingElementEnd(html: string, element: OpeningElement): number | undefined {
  if (/\/\s*$/.test(element.attrs) || isVoidElement(element.tag)) return element.end;

  let offset = element.end;
  let depth = 1;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) return undefined;

    const closing = readClosingElement(html, start);
    if (closing) {
      if (closing.tag === element.tag) {
        depth -= 1;
        if (depth === 0) return closing.end;
      }
      offset = closing.end;
      continue;
    }

    const opening = readOpeningElement(html, start);
    if (opening) {
      if (opening.tag === element.tag && !/\/\s*$/.test(opening.attrs)) {
        depth += 1;
      }
      offset = opening.end;
      continue;
    }

    offset = start + 1;
  }

  return undefined;
}

function elementFactEnd(html: string, element: OpeningElement): number | undefined {
  return /\/\s*$/.test(element.attrs) || isVoidElement(element.tag)
    ? element.end
    : matchingElementEnd(html, element);
}

function readClosingElement(html: string, start: number): { end: number; tag: string } | undefined {
  const head = /^<\/(?<tag>[a-z][a-z0-9-]*)\b/i.exec(html.slice(start));
  if (!head?.groups?.tag) return undefined;

  const close = tagClose(html, start + head[0].length);
  if (close === undefined) return undefined;

  return {
    end: close + 1,
    tag: head.groups.tag.toLowerCase(),
  };
}

function readHtmlAttribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(name)}(?:\\s*=\\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\\s"'=<>\`]+)))?(?=\\s|$|/)`,
    'i',
  );
  const match = pattern.exec(attrs);
  if (!match) return null;

  return match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? '';
}

function readHtmlAttributes(attrs: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern =
    /(?:^|\s)(?<name>[^\s"'=<>`/]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`]+)))?(?=\s|$|\/)/gi;

  for (const match of attrs.matchAll(pattern)) {
    const name = match.groups?.name?.toLowerCase();
    if (!name) continue;
    result[name] = match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? '';
  }

  return result;
}

function selectorAttributesMatch(
  attrs: Record<string, string>,
  selectorAttrs: Record<string, string | true> | undefined,
): boolean {
  if (!selectorAttrs) return true;

  return Object.entries(selectorAttrs).every(([name, value]) => {
    const actual = attrs[name.toLowerCase()];
    if (actual === undefined) return false;
    return value === true || actual === value;
  });
}

function closingTagLength(element: OpeningElement): number {
  return /\/\s*$/.test(element.attrs) || isVoidElement(element.tag) ? 0 : element.tag.length + 3;
}

function isVoidElement(tag: string): boolean {
  return [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
  ].includes(tag);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
