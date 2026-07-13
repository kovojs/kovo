import { findMatchingToken } from './scan/text.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFreeze,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerCreateMap,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerSha256Base64,
  compilerSha256Hex,
  compilerSnapshotDenseArray,
  compilerSnapshotJsonValue,
  compilerStringIncludes,
  compilerStringIndexOf,
  compilerStringLastIndexOf,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
  compilerStringTrim,
  compilerStringTrimEnd,
  compilerUtf8ByteLength,
} from './compiler-security-intrinsics.js';
import {
  componentOptionStaticTemplateValue,
  componentRenderHostElement,
  type ComponentModuleModel,
} from './scan/parse.js';
import { cssIrHeader } from './ir.js';
import { escapeCssString, indent, uniqueSorted } from './shared.js';
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

const CSS_ROUTE_LIST_PROPERTIES = [
  'fragmentTargets',
  'hrefs',
  'sourceFileNames',
  'stylesheets',
] as const;
const CSS_STYLE_USAGE_PROPERTIES = ['className', 'moduleFileName', 'source', 'styleRef'] as const;

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
  const trimmed = compilerStringTrim(css);
  const rawNestedHostSelectors = compilerOwnDataValue(
    options,
    'nestedHostSelectors',
    'Compiler scoped CSS options',
  );
  const nestedHostSelectors =
    rawNestedHostSelectors === undefined
      ? ['[kovo-c]']
      : compilerSnapshotJsonValue(
          rawNestedHostSelectors,
          'Compiler scoped CSS nested host selectors',
        );
  validateCssStringList(nestedHostSelectors, 'Compiler scoped CSS nested host selectors');

  return {
    fallback: prefixCssSelectors(hostSelector, trimmed, nestedHostSelectors),
    scoped: `@scope (${hostSelector}) to (${scopeLimitSelectors(nestedHostSelectors)}) {\n${indent(trimmed)}\n}\n`,
  };
}

/** @internal Join CSS chunks, dropping blank and duplicate chunks. In-repo build use only. */
export function dedupeCss(chunks: readonly string[]): string {
  const snapshot = compilerSnapshotDenseArray(chunks, 'Compiler CSS chunks');
  const seen = compilerCreateSet<string>();
  const output: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const chunk = compilerStringTrim(snapshot[index]!);
    if (chunk.length === 0 || compilerSetHas(seen, chunk)) continue;
    compilerSetAdd(seen, chunk);
    compilerArrayAppend(output, chunk, 'Compiler deduplicated CSS chunks');
  }
  return compilerArrayJoin(output, '\n\n');
}

/**
 * @internal Collect one deduplicated {@link CssAssetManifest} across compiled components.
 * Used by the in-repo asset/build pipeline, not by app authors (SPEC.md §5.2).
 */
export function collectCssAssetManifest(
  results: CompileCssAssetSource | readonly CompileCssAssetSource[],
  options: CssAssetManifestOptions = {},
): CssAssetManifest {
  const optionsSnapshot = snapshotCssAssetManifestOptions(options);
  const byFileName = compilerCreateNullRecord<ComponentCssAsset>();
  const stylesheets: ComponentCssAsset[] = [];
  if (compilerArrayIsArray(results)) {
    const resultCount = compilerArrayLength(results, 'Compiler CSS manifest results');
    for (let index = 0; index < resultCount; index += 1) {
      collectCssAssetsFromResult(
        compilerOwnDataValue(results, index, 'Compiler CSS manifest results'),
        index,
        byFileName,
        stylesheets,
        optionsSnapshot,
      );
    }
  } else {
    collectCssAssetsFromResult(results, 0, byFileName, stylesheets, optionsSnapshot);
  }

  const manifest = { byFileName, stylesheets };
  return optionsSnapshot.split
    ? { ...manifest, chunks: computeCssSplitChunks(manifest, optionsSnapshot) }
    : manifest;
}

/** @internal Snapshot build asset options before any app-controlled lifecycle can re-enter. */
export function snapshotCssAssetManifestOptions(
  options: CssAssetManifestOptions,
): CssAssetManifestOptions {
  if (typeof options !== 'object' || options === null || compilerArrayIsArray(options)) {
    throw new TypeError('Compiler CSS manifest options must be an own object.');
  }
  const baseHref = compilerOwnDataValue(options, 'baseHref', 'Compiler CSS manifest options');
  const preload = compilerOwnDataValue(options, 'preload', 'Compiler CSS manifest options');
  const rawSplit = compilerOwnDataValue(options, 'split', 'Compiler CSS manifest options');
  if (baseHref !== undefined && typeof baseHref !== 'string') {
    throw new TypeError('Compiler CSS manifest options.baseHref must be a string.');
  }
  if (preload !== undefined && typeof preload !== 'boolean') {
    throw new TypeError('Compiler CSS manifest options.preload must be a boolean.');
  }
  const split =
    rawSplit === undefined
      ? undefined
      : compilerSnapshotJsonValue(rawSplit, 'Compiler CSS manifest options.split');
  if (split !== undefined) validateCssSplitOptions(split);
  const snapshot = compilerCreateNullRecord<unknown>();
  if (baseHref !== undefined) compilerDefineOwnDataProperty(snapshot, 'baseHref', baseHref);
  if (preload !== undefined) compilerDefineOwnDataProperty(snapshot, 'preload', preload);
  if (split !== undefined) compilerDefineOwnDataProperty(snapshot, 'split', split);
  return compilerFreeze(snapshot) as CssAssetManifestOptions;
}

function collectCssAssetsFromResult(
  rawResult: unknown,
  resultIndex: number,
  byFileName: Record<string, ComponentCssAsset>,
  stylesheets: ComponentCssAsset[],
  options: CssAssetManifestOptions,
): void {
  if (typeof rawResult !== 'object' || rawResult === null || compilerArrayIsArray(rawResult)) {
    throw new TypeError(`Compiler CSS manifest results[${resultIndex}] must be an own object.`);
  }
  const rawAssets = compilerOwnDataValue(
    rawResult,
    'cssAssets',
    `Compiler CSS manifest results[${resultIndex}]`,
  );
  if (!compilerArrayIsArray(rawAssets)) {
    throw new TypeError(
      `Compiler CSS manifest results[${resultIndex}].cssAssets must be an array.`,
    );
  }
  const assetCount = compilerArrayLength(
    rawAssets,
    `Compiler CSS manifest results[${resultIndex}].cssAssets`,
  );
  for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
    const cssAsset = snapshotComponentCssAsset(
      compilerOwnDataValue(
        rawAssets,
        assetIndex,
        `Compiler CSS manifest results[${resultIndex}].cssAssets`,
      ),
      `${resultIndex}].cssAssets[${assetIndex}`,
    );
    if (byFileName[cssAsset.sourceFileName] !== undefined) continue;

    const asset = componentCssAssetForFile(
      cssAsset.sourceFileName,
      cssAsset.componentName,
      cssAsset.fragmentTargets,
      options,
      cssAsset.criticalCss,
    );
    if (cssAsset.styleRuleUsages !== undefined && cssAsset.styleRuleUsages.length > 0) {
      compilerDefineOwnDataProperty(asset, 'styleRuleUsages', cssAsset.styleRuleUsages);
    }
    compilerDefineOwnDataProperty(byFileName, cssAsset.sourceFileName, compilerFreeze(asset));
    compilerArrayAppend(stylesheets, asset, 'Compiler CSS manifest stylesheets');
  }
}

