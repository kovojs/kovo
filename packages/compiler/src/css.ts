import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { findMatchingToken } from './scan/text.js';
import {
  componentOptionStaticTemplateValue,
  componentRenderHostElement,
  type ComponentModuleModel,
} from './scan/parse.js';
import { cssIrHeader } from './ir.js';
import { escapeCssString, indent } from './shared.js';
import type { RoutePageFact } from './types.js';

/**
 * @internal A scoped-CSS asset reference produced by the compiler (href, optional critical
 * CSS, preload hint). Lowered-IR CSS-pipeline shape; in-repo use only (SPEC.md §5.2).
 */
export interface CssAsset {
  criticalCss?: string;
  cspHash?: string;
  href: string;
  preload?: boolean;
  sourceFileName: string;
}

/**
 * @internal A {@link CssAsset} tagged with the owning component and its fragment targets.
 * Lowered-IR CSS-pipeline shape; in-repo use only (SPEC.md §5.2).
 */
export interface ComponentCssAsset extends CssAsset {
  componentName: string;
  fragmentTargets: readonly string[];
  styleRuleUsages?: readonly StyleRuleUsage[];
}

/**
 * @internal Attribution for a StyleX-derived atomic rule. This is persisted on the
 * compiler CSS asset so future route/fragment splitting can compute chunks from
 * rule usage instead of reverse-engineering CSS text (plans/claude-stylex.md Phase 2).
 */
export interface StyleRuleUsage {
  className: string;
  moduleFileName: string;
  source: string;
  styleRef: string;
}

/**
 * @internal Deduplicated CSS asset manifest (by-file-name index plus ordered stylesheet
 * list) produced by {@link collectCssAssetManifest}. In-repo build pipeline use only
 * (SPEC.md §5.2).
 */
export interface CssAssetManifest {
  byFileName: Readonly<Record<string, ComponentCssAsset>>;
  chunks?: CssSplitChunks;
  stylesheets: readonly ComponentCssAsset[];
}

/** @internal Options for {@link collectCssAssetManifest} (asset base href + preload hint). */
export interface CssAssetManifestOptions {
  baseHref?: string;
  preload?: boolean;
  split?: CssSplitOptions;
}

/**
 * @internal Opt-in StyleX/component CSS split configuration. Routes are keyed by the route registry
 * and may identify their CSS by source file, href, or fragment target facts.
 */
export interface CssSplitOptions {
  baseSourceFileNames?: readonly string[];
  routes?: readonly CssRouteSplitTarget[];
}

/** @internal Route-level CSS ownership fact for split manifest computation. */
export interface CssRouteSplitTarget {
  fragmentTargets?: readonly string[];
  hrefs?: readonly string[];
  route: string;
  sourceFileNames?: readonly string[];
  stylesheets?: readonly string[];
}

/** @internal Computed base/route/fragment chunk assets. */
export interface CssSplitChunks {
  base: readonly ComponentCssAsset[];
  fragments: Readonly<Record<string, readonly ComponentCssAsset[]>>;
  routes: Readonly<Record<string, readonly ComponentCssAsset[]>>;
}

/** @internal Per-route CSS delivery accounting for fine-grained CSS regression gates. */
export interface CssRouteByteAccounting {
  inlinedCriticalCssBytes: number;
  linkedCssBytes: number;
  linkedHrefs: readonly string[];
  linkedSourceFileNames: readonly string[];
  reachableCssBytes: number;
  reachableSourceFileNames: readonly string[];
  route: string;
}

/** @internal Atom-level overship diagnostic for route CSS delivery gates. */
export interface CssRouteOvershipDiagnostic {
  className: string;
  href: string;
  moduleFileName: string;
  route: string;
  source: string;
  styleRef: string;
}

/** @internal Route CSS conformance gate result with accounting artifact data. */
export interface CssRouteDeliveryGateResult {
  accounting: CssRouteByteAccounting;
  diagnostics: readonly CssRouteOvershipDiagnostic[];
}

