import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { escapeAttribute } from './html.js';
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
  if (integrityByPath.size === 0) return [...artifacts];

  return artifacts.map((artifact) => ({
    ...artifact,
    body: renderStaticExportSriHtml(artifact.body, origin, integrityByPath),
  }));
}

async function staticExportIntegrityByPath({
  assets,
  clientModules,
}: Pick<StaticExportSriInput, 'assets' | 'clientModules'>): Promise<Map<string, string>> {
  const integrityByPath = new Map<string, string>();

  for (const artifact of clientModules) {
    integrityByPath.set(artifact.path, sriSha384(Buffer.from(artifact.body, 'utf8')));
  }

  await Promise.all(
    assets.map(async (asset) => {
      const bytes = await readableStaticExportAssetBytes(asset);
      if (bytes !== undefined) integrityByPath.set(asset.path, sriSha384(bytes));
    }),
  );

  return integrityByPath;
}

async function readableStaticExportAssetBytes(
  asset: StaticExportAssetArtifact,
): Promise<Buffer | undefined> {
  try {
    return await readFile(asset.source);
  } catch {
    return undefined;
  }
}

function sriSha384(bytes: Buffer): string {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

function renderStaticExportSriHtml(
  html: string,
  origin: string,
  integrityByPath: ReadonlyMap<string, string>,
): string {
  const replacements: { end: number; start: number; value: string }[] = [];

  for (const tag of collectStaticExportOpeningTags(html)) {
    const refs = readStaticExportHtmlAttributeRefs(tag.attributes);
    const attrs = staticExportAttributeMap(refs);
    if (attrs.has('integrity')) continue;

    const href = staticExportSriHref(tag.name, attrs);
    if (href === undefined) continue;

    const url = staticExportFirstPartyUrl(href, origin);
    if (url === undefined) continue;

    const integrity = integrityByPath.get(url.pathname);
    if (integrity === undefined) continue;

    replacements.push({
      end: tag.end - 1,
      start: tag.end - 1,
      value: ` integrity="${escapeAttribute(integrity)}"`,
    });
  }

  return applyStaticExportHtmlReplacements(html, replacements);
}

function staticExportSriHref(
  tagName: string,
  attrs: ReadonlyMap<string, string>,
): string | undefined {
  if (tagName === 'script') {
    return attrs.get('type')?.trim().toLowerCase() === 'module' ? attrs.get('src') : undefined;
  }

  if (tagName !== 'link') return undefined;

  const rels = staticExportRelTokens(attrs.get('rel'));
  if (rels.includes('modulepreload')) return attrs.get('href');
  if (rels.includes('stylesheet')) return attrs.get('href');
  if (rels.includes('preload') && attrs.get('as')?.trim().toLowerCase() === 'style') {
    return attrs.get('href');
  }

  return undefined;
}

function staticExportFirstPartyUrl(href: string, origin: string): URL | undefined {
  try {
    const url = new URL(href, origin);
    return url.origin === new URL(origin).origin ? url : undefined;
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
  for (const replacement of replacements) {
    output += html.slice(offset, replacement.start);
    output += replacement.value;
    offset = replacement.end;
  }
  return output + html.slice(offset);
}