function snapshotComponentCssAsset(value: unknown, labelSuffix: string): ComponentCssAsset {
  const label = `Compiler CSS manifest results[${labelSuffix}]`;
  const snapshot = compilerSnapshotJsonValue(value, label) as unknown;
  if (typeof snapshot !== 'object' || snapshot === null || compilerArrayIsArray(snapshot)) {
    throw new TypeError(`${label} must be an own object.`);
  }
  const componentName = compilerOwnDataValue(snapshot, 'componentName', label);
  const criticalCss = compilerOwnDataValue(snapshot, 'criticalCss', label);
  const cspHash = compilerOwnDataValue(snapshot, 'cspHash', label);
  const fragmentTargets = compilerOwnDataValue(snapshot, 'fragmentTargets', label);
  const href = compilerOwnDataValue(snapshot, 'href', label);
  const preload = compilerOwnDataValue(snapshot, 'preload', label);
  const sourceFileName = compilerOwnDataValue(snapshot, 'sourceFileName', label);
  const styleRuleUsages = compilerOwnDataValue(snapshot, 'styleRuleUsages', label);
  if (
    typeof componentName !== 'string' ||
    (criticalCss !== undefined && typeof criticalCss !== 'string') ||
    (cspHash !== undefined && typeof cspHash !== 'string') ||
    typeof href !== 'string' ||
    (preload !== undefined && typeof preload !== 'boolean') ||
    typeof sourceFileName !== 'string'
  ) {
    throw new TypeError(`${label} has malformed CSS asset authority fields.`);
  }
  validateCssStringList(fragmentTargets, `${label}.fragmentTargets`);
  validateCssSourceFileName(sourceFileName, label);
  if (styleRuleUsages !== undefined) validateStyleRuleUsages(styleRuleUsages, label);
  return snapshot as ComponentCssAsset;
}

function validateCssSplitOptions(value: unknown): void {
  if (typeof value !== 'object' || value === null || compilerArrayIsArray(value)) {
    throw new TypeError('Compiler CSS manifest options.split must be an own object.');
  }
  const baseSourceFileNames = compilerOwnDataValue(
    value,
    'baseSourceFileNames',
    'Compiler CSS manifest options.split',
  );
  const routes = compilerOwnDataValue(value, 'routes', 'Compiler CSS manifest options.split');
  if (baseSourceFileNames !== undefined) {
    validateCssStringList(
      baseSourceFileNames,
      'Compiler CSS manifest options.split.baseSourceFileNames',
    );
  }
  if (routes === undefined) return;
  if (!compilerArrayIsArray(routes)) {
    throw new TypeError('Compiler CSS manifest options.split.routes must be an array.');
  }
  const routeCount = compilerArrayLength(routes, 'Compiler CSS manifest options.split.routes');
  for (let index = 0; index < routeCount; index += 1) {
    const route = compilerOwnDataValue(routes, index, 'Compiler CSS manifest options.split.routes');
    if (typeof route !== 'object' || route === null || compilerArrayIsArray(route)) {
      throw new TypeError(
        `Compiler CSS manifest options.split.routes[${index}] must be an object.`,
      );
    }
    if (
      typeof compilerOwnDataValue(
        route,
        'route',
        `Compiler CSS manifest options.split.routes[${index}]`,
      ) !== 'string'
    ) {
      throw new TypeError(
        `Compiler CSS manifest options.split.routes[${index}].route must be a string.`,
      );
    }
    const propertyCount = compilerArrayLength(
      CSS_ROUTE_LIST_PROPERTIES,
      'Compiler CSS split route properties',
    );
    for (let propertyIndex = 0; propertyIndex < propertyCount; propertyIndex += 1) {
      const property = compilerOwnDataValue(
        CSS_ROUTE_LIST_PROPERTIES,
        propertyIndex,
        'Compiler CSS split route properties',
      ) as (typeof CSS_ROUTE_LIST_PROPERTIES)[number];
      const entries = compilerOwnDataValue(
        route,
        property,
        `Compiler CSS manifest options.split.routes[${index}]`,
      );
      if (entries !== undefined) {
        validateCssStringList(
          entries,
          `Compiler CSS manifest options.split.routes[${index}].${property}`,
        );
      }
    }
  }
}

function validateCssStringList(value: unknown, label: string): asserts value is readonly string[] {
  if (!compilerArrayIsArray(value)) throw new TypeError(`${label} must be an array.`);
  const length = compilerArrayLength(value, label);
  for (let index = 0; index < length; index += 1) {
    if (typeof compilerOwnDataValue(value, index, label) !== 'string') {
      throw new TypeError(`${label}[${index}] must be a string.`);
    }
  }
}

function validateStyleRuleUsages(value: unknown, label: string): void {
  if (!compilerArrayIsArray(value))
    throw new TypeError(`${label}.styleRuleUsages must be an array.`);
  const count = compilerArrayLength(value, `${label}.styleRuleUsages`);
  for (let index = 0; index < count; index += 1) {
    const usage = compilerOwnDataValue(value, index, `${label}.styleRuleUsages`);
    if (typeof usage !== 'object' || usage === null || compilerArrayIsArray(usage)) {
      throw new TypeError(`${label}.styleRuleUsages[${index}] must be an object.`);
    }
    const propertyCount = compilerArrayLength(
      CSS_STYLE_USAGE_PROPERTIES,
      'Compiler CSS style usage properties',
    );
    for (let propertyIndex = 0; propertyIndex < propertyCount; propertyIndex += 1) {
      const property = compilerOwnDataValue(
        CSS_STYLE_USAGE_PROPERTIES,
        propertyIndex,
        'Compiler CSS style usage properties',
      ) as (typeof CSS_STYLE_USAGE_PROPERTIES)[number];
      if (
        typeof compilerOwnDataValue(usage, property, `${label}.styleRuleUsages[${index}]`) !==
        'string'
      ) {
        throw new TypeError(`${label}.styleRuleUsages[${index}].${property} must be a string.`);
      }
    }
  }
}

function validateCssSourceFileName(value: string, label: string): void {
  if (
    value.length === 0 ||
    compilerStringStartsWith(value, '/') ||
    compilerStringIncludes(value, '\\')
  ) {
    throw new TypeError(`${label}.sourceFileName must be a relative POSIX asset path.`);
  }
  const segments = compilerStringSplit(value, '/');
  const count = compilerArrayLength(segments, `${label}.sourceFileName segments`);
  for (let index = 0; index < count; index += 1) {
    const segment = compilerOwnDataValue(segments, index, `${label}.sourceFileName segments`);
    if (segment === '' || segment === '.' || segment === '..') {
      throw new TypeError(`${label}.sourceFileName must not contain empty or traversal segments.`);
    }
  }
}

