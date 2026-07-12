import { fileURLToPath } from 'node:url';

import {
  cspHashAttribute,
  cspSha256,
  hasCspInlineMetadata,
  mergeCspInlineMetadata,
  type CspInlineMetadata,
} from './csp.js';
import { escapeAttribute, escapeHtml, escapeScriptJson, safeUrlValue } from './html.js';
import {
  createWitnessWeakMap,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import {
  createSecurityMap,
  createSecurityNullRecord,
  createSecuritySet,
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityEncodeUri,
  securityJsonStringify,
  securityMapGet,
  securityMapSet,
  securityNumberIsInteger,
  securityObjectKeys,
  securityRegExpExec,
  securityRegExpReplace,
  securityRegExpTest,
  securitySetAdd,
  securitySetHas,
  securityStringCharCodeAt,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringReplaceAll,
  securityStringSlice,
  securityStringSplit,
  securityStringStartsWith,
  securityStringTrim,
  securityUrlSnapshot,
} from './response-security-intrinsics.js';

const stylesheetSourceProvenance = createWitnessWeakMap<
  StylesheetAsset,
  {
    readonly file?: string;
    readonly path?: string;
  }
>();

/**
 * Per-route Speculation Rules eagerness (SPEC §8). `'conservative'` and `'moderate'`
 * opt into prefetch/prerender; `false` (the default) emits nothing. `'moderate'` is
 * compile-gated on guarded/session-dependent routes (KV419).
 */
export type RoutePrefetch = 'conservative' | 'moderate' | false;

/** Resolved document `<head>` metadata (title, description, OG image) for a route. */
export interface RouteMeta {
  description?: string;
  image?: string;
  title?: string;
}

/**
 * Query-dependent route metadata source: names the `queries` it reads and `resolve`s
 * those values into a `RouteMeta` at render time.
 */
export interface RouteMetaFactory {
  queries: readonly string[];
  resolve(values: Record<string, unknown>): RouteMeta;
}

/** Param/search-aware route metadata callback (SPEC §6.4). */
export type RouteMetaCallback<
  Context = unknown,
  Queries extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> = (context: Context, queries: Queries) => RouteMeta;

/** A route's `meta`: static, query-driven, or route-context-driven metadata. */
export type RouteMetaSource<Context = unknown> =
  | RouteMeta
  | RouteMetaFactory
  | RouteMetaCallback<Context>;

/**
 * A localization message catalog inlined into the document for a locale. Serialized
 * into a `kovo-i18n` JSON script tag by the page-hint renderer.
 */
export interface I18nCatalog<Messages extends Record<string, string> = Record<string, string>> {
  locale: string;
  messages: Messages;
}

/**
 * A resolved stylesheet asset for route/page hints (SPEC §13.1): the linked `href`,
 * optional inlined `criticalCss` with its `cspHash`, and whether to `preload` it via
 * Early Hints. Produced by {@link stylesheet} and accepted in {@link PageHintOptions}.
 */
export interface StylesheetAsset {
  criticalCss?: string;
  cspHash?: string;
  /**
   * `true` defers the linked stylesheet behind a preload plus no-JS fallback. By default the
   * stylesheet remains render-blocking even when critical CSS is inlined.
   */
  deferFull?: boolean;
  href: string;
  preload?: boolean;
}

/** Theme CSS accepted by {@link stylesheet}; usually a Kovo theme object from `@kovojs/style`. */
export type StylesheetTheme = string | { readonly css: string };

/** Options for declaring an authored stylesheet asset (SPEC.md §13.1). */
export interface StylesheetDeclarationOptions {
  /** Critical CSS to inline before the linked stylesheet identity. */
  criticalCss?: string | readonly string[];
  /**
   * How theme CSS prepended to critical CSS should be inlined. The default
   * (`'used'`) keeps only custom properties reachable from `criticalCss`
   * `var(...)` references; `'all'` keeps the full theme block.
   */
  criticalCssTheme?: 'all' | 'used';
  /** Optional CSP hash for the inlined critical CSS. */
  cspHash?: string;
  /**
   * `true` defers the linked stylesheet behind a preload plus no-JS fallback. By default the
   * stylesheet remains render-blocking even when critical CSS is inlined.
   */
  deferFull?: boolean;
  /** Public stylesheet href; local sources derive `/assets/<file>` when omitted. */
  href?: string;
  /** Whether Early Hints should preload the linked stylesheet. */
  preload?: boolean;
  /** Theme CSS to prepend to `criticalCss`. */
  theme?: StylesheetTheme;
}

/** @internal */
export interface StylesheetManifestEntry extends StylesheetAsset {
  fragmentTargets?: readonly string[];
  sourceFileName?: string;
}

/**
 * Inputs for rendering a route's document hints: stylesheets and critical CSS (SPEC §13.1),
 * `<head>` `meta`, i18n catalogs, module preloads, bootstrap script, and Speculation Rules
 * prefetch/prerender (SPEC §8). Page, mutation-fragment, and deferred-fragment renders share
 * this stylesheet-delivery shape.
 */
// SPEC section 13.1: page, mutation fragment, and deferred fragment renders share stylesheet delivery.
export interface PageHintOptions<MetaContext = unknown> {
  bootstrapScript?: string;
  i18n?: I18nCatalog | readonly I18nCatalog[];
  meta?: RouteMetaSource<MetaContext> | readonly RouteMetaSource<MetaContext>[];
  modulepreloads?: readonly string[];
  prefetch?: RoutePrefetch;
  /**
   * Named justification that suppresses KV419 on a guarded `prefetch:'moderate'` route.
   *
   * SPEC §8:756 allows guarded moderate prefetch when the author supplies an explicit
   * rationale (e.g. `"route is idempotent and safe for credentialed prerender"`).
   * A non-empty string silences the diagnostic; an absent or empty string is ignored.
   */
  prefetchJustification?: string;
  prerenderUrls?: readonly string[];
  stylesheets?: readonly (string | StylesheetAsset)[];
}

/** @internal */
export interface PageHintRenderContext<MetaContext = unknown> {
  queries?: Record<string, unknown>;
  route?: MetaContext;
}

/** @internal */
export interface PageHints {
  csp?: CspInlineMetadata;
  earlyHints: Record<string, string>;
  html: string;
}

interface InlineHtmlWithCsp {
  csp?: CspInlineMetadata;
  html: string;
}

/** @internal */
export function stylesheetsForTargets(
  manifest: readonly StylesheetManifestEntry[],
  targets?: readonly string[],
): StylesheetAsset[] {
  const manifestSnapshot = snapshotHintArray(manifest, 'stylesheet manifest');
  if (!targets) return dedupeStylesheets(manifestSnapshot);

  const wanted = createSecuritySet<string>();
  const targetSnapshot = snapshotStringHintArray(targets, 'stylesheet fragment targets');
  for (let index = 0; index < targetSnapshot.length; index += 1) {
    securitySetAdd(wanted, targetSnapshot[index]!);
  }
  const matched: StylesheetManifestEntry[] = [];
  for (let index = 0; index < manifestSnapshot.length; index += 1) {
    const asset = manifestSnapshot[index]!;
    const fragmentTargets = stableHintValue(asset, 'fragmentTargets', 'stylesheet manifest asset');
    if (fragmentTargets === undefined || !securityArrayIsArray(fragmentTargets)) continue;
    const values = snapshotStringHintArray(fragmentTargets, 'stylesheet manifest fragmentTargets');
    let includes = false;
    for (let targetIndex = 0; targetIndex < values.length; targetIndex += 1) {
      if (securitySetHas(wanted, values[targetIndex]!)) includes = true;
    }
    if (includes) securityArrayPush(matched, asset);
  }
  return dedupeStylesheets(matched);
}

/**
 * Declare a local or external stylesheet for route/page hints.
 *
 * Local paths derive `/assets/<file>` unless `options.href` overrides it; external
 * and root-relative hrefs are preserved.
 */
export function stylesheet(source: string, options?: StylesheetDeclarationOptions): StylesheetAsset;
/** Declare a theme-only or fully configured stylesheet asset for route/page hints. */
export function stylesheet(options: StylesheetDeclarationOptions): StylesheetAsset;
export function stylesheet(
  sourceOrOptions: string | StylesheetDeclarationOptions,
  maybeOptions: StylesheetDeclarationOptions = {},
): StylesheetAsset {
  const source = typeof sourceOrOptions === 'string' ? sourceOrOptions : undefined;
  const options = snapshotStylesheetDeclarationOptions(
    typeof sourceOrOptions === 'string' ? maybeOptions : sourceOrOptions,
  );
  const criticalCss = resolveStylesheetCriticalCss(options);
  const href = options.href ?? (source ? stylesheetHrefForSource(source) : '/assets/styles.css');
  const asset: StylesheetAsset = {
    ...(criticalCss ? { criticalCss } : {}),
    ...(options.cspHash === undefined ? {} : { cspHash: options.cspHash }),
    ...(options.deferFull === undefined ? {} : { deferFull: options.deferFull }),
    href,
    ...(options.preload === undefined ? {} : { preload: options.preload }),
  };
  const sourcePath = source === undefined ? undefined : localStylesheetSourcePath(source);
  const sourceFile = sourcePath === undefined ? undefined : localStylesheetSourceFile(sourcePath);
  if (sourcePath !== undefined || sourceFile !== undefined) {
    witnessWeakMapSet(stylesheetSourceProvenance, asset, {
      ...(sourceFile === undefined ? {} : { file: sourceFile }),
      ...(sourcePath === undefined ? {} : { path: sourcePath }),
    });
  }
  return asset;
}

/** @internal */
export function stylesheetSourceFile(asset: StylesheetAsset): string | undefined {
  return witnessWeakMapGet(stylesheetSourceProvenance, asset)?.file;
}

/** @internal */
export function stylesheetSourcePath(asset: StylesheetAsset): string | undefined {
  return witnessWeakMapGet(stylesheetSourceProvenance, asset)?.path;
}

/** @internal Descriptor-snapshot an authored stylesheet while preserving source provenance. */
export function snapshotStylesheetAsset(source: StylesheetAsset): StylesheetAsset {
  if (typeof source !== 'object' || source === null || securityArrayIsArray(source)) {
    throw new TypeError('Kovo stylesheet assets must be stable own-data objects.');
  }

  const read = (property: keyof StylesheetAsset): unknown => {
    const before = witnessGetOwnPropertyDescriptor(source, property);
    const after = witnessGetOwnPropertyDescriptor(source, property);
    if (
      (before === undefined) !== (after === undefined) ||
      (before !== undefined &&
        (!('value' in before) ||
          after === undefined ||
          !('value' in after) ||
          !witnessObjectIs(before.value, after.value)))
    ) {
      throw new TypeError(`Kovo stylesheet asset.${property} must be a stable own data property.`);
    }
    return before === undefined ? undefined : before.value;
  };

  const href = read('href');
  const criticalCss = read('criticalCss');
  const cspHash = read('cspHash');
  const deferFull = read('deferFull');
  const preload = read('preload');
  if (typeof href !== 'string') throw new TypeError('Kovo stylesheet asset.href must be a string.');
  if (criticalCss !== undefined && typeof criticalCss !== 'string') {
    throw new TypeError('Kovo stylesheet asset.criticalCss must be a string.');
  }
  if (cspHash !== undefined && typeof cspHash !== 'string') {
    throw new TypeError('Kovo stylesheet asset.cspHash must be a string.');
  }
  if (deferFull !== undefined && typeof deferFull !== 'boolean') {
    throw new TypeError('Kovo stylesheet asset.deferFull must be a boolean.');
  }
  if (preload !== undefined && typeof preload !== 'boolean') {
    throw new TypeError('Kovo stylesheet asset.preload must be a boolean.');
  }

  const snapshot = witnessFreeze({
    ...(criticalCss === undefined ? {} : { criticalCss }),
    ...(cspHash === undefined ? {} : { cspHash }),
    ...(deferFull === undefined ? {} : { deferFull }),
    href,
    ...(preload === undefined ? {} : { preload }),
  });
  const provenance = witnessWeakMapGet(stylesheetSourceProvenance, source);
  if (provenance !== undefined) witnessWeakMapSet(stylesheetSourceProvenance, snapshot, provenance);
  return snapshot;
}

/**
 * Render framework document hints, preload tags, and speculation metadata.
 *
 * @internal
 */
export function renderPageHints(
  options: PageHintOptions,
  context: PageHintRenderContext = {},
): PageHints {
  const snapshot = snapshotPageHintOptions(options);
  const moduleCandidates = snapshot.modulepreloads ?? [];
  const modulepreloads = dedupe(moduleCandidates);
  if (snapshot.bootstrapScript) appendUnique(modulepreloads, snapshot.bootstrapScript);
  const stylesheets = dedupeStylesheets(snapshot.stylesheets ?? []);
  const stylesheetHints: InlineHtmlWithCsp[] = [];
  for (let index = 0; index < stylesheets.length; index += 1) {
    securityArrayPush(stylesheetHints, renderPageStylesheetHint(stylesheets[index]!));
  }
  const i18nCatalogs = renderI18nCatalogs(snapshot.i18n);
  const speculationRules = renderSpeculationRules(
    snapshot.prefetch ?? false,
    snapshot.prerenderUrls ?? [],
  );
  const cspParts: (CspInlineMetadata | undefined)[] = [];
  for (let index = 0; index < stylesheetHints.length; index += 1) {
    securityArrayPush(cspParts, stylesheetHints[index]!.csp);
  }
  for (let index = 0; index < i18nCatalogs.length; index += 1) {
    securityArrayPush(cspParts, i18nCatalogs[index]!.csp);
  }
  securityArrayPush(cspParts, speculationRules.csp);
  let csp = mergeCspInlineMetadata();
  for (let index = 0; index < cspParts.length; index += 1) {
    csp = mergeCspInlineMetadata(csp, cspParts[index]);
  }
  const htmlParts = renderRouteMeta(snapshot.meta, context);
  for (let index = 0; index < i18nCatalogs.length; index += 1) {
    securityArrayPush(htmlParts, i18nCatalogs[index]!.html);
  }
  for (let index = 0; index < stylesheetHints.length; index += 1) {
    securityArrayPush(htmlParts, stylesheetHints[index]!.html);
  }
  for (let index = 0; index < modulepreloads.length; index += 1) {
    const href = safeHintUrl(modulepreloads[index]!, 'modulepreload');
    securityArrayPush(
      htmlParts,
      `<link rel="modulepreload" href="${escapeAttribute(href)}"${isKovoClientModuleHref(href) ? ' data-kovo-module-allowlist' : ''}>`,
    );
  }
  if (snapshot.bootstrapScript) {
    const bootstrapScript = safeHintUrl(snapshot.bootstrapScript, 'bootstrap script');
    securityArrayPush(
      htmlParts,
      `<script type="module" src="${escapeAttribute(bootstrapScript)}"></script>`,
    );
  }
  if (speculationRules.html !== '') securityArrayPush(htmlParts, speculationRules.html);
  const html = securityArrayJoin(htmlParts, '');

  return {
    ...(hasCspInlineMetadata(csp) ? { csp } : {}),
    earlyHints: renderEarlyHints(stylesheets, modulepreloads),
    html,
  };
}

export function renderStylesheetLinks(stylesheets: readonly (string | StylesheetAsset)[]): string {
  const assets = dedupeStylesheets(snapshotHintArray(stylesheets, 'stylesheet links'));
  const links: string[] = [];
  for (let index = 0; index < assets.length; index += 1) {
    securityArrayPush(links, renderStylesheetLink(assets[index]!.href));
  }
  return securityArrayJoin(links, '');
}

function dedupe(values: readonly string[]): string[] {
  const seen = createSecuritySet<string>();
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === '' || securitySetHas(seen, value)) continue;
    securitySetAdd(seen, value);
    securityArrayPush(result, value);
  }
  return result;
}

