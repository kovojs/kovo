// SPEC.md §9.1: Kovo's internal mutation/query wire format (`<kovo-fragment>`,
// `<kovo-query>` envelopes, document query-script placement, and the `<main>`
// export marker). These fact extractors decode that internal wire shape and are
// only consumed by the private `@kovojs/conformance-fixtures` package and Kovo's
// own tests, so they live behind the `@kovojs/test/internal/html-wire` subpath
// rather than the public `./html-fragment` surface. The generic HTML element /
// form / key / text extractors they build on stay public in `../html-fragment.ts`.

import { htmlElementFacts, htmlKeyValues, type HtmlElementFact } from '@kovojs/test/html-fragment';
import {
  verifierArrayPush,
  verifierDefineProperty,
  verifierGetOwnPropertyDescriptor,
  verifierJsonParse,
  verifierNullRecord,
  verifierTypeError,
} from '../verifier-security-intrinsics.js';

/** @internal */
export interface HtmlJsonScriptFact {
  attrs: Record<string, string>;
  html: string;
  json: unknown;
  rawJson: string;
}

/** @internal */
export interface HtmlDocumentRegions {
  body: HtmlElementFact;
  head: HtmlElementFact;
  html: HtmlElementFact;
}

/** @internal */
export interface HtmlMainMarkerFact {
  attribute: string;
  mainCount: number;
  marker: string | undefined;
}

/** @internal */
export interface KovoQueryFact {
  attrs: Record<string, string>;
  html: string;
  json: unknown;
  name: string;
  rawJson: string;
  tag: string;
}

/** @internal */
export interface KovoFragmentFact {
  attrs: Record<string, string>;
  html: string;
  innerHtml: string;
  stylesheetHrefs: string[];
  target: string;
}

/** @internal */
export interface KovoResponseBodyFact {
  fragmentTargets: string[];
  fragments: KovoFragmentFact[];
  keyValues: string[];
  queries: KovoQueryFact[];
  queryJsonByName: Record<string, unknown[]>;
  queryNames: string[];
  stylesheetHrefsByTarget: Record<string, string[]>;
}

/** @internal */
export interface DocumentQueryScriptBehaviorFact {
  bodyElements: HtmlElementFact[];
  bodyQueryScripts: Array<Pick<KovoQueryFact, 'attrs' | 'rawJson'>>;
  documentQueryScripts: Array<Pick<KovoQueryFact, 'attrs' | 'rawJson'>>;
  headQueryScripts: Array<Pick<KovoQueryFact, 'attrs' | 'rawJson'>>;
  renderedDocumentQueryScript: string;
  renderedQueryScript: string;
}

/** @internal */
export function htmlJsonScriptFacts(
  html: string,
  attrs: Record<string, string | true> = { type: 'application/json' },
): HtmlJsonScriptFact[] {
  return mapArray(htmlElementFacts(html, { attrs, tag: 'script' }), (element) => ({
    attrs: element.attrs,
    html: element.html,
    json: verifierJsonParse(element.innerHtml),
    rawJson: element.innerHtml,
  }));
}

/** @internal */
export function htmlDocumentRegions(html: string): HtmlDocumentRegions {
  const htmlRegions = htmlElementFacts(html, { tag: 'html' });
  const headRegions = htmlElementFacts(html, { tag: 'head' });
  const bodyRegions = htmlElementFacts(html, { tag: 'body' });

  if (htmlRegions.length !== 1 || headRegions.length !== 1 || bodyRegions.length !== 1) {
    throw verifierTypeError(
      `Expected one html/head/body document region; found html=${htmlRegions.length} head=${headRegions.length} body=${bodyRegions.length}`,
    );
  }

  return {
    body: bodyRegions[0]!,
    head: headRegions[0]!,
    html: htmlRegions[0]!,
  };
}

/** @internal */
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

/** @internal */
export function kovoQueryFacts(html: string, name?: string): KovoQueryFact[] {
  return filterArray(
    mapArray(
      filterArray(
        htmlElementFacts(html),
        (element) =>
          element.tag === 'kovo-query' ||
          (element.tag === 'script' && element.attrs['kovo-query'] !== undefined),
      ),
      (element) => {
        const queryName = element.attrs.name ?? element.attrs['kovo-query'] ?? '';
        return {
          attrs: element.attrs,
          html: element.html,
          json: verifierJsonParse(element.innerHtml),
          name: queryName,
          rawJson: element.innerHtml,
          tag: element.tag,
        };
      },
    ),
    (fact) => name === undefined || fact.name === name,
  );
}

/** @internal */
export function kovoFragmentFacts(html: string, target?: string): KovoFragmentFact[] {
  return filterArray(
    mapArray(htmlElementFacts(html, { tag: 'kovo-fragment' }), (element) => ({
      attrs: element.attrs,
      html: element.html,
      innerHtml: element.innerHtml,
      stylesheetHrefs: mapArray(
        htmlElementFacts(element.innerHtml, {
          attrs: { rel: 'stylesheet' },
          tag: 'link',
        }),
        (link) => link.attrs.href ?? '',
      ),
      target: element.attrs.target ?? '',
    })),
    (fact) => target === undefined || fact.target === target,
  );
}

/** @internal */
export function kovoResponseBodyFact(html: string): KovoResponseBodyFact {
  const queries = kovoQueryFacts(html);
  const fragments = kovoFragmentFacts(html);

  return {
    fragmentTargets: mapArray(fragments, (fragment) => fragment.target),
    fragments,
    keyValues: htmlKeyValues(html),
    queries,
    queryJsonByName: groupQueryJsonByName(queries),
    queryNames: mapArray(queries, (query) => query.name),
    stylesheetHrefsByTarget: recordFromEntries(
      mapArray(fragments, (fragment) => [fragment.target, fragment.stylesheetHrefs] as const),
    ),
  };
}

/** @internal */
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

function groupQueryJsonByName(queries: KovoQueryFact[]): Record<string, unknown[]> {
  const grouped = verifierNullRecord<unknown[]>();

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index]!;
    let values = ownRecordValue(grouped, query.name);
    if (values === undefined) {
      values = [];
      defineOwnRecordValue(grouped, query.name, values);
    }
    verifierArrayPush(values, query.json);
  }

  return grouped;
}

function compactQueryScriptFacts(
  queries: KovoQueryFact[],
): Array<Pick<KovoQueryFact, 'attrs' | 'rawJson'>> {
  return mapArray(queries, (query) => ({
    attrs: query.attrs,
    rawJson: query.rawJson,
  }));
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

function ownRecordValue<Value>(record: Record<string, Value>, key: string): Value | undefined {
  const descriptor = verifierGetOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw verifierTypeError('Kovo HTML wire records require own-data properties.');
  }
  return descriptor.value as Value;
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
