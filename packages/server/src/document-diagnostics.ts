import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { escapeHtml } from './html.js';
import { renderDocument, type DocumentRoutePageResponse } from './document-core.js';
import {
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityString,
  securityStringReplaceAll,
  securityStringSplit,
  securityStringTrim,
} from './response-security-intrinsics.js';

/** @internal */
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

/** @internal */
export interface DiagnosticDocumentSource {
  fileName?: string;
  source: string;
}

/** @internal */
export interface DiagnosticDocumentOptions {
  diagnostics: readonly DiagnosticDocumentDiagnostic[];
  lang?: string;
  source?: DiagnosticDocumentSource | string;
}

/**
 * Render a framework-owned diagnostic document.
 *
 * @internal
 */
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
      ? `${options.diagnostics[0]?.code ?? 'KV'} diagnostic`
      : `${options.diagnostics.length} diagnostics`;
  const document = renderDocument({
    body: renderDiagnosticDocumentBody(options.diagnostics, options.source),
    hints: {
      meta: { title },
    },
    ...(options.lang === undefined ? {} : { lang: options.lang }),
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
  return !securityArrayIsArray(input);
}

function renderDiagnosticDocumentBody(
  diagnostics: readonly DiagnosticDocumentDiagnostic[],
  source: DiagnosticDocumentSource | string | undefined,
): string {
  const panels: string[] = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    const diagnostic = diagnostics[index];
    if (diagnostic !== undefined) {
      securityArrayPush(panels, renderDiagnosticPanel(diagnostic, source));
    }
  }
  return securityArrayJoin(
    [
      '<main class="kovo-diagnostic">',
      '<style>',
      diagnosticDocumentStyles(),
      '</style>',
      '<h1>Kovo diagnostic</h1>',
      '<div class="kovo-diagnostic-list">',
      securityArrayJoin(panels, ''),
      '</div>',
      '</main>',
    ],
    '',
  );
}

function renderDiagnosticPanel(
  diagnostic: DiagnosticDocumentDiagnostic,
  source: DiagnosticDocumentSource | string | undefined,
): string {
  // SPEC §11.3: surfaces render severity from the shared diagnostic registry.
  const severity = diagnostic.severity ?? diagnosticDefinitions[diagnostic.code].severity;
  const help = diagnostic.help === undefined ? undefined : securityStringTrim(diagnostic.help);
  const sourceFrame = renderSourceFrame(diagnostic, source);

  return securityArrayJoin(
    [
      '<section class="kovo-diagnostic-panel">',
      '<header>',
      `<p class="kovo-diagnostic-code">${escapeHtml(diagnostic.code)}</p>`,
      `<p class="kovo-diagnostic-severity">${escapeHtml(severity)}</p>`,
      '</header>',
      `<h2>${escapeHtml(diagnostic.message)}</h2>`,
      renderDiagnosticLocation(diagnostic),
      help ? renderDiagnosticHelp(help) : '',
      sourceFrame,
      '</section>',
    ],
    '',
  );
}

function renderDiagnosticLocation(diagnostic: DiagnosticDocumentDiagnostic): string {
  const site = diagnosticSite(diagnostic);
  if (site === undefined) return '';

  return `<p class="kovo-diagnostic-location">${escapeHtml(site)}</p>`;
}

function renderDiagnosticHelp(help: string): string {
  const lines = securityStringSplit(help, '\n');
  const items: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const trimmed = securityStringTrim(line);
    if (trimmed !== '') securityArrayPush(items, `<li>${escapeHtml(trimmed)}</li>`);
  }
  const renderedItems = securityArrayJoin(items, '');

  if (renderedItems === '') return '';
  return `<div class="kovo-diagnostic-help"><h3>Fix menu</h3><ul>${renderedItems}</ul></div>`;
}

function renderSourceFrame(
  diagnostic: DiagnosticDocumentDiagnostic,
  source: DiagnosticDocumentSource | string | undefined,
): string {
  const sourceText = diagnosticSource(diagnostic, source);
  const start = diagnostic.start;
  if (sourceText === undefined || start === undefined) return '';

  const normalizedSource = securityStringReplaceAll(
    securityStringReplaceAll(sourceText, '\r\n', '\n'),
    '\r',
    '\n',
  );
  const lines = securityStringSplit(normalizedSource, '\n');
  const lineIndex = start.line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return '';

  const firstLine = lineIndex - 1 < 0 ? 0 : lineIndex - 1;
  const lastLine = lineIndex + 1 > lines.length - 1 ? lines.length - 1 : lineIndex + 1;
  const width = securityString(lastLine + 1).length;
  const frameLines: string[] = [];

  for (let index = firstLine; index <= lastLine; index += 1) {
    const lineNumber = leftPadSpaces(securityString(index + 1), width);
    const sourceLine = lines[index] ?? '';
    securityArrayPush(frameLines, `${lineNumber} | ${sourceLine}`);
    if (index === lineIndex) {
      const markerColumn =
        start.column < 1
          ? 1
          : start.column > sourceLine.length + 1
            ? sourceLine.length + 1
            : start.column;
      const requestedMarkerLength = diagnostic.length ?? 1;
      const boundedMarkerLength = requestedMarkerLength > 80 ? 80 : requestedMarkerLength;
      const markerLength = boundedMarkerLength < 1 ? 1 : boundedMarkerLength;
      securityArrayPush(
        frameLines,
        `${repeatCharacter(' ', width)} | ${repeatCharacter(' ', markerColumn - 1)}${repeatCharacter('^', markerLength)}`,
      );
    }
  }

  return `<pre class="kovo-diagnostic-source"><code>${escapeHtml(securityArrayJoin(frameLines, '\n'))}</code></pre>`;
}

function leftPadSpaces(value: string, width: number): string {
  return `${repeatCharacter(' ', width - value.length)}${value}`;
}

function repeatCharacter(character: string, count: number): string {
  let repeated = '';
  for (let index = 0; index < count; index += 1) repeated += character;
  return repeated;
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
  return securityArrayJoin(
    [
      '.kovo-diagnostic{font-family:ui-sans-serif,system-ui,sans-serif;margin:0 auto;max-width:72rem;padding:2rem;color:#111827}',
      '.kovo-diagnostic h1{font-size:1.5rem;margin:0 0 1rem}',
      '.kovo-diagnostic-list{display:grid;gap:1rem}',
      '.kovo-diagnostic-panel{border:1px solid #d1d5db;border-radius:8px;padding:1rem;background:#fff}',
      '.kovo-diagnostic-panel header{align-items:center;display:flex;gap:.5rem;margin-bottom:.75rem}',
      '.kovo-diagnostic-code,.kovo-diagnostic-severity{border-radius:999px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8125rem;margin:0;padding:.125rem .5rem}',
      '.kovo-diagnostic-code{background:#111827;color:#fff}',
      '.kovo-diagnostic-severity{background:#fee2e2;color:#991b1b}',
      '.kovo-diagnostic-panel h2{font-size:1.125rem;line-height:1.4;margin:0}',
      '.kovo-diagnostic-location{color:#4b5563;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:.5rem 0 0}',
      '.kovo-diagnostic-help h3{font-size:.875rem;margin:1rem 0 .25rem}',
      '.kovo-diagnostic-help ul{margin:.25rem 0 0;padding-left:1.25rem}',
      '.kovo-diagnostic-source{background:#111827;border-radius:8px;color:#f9fafb;margin:1rem 0 0;overflow:auto;padding:1rem}',
      '.kovo-diagnostic-source code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875rem;line-height:1.5}',
    ],
    '',
  );
}