function isKovoClientModuleHref(href: string): boolean {
  return securityStringStartsWith(href, '/c/');
}

function dedupeStylesheets(values: readonly (string | StylesheetAsset)[]): StylesheetAsset[] {
  const seen = createSecurityMap<string, number>();
  const assets: StylesheetAsset[] = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const asset =
      typeof value === 'string'
        ? snapshotStylesheetAsset({ href: safeHintUrl(value, 'stylesheet'), preload: true })
        : snapshotStylesheetAsset(value);
    if (!asset.href) continue;

    const existingIndex = securityMapGet(seen, asset.href);
    if (existingIndex !== undefined) {
      const existing = assets[existingIndex];
      if (existing) assets[existingIndex] = mergeStylesheetAsset(existing, asset);
      continue;
    }

    securityMapSet(seen, asset.href, assets.length);
    securityArrayPush(assets, asset);
  }

  return assets;
}

function mergeStylesheetAsset(
  existing: StylesheetAsset,
  incoming: StylesheetAsset,
): StylesheetAsset {
  const merged: StylesheetAsset = { ...existing };
  if (!merged.criticalCss && incoming.criticalCss) merged.criticalCss = incoming.criticalCss;
  if (incoming.cspHash !== undefined) merged.cspHash = incoming.cspHash;
  if (incoming.deferFull !== undefined) merged.deferFull = incoming.deferFull;
  if (incoming.preload !== undefined) merged.preload = incoming.preload;
  return merged;
}

