// SPEC.md §9.1: the Kovo-internal wire-shape extractors (`<kovo-fragment>` /
// `<kovo-query>` envelopes, document-region splitting, JSON script decoding, and
// the `<main>` export marker) moved to the private `@kovojs/test/internal/html-wire`
// subpath; this public surface keeps only the generic HTML element/form/key/text
// extractors. Two public helpers still build on the wire-shape internals, so they
// import them back here.
import { htmlJsonScriptFacts, kovoResponseBodyFact } from '@kovojs/test/internal/html-wire';
import {
  verifierArrayPush,
  verifierDefineProperty,
  verifierGetOwnPropertyDescriptor,
  verifierNullRecord,
  verifierNumber,
  verifierNumberParseInt,
  verifierObjectKeys,
  verifierRegExp,
  verifierRegExpExec,
  verifierStringFromCodePoint,
  verifierStringIndexOf,
  verifierStringReplace,
  verifierStringSlice,
  verifierStringToLowerCase,
  verifierStringTrim,
  verifierTypeError,
} from './verifier-security-intrinsics.ts';

/**
 * Extracts the server-rendered HTML for a single fragment target from a page
 * response, backing the `page().fragment(target)` scenario assertion (SPEC.md
 * §12). Returns the inner HTML of an explicit `<kovo-fragment target="…">`
 * envelope when present, otherwise the full markup of the stamped target element
 * resolved by `id`/`kovo-fragment-target` (SPEC.md §9.1); returns `''` when no
 * matching target is found.
 *
 * @param html - The full page or fragment-response HTML to search.
 * @param target - The fragment target name to resolve.
 * @returns The target's HTML, or `''` when no matching target exists.
 */
export function fragmentHtml(html: string, target: string): string {
  const explicitFragment = explicitFragmentHtml(html, target);
  if (explicitFragment !== undefined) return explicitFragment;

  const stampedElement = findFragmentTargetElement(html, target);
  if (!stampedElement) return '';

  const end = matchingElementEnd(html, stampedElement);
  if (end === undefined) return '';

  return verifierStringSlice(html, stampedElement.index, end);
}

/**
 * One matched HTML element extracted from a page or fragment response, used to
 * assert against server-rendered markup without a browser (SPEC.md §12). Holds
 * the element's lowercased attribute map, its full outer markup, its inner
 * content, and its lowercased tag name.
 */
export interface HtmlElementFact {
  attrs: Record<string, string>;
  html: string;
  innerHtml: string;
  tag: string;
}

/**
 * Selector for filtering elements in {@link htmlElementFacts} and related
 * extractors (SPEC.md §12). `tag` matches a lowercased tag name; each `attrs`
 * entry requires that attribute to be present, with `true` asserting presence
 * only and a string asserting an exact value.
 */
export interface HtmlElementSelector {
  attrs?: Record<string, string | true>;
  tag?: string;
}

/** One decoded JSON script found in a server-rendered document (SPEC.md §9.1, §12). */
export interface HtmlJsonScriptFact {
  attrs: Record<string, string>;
  html: string;
  json: unknown;
  rawJson: string;
}

/**
 * Document-level facts extracted from a full page response for scenario
 * assertions (SPEC.md §12): the `<body>` attribute map, decoded inline JSON
 * script payloads (SPEC.md §9.1), all `<link>` and `<meta>` element facts, the
 * body's collapsed text content, and the document title.
 */
export interface HtmlDocumentFact {
  bodyAttrs: Record<string, string>;
  jsonScripts: HtmlJsonScriptFact[];
  links: HtmlElementFact[];
  metas: HtmlElementFact[];
  text: string;
  title: string;
}

/**
 * Counts the elements in `html` matching `selector`, a convenience over
 * {@link htmlElementFacts} for scenario assertions (SPEC.md §12).
 *
 * @param html - The HTML to scan.
 * @param selector - Tag/attribute filter; an empty selector matches every element.
 * @returns The number of matching elements.
 */
export function htmlElementCount(html: string, selector: HtmlElementSelector = {}): number {
  return htmlElementFacts(html, selector).length;
}

