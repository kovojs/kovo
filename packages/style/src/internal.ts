import upstreamGetPriority from './property-priorities.js';
import { cssPrimitiveText } from './css-security.js';
import {
  styleFreeze,
  styleRegExpExec,
  styleStringStartsWith,
} from './style-security-intrinsics.js';

// Repo-internal style ABI re-exports. These symbols are not part of the
// app-facing public surface; the compiler and conformance tests consume them
// through `@kovojs/style/internal` (SPEC.md §13.1, rules/api-surface.md).
export { createAtomicStyles, createKeyframes, defineConsts, emitAtomicCss, raw } from './engine.js';
export type {
  AtomicCssResult,
  AtomicRule,
  CompiledStyle,
  Consts,
  CssEmitOptions,
  KeyframesResult,
} from './engine.js';
export { defineThemeFromBase, internalThemeTokens, themeFromSeed } from './theme.js';
export type {
  DefineThemeFromBaseOptions,
  InternalThemeTokens,
  ThemeComponentTokensInput,
  ThemeSystemOverrides,
} from './theme.js';

/** @internal Priority bucket compatible with StyleX's shorthand-before-longhand cascade model. */
export function getPriority(property: string): number {
  const cssProperty = styleStringStartsWith(property, '--') ? property : toKebabCase(property);
  return upstreamGetPriority(cssProperty);
}

function toKebabCase(value: string): string {
  let output = '';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    let lowered = character;
    for (let letter = 0; letter < upper.length; letter += 1) {
      if (upper[letter] === character) lowered = lower[letter] ?? character;
    }
    output += lowered === character ? character : `-${lowered}`;
  }
  return output;
}

/**
 * @internal CSS properties that take a bare number (no length unit). Every other
 * property `@kovojs/style` emits as a bare number (e.g. `padding:8`, `height:36`)
 * is a length and needs `px` to be valid CSS — StyleX applies the same rule. The
 * compiler's `package-css` extraction imports this same set so the runtime emit
 * and the served stylesheet stay in lockstep.
 */
const UNITLESS_CSS_PROPERTY_VALUES = styleFreeze([
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
] as const);

/** @internal Immutable unitless-property classifier shared with compiler CSS extraction. */
export const UNITLESS_CSS_PROPERTIES: ReadonlySet<string> = styleFreeze({
  has(property: string): boolean {
    for (let index = 0; index < UNITLESS_CSS_PROPERTY_VALUES.length; index += 1) {
      if (UNITLESS_CSS_PROPERTY_VALUES[index] === property) return true;
    }
    return false;
  },
}) as unknown as ReadonlySet<string>;

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
  const text = cssPrimitiveText(value);
  // CSS custom properties (`--gap`, `--cols`, …) are not lengths — their value is
  // opaque and substituted verbatim by `var()`. Appending `px` produces invalid
  // CSS (e.g. `grid-template-columns: repeat(var(--cols), 1fr)` with `--cols:3px`
  // collapses the grid). Every other engine path special-cases `--` (engine.ts
  // :532/:692, getPriority above); the length normalizer must too. (SPEC.md §5.2)
  if (styleStringStartsWith(cssProperty, '--')) return text;
  if (UNITLESS_CSS_PROPERTIES.has(cssProperty)) return text;
  if (text === '0' || styleRegExpExec(BARE_NUMBER, text) === null) return text;
  return `${text}px`;
}