function renderPageStylesheetHint(asset: StylesheetAsset): InlineHtmlWithCsp {
  const href = safeHintUrl(asset.href, 'stylesheet');
  const link = renderStylesheetLink(href);
  if (!asset.criticalCss) {
    return {
      html:
        asset.deferFull === true
          ? `${renderDeferredStylesheetLink(href)}<noscript>${link}</noscript>`
          : link,
    };
  }

  const cssText = escapeStyleText(asset.criticalCss);
  const hash = asset.cspHash ?? cspSha256(cssText);
  const fullStylesheet =
    asset.deferFull === true
      ? `${renderDeferredStylesheetLink(href)}<noscript>${link}</noscript>`
      : link;

  return {
    csp: { scripts: [], styles: [hash] },
    html: `<style data-kovo-critical-href="${escapeAttribute(href)}" ${cspHashAttribute(hash)}>${cssText}</style>${fullStylesheet}`,
  };
}

function renderStylesheetLink(href: string): string {
  return `<link rel="stylesheet" href="${escapeAttribute(safeHintUrl(href, 'stylesheet'))}">`;
}

function renderDeferredStylesheetLink(href: string): string {
  return `<link rel="preload" as="style" href="${escapeAttribute(safeHintUrl(href, 'stylesheet'))}" data-kovo-deferred-style>`;
}