/**
 * @internal Render target passed to the stylesheet resolver. v1 may still resolve to a
 * single app-wide asset, but callers use this shape so future route/fragment splitting
 * does not require server or fragment API changes (plans/claude-stylex.md Phase 2).
 */
export interface CssRenderTarget {
  fragmentTargets?: readonly string[];
  kind: 'defer' | 'fragment' | 'page';
  route?: string;
  sourceFileNames?: readonly string[];
}

/** @internal Function shape for render-parameterized stylesheet hint resolution. */
export type CssAssetResolver = (renderTarget?: CssRenderTarget) => ComponentCssAsset[];

/**
 * @internal Result of {@link scopeComponentCss}: a `@scope`-based form and a prefixed
 * `fallback` for engines without `@scope`. Lowered-IR CSS-pipeline shape (SPEC.md §5.2).
 */
export interface ScopedCssResult {
  fallback: string;
  scoped: string;
}

/** @internal Options for {@link scopeComponentCss} (nested host selectors to exclude). */
export interface ScopeComponentCssOptions {
  nestedHostSelectors?: readonly string[];
}

interface CompileCssAssetSource {
  cssAssets: readonly ComponentCssAsset[];
}

/**
 * @internal Scope a component's CSS to its host selector, emitting both a `@scope` form and
 * a selector-prefixed fallback. Used by the compiler's CSS lowering; in-repo only
 * (SPEC.md §5.2).
 */
export function scopeComponentCss(
  hostSelector: string,
  css: string,
  options: ScopeComponentCssOptions = {},
): ScopedCssResult {
  const trimmed = css.trim();
  const nestedHostSelectors = options.nestedHostSelectors ?? ['[kovo-c]'];

  return {
    fallback: prefixCssSelectors(hostSelector, trimmed, nestedHostSelectors),
    scoped: `@scope (${hostSelector}) to (${scopeLimitSelectors(nestedHostSelectors)}) {\n${indent(trimmed)}\n}\n`,
  };
}

/** @internal Join CSS chunks, dropping blank and duplicate chunks. In-repo build use only. */
export function dedupeCss(chunks: readonly string[]): string {
  return [...new Set(chunks.map((chunk) => chunk.trim()).filter(Boolean))].join('\n\n');
}

/**
 * @internal Collect one deduplicated {@link CssAssetManifest} across compiled components.
 * Used by the in-repo asset/build pipeline, not by app authors (SPEC.md §5.2).
 */
export function collectCssAssetManifest(
  results: CompileCssAssetSource | readonly CompileCssAssetSource[],
  options: CssAssetManifestOptions = {},
): CssAssetManifest {
  const byFileName: Record<string, ComponentCssAsset> = {};
  const stylesheets: ComponentCssAsset[] = [];
  const items = Array.isArray(results) ? results : [results];

  for (const result of items) {
    for (const cssAsset of result.cssAssets) {
      if (byFileName[cssAsset.sourceFileName]) continue;

      const asset = componentCssAssetForFile(
        cssAsset.sourceFileName,
        cssAsset.componentName,
        cssAsset.fragmentTargets,
        options,
        cssAsset.criticalCss,
      );
      if (cssAsset.styleRuleUsages && cssAsset.styleRuleUsages.length > 0) {
        asset.styleRuleUsages = cssAsset.styleRuleUsages;
      }
      byFileName[cssAsset.sourceFileName] = asset;
      stylesheets.push(asset);
    }
  }

  const manifest = { byFileName, stylesheets };
  return options.split
    ? { ...manifest, chunks: computeCssSplitChunks(manifest, options) }
    : manifest;
}

/**
 * @internal Select the manifest assets for a given set of source file names, preserving
 * request order. In-repo build pipeline use only (SPEC.md §5.2).
 */
export function selectCssAssets(
  manifest: CssAssetManifest,
  fileNames: readonly string[],
): ComponentCssAsset[] {
  return fileNames.flatMap((fileName) => {
    const asset = manifest.byFileName[fileName];
    return asset ? [asset] : [];
  });
}

