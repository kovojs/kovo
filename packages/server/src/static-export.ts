import {
  createFrameworkOutputFileSystemBoundary,
  type FrameworkOutputFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';

import type { KovoApp } from './app-types.js';
import { isKovoApp } from './app-guards.js';
import {
  buildOwnDataProperty,
  buildSecurityDecodeURIComponent,
  buildSecurityFileUrlToPath,
  buildSecurityPathBasename,
  buildSecurityPathDirname,
  buildSecurityPathResolve,
  buildSecurityPosixDirname,
  buildSecurityPosixExtname,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
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
  type StaticExportAssetArtifact,
  type StaticExportOptions,
  type StaticExportResult,
} from './static-export-types.js';
import {
  createSecuritySet,
  securityArraySort,
  securityDecodeUtf8Fatal,
  securityIsUrl,
  securityRegExpExec,
  securityRegExpReplace,
  securitySetAdd,
  securitySetHas,
  securityStringEndsWith,
  securityStringSlice,
  securityStringSplit,
  securityStringStartsWith,
  securityStringTrim,
  securityUrlObjectSnapshot,
  securityUrlSnapshot,
} from './response-security-intrinsics.js';
import {
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessSetForEach,
} from './security-witness-intrinsics.js';

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
  assertNoStaticExportHtmlPathStyleOption(options);
  const pinnedOptions = snapshotStaticExportOptions(options);
  assertStaticExportCompileDiagnostics(
    combinedStaticExportCompileDiagnostics(app.diagnostics, pinnedOptions.diagnostics ?? []),
  );
  if (pinnedOptions.outDir !== undefined) staticExportOutputRoot(pinnedOptions.outDir);

  // SPEC §6.6/§9.5: route replay executes authored code in this realm. Convert every configured
  // asset to a framework-owned artifact, and prepare the public-root discovery authority, before
  // any route can mutate its original option/asset carriers or ambient intrinsics.
  const configuredAssets = staticExportAssetArtifacts(pinnedOptions.assets ?? []);
  const publicAssetDiscovery =
    pinnedOptions.publicAssetRoot === undefined
      ? undefined
      : await prepareDocumentPublicAssetDiscovery({
          app,
          base: pinnedOptions.publicAssetBase,
          configuredAssets,
          root: pinnedOptions.publicAssetRoot,
        });

  const replay = await replayStaticExportApp({
    app,
    ...(pinnedOptions.onNonExportable === undefined
      ? {}
      : { onNonExportable: pinnedOptions.onNonExportable }),
    ...(pinnedOptions.origin === undefined ? {} : { origin: pinnedOptions.origin }),
  });
  const publicAssetInputs =
    publicAssetDiscovery === undefined
      ? []
      : await documentPublicAssetInputs(publicAssetDiscovery, replay.artifacts);
  const assets = combineStaticExportAssets(
    configuredAssets,
    staticExportAssetArtifacts(publicAssetInputs),
  );
  const artifacts = await applyStaticExportSubresourceIntegrity({
    artifacts: replay.artifacts,
    assets,
    clientModules: replay.clientModules,
    origin: pinnedOptions.origin ?? 'https://kovo.local',
  });
  const outputPlan = createStaticExportOutputPlan({
    artifacts,
    assets,
    clientModules: replay.clientModules,
    outDir: pinnedOptions.outDir ?? STATIC_EXPORT_DRY_RUN_ROOT,
  });

  if (pinnedOptions.outDir !== undefined) {
    await writeStaticExportOutput(outputPlan);
  }

  return {
    artifacts,
    assets,
    clientModules: replay.clientModules,
    diagnostics: replay.diagnostics,
  };
}