/**
 * One named form control (`button`, `input`, `select`, or `textarea`) extracted
 * from a rendered form for scenario assertions (SPEC.md §12). Carries the
 * control's attribute map, outer markup, `name`, lowercased tag, `type`, and
 * `value` (falling back to inner content when no `value` attribute is set).
 */
export interface HtmlFormFieldFact {
  attrs: Record<string, string>;
  html: string;
  name: string;
  tag: string;
  type: string;
  value: string;
}

/**
 * One `<form>` extracted from a page response for scenario assertions (SPEC.md
 * §12): its resolved `action`, attribute map, named field facts, outer and inner
 * markup, and `method` (defaulting to `get`).
 */
export interface HtmlFormFact {
  action: string;
  attrs: Record<string, string>;
  fields: HtmlFormFieldFact[];
  html: string;
  innerHtml: string;
  method: string;
}

/**
 * One element carrying a `kovo-key` runtime identity (SPEC.md §13.2), extracted
 * for keyed-row scenario assertions (SPEC.md §12). Holds the element's attribute
 * map, outer and inner markup, the `kovo-key` value, lowercased tag, and its
 * collapsed text content.
 */
export interface HtmlKeyFact {
  attrs: Record<string, string>;
  html: string;
  innerHtml: string;
  key: string;
  tag: string;
  text: string;
}

/**
 * Parses `html` and returns a {@link HtmlElementFact} for every element matching
 * `selector`, the core extractor underlying the other fact helpers for
 * browser-free scenario assertions (SPEC.md §12).
 *
 * @param html - The HTML to scan.
 * @param selector - Tag/attribute filter; an empty selector matches every element.
 * @returns Facts for every matching element, in document order.
 */
export function htmlElementFacts(
  html: string,
  selector: HtmlElementSelector = {},
): HtmlElementFact[] {
  const facts: HtmlElementFact[] = [];
  const tag = selector.tag === undefined ? undefined : verifierStringToLowerCase(selector.tag);
  let offset = 0;

  while (offset < html.length) {
    const start = verifierStringIndexOf(html, '<', offset);
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
      verifierArrayPush(facts, {
        attrs,
        html: verifierStringSlice(html, element.index, end),
        innerHtml: verifierStringSlice(html, element.end, end - closingTagLength(element)),
        tag: element.tag,
      });
    }

    offset = isRawTextElement(element.tag) ? end : element.end;
  }

  return facts;
}

/**
 * Extracts document-level facts from a full page response for scenario
 * assertions (SPEC.md §12): body attributes, decoded inline JSON scripts (SPEC.md
 * §9.1), `<link>`/`<meta>` facts, body text, and the title.
 *
 * @param html - The full page HTML.
 * @returns The aggregated {@link HtmlDocumentFact}.
 */
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

/**
 * Collects the non-empty `href` values of `<link>` elements matching the given
 * attribute filter, for asserting document link targets (SPEC.md §12).
 *
 * @param html - The HTML to scan.
 * @param attrs - Attribute filter applied to candidate `<link>` elements.
 * @returns The matching links' `href` values, in document order.
 */
export function htmlLinkHrefs(html: string, attrs: Record<string, string | true> = {}): string[] {
  return filterArray(
    mapArray(htmlElementFacts(html, { attrs, tag: 'link' }), (link) => link.attrs.href ?? ''),
    (href) => href !== '',
  );
}

/**
 * Returns the decoded JSON values carried by `<kovo-query name="…">` wire
 * envelopes (SPEC.md §9.1) for the given query name, for asserting query payloads
 * in scenario tests (SPEC.md §12).
 *
 * @param html - The page or fragment-response HTML.
 * @param name - The `<kovo-query>` name to read.
 * @returns The decoded JSON values for that name, or an empty array when absent.
 */
export function kovoQueryJsonValues(html: string, name: string): unknown[] {
  return kovoResponseBodyFact(html).queryJsonByName[name] ?? [];
}

/**
 * Extracts a {@link HtmlFormFact} for every `<form>` in `html`, including its
 * named control fields, for browser-free form scenario assertions (SPEC.md §12).
 *
 * @param html - The page HTML to scan.
 * @returns Facts for every form, in document order.
 */
