import type { RequestHandler } from './app.js';
import { normalizePathname } from './match.js';
import { replayStaticExportRequest } from './static-export-request.js';
import { readStaticExportRouteDocumentResponse } from './static-export-response.js';
import {
  StaticExportError,
  staticExportDiagnostic,
  type StaticExportArtifact,
  type StaticExportHtmlPathStyle,
} from './static-export-types.js';

export interface StaticExportHtmlAttributeRef {
  name: string;
  value: string;
}

export interface StaticExportServerEndpointRef extends StaticExportHtmlAttributeRef {
  path: string;
  phase: 'mutation' | 'query';
}

export interface StaticExportRouteDocumentReplayOptions {
  handler: RequestHandler;
  htmlPathStyle: StaticExportHtmlPathStyle;
  origin: string;
  routePath: string;
}

export async function replayStaticExportRouteDocumentArtifact({
  handler,
  htmlPathStyle,
  origin,
  routePath,
}: StaticExportRouteDocumentReplayOptions): Promise<StaticExportArtifact> {
  const pathname = normalizePathname(routePath).pathname;
  const { response } = await replayStaticExportRequest({ handler, origin, pathname });
  const replayed = await readStaticExportRouteDocumentResponse({ response, routePath });
  const { body } = replayed;
  assertStaticExportRouteDocumentL0L1({ body, origin, routePath });

  return {
    ...replayed,
    path: staticExportRouteDocumentArtifactPath(pathname, htmlPathStyle),
  };
}

export function collectStaticExportClientModuleHrefs(
  routeArtifacts: readonly StaticExportArtifact[],
  origin: string,
): readonly string[] {
  const hrefs = new Set<string>();

  for (const artifact of routeArtifacts) {
    for (const ref of collectStaticExportHtmlAttributeRefs(artifact.body)) {
      for (const token of ref.value.split(/\s+/)) {
        const href = staticExportClientModuleHref(token, origin);
        if (href !== undefined) hrefs.add(href);
      }
    }

    const linkHeader = artifact.headers.link;
    if (linkHeader) collectClientModuleHrefsFromLinkHeader(linkHeader, origin, hrefs);
  }

  return [...hrefs].sort();
}

export function staticExportRouteDocumentArtifactPath(
  pathname: string,
  style: StaticExportHtmlPathStyle,
): string {
  if (pathname === '/') return '/index.html';
  return style === 'directory' ? `${pathname}/index.html` : `${pathname}.html`;
}

const STATIC_EXPORT_SERVER_ENDPOINT_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'src']);

// SPEC §9.5: exported documents are no-JS artifacts and cannot rely on server
// mutation/query endpoints that disappear on a static host.
export function collectStaticExportServerEndpointRefs(
  html: string,
  origin: string,
): StaticExportServerEndpointRef[] {
  const refs: StaticExportServerEndpointRef[] = [];
  const exportOrigin = new URL(origin).origin;

  for (const ref of collectStaticExportHtmlAttributeRefs(html)) {
    if (!STATIC_EXPORT_SERVER_ENDPOINT_ATTRIBUTES.has(ref.name)) continue;

    const url = staticExportUrlFromAttributeValue(ref.value, origin);
    if (url === undefined || url.origin !== exportOrigin) continue;

    const phase = staticExportServerEndpointPhase(url.pathname);
    if (phase === undefined) continue;

    refs.push({ ...ref, path: url.pathname, phase });
  }

  return refs;
}

interface StaticExportRouteDocumentL0L1Options {
  body: string;
  origin: string;
  routePath: string;
}

function assertStaticExportRouteDocumentL0L1({
  body,
  origin,
  routePath,
}: StaticExportRouteDocumentL0L1Options): void {
  const diagnostics = collectStaticExportServerEndpointRefs(body, origin).map((ref) =>
    staticExportDiagnostic(
      routePath,
      `FW229 static export cannot export route '${routePath}' because document attribute '${ref.name}' references server ${ref.phase} endpoint '${ref.path}'. Export is L0/L1 only; serve this route dynamically or replace server-only interaction with an exportable client island.`,
    ),
  );

  if (diagnostics.length > 0) throw new StaticExportError(diagnostics);
}

function collectStaticExportHtmlAttributeRefs(html: string): StaticExportHtmlAttributeRef[] {
  const refs: StaticExportHtmlAttributeRef[] = [];
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) break;

    const tag = readStaticExportOpeningTag(html, start);
    if (tag === undefined) {
      offset = start + 1;
      continue;
    }

    refs.push(...readStaticExportHtmlAttributeRefs(tag.attributes));
    offset = tag.end;
  }

  return refs;
}

