import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KovoApp } from './app-types.js';
import { isKovoApp } from './app-guards.js';
import {
  createStaticExportOutputPlan,
  STATIC_EXPORT_DRY_RUN_ROOT,
  staticExportAssetArtifacts,
  staticExportOutputRoot,
  writeStaticExportOutput,
} from './static-export-output.js';
import { replayStaticExportApp } from './static-export-replay.js';
import { applyStaticExportSubresourceIntegrity } from './static-export-sri.js';
import {
  assertStaticExportCompileDiagnostics,
  StaticExportError,
  staticExportDiagnostic,
} from './static-export-diagnostics.js';
import {
  type StaticExportAssetInput,
  type StaticExportOptions,
  type StaticExportResult,
} from './static-export-types.js';

/**
 * Pre-render an app's static routes to files on disk for static hosting,
 * verifying the app aggregate and compile diagnostics before emitting
 * (SPEC §9.5).
 *
 * @param app - An app aggregate from `createApp`.
 * @param options - Output directory and static-export options.
 * @returns A `StaticExportResult` describing the emitted files.
 */
export async function exportStaticApp(
  app: KovoApp,
  options: StaticExportOptions = {},
): Promise<StaticExportResult> {
  assertStaticExportAppAggregate(app);
  assertStaticExportCompileDiagnostics([...app.diagnostics, ...(options.diagnostics ?? [])]);
  assertNoStaticExportHtmlPathStyleOption(options);
  if (options.outDir !== undefined) staticExportOutputRoot(options.outDir);

  staticExportAssetArtifacts(options.assets ?? []);
  const replay = await replayStaticExportApp({
    app,
    ...(options.onNonExportable === undefined ? {} : { onNonExportable: options.onNonExportable }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  });
  const assetInputs = await staticExportAssetsWithDocumentPublicAssets(options, replay.artifacts);
  const assets = staticExportAssetArtifacts(assetInputs);
  const artifacts = await applyStaticExportSubresourceIntegrity({
    artifacts: replay.artifacts,
    assets,
    clientModules: replay.clientModules,
    origin: options.origin ?? 'https://kovo.local',
  });
  const outputPlan = createStaticExportOutputPlan({
    artifacts,
    assets,
    clientModules: replay.clientModules,
    outDir: options.outDir ?? STATIC_EXPORT_DRY_RUN_ROOT,
  });

  if (options.outDir !== undefined) {
    await writeStaticExportOutput(outputPlan);
  }

  return {
    artifacts,
    assets,
    clientModules: replay.clientModules,
    diagnostics: replay.diagnostics,
  };
}

async function staticExportAssetsWithDocumentPublicAssets(
  options: StaticExportOptions,
  artifacts: StaticExportResult['artifacts'],
): Promise<NonNullable<StaticExportOptions['assets']>> {
  const configuredAssets = options.assets ?? [];
  if (options.publicAssetRoot === undefined) return configuredAssets;

  const publicAssets = await documentPublicAssetInputs({
    artifacts,
    base: options.publicAssetBase,
    configuredAssets,
    root: options.publicAssetRoot,
  });
  if (publicAssets.length === 0) return configuredAssets;

  return [...configuredAssets, ...publicAssets];
}

async function documentPublicAssetInputs(options: {
  artifacts: StaticExportResult['artifacts'];
  base: string | undefined;
  configuredAssets: readonly NonNullable<StaticExportOptions['assets']>[number][];
  root: string | URL;
}): Promise<NonNullable<StaticExportOptions['assets']>> {
  const root = staticExportPublicAssetRoot(options.root);
  const base = normalizedStaticExportPublicAssetBase(options.base);
  const existingPaths = new Set(options.configuredAssets.map((asset) => asset.path));
  const documentPaths = new Set(options.artifacts.map((artifact) => artifact.path));
  const publicAssets: StaticExportAssetInput[] = [];
  const diagnostics: ReturnType<typeof staticExportDiagnostic>[] = [];

  for (const hrefPath of documentReferencedStaticAssetPaths(options.artifacts, base)) {
    if (existingPaths.has(hrefPath) || documentPaths.has(hrefPath)) continue;
    if (hrefPath.startsWith('/c/') || hrefPath.startsWith('/assets/')) continue;

    const source = staticExportPublicAssetSource(root, base, hrefPath);
    if ((await readableFileExists(source)) === false) {
      diagnostics.push(
        staticExportDiagnostic(
          hrefPath,
          `KV229 static export cannot copy referenced public asset '${hrefPath}' because source '${source}' was not found under public asset root '${root}'. SPEC §9.5 exports referenced static assets with route documents.`,
        ),
      );
      continue;
    }

    existingPaths.add(hrefPath);
    publicAssets.push({ path: hrefPath, source });
  }

  if (diagnostics.length > 0) throw new StaticExportError(diagnostics);
  return publicAssets;
}

function documentReferencedStaticAssetPaths(
  artifacts: StaticExportResult['artifacts'],
  base: string,
): string[] {
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    for (const rawHref of htmlAttributeUrls(artifact.body)) {
      const hrefPath = staticExportPublicHrefPath(rawHref, base);
      if (hrefPath !== undefined) paths.add(hrefPath);
    }
  }
  return [...paths].sort();
}

