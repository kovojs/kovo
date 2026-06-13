import type { StaticExportArtifact } from './static-export-types.js';

export interface StaticExportHtmlAttributeRef {
  name: string;
  value: string;
}

export interface StaticExportServerEndpointRef extends StaticExportHtmlAttributeRef {
  path: string;
  phase: 'mutation' | 'query';
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

function collectStaticExportHtmlAttributeRefs(html: string): StaticExportHtmlAttributeRef[] {
  const refs: StaticExportHtmlAttributeRef[] = [];
  const attributePattern = /\s([\w:-]+)=["']([^"']*)["']/g;
  let attributeMatch: RegExpExecArray | null;

  while ((attributeMatch = attributePattern.exec(html)) !== null) {
    refs.push({
      name: attributeMatch[1]?.toLowerCase() ?? '',
      value: attributeMatch[2] === undefined ? '' : decodeHtmlAttributeText(attributeMatch[2]),
    });
  }

  return refs;
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
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