export function htmlFormFacts(html: string): HtmlFormFact[] {
  return mapArray(htmlElementFacts(html, { tag: 'form' }), (form) => ({
    action: form.attrs.action ?? '',
    attrs: form.attrs,
    fields: filterArray(
      mapArray(
        filterArray(htmlElementFacts(form.innerHtml), (element) => isFormFieldTag(element.tag)),
        (element) => ({
          attrs: element.attrs,
          html: element.html,
          name: element.attrs.name ?? '',
          tag: element.tag,
          type: element.attrs.type ?? '',
          value: element.attrs.value ?? element.innerHtml,
        }),
      ),
      (field) => field.name !== '',
    ),
    html: form.html,
    innerHtml: form.innerHtml,
    method: form.attrs.method ?? 'get',
  }));
}

/**
 * Returns the resolved `action` of every `<form>` in `html`, for asserting form
 * submission targets in scenario tests (SPEC.md §12).
 *
 * @param html - The page HTML to scan.
 * @returns Each form's `action`, in document order.
 */
export function htmlFormActions(html: string): string[] {
  return mapArray(htmlFormFacts(html), (form) => form.action);
}

/**
 * Flattens the named control fields across every `<form>` in `html`, optionally
 * filtered to a single field name, for form-field scenario assertions (SPEC.md
 * §12).
 *
 * @param html - The page HTML to scan.
 * @param name - When provided, restricts results to fields with this `name`.
 * @returns The matching field facts, in document order.
 */
export function htmlFormFields(html: string, name?: string): HtmlFormFieldFact[] {
  return filterArray(
    flatMapArray(htmlFormFacts(html), (form) => form.fields),
    (field) => name === undefined || field.name === name,
  );
}

/**
 * Indexes a form's fields by their `name`, for keyed lookup in scenario
 * assertions (SPEC.md §12). Returns an empty map when `form` is undefined; later
 * fields win on duplicate names.
 *
 * @param form - The form fact whose fields to index, or undefined.
 * @returns A map from field name to {@link HtmlFormFieldFact}.
 */
export function htmlFormFieldsByName(
  form: HtmlFormFact | undefined,
): Record<string, HtmlFormFieldFact> {
  return recordFromEntries(mapArray(form?.fields ?? [], (field) => [field.name, field] as const));
}

/**
 * Extracts a {@link HtmlKeyFact} for every element carrying a `kovo-key` runtime
 * identity (SPEC.md §13.2), optionally filtered to a single key, for keyed-row
 * scenario assertions (SPEC.md §12).
 *
 * @param html - The page or fragment HTML to scan.
 * @param key - When provided, restricts results to elements with this `kovo-key`.
 * @returns The matching key facts, in document order.
 */
export function htmlKeyFacts(html: string, key?: string): HtmlKeyFact[] {
  return filterArray(
    mapArray(
      filterArray(
        htmlElementFacts(html),
        (element) => ownRecordValue(element.attrs, 'kovo-key') !== undefined,
      ),
      (element) => ({
        attrs: element.attrs,
        html: element.html,
        innerHtml: element.innerHtml,
        key: ownRecordValue(element.attrs, 'kovo-key') ?? '',
        tag: element.tag,
        text: htmlTextContent(element.innerHtml),
      }),
    ),
    (fact) => key === undefined || fact.key === key,
  );
}

/**
 * Returns the `kovo-key` value (SPEC.md §13.2) of every keyed element in `html`,
 * for asserting the set and order of keyed rows in scenario tests (SPEC.md §12).
 *
 * @param html - The page or fragment HTML to scan.
 * @returns Each keyed element's `kovo-key`, in document order.
 */
export function htmlKeyValues(html: string): string[] {
  return mapArray(htmlKeyFacts(html), (fact) => fact.key);
}

/**
 * Maps each keyed element's `kovo-key` (SPEC.md §13.2) to its collapsed text
 * content, for asserting rendered text per keyed row in scenario tests (SPEC.md
 * §12). On duplicate keys, the later element's text wins.
 *
 * @param html - The page or fragment HTML to scan.
 * @returns A map from `kovo-key` to that element's text content.
 */