function snapshotCssAssetManifest(manifest: CssAssetManifest, label: string): CssAssetManifest {
  const snapshot = compilerSnapshotJsonValue(manifest, label) as unknown;
  if (typeof snapshot !== 'object' || snapshot === null || compilerArrayIsArray(snapshot)) {
    throw new TypeError(`${label} must be an own object.`);
  }
  const byFileName = compilerOwnDataValue(snapshot, 'byFileName', label);
  const stylesheets = compilerOwnDataValue(snapshot, 'stylesheets', label);
  const chunks = compilerOwnDataValue(snapshot, 'chunks', label);
  validateCssAssetRecord(byFileName, `${label}.byFileName`, true);
  validateCssAssetList(stylesheets, `${label}.stylesheets`);
  if (chunks !== undefined) {
    if (typeof chunks !== 'object' || chunks === null || compilerArrayIsArray(chunks)) {
      throw new TypeError(`${label}.chunks must be an own object.`);
    }
    validateCssAssetList(
      compilerOwnDataValue(chunks, 'base', `${label}.chunks`),
      `${label}.chunks.base`,
    );
    validateCssAssetRecord(
      compilerOwnDataValue(chunks, 'routes', `${label}.chunks`),
      `${label}.chunks.routes`,
      false,
    );
    validateCssAssetRecord(
      compilerOwnDataValue(chunks, 'fragments', `${label}.chunks`),
      `${label}.chunks.fragments`,
      false,
    );
  }
  return snapshot as CssAssetManifest;
}

function validateCssAssetRecord(value: unknown, label: string, singletonValues: boolean): void {
  if (typeof value !== 'object' || value === null || compilerArrayIsArray(value)) {
    throw new TypeError(`${label} must be an own object.`);
  }
  const keys = compilerObjectKeys(value);
  const keyCount = compilerArrayLength(keys, `${label} keys`);
  for (let index = 0; index < keyCount; index += 1) {
    const key = compilerOwnDataValue(keys, index, `${label} keys`) as string;
    const entry = compilerOwnDataValue(value, key, label);
    if (singletonValues) {
      const asset = validateCssAsset(entry, `${label}.${key}`);
      if (asset.sourceFileName !== key) {
        throw new TypeError(`${label}.${key}.sourceFileName must match its manifest key.`);
      }
    } else {
      validateCssAssetList(entry, `${label}.${key}`);
    }
  }
}

function validateCssAssetList(
  value: unknown,
  label: string,
): asserts value is readonly ComponentCssAsset[] {
  if (!compilerArrayIsArray(value)) throw new TypeError(`${label} must be an array.`);
  const count = compilerArrayLength(value, label);
  for (let index = 0; index < count; index += 1) {
    validateCssAsset(compilerOwnDataValue(value, index, label), `${label}[${index}]`);
  }
}

function validateCssAsset(value: unknown, label: string): ComponentCssAsset {
  const snapshot = snapshotComponentCssAsset(value, label);
  return snapshot;
}

function snapshotCssAssetList(
  assets: readonly ComponentCssAsset[],
  label: string,
): readonly ComponentCssAsset[] {
  const snapshot = compilerSnapshotJsonValue(assets, label) as unknown;
  validateCssAssetList(snapshot, label);
  return snapshot;
}

function snapshotCssRouteSplitTarget(
  value: CssRouteSplitTarget,
  label: string,
): CssRouteSplitTarget {
  const snapshot = compilerSnapshotJsonValue(value, label) as unknown;
  if (typeof snapshot !== 'object' || snapshot === null || compilerArrayIsArray(snapshot)) {
    throw new TypeError(`${label} must be an own object.`);
  }
  const route = compilerOwnDataValue(snapshot, 'route', label);
  if (typeof route !== 'string') throw new TypeError(`${label}.route must be a string.`);
  const propertyCount = compilerArrayLength(
    CSS_ROUTE_LIST_PROPERTIES,
    'Compiler CSS route target properties',
  );
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      CSS_ROUTE_LIST_PROPERTIES,
      index,
      'Compiler CSS route target properties',
    ) as (typeof CSS_ROUTE_LIST_PROPERTIES)[number];
    const entries = compilerOwnDataValue(snapshot, property, label);
    if (entries !== undefined) validateCssStringList(entries, `${label}.${property}`);
  }
  return snapshot as CssRouteSplitTarget;
}

function snapshotCssRenderTarget(value: CssRenderTarget): CssRenderTarget {
  const label = 'Compiler CSS render target';
  const snapshot = compilerSnapshotJsonValue(value, label) as unknown;
  if (typeof snapshot !== 'object' || snapshot === null || compilerArrayIsArray(snapshot)) {
    throw new TypeError(`${label} must be an own object.`);
  }
  const kind = compilerOwnDataValue(snapshot, 'kind', label);
  const route = compilerOwnDataValue(snapshot, 'route', label);
  const sourceFileNames = compilerOwnDataValue(snapshot, 'sourceFileNames', label);
  const fragmentTargets = compilerOwnDataValue(snapshot, 'fragmentTargets', label);
  if (kind !== 'page' && kind !== 'fragment' && kind !== 'defer') {
    throw new TypeError(`${label}.kind must be page, fragment, or defer.`);
  }
  if (route !== undefined && typeof route !== 'string') {
    throw new TypeError(`${label}.route must be a string.`);
  }
  if (sourceFileNames !== undefined) {
    validateCssStringList(sourceFileNames, `${label}.sourceFileNames`);
  }
  if (fragmentTargets !== undefined) {
    validateCssStringList(fragmentTargets, `${label}.fragmentTargets`);
  }
  return snapshot as CssRenderTarget;
}

function frozenCssAssets(assets: ComponentCssAsset[]): ComponentCssAsset[] {
  return compilerFreeze(assets) as ComponentCssAsset[];
}

/**
 * @internal Select the manifest assets for a given set of source file names, preserving
 * request order. In-repo build pipeline use only (SPEC.md §5.2).
 */
export function selectCssAssets(
  manifest: CssAssetManifest,
  fileNames: readonly string[],
): ComponentCssAsset[] {
  const selected: ComponentCssAsset[] = [];
  const count = compilerArrayLength(fileNames, 'Compiler CSS asset file-name selection');
  for (let index = 0; index < count; index += 1) {
    const fileName = compilerOwnDataValue(
      fileNames,
      index,
      'Compiler CSS asset file-name selection',
    );
    if (typeof fileName !== 'string') {
      throw new TypeError(`Compiler CSS asset file-name selection[${index}] must be a string.`);
    }
    const asset = compilerOwnDataValue(
      manifest.byFileName,
      fileName,
      'Compiler CSS manifest byFileName',
    ) as ComponentCssAsset | undefined;
    if (asset !== undefined) {
      compilerArrayAppend(selected, asset, 'Compiler selected CSS assets');
    }
  }
  return selected;
}

/**
 * @internal Build the render-parameterized stylesheet resolver required by
 * plans/claude-stylex.md Phase 2. With today's unsplit manifest it returns all
 * stylesheets for a page and the matching target assets for late fragments/defer.
 */
