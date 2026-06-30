import type { StaticExportArtifact } from './static-export-types.js';
import {
  scanStaticExportDocumentProtocol,
  staticExportClientModuleHref,
  staticExportRelTokens,
  type StaticExportServerEndpointRef,
} from './static-export-protocol.js';

export {
  collectStaticExportOpeningTags,
  readStaticExportHtmlAttributeRefs,
  staticExportAttributeMap,
  staticExportRelTokens,
} from './static-export-protocol.js';
export type {
  StaticExportHtmlAttributeRef,
  StaticExportOpeningTag,
  StaticExportServerEndpointRef,
} from './static-export-protocol.js';

export function collectStaticExportClientModuleHrefs(
  routeArtifacts: readonly StaticExportArtifact[],
  origin: string,
): readonly string[] {
  const hrefs = new Set<string>();

  for (const artifact of routeArtifacts) {
    for (const ref of scanStaticExportDocumentProtocol(artifact.body, origin).clientModuleRefs) {
      hrefs.add(ref.href);
    }

    const linkHeader = artifact.headers.link;
    if (linkHeader) collectClientModuleHrefsFromLinkHeader(linkHeader, origin, hrefs);
  }

  return [...hrefs].sort();
}

// SPEC §9.5: exported documents are no-JS artifacts and cannot rely on server
// mutation/query endpoints that disappear on a static host.
export function collectStaticExportServerEndpointRefs(
  html: string,
  origin: string,
): StaticExportServerEndpointRef[] {
  return [...scanStaticExportDocumentProtocol(html, origin).endpointRefs];
}

function collectClientModuleHrefsFromLinkHeader(
  header: string,
  origin: string,
  hrefs: Set<string>,
): void {
  for (const entry of splitStaticExportLinkHeaderEntries(header)) {
    const linkMatch = /<(?<href>[^>\s]+)>/.exec(entry);
    if (linkMatch === null) continue;
    if (!staticExportLinkHeaderRelTokens(entry).includes('modulepreload')) continue;

    const href = staticExportClientModuleHref(linkMatch.groups?.href ?? '', origin);
    if (href !== undefined) hrefs.add(href);
  }
}

function splitStaticExportLinkHeaderEntries(header: string): string[] {
  const entries: string[] = [];
  let entryStart = 0;
  let quote: '"' | undefined;

  for (let offset = 0; offset < header.length; offset += 1) {
    const char = header[offset];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"') {
      quote = char;
    } else if (char === ',') {
      entries.push(header.slice(entryStart, offset).trim());
      entryStart = offset + 1;
    }
  }

  entries.push(header.slice(entryStart).trim());
  return entries.filter(Boolean);
}

function staticExportLinkHeaderRelTokens(entry: string): string[] {
  const tokens: string[] = [];
  const relPattern = /(?:^|;)\s*rel\s*=\s*(?:"(?<quoted>[^"]*)"|(?<bare>[^;,]*))/gi;
  let match: RegExpExecArray | null;

  while ((match = relPattern.exec(entry)) !== null) {
    tokens.push(...staticExportRelTokens(match.groups?.quoted ?? match.groups?.bare ?? ''));
  }

  return tokens;
}
