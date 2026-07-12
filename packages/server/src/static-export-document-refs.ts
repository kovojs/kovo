import type { StaticExportArtifact } from './static-export-types.js';
import { snapshotBuildArray } from './build-security-intrinsics.js';
import {
  createSecuritySet,
  securityArrayPush,
  securityArraySort,
  securityRegExpExec,
  securitySetAdd,
  securityStringSlice,
  securityStringTrim,
} from './response-security-intrinsics.js';
import { witnessSetForEach } from './security-witness-intrinsics.js';
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
  const hrefs = createSecuritySet<string>();
  const artifacts = snapshotBuildArray(routeArtifacts, 'static-export route artifacts');

  for (let artifactIndex = 0; artifactIndex < artifacts.length; artifactIndex += 1) {
    const artifact = artifacts[artifactIndex]!;
    const refs = snapshotBuildArray(
      scanStaticExportDocumentProtocol(artifact.body, origin).clientModuleRefs,
      'static-export client module refs',
    );
    for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
      securitySetAdd(hrefs, refs[refIndex]!.href);
    }

    const linkHeader = artifact.headers.link;
    if (linkHeader) collectClientModuleHrefsFromLinkHeader(linkHeader, origin, hrefs);
  }

  const result: string[] = [];
  witnessSetForEach(hrefs, (href) => {
    result[result.length] = href;
  });
  securityArraySort(result, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return result;
}

// SPEC §9.5: exported documents are no-JS artifacts and cannot rely on server
// mutation/query endpoints that disappear on a static host.
export function collectStaticExportServerEndpointRefs(
  html: string,
  origin: string,
): StaticExportServerEndpointRef[] {
  const refs = snapshotBuildArray(
    scanStaticExportDocumentProtocol(html, origin).endpointRefs,
    'static-export server endpoint refs',
  );
  const result: StaticExportServerEndpointRef[] = [];
  for (let index = 0; index < refs.length; index += 1) result[result.length] = refs[index]!;
  return result;
}

function collectClientModuleHrefsFromLinkHeader(
  header: string,
  origin: string,
  hrefs: Set<string>,
): void {
  const entries = splitStaticExportLinkHeaderEntries(header);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const linkMatch = securityRegExpExec(/<(?<href>[^>\s]+)>/, entry);
    if (linkMatch === null) continue;
    if (!stringArrayContains(staticExportLinkHeaderRelTokens(entry), 'modulepreload')) continue;

    const href = staticExportClientModuleHref(linkMatch.groups?.href ?? '', origin);
    if (href !== undefined) securitySetAdd(hrefs, href);
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
      securityArrayPush(
        entries,
        securityStringTrim(securityStringSlice(header, entryStart, offset)),
      );
      entryStart = offset + 1;
    }
  }

  securityArrayPush(entries, securityStringTrim(securityStringSlice(header, entryStart)));
  const nonEmpty: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index] !== '') securityArrayPush(nonEmpty, entries[index]!);
  }
  return nonEmpty;
}

function staticExportLinkHeaderRelTokens(entry: string): string[] {
  const tokens: string[] = [];
  const relPattern = /(?:^|;)\s*rel\s*=\s*(?:"(?<quoted>[^"]*)"|(?<bare>[^;,]*))/gi;
  let match: RegExpExecArray | null;

  while ((match = securityRegExpExec(relPattern, entry)) !== null) {
    const rels = staticExportRelTokens(match.groups?.quoted ?? match.groups?.bare ?? '');
    for (let index = 0; index < rels.length; index += 1) securityArrayPush(tokens, rels[index]!);
  }

  return tokens;
}

function stringArrayContains(values: readonly string[], expected: string): boolean {
  const pinned = snapshotBuildArray(values, 'static-export link rel tokens');
  for (let index = 0; index < pinned.length; index += 1) {
    if (pinned[index] === expected) return true;
  }
  return false;
}