export function createCssAssetResolver(manifest: CssAssetManifest): CssAssetResolver {
  const manifestSnapshot = snapshotCssAssetManifest(manifest, 'Compiler CSS asset resolver');
  return (renderTarget) => {
    if (!renderTarget) return frozenCssAssets(allManifestAssets(manifestSnapshot));
    const target = snapshotCssRenderTarget(renderTarget);
    if (target.sourceFileNames) {
      return frozenCssAssets(selectCssAssets(manifestSnapshot, target.sourceFileNames));
    }
    const chunks = manifestSnapshot.chunks;
    if (chunks) {
      if (target.kind === 'page') {
        if (!target.route) return frozenCssAssets(allManifestAssets(manifestSnapshot));
        const selected: ComponentCssAsset[] = [];
        appendCssAssets(selected, chunks.base, 'Compiler CSS page resolver base chunks');
        const routeAssets = compilerOwnDataValue(
          chunks.routes,
          target.route,
          'Compiler CSS page resolver route chunks',
        ) as readonly ComponentCssAsset[] | undefined;
        if (routeAssets !== undefined) {
          appendCssAssets(selected, routeAssets, 'Compiler CSS page resolver route chunks');
        }
        return frozenCssAssets(dedupeComponentCssAssets(selected));
      }
      if (target.fragmentTargets) {
        const selected: ComponentCssAsset[] = [];
        appendCssAssets(selected, chunks.base, 'Compiler CSS fragment resolver base chunks');
        const targetCount = compilerArrayLength(
          target.fragmentTargets,
          'Compiler CSS fragment resolver targets',
        );
        for (let index = 0; index < targetCount; index += 1) {
          const fragmentTarget = compilerOwnDataValue(
            target.fragmentTargets,
            index,
            'Compiler CSS fragment resolver targets',
          ) as string;
          const fragmentAssets = compilerOwnDataValue(
            chunks.fragments,
            fragmentTarget,
            'Compiler CSS fragment resolver chunks',
          ) as readonly ComponentCssAsset[] | undefined;
          if (fragmentAssets !== undefined) {
            appendCssAssets(selected, fragmentAssets, 'Compiler CSS fragment resolver chunks');
          }
        }
        return frozenCssAssets(dedupeComponentCssAssets(selected));
      }
    }
    if (target.fragmentTargets) {
      return frozenCssAssets(
        selectCssAssetsByFragmentTarget(manifestSnapshot.stylesheets, target.fragmentTargets),
      );
    }
    const selected: ComponentCssAsset[] = [];
    appendCssAssets(selected, manifestSnapshot.stylesheets, 'Compiler CSS resolver stylesheets');
    return frozenCssAssets(selected);
  };
}

/** @internal Convert compiler route facts into splitter route targets. */
export function cssRouteSplitTargetsFromRouteFacts(
  routePageFacts: readonly RoutePageFact[],
): CssRouteSplitTarget[] {
  const facts = compilerSnapshotJsonValue(
    routePageFacts,
    'Compiler CSS route-page facts',
  ) as readonly RoutePageFact[];
  const targets: CssRouteSplitTarget[] = [];
  const factCount = compilerArrayLength(facts, 'Compiler CSS route-page facts');
  for (let index = 0; index < factCount; index += 1) {
    const fact = compilerOwnDataValue(
      facts,
      index,
      'Compiler CSS route-page facts',
    ) as RoutePageFact;
    const sourceFileNames = uniqueSorted(fact.css?.sourceFileNames ?? []);
    const fragmentTargets = uniqueSorted(fact.css?.fragmentTargets ?? []);
    if (sourceFileNames.length === 0 && fragmentTargets.length === 0) continue;
    compilerArrayAppend(
      targets,
      {
        ...(fragmentTargets.length === 0 ? {} : { fragmentTargets }),
        route: fact.route,
        ...(sourceFileNames.length === 0 ? {} : { sourceFileNames }),
      },
      'Compiler CSS route split targets',
    );
  }
  return compilerSnapshotJsonValue(targets, 'Compiler CSS route split targets');
}

/**
 * @internal Account for route-scoped CSS delivery against the same route target facts
 * consumed by the splitter (SPEC.md §13.1, emitted stylesheet assets).
 */
export function cssRouteByteAccounting(
  manifest: CssAssetManifest,
  route: CssRouteSplitTarget,
): CssRouteByteAccounting {
  const manifestSnapshot = snapshotCssAssetManifest(manifest, 'Compiler CSS route accounting');
  const routeSnapshot = snapshotCssRouteSplitTarget(route, 'Compiler CSS route accounting target');
  const reachableAssets = selectRouteCssAssets(manifestSnapshot, routeSnapshot);
  const linkedAssets: ComponentCssAsset[] = [];
  if (manifestSnapshot.chunks) {
    appendCssAssets(
      linkedAssets,
      manifestSnapshot.chunks.base,
      'Compiler CSS route accounting base chunks',
    );
    const routeAssets = compilerOwnDataValue(
      manifestSnapshot.chunks.routes,
      routeSnapshot.route,
      'Compiler CSS route accounting chunks',
    ) as readonly ComponentCssAsset[] | undefined;
    if (routeAssets !== undefined) {
      appendCssAssets(linkedAssets, routeAssets, 'Compiler CSS route accounting chunks');
    }
  } else {
    appendCssAssets(linkedAssets, reachableAssets, 'Compiler CSS route accounting assets');
  }
  const uniqueLinkedAssets = dedupeComponentCssAssets(linkedAssets);
  const linkedCssBytes = cssAssetCriticalBytes(uniqueLinkedAssets);

  return compilerSnapshotJsonValue(
    {
      inlinedCriticalCssBytes: linkedCssBytes,
      linkedCssBytes,
      linkedHrefs: cssAssetStringPropertyValues(uniqueLinkedAssets, 'href'),
      linkedSourceFileNames: cssAssetStringPropertyValues(uniqueLinkedAssets, 'sourceFileName'),
      reachableCssBytes: cssAssetCriticalBytes(reachableAssets),
      reachableSourceFileNames: cssAssetStringPropertyValues(reachableAssets, 'sourceFileName'),
      route: routeSnapshot.route,
    },
    'Compiler CSS route accounting result',
  );
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
  deliveredAssets?: readonly ComponentCssAsset[],
): CssRouteDeliveryGateResult {
  const manifestSnapshot = snapshotCssAssetManifest(manifest, 'Compiler CSS route delivery gate');
  const routeSnapshot = snapshotCssRouteSplitTarget(
    route,
    'Compiler CSS route delivery gate target',
  );
  const deliveredSnapshot =
    deliveredAssets === undefined
      ? defaultDeliveredRouteCssAssets(manifestSnapshot, routeSnapshot)
      : snapshotCssAssetList(deliveredAssets, 'Compiler CSS delivered route assets');
  let reachableAssets = selectRouteCssAssets(manifestSnapshot, routeSnapshot);
  if (manifestSnapshot.chunks) {
    const withBase: ComponentCssAsset[] = [];
    appendCssAssets(withBase, manifestSnapshot.chunks.base, 'Compiler CSS reachable base chunks');
    appendCssAssets(withBase, reachableAssets, 'Compiler CSS reachable route assets');
    reachableAssets = dedupeComponentCssAssets(withBase);
  }
  const reachableUsages = compilerCreateSet<string>();
  addCssAssetUsageKeys(reachableUsages, reachableAssets, 'Compiler CSS reachable route usages');
  const diagnostics: CssRouteOvershipDiagnostic[] = [];

  const deliveredCount = compilerArrayLength(
    deliveredSnapshot,
    'Compiler CSS delivered route assets',
  );
  for (let assetIndex = 0; assetIndex < deliveredCount; assetIndex += 1) {
    const asset = compilerOwnDataValue(
      deliveredSnapshot,
      assetIndex,
      'Compiler CSS delivered route assets',
    ) as ComponentCssAsset;
    const usages = asset.styleRuleUsages ?? [];
    const usageCount = compilerArrayLength(usages, 'Compiler CSS delivered route usages');
    for (let usageIndex = 0; usageIndex < usageCount; usageIndex += 1) {
      const usage = compilerOwnDataValue(
        usages,
        usageIndex,
        'Compiler CSS delivered route usages',
      ) as StyleRuleUsage;
      if (compilerSetHas(reachableUsages, styleRuleUsageKey(usage))) continue;
      compilerArrayAppend(
        diagnostics,
        {
          className: usage.className,
          href: asset.href,
          moduleFileName: usage.moduleFileName,
          route: routeSnapshot.route,
          source: usage.source,
          styleRef: usage.styleRef,
        },
        'Compiler CSS route overship diagnostics',
      );
    }
  }

  return compilerSnapshotJsonValue(
    {
      accounting: cssRouteByteAccounting(manifestSnapshot, routeSnapshot),
      diagnostics,
    },
    'Compiler CSS route delivery gate result',
  );
}

