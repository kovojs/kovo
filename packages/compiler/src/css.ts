import { findMatchingToken } from './scan/text.js';
import {
  componentOptionStaticTemplateValue,
  componentRenderHostElement,
  type ComponentModuleModel,
} from './scan/parse.js';
import { cssIrHeader } from './ir.js';
import { escapeAttribute, indent } from './shared.js';

/**
 * @internal A scoped-CSS asset reference produced by the compiler (href, optional critical
 * CSS, preload hint). Lowered-IR CSS-pipeline shape; in-repo use only (SPEC.md §5.2).
 */
export interface CssAsset {
  criticalCss?: string;
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
  stylesheets: readonly ComponentCssAsset[];
}

/** @internal Options for {@link collectCssAssetManifest} (asset base href + preload hint). */
export interface CssAssetManifestOptions {
  baseHref?: string;
  preload?: boolean;
}

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
      byFileName[cssAsset.sourceFileName] = asset;
      stylesheets.push(asset);
    }
  }

  return { byFileName, stylesheets };
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

function componentHostSelector(domComponentName: string, model: ComponentModuleModel): string {
  const hostName = domComponentName;
  const renderedHost = componentRenderHostElement(model)?.tag ?? null;

  return renderedHost === hostName ? hostName : `[kovo-c="${escapeAttribute(hostName)}"]`;
}