/**
 * @internal Build the render-parameterized stylesheet resolver required by
 * plans/claude-stylex.md Phase 2. With today's unsplit manifest it returns all
 * stylesheets for a page and the matching target assets for late fragments/defer.
 */
export function createCssAssetResolver(manifest: CssAssetManifest): CssAssetResolver {
  return (renderTarget) => {
    if (!renderTarget) return allManifestAssets(manifest);
    if (renderTarget.sourceFileNames)
      return selectCssAssets(manifest, renderTarget.sourceFileNames);
    if (manifest.chunks) {
      if (renderTarget.kind === 'page') {
        return renderTarget.route
          ? [...manifest.chunks.base, ...(manifest.chunks.routes[renderTarget.route] ?? [])]
          : allManifestAssets(manifest);
      }
      if (renderTarget.fragmentTargets) {
        return dedupeComponentCssAssets([
          ...manifest.chunks.base,
          ...renderTarget.fragmentTargets.flatMap(
            (target) => manifest.chunks?.fragments[target] ?? [],
          ),
        ]);
      }
    }
    if (renderTarget.fragmentTargets) {
      const wanted = new Set(renderTarget.fragmentTargets);
      return manifest.stylesheets.filter((asset) =>
        asset.fragmentTargets.some((target) => wanted.has(target)),
      );
    }
    return [...manifest.stylesheets];
  };
}

/** @internal Convert compiler route facts into splitter route targets. */
export function cssRouteSplitTargetsFromRouteFacts(
  routePageFacts: readonly RoutePageFact[],
): CssRouteSplitTarget[] {
  return routePageFacts.flatMap((fact) => {
    const sourceFileNames = uniqueSorted(fact.css?.sourceFileNames ?? []);
    const fragmentTargets = uniqueSorted(fact.css?.fragmentTargets ?? []);
    if (sourceFileNames.length === 0 && fragmentTargets.length === 0) return [];

    return [
      {
        ...(fragmentTargets.length === 0 ? {} : { fragmentTargets }),
        route: fact.route,
        ...(sourceFileNames.length === 0 ? {} : { sourceFileNames }),
      },
    ];
  });
}

/**
 * @internal Account for route-scoped CSS delivery against the same route target facts
 * consumed by the splitter (SPEC.md §13.1, emitted stylesheet assets).
 */
export function cssRouteByteAccounting(
  manifest: CssAssetManifest,
  route: CssRouteSplitTarget,
): CssRouteByteAccounting {
  const reachableAssets = selectRouteCssAssets(manifest, route);
  const linkedAssets = manifest.chunks
    ? dedupeComponentCssAssets([
        ...manifest.chunks.base,
        ...(manifest.chunks.routes[route.route] ?? []),
      ])
    : reachableAssets;
  const linkedCssBytes = cssAssetCriticalBytes(linkedAssets);

  return {
    inlinedCriticalCssBytes: linkedCssBytes,
    linkedCssBytes,
    linkedHrefs: linkedAssets.map((asset) => asset.href),
    linkedSourceFileNames: linkedAssets.map((asset) => asset.sourceFileName),
    reachableCssBytes: cssAssetCriticalBytes(reachableAssets),
    reachableSourceFileNames: reachableAssets.map((asset) => asset.sourceFileName),
    route: route.route,
  };
}

/**
 * @internal Flag StyleX atoms delivered to a route but not reachable from that
 * route's component/fragment graph. Callers fail the build when diagnostics are
 * non-empty and persist `accounting` as the bytes-per-route artifact
 * (SPEC.md §13.1).
 */