function computeCssSplitChunks(
  manifest: Pick<CssAssetManifest, 'byFileName' | 'stylesheets'>,
  options: CssAssetManifestOptions,
): CssSplitChunks {
  const split = options.split;
  if (split === undefined) {
    throw new TypeError('Compiler CSS split computation requires snapshotted split options.');
  }
  const routeSelections = compilerCreateMap<string, ComponentCssAsset[]>();
  const splitRoutes = split.routes;
  if (splitRoutes !== undefined) {
    const routeCount = compilerArrayLength(splitRoutes, 'Compiler CSS split routes');
    for (let index = 0; index < routeCount; index += 1) {
      const route = compilerOwnDataValue(
        splitRoutes,
        index,
        'Compiler CSS split routes',
      ) as CssRouteSplitTarget;
      compilerMapSet(routeSelections, route.route, selectRouteCssAssets(manifest, route));
    }
  }

  const sharedAssets =
    split.baseSourceFileNames === undefined
      ? sharedRouteCssAssets(routeSelections)
      : selectCssAssets(manifest as CssAssetManifest, split.baseSourceFileNames);
  const selectedRouteNames = compilerCreateSet<string>();
  let hasSelectedRouteAssets = false;
  compilerMapForEach(routeSelections, (assets) => {
    const count = compilerArrayLength(assets, 'Compiler CSS selected route assets');
    for (let index = 0; index < count; index += 1) {
      const asset = compilerOwnDataValue(
        assets,
        index,
        'Compiler CSS selected route assets',
      ) as ComponentCssAsset;
      compilerSetAdd(selectedRouteNames, asset.sourceFileName);
      hasSelectedRouteAssets = true;
    }
  });
  const explicitBaseNames = compilerCreateSet<string>();
  addCssAssetFileNames(explicitBaseNames, sharedAssets, 'Compiler CSS explicit base assets');
  const unownedAssets: ComponentCssAsset[] = [];
  if (hasSelectedRouteAssets) {
    const stylesheetCount = compilerArrayLength(
      manifest.stylesheets,
      'Compiler CSS manifest stylesheets',
    );
    for (let index = 0; index < stylesheetCount; index += 1) {
      const asset = compilerOwnDataValue(
        manifest.stylesheets,
        index,
        'Compiler CSS manifest stylesheets',
      ) as ComponentCssAsset;
      if (
        !compilerSetHas(selectedRouteNames, asset.sourceFileName) &&
        !compilerSetHas(explicitBaseNames, asset.sourceFileName)
      ) {
        compilerArrayAppend(unownedAssets, asset, 'Compiler CSS unowned assets');
      }
    }
  }
  const baseCandidates: ComponentCssAsset[] = [];
  appendCssAssets(baseCandidates, sharedAssets, 'Compiler CSS base candidates');
  appendCssAssets(baseCandidates, unownedAssets, 'Compiler CSS base candidates');
  const baseAssets = dedupeComponentCssAssets(baseCandidates);
  const baseNames = compilerCreateSet<string>();
  addCssAssetFileNames(baseNames, baseAssets, 'Compiler CSS base assets');
  const base: ComponentCssAsset[] = [];
  if (compilerArrayLength(baseAssets, 'Compiler CSS base assets') > 0) {
    compilerArrayAppend(
      base,
      chunkAsset('base.css', 'css-base', fragmentTargetsForAssets(baseAssets), baseAssets, options),
      'Compiler CSS base chunks',
    );
  }

  const routes = compilerCreateNullRecord<ComponentCssAsset[]>();
  compilerMapForEach(routeSelections, (assets, route) => {
    const routeAssets = cssAssetsWithoutFileNames(assets, baseNames);
    const chunks: ComponentCssAsset[] = [];
    if (compilerArrayLength(routeAssets, `Compiler CSS route ${route} assets`) > 0) {
      compilerArrayAppend(
        chunks,
        chunkAsset(
          `routes/${routeChunkName(route)}.css`,
          `route:${route}`,
          fragmentTargetsForAssets(routeAssets),
          routeAssets,
          options,
        ),
        `Compiler CSS route ${route} chunks`,
      );
    }
    compilerDefineOwnDataProperty(routes, route, chunks);
  });

  const fragments = compilerCreateNullRecord<ComponentCssAsset[]>();
  const fragmentTargets = fragmentTargetsForAssets(manifest.stylesheets);
  const targetCount = compilerArrayLength(fragmentTargets, 'Compiler CSS fragment targets');
  for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
    const target = compilerOwnDataValue(
      fragmentTargets,
      targetIndex,
      'Compiler CSS fragment targets',
    ) as string;
    const fragmentAssets = cssAssetsForFragmentTarget(manifest.stylesheets, target, baseNames);
    const chunks: ComponentCssAsset[] = [];
    if (compilerArrayLength(fragmentAssets, `Compiler CSS fragment ${target} assets`) > 0) {
      const targetList: string[] = [];
      compilerArrayAppend(targetList, target, 'Compiler CSS fragment target list');
      compilerArrayAppend(
        chunks,
        chunkAsset(
          `fragments/${routeChunkName(target)}.css`,
          `fragment:${target}`,
          targetList,
          fragmentAssets,
          options,
        ),
        `Compiler CSS fragment ${target} chunks`,
      );
    }
    compilerDefineOwnDataProperty(fragments, target, chunks);
  }

  return { base, fragments, routes };
}

function defaultDeliveredRouteCssAssets(
  manifest: CssAssetManifest,
  route: CssRouteSplitTarget,
): ComponentCssAsset[] {
  if (!manifest.chunks) return selectRouteCssAssets(manifest, route);
  const assets: ComponentCssAsset[] = [];
  appendCssAssets(assets, manifest.chunks.base, 'Compiler delivered route CSS');
  const routeAssets = compilerOwnDataValue(
    manifest.chunks.routes,
    route.route,
    'Compiler CSS route chunks',
  ) as readonly ComponentCssAsset[] | undefined;
  if (routeAssets !== undefined) {
    appendCssAssets(assets, routeAssets, 'Compiler delivered route CSS');
  }
  return dedupeComponentCssAssets(assets);
}

function styleRuleUsageKey(usage: StyleRuleUsage): string {
  return `${usage.moduleFileName}\0${usage.styleRef}\0${usage.source}\0${usage.className}`;
}