function renderEarlyHints(
  stylesheets: readonly StylesheetAsset[],
  modulepreloads: readonly string[],
): Record<string, string> {
  const links: string[] = [];
  for (let index = 0; index < stylesheets.length; index += 1) {
    const asset = stylesheets[index]!;
    if (asset.preload !== false) {
      securityArrayPush(
        links,
        `<${formatLinkHeaderTarget(safeHintUrl(asset.href, 'stylesheet'))}>; rel=preload; as=style`,
      );
    }
  }
  for (let index = 0; index < modulepreloads.length; index += 1) {
    securityArrayPush(
      links,
      `<${formatLinkHeaderTarget(safeHintUrl(modulepreloads[index]!, 'modulepreload'))}>; rel=modulepreload`,
    );
  }

  return links.length > 0 ? { Link: securityArrayJoin(links, ', ') } : {};
}

function formatLinkHeaderTarget(href: string): string {
  return securityStringReplaceAll(securityEncodeUri(href), ',', '%2C');
}

function stylesheetHrefForSource(source: string): string {
  if (isExternalStylesheetSource(source) || securityStringStartsWith(source, '/')) return source;

  const marker = firstIndexOfEither(source, '?', '#');
  const cleanSource = marker === -1 ? source : securityStringSlice(source, 0, marker);
  const suffix = securityStringSlice(source, cleanSource.length);
  const pieces = securityStringSplit(cleanSource, '/');
  let fileName: string | undefined;
  for (let index = 0; index < pieces.length; index += 1) {
    if (pieces[index] !== '') fileName = pieces[index];
  }
  return `/assets/${fileName || 'styles.css'}${suffix}`;
}

function isExternalStylesheetSource(source: string): boolean {
  return (
    securityRegExpTest(/^[a-zA-Z][a-zA-Z\d+.-]*:/, source) || securityStringStartsWith(source, '//')
  );
}

function localStylesheetSourcePath(source: string): string | undefined {
  if (isExternalStylesheetSource(source) || securityStringStartsWith(source, '/')) return undefined;

  const marker = firstIndexOfEither(source, '?', '#');
  const cleanSource = marker === -1 ? source : securityStringSlice(source, 0, marker);
  if (!cleanSource || securityStringStartsWith(cleanSource, '#')) return undefined;
  return cleanSource;
}

function localStylesheetSourceFile(cleanSource: string): string | undefined {
  const callerFile = stylesheetCallerFile(new Error().stack);
  if (callerFile === undefined) return undefined;
  try {
    const baseUrl = securityUrlSnapshot('.', callerFile).href;
    return fileURLToPath(securityUrlSnapshot(cleanSource, baseUrl).href);
  } catch {
    return undefined;
  }
}

function stylesheetCallerFile(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;

  const lines = securityStringSplit(stack, '\n');
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (securityStringIncludes(line, '/hints.') || securityStringIncludes(line, '\\hints.')) {
      continue;
    }

    const fileUrl = securityRegExpExec(/file:\/\/[^):\s]+/u, line)?.[0];
    if (fileUrl !== undefined) return fileUrl;

    const pathMatch = securityRegExpExec(/(?:(?:at\s+.*\()?)(\/[^():]+):\d+:\d+\)?/u, line)?.[1];
    if (pathMatch !== undefined) return `file://${pathMatch}`;
  }
  return undefined;
}

function resolveStylesheetCriticalCss(options: StylesheetDeclarationOptions): string | undefined {
  const themeCss = stylesheetThemeCss(options.theme);
  const candidates = securityArrayIsArray(options.criticalCss)
    ? snapshotHintArray(options.criticalCss, 'critical CSS')
    : [options.criticalCss];
  const criticalParts: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const part = candidates[index];
    if (typeof part === 'string' && part.length > 0) securityArrayPush(criticalParts, part);
  }
  const criticalCss = securityArrayJoin(criticalParts, '\n');
  const prunedThemeCss =
    themeCss === undefined ||
    criticalCss === '' ||
    options.criticalCssTheme === 'all' ||
    options.cspHash !== undefined
      ? themeCss
      : (pruneCriticalThemeCss(themeCss, criticalCss) ?? themeCss);
  const parts: string[] = [];
  if (typeof prunedThemeCss === 'string' && prunedThemeCss.length > 0) {
    securityArrayPush(parts, prunedThemeCss);
  }
  for (let index = 0; index < criticalParts.length; index += 1) {
    securityArrayPush(parts, criticalParts[index]!);
  }

  return parts.length > 0 ? securityArrayJoin(parts, '\n') : undefined;
}

function stylesheetThemeCss(theme: StylesheetTheme | undefined): string | undefined {
  if (typeof theme === 'string') return theme;
  return typeof theme?.css === 'string' ? theme.css : undefined;
}

interface CriticalCssBlock {
  declarations: CriticalCssDeclaration[];
  selector: string;
  wrappers: readonly string[];
}

interface CriticalCssDeclaration {
  property: string;
  raw: string;
  value: string;
}

function pruneCriticalThemeCss(themeCss: string, criticalCss: string): string | undefined {
  const blocks = parseCriticalCssBlocks(stripCssComments(themeCss));
  if (!blocks) return undefined;

  const declarationsByProperty = createSecurityMap<string, CriticalCssDeclaration[]>();
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex]!;
    for (
      let declarationIndex = 0;
      declarationIndex < block.declarations.length;
      declarationIndex += 1
    ) {
      const declaration = block.declarations[declarationIndex]!;
      if (!securityStringStartsWith(declaration.property, '--')) continue;
      const declarations = securityMapGet(declarationsByProperty, declaration.property) ?? [];
      securityArrayPush(declarations, declaration);
      securityMapSet(declarationsByProperty, declaration.property, declarations);
    }
  }

  const needed = transitiveCriticalCssVariables(criticalCss, declarationsByProperty);
  const rendered: string[] = [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex]!;
    const declarations: CriticalCssDeclaration[] = [];
    for (let index = 0; index < block.declarations.length; index += 1) {
      const declaration = block.declarations[index]!;
      if (
        !securityStringStartsWith(declaration.property, '--') ||
        securitySetHas(needed, declaration.property)
      ) {
        securityArrayPush(declarations, declaration);
      }
    }
    if (declarations.length > 0) {
      securityArrayPush(rendered, renderCriticalCssBlock(block, declarations));
    }
  }

  return securityArrayJoin(rendered, '\n\n');
}