export function htmlKeyTextMap(html: string): Record<string, string> {
  return recordFromEntries(mapArray(htmlKeyFacts(html), (fact) => [fact.key, fact.text] as const));
}

/**
 * Strips tags from `html`, decodes HTML entities, and collapses whitespace to
 * single spaces (trimmed), yielding the visible text for content scenario
 * assertions (SPEC.md §12).
 *
 * @param html - The HTML fragment to reduce to text.
 * @returns The decoded, whitespace-collapsed text content.
 */
export function htmlTextContent(html: string): string {
  let text = '';
  let offset = 0;

  while (offset < html.length) {
    const start = verifierStringIndexOf(html, '<', offset);
    if (start === -1) {
      text += verifierStringSlice(html, offset);
      break;
    }

    text += verifierStringSlice(html, offset, start);

    const close = tagClose(html, start + 1);
    if (close === undefined) {
      text += verifierStringSlice(html, start);
      break;
    }

    offset = close + 1;
  }

  return verifierStringTrim(verifierStringReplace(decodeHtmlText(text), /\s+/g, ' '));
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

  return verifierStringSlice(html, fragmentStart.end, end - '</kovo-fragment>'.length);
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
    const start = verifierStringIndexOf(html, '<', offset);
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
  const head = verifierRegExpExec(/^<(?<tag>[a-z][a-z0-9-]*)\b/i, verifierStringSlice(html, start));
  if (!head?.groups?.tag) return undefined;

  const close = tagClose(html, start + head[0].length);
  if (close === undefined) return undefined;

  return {
    attrs: verifierStringSlice(html, start + head[0].length, close),
    end: close + 1,
    index: start,
    tag: verifierStringToLowerCase(head.groups.tag),
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
  if (verifierRegExpExec(/\/\s*$/, element.attrs) !== null || isVoidElement(element.tag))
    return element.end;
  if (isRawTextElement(element.tag)) return rawTextElementEnd(html, element);

  let offset = element.end;
  let depth = 1;

  while (offset < html.length) {
    const start = verifierStringIndexOf(html, '<', offset);
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
      if (opening.tag === element.tag && verifierRegExpExec(/\/\s*$/, opening.attrs) === null) {
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
  return verifierRegExpExec(/\/\s*$/, element.attrs) !== null || isVoidElement(element.tag)
    ? element.end
    : matchingElementEnd(html, element);
}

function rawTextElementEnd(html: string, element: OpeningElement): number | undefined {
  const closing = verifierRegExp(`</${escapeRegExp(element.tag)}\\s*>`, 'i');
  const match = verifierRegExpExec(closing, verifierStringSlice(html, element.end));
  return match ? element.end + match.index + match[0].length : undefined;
}

function readClosingElement(html: string, start: number): { end: number; tag: string } | undefined {
  const head = verifierRegExpExec(
    /^<\/(?<tag>[a-z][a-z0-9-]*)\b/i,
    verifierStringSlice(html, start),
  );
  if (!head?.groups?.tag) return undefined;

  const close = tagClose(html, start + head[0].length);
  if (close === undefined) return undefined;

  return {
    end: close + 1,
    tag: verifierStringToLowerCase(head.groups.tag),
  };
}

function readHtmlAttribute(attrs: string, name: string): string | null {
  const pattern = verifierRegExp(
    `(?:^|\\s)${escapeRegExp(name)}(?:\\s*=\\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\\s"'=<>\`]+)))?(?=\\s|$|/)`,
    'i',
  );
  const match = verifierRegExpExec(pattern, attrs);
  if (!match) return null;

  return match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? '';
}

function readHtmlAttributes(attrs: string): Record<string, string> {
  const result = verifierNullRecord<string>();
  const pattern =
    /(?:^|\s)(?<name>[^\s"'=<>`/]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`]+)))?(?=\s|$|\/)/gi;

  let match: RegExpExecArray | null;
  while ((match = verifierRegExpExec(pattern, attrs)) !== null) {
    const name = match.groups?.name;
    if (!name) continue;
    defineOwnRecordValue(
      result,
      verifierStringToLowerCase(name),
      match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? '',
    );
  }

  return result;
}

function selectorAttributesMatch(
  attrs: Record<string, string>,
  selectorAttrs: Record<string, string | true> | undefined,
): boolean {
  if (!selectorAttrs) return true;

  const selectorEntries = ownRecordEntries(selectorAttrs);
  for (let index = 0; index < selectorEntries.length; index += 1) {
    const [name, value] = selectorEntries[index]!;
    const actual = ownRecordValue(attrs, verifierStringToLowerCase(name));
    if (actual === undefined) return false;
    if (value !== true && actual !== value) return false;
  }
  return true;
}

function closingTagLength(element: OpeningElement): number {
  return verifierRegExpExec(/\/\s*$/, element.attrs) !== null || isVoidElement(element.tag)
    ? 0
    : element.tag.length + 3;
}

function isVoidElement(tag: string): boolean {
  switch (tag) {
    case 'area':
    case 'base':
    case 'br':
    case 'col':
    case 'embed':
    case 'hr':
    case 'img':
    case 'input':
    case 'link':
    case 'meta':
    case 'source':
    case 'track':
    case 'wbr':
      return true;
    default:
      return false;
  }
}

function isRawTextElement(tag: string): boolean {
  return tag === 'script' || tag === 'style';
}

function decodeHtmlText(text: string): string {
  const entity = /&(?:#(?<decimal>\d+)|#x(?<hex>[0-9a-f]+)|(?<named>amp|lt|gt|quot|apos));/gi;

  return verifierStringReplace(text, entity, (match, ...args: unknown[]) => {
    const groups = args[args.length - 1] as
      | { decimal?: string; hex?: string; named?: string }
      | undefined;
    const decimal = groups?.decimal;
    if (decimal !== undefined) return verifierStringFromCodePoint(verifierNumber(decimal));

    const hex = groups?.hex;
    if (hex !== undefined) return verifierStringFromCodePoint(verifierNumberParseInt(hex, 16));

    switch (groups?.named === undefined ? undefined : verifierStringToLowerCase(groups.named)) {
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
  return verifierStringReplace(value, /[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapArray<Input, Output>(
  values: readonly Input[],
  mapper: (value: Input, index: number) => Output,
): Output[] {
  const output: Output[] = [];
  for (let index = 0; index < values.length; index += 1) {
    verifierArrayPush(output, mapper(values[index]!, index));
  }
  return output;
}

function filterArray<Value>(
  values: readonly Value[],
  predicate: (value: Value, index: number) => boolean,
): Value[] {
  const output: Value[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (predicate(value, index)) verifierArrayPush(output, value);
  }
  return output;
}

function flatMapArray<Input, Output>(
  values: readonly Input[],
  mapper: (value: Input, index: number) => readonly Output[],
): Output[] {
  const output: Output[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const mapped = mapper(values[index]!, index);
    for (let mappedIndex = 0; mappedIndex < mapped.length; mappedIndex += 1) {
      verifierArrayPush(output, mapped[mappedIndex]!);
    }
  }
  return output;
}

function isFormFieldTag(tag: string): boolean {
  return tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea';
}

function defineOwnRecordValue<Value>(
  record: Record<string, Value>,
  key: string,
  value: Value,
): void {
  verifierDefineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function ownRecordValue<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Value | undefined {
  const descriptor = verifierGetOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw verifierTypeError('Kovo HTML fact records require own-data properties.');
  }
  return descriptor.value as Value;
}

function ownRecordEntries<Value>(
  record: Readonly<Record<string, Value>>,
): Array<readonly [string, Value]> {
  const entries: Array<readonly [string, Value]> = [];
  const keys = verifierObjectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = verifierGetOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw verifierTypeError('Kovo HTML selectors require stable own-data properties.');
    }
    verifierArrayPush(entries, [key, descriptor.value as Value]);
  }
  return entries;
}

function recordFromEntries<Value>(
  entries: readonly (readonly [string, Value])[],
): Record<string, Value> {
  const record = verifierNullRecord<Value>();
  for (let index = 0; index < entries.length; index += 1) {
    const [key, value] = entries[index]!;
    defineOwnRecordValue(record, key, value);
  }
  return record;
}