function selectRouteCssAssets(
  manifest: Pick<CssAssetManifest, 'byFileName' | 'stylesheets'>,
  route: CssRouteSplitTarget,
): ComponentCssAsset[] {
  const selected: ComponentCssAsset[] = [];
  if (route.sourceFileNames !== undefined) {
    appendCssAssets(
      selected,
      selectCssAssets(manifest as CssAssetManifest, route.sourceFileNames),
      'Compiler CSS route selection',
    );
  }
  if (route.hrefs !== undefined) {
    appendCssAssets(
      selected,
      selectCssAssetsByHref(manifest.stylesheets, route.hrefs),
      'Compiler CSS route selection',
    );
  }
  if (route.stylesheets !== undefined) {
    appendCssAssets(
      selected,
      selectCssAssetsByHref(manifest.stylesheets, route.stylesheets),
      'Compiler CSS route selection',
    );
  }
  if (route.fragmentTargets !== undefined) {
    appendCssAssets(
      selected,
      selectCssAssetsByFragmentTarget(manifest.stylesheets, route.fragmentTargets),
      'Compiler CSS route selection',
    );
  }
  return dedupeComponentCssAssets(selected);
}

function selectCssAssetsByHref(
  assets: readonly ComponentCssAsset[],
  hrefs: readonly string[],
): ComponentCssAsset[] {
  const wanted = compilerCreateSet<string>();
  addCssStrings(wanted, hrefs, 'Compiler CSS href selection');
  const selected: ComponentCssAsset[] = [];
  const count = compilerArrayLength(assets, 'Compiler CSS href candidates');
  for (let index = 0; index < count; index += 1) {
    const asset = compilerOwnDataValue(
      assets,
      index,
      'Compiler CSS href candidates',
    ) as ComponentCssAsset;
    if (compilerSetHas(wanted, asset.href)) {
      compilerArrayAppend(selected, asset, 'Compiler CSS href-selected assets');
    }
  }
  return selected;
}

function selectCssAssetsByFragmentTarget(
  assets: readonly ComponentCssAsset[],
  fragmentTargets: readonly string[],
): ComponentCssAsset[] {
  const wanted = compilerCreateSet<string>();
  addCssStrings(wanted, fragmentTargets, 'Compiler CSS fragment selection');
  const selected: ComponentCssAsset[] = [];
  const assetCount = compilerArrayLength(assets, 'Compiler CSS fragment candidates');
  for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
    const asset = compilerOwnDataValue(
      assets,
      assetIndex,
      'Compiler CSS fragment candidates',
    ) as ComponentCssAsset;
    const targetCount = compilerArrayLength(asset.fragmentTargets, 'Compiler CSS asset fragments');
    let matches = false;
    for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
      const target = compilerOwnDataValue(
        asset.fragmentTargets,
        targetIndex,
        'Compiler CSS asset fragments',
      ) as string;
      if (compilerSetHas(wanted, target)) {
        matches = true;
        break;
      }
    }
    if (matches) compilerArrayAppend(selected, asset, 'Compiler CSS fragment-selected assets');
  }
  return selected;
}

function sharedRouteCssAssets(
  routeSelections: ReadonlyMap<string, readonly ComponentCssAsset[]>,
): ComponentCssAsset[] {
  const counts = compilerCreateMap<string, { asset: ComponentCssAsset; count: number }>();
  compilerMapForEach(routeSelections, (assets) => {
    const seenInRoute = compilerCreateSet<string>();
    const count = compilerArrayLength(assets, 'Compiler CSS shared-route assets');
    for (let index = 0; index < count; index += 1) {
      const asset = compilerOwnDataValue(
        assets,
        index,
        'Compiler CSS shared-route assets',
      ) as ComponentCssAsset;
      if (compilerSetHas(seenInRoute, asset.sourceFileName)) continue;
      compilerSetAdd(seenInRoute, asset.sourceFileName);
      const existing = compilerMapGet(counts, asset.sourceFileName);
      compilerMapSet(counts, asset.sourceFileName, {
        asset,
        count: (existing?.count ?? 0) + 1,
      });
    }
  });
  const shared: ComponentCssAsset[] = [];
  compilerMapForEach(counts, (entry) => {
    if (entry.count > 1) compilerArrayAppend(shared, entry.asset, 'Compiler shared CSS assets');
  });
  return shared;
}

function fragmentTargetsForAssets(assets: readonly ComponentCssAsset[]): string[] {
  const targets: string[] = [];
  const assetCount = compilerArrayLength(assets, 'Compiler CSS fragment target assets');
  for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
    const asset = compilerOwnDataValue(
      assets,
      assetIndex,
      'Compiler CSS fragment target assets',
    ) as ComponentCssAsset;
    const targetCount = compilerArrayLength(asset.fragmentTargets, 'Compiler CSS fragment targets');
    for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
      const target = compilerOwnDataValue(
        asset.fragmentTargets,
        targetIndex,
        'Compiler CSS fragment targets',
      );
      if (typeof target !== 'string')
        throw new TypeError('Compiler CSS fragment target must be a string.');
      compilerArrayAppend(targets, target, 'Compiler CSS fragment targets');
    }
  }
  return uniqueSorted(targets);
}

function chunkAsset(
  fileName: string,
  componentName: string,
  fragmentTargets: readonly string[],
  assets: readonly ComponentCssAsset[],
  options: CssAssetManifestOptions,
): ComponentCssAsset {
  validateCssSourceFileName(fileName, 'Compiler CSS chunk');
  const criticalCssInputs: string[] = [];
  const styleRuleUsageInputs: StyleRuleUsage[] = [];
  const assetCount = compilerArrayLength(assets, 'Compiler CSS chunk assets');
  for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
    const asset = compilerOwnDataValue(
      assets,
      assetIndex,
      'Compiler CSS chunk assets',
    ) as ComponentCssAsset;
    if (asset.criticalCss !== undefined) {
      compilerArrayAppend(criticalCssInputs, asset.criticalCss, 'Compiler CSS chunk source');
    }
    if (asset.styleRuleUsages !== undefined) {
      const usageCount = compilerArrayLength(
        asset.styleRuleUsages,
        'Compiler CSS chunk style usages',
      );
      for (let usageIndex = 0; usageIndex < usageCount; usageIndex += 1) {
        compilerArrayAppend(
          styleRuleUsageInputs,
          compilerOwnDataValue(
            asset.styleRuleUsages,
            usageIndex,
            'Compiler CSS chunk style usages',
          ) as StyleRuleUsage,
          'Compiler CSS chunk style usages',
        );
      }
    }
  }
  const criticalCss = dedupeCss(criticalCssInputs);
  const styleRuleUsages = dedupeStyleRuleUsages(styleRuleUsageInputs);
  const hashedFileName = hashedChunkFileName(fileName, criticalCss);
  validateCssSourceFileName(hashedFileName, 'Compiler CSS derived chunk');
  const chunk = componentCssAssetForFile(
    hashedFileName,
    componentName,
    fragmentTargets,
    options,
    criticalCss,
  );
  if (compilerArrayLength(styleRuleUsages, 'Compiler CSS chunk style usages') > 0) {
    compilerDefineOwnDataProperty(chunk, 'styleRuleUsages', styleRuleUsages);
  }
  return chunk;
}

function cssAssetCriticalBytes(assets: readonly ComponentCssAsset[]): number {
  let total = 0;
  const count = compilerArrayLength(assets, 'Compiler CSS byte-accounting assets');
  for (let index = 0; index < count; index += 1) {
    const asset = compilerOwnDataValue(
      assets,
      index,
      'Compiler CSS byte-accounting assets',
    ) as ComponentCssAsset;
    total += compilerUtf8ByteLength(asset.criticalCss ?? '');
  }
  return total;
}

