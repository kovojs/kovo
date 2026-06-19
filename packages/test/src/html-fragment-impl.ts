// Private implementation module for the HTML/Kovo fragment fact extractors.
// The public subset is re-exported from `./html-fragment.js` (subpath
// `@kovojs/test/html-fragment`); the remaining extractors/DTOs are re-exported
// with `@internal` from `./internal-html-fragment.js`
// (subpath `@kovojs/test/internal/html-fragment`). SPEC.md §9.1.

/**
 * Extract the rendered HTML for a named fragment `target` from `html`: an
 * explicit `<kovo-fragment target>` body, else the stamped element addressed by
 * `id`/`kovo-fragment-target` (SPEC.md §9.1). Returns `''` when not found.
 */
export function fragmentHtml(html: string, target: string): string {
  const explicitFragment = explicitFragmentHtml(html, target);
  if (explicitFragment !== undefined) return explicitFragment;

  const stampedElement = findFragmentTargetElement(html, target);
  if (!stampedElement) return '';

  const end = matchingElementEnd(html, stampedElement);
  if (end === undefined) return '';

  return html.slice(stampedElement.index, end);
}

/** A matched HTML element: its `tag`, `attrs`, full `html`, and `innerHtml`. */
export interface HtmlElementFact {
  attrs: Record<string, string>;
  html: string;
  innerHtml: string;
  tag: string;
}

/** Element selector for {@link htmlElementFacts}: optional `tag` and required `attrs`. */
export interface HtmlElementSelector {
  attrs?: Record<string, string | true>;
  tag?: string;
}

/** A `<script type=application/json>` fact: its `attrs`, parsed `json`, and `rawJson`. */
export interface HtmlJsonScriptFact {
  attrs: Record<string, string>;
  html: string;
  json: unknown;
  rawJson: string;
}

/** Document-level facts: title, text, body attrs, links, metas, and JSON scripts. */
export interface HtmlDocumentFact {
  bodyAttrs: Record<string, string>;
  jsonScripts: HtmlJsonScriptFact[];
  links: HtmlElementFact[];
  metas: HtmlElementFact[];
  text: string;
  title: string;
}

/** @internal The single html/head/body regions of a rendered document. */
export interface HtmlDocumentRegions {
  body: HtmlElementFact;
  head: HtmlElementFact;
  html: HtmlElementFact;
}

/** @internal The `<main>` check-export marker fact. */
export interface HtmlMainMarkerFact {
  attribute: string;
  mainCount: number;
  marker: string | undefined;
}

/** @internal A `kovo-query` script fact: name, parsed `json`, and `rawJson`. */
export interface KovoQueryFact {
  attrs: Record<string, string>;
  html: string;
  json: unknown;
  name: string;
  rawJson: string;
  tag: string;
}

/** @internal A `kovo-fragment` element fact: target, innerHtml, and stylesheet hrefs. */
export interface KovoFragmentFact {
  attrs: Record<string, string>;
  html: string;
  innerHtml: string;
  stylesheetHrefs: string[];
  target: string;
}

/** @internal Aggregated Kovo response-body facts: fragments, queries, and key/value markers. */
export interface KovoResponseBodyFact {
  fragmentTargets: string[];
  fragments: KovoFragmentFact[];
  keyValues: string[];
  queries: KovoQueryFact[];
  queryJsonByName: Record<string, unknown[]>;
  queryNames: string[];
  stylesheetHrefsByTarget: Record<string, string[]>;
}

/** @internal Behavior fact for document-vs-fragment query-script placement. */
export interface DocumentQueryScriptBehaviorFact {
  bodyElements: HtmlElementFact[];
  bodyQueryScripts: Array<Pick<KovoQueryFact, 'attrs' | 'rawJson'>>;
  documentQueryScripts: Array<Pick<KovoQueryFact, 'attrs' | 'rawJson'>>;
  headQueryScripts: Array<Pick<KovoQueryFact, 'attrs' | 'rawJson'>>;
  renderedDocumentQueryScript: string;
  renderedQueryScript: string;
}

/** Count the elements in `html` matching `selector` (SPEC.md §9.1). */
export function htmlElementCount(html: string, selector: HtmlElementSelector = {}): number {
  return htmlElementFacts(html, selector).length;
}

