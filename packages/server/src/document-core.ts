import { kovoLoaderSource } from '@kovojs/runtime/internal/inline-loader';
import {
  cspHashAttribute,
  cspSha256,
  mergeCspInlineMetadata,
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
import { readHeader, type DocumentRouteResponseBase, type ServerResponseBase } from './response.js';
import { renderQueryScript, type QueryScriptRenderOptions } from './wire-html.js';

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
  queries?: readonly QueryScriptRenderOptions[];
  template?: DocumentTemplate;
}

/** @internal */
export interface DocumentRoutePageResponse extends DocumentRouteResponseBase {}

/** @internal */
export interface DocumentResponseOptions extends Omit<DocumentAssemblyOptions, 'body'> {}

/** @internal */
export interface DeferredDocumentAssemblyOptions extends Omit<DocumentAssemblyOptions, 'template'> {
  boundary?: string;
  chunks: readonly DeferredStreamChunk[];
  template?: DeferredDocumentTemplate;
}

/** @internal */
export interface ErrorDocumentOptions {
  hints?: PageHintOptions;
  lang?: string;
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
  Record<string, string>,
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
  const frame = template({ csp: assembled.csp, parts: assembled.parts });
  const shell = enforceDocumentTemplateParts(
    frame.shell,
    assembled.parts,
    'DeferredDocumentTemplate',
  );
  const response = renderDeferredStream({
    chunks: options.chunks,
    closeHtml: frame.closeHtml,
    ...(options.boundary === undefined ? {} : { boundary: options.boundary }),
    shell,
  });

  return {
    ...response,
    csp: assembled.csp,
    headers: mergeDocumentHeaders(response.headers, assembled.earlyHints),
  };
}

function assembleDocumentParts(
  options: Pick<DocumentAssemblyOptions, 'body' | 'buildToken' | 'hints' | 'lang' | 'queries'>,
): { csp: CspInlineMetadata; earlyHints: PageHints['earlyHints']; parts: DocumentParts } {
  const hints = renderPageHints(options.hints ?? {});
  const queryScripts = (options.queries ?? []).map(renderDocumentQueryScriptWithCsp);
  const loader = inlineLoaderScript();
  const csp = mergeCspInlineMetadata(
    hints.csp,
    loader.csp,
    ...queryScripts.map((query) => query.csp),
  );

  // Stamp the build-token meta tag once per document (SPEC §5.1, §9.1.1).
  const buildMeta =
    options.buildToken !== undefined && options.buildToken !== ''
      ? `<meta name="kovo-build" content="${escapeAttribute(options.buildToken)}">`
      : '';

  return {
    csp,
    earlyHints: hints.earlyHints,
    parts: {
      body: options.body,
      head: `${buildMeta}${hints.html}${loader.html}`,
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
): DocumentRoutePageResponse {
  const contentType = readHeader(response.headers, 'Content-Type');
  if (
    response.status !== 200 ||
    typeof response.body !== 'string' ||
    (contentType !== undefined && !contentType.toLowerCase().includes('text/html'))
  ) {
    return response;
  }

  const document = renderDocument({
    ...options,
    body: response.body,
  });

  return {
    body: document.html,
    headers: {
      ...mergeDocumentHeaders(response.headers, document.earlyHints),
      'Content-Type': 'text/html; charset=utf-8',
    },
    status: response.status,
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
    hints: {
      ...options.hints,
      meta: [{ title }, ...withoutStaticTitleMeta(routeMetaArray(options.hints?.meta))],
    },
    ...(options.lang === undefined ? {} : { lang: options.lang }),
    ...(options.template === undefined ? {} : { template: options.template }),
  });

  return {
    body: document.html,
    headers: {
      ...document.earlyHints,
      'Content-Type': 'text/html; charset=utf-8',
    },
    status: options.status,
  };
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

function inlineLoaderScript(): { csp: CspInlineMetadata; html: string } {
  const hash = cspSha256(kovoLoaderSource);
  return {
    csp: { scripts: [hash], styles: [] },
    html: `<script ${cspHashAttribute(hash)}>${kovoLoaderSource}</script>`,
  };
}

function renderDocumentQueryScriptWithCsp(options: QueryScriptRenderOptions): {
  csp: CspInlineMetadata;
  html: string;
} {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;
  const scriptText = escapeScriptJson(JSON.stringify(options.value));
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
  headers: Record<string, string>,
  earlyHints: PageHints['earlyHints'],
): Record<string, string> {
  const merged = { ...headers };

  for (const [name, value] of Object.entries(earlyHints)) {
    const existingName = findHeaderRecordName(merged, name);
    if (existingName === undefined) {
      merged[name] = value;
      continue;
    }

    merged[existingName] = `${merged[existingName]}, ${value}`;
  }

  return merged;
}

function findHeaderRecordName(headers: Record<string, string>, name: string): string | undefined {
  const normalized = name.toLowerCase();
  return Object.keys(headers).find((headerName) => headerName.toLowerCase() === normalized);
}