function snapshotStaticExportOptions(options: StaticExportOptions): StaticExportOptions {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Kovo static-export options must be an own-data object.');
  }

  const snapshot = witnessCreateNullRecord<unknown>() as StaticExportOptions;
  const assets = optionalStaticExportOption(options, 'assets');
  const diagnostics = optionalStaticExportOption(options, 'diagnostics');
  const onNonExportable = optionalStaticExportOption(options, 'onNonExportable');
  const origin = optionalStaticExportOption(options, 'origin');
  const outDir = optionalStaticExportOption(options, 'outDir');
  const publicAssetBase = optionalStaticExportOption(options, 'publicAssetBase');
  const publicAssetRoot = optionalStaticExportOption(options, 'publicAssetRoot');

  if (assets !== undefined) {
    commitStaticExportOption(
      snapshot,
      'assets',
      assets as NonNullable<StaticExportOptions['assets']>,
    );
  }
  if (diagnostics !== undefined) {
    commitStaticExportOption(
      snapshot,
      'diagnostics',
      diagnostics as NonNullable<StaticExportOptions['diagnostics']>,
    );
  }
  if (onNonExportable !== undefined) {
    commitStaticExportOption(
      snapshot,
      'onNonExportable',
      onNonExportable as NonNullable<StaticExportOptions['onNonExportable']>,
    );
  }
  if (origin !== undefined) commitStaticExportOption(snapshot, 'origin', origin as string);
  if (outDir !== undefined) commitStaticExportOption(snapshot, 'outDir', outDir as string | URL);
  if (publicAssetBase !== undefined)
    commitStaticExportOption(snapshot, 'publicAssetBase', publicAssetBase as string);
  if (publicAssetRoot !== undefined)
    commitStaticExportOption(snapshot, 'publicAssetRoot', publicAssetRoot as string | URL);
  return witnessFreeze(snapshot);
}