export function cssRouteDeliveryGate(
  manifest: CssAssetManifest,
  route: CssRouteSplitTarget,
  deliveredAssets: readonly ComponentCssAsset[] = defaultDeliveredRouteCssAssets(manifest, route),
): CssRouteDeliveryGateResult {
  const reachableUsages = new Set(
    selectRouteCssAssets(manifest, route)
      .flatMap((asset) => asset.styleRuleUsages ?? [])
      .map(styleRuleUsageKey),
  );
  const diagnostics: CssRouteOvershipDiagnostic[] = [];

  for (const asset of deliveredAssets) {
    for (const usage of asset.styleRuleUsages ?? []) {
      if (reachableUsages.has(styleRuleUsageKey(usage))) continue;
      diagnostics.push({
        className: usage.className,
        href: asset.href,
        moduleFileName: usage.moduleFileName,
        route: route.route,
        source: usage.source,
        styleRef: usage.styleRef,
      });
    }
  }

  return {
    accounting: cssRouteByteAccounting(manifest, route),
    diagnostics,
  };
}

function computeCssSplitChunks(
  manifest: Pick<CssAssetManifest, 'byFileName' | 'stylesheets'>,
  options: CssAssetManifestOptions,
): CssSplitChunks {
  const split = options.split ?? {};
  const routeSelections = new Map<string, ComponentCssAsset[]>();

  for (const route of split.routes ?? []) {
    routeSelections.set(route.route, selectRouteCssAssets(manifest, route));
  }

  const baseAssets = split.baseSourceFileNames
    ? selectCssAssets(manifest, split.baseSourceFileNames)
    : sharedRouteCssAssets(routeSelections);
  const baseNames = new Set(baseAssets.map((asset) => asset.sourceFileName));
  const base =
    baseAssets.length > 0
      ? [
          chunkAsset(
            'base.css',
            'css-base',
            fragmentTargetsForAssets(baseAssets),
            baseAssets,
            options,
          ),
        ]
      : [];
  const routes: Record<string, ComponentCssAsset[]> = {};

  for (const [route, assets] of routeSelections) {
    const routeAssets = assets.filter((asset) => !baseNames.has(asset.sourceFileName));
    routes[route] =
      routeAssets.length > 0
        ? [
            chunkAsset(
              `routes/${routeChunkName(route)}.css`,
              `route:${route}`,
              fragmentTargetsForAssets(routeAssets),
              routeAssets,
              options,
            ),
          ]
        : [];
  }

  const fragments: Record<string, ComponentCssAsset[]> = {};
  for (const target of fragmentTargetsForAssets(manifest.stylesheets)) {
    const fragmentAssets = manifest.stylesheets.filter(
      (asset) =>
        !baseNames.has(asset.sourceFileName) &&
        asset.fragmentTargets.some((item) => item === target),
    );
    fragments[target] =
      fragmentAssets.length > 0
        ? [
            chunkAsset(
              `fragments/${routeChunkName(target)}.css`,
              `fragment:${target}`,
              [target],
              fragmentAssets,
              options,
            ),
          ]
        : [];
  }

  return { base, fragments, routes };
}

function defaultDeliveredRouteCssAssets(
  manifest: CssAssetManifest,
  route: CssRouteSplitTarget,
): ComponentCssAsset[] {
  if (!manifest.chunks) return selectRouteCssAssets(manifest, route);
  return dedupeComponentCssAssets([
    ...manifest.chunks.base,
    ...(manifest.chunks.routes[route.route] ?? []),
  ]);
}

function styleRuleUsageKey(usage: StyleRuleUsage): string {
  return `${usage.moduleFileName}\0${usage.styleRef}\0${usage.source}\0${usage.className}`;
}

function selectRouteCssAssets(
  manifest: Pick<CssAssetManifest, 'byFileName' | 'stylesheets'>,
  route: CssRouteSplitTarget,
): ComponentCssAsset[] {
  return dedupeComponentCssAssets([
    ...selectCssAssets(
      { byFileName: manifest.byFileName, stylesheets: manifest.stylesheets },
      route.sourceFileNames ?? [],
    ),
    ...selectCssAssetsByHref(manifest.stylesheets, [
      ...(route.hrefs ?? []),
      ...(route.stylesheets ?? []),
    ]),
    ...selectCssAssetsByFragmentTarget(manifest.stylesheets, route.fragmentTargets ?? []),
  ]);
}