function renderCriticalCssBlock(
  block: CriticalCssBlock,
  declarations: readonly CriticalCssDeclaration[],
): string {
  const renderedDeclarations: string[] = [];
  for (let index = 0; index < declarations.length; index += 1) {
    securityArrayPush(renderedDeclarations, `  ${declarations[index]!.raw}`);
  }
  let css = `${block.selector} {\n${securityArrayJoin(renderedDeclarations, '\n')}\n}`;
  for (let index = block.wrappers.length - 1; index >= 0; index -= 1) {
    css = `${block.wrappers[index]} {\n${indentCriticalCss(css)}\n}`;
  }
  return css;
}

function indentCriticalCss(css: string): string {
  const lines = securityStringSplit(css, '\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.length > 0) lines[index] = `  ${lines[index]}`;
  }
  return securityArrayJoin(lines, '\n');
}

function transitiveCriticalCssVariables(
  criticalCss: string,
  declarationsByProperty: Map<string, readonly CriticalCssDeclaration[]>,
): Set<string> {
  const needed = createSecuritySet<string>();
  const queue = collectCssVariableReferences(criticalCss);
  for (let index = 0; index < queue.length; index += 1) {
    securitySetAdd(needed, queue[index]!);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const property = queue[index]!;
    const declarations = securityMapGet(declarationsByProperty, property) ?? [];
    for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
      const references = collectCssVariableReferences(declarations[declarationIndex]!.value);
      for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
        const reference = references[referenceIndex]!;
        if (securitySetHas(needed, reference)) continue;
        securitySetAdd(needed, reference);
        securityArrayPush(queue, reference);
      }
    }
  }

  return needed;
}

function collectCssVariableReferences(css: string): string[] {
  const references: string[] = [];
  const expression = /var\(\s*(--[-_a-zA-Z0-9]+)/g;
  let match: RegExpExecArray | null;
  while ((match = securityRegExpExec(expression, css)) !== null) {
    if (match[1] !== undefined) securityArrayPush(references, match[1]);
  }
  return references;
}

function stripCssComments(css: string): string {
  return securityRegExpReplace(css, /\/\*[\s\S]*?\*\//g, '');
}

function parseCriticalCssBlocks(
  css: string,
  wrappers: readonly string[] = [],
): CriticalCssBlock[] | undefined {
  const blocks: CriticalCssBlock[] = [];
  let offset = 0;

  while (offset < css.length) {
    const open = securityStringIndexOf(css, '{', offset);
    if (open === -1) {
      return securityStringTrim(securityStringSlice(css, offset)) === '' ? blocks : undefined;
    }

    const selector = securityStringTrim(securityStringSlice(css, offset, open));
    if (!selector) return undefined;
    const close = findMatchingCriticalCssBlockClose(css, open);
    if (close === undefined) return undefined;
    const body = securityStringSlice(css, open + 1, close);
    if (securityStringIncludes(body, '{') || securityStringIncludes(body, '}')) {
      if (!isSupportedCriticalCssWrapper(selector)) return undefined;
      const nested = parseCriticalCssBlocks(body, [...wrappers, selector]);
      if (!nested) return undefined;
      for (let index = 0; index < nested.length; index += 1) {
        securityArrayPush(blocks, nested[index]!);
      }
      offset = close + 1;
      continue;
    }
    const declarations = parseCriticalCssDeclarations(body);
    if (!declarations) return undefined;
    securityArrayPush(blocks, { declarations, selector, wrappers });
    offset = close + 1;
  }

  return blocks;
}

function isSupportedCriticalCssWrapper(selector: string): boolean {
  return securityRegExpTest(/^@media\s+.+$/u, selector);
}

function findMatchingCriticalCssBlockClose(css: string, open: number): number | undefined {
  let braceDepth = 1;
  let quote: '"' | "'" | undefined;
  let parenDepth = 0;

  for (let index = open + 1; index < css.length; index += 1) {
    const char = css[index];
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (parenDepth !== 0) continue;
    if (char === '{') {
      braceDepth += 1;
      continue;
    }
    if (char === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) return index;
    }
  }

  return undefined;
}

function parseCriticalCssDeclarations(body: string): CriticalCssDeclaration[] | undefined {
  const declarations: CriticalCssDeclaration[] = [];
  const split = splitCriticalCssDeclarations(body);
  for (let index = 0; index < split.length; index += 1) {
    const raw = securityStringTrim(split[index]!);
    if (!raw) continue;
    const colon = findCriticalCssDeclarationColon(raw);
    if (colon === undefined) return undefined;
    const property = securityStringTrim(securityStringSlice(raw, 0, colon));
    const value = securityStringTrim(securityStringSlice(raw, colon + 1));
    if (!property || !value) return undefined;
    securityArrayPush(declarations, { property, raw: `${property}: ${value};`, value });
  }
  return declarations;
}

function splitCriticalCssDeclarations(body: string): string[] {
  const declarations: string[] = [];
  let start = 0;
  let quote: '"' | "'" | undefined;
  let parenDepth = 0;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (char !== ';' || parenDepth !== 0) continue;
    securityArrayPush(declarations, securityStringSlice(body, start, index));
    start = index + 1;
  }

  securityArrayPush(declarations, securityStringSlice(body, start));
  return declarations;
}

function findCriticalCssDeclarationColon(declaration: string): number | undefined {
  let quote: '"' | "'" | undefined;
  let parenDepth = 0;

  for (let index = 0; index < declaration.length; index += 1) {
    const char = declaration[index];
    if (quote !== undefined) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (char === ':' && parenDepth === 0) return index;
  }

  return undefined;
}

function renderSpeculationRules(
  prefetch: RoutePrefetch,
  urls: readonly string[],
): InlineHtmlWithCsp {
  // L2-early-hints-1 (bugs-part3): a speculation rule with `prefetch:'conservative'`
  // prerenders/prefetches the listed URLs with the user's credentials, and KV419 only
  // gates `moderate` (SPEC §8:763). An off-origin URL here is a credentialed
  // cross-origin prerender. Filter to SAME-ORIGIN targets only: a single-leading-slash
  // absolute path (`/path`) — rejecting `//host` and `/\host` (protocol-relative /
  // authority-forming) and any value carrying a scheme. `SAFE_URL_SCHEMES` alone would
  // not block cross-origin https, so an explicit same-origin path check is required.
  const candidates = dedupe(snapshotStringHintArray(urls, 'speculation rule URLs'));
  const prerenderUrls: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (isSameOriginPrerenderUrl(candidates[index]!)) {
      securityArrayPush(prerenderUrls, candidates[index]!);
    }
  }
  if (!prefetch) return { html: '' };
  if (urls.length > 0 && prerenderUrls.length === 0) return { html: '' };

  const rules =
    prerenderUrls.length > 0
      ? {
          prerender: [
            {
              eagerness: prefetch,
              urls: prerenderUrls,
            },
          ],
        }
      : {
          prefetch: [
            {
              eagerness: prefetch,
              where: { href_matches: '/*' },
            },
          ],
        };
  const serialized = securityJsonStringify(rules);
  if (serialized === undefined)
    throw new TypeError('Kovo speculation rules could not be serialized.');
  const scriptText = escapeScriptJson(serialized);
  const hash = cspSha256(scriptText);

  return {
    csp: { scripts: [hash], styles: [] },
    html: `<script type="speculationrules" ${cspHashAttribute(hash)}>${scriptText}</script>`,
  };
}