function commitStaticExportOption<Key extends keyof StaticExportOptions>(
  snapshot: StaticExportOptions,
  property: Key,
  value: NonNullable<StaticExportOptions[Key]>,
): void {
  witnessDefineProperty(snapshot, property, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

function optionalStaticExportOption(options: object, property: PropertyKey): unknown {
  const field = buildOwnDataProperty(
    options,
    property,
    `static-export options.${String(property)}`,
  );
  return field.present ? field.value : undefined;
}

function combinedStaticExportCompileDiagnostics(
  appDiagnostics: KovoApp['diagnostics'],
  optionDiagnostics: NonNullable<StaticExportOptions['diagnostics']>,
) {
  const appSource = snapshotBuildArray(appDiagnostics, 'app compile diagnostics');
  const optionSource = snapshotBuildArray(optionDiagnostics, 'static-export option diagnostics');
  const combined: (typeof appSource)[number][] = [];
  for (let index = 0; index < appSource.length; index += 1) {
    witnessArrayAppend(
      combined,
      appSource[index]!,
      'Server packages/server/src/static-export.ts collection',
    );
  }
  for (let index = 0; index < optionSource.length; index += 1) {
    witnessArrayAppend(
      combined,
      optionSource[index]!,
      'Server packages/server/src/static-export.ts collection',
    );
  }
  return combined;
}

interface DocumentPublicAssetDiscovery {
  base: string;
  buildOwnedStylesheetHrefSet: Set<string>;
  configuredPaths: Set<string>;
  fileSystem: FrameworkOutputFileSystemBoundary;
  root: string;
  stylesheetReferencedPaths: readonly string[];
}

async function prepareDocumentPublicAssetDiscovery(options: {
  app: KovoApp;
  base: string | undefined;
  configuredAssets: readonly StaticExportAssetArtifact[];
  root: string | URL;
}): Promise<DocumentPublicAssetDiscovery> {
  const root = staticExportPublicAssetRoot(options.root);
  const base = normalizedStaticExportPublicAssetBase(options.base);
  const buildOwnedStylesheetHrefSet = buildOwnedStylesheetHrefs(options.app, base);
  const configuredAssets = snapshotBuildArray(
    options.configuredAssets,
    'configured static-export public-discovery assets',
  );
  const configuredPaths = createSecuritySet<string>();
  for (let index = 0; index < configuredAssets.length; index += 1) {
    securitySetAdd(
      configuredPaths,
      requiredBuildString(
        configuredAssets[index]!,
        'path',
        `configured static-export public-discovery asset ${index}.path`,
      ),
    );
  }
  const fileSystem = createFrameworkOutputFileSystemBoundary(root);
  return {
    base,
    buildOwnedStylesheetHrefSet,
    configuredPaths,
    fileSystem,
    root: fileSystem.root,
    stylesheetReferencedPaths: await stylesheetReferencedStaticAssetPaths(configuredAssets, base),
  };
}

async function documentPublicAssetInputs(
  discovery: DocumentPublicAssetDiscovery,
  artifacts: StaticExportResult['artifacts'],
): Promise<StaticExportAssetInput[]> {
  const pinnedArtifacts = snapshotBuildArray(
    artifacts,
    'static-export public-discovery route artifacts',
  );
  const documentPaths = createSecuritySet<string>();
  for (let index = 0; index < pinnedArtifacts.length; index += 1) {
    securitySetAdd(
      documentPaths,
      requiredBuildString(
        pinnedArtifacts[index]!,
        'path',
        `static-export public-discovery route artifact ${index}.path`,
      ),
    );
  }
  const publicAssets: StaticExportAssetInput[] = [];
  const diagnostics: ReturnType<typeof staticExportDiagnostic>[] = [];
  const referencedPaths = createSecuritySet<string>();

  const documentReferences = documentReferencedStaticAssetPaths(pinnedArtifacts, discovery.base);
  for (let index = 0; index < documentReferences.length; index += 1) {
    securitySetAdd(referencedPaths, documentReferences[index]!);
  }
  const stylesheetReferences = snapshotBuildArray(
    discovery.stylesheetReferencedPaths,
    'static-export public-discovery stylesheet references',
  );
  for (let index = 0; index < stylesheetReferences.length; index += 1) {
    securitySetAdd(referencedPaths, stylesheetReferences[index]!);
  }

  const orderedReferences = sortedSecurityStringSet(referencedPaths);
  for (let index = 0; index < orderedReferences.length; index += 1) {
    const hrefPath = orderedReferences[index]!;
    if (
      securitySetHas(discovery.configuredPaths, hrefPath) ||
      securitySetHas(documentPaths, hrefPath)
    ) {
      continue;
    }
    if (securityStringStartsWith(hrefPath, '/c/')) continue;
    if (securitySetHas(discovery.buildOwnedStylesheetHrefSet, hrefPath)) continue;

    const source = staticExportPublicAssetSource(discovery.fileSystem, discovery.base, hrefPath);
    if ((await discovery.fileSystem.fileExists(source.relativePath)) === false) {
      witnessArrayAppend(
        diagnostics,
        staticExportDiagnostic(
          hrefPath,
          `KV229 static export cannot copy referenced public asset '${hrefPath}' because source '${source.source}' was not found under public asset root '${discovery.root}'. SPEC §9.5 exports referenced static assets with route documents.`,
        ),
        'Server packages/server/src/static-export.ts collection',
      );
      continue;
    }

    securitySetAdd(discovery.configuredPaths, hrefPath);
    witnessArrayAppend(
      publicAssets,
      { path: hrefPath, source: source.source },
      'Server packages/server/src/static-export.ts collection',
    );
  }

  if (diagnostics.length > 0) throw new StaticExportError(diagnostics);
  return publicAssets;
}

function combineStaticExportAssets(
  configuredAssets: readonly StaticExportAssetArtifact[],
  publicAssets: readonly StaticExportAssetArtifact[],
): StaticExportAssetArtifact[] {
  const configured = snapshotBuildArray(configuredAssets, 'configured static-export assets');
  const discovered = snapshotBuildArray(publicAssets, 'discovered static-export public assets');
  const combined: StaticExportAssetArtifact[] = [];
  for (let index = 0; index < configured.length; index += 1) {
    witnessArrayAppend(
      combined,
      configured[index]!,
      'Server packages/server/src/static-export.ts collection',
    );
  }
  for (let index = 0; index < discovered.length; index += 1) {
    witnessArrayAppend(
      combined,
      discovered[index]!,
      'Server packages/server/src/static-export.ts collection',
    );
  }
  return combined;
}

function buildOwnedStylesheetHrefs(app: KovoApp, base: string): Set<string> {
  const hrefs = createSecuritySet<string>();
  const appStylesheets = snapshotBuildArray(
    app.stylesheets,
    'static-export app-wide stylesheet declarations',
  );
  for (let index = 0; index < appStylesheets.length; index += 1) {
    addBuildOwnedStylesheetHref(hrefs, appStylesheets[index]!, base);
  }

  const routes = snapshotBuildArray(app.routes, 'static-export stylesheet route declarations');
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const routeStylesheets = buildOwnDataProperty(
      routes[routeIndex]!,
      'stylesheets',
      `static-export route ${routeIndex}.stylesheets`,
    );
    if (!routeStylesheets.present || routeStylesheets.value === undefined) continue;
    const stylesheets = snapshotBuildArray(
      routeStylesheets.value as readonly KovoApp['stylesheets'][number][],
      `static-export route ${routeIndex} stylesheet declarations`,
    );
    for (let stylesheetIndex = 0; stylesheetIndex < stylesheets.length; stylesheetIndex += 1) {
      const stylesheet = stylesheets[stylesheetIndex]!;
      addBuildOwnedStylesheetHref(hrefs, stylesheet, base);
    }
  }
  return hrefs;
}

function addBuildOwnedStylesheetHref(
  hrefs: Set<string>,
  stylesheet: KovoApp['stylesheets'][number],
  base: string,
): void {
  if (typeof stylesheet === 'string') return;

  const href = requiredBuildString(stylesheet, 'href', 'build-owned stylesheet href');
  const hrefPath = staticExportPublicHrefPath(href, base, 'https://kovo.local/');
  if (hrefPath !== undefined && buildSecurityPosixExtname(hrefPath) === '.css') {
    securitySetAdd(hrefs, hrefPath);
  }
}

function documentReferencedStaticAssetPaths(
  artifacts: StaticExportResult['artifacts'],
  base: string,
): string[] {
  const paths = createSecuritySet<string>();
  const pinnedArtifacts = snapshotBuildArray(
    artifacts,
    'static-export public-discovery document artifacts',
  );
  for (let artifactIndex = 0; artifactIndex < pinnedArtifacts.length; artifactIndex += 1) {
    const artifact = pinnedArtifacts[artifactIndex]!;
    const body = requiredBuildString(
      artifact,
      'body',
      `static-export public-discovery document artifact ${artifactIndex}.body`,
    );
    const rawHrefs = htmlAttributeUrls(body);
    for (let hrefIndex = 0; hrefIndex < rawHrefs.length; hrefIndex += 1) {
      const rawHref = rawHrefs[hrefIndex]!;
      const hrefPath = staticExportPublicHrefPath(rawHref, base, 'https://kovo.local/');
      if (hrefPath !== undefined) securitySetAdd(paths, hrefPath);
    }
  }
  return sortedSecurityStringSet(paths);
}

async function stylesheetReferencedStaticAssetPaths(
  configuredAssets: readonly StaticExportAssetArtifact[],
  base: string,
): Promise<string[]> {
  const paths = createSecuritySet<string>();
  const assets = snapshotBuildArray(configuredAssets, 'configured static-export stylesheet assets');
  for (let assetIndex = 0; assetIndex < assets.length; assetIndex += 1) {
    const asset = assets[assetIndex]!;
    const assetPath = requiredBuildString(
      asset,
      'path',
      `configured static-export stylesheet asset ${assetIndex}.path`,
    );
    if (buildSecurityPosixExtname(assetPath) !== '.css') continue;
    const source = requiredBuildString(
      asset,
      'source',
      `configured static-export stylesheet asset ${assetIndex}.source`,
    );

    let css: string;
    try {
      css = await readFrameworkTextFile(source);
    } catch {
      continue;
    }

    const assetDirectory =
      securityRegExpReplace(buildSecurityPosixDirname(assetPath), /\/+$/u, '') || '/';
    const cssUrlBase = `https://kovo.local${assetDirectory}/`;
    const rawHrefs = cssUrlUrls(css);
    for (let hrefIndex = 0; hrefIndex < rawHrefs.length; hrefIndex += 1) {
      const rawHref = rawHrefs[hrefIndex]!;
      const hrefPath = staticExportPublicHrefPath(rawHref, base, cssUrlBase);
      if (hrefPath !== undefined && !isConfiguredAssetNamespaceHref(hrefPath, assetDirectory)) {
        securitySetAdd(paths, hrefPath);
      }
    }
  }
  return sortedSecurityStringSet(paths);
}

function isConfiguredAssetNamespaceHref(hrefPath: string, assetDirectory: string): boolean {
  return assetDirectory !== '/' && securityStringStartsWith(hrefPath, `${assetDirectory}/`);
}

function sortedSecurityStringSet(values: ReadonlySet<string>): string[] {
  const result: string[] = [];
  witnessSetForEach(values, (value) => {
    witnessArrayAppend(result, value, 'Server packages/server/src/static-export.ts collection');
  });
  securityArraySort(result, (left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return result;
}

function requiredBuildString(value: object, property: PropertyKey, label: string): string {
  const field = buildOwnDataProperty(value, property, label);
  if (!field.present || typeof field.value !== 'string') {
    throw new TypeError(`Kovo build security boundary expected ${label} to be a string.`);
  }
  return field.value;
}

function htmlAttributeUrls(html: string): string[] {
  const urls: string[] = [];
  const attrPattern = /\s(?:href|src|poster)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = securityRegExpExec(attrPattern, html)) !== null) {
    if (match[1] !== undefined)
      witnessArrayAppend(urls, match[1], 'Server packages/server/src/static-export.ts collection');
  }

  const srcsetPattern = /\ssrcset=["']([^"']+)["']/gi;
  while ((match = securityRegExpExec(srcsetPattern, html)) !== null) {
    const candidates = securityStringSplit(match[1] ?? '', ',');
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = securityStringTrim(candidates[index]!);
      const whitespace = securityRegExpExec(/\s/u, candidate);
      const url =
        whitespace === null ? candidate : securityStringSlice(candidate, 0, whitespace.index);
      if (url !== '')
        witnessArrayAppend(urls, url, 'Server packages/server/src/static-export.ts collection');
    }
  }
  return urls;
}