interface StaticExportOpeningTag {
  attributes: string;
  end: number;
}

function readStaticExportOpeningTag(
  html: string,
  start: number,
): StaticExportOpeningTag | undefined {
  const afterOpen = html[start + 1];
  if (afterOpen === undefined || afterOpen === '/' || afterOpen === '!' || afterOpen === '?') {
    return undefined;
  }

  let offset = start + 1;
  while (offset < html.length && !isStaticExportHtmlSpace(html[offset]) && html[offset] !== '>') {
    offset += 1;
  }

  const attributesStart = offset;
  let quote: '"' | "'" | undefined;
  while (offset < html.length) {
    const char = html[offset];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return {
        attributes: html.slice(attributesStart, offset),
        end: offset + 1,
      };
    }

    offset += 1;
  }

  return undefined;
}

function readStaticExportHtmlAttributeRefs(attributes: string): StaticExportHtmlAttributeRef[] {
  const refs: StaticExportHtmlAttributeRef[] = [];
  let offset = 0;

  while (offset < attributes.length) {
    offset = skipStaticExportHtmlSpace(attributes, offset);
    if (offset >= attributes.length || attributes[offset] === '/') break;

    const nameStart = offset;
    while (
      offset < attributes.length &&
      !isStaticExportHtmlSpace(attributes[offset]) &&
      attributes[offset] !== '=' &&
      attributes[offset] !== '/'
    ) {
      offset += 1;
    }

    const name = attributes.slice(nameStart, offset).toLowerCase();
    offset = skipStaticExportHtmlSpace(attributes, offset);
    if (attributes[offset] !== '=') {
      if (name !== '') refs.push({ name, value: '' });
      continue;
    }

    offset = skipStaticExportHtmlSpace(attributes, offset + 1);
    const read = readStaticExportHtmlAttributeValue(attributes, offset);
    offset = read.end;

    if (name !== '') {
      refs.push({
        name,
        value: decodeHtmlAttributeText(read.value),
      });
    }
  }

  return refs;
}

function readStaticExportHtmlAttributeValue(
  attributes: string,
  start: number,
): { end: number; value: string } {
  const quote = attributes[start];
  if (quote === '"' || quote === "'") {
    const valueStart = start + 1;
    const valueEnd = attributes.indexOf(quote, valueStart);
    if (valueEnd === -1) return { end: attributes.length, value: attributes.slice(valueStart) };
    return { end: valueEnd + 1, value: attributes.slice(valueStart, valueEnd) };
  }

  let end = start;
  while (
    end < attributes.length &&
    !isStaticExportHtmlSpace(attributes[end]) &&
    attributes[end] !== '>'
  ) {
    end += 1;
  }

  return { end, value: attributes.slice(start, end) };
}

function staticExportUrlFromAttributeValue(value: string, origin: string): URL | undefined {
  if (value.trim() === '') return undefined;

  try {
    return new URL(value, origin);
  } catch {
    return undefined;
  }
}

function staticExportServerEndpointPhase(pathname: string): 'mutation' | 'query' | undefined {
  if (pathname.startsWith('/_m/')) return 'mutation';
  if (pathname.startsWith('/_q/')) return 'query';
  return undefined;
}

function collectClientModuleHrefsFromLinkHeader(
  header: string,
  origin: string,
  hrefs: Set<string>,
): void {
  const linkPattern = /<(?<href>[^>\s]+)>/g;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkPattern.exec(header)) !== null) {
    const href = staticExportClientModuleHref(linkMatch.groups?.href ?? '', origin);
    if (href !== undefined) hrefs.add(href);
  }
}

function staticExportClientModuleHref(value: string, origin: string): string | undefined {
  if (value.trim() === '') return undefined;

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return undefined;
  }

  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/c/')) {
    return undefined;
  }

  // SPEC §4.3 permits full module URLs. Static export must still publish the
  // same-origin /c/ file that a static host serves by path.
  return value.startsWith('/c/') ? value : `${url.pathname}${url.search}${url.hash}`;
}

function decodeHtmlAttributeText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (entity: string, hex: string) =>
      decodeHtmlNumericEntity(entity, Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (entity: string, decimal: string) =>
      decodeHtmlNumericEntity(entity, Number.parseInt(decimal, 10)),
    )
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function decodeHtmlNumericEntity(entity: string, codePoint: number): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return entity;
  }
}

function skipStaticExportHtmlSpace(source: string, offset: number): number {
  while (offset < source.length && isStaticExportHtmlSpace(source[offset])) {
    offset += 1;
  }

  return offset;
}

function isStaticExportHtmlSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';
}