function htmlAttributeUrls(html: string): string[] {
  const urls: string[] = [];
  const attrPattern = /\s(?:href|src|poster)=["']([^"']+)["']/gi;
  for (const match of html.matchAll(attrPattern)) {
    if (match[1] !== undefined) urls.push(match[1]);
  }

  const srcsetPattern = /\ssrcset=["']([^"']+)["']/gi;
  for (const match of html.matchAll(srcsetPattern)) {
    for (const candidate of (match[1] ?? '').split(',')) {
      const url = candidate.trim().split(/\s+/, 1)[0];
      if (url) urls.push(url);
    }
  }
  return urls;
}

function staticExportPublicHrefPath(rawHref: string, base: string): string | undefined {
  if (
    rawHref === '' ||
    rawHref.startsWith('#') ||
    rawHref.startsWith('data:') ||
    rawHref.startsWith('javascript:') ||
    rawHref.startsWith('mailto:') ||
    rawHref.startsWith('tel:')
  ) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(rawHref, 'https://kovo.local');
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://kovo.local') return undefined;
  if (!url.pathname.startsWith('/')) return undefined;
  if (base !== '/' && url.pathname !== base.slice(0, -1) && !url.pathname.startsWith(base)) {
    return undefined;
  }
  if (url.pathname.endsWith('/')) return undefined;
  if (path.posix.extname(url.pathname) === '') return undefined;
  return url.pathname;
}

function staticExportPublicAssetSource(root: string, base: string, hrefPath: string): string {
  const sourcePathname =
    base === '/'
      ? hrefPath
      : hrefPath === base.slice(0, -1)
        ? '/'
        : hrefPath.slice(base.length - 1);
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(sourcePathname);
  } catch {
    decodedPathname = sourcePathname;
  }

  const source = path.resolve(root, `.${decodedPathname}`);
  if (source === root || source.startsWith(`${root}${path.sep}`)) return source;

  throw new StaticExportError([
    staticExportDiagnostic(
      hrefPath,
      `KV229 static export cannot copy referenced public asset '${hrefPath}' because it escapes public asset root '${root}'. SPEC §9.5 exports referenced static assets with route documents.`,
    ),
  ]);
}

function normalizedStaticExportPublicAssetBase(base: string | undefined): string {
  if (base === undefined) return '/';
  const normalized = `/${base.replace(/^\/+|\/+$/g, '')}/`;
  return normalized === '//' ? '/' : normalized;
}

function staticExportPublicAssetRoot(root: string | URL): string {
  if (root instanceof URL) {
    if (root.protocol === 'file:') return path.resolve(fileURLToPath(root));

    throw new StaticExportError([
      staticExportDiagnostic(
        'publicAssetRoot',
        `KV229 static export cannot copy public assets from '${root.href}'. Public asset roots must be filesystem paths or file: URLs.`,
      ),
    ]);
  }
  return path.resolve(root);
}

async function readableFileExists(source: string): Promise<boolean> {
  try {
    return (await stat(source)).isFile();
  } catch {
    return false;
  }
}

function assertStaticExportAppAggregate(app: KovoApp): void {
  if (isKovoApp(app)) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      'app',
      'KV229 static export requires a closed Kovo app aggregate. SPEC §9.5 export replay must start from createApp(), not a raw request handler or compatibility shell.',
    ),
  ]);
}

function assertNoStaticExportHtmlPathStyleOption(options: object): void {
  if (!Object.prototype.hasOwnProperty.call(options, 'htmlPathStyle')) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      'htmlPathStyle',
      'KV229 static export refused htmlPathStyle. SPEC §9.5 exports route documents as directory-index HTML; remove this option.',
    ),
  ]);
}