function cssUrlUrls(css: string): string[] {
  const urls: string[] = [];
  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = securityRegExpExec(urlPattern, css)) !== null) {
    const rawUrl = match[1] ?? match[2] ?? match[3];
    if (rawUrl !== undefined)
      witnessArrayAppend(
        urls,
        securityStringTrim(rawUrl),
        'Server packages/server/src/static-export.ts collection',
      );
  }
  return urls;
}

function staticExportPublicHrefPath(
  rawHref: string,
  base: string,
  resolutionBase: string,
): string | undefined {
  if (
    rawHref === '' ||
    securityStringStartsWith(rawHref, '#') ||
    securityStringStartsWith(rawHref, 'data:') ||
    securityStringStartsWith(rawHref, 'javascript:') ||
    securityStringStartsWith(rawHref, 'mailto:') ||
    securityStringStartsWith(rawHref, 'tel:')
  ) {
    return undefined;
  }

  let url: ReturnType<typeof securityUrlSnapshot>;
  try {
    url = securityUrlSnapshot(rawHref, resolutionBase);
  } catch {
    return undefined;
  }
  if (url.origin !== 'https://kovo.local') return undefined;
  if (!securityStringStartsWith(url.pathname, '/')) return undefined;
  if (
    base !== '/' &&
    url.pathname !== securityStringSlice(base, 0, -1) &&
    !securityStringStartsWith(url.pathname, base)
  ) {
    return undefined;
  }
  if (securityStringEndsWith(url.pathname, '/')) return undefined;
  if (buildSecurityPosixExtname(url.pathname) === '') return undefined;
  return url.pathname;
}

