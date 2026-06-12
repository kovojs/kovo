import { findMatchingToken, findStringEnd } from './scan/text.js';
import { firstComponentModel, type ComponentModuleModel } from './scan/parse.js';
import { cssIrHeader } from './ir.js';
import { escapeAttribute, indent, kebabCase } from './shared.js';

export interface CssAsset {
  criticalCss?: string;
  href: string;
  preload?: boolean;
  sourceFileName: string;
}

export interface ComponentCssAsset extends CssAsset {
  componentName: string;
  fragmentTargets: readonly string[];
}

export interface CssAssetManifest {
  byFileName: Readonly<Record<string, ComponentCssAsset>>;
  stylesheets: readonly ComponentCssAsset[];
}

export interface CssAssetManifestOptions {
  baseHref?: string;
  preload?: boolean;
}

export interface ScopedCssResult {
  fallback: string;
  scoped: string;
}

export interface ScopeComponentCssOptions {
  nestedHostSelectors?: readonly string[];
}

interface CompileCssAssetSource {
  cssAssets: readonly ComponentCssAsset[];
}

export function scopeComponentCss(
  hostSelector: string,
  css: string,
  options: ScopeComponentCssOptions = {},
): ScopedCssResult {
  const trimmed = css.trim();
  const nestedHostSelectors = options.nestedHostSelectors ?? ['[fw-c]'];

  return {
    fallback: prefixCssSelectors(hostSelector, trimmed, nestedHostSelectors),
    scoped: `@scope (${hostSelector}) to (${scopeLimitSelectors(nestedHostSelectors)}) {\n${indent(trimmed)}\n}\n`,
  };
}

export function dedupeCss(chunks: readonly string[]): string {
  return [...new Set(chunks.map((chunk) => chunk.trim()).filter(Boolean))].join('\n\n');
}

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

export function emitCssModule(
  source: string,
  componentName: string,
  model: ComponentModuleModel,
): string | null {
  const css = extractStaticComponentCss(model);
  if (!css) return null;

  const scopedCss = scopeComponentCss(componentHostSelector(source, componentName, model), css);

  return `${cssIrHeader}\n/* @jiso-scope-fallback */\n${formatFallbackCss(scopedCss.fallback)}\n\n${scopedCss.scoped}`;
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
): string {
  let output = '';
  let index = 0;

  while (index < css.length) {
    const rule = nextCssRule(css, index);
    if (!rule) {
      output += css.slice(index);
      break;
    }

    output += css.slice(index, rule.selectorStart);

    const selector = css.slice(rule.selectorStart, rule.bodyStart).trim();
    const body = css.slice(rule.bodyStart + 1, rule.bodyEnd);
    if (selector.startsWith('@media') || selector.startsWith('@supports')) {
      output += `${selector} {${prefixCssBlockSelectors(hostSelector, body, nestedExclusion)}}`;
    } else if (selector.startsWith('@')) {
      output += css.slice(rule.selectorStart, rule.bodyEnd + 1);
    } else {
      const prefixed = selector
        .split(',')
        .map((part) => `${hostSelector} ${part.trim()}${nestedExclusion}`)
        .join(', ');
      output += `${prefixed} {${body}}`;
    }

    index = rule.bodyEnd + 1;
  }

  return output;
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
  const cssOption = firstComponentModel(model)?.options.find(
    (option) => option.key === 'css' || option.key === 'styles',
  );
  if (cssOption) return extractStaticCssTemplate(cssOption.value);

  return null;
}

function extractStaticCssTemplate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('`')) return null;

  const templateEnd = findStringEnd(trimmed, 0, '`');
  if (templateEnd === -1) return null;

  const css = trimmed.slice(1, templateEnd);
  return css.includes('${') ? null : css;
}

function componentHostSelector(
  source: string,
  componentName: string,
  model: ComponentModuleModel,
): string {
  const component = firstComponentModel(model);
  const explicitName = component?.explicitName;
  const hostName = explicitName ?? kebabCase(componentName);
  const renderedHost = component?.renderHost
    ? openingTagName(source.slice(component.renderHost.start, component.renderHost.end))
    : null;

  return renderedHost === hostName ? hostName : `[fw-c="${escapeAttribute(hostName)}"]`;
}

function openingTagName(source: string): string | null {
  return /^<(?<name>[A-Za-z][\w:-]*)/.exec(source)?.groups?.name ?? null;
}