function cssAssetStringPropertyValues(
  assets: readonly ComponentCssAsset[],
  property: 'href' | 'sourceFileName',
): string[] {
  const values: string[] = [];
  const count = compilerArrayLength(assets, `Compiler CSS asset ${property} values`);
  for (let index = 0; index < count; index += 1) {
    const asset = compilerOwnDataValue(
      assets,
      index,
      `Compiler CSS asset ${property} values`,
    ) as ComponentCssAsset;
    const value = compilerOwnDataValue(asset, property, `Compiler CSS asset ${property}`);
    if (typeof value !== 'string')
      throw new TypeError(`Compiler CSS asset ${property} must be a string.`);
    compilerArrayAppend(values, value, `Compiler CSS asset ${property} values`);
  }
  return values;
}

function addCssAssetUsageKeys(
  target: Set<string>,
  assets: readonly ComponentCssAsset[],
  label: string,
): void {
  const assetCount = compilerArrayLength(assets, label);
  for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
    const asset = compilerOwnDataValue(assets, assetIndex, label) as ComponentCssAsset;
    const usages = asset.styleRuleUsages ?? [];
    const usageCount = compilerArrayLength(usages, `${label} style usages`);
    for (let usageIndex = 0; usageIndex < usageCount; usageIndex += 1) {
      const usage = compilerOwnDataValue(
        usages,
        usageIndex,
        `${label} style usages`,
      ) as StyleRuleUsage;
      compilerSetAdd(target, styleRuleUsageKey(usage));
    }
  }
}

function hashedChunkFileName(fileName: string, css: string): string {
  // Immutable CSS asset identity is security-relevant deployment authority. Keep the complete
  // collision-resistant source digest; a 32-bit prefix admits practical chosen collisions.
  const hash = compilerSha256Hex(css);
  const withHashedExtension = compilerRegExpReplace(
    /(\.[^./]+)$/u,
    fileName,
    (extension) => `-${hash}${extension}`,
  );
  return withHashedExtension === fileName ? `${fileName}-${hash}` : withHashedExtension;
}

function allManifestAssets(manifest: CssAssetManifest): ComponentCssAsset[] {
  const assets: ComponentCssAsset[] = [];
  appendCssAssets(assets, manifest.stylesheets, 'Compiler manifest assets');
  if (!manifest.chunks) return assets;
  appendCssAssets(assets, manifest.chunks.base, 'Compiler manifest assets');
  appendCssAssetRecordValues(assets, manifest.chunks.routes, 'Compiler CSS route chunks');
  appendCssAssetRecordValues(assets, manifest.chunks.fragments, 'Compiler CSS fragment chunks');
  return dedupeComponentCssAssets(assets);
}

function dedupeComponentCssAssets(assets: readonly ComponentCssAsset[]): ComponentCssAsset[] {
  const seen = compilerCreateSet<string>();
  const deduped: ComponentCssAsset[] = [];
  const count = compilerArrayLength(assets, 'Compiler CSS assets to dedupe');
  for (let index = 0; index < count; index += 1) {
    const asset = compilerOwnDataValue(
      assets,
      index,
      'Compiler CSS assets to dedupe',
    ) as ComponentCssAsset;
    if (compilerSetHas(seen, asset.sourceFileName)) continue;
    compilerSetAdd(seen, asset.sourceFileName);
    compilerArrayAppend(deduped, asset, 'Compiler deduplicated CSS assets');
  }
  return deduped;
}

function dedupeStyleRuleUsages(usages: readonly StyleRuleUsage[]): StyleRuleUsage[] {
  const seen = compilerCreateSet<string>();
  const deduped: StyleRuleUsage[] = [];
  const count = compilerArrayLength(usages, 'Compiler CSS style usages to dedupe');
  for (let index = 0; index < count; index += 1) {
    const usage = compilerOwnDataValue(
      usages,
      index,
      'Compiler CSS style usages to dedupe',
    ) as StyleRuleUsage;
    const key = `${usage.className}\0${usage.moduleFileName}\0${usage.source}\0${usage.styleRef}`;
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(deduped, usage, 'Compiler deduplicated CSS style usages');
  }
  return deduped;
}

function routeChunkName(value: string): string {
  const withoutLeadingSlash = compilerRegExpReplace(/^\//, value, '');
  const withoutWildcards = compilerRegExpReplace(/[:*]+/g, withoutLeadingSlash, '');
  const normalized = compilerRegExpReplace(/[^A-Za-z0-9._-]+/g, withoutWildcards, '-');
  return compilerRegExpReplace(/^-+|-+$/g, normalized, '') || 'index';
}

function appendCssAssets(
  target: ComponentCssAsset[],
  values: readonly ComponentCssAsset[],
  label: string,
): void {
  const count = compilerArrayLength(values, label);
  for (let index = 0; index < count; index += 1) {
    compilerArrayAppend(
      target,
      compilerOwnDataValue(values, index, label) as ComponentCssAsset,
      label,
    );
  }
}

function addCssStrings(target: Set<string>, values: readonly string[], label: string): void {
  const count = compilerArrayLength(values, label);
  for (let index = 0; index < count; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (typeof value !== 'string') throw new TypeError(`${label}[${index}] must be a string.`);
    compilerSetAdd(target, value);
  }
}

function addCssAssetFileNames(
  target: Set<string>,
  assets: readonly ComponentCssAsset[],
  label: string,
): void {
  const count = compilerArrayLength(assets, label);
  for (let index = 0; index < count; index += 1) {
    const asset = compilerOwnDataValue(assets, index, label) as ComponentCssAsset;
    compilerSetAdd(target, asset.sourceFileName);
  }
}

function cssAssetsWithoutFileNames(
  assets: readonly ComponentCssAsset[],
  excluded: ReadonlySet<string>,
): ComponentCssAsset[] {
  const selected: ComponentCssAsset[] = [];
  const count = compilerArrayLength(assets, 'Compiler CSS assets to exclude');
  for (let index = 0; index < count; index += 1) {
    const asset = compilerOwnDataValue(
      assets,
      index,
      'Compiler CSS assets to exclude',
    ) as ComponentCssAsset;
    if (!compilerSetHas(excluded, asset.sourceFileName)) {
      compilerArrayAppend(selected, asset, 'Compiler CSS assets after exclusion');
    }
  }
  return selected;
}

function cssAssetsForFragmentTarget(
  assets: readonly ComponentCssAsset[],
  wantedTarget: string,
  excludedFileNames: ReadonlySet<string>,
): ComponentCssAsset[] {
  const selected: ComponentCssAsset[] = [];
  const assetCount = compilerArrayLength(assets, 'Compiler CSS fragment chunk candidates');
  for (let assetIndex = 0; assetIndex < assetCount; assetIndex += 1) {
    const asset = compilerOwnDataValue(
      assets,
      assetIndex,
      'Compiler CSS fragment chunk candidates',
    ) as ComponentCssAsset;
    if (compilerSetHas(excludedFileNames, asset.sourceFileName)) continue;
    const targetCount = compilerArrayLength(asset.fragmentTargets, 'Compiler CSS asset fragments');
    for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
      if (
        compilerOwnDataValue(asset.fragmentTargets, targetIndex, 'Compiler CSS asset fragments') ===
        wantedTarget
      ) {
        compilerArrayAppend(selected, asset, 'Compiler CSS fragment chunk assets');
        break;
      }
    }
  }
  return selected;
}