function selectCssAssetsByHref(
  assets: readonly ComponentCssAsset[],
  hrefs: readonly string[],
): ComponentCssAsset[] {
  if (hrefs.length === 0) return [];
  const wanted = new Set(hrefs);
  return assets.filter((asset) => wanted.has(asset.href));
}

function selectCssAssetsByFragmentTarget(
  assets: readonly ComponentCssAsset[],
  fragmentTargets: readonly string[],
): ComponentCssAsset[] {
  if (fragmentTargets.length === 0) return [];
  const wanted = new Set(fragmentTargets);
  return assets.filter((asset) => asset.fragmentTargets.some((target) => wanted.has(target)));
}

function sharedRouteCssAssets(
  routeSelections: ReadonlyMap<string, readonly ComponentCssAsset[]>,
): ComponentCssAsset[] {
  const counts = new Map<string, { asset: ComponentCssAsset; count: number }>();
  for (const assets of routeSelections.values()) {
    for (const asset of new Map(assets.map((item) => [item.sourceFileName, item])).values()) {
      const existing = counts.get(asset.sourceFileName);
      counts.set(asset.sourceFileName, {
        asset,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }

  return [...counts.values()].filter((entry) => entry.count > 1).map((entry) => entry.asset);
}

function fragmentTargetsForAssets(assets: readonly ComponentCssAsset[]): string[] {
  return [...new Set(assets.flatMap((asset) => asset.fragmentTargets))].sort();
}

function chunkAsset(
  fileName: string,
  componentName: string,
  fragmentTargets: readonly string[],
  assets: readonly ComponentCssAsset[],
  options: CssAssetManifestOptions,
): ComponentCssAsset {
  const criticalCss = dedupeCss(assets.flatMap((asset) => asset.criticalCss ?? []));
  const styleRuleUsages = dedupeStyleRuleUsages(
    assets.flatMap((asset) => [...(asset.styleRuleUsages ?? [])]),
  );
  const chunk = componentCssAssetForFile(
    hashedChunkFileName(fileName, criticalCss),
    componentName,
    fragmentTargets,
    options,
    criticalCss,
  );
  if (styleRuleUsages.length > 0) chunk.styleRuleUsages = styleRuleUsages;
  return chunk;
}

function cssAssetCriticalBytes(assets: readonly ComponentCssAsset[]): number {
  return assets.reduce(
    (total, asset) => total + Buffer.byteLength(asset.criticalCss ?? '', 'utf8'),
    0,
  );
}

function hashedChunkFileName(fileName: string, css: string): string {
  const hash = createHash('sha256').update(css).digest('hex').slice(0, 8);
  const extensionIndex = fileName.lastIndexOf('.');
  if (extensionIndex <= 0) return `${fileName}-${hash}`;
  return `${fileName.slice(0, extensionIndex)}-${hash}${fileName.slice(extensionIndex)}`;
}

function allManifestAssets(manifest: CssAssetManifest): ComponentCssAsset[] {
  if (!manifest.chunks) return [...manifest.stylesheets];
  return dedupeComponentCssAssets([
    ...manifest.chunks.base,
    ...Object.values(manifest.chunks.routes).flat(),
    ...Object.values(manifest.chunks.fragments).flat(),
  ]);
}

function dedupeComponentCssAssets(assets: readonly ComponentCssAsset[]): ComponentCssAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.sourceFileName)) return false;
    seen.add(asset.sourceFileName);
    return true;
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function dedupeStyleRuleUsages(usages: readonly StyleRuleUsage[]): StyleRuleUsage[] {
  const seen = new Set<string>();
  return usages.filter((usage) => {
    const key = `${usage.className}\0${usage.moduleFileName}\0${usage.source}\0${usage.styleRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function routeChunkName(value: string): string {
  return (
    value
      .replace(/^\//, '')
      .replace(/[:*]+/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'index'
  );
}

export function componentCssAssetForFile(
  fileName: string,
  componentName: string,
  fragmentTargets: readonly string[],
  options: CssAssetManifestOptions = {},
  criticalCss?: string,
): ComponentCssAsset {
  return {
    componentName,
    ...(criticalCss ? { criticalCss } : {}),
    ...(criticalCss ? { cspHash: cspSha256(escapeStyleText(criticalCss)) } : {}),
    fragmentTargets,
    href: `${options.baseHref ?? '/assets/'}${normalizeAssetPath(fileName)}`,
    ...(options.preload === undefined ? {} : { preload: options.preload }),
    sourceFileName: fileName,
  };
}

export function emitCssModule(componentName: string, model: ComponentModuleModel): string | null {
  const css = extractStaticComponentCss(model);
  if (!css) return null;

  const scopedCss = scopeComponentCss(componentHostSelector(componentName, model), css);

  return `${cssIrHeader}\n/* @kovojs-scope-fallback */\n${formatFallbackCss(scopedCss.fallback)}\n\n${scopedCss.scoped}`;
}

function normalizeAssetPath(fileName: string): string {
  return fileName.replace(/^\.?\//, '');
}

function formatFallbackCss(css: string): string {
  return css.replace(/}\s*/g, '}\n').trimEnd();
}

function cspSha256(value: string): string {
  return `sha256-${createHash('sha256').update(value).digest('base64')}`;
}

function escapeStyleText(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style');
}

function prefixCssSelectors(
  hostSelector: string,
  css: string,
  nestedHostSelectors: readonly string[],
): string {
  const nestedExclusion = selectorExclusion(nestedHostSelectors);

  return prefixCssBlockSelectors(hostSelector, css, nestedExclusion);
}

function prefixCssBlockSelectors(
  hostSelector: string,
  css: string,
  nestedExclusion: string,
  parentSelectors?: readonly string[],
): string {
  let output = '';
  let index = 0;
  let declarationBuffer = '';

  while (index < css.length) {
    const rule = nextCssRule(css, index);
    if (!rule) {
      if (parentSelectors) {
        declarationBuffer += css.slice(index);
      } else {
        output += css.slice(index);
      }
      break;
    }

    const betweenRules = css.slice(index, rule.selectorStart);
    if (parentSelectors) {
      declarationBuffer += betweenRules;
    } else {
      output += betweenRules;
    }

    let rawSelector = css.slice(rule.selectorStart, rule.bodyStart);
    if (parentSelectors) {
      const declarationBoundary = rawSelector.lastIndexOf(';');
      if (declarationBoundary !== -1) {
        declarationBuffer += rawSelector.slice(0, declarationBoundary + 1);
        rawSelector = rawSelector.slice(declarationBoundary + 1);
      }
    }
    const selector = rawSelector.trim();
    const body = css.slice(rule.bodyStart + 1, rule.bodyEnd);
    if (selector.startsWith('@media') || selector.startsWith('@supports')) {
      output += flushPrefixedDeclarationRule(
        hostSelector,
        nestedExclusion,
        parentSelectors,
        declarationBuffer,
      );
      declarationBuffer = '';
      output += `${selector} {${prefixCssBlockSelectors(
        hostSelector,
        body,
        nestedExclusion,
        parentSelectors,
      )}}`;
    } else if (selector.startsWith('@')) {
      output += flushPrefixedDeclarationRule(
        hostSelector,
        nestedExclusion,
        parentSelectors,
        declarationBuffer,
      );
      declarationBuffer = '';
      output += css.slice(rule.selectorStart, rule.bodyEnd + 1);
    } else {
      output += flushPrefixedDeclarationRule(
        hostSelector,
        nestedExclusion,
        parentSelectors,
        declarationBuffer,
      );
      declarationBuffer = '';
      output += prefixCssBlockSelectors(
        hostSelector,
        body,
        nestedExclusion,
        resolveNestedSelectors(selector, parentSelectors),
      );
    }

    index = rule.bodyEnd + 1;
  }

  output += flushPrefixedDeclarationRule(
    hostSelector,
    nestedExclusion,
    parentSelectors,
    declarationBuffer,
  );

  return output;
}

function flushPrefixedDeclarationRule(
  hostSelector: string,
  nestedExclusion: string,
  selectors: readonly string[] | undefined,
  declarations: string,
): string {
  if (!selectors || declarations.trim().length === 0) return '';

  const prefixed = selectors
    .map((selector) => `${hostSelector} ${selector}${nestedExclusion}`)
    .join(', ');

  return `${prefixed} {${declarations}}`;
}

function resolveNestedSelectors(
  selector: string,
  parentSelectors: readonly string[] | undefined,
): string[] {
  const selectors = splitCssSelectorList(selector);
  if (!parentSelectors) return selectors;

  return parentSelectors.flatMap((parentSelector) =>
    selectors.map((nestedSelector) =>
      nestedSelector.includes('&')
        ? nestedSelector.replaceAll('&', parentSelector)
        : `${parentSelector} ${nestedSelector}`,
    ),
  );
}

function splitCssSelectorList(selector: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | undefined;
  let start = 0;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    const previous = selector[index - 1];

    if (quote) {
      if (char === quote && previous !== '\\') quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[') {
      depth += 1;
      continue;
    }

    if ((char === ')' || char === ']') && depth > 0) {
      depth -= 1;
      continue;
    }

    if (char === ',' && depth === 0) {
      selectors.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }

  selectors.push(selector.slice(start).trim());
  return selectors.filter(Boolean);
}

function nextCssRule(
  source: string,
  start: number,
): { bodyEnd: number; bodyStart: number; selectorStart: number } | null {
  const bodyStart = source.indexOf('{', start);
  if (bodyStart === -1) return null;

  const selectorStart = skipCssWhitespaceAfterBoundary(source, start);
  const bodyEnd = findMatchingToken(source, bodyStart, '{', '}');
  if (bodyEnd === -1) return null;

  return { bodyEnd, bodyStart, selectorStart };
}

function skipCssWhitespaceAfterBoundary(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
  return index;
}

function scopeLimitSelectors(nestedHostSelectors: readonly string[]): string {
  return nestedHostSelectors.map((selector) => `:scope ${selector}`).join(', ');
}

function selectorExclusion(nestedHostSelectors: readonly string[]): string {
  return nestedHostSelectors
    .flatMap((selector) => [`:not(${selector})`, `:not(${selector} *)`])
    .join('');
}

function extractStaticComponentCss(model: ComponentModuleModel): string | null {
  return (
    componentOptionStaticTemplateValue(model, 'css') ??
    componentOptionStaticTemplateValue(model, 'styles') ??
    null
  );
}

/**
 * @internal Build the host CSS selector for a component's scoped stylesheet.
 * Exported for the L14-3 escaping conformance test only; not part of the
 * app-facing public surface (rules/api-surface.md).
 */
export function componentHostSelector(
  domComponentName: string,
  model: ComponentModuleModel,
): string {
  const hostName = domComponentName;
  const renderedHost = componentRenderHostElement(model)?.tag ?? null;

  // The `kovo-c` value sits inside a double-quoted CSS string token, so it must
  // be escaped per CSS string syntax (escapeCssString), NOT HTML attribute syntax
  // (escapeAttribute). The HTML escaper would emit `&quot;`/`&amp;` literals and
  // leave `"`, `\`, `]`, `}`, and newlines able to break the selector or smuggle
  // an escape, so the selector would not round-trip against the runtime attribute
  // value. (SPEC.md §5.2)
  return renderedHost === hostName ? hostName : `[kovo-c="${escapeCssString(hostName)}"]`;
}