function staticExportPublicAssetSource(
  fileSystem: FrameworkOutputFileSystemBoundary,
  base: string,
  hrefPath: string,
): { relativePath: string; source: string } {
  const sourcePathname =
    base === '/'
      ? hrefPath
      : hrefPath === securityStringSlice(base, 0, -1)
        ? '/'
        : securityStringSlice(hrefPath, base.length - 1);
  let decodedPathname: string;
  try {
    decodedPathname = buildSecurityDecodeURIComponent(sourcePathname);
  } catch {
    decodedPathname = sourcePathname;
  }

  const relativePath = `.${decodedPathname}`;
  const source = fileSystem.confinedPath(relativePath);
  if (source !== undefined && source !== fileSystem.root) return { relativePath, source };

  throw new StaticExportError([
    staticExportDiagnostic(
      hrefPath,
      `KV229 static export cannot copy referenced public asset '${hrefPath}' because it escapes public asset root '${fileSystem.root}'. SPEC §9.5 exports referenced static assets with route documents.`,
    ),
  ]);
}

function normalizedStaticExportPublicAssetBase(base: string | undefined): string {
  if (base === undefined) return '/';
  const normalized = `/${securityRegExpReplace(base, /^\/+|\/+$/gu, '')}/`;
  return normalized === '//' ? '/' : normalized;
}

function staticExportPublicAssetRoot(root: string | URL): string {
  if (securityIsUrl(root)) {
    const snapshot = securityUrlObjectSnapshot(root);
    if (snapshot.protocol === 'file:') {
      return buildSecurityPathResolve(buildSecurityFileUrlToPath(snapshot.href));
    }

    throw new StaticExportError([
      staticExportDiagnostic(
        'publicAssetRoot',
        `KV229 static export cannot copy public assets from '${snapshot.href}'. Public asset roots must be filesystem paths or file: URLs.`,
      ),
    ]);
  }
  return buildSecurityPathResolve(root);
}

async function readFrameworkTextFile(source: string): Promise<string> {
  const root = buildSecurityPathDirname(source);
  const bytes = await createFrameworkOutputFileSystemBoundary(root).fileBytes(
    buildSecurityPathBasename(source),
  );
  if (bytes === undefined) throw new Error(`File '${source}' was not found.`);
  return securityDecodeUtf8Fatal(bytes);
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
  if (!buildOwnDataProperty(options, 'htmlPathStyle', 'static-export htmlPathStyle').present) {
    return;
  }

  throw new StaticExportError([
    staticExportDiagnostic(
      'htmlPathStyle',
      'KV229 static export refused htmlPathStyle. SPEC §9.5 exports route documents as directory-index HTML; remove this option.',
    ),
  ]);
}
