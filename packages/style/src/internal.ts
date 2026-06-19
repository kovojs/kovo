import upstreamGetPriority from './property-priorities.js';

// Repo-internal style ABI re-exports. These symbols are not part of the
// app-facing public surface; the compiler and conformance tests consume them
// through `@kovojs/style/internal` (SPEC.md §13.1, rules/api-surface.md).
export { createAtomicStyles, defineConsts, raw } from './engine.js';
export type { AtomicCssResult, Consts } from './engine.js';
export { defineThemeFromBase, themeFromSeed } from './theme.js';
export type {
  DefineThemeFromBaseOptions,
  ThemeComponentTokensInput,
  ThemeSystemOverrides,
} from './theme.js';

/** @internal Priority bucket compatible with StyleX's shorthand-before-longhand cascade model. */
export function getPriority(property: string): number {
  const cssProperty = property.startsWith('--') ? property : toKebabCase(property);
  return upstreamGetPriority(cssProperty);
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/**
 * @internal CSS properties that take a bare number (no length unit). Every other
 * property `@kovojs/style` emits as a bare number (e.g. `padding:8`, `height:36`)
 * is a length and needs `px` to be valid CSS — StyleX applies the same rule. The
 * compiler's `package-css` extraction imports this same set so the runtime emit
 * and the served stylesheet stay in lockstep.
 */
export const UNITLESS_CSS_PROPERTIES: ReadonlySet<string> = new Set([
  'animation-iteration-count',
  'aspect-ratio',
  'columns',
  'column-count',
  'flex',
  'flex-grow',
  'flex-shrink',
  'font-weight',
  'grid-area',
  'grid-column',
  'grid-column-end',
  'grid-column-start',
  'grid-row',
  'grid-row-end',
  'grid-row-start',
  'line-height',
  'opacity',
  'order',
  'orphans',
  'scale',
  'tab-size',
  'widows',
  'z-index',
  'fill-opacity',
  'flood-opacity',
  'stop-opacity',
  'stroke-miterlimit',
  'stroke-opacity',
]);

const BARE_NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * @internal Format a single declaration value into browser-valid CSS: a bare
 * number on a length property (`max-width:832` → `max-width:832px`) gets `px`.
 * `0`, already-unit'd values, multi-token values, and unitless properties
 * (opacity, z-index, line-height, …) are returned unchanged. The atomic class
 * name still hashes the RAW value (see `classNameFor`), so appending the unit
 * here keeps `style.attrs` classes and the emitted stylesheet in lockstep.
 *
 * Mirrors the compiler's `normalizeNumericLengths` text post-process so the
 * runtime `emitAtomicCss` path and `kovo compile package-css` agree byte-for-byte.
 */
export function cssLengthValue(cssProperty: string, value: string | number): string {
  const text = String(value);
  if (UNITLESS_CSS_PROPERTIES.has(cssProperty)) return text;
  if (text === '0' || !BARE_NUMBER.test(text)) return text;
  return `${text}px`;
}