/**
 * L2-early-hints-1 (bugs-part3): accept only same-origin prerender targets — a
 * root-relative path with exactly one leading slash. Rejects protocol-relative
 * (`//host`), authority-forming (`/\host`), and any scheme-bearing absolute URL
 * (`https://evil/…`, `data:…`), which would prerender off-origin with the user's
 * credentials (SPEC §8:763; mirrors the same-origin `next` rule at §6.5:731).
 */
function isSameOriginPrerenderUrl(url: string): boolean {
  if (!securityStringStartsWith(url, '/')) return false;
  // Reject protocol-relative `//host` and backslash-authority `/\host`.
  if (securityStringStartsWith(url, '//') || securityStringStartsWith(url, '/\\')) return false;
  // Reject any backslash anywhere (a browser may normalize `\` to `/`, turning
  // `/x\evil` into an authority).
  if (securityStringIncludes(url, '\\')) return false;
  // Reject any ASCII control char or whitespace (<= 0x20) and DEL (0x7f) that could
  // smuggle a second leading slash after browser normalization or break the path.
  for (let index = 0; index < url.length; index += 1) {
    const code = securityStringCharCodeAt(url, index);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  return true;
}

function renderRouteMeta(
  metaInput: PageHintOptions['meta'],
  context: PageHintRenderContext,
): string[] {
  const metas = securityArrayIsArray(metaInput)
    ? snapshotHintArray(metaInput, 'route metadata')
    : metaInput
      ? [metaInput]
      : [];
  const tags: string[] = [];

  for (let index = 0; index < metas.length; index += 1) {
    const item = metas[index]!;
    // F2 (bugs-part3 L2-early-hints-2): head meta is best-effort enrichment, not a
    // load-bearing render step. A meta-derive failure (absent query, a `derive`
    // callback throwing on a data gap such as a not-found product) must drop only the
    // affected tags, never 500 the whole document. `resolveRouteMeta` already returns
    // `undefined` for an absent-query factory; this catch also contains a throwing
    // `resolve`.
    let resolved: RouteMeta | undefined;
    try {
      resolved = resolveRouteMeta(item, context);
    } catch {
      resolved = undefined;
    }
    if (!resolved) continue;

    resolved = snapshotRouteMeta(resolved);
    if (resolved.title) securityArrayPush(tags, `<title>${escapeHtml(resolved.title)}</title>`);
    if (resolved.description) {
      securityArrayPush(
        tags,
        `<meta name="description" content="${escapeAttribute(resolved.description)}">`,
      );
      securityArrayPush(
        tags,
        `<meta property="og:description" content="${escapeAttribute(resolved.description)}">`,
      );
    }
    if (resolved.image) {
      // part-4 L-i18n-meta-1: og:image is a URL sink — scheme-check before escaping so a
      // metaFromQuery-derived javascript:/data:/off-origin URL cannot bypass the §4.8 allowlist.
      securityArrayPush(
        tags,
        `<meta property="og:image" content="${escapeAttribute(safeUrlValue(resolved.image))}">`,
      );
    }
  }

  return tags;
}

/**
 * Resolve one route-meta source. A static {@link RouteMeta} is returned as-is. A
 * {@link RouteMetaFactory} returns `undefined` (skip — emit no tags) when any of its
 * declared queries is absent from the render context, instead of throwing
 * (F2 / bugs-part3 L2-early-hints-2): the document head path threads rendered queries
 * in only when they exist, so a routine data gap must omit the derived tags rather
 * than hard-500 the page.
 */
function resolveRouteMeta(
  source: RouteMetaSource,
  context: PageHintRenderContext,
): RouteMeta | undefined {
  if (isRouteMetaCallback(source)) return source(context.route, context.queries ?? {});
  if (!isRouteMetaFactory(source)) return source;

  const queries = context.queries ?? {};
  const values: Record<string, unknown> = createSecurityNullRecord<unknown>();

  const sourceQueries = stableHintValue(source, 'queries', 'route metadata factory');
  if (!securityArrayIsArray(sourceQueries)) return undefined;
  const queryNames = snapshotStringHintArray(sourceQueries, 'route metadata queries');
  for (let index = 0; index < queryNames.length; index += 1) {
    const query = queryNames[index]!;
    if (witnessGetOwnPropertyDescriptor(queries, query) === undefined) {
      return undefined;
    }
    values[query] = stableHintValue(queries, query, 'route metadata query values');
  }

  const resolve = stableHintValue(source, 'resolve', 'route metadata factory');
  if (typeof resolve !== 'function') return undefined;
  return witnessReflectApply<RouteMeta>(resolve, source, [values]);
}

function isRouteMetaFactory(source: RouteMetaSource): source is RouteMetaFactory {
  return (
    typeof source === 'object' &&
    source !== null &&
    typeof stableHintValue(source, 'resolve', 'route metadata') === 'function'
  );
}

function isRouteMetaCallback(source: RouteMetaSource): source is RouteMetaCallback {
  return typeof source === 'function';
}

function renderI18nCatalogs(i18nInput: PageHintOptions['i18n']): InlineHtmlWithCsp[] {
  const catalogs: I18nCatalog[] = [];
  if (securityArrayIsArray(i18nInput)) {
    const inputs = snapshotHintArray(i18nInput, 'i18n catalogs');
    for (let index = 0; index < inputs.length; index += 1) {
      securityArrayPush(catalogs, snapshotI18nCatalog(inputs[index]!));
    }
  } else if (i18nInput) {
    securityArrayPush(catalogs, snapshotI18nCatalog(i18nInput));
  }
  const rendered: InlineHtmlWithCsp[] = [];
  for (let index = 0; index < catalogs.length; index += 1) {
    const catalog = catalogs[index]!;
    const serialized = securityJsonStringify(catalog.messages);
    if (serialized === undefined)
      throw new TypeError('Kovo i18n messages could not be serialized.');
    const scriptText = escapeScriptJson(serialized);
    const hash = cspSha256(scriptText);

    securityArrayPush(rendered, {
      csp: { scripts: [hash], styles: [] },
      html: `<script type="application/json" kovo-i18n locale="${escapeAttribute(catalog.locale)}" ${cspHashAttribute(hash)}>${scriptText}</script>`,
    });
  }
  return rendered;
}

function escapeStyleText(value: string): string {
  return securityRegExpReplace(value, /<\/style/gi, '<\\/style');
}

function stableHintValue(value: object, property: PropertyKey, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, property);
  const after = witnessGetOwnPropertyDescriptor(value, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`${label}.${String(property)} must be stable.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(`${label}.${String(property)} must be an own data property.`);
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`${label}.${String(property)} changed during validation.`);
  }
  return before.value;
}

function snapshotHintArray<Value>(values: readonly Value[], label: string): Value[] {
  if (!securityArrayIsArray(values)) throw new TypeError(`${label} must be an array.`);
  const length = stableHintValue(values, 'length', label);
  if (typeof length !== 'number' || !securityNumberIsInteger(length) || length < 0) {
    throw new TypeError(`${label} length must be a non-negative integer.`);
  }
  const snapshot: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(values, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} must be a dense own-data array.`);
    }
    securityArrayPush(snapshot, descriptor.value as Value);
  }
  return snapshot;
}

