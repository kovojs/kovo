import { jisoLoaderSource } from '@jiso/runtime';
import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';
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

export interface DiagnosticDocumentDiagnostic {
  code: DiagnosticCode;
  fileName?: string;
  help?: string;
  length?: number;
  message: string;
  severity?: DiagnosticSeverity;
  start?: {
    column: number;
    line: number;
  };
}

export interface DiagnosticDocumentSource {
  fileName?: string;
  source: string;
}

export interface DiagnosticDocumentOptions {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  lang?: string;
  source?: DiagnosticDocumentSource | string;
  template?: DocumentTemplate;
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

export function renderDiagnosticDocument(
  diagnostics: readonly DiagnosticDocumentDiagnostic[],
  source?: DiagnosticDocumentSource | string,
): DocumentRoutePageResponse;
export function renderDiagnosticDocument(
  options: DiagnosticDocumentOptions,
): DocumentRoutePageResponse;
export function renderDiagnosticDocument(
  input: DiagnosticDocumentOptions | readonly DiagnosticDocumentDiagnostic[],
  source?: DiagnosticDocumentSource | string,
): DocumentRoutePageResponse {
  const options: DiagnosticDocumentOptions = isDiagnosticDocumentOptions(input)
    ? input
    : {
        diagnostics: input,
        ...(source === undefined ? {} : { source }),
      };
  const title =
    options.diagnostics.length === 1
      ? `${options.diagnostics[0]?.code ?? 'FW'} diagnostic`
      : `${options.diagnostics.length} diagnostics`;
  const document = renderDocument({
    body: renderDiagnosticDocumentBody(options.diagnostics, options.source),
    hints: {
      meta: { title },
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
    status: 500,
  };
}

function isDiagnosticDocumentOptions(
  input: DiagnosticDocumentOptions | readonly DiagnosticDocumentDiagnostic[],
): input is DiagnosticDocumentOptions {
  return !Array.isArray(input);
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

function renderDiagnosticDocumentBody(
  diagnostics: readonly DiagnosticDocumentDiagnostic[],
  source: DiagnosticDocumentSource | string | undefined,
): string {
  return [
    '<main class="jiso-diagnostic">',
    '<style>',
    diagnosticDocumentStyles(),
    '</style>',
    '<h1>Jiso diagnostic</h1>',
    '<div class="jiso-diagnostic-list">',
    diagnostics.map((diagnostic) => renderDiagnosticPanel(diagnostic, source)).join(''),
    '</div>',
    '</main>',
  ].join('');
}

function renderDiagnosticPanel(
  diagnostic: DiagnosticDocumentDiagnostic,
  source: DiagnosticDocumentSource | string | undefined,
): string {
  // SPEC §11.3: surfaces render severity from the shared diagnostic registry.
  const severity = diagnostic.severity ?? diagnosticDefinitions[diagnostic.code].severity;
  const help = diagnostic.help?.trim();
  const sourceFrame = renderSourceFrame(diagnostic, source);

  return [
    '<section class="jiso-diagnostic-panel">',
    '<header>',
    `<p class="jiso-diagnostic-code">${escapeHtml(diagnostic.code)}</p>`,
    `<p class="jiso-diagnostic-severity">${escapeHtml(severity)}</p>`,
    '</header>',
    `<h2>${escapeHtml(diagnostic.message)}</h2>`,
    renderDiagnosticLocation(diagnostic),
    help ? renderDiagnosticHelp(help) : '',
    sourceFrame,
    '</section>',
  ].join('');
}

function renderDiagnosticLocation(diagnostic: DiagnosticDocumentDiagnostic): string {
  const site = diagnosticSite(diagnostic);
  if (site === undefined) return '';

  return `<p class="jiso-diagnostic-location">${escapeHtml(site)}</p>`;
}

function renderDiagnosticHelp(help: string): string {
  const items = help
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  if (!items) return '';
  return `<div class="jiso-diagnostic-help"><h3>Fix menu</h3><ul>${items}</ul></div>`;
}

function renderSourceFrame(
  diagnostic: DiagnosticDocumentDiagnostic,
  source: DiagnosticDocumentSource | string | undefined,
): string {
  const sourceText = diagnosticSource(diagnostic, source);
  const start = diagnostic.start;
  if (sourceText === undefined || start === undefined) return '';

  const lines = sourceText.split(/\r\n|\r|\n/);
  const lineIndex = start.line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return '';

  const firstLine = Math.max(0, lineIndex - 1);
  const lastLine = Math.min(lines.length - 1, lineIndex + 1);
  const width = String(lastLine + 1).length;
  const frameLines: string[] = [];

  for (let index = firstLine; index <= lastLine; index += 1) {
    const lineNumber = String(index + 1).padStart(width, ' ');
    frameLines.push(`${lineNumber} | ${lines[index] ?? ''}`);
    if (index === lineIndex) {
      const markerColumn = Math.max(1, start.column);
      const markerLength = Math.max(1, Math.min(diagnostic.length ?? 1, 80));
      frameLines.push(
        `${' '.repeat(width)} | ${' '.repeat(markerColumn - 1)}${'^'.repeat(markerLength)}`,
      );
    }
  }

  return `<pre class="jiso-diagnostic-source"><code>${escapeHtml(frameLines.join('\n'))}</code></pre>`;
}

function diagnosticSource(
  diagnostic: DiagnosticDocumentDiagnostic,
  source: DiagnosticDocumentSource | string | undefined,
): string | undefined {
  if (typeof source === 'string') return source;
  if (source === undefined) return undefined;
  if (source.fileName !== undefined && diagnostic.fileName !== undefined) {
    return source.fileName === diagnostic.fileName ? source.source : undefined;
  }

  return source.source;
}

function diagnosticSite(diagnostic: DiagnosticDocumentDiagnostic): string | undefined {
  if (diagnostic.fileName === undefined) return undefined;
  if (diagnostic.start === undefined) return diagnostic.fileName;

  return `${diagnostic.fileName}:${diagnostic.start.line}:${diagnostic.start.column}`;
}

function diagnosticDocumentStyles(): string {
  return [
    '.jiso-diagnostic{font-family:ui-sans-serif,system-ui,sans-serif;margin:0 auto;max-width:72rem;padding:2rem;color:#111827}',
    '.jiso-diagnostic h1{font-size:1.5rem;margin:0 0 1rem}',
    '.jiso-diagnostic-list{display:grid;gap:1rem}',
    '.jiso-diagnostic-panel{border:1px solid #d1d5db;border-radius:8px;padding:1rem;background:#fff}',
    '.jiso-diagnostic-panel header{align-items:center;display:flex;gap:.5rem;margin-bottom:.75rem}',
    '.jiso-diagnostic-code,.jiso-diagnostic-severity{border-radius:999px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8125rem;margin:0;padding:.125rem .5rem}',
    '.jiso-diagnostic-code{background:#111827;color:#fff}',
    '.jiso-diagnostic-severity{background:#fee2e2;color:#991b1b}',
    '.jiso-diagnostic-panel h2{font-size:1.125rem;line-height:1.4;margin:0}',
    '.jiso-diagnostic-location{color:#4b5563;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:.5rem 0 0}',
    '.jiso-diagnostic-help h3{font-size:.875rem;margin:1rem 0 .25rem}',
    '.jiso-diagnostic-help ul{margin:.25rem 0 0;padding-left:1.25rem}',
    '.jiso-diagnostic-source{background:#111827;border-radius:8px;color:#f9fafb;margin:1rem 0 0;overflow:auto;padding:1rem}',
    '.jiso-diagnostic-source code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875rem;line-height:1.5}',
  ].join('');
}

function findHeaderRecordName(headers: Record<string, string>, name: string): string | undefined {
  const normalized = name.toLowerCase();
  return Object.keys(headers).find((headerName) => headerName.toLowerCase() === normalized);
}
