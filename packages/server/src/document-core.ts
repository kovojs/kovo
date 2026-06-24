import {
  createInlineKovoLoaderSource,
  inlineKovoLoaderInstallerSource,
} from '@kovojs/browser/internal/inline-loader';
import {
  createCspNonce,
  cspHashAttribute,
  cspNonceAttribute,
  cspSha256,
  emptyCspInlineMetadata,
  mergeCspInlineMetadata,
  renderContentSecurityPolicy,
  type CspInlineMetadata,
} from './csp.js';
import { renderDeferredStream, type DeferredStreamChunk } from './deferred-stream.js';
import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';
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
 * Assembled document parts (`head`, `body`, `lang`, and serialized query
 * scripts) handed to a custom {@link DocumentTemplate} so it can frame the page
 * without dropping framework-required markup (SPEC.md §9.5).
 */
export interface DocumentParts {
  body: string;
  head: string;
  lang: string;
  queryScripts: readonly string[];
}

/** Context passed to a custom {@link DocumentTemplate} (SPEC.md §9.5). */
export interface DocumentTemplateContext {
  csp: CspInlineMetadata;
  parts: DocumentParts;
}

/** Custom document framing template applied via `AppDocumentOptions.template` (SPEC.md §9.5). */
export type DocumentTemplate = (context: DocumentTemplateContext) => string;

/** @internal */
export interface DeferredDocumentFrame {
  closeHtml: string;
  shell: string;
}

/** @internal */
export interface DeferredDocumentTemplateContext {
  csp: CspInlineMetadata;
  parts: DocumentParts;
}

/** @internal */
export type DeferredDocumentTemplate = (
  context: DeferredDocumentTemplateContext,
) => DeferredDocumentFrame;

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
  queries?: readonly QueryScriptRenderOptions[];
  /**
   * bugs-1 F13 / SPEC §9.3: an opaque per-session fingerprint. When present, stamped as
   * `<meta name="kovo-session" content="<fingerprint>">` so the client's BroadcastChannel
   * rebroadcast can discard cross-principal messages on shared devices.
   */
  sessionFingerprint?: string;
  template?: DocumentTemplate;
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
export interface DeferredDocumentAssemblyOptions extends Omit<DocumentAssemblyOptions, 'template'> {
  boundary?: string;
  chunks: readonly DeferredStreamChunk[];
  template?: DeferredDocumentTemplate | DocumentTemplate;
}

/** @internal */
export interface ErrorDocumentOptions {
  hints?: PageHintOptions;
  lang?: string;
  loaderRuntimeHref?: string;
  message?: string;
  status: 403 | 404 | 500;
  template?: DocumentTemplate;
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
  const assembled = assembleDocumentParts(options);
  const template = options.template ?? defaultDocumentTemplate;
  const html = template({ csp: assembled.csp, parts: assembled.parts });