function snapshotStringHintArray(values: readonly unknown[], label: string): string[] {
  const snapshot = snapshotHintArray(values, label);
  const strings: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index];
    if (typeof value !== 'string') throw new TypeError(`${label} must contain only strings.`);
    securityArrayPush(strings, value);
  }
  return strings;
}

function snapshotStylesheetDeclarationOptions(
  options: StylesheetDeclarationOptions,
): StylesheetDeclarationOptions {
  if (typeof options !== 'object' || options === null || securityArrayIsArray(options)) {
    throw new TypeError('Kovo stylesheet options must be an object.');
  }
  const criticalCss = stableHintValue(options, 'criticalCss', 'stylesheet options');
  const criticalCssTheme = stableHintValue(options, 'criticalCssTheme', 'stylesheet options');
  const cspHash = stableHintValue(options, 'cspHash', 'stylesheet options');
  const deferFull = stableHintValue(options, 'deferFull', 'stylesheet options');
  const href = stableHintValue(options, 'href', 'stylesheet options');
  const preload = stableHintValue(options, 'preload', 'stylesheet options');
  const rawTheme = stableHintValue(options, 'theme', 'stylesheet options');
  if (
    criticalCss !== undefined &&
    typeof criticalCss !== 'string' &&
    !securityArrayIsArray(criticalCss)
  ) {
    throw new TypeError('stylesheet criticalCss must be a string or string array.');
  }
  const criticalCssSnapshot = securityArrayIsArray(criticalCss)
    ? snapshotStringHintArray(criticalCss, 'stylesheet criticalCss')
    : criticalCss;
  if (criticalCssTheme !== undefined && criticalCssTheme !== 'all' && criticalCssTheme !== 'used') {
    throw new TypeError('stylesheet criticalCssTheme must be all or used.');
  }
  if (cspHash !== undefined && typeof cspHash !== 'string') {
    throw new TypeError('stylesheet cspHash must be a string.');
  }
  if (deferFull !== undefined && typeof deferFull !== 'boolean') {
    throw new TypeError('stylesheet deferFull must be a boolean.');
  }
  if (href !== undefined && typeof href !== 'string') {
    throw new TypeError('stylesheet href must be a string.');
  }
  if (preload !== undefined && typeof preload !== 'boolean') {
    throw new TypeError('stylesheet preload must be a boolean.');
  }
  let theme: StylesheetTheme | undefined;
  if (typeof rawTheme === 'string') {
    theme = rawTheme;
  } else if (rawTheme !== undefined) {
    if (typeof rawTheme !== 'object' || rawTheme === null) {
      throw new TypeError('stylesheet theme must be a CSS string or theme object.');
    }
    const css = stableHintValue(rawTheme, 'css', 'stylesheet theme');
    if (typeof css !== 'string') throw new TypeError('stylesheet theme.css must be a string.');
    theme = { css };
  }
  return {
    ...(criticalCssSnapshot === undefined ? {} : { criticalCss: criticalCssSnapshot }),
    ...(criticalCssTheme === undefined ? {} : { criticalCssTheme }),
    ...(cspHash === undefined ? {} : { cspHash }),
    ...(deferFull === undefined ? {} : { deferFull }),
    ...(href === undefined ? {} : { href }),
    ...(preload === undefined ? {} : { preload }),
    ...(theme === undefined ? {} : { theme }),
  };
}

