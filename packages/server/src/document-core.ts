import { jisoLoaderSource } from '@jiso/runtime';
import { renderDeferredStream, type DeferredStreamChunk } from './deferred-stream.js';
import { escapeAttribute, escapeHtml } from './html.js';
import {
  renderPageHints,
  type PageHintOptions,
  type PageHints,
  type RouteMetaSource,
} from './hints.js';
import { readHeader, type DocumentRouteResponseBase, type ServerResponseBase } from './response.js';
import { renderQueryScript, type QueryScriptRenderOptions } from './wire-html.js';

export interface DocumentParts {
  body: string;
  head: string;
  lang: string;
  queryScripts: readonly string[];
}

export interface DocumentTemplateContext {
  parts: DocumentParts;
}

export type DocumentTemplate = (context: DocumentTemplateContext) => string;

export interface DeferredDocumentFrame {
  closeHtml: string;
  shell: string;
}

export interface DeferredDocumentTemplateContext {
  parts: DocumentParts;
}

export type DeferredDocumentTemplate = (
  context: DeferredDocumentTemplateContext,
) => DeferredDocumentFrame;

export interface DocumentAssemblyOptions {
  body: string;
  hints?: PageHintOptions;
  lang?: string;
  queries?: readonly QueryScriptRenderOptions[];
  template?: DocumentTemplate;
}

export interface DocumentRoutePageResponse extends DocumentRouteResponseBase {}

export interface DocumentResponseOptions extends Omit<DocumentAssemblyOptions, 'body'> {}

export interface DeferredDocumentAssemblyOptions extends Omit<DocumentAssemblyOptions, 'template'> {
  boundary?: string;
  chunks: readonly DeferredStreamChunk[];
  template?: DeferredDocumentTemplate;
}

export interface ErrorDocumentOptions {
  hints?: PageHintOptions;
  lang?: string;
  message?: string;
  status: 403 | 404 | 500;
  template?: DocumentTemplate;
  title?: string;
}

export interface DocumentRenderResult {
  earlyHints: PageHints['earlyHints'];
  html: string;
}

export interface DeferredDocumentRenderResult extends ServerResponseBase<
  string,
  Record<string, string>,
  200
> {}

const fallbackTitles = {
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Server Error',
} as const;

export function renderDocument(options: DocumentAssemblyOptions): DocumentRenderResult {
  const assembled = assembleDocumentParts(options);

  return {
    earlyHints: assembled.earlyHints,
    html: (options.template ?? defaultDocumentTemplate)({ parts: assembled.parts }),
  };
}

export function renderDeferredDocument(
  options: DeferredDocumentAssemblyOptions,
): DeferredDocumentRenderResult {
  const assembled = assembleDocumentParts(options);
  const frame = (options.template ?? defaultDeferredDocumentTemplate)({ parts: assembled.parts });
  const response = renderDeferredStream({
    chunks: options.chunks,
    closeHtml: frame.closeHtml,
    ...(options.boundary === undefined ? {} : { boundary: options.boundary }),
    shell: frame.shell,
  });

  return {
    ...response,
    headers: mergeDocumentHeaders(response.headers, assembled.earlyHints),
  };
}

function assembleDocumentParts(
  options: Pick<DocumentAssemblyOptions, 'body' | 'hints' | 'lang' | 'queries'>,
): { earlyHints: PageHints['earlyHints']; parts: DocumentParts } {
  const hints = renderPageHints(options.hints ?? {});
  const queryScripts = (options.queries ?? []).map(renderQueryScript);

  return {
    earlyHints: hints.earlyHints,
    parts: {
      body: options.body,
      head: `${hints.html}${inlineLoaderScript()}`,
      lang: options.lang ?? langFromHints(options.hints) ?? 'en',
      queryScripts,
    },
  };
}

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

export { renderQueryScript as renderDocumentQueryScript };
export type { QueryScriptRenderOptions };

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

function inlineLoaderScript(): string {
  return `<script>${jisoLoaderSource}</script>`;
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