  return {
    csp: assembled.csp,
    earlyHints: assembled.earlyHints,
    html: enforceDocumentTemplateParts(html, assembled.parts, 'DocumentTemplate'),
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
  const assembled = assembleDocumentParts(options);
  const template = options.template ?? defaultDeferredDocumentTemplate;
  const frame = deferredDocumentFrame(
    template({ csp: assembled.csp, parts: assembled.parts }),
    assembled.parts,
  );
  const shell = enforceDocumentTemplateParts(
    frame.shell,
    assembled.parts,
    'DeferredDocumentTemplate',
  );
  const response = renderDeferredStream({
    chunks: options.chunks,
    closeHtml: frame.closeHtml,
    cspNonce: assembled.csp.nonce,
    ...(options.boundary === undefined ? {} : { boundary: options.boundary }),
    shell,
  });

  return {
    ...response,
    // G1 (bugs-part3 CSP-1): merge the deferred stream's inline apply/cleanup script
    // hashes into the document CSP so a strict hash-CSP admits deferred hydration.
    csp: mergeCspInlineMetadata(assembled.csp, response.csp),
    headers: mergeDocumentHeaders(response.headers, assembled.earlyHints),
  };
}

function assembleDocumentParts(
  options: Pick<
    DocumentAssemblyOptions,
    | 'body'
    | 'buildToken'
    | 'hints'
    | 'lang'
    | 'loader'
    | 'queries'
    | 'sessionFingerprint'
    | 'loaderRuntimeHref'
  >,
): { csp: CspInlineMetadata; earlyHints: PageHints['earlyHints']; parts: DocumentParts } {
  const nonce = createCspNonce();
  // F2 (bugs-part3 L2-early-hints-2): thread the rendered query values into the head
  // hint context so a `metaFromQuery(...)` factory resolves against real data instead
  // of an always-empty `{}` (which previously made every such factory throw → a hard
  // 500 during head render). Map by query name, matching `RouteMetaFactory.queries`.
  const queryValues = queryValuesByName(options.queries ?? []);
  const hints = renderPageHints(options.hints ?? {}, {
    cspNonce: nonce,
    ...(Object.keys(queryValues).length > 0 ? { queries: queryValues } : {}),
  });
  const queryScripts = (options.queries ?? []).map((query) =>
    renderDocumentQueryScriptWithCsp(query, nonce),
  );
  const loader =
    options.loader === 'omit' ? undefined : inlineLoaderScript(options.loaderRuntimeHref, nonce);
  const csp = mergeCspInlineMetadata(
    { nonce, scripts: [], styles: [] },
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
    earlyHints: hints.earlyHints,
    parts: {
      body: options.body,
      head: `${buildMeta}${sessionMeta}${hints.html}${loader?.html ?? ''}`,
      lang: options.lang ?? langFromHints(options.hints) ?? 'en',
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
    // Phase 7 / SPEC §9.5: surface the assembled CSP metadata for compatibility, while
    // emitting the framework strict CSP by default below.
    csp: document.csp,
    headers: withDefaultDocumentSecurityHeaders(
      {
        ...mergeDocumentHeaders(response.headers, document.earlyHints),
        'Content-Type': 'text/html; charset=utf-8',
        // bugs-1 F34: guarded/session-dependent documents are not bfcache-restorable.
        ...(noStore ? { 'Cache-Control': 'no-store' } : {}),
      },
      document.csp,
    ),
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
export function renderErrorDocument(
  options: ErrorDocumentOptions,
): DocumentRoutePageResponseWithCsp {
  const title = options.title ?? fallbackTitles[options.status];
  const message = options.message ?? title;
  const document = renderDocument({
    body: `<main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`,
    hints: {
      ...options.hints,
      meta: [{ title }, ...withoutStaticTitleMeta(routeMetaArray(options.hints?.meta))],
    },
    ...(options.lang === undefined ? {} : { lang: options.lang }),
    ...(options.loaderRuntimeHref === undefined
      ? {}
      : { loaderRuntimeHref: options.loaderRuntimeHref }),
    ...(options.template === undefined ? {} : { template: options.template }),
  });

  return {
    body: document.html,
    csp: document.csp,
    headers: withDefaultDocumentSecurityHeaders(
      {
        ...document.earlyHints,
        'Content-Type': 'text/html; charset=utf-8',
      },
      document.csp,
    ),
    status: options.status,
  };
}

/** @internal */
export function withDefaultDocumentSecurityHeaders(
  headers: ResponseHeaders,
  csp: CspInlineMetadata = emptyCspInlineMetadata(),
): ResponseHeaders {
  const secured: ResponseHeaders = { ...headers };

  // Phase 7: documents emit the framework-owned strict CSP by default. If an app set
  // its own CSP, append Kovo's policy as a second enforcing policy so the fixed
  // base-uri/object-src/form-action/frame-ancestors floor remains non-overridable.
  appendHeaderValue(secured, 'Content-Security-Policy', renderContentSecurityPolicy(csp));

  // Baseline document security headers match the file/stream posture:
  // `nosniff` prevents MIME confusion; Referrer-Policy limits cross-origin leakage.
  if (findHeaderRecordName(secured, 'X-Content-Type-Options') === undefined) {
    secured['X-Content-Type-Options'] = 'nosniff';
  }
  if (findHeaderRecordName(secured, 'Referrer-Policy') === undefined) {
    secured['Referrer-Policy'] = 'strict-origin-when-cross-origin';
  }

  return secured;
}

function defaultDocumentTemplate({ parts }: DocumentTemplateContext): string {
  return [
    '<!doctype html>',
    `<html lang="${escapeAttribute(parts.lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    parts.head,
    parts.queryScripts.join(''),
    '</head>',
    '<body>',
    parts.body,
    '</body>',
    '</html>',
  ].join('');
}

function defaultDeferredDocumentTemplate({
  parts,
}: DeferredDocumentTemplateContext): DeferredDocumentFrame {
  return {
    closeHtml: '</body></html>',
    shell: [
      '<!doctype html>',
      `<html lang="${escapeAttribute(parts.lang)}">`,
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      parts.head,
      parts.queryScripts.join(''),
      '</head>',
      '<body>',
      parts.body,
    ].join(''),
  };
}

function deferredDocumentFrame(
  result: DeferredDocumentFrame | string,
  parts: DocumentParts,
): DeferredDocumentFrame {
  if (typeof result !== 'string') return result;

  const html = enforceDocumentTemplateParts(result, parts, 'DocumentTemplate');
  const bodyCloseIndex = html.toLowerCase().lastIndexOf('</body>');
  if (bodyCloseIndex < 0) {
    throw new Error('DocumentTemplate omitted </body>, which is required for deferred documents.');
  }

  return {
    closeHtml: html.slice(bodyCloseIndex),
    shell: html.slice(0, bodyCloseIndex),
  };
}

function enforceDocumentTemplateParts(
  html: string,
  parts: DocumentParts,
  templateName: string,
): string {
  const missing = requiredDocumentTemplateParts(parts).filter(({ value }) => !html.includes(value));
  if (missing.length === 0) return html;

  // SPEC §9.5: custom templates receive assembled parts rather than a blank
  // canvas, so they cannot silently drop loader, query scripts, or page body.
  throw new Error(
    `${templateName} omitted required assembled document part(s): ${missing
      .map(({ name }) => name)
      .join(', ')}.`,
  );
}

function requiredDocumentTemplateParts(
  parts: DocumentParts,
): readonly { name: string; value: string }[] {
  return [
    { name: 'parts.head', value: parts.head },
    ...parts.queryScripts.map((value, index) => ({
      name: `parts.queryScripts[${index}]`,
      value,
    })),
    { name: 'parts.body', value: parts.body },
  ].filter(({ value }) => value.length > 0);
}

function inlineLoaderScript(
  runtimeHref: string | undefined,
  nonce: string | undefined,
): {
  csp: CspInlineMetadata;
  html: string;
} {
  const source =
    runtimeHref === undefined
      ? `(${inlineKovoLoaderInstallerSource})((url)=>import(url));`
      : createInlineKovoLoaderSource(JSON.stringify(runtimeHref), '(url)=>import(url)');
  const hash = cspSha256(source);
  return {
    csp: { ...(nonce === undefined ? {} : { nonce }), scripts: [hash], styles: [] },
    html: `<script${cspNonceAttribute(nonce)} ${cspHashAttribute(hash)}>${source}</script>`,
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

function renderDocumentQueryScriptWithCsp(
  options: QueryScriptRenderOptions,
  nonce: string | undefined,
): {
  csp: CspInlineMetadata;
  html: string;
} {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;
  // SPEC §4.1 wire codec: normalize bigint/Date through the shared encode seam so a
  // bigint never throws (bugs-part4 L3/L4) and a Date round-trips as a Date (L5).
  const scriptText = escapeScriptJson(stringifyWireValue(options.value));
  const hash = cspSha256(scriptText);

  return {
    csp: { ...(nonce === undefined ? {} : { nonce }), scripts: [hash], styles: [] },
    html: `<script type="application/json" kovo-query="${escapeAttribute(options.name)}"${keyAttribute}${cspNonceAttribute(nonce)} ${cspHashAttribute(hash)}>${scriptText}</script>`,
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

function appendHeaderValue(headers: ResponseHeaders, name: string, value: string): void {
  const existingName = findHeaderRecordName(headers, name);
  if (existingName === undefined) {
    headers[name] = value;
    return;
  }

  const existing = headers[existingName];
  headers[existingName] = [...headerValueArray(existing ?? []), value];
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
