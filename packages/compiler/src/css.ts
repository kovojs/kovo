import { findMatchingToken, findStringEnd } from './scan/text.js';
import { escapeAttribute, indent, kebabCase } from './shared.js';

const cssIrHeader = '/* @jiso-ir */';

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

export function emitCssModule(source: string, componentName: string): string | null {
  const css = extractStaticComponentCss(source);
  if (!css) return null;

  const scopedCss = scopeComponentCss(componentHostSelector(source, componentName), css);

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

function extractStaticComponentCss(source: string): string | null {
  const match = /\b(?:css|styles)\s*:\s*`/g.exec(source);
  if (!match) return null;

  const templateStart = match.index + match[0].lastIndexOf('`');
  const templateEnd = findStringEnd(source, templateStart, '`');
  if (templateEnd === -1) return null;

  const css = source.slice(templateStart + 1, templateEnd);
  return css.includes('${') ? null : css;
}

function componentHostSelector(source: string, componentName: string): string {
  const explicitName = /component\(\s*['"]([^'"]+)['"]/.exec(source)?.[1];
  const hostName = explicitName ?? kebabCase(componentName);
  const renderedHost = firstRenderedTagName(source);

  return renderedHost === hostName ? hostName : `[fw-c="${escapeAttribute(hostName)}"]`;
}

function firstRenderedTagName(source: string): string | null {
  const tag = findFirstRenderedOpeningTag(source);
  if (!tag) return null;

  return (
    /^<(?<name>[A-Za-z][\w:-]*)/.exec(source.slice(tag.start, tag.end + 1))?.groups?.name ?? null
  );
}

function findFirstRenderedOpeningTag(source: string): { end: number; start: number } | null {
  const renderMatch = /\brender\s*:/.exec(source);
  if (!renderMatch) return null;

  const tagMatch = /<[A-Za-z][\w:-]*\b/.exec(source.slice(renderMatch.index));
  if (!tagMatch) return null;

  const tagStart = renderMatch.index + tagMatch.index;
  const tagEnd = findOpeningTagEnd(source, tagStart);
  if (tagEnd === -1) return null;

  return { end: tagEnd, start: tagStart };
}

function findOpeningTagEnd(source: string, start: number): number {
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length : end;
      continue;
    }

    if (char === '{') {
      const end = findMatchingToken(source, index, '{', '}');
      index = end === -1 ? source.length : end;
      continue;
    }

    if (char === '>') return index;
  }

  return -1;
}