function appendCssAssetRecordValues(
  target: ComponentCssAsset[],
  record: Readonly<Record<string, readonly ComponentCssAsset[]>>,
  label: string,
): void {
  const keys = compilerObjectKeys(record);
  const count = compilerArrayLength(keys, `${label} keys`);
  for (let index = 0; index < count; index += 1) {
    const key = compilerOwnDataValue(keys, index, `${label} keys`) as string;
    const assets = compilerOwnDataValue(record, key, label) as readonly ComponentCssAsset[];
    appendCssAssets(target, assets, label);
  }
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
  return compilerRegExpReplace(/^\.?\//, fileName, '');
}

function formatFallbackCss(css: string): string {
  return compilerStringTrimEnd(compilerRegExpReplace(/}\s*/g, css, '}\n'));
}

function cspSha256(value: string): string {
  return `sha256-${compilerSha256Base64(value)}`;
}

function escapeStyleText(value: string): string {
  return compilerRegExpReplace(/<\/style/gi, value, '<\\/style');
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
        declarationBuffer += compilerStringSlice(css, index);
      } else {
        output += compilerStringSlice(css, index);
      }
      break;
    }

    const betweenRules = compilerStringSlice(css, index, rule.selectorStart);
    if (parentSelectors) {
      declarationBuffer += betweenRules;
    } else {
      output += betweenRules;
    }

    let rawSelector = compilerStringSlice(css, rule.selectorStart, rule.bodyStart);
    if (parentSelectors) {
      const declarationBoundary = compilerStringLastIndexOf(rawSelector, ';');
      if (declarationBoundary !== -1) {
        declarationBuffer += compilerStringSlice(rawSelector, 0, declarationBoundary + 1);
        rawSelector = compilerStringSlice(rawSelector, declarationBoundary + 1);
      }
    }
    const selector = compilerStringTrim(rawSelector);
    const body = compilerStringSlice(css, rule.bodyStart + 1, rule.bodyEnd);
    if (
      compilerStringStartsWith(selector, '@media') ||
      compilerStringStartsWith(selector, '@supports')
    ) {
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
    } else if (compilerStringStartsWith(selector, '@')) {
      output += flushPrefixedDeclarationRule(
        hostSelector,
        nestedExclusion,
        parentSelectors,
        declarationBuffer,
      );
      declarationBuffer = '';
      output += compilerStringSlice(css, rule.selectorStart, rule.bodyEnd + 1);
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
  if (!selectors || compilerStringTrim(declarations).length === 0) return '';

  const prefixedSelectors: string[] = [];
  const selectorCount = compilerArrayLength(selectors, 'Compiler CSS prefixed selectors');
  for (let index = 0; index < selectorCount; index += 1) {
    const selector = compilerOwnDataValue(selectors, index, 'Compiler CSS prefixed selectors');
    if (typeof selector !== 'string')
      throw new TypeError('Compiler CSS selector must be a string.');
    compilerArrayAppend(
      prefixedSelectors,
      `${hostSelector} ${selector}${nestedExclusion}`,
      'Compiler CSS prefixed selectors',
    );
  }
  const prefixed = compilerArrayJoin(prefixedSelectors, ', ');

  return `${prefixed} {${declarations}}`;
}

function resolveNestedSelectors(
  selector: string,
  parentSelectors: readonly string[] | undefined,
): string[] {
  const selectors = splitCssSelectorList(selector);
  if (!parentSelectors) return selectors;

  const resolved: string[] = [];
  const parentCount = compilerArrayLength(parentSelectors, 'Compiler CSS parent selectors');
  const selectorCount = compilerArrayLength(selectors, 'Compiler CSS nested selectors');
  for (let parentIndex = 0; parentIndex < parentCount; parentIndex += 1) {
    const parentSelector = compilerOwnDataValue(
      parentSelectors,
      parentIndex,
      'Compiler CSS parent selectors',
    ) as string;
    for (let selectorIndex = 0; selectorIndex < selectorCount; selectorIndex += 1) {
      const nestedSelector = compilerOwnDataValue(
        selectors,
        selectorIndex,
        'Compiler CSS nested selectors',
      ) as string;
      compilerArrayAppend(
        resolved,
        compilerStringIncludes(nestedSelector, '&')
          ? compilerStringReplaceAll(nestedSelector, '&', parentSelector)
          : `${parentSelector} ${nestedSelector}`,
        'Compiler CSS resolved nested selectors',
      );
    }
  }
  return resolved;
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
      const candidate = compilerStringTrim(compilerStringSlice(selector, start, index));
      if (candidate !== '') {
        compilerArrayAppend(selectors, candidate, 'Compiler CSS selector list');
      }
      start = index + 1;
    }
  }

  const finalSelector = compilerStringTrim(compilerStringSlice(selector, start));
  if (finalSelector !== '') {
    compilerArrayAppend(selectors, finalSelector, 'Compiler CSS selector list');
  }
  return selectors;
}

function nextCssRule(
  source: string,
  start: number,
): { bodyEnd: number; bodyStart: number; selectorStart: number } | null {
  const bodyStart = compilerStringIndexOf(source, '{', start);
  if (bodyStart === -1) return null;

  const selectorStart = skipCssWhitespaceAfterBoundary(source, start);
  const bodyEnd = findMatchingToken(source, bodyStart, '{', '}');
  if (bodyEnd === -1) return null;

  return { bodyEnd, bodyStart, selectorStart };
}

function skipCssWhitespaceAfterBoundary(source: string, start: number): number {
  let index = start;
  while (index < source.length && compilerRegExpTest(/^\s$/, source[index] ?? '')) index += 1;
  return index;
}

function scopeLimitSelectors(nestedHostSelectors: readonly string[]): string {
  const selectors: string[] = [];
  const count = compilerArrayLength(nestedHostSelectors, 'Compiler CSS scope-limit selectors');
  for (let index = 0; index < count; index += 1) {
    const selector = compilerOwnDataValue(
      nestedHostSelectors,
      index,
      'Compiler CSS scope-limit selectors',
    );
    if (typeof selector !== 'string')
      throw new TypeError('Compiler CSS selector must be a string.');
    compilerArrayAppend(selectors, `:scope ${selector}`, 'Compiler CSS scope-limit selectors');
  }
  return compilerArrayJoin(selectors, ', ');
}

function selectorExclusion(nestedHostSelectors: readonly string[]): string {
  const exclusions: string[] = [];
  const count = compilerArrayLength(nestedHostSelectors, 'Compiler CSS exclusion selectors');
  for (let index = 0; index < count; index += 1) {
    const selector = compilerOwnDataValue(
      nestedHostSelectors,
      index,
      'Compiler CSS exclusion selectors',
    );
    if (typeof selector !== 'string')
      throw new TypeError('Compiler CSS selector must be a string.');
    compilerArrayAppend(exclusions, `:not(${selector})`, 'Compiler CSS exclusion selectors');
    compilerArrayAppend(exclusions, `:not(${selector} *)`, 'Compiler CSS exclusion selectors');
  }
  return compilerArrayJoin(exclusions, '');
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