/** A form field fact: `name`, `tag`, `type`, `value`, and `attrs`. */
export interface HtmlFormFieldFact {
  attrs: Record<string, string>;
  html: string;
  name: string;
  tag: string;
  type: string;
  value: string;
}

/** A `<form>` fact: its `action`, `method`, `attrs`, `innerHtml`, and `fields`. */
export interface HtmlFormFact {
  action: string;
  attrs: Record<string, string>;
  fields: HtmlFormFieldFact[];
  html: string;
  innerHtml: string;
  method: string;
}

/** @internal A `kovo-key`-marked element fact: its key and text content. */
export interface HtmlKeyFact {
  attrs: Record<string, string>;
  html: string;
  innerHtml: string;
  key: string;
  tag: string;
  text: string;
}

/** Extract every element in `html` matching `selector` as an {@link HtmlElementFact} (SPEC.md §9.1). */
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

    offset = isRawTextElement(element.tag) ? end : element.end;
  }

  return facts;
}

/** @internal Extract JSON `<script>` facts (parsed `json`) from `html`. */
export function htmlJsonScriptFacts(
  html: string,
  attrs: Record<string, string | true> = { type: 'application/json' },
): HtmlJsonScriptFact[] {
  return htmlElementFacts(html, { attrs, tag: 'script' }).map((element) => ({
    attrs: element.attrs,
    html: element.html,
    json: JSON.parse(element.innerHtml),
    rawJson: element.innerHtml,
  }));
}

/** Extract document-level facts (title, text, links, metas, JSON scripts) from `html` (SPEC.md §9.1). */
export function htmlDocumentFacts(html: string): HtmlDocumentFact {
  const body = htmlElementFacts(html, { tag: 'body' })[0];
  const title = htmlElementFacts(html, { tag: 'title' })[0]?.innerHtml ?? '';

  return {
    bodyAttrs: body?.attrs ?? {},
    jsonScripts: htmlJsonScriptFacts(html),
    links: htmlElementFacts(html, { tag: 'link' }),
    metas: htmlElementFacts(html, { tag: 'meta' }),
    text: htmlTextContent(body?.innerHtml ?? html),
    title: htmlTextContent(title),
  };
}

/** @internal Extract the single html/head/body document regions from `html`. */
export function htmlDocumentRegions(html: string): HtmlDocumentRegions {
  const htmlRegions = htmlElementFacts(html, { tag: 'html' });
  const headRegions = htmlElementFacts(html, { tag: 'head' });
  const bodyRegions = htmlElementFacts(html, { tag: 'body' });

  if (htmlRegions.length !== 1 || headRegions.length !== 1 || bodyRegions.length !== 1) {
    throw new Error(
      `Expected one html/head/body document region; found html=${htmlRegions.length} head=${headRegions.length} body=${bodyRegions.length}`,
    );
  }

  return {
    body: bodyRegions[0]!,
    head: headRegions[0]!,
    html: htmlRegions[0]!,
  };
}

/** @internal Extract the `<main>` check-export marker fact from `html`. */
export function htmlMainMarkerFact(
  html: string,
  attribute = 'data-kovo-check-export',
): HtmlMainMarkerFact {
  const mainElements = htmlElementFacts(html, { tag: 'main' });

  return {
    attribute,
    mainCount: mainElements.length,
    marker: mainElements[0]?.attrs[attribute],
  };
}

/** @internal Extract `<link>` href values from `html`. */
export function htmlLinkHrefs(html: string, attrs: Record<string, string | true> = {}): string[] {
  return htmlElementFacts(html, { attrs, tag: 'link' })
    .map((link) => link.attrs.href ?? '')
    .filter((href) => href !== '');
}

