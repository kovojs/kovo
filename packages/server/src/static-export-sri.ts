import path from 'node:path';

import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import { escapeAttribute } from './html.js';
import { buildSecuritySha384Base64, snapshotBuildArray } from './build-security-intrinsics.js';
import {
  createSecurityMap,
  securityMapGet,
  securityMapHas,
  securityMapSet,
  securityStringSlice,
  securityStringToLowerCase,
  securityStringTrim,
  securityUrlSnapshot,
} from './response-security-intrinsics.js';
import {
  collectStaticExportOpeningTags,
  readStaticExportHtmlAttributeRefs,
  staticExportAttributeMap,
  staticExportRelTokens,
} from './static-export-document-refs.js';
import type {
  StaticExportArtifact,
  StaticExportAssetArtifact,
  StaticExportClientModuleArtifact,
} from './static-export-types.js';
import { witnessArrayAppend } from './security-witness-intrinsics.js';

interface StaticExportSriInput {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  origin: string;
}

/**
 * @internal SPEC §9.5 static export materializes route documents after client modules/assets are
 * known, so first-party module/style tags can carry browser-enforced SRI when bytes are available.
 */
export async function applyStaticExportSubresourceIntegrity({
  artifacts,
  assets,
  clientModules,
  origin,
}: StaticExportSriInput): Promise<StaticExportArtifact[]> {
  const integrityByPath = await staticExportIntegrityByPath({ assets, clientModules });
  const sourceArtifacts = snapshotBuildArray(artifacts, 'static-export SRI route artifacts');
  const finalized: StaticExportArtifact[] = [];
  for (let index = 0; index < sourceArtifacts.length; index += 1) {
    const artifact = sourceArtifacts[index]!;
    witnessArrayAppend(
      finalized,
      {
        ...artifact,
        body: renderStaticExportSriHtml(artifact.body, origin, integrityByPath),
      },
      'Server packages/server/src/static-export-sri.ts collection',
    );
  }
  return finalized;
}

async function staticExportIntegrityByPath({
  assets,
  clientModules,
}: Pick<StaticExportSriInput, 'assets' | 'clientModules'>): Promise<Map<string, string>> {
  const integrityByPath = createSecurityMap<string, string>();
  const pinnedClientModules = snapshotBuildArray(clientModules, 'static-export SRI client modules');

  for (let index = 0; index < pinnedClientModules.length; index += 1) {
    const artifact = pinnedClientModules[index]!;
    securityMapSet(integrityByPath, artifact.path, sriSha384(artifact.body));
  }

  const pinnedAssets = snapshotBuildArray(assets, 'static-export SRI assets');
  for (let index = 0; index < pinnedAssets.length; index += 1) {
    const asset = pinnedAssets[index]!;
    const bytes = await readableStaticExportAssetBytes(asset);
    if (bytes !== undefined) securityMapSet(integrityByPath, asset.path, sriSha384(bytes));
  }

  return integrityByPath;
}

async function readableStaticExportAssetBytes(
  asset: StaticExportAssetArtifact,
): Promise<Uint8Array | undefined> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(path.dirname(asset.source));
  const bytes = await fileSystem.fileBytes(path.basename(asset.source));
  return bytes;
}

function sriSha384(bytes: string | Uint8Array): string {
  return `sha384-${buildSecuritySha384Base64(bytes)}`;
}

function renderStaticExportSriHtml(
  html: string,
  origin: string,
  integrityByPath: Map<string, string>,
): string {
  const replacements: { end: number; start: number; value: string }[] = [];

  const tags = snapshotBuildArray(
    collectStaticExportOpeningTags(html),
    'static-export SRI opening tags',
  );
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]!;
    const refs = readStaticExportHtmlAttributeRefs(tag.attributes);
    const attrs = staticExportAttributeMap(refs);
    if (securityMapHas(attrs, 'integrity')) continue;

    const href = staticExportSriHref(tag.name, attrs);
    if (href === undefined) continue;

    const pathname = staticExportFirstPartyPath(href, origin);
    if (pathname === undefined) continue;

    const integrity = securityMapGet(integrityByPath, pathname);
    if (integrity === undefined) continue;

    witnessArrayAppend(
      replacements,
      {
        end: tag.end - 1,
        start: tag.end - 1,
        value: ` integrity="${escapeAttribute(integrity)}"`,
      },
      'Server packages/server/src/static-export-sri.ts collection',
    );
  }

  return applyStaticExportHtmlReplacements(html, replacements);
}

function staticExportSriHref(tagName: string, attrs: Map<string, string>): string | undefined {
  if (tagName === 'script') {
    const type = securityMapGet(attrs, 'type');
    return type !== undefined && securityStringToLowerCase(securityStringTrim(type)) === 'module'
      ? securityMapGet(attrs, 'src')
      : undefined;
  }

  if (tagName !== 'link') return undefined;

  const rels = snapshotBuildArray(
    staticExportRelTokens(securityMapGet(attrs, 'rel')),
    'static-export SRI rel tokens',
  );
  if (stringArrayContains(rels, 'modulepreload')) return securityMapGet(attrs, 'href');
  if (stringArrayContains(rels, 'stylesheet')) return securityMapGet(attrs, 'href');
  const as = securityMapGet(attrs, 'as');
  if (
    stringArrayContains(rels, 'preload') &&
    as !== undefined &&
    securityStringToLowerCase(securityStringTrim(as)) === 'style'
  ) {
    return securityMapGet(attrs, 'href');
  }

  return undefined;
}

function staticExportFirstPartyPath(href: string, origin: string): string | undefined {
  try {
    const url = securityUrlSnapshot(href, origin);
    return url.origin === securityUrlSnapshot(origin).origin ? url.pathname : undefined;
  } catch {
    return undefined;
  }
}

function applyStaticExportHtmlReplacements(
  html: string,
  replacements: readonly { end: number; start: number; value: string }[],
): string {
  if (replacements.length === 0) return html;

  let output = '';
  let offset = 0;
  const pinnedReplacements = snapshotBuildArray(replacements, 'static-export SRI replacements');
  for (let index = 0; index < pinnedReplacements.length; index += 1) {
    const replacement = pinnedReplacements[index]!;
    output += securityStringSlice(html, offset, replacement.start);
    output += replacement.value;
    offset = replacement.end;
  }
  return output + securityStringSlice(html, offset);
}

function stringArrayContains(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}