function snapshotPageHintOptions(options: PageHintOptions): PageHintOptions {
  if (typeof options !== 'object' || options === null || securityArrayIsArray(options)) {
    throw new TypeError('Kovo page hint options must be an object.');
  }
  const bootstrapScript = stableHintValue(options, 'bootstrapScript', 'page hint options');
  const i18n = stableHintValue(options, 'i18n', 'page hint options');
  const meta = stableHintValue(options, 'meta', 'page hint options');
  const modulepreloads = stableHintValue(options, 'modulepreloads', 'page hint options');
  const prefetch = stableHintValue(options, 'prefetch', 'page hint options');
  const prefetchJustification = stableHintValue(
    options,
    'prefetchJustification',
    'page hint options',
  );
  const prerenderUrls = stableHintValue(options, 'prerenderUrls', 'page hint options');
  const stylesheets = stableHintValue(options, 'stylesheets', 'page hint options');
  if (bootstrapScript !== undefined && typeof bootstrapScript !== 'string') {
    throw new TypeError('page hint bootstrapScript must be a string.');
  }
  if (modulepreloads !== undefined && !securityArrayIsArray(modulepreloads)) {
    throw new TypeError('page hint modulepreloads must be an array.');
  }
  if (
    prefetch !== undefined &&
    prefetch !== false &&
    prefetch !== 'conservative' &&
    prefetch !== 'moderate'
  ) {
    throw new TypeError('page hint prefetch is invalid.');
  }
  if (prefetchJustification !== undefined && typeof prefetchJustification !== 'string') {
    throw new TypeError('page hint prefetchJustification must be a string.');
  }
  if (prerenderUrls !== undefined && !securityArrayIsArray(prerenderUrls)) {
    throw new TypeError('page hint prerenderUrls must be an array.');
  }
  if (stylesheets !== undefined && !securityArrayIsArray(stylesheets)) {
    throw new TypeError('page hint stylesheets must be an array.');
  }
  let stylesheetSnapshots: StylesheetAsset[] | undefined;
  if (stylesheets !== undefined) {
    stylesheetSnapshots = [];
    for (let index = 0; index < stylesheets.length; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(stylesheets, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError('page hint stylesheets must be a dense own-data array.');
      }
      const value = descriptor.value;
      if (typeof value === 'string') {
        securityArrayPush(
          stylesheetSnapshots,
          snapshotStylesheetAsset({ href: value, preload: true }),
        );
      } else if (typeof value === 'object' && value !== null) {
        securityArrayPush(stylesheetSnapshots, snapshotStylesheetAsset(value));
      } else {
        throw new TypeError('page hint stylesheet entries must be strings or assets.');
      }
    }
  }
  let i18nSnapshot: I18nCatalog | I18nCatalog[] | undefined;
  if (i18n !== undefined) {
    if (securityArrayIsArray(i18n)) {
      i18nSnapshot = [];
      const values = snapshotHintArray(i18n, 'i18n catalogs');
      for (let index = 0; index < values.length; index += 1) {
        securityArrayPush(i18nSnapshot, snapshotI18nCatalog(values[index] as I18nCatalog));
      }
    } else if (typeof i18n === 'object' && i18n !== null) {
      i18nSnapshot = snapshotI18nCatalog(i18n as I18nCatalog);
    } else {
      throw new TypeError('page hint i18n must be a catalog or catalog array.');
    }
  }
  let metaSnapshot: RouteMetaSource | RouteMetaSource[] | undefined;
  if (meta !== undefined) {
    if (securityArrayIsArray(meta)) {
      metaSnapshot = [];
      const values = snapshotHintArray(meta, 'route metadata');
      for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (typeof value !== 'function' && (typeof value !== 'object' || value === null)) {
          throw new TypeError('page hint metadata entries must be objects or callbacks.');
        }
        securityArrayPush(metaSnapshot, value as RouteMetaSource);
      }
    } else if (typeof meta === 'function' || (typeof meta === 'object' && meta !== null)) {
      metaSnapshot = meta as RouteMetaSource;
    } else {
      throw new TypeError('page hint metadata must be an object, callback, or array.');
    }
  }
  return {
    ...(bootstrapScript === undefined ? {} : { bootstrapScript }),
    ...(i18nSnapshot === undefined ? {} : { i18n: i18nSnapshot }),
    ...(metaSnapshot === undefined ? {} : { meta: metaSnapshot }),
    ...(modulepreloads === undefined
      ? {}
      : { modulepreloads: snapshotStringHintArray(modulepreloads, 'page hint modulepreloads') }),
    ...(prefetch === undefined ? {} : { prefetch }),
    ...(prefetchJustification === undefined ? {} : { prefetchJustification }),
    ...(prerenderUrls === undefined
      ? {}
      : { prerenderUrls: snapshotStringHintArray(prerenderUrls, 'page hint prerenderUrls') }),
    ...(stylesheetSnapshots === undefined ? {} : { stylesheets: stylesheetSnapshots }),
  };
}

function appendUnique(values: string[], value: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === value) return;
  }
  securityArrayPush(values, value);
}

function safeHintUrl(value: string, label: string): string {
  if (value === '') throw new TypeError(`Kovo ${label} URL must not be empty.`);
  if (securityStringIncludes(value, '\\') || hasHintControlCharacter(value)) return '#';
  if (securityStringStartsWith(value, '//')) return '#';
  const safe = safeUrlValue(value);
  if (safe === '#' && value !== '#') return '#';
  if (securityRegExpTest(/^[a-zA-Z][a-zA-Z\d+.-]*:/, value)) {
    try {
      const parsed = securityUrlSnapshot(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '#';
    } catch {
      return '#';
    }
  }
  return value;
}

function hasHintControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function firstIndexOfEither(value: string, left: string, right: string): number {
  const leftIndex = securityStringIndexOf(value, left);
  const rightIndex = securityStringIndexOf(value, right);
  if (leftIndex === -1) return rightIndex;
  if (rightIndex === -1) return leftIndex;
  return leftIndex < rightIndex ? leftIndex : rightIndex;
}

function snapshotRouteMeta(value: RouteMeta): RouteMeta {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('route metadata must resolve to an object.');
  }
  const title = stableHintValue(value, 'title', 'route metadata');
  const description = stableHintValue(value, 'description', 'route metadata');
  const image = stableHintValue(value, 'image', 'route metadata');
  if (title !== undefined && typeof title !== 'string') {
    throw new TypeError('route metadata title must be a string.');
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new TypeError('route metadata description must be a string.');
  }
  if (image !== undefined && typeof image !== 'string') {
    throw new TypeError('route metadata image must be a string.');
  }
  return {
    ...(description === undefined ? {} : { description }),
    ...(image === undefined ? {} : { image }),
    ...(title === undefined ? {} : { title }),
  };
}

function snapshotI18nCatalog(value: unknown): I18nCatalog {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo i18n catalogs must be objects.');
  }
  const locale = stableHintValue(value, 'locale', 'i18n catalog');
  const messages = stableHintValue(value, 'messages', 'i18n catalog');
  if (typeof locale !== 'string') throw new TypeError('i18n catalog locale must be a string.');
  if (typeof messages !== 'object' || messages === null || securityArrayIsArray(messages)) {
    throw new TypeError('i18n catalog messages must be a record.');
  }
  const snapshot: Record<string, string> = createSecurityNullRecord<string>();
  const keys = securityObjectKeys(messages);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const message = stableHintValue(messages, key, 'i18n catalog messages');
    if (typeof message !== 'string') throw new TypeError('i18n catalog messages must be strings.');
    snapshot[key] = message;
  }
  return { locale, messages: snapshot };
}