/** @internal Extract `kovo-query` script facts from `html`, optionally filtered by `name`. */
export function kovoQueryFacts(html: string, name?: string): KovoQueryFact[] {
  return htmlElementFacts(html)
    .filter(
      (element) =>
        element.tag === 'kovo-query' ||
        (element.tag === 'script' && element.attrs['kovo-query'] !== undefined),
    )
    .map((element) => {
      const queryName = element.attrs.name ?? element.attrs['kovo-query'] ?? '';
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

/** @internal Extract `kovo-fragment` facts from `html`, optionally filtered by `target`. */
export function kovoFragmentFacts(html: string, target?: string): KovoFragmentFact[] {
  return htmlElementFacts(html, { tag: 'kovo-fragment' })
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

/** @internal Aggregate Kovo response-body facts (fragments, queries, key/values) from `html`. */
export function kovoResponseBodyFact(html: string): KovoResponseBodyFact {
  const queries = kovoQueryFacts(html);
  const fragments = kovoFragmentFacts(html);

  return {
    fragmentTargets: fragments.map((fragment) => fragment.target),
    fragments,
    keyValues: htmlKeyValues(html),
    queries,
    queryJsonByName: groupQueryJsonByName(queries),
    queryNames: queries.map((query) => query.name),
    stylesheetHrefsByTarget: Object.fromEntries(
      fragments.map((fragment) => [fragment.target, fragment.stylesheetHrefs]),
    ),
  };
}

/** Extract the parsed JSON values of every `kovo-query` named `name` in `html` (SPEC.md §9.1). */
export function kovoQueryJsonValues(html: string, name: string): unknown[] {
  return kovoResponseBodyFact(html).queryJsonByName[name] ?? [];
}

/** @internal Behavior fact for document-vs-fragment query-script placement. */
export function documentQueryScriptBehaviorFact(
  renderedDocument: string,
  options: {
    queryName: string;
    renderedDocumentQueryScript: string;
    renderedQueryScript: string;
  },
): DocumentQueryScriptBehaviorFact {
  const documentRegions = htmlDocumentRegions(renderedDocument);
  const documentQueryScripts = kovoQueryFacts(renderedDocument, options.queryName);
  const bodyQueryScripts = kovoQueryFacts(documentRegions.body.innerHtml, options.queryName);
  const headQueryScripts = kovoQueryFacts(documentRegions.head.innerHtml, options.queryName);

  return {
    bodyElements: htmlElementFacts(documentRegions.body.innerHtml),
    bodyQueryScripts: compactQueryScriptFacts(bodyQueryScripts),
    documentQueryScripts: compactQueryScriptFacts(documentQueryScripts),
    headQueryScripts: compactQueryScriptFacts(headQueryScripts),
    renderedDocumentQueryScript: options.renderedDocumentQueryScript,
    renderedQueryScript: options.renderedQueryScript,
  };
}

/** Extract every `<form>` in `html` as an {@link HtmlFormFact} (action, method, fields) (SPEC.md §9.1). */
export function htmlFormFacts(html: string): HtmlFormFact[] {
  return htmlElementFacts(html, { tag: 'form' }).map((form) => ({
    action: form.attrs.action ?? '',
    attrs: form.attrs,
    fields: htmlElementFacts(form.innerHtml)
      .filter((element) => ['button', 'input', 'select', 'textarea'].includes(element.tag))
      .map((element) => ({
        attrs: element.attrs,
        html: element.html,
        name: element.attrs.name ?? '',
        tag: element.tag,
        type: element.attrs.type ?? '',
        value: element.attrs.value ?? element.innerHtml,
      }))
      .filter((field) => field.name !== ''),
    html: form.html,
    innerHtml: form.innerHtml,
    method: form.attrs.method ?? 'get',
  }));
}

/** Extract the `action` of every `<form>` in `html` (SPEC.md §9.1). */
export function htmlFormActions(html: string): string[] {
  return htmlFormFacts(html).map((form) => form.action);
}

/** Extract every form field in `html` as an {@link HtmlFormFieldFact}, optionally filtered by `name`. */
export function htmlFormFields(html: string, name?: string): HtmlFormFieldFact[] {
  return htmlFormFacts(html)
    .flatMap((form) => form.fields)
    .filter((field) => name === undefined || field.name === name);
}

/** Index a form's fields by their `name` (SPEC.md §9.1). */
export function htmlFormFieldsByName(
  form: HtmlFormFact | undefined,
): Record<string, HtmlFormFieldFact> {
  return Object.fromEntries((form?.fields ?? []).map((field) => [field.name, field]));
}

/** @internal Extract `kovo-key`-marked element facts from `html`, optionally filtered by `key`. */
export function htmlKeyFacts(html: string, key?: string): HtmlKeyFact[] {
  return htmlElementFacts(html)
    .filter((element) => element.attrs['kovo-key'] !== undefined)
    .map((element) => ({
      attrs: element.attrs,
      html: element.html,
      innerHtml: element.innerHtml,
      key: element.attrs['kovo-key'] ?? '',
      tag: element.tag,
      text: htmlTextContent(element.innerHtml),
    }))
    .filter((fact) => key === undefined || fact.key === key);
}

/** Extract the `kovo-key` values present in `html` (SPEC.md §9.1). */
export function htmlKeyValues(html: string): string[] {
  return htmlKeyFacts(html).map((fact) => fact.key);
}

/** @internal Map each `kovo-key` to its element's text content in `html`. */
export function htmlKeyTextMap(html: string): Record<string, string> {
  return Object.fromEntries(htmlKeyFacts(html).map((fact) => [fact.key, fact.text]));
}

function groupQueryJsonByName(queries: KovoQueryFact[]): Record<string, unknown[]> {
  const grouped: Record<string, unknown[]> = {};

  for (const query of queries) {
    grouped[query.name] ??= [];
    grouped[query.name]!.push(query.json);
  }

  return grouped;
}

function compactQueryScriptFacts(
  queries: KovoQueryFact[],
): Array<Pick<KovoQueryFact, 'attrs' | 'rawJson'>> {
  return queries.map((query) => ({
    attrs: query.attrs,
    rawJson: query.rawJson,
  }));
}

/** Extract the visible text content of `html`, decoding entities and collapsing whitespace (SPEC.md §9.1). */
export function htmlTextContent(html: string): string {
  let text = '';
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) {
      text += html.slice(offset);
      break;
    }

    text += html.slice(offset, start);

    const close = tagClose(html, start + 1);
    if (close === undefined) {
      text += html.slice(start);
      break;
    }

    offset = close + 1;
  }

  return decodeHtmlText(text).replace(/\s+/g, ' ').trim();
}

function explicitFragmentHtml(html: string, target: string): string | undefined {
  const fragmentStart = findOpeningElement(
    html,
    (element) =>
      element.tag === 'kovo-fragment' && readHtmlAttribute(element.attrs, 'target') === target,
  );
  if (!fragmentStart) return undefined;

  const end = matchingElementEnd(html, fragmentStart);
  if (end === undefined) return undefined;

  return html.slice(fragmentStart.end, end - '</kovo-fragment>'.length);
}

interface OpeningElement {
  attrs: string;
  end: number;
  index: number;
  tag: string;
}

function findFragmentTargetElement(html: string, target: string): OpeningElement | undefined {
  return findOpeningElement(html, (element) => {
    const fragmentTarget = readHtmlAttribute(element.attrs, 'kovo-fragment-target');
    const id = readHtmlAttribute(element.attrs, 'id');

    // SPEC.md §9.1: fragment chunks address the runtime target by name; the
    // browser runtime resolves that name with id / kovo-fragment-target only.
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
  if (isRawTextElement(element.tag)) return rawTextElementEnd(html, element);

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

function rawTextElementEnd(html: string, element: OpeningElement): number | undefined {
  const closing = new RegExp(`</${escapeRegExp(element.tag)}\\s*>`, 'i');
  const match = closing.exec(html.slice(element.end));
  return match ? element.end + match.index + match[0].length : undefined;
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

function isRawTextElement(tag: string): boolean {
  return tag === 'script' || tag === 'style';
}

function decodeHtmlText(text: string): string {
  const entity = /&(?:#(?<decimal>\d+)|#x(?<hex>[0-9a-f]+)|(?<named>amp|lt|gt|quot|apos));/gi;

  return text.replace(entity, (match, ...args: unknown[]) => {
    const groups = args[args.length - 1] as
      | { decimal?: string; hex?: string; named?: string }
      | undefined;
    const decimal = groups?.decimal;
    if (decimal !== undefined) return String.fromCodePoint(Number(decimal));

    const hex = groups?.hex;
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));

    switch (groups?.named?.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return match;
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
