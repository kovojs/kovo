import {
  createInlineKovoLoaderSource,
  inlineKovoLoaderInstallerSource,
} from '@kovojs/browser/internal/inline-loader';
import {
  cspHashAttribute,
  cspSha256,
  mergeCspInlineMetadata,
  type CspInlineMetadata,
} from './csp.js';
import { renderDeferredStream, type DeferredStreamChunk } from './deferred-stream.js';
import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';
import { renderShellAttributes, type DocumentConfig } from './document-structured.js';
import {
  renderPageHints,
  type PageHintOptions,
  type PageHints,
  type RouteMetaSource,
} from './hints.js';
import {
  readHeader,
  type DocumentRouteResponseBase,
  type ResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import {
  renderQueryScript,
  stringifyWireValue,
  type QueryScriptRenderOptions,
} from './wire-html.js';

/**
 * Framework-owned assembled document parts consumed by the structured document
 * renderer (SPEC.md §9.5).
 *
 * @internal
 */
interface DocumentShellParts {
  body: string;
  head: string;
  lang: string;
  queryScripts: readonly string[];
}

interface DocumentAssemblyContext {
  csp: CspInlineMetadata;
  parts: DocumentShellParts;
}

/** @internal */
export interface DeferredDocumentFrame {
  closeHtml: string;
  shell: string;
}

/** @internal */
export interface DocumentAssemblyOptions {
  /**
   * Build-global render-plan version token (SPEC §5.1, §9.1.1). When present and
   * non-empty, stamped as `<meta name="kovo-build" content="<token>">` in the
   * document `<head>` so the client can detect deploy skew.
   */
  buildToken?: string;
  body: string;
  hints?: PageHintOptions;
  lang?: string;
  /**
   * Enhanced navigation may request a canonical document variant without the
   * already-installed inline loader. Ordinary documents keep the SPEC §4.4
   * bootstrap inline.
   */
  loader?: 'inline' | 'omit';
  loaderRuntimeHref?: string;
  document?: DocumentConfig;
  queries?: readonly QueryScriptRenderOptions[];
  /**
   * bugs-1 F13 / SPEC §9.3: an opaque per-session fingerprint. When present, stamped as
   * `<meta name="kovo-session" content="<fingerprint>">` so the client's BroadcastChannel
   * rebroadcast can discard cross-principal messages on shared devices.
   */
  sessionFingerprint?: string;
}

/** @internal */
export interface DocumentRoutePageResponse extends DocumentRouteResponseBase {
  /** @internal Deferred route-region chunks streamed after the initial document shell. */
  deferredChunks?: readonly DeferredStreamChunk[];
}

/**
 * @internal CSP-3 (bugs-part3): a wrapped HTML document response that additionally
 * surfaces the assembled inline-script/style CSP hashes (`document.csp`) so the
 * dispatch path can attach a `Content-Security-Policy` header when the app opts in.
 * `csp` is present only on a wrapped HTML document (status 200, text/html); a
 * pass-through non-HTML outcome carries no `csp`.
 */
export interface DocumentRoutePageResponseWithCsp extends DocumentRoutePageResponse {
  csp?: CspInlineMetadata;
}

/** @internal */
export interface DocumentResponseOptions extends Omit<DocumentAssemblyOptions, 'body'> {
  /**
   * bugs-1 F34 / SPEC §8: a guarded or session-dependent route document carries
   * `Cache-Control: no-store` so the browser's bfcache can never restore an
   * authenticated page after logout/expiry without re-running the route guard.
   */
  noStore?: boolean;
}

/** @internal */
export interface DeferredDocumentAssemblyOptions extends DocumentAssemblyOptions {
  boundary?: string;
  chunks: readonly DeferredStreamChunk[];
}

/** @internal */
export interface ErrorDocumentOptions {
  document?: DocumentConfig;
  hints?: PageHintOptions;
  lang?: string;
  loaderRuntimeHref?: string;
  message?: string;
  status: 403 | 404 | 500;
  title?: string;
}

/** @internal */
export interface DocumentRenderResult {
  csp: CspInlineMetadata;
  earlyHints: PageHints['earlyHints'];
  html: string;
}

/** @internal */
export interface DeferredDocumentRenderResult extends ServerResponseBase<
  string,
  ResponseHeaders,
  200
> {
  csp: CspInlineMetadata;
}

const fallbackTitles = {
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Server Error',
} as const;

/**
 * Assemble a complete Kovo document for framework-owned response rendering.
 *
 * @internal
 */
export function renderDocument(options: DocumentAssemblyOptions): DocumentRenderResult {
  const assembled = assembleDocumentShellParts(options);
  const context = { csp: assembled.csp, parts: assembled.parts };
  const html = renderStructuredDocumentShell(context, assembled.document);

  return {
    csp: assembled.csp,
    earlyHints: assembled.earlyHints,
    html,
  };
}

/**
 * Assemble a deferred Kovo document response for framework-owned streaming.
 *
 * @internal
 */
export function renderDeferredDocument(
  options: DeferredDocumentAssemblyOptions,
): DeferredDocumentRenderResult {
  const assembled = assembleDocumentShellParts(options);
  const frame = renderStructuredDeferredDocumentShell(
    { csp: assembled.csp, parts: assembled.parts },
    assembled.document,
  );
  const response = renderDeferredStream({
    chunks: options.chunks,
    closeHtml: frame.closeHtml,
    ...(options.boundary === undefined ? {} : { boundary: options.boundary }),
    shell: frame.shell,
  });

  return {
    ...response,
    // G1 (bugs-part3 CSP-1): merge the deferred stream's inline apply/cleanup script
    // hashes into the document CSP so a strict hash-CSP admits deferred hydration.
    csp: mergeCspInlineMetadata(assembled.csp, response.csp),
    headers: mergeDocumentHeaders(response.headers, assembled.earlyHints),
  };
}

function assembleDocumentShellParts(
  options: Pick<
    DocumentAssemblyOptions,
    | 'body'
    | 'buildToken'
    | 'document'
    | 'hints'
    | 'lang'
    | 'loader'
    | 'queries'
    | 'sessionFingerprint'
    | 'loaderRuntimeHref'
  >,
): {
  csp: CspInlineMetadata;
  document: DocumentConfig | undefined;
  earlyHints: PageHints['earlyHints'];
  parts: DocumentShellParts;
} {
  // F2 (bugs-part3 L2-early-hints-2): thread the rendered query values into the head
  // hint context so a `metaFromQuery(...)` factory resolves against real data instead
  // of an always-empty `{}` (which previously made every such factory throw → a hard
  // 500 during head render). Map by query name, matching `RouteMetaFactory.queries`.
  const queryValues = queryValuesByName(options.queries ?? []);
  const hints = renderPageHints(
    options.hints ?? {},
    Object.keys(queryValues).length > 0 ? { queries: queryValues } : {},
  );
  const queryScripts = (options.queries ?? []).map(renderDocumentQueryScriptWithCsp);
  const loader =
    options.loader === 'omit' ? undefined : inlineLoaderScript(options.loaderRuntimeHref);
  const csp = mergeCspInlineMetadata(
    options.document?.csp,
    hints.csp,
    ...(loader === undefined ? [] : [loader.csp]),
    ...queryScripts.map((query) => query.csp),
  );

  // Stamp the build-token meta tag once per document (SPEC §5.1, §9.1.1,
  // §5.2.1 rule 2(b)). The token is now always non-empty (DEPLOY-3) so we only
  // check for presence, not emptiness.
  const buildMeta =
    options.buildToken !== undefined
      ? `<meta name="kovo-build" content="${escapeAttribute(options.buildToken)}">`
      : '';

  // bugs-1 F13 / SPEC §9.3: stamp the opaque per-session fingerprint for the client's
  // cross-principal BroadcastChannel discard.
  const sessionMeta =
    options.sessionFingerprint !== undefined && options.sessionFingerprint !== ''
      ? `<meta name="kovo-session" content="${escapeAttribute(options.sessionFingerprint)}">`
      : '';

  return {
    csp,
    document: options.document,
    earlyHints: hints.earlyHints,
    parts: {
      body: options.body,
      head: `${buildMeta}${sessionMeta}${hints.html}${loader?.html ?? ''}`,
      lang: options.lang ?? options.document?.lang ?? langFromHints(options.hints) ?? 'en',
      queryScripts: queryScripts.map((query) => query.html),
    },
  };
}

/**
 * Wrap a rendered route body in a full document for framework dispatch.
 *
 * @internal
 */
export function renderRouteDocumentResponse(
  response: DocumentRoutePageResponse,
  options: DocumentResponseOptions = {},
): DocumentRoutePageResponseWithCsp {
  const { noStore, ...assemblyOptions } = options;
  const contentType = readHeader(response.headers, 'Content-Type');
  if (
    response.status !== 200 ||
    typeof response.body !== 'string' ||
    (contentType !== undefined && !contentType.toLowerCase().includes('text/html'))
  ) {
    return response;
  }

  const document =
    response.deferredChunks && response.deferredChunks.length > 0
      ? deferredDocumentResult(
          renderDeferredDocument({
            ...assemblyOptions,
            body: response.body,
            chunks: response.deferredChunks,
          }),
        )
      : standardDocumentResult(
          renderDocument({
            ...assemblyOptions,
            body: response.body,
          }),
        );

  return {
    body: document.html,
    // CSP-3 (bugs-part3): surface the assembled CSP so the dispatch path can attach a
    // `Content-Security-Policy` header when the app opts in (previously discarded).
    csp: document.csp,
    headers: {
      ...mergeDocumentHeaders(response.headers, document.earlyHints),
      'Content-Type': 'text/html; charset=utf-8',
      // CSP-3 (bugs-part3): baseline security headers on every HTML document, matching
      // the file/stream posture (response.ts routeOutcomeHeaders). `nosniff` stops
      // content-type sniffing; `Referrer-Policy` limits cross-origin referrer leakage.
      // Authors may override by setting these headers on the route response (preserved
      // by `mergeDocumentHeaders` above, which keeps the existing header name).
      ...(findHeaderRecordName(response.headers, 'X-Content-Type-Options') === undefined
        ? { 'X-Content-Type-Options': 'nosniff' }
        : {}),
      ...(findHeaderRecordName(response.headers, 'Referrer-Policy') === undefined
        ? { 'Referrer-Policy': 'strict-origin-when-cross-origin' }
        : {}),
      // bugs-1 F34: guarded/session-dependent documents are not bfcache-restorable.
      ...(noStore ? { 'Cache-Control': 'no-store' } : {}),
    },
    status: response.status,
  };
}

function standardDocumentResult(document: DocumentRenderResult): {
  csp: CspInlineMetadata;
  earlyHints: ResponseHeaders;
  html: string;
} {
  return document;
}

function deferredDocumentResult(document: DeferredDocumentRenderResult): {
  csp: CspInlineMetadata;
  earlyHints: ResponseHeaders;
  html: string;
} {
  return {
    csp: document.csp,
    earlyHints: document.headers,
    html: document.body,
  };
}

/** @internal */
export { renderQueryScript as renderDocumentQueryScript };
export type { QueryScriptRenderOptions };

/**
 * Render a framework-owned error document.
 *
 * @internal
 */
export function renderErrorDocument(options: ErrorDocumentOptions): DocumentRoutePageResponse {
  const title = options.title ?? fallbackTitles[options.status];
  const message = options.message ?? title;
  const document = renderDocument({
    body: `<main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`,
    ...(options.document === undefined ? {} : { document: options.document }),
    hints: {
      ...options.hints,
      meta: [{ title }, ...withoutStaticTitleMeta(routeMetaArray(options.hints?.meta))],
    },
    ...(options.lang === undefined ? {} : { lang: options.lang }),
    ...(options.loaderRuntimeHref === undefined
      ? {}
      : { loaderRuntimeHref: options.loaderRuntimeHref }),
  });

  return {
    body: document.html,
    headers: {
      ...document.earlyHints,
      'Content-Type': 'text/html; charset=utf-8',
      // CSP-3 (bugs-part3): error documents are HTML responses too; carry the same
      // baseline security headers as successful documents.
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
    status: options.status,
  };
}

function renderStructuredDocumentShell(
  { parts }: DocumentAssemblyContext,
  document: DocumentConfig | undefined,
): string {
  const htmlAttrs = {
    lang: parts.lang,
    ...document?.htmlAttrs,
  };
  return [
    '<!doctype html>',
    `<html${renderShellAttributes(htmlAttrs)}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...(document?.head ?? []),
    parts.head,
    parts.queryScripts.join(''),
    '</head>',
    `<body${renderShellAttributes(document?.bodyAttrs ?? {})}>`,
    ...(document?.bodyStart ?? []),
    parts.body,
    ...(document?.bodyEnd ?? []),
    '</body>',
    '</html>',
  ].join('');
}

function renderStructuredDeferredDocumentShell(
  { parts }: DocumentAssemblyContext,
  document: DocumentConfig | undefined,
): DeferredDocumentFrame {
  const htmlAttrs = {
    lang: parts.lang,
    ...document?.htmlAttrs,
  };
  return {
    closeHtml: [...(document?.bodyEnd ?? []), '</body></html>'].join(''),
    shell: [
      '<!doctype html>',
      `<html${renderShellAttributes(htmlAttrs)}>`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      ...(document?.head ?? []),
      parts.head,
      parts.queryScripts.join(''),
      '</head>',
      `<body${renderShellAttributes(document?.bodyAttrs ?? {})}>`,
      ...(document?.bodyStart ?? []),
      parts.body,
    ].join(''),
  };
}

function inlineLoaderScript(runtimeHref: string | undefined): {
  csp: CspInlineMetadata;
  html: string;
} {
  const source =
    runtimeHref === undefined
      ? `(${inlineKovoLoaderInstallerSource})((url)=>import(url));`
      : createInlineKovoLoaderSource(JSON.stringify(runtimeHref), '(url)=>import(url)');
  const hash = cspSha256(source);
  return {
    csp: { scripts: [hash], styles: [] },
    html: `<script ${cspHashAttribute(hash)}>${source}</script>`,
  };
}

/**
 * F2 (bugs-part3 L2-early-hints-2): index rendered query values by query name so a
 * `metaFromQuery(...)` head factory (whose `queries` are query names) can resolve
 * against the same data the page rendered. The instance `key` is separate; meta
 * derives from the named query value.
 */
function queryValuesByName(queries: readonly QueryScriptRenderOptions[]): Record<string, unknown> {
  const byName: Record<string, unknown> = {};
  for (const query of queries) {
    byName[query.name] = query.value;
  }
  return byName;
}

function renderDocumentQueryScriptWithCsp(options: QueryScriptRenderOptions): {
  csp: CspInlineMetadata;
  html: string;
} {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;
  // SPEC §4.1 wire codec: normalize bigint/Date through the shared encode seam so a
  // bigint never throws (bugs-part4 L3/L4) and a Date round-trips as a Date (L5).
  const scriptText = escapeScriptJson(stringifyWireValue(options.value));
  const hash = cspSha256(scriptText);

  return {
    csp: { scripts: [hash], styles: [] },
    html: `<script type="application/json" kovo-query="${escapeAttribute(options.name)}"${keyAttribute} ${cspHashAttribute(hash)}>${scriptText}</script>`,
  };
}

function langFromHints(hints: PageHintOptions | undefined): string | undefined {
  const firstCatalog = arrayFrom(hints?.i18n)?.[0];
  return firstCatalog?.locale;
}

function arrayFrom<T>(value: T | readonly T[] | undefined): readonly T[] | undefined {
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value : [value]) as readonly T[];
}

function routeMetaArray(value: PageHintOptions['meta']): readonly RouteMetaSource[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? (value as readonly RouteMetaSource[]) : [value as RouteMetaSource];
}

function withoutStaticTitleMeta(metas: readonly RouteMetaSource[]): readonly RouteMetaSource[] {
  return metas.map((meta) => {
    if ('resolve' in meta) return meta;
    const { title: _title, ...rest } = meta;
    return rest;
  });
}

function mergeDocumentHeaders(
  headers: ResponseHeaders,
  earlyHints: ResponseHeaders,
): ResponseHeaders {
  const merged: ResponseHeaders = { ...headers };

  for (const [name, value] of Object.entries(earlyHints)) {
    const existingName = findHeaderRecordName(merged, name);
    if (existingName === undefined) {
      merged[name] = value;
      continue;
    }

    const existingValue = merged[existingName];
    merged[existingName] =
      existingValue === undefined
        ? value
        : [...headerValueArray(existingValue), ...headerValueArray(value)].join(', ');
  }

  return merged;
}

function headerValueArray(value: string | readonly string[]): readonly string[] {
  return typeof value === 'string' ? [value] : value;
}

export function mergeVaryHeader(headers: ResponseHeaders, token: string): ResponseHeaders {
  const merged: ResponseHeaders = { ...headers };
  const existingName = findHeaderRecordName(merged, 'Vary');
  if (existingName === undefined) {
    merged.Vary = token;
    return merged;
  }

  const existing = merged[existingName];
  const values = (Array.isArray(existing) ? existing.join(', ') : (existing ?? ''))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === token.toLowerCase())) {
    values.push(token);
  }
  merged[existingName] = values.join(', ');
  return merged;
}

function findHeaderRecordName(headers: ResponseHeaders, name: string): string | undefined {
  const normalized = name.toLowerCase();
  return Object.keys(headers).find((headerName) => headerName.toLowerCase() === normalized);
}
