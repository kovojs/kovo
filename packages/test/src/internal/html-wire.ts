// SPEC.md §9.1: Kovo's internal mutation/query wire format (`<kovo-fragment>`,
// `<kovo-query>` envelopes, document query-script placement, and the `<main>`
// export marker). These fact extractors decode that internal wire shape and are
// only consumed by the private `@kovojs/conformance-fixtures` package and Kovo's
// own tests, so they live behind the `@kovojs/test/internal/html-wire` subpath
// rather than the public `./html-fragment` surface. The generic HTML element /
// form / key / text extractors they build on stay public in `../html-fragment.ts`.

import { htmlElementFacts, htmlKeyValues, type HtmlElementFact } from '../html-fragment.js';

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
  return htmlElementFacts(html, { attrs, tag: 'script' }).map((element) => ({
    attrs: element.attrs,
    html: element.html,
    json: JSON.parse(element.innerHtml),
    rawJson: element.innerHtml,
  }));
}

/** @internal */
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

/** @internal */
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

/** @internal */
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
