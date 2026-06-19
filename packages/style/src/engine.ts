import { cssLengthValue, getPriority } from './internal.js';

const CSS_MARKER = '$$css';
const STYLE_SRC = 'data-style-src';
const DEFAULT_LAYER_NAME = 'kovo-style';

/** CSS scalar values Kovo's static atomic compiler can emit without runtime CSS parsing. */
export type StylePrimitive = string | number;

/** Explicit raw inline style payload used only through the internal `raw(...)` escape hatch. */
export type InlineStyle = Readonly<Record<string, StylePrimitive>>;

/** Values accepted in a Kovo static style object. */
export type CssValue = StylePrimitive | null | undefined;

/** Static style object accepted by `style.create`, including nested pseudos and at-rules. */
export interface StyleObject {
  readonly [property: string]: CssValue | StyleObject;
}

/** Opaque compiled style object that may be passed to `style.attrs`. */
export type Style = CompiledStyle | null | false | undefined;

/** A style argument accepted by `attrs`, including arrays and raw inline tuples. */
export type StyleInput = Style | ReadonlyArray<StyleInput> | readonly [Style, InlineStyle];

/** Compiler-produced atomic style record keyed by CSS-property conflict group. */
export interface CompiledStyle {
  readonly [CSS_MARKER]: true | string;
  readonly [STYLE_SRC]?: string;
  readonly __rules?: readonly AtomicRule[];
  readonly __styleKey?: string;
  readonly [property: string]: string | true | readonly AtomicRule[] | undefined;
}

/** Result shape of `style.create`: one compiled style record per named namespace key. */
export type StyleNamespaces<Styles extends Record<string, StyleObject>> = {
  readonly [Key in keyof Styles]: CompiledStyle;
};

/** Typed CSS variable group returned by `defineVars`; token values are `var(--kovo-*)` strings. */
export type Vars<Tokens extends Record<string, CssValue>> = {
  readonly [Key in keyof Tokens]: string;
} & {
  readonly [CSS_MARKER]: true | string;
  readonly __vars: true;
  readonly __rules?: readonly AtomicRule[];
};

/** @internal Compile-time constants returned unchanged for use inside static style objects. */
export type Consts<Constants extends Record<string, StylePrimitive>> = Readonly<Constants>;

/** Theme class returned by `createTheme`, with extracted custom-property override rules. */
export interface Theme {
  readonly [CSS_MARKER]: true | string;
  readonly [STYLE_SRC]?: string;
  readonly __rules?: readonly AtomicRule[];
  readonly __theme: true;
  readonly className: string;
}

/** A single extracted atomic CSS rule plus source/provenance metadata for compiler manifests. */
export interface AtomicRule {
  readonly className: string;
  readonly property: string;
  readonly cssProperty: string;
  readonly value: StylePrimitive;
  readonly priority: number;
  readonly selectorSuffix: string;
  readonly atRules: readonly string[];
  readonly rule: string;
  readonly source: string;
}

interface StyleIdentityOptions {
  readonly namespace?: string;
  readonly source?: string;
}

/**
 * @internal Structured result for compiler callers that need both style records
 * and extracted CSS. The compiler ABI consumes this through `@kovojs/style/internal`.
 */
export interface AtomicCssResult<Styles extends Record<string, StyleObject>> {
  readonly styles: StyleNamespaces<Styles>;
  readonly rules: readonly AtomicRule[];
  readonly css: string;
}

/** Options for serializing extracted atom rules into CSS text. */
export interface CssEmitOptions {
  readonly layerName?: string;
}

/** Kovo JSX-shaped merge result returned by `style.attrs`. */
export interface AttrsResult {
  readonly class?: string;
  readonly [STYLE_SRC]?: string;
  readonly style?: string;
}

/** Keyframes object accepted by the deterministic `keyframes` name helper. */
export interface Keyframes {
  readonly [step: string]: StyleObject;
}

/**
 * Compiles static Kovo style objects into opaque atomic style records. This is the
 * TS-native fork point for StyleX-style authoring: authored TSX stays source-like,
 * while the compiler can inspect `__rules` and lower to ordinary class attributes
 * for SPEC.md §5.2 fixpoint output.
 */
export function create<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
): StyleNamespaces<Styles>;
export function create<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
  identity: StyleIdentityOptions,
): StyleNamespaces<Styles>;
export function create<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
  identity: StyleIdentityOptions = {},
): StyleNamespaces<Styles> {
  assertObjectInput(styles, 'style.create', 'styles');
  return createAtomicStylesInternal(styles, identity).styles;
}

/**
 * @internal Compile static style namespaces and return both the opaque style
 * records and the extracted CSS rules. Compiler integration uses this structured
 * result to build manifests and attribution instead of scraping strings
 * (SPEC.md §13.1). Not part of the app-facing public surface; consumed by the
 * compiler through `@kovojs/style/internal`.
 */
export function createAtomicStyles<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
): AtomicCssResult<Styles>;
export function createAtomicStyles<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
  identity: StyleIdentityOptions,
): AtomicCssResult<Styles>;
export function createAtomicStyles<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
  identity: StyleIdentityOptions = {},
): AtomicCssResult<Styles> {
  assertObjectInput(styles, 'style.createAtomicStyles', 'styles');
  return createAtomicStylesInternal(styles, identity);
}

function createAtomicStylesInternal<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
  identity: StyleIdentityOptions,
): AtomicCssResult<Styles> {
  const namespace = slug(identity.namespace ?? identity.source ?? 'style');
  const rulesByKey = new Map<string, AtomicRule>();
  const compiled: Record<string, CompiledStyle> = {};

  for (const [styleKey, styleObject] of Object.entries(styles)) {
    const ruleEntries: Array<readonly [string, string]> = [];
    const styleRules = compileObject(styleObject, {
      atRules: [],
      namespace,
      ruleEntries,
      rulesByKey,
      selectorSuffix: '',
      source: `${identity.source ?? namespace}#${styleKey}`,
      styleKey,
    });
    compiled[styleKey] = styleRecord(styleKey, styleRules, ruleEntries, identity.source);
  }

  const rules = [...rulesByKey.values()].sort(compareRules);
  return {
    styles: compiled as StyleNamespaces<Styles>,
    rules,
    css: emitAtomicCss(rules),
  };
}

/**
 * Merge compiled style records into a normalized merge result. Later style
 * arguments win at the CSS-property key, matching StyleX's styleq merge contract
 * while keeping raw inline style explicit and rare (SPEC.md §4.7 and §13.1).
 */
interface MergeResult {
  readonly className: string;
  readonly styleSrc?: string;
  readonly inlineStyle: InlineStyle;
}

function mergeToResult(styles: readonly StyleInput[]): MergeResult {
  const merged = mergeStyles(styles);
  const result: { className: string; styleSrc?: string; inlineStyle: InlineStyle } = {
    className: merged.className,
    inlineStyle: merged.inlineStyle,
  };
  if (merged.styleSources.length > 0) result.styleSrc = merged.styleSources.join('; ');
  return result;
}

/**
 * Merge compiled style records into Kovo JSX-shaped attributes: `class` plus a
 * serialized inline `style` escape. Kovo examples should prefer this shape outside
 * React because the emitted HTML remains plain and inspectable (SPEC.md §4.2).
 */
export function attrs(...styles: readonly StyleInput[]): AttrsResult {
  const merged = mergeToResult(styles);
  const attrsResult: { class?: string; [STYLE_SRC]?: string; style?: string } = {};
  if (merged.className.length > 0) attrsResult.class = merged.className;
  if (merged.styleSrc) attrsResult[STYLE_SRC] = merged.styleSrc;
  if (Object.keys(merged.inlineStyle).length > 0)
    attrsResult.style = serializeInlineStyle(merged.inlineStyle);
  return attrsResult;
}

/**
 * Define CSS custom-property tokens with deterministic `--kovo-*` names. The
 * returned values are ordinary `var(...)` strings so themes remain document CSS
 * and do not need shadow boundaries (SPEC.md §13.1).
 */
export function defineVars<const Tokens extends Record<string, CssValue>>(
  tokens: Tokens,
): Vars<Tokens>;
export function defineVars<const Tokens extends Record<string, CssValue>>(
  tokens: Tokens,
  identity: StyleIdentityOptions,
): Vars<Tokens>;
export function defineVars<const Tokens extends Record<string, CssValue>>(
  tokens: Tokens,
  identity: StyleIdentityOptions = {},
): Vars<Tokens> {
  assertObjectInput(tokens, 'style.defineVars', 'tokens');
  const namespace = slug(identity.namespace ?? identity.source ?? 'tokens');
  const result: Record<string, string | true | readonly AtomicRule[]> = {
    [CSS_MARKER]: true,
    __vars: true,
  };
  const rules: AtomicRule[] = [];

  for (const [token, value] of Object.entries(tokens)) {
    const cssProperty = `--kovo-${namespace}-${toKebabCase(token)}`;
    result[token] = `var(${cssProperty})`;
    if (value != null) {
      rules.push({
        atRules: [],
        className: ':root',
        cssProperty,
        property: token,
        priority: getPriority(cssProperty),
        rule: `:root{${cssProperty}:${String(value)}}`,
        selectorSuffix: '',
        source: `${identity.source ?? namespace}#${token}`,
        value,
      });
    }
  }

  result.__rules = rules;
  return result as Vars<Tokens>;
}

/**
 * @internal Define reusable static constants for style objects. Unlike
 * `defineVars`, these values are not CSS custom properties; the compiler can
 * inline them directly when lowering `style.create(...)` (SPEC.md §5.2). Not part
 * of the v1 public surface.
 */
export function defineConsts<const Constants extends Record<string, StylePrimitive>>(
  constants: Constants,
): Consts<Constants> {
  assertObjectInput(constants, 'style.defineConsts', 'constants');
  return Object.freeze({ ...constants }) as Consts<Constants>;
}

/**
 * Create a theme class that overrides a `defineVars` group. Apps apply the class
 * at document scope, and components keep referencing the original typed tokens.
 */
export function createTheme<Tokens extends Record<string, CssValue>>(
  baseTokens: Vars<Tokens>,
  overrides: Partial<Record<keyof Tokens, CssValue>>,
): Theme;
export function createTheme<Tokens extends Record<string, CssValue>>(
  baseTokens: Vars<Tokens>,
  overrides: Partial<Record<keyof Tokens, CssValue>>,
  identity: StyleIdentityOptions,
): Theme;
export function createTheme<Tokens extends Record<string, CssValue>>(
  baseTokens: Vars<Tokens>,
  overrides: Partial<Record<keyof Tokens, CssValue>>,
  identity: StyleIdentityOptions = {},
): Theme {
  assertObjectInput(baseTokens, 'style.createTheme', 'baseTokens');
  assertObjectInput(overrides, 'style.createTheme', 'overrides');
  const namespace = slug(identity.namespace ?? identity.source ?? 'theme');
  const className = `kv-${namespace}-theme-${hash(JSON.stringify(overrides))}`;
  const rules: AtomicRule[] = [];

  for (const token of Object.keys(overrides) as Array<Extract<keyof Tokens, string>>) {
    const value = overrides[token];
    if (value == null) continue;
    const tokenValue = baseTokens[token];
    const cssProperty = tokenValue.slice(4, -1);
    rules.push({
      atRules: [],
      className,
      cssProperty,
      property: token,
      priority: getPriority(cssProperty),
      rule: `.${className}{${cssProperty}:${String(value)}}`,
      selectorSuffix: '',
      source: `${identity.source ?? namespace}#${token}`,
      value,
    });
  }

  const theme: {
    [CSS_MARKER]: true;
    [STYLE_SRC]?: string;
    __rules: AtomicRule[];
    __theme: true;
    className: string;
  } = {
    [CSS_MARKER]: true,
    __rules: rules,
    __theme: true,
    className,
  };
  if (identity.source) theme[STYLE_SRC] = identity.source;
  return theme;
}

/**
 * @internal Explicit raw inline-style escape hatch for truly dynamic values. Keep
 * this rare: the normal `style` prop is for typed atomic style objects, per the
 * Phase 0 decision in plans/claude-stylex.md and SPEC.md §13.1. Not part of the
 * v1 public surface.
 */
export function raw(style: InlineStyle): readonly [null, InlineStyle] {
  assertObjectInput(style, 'style.raw', 'style');
  return [null, style] as const;
}

/** Deterministic keyframes name placeholder for the compiler's later extraction pass. */
export function keyframes(frames: Keyframes): string;
export function keyframes(frames: Keyframes, identity: StyleIdentityOptions): string;
export function keyframes(frames: Keyframes, identity: StyleIdentityOptions = {}): string {
  assertObjectInput(frames, 'style.keyframes', 'frames');
  return `kv-${slug(identity.namespace ?? identity.source ?? 'keyframes')}-${hash(JSON.stringify(frames))}`;
}

/** Emit atomic CSS in priority layers so split files do not depend on link order. */
export function emitAtomicCss(rules: readonly AtomicRule[], options: CssEmitOptions = {}): string {
  const layerName = options.layerName ?? DEFAULT_LAYER_NAME;
  const byPriority = new Map<number, AtomicRule[]>();
  for (const rule of rules) {
    const bucket = byPriority.get(rule.priority) ?? [];
    bucket.push(rule);
    byPriority.set(rule.priority, bucket);
  }

  return [...byPriority.entries()]
    .sort(([left], [right]) => left - right)
    .map(([priority, bucket]) => {
      const body = bucket
        .sort(compareRules)
        .map((rule) => rule.rule)
        .join('');
      // `kovo-style-${priority}` (hyphen, not `.${priority}`): a CSS layer-name
      // segment cannot start with a digit, so `@layer kovo-style.1000` is invalid
      // and a browser drops the whole block. Separate top-level priority layers
      // keep the same cascade order (they order by first declaration, ascending
      // priority here), matching the compiler's served-CSS normalization.
      return `@layer ${layerName}-${priority}{${body}}`;
    })
    .join('\n');
}

interface CompileContext {
  readonly atRules: readonly string[];
  readonly namespace: string;
  readonly ruleEntries: Array<readonly [string, string]>;
  readonly rulesByKey: Map<string, AtomicRule>;
  readonly selectorSuffix: string;
  readonly source: string;
  readonly styleKey: string;
}

interface MergeState {
  readonly classesByProperty: Map<string, string>;
  readonly inlineStyle: Record<string, StylePrimitive>;
  readonly styleSources: string[];
}

function assertObjectInput(
  value: unknown,
  apiName: string,
  argumentName: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${apiName} requires ${argumentName} to be an object.`);
  }
}

function compileObject(styleObject: StyleObject, context: CompileContext): AtomicRule[] {
  const rules: AtomicRule[] = [];

  for (const [property, value] of Object.entries(styleObject)) {
    if (value == null) continue;
    if (isNestedStyle(value)) {
      if (property.startsWith('@')) {
        rules.push(
          ...compileObject(value, {
            ...context,
            atRules: [...context.atRules, property],
          }),
        );
      } else if (isSelectorSuffix(property)) {
        rules.push(
          ...compileObject(value, {
            ...context,
            selectorSuffix: `${context.selectorSuffix}${property}`,
          }),
        );
      }
      continue;
    }

    const cssProperty = property.startsWith('--') ? property : toKebabCase(property);
    const priority = getPriority(cssProperty);
    const key = `${cssProperty}\u0000${String(value)}\u0000${context.selectorSuffix}\u0000${context.atRules.join('\u0001')}`;
    let rule = context.rulesByKey.get(key);
    if (!rule) {
      const className = classNameFor(context.namespace, cssProperty, value, context);
      rule = atomicRule(className, property, cssProperty, value, priority, context);
      context.rulesByKey.set(key, rule);
    }
    context.ruleEntries.push([conflictKey(cssProperty, context), rule.className]);
    rules.push(rule);
  }

  return rules;
}

function styleRecord(
  styleKey: string,
  rules: readonly AtomicRule[],
  ruleEntries: readonly (readonly [string, string])[],
  source?: string,
): CompiledStyle {
  const record: Record<string, string | true | readonly AtomicRule[] | undefined> = {
    [CSS_MARKER]: true,
    __rules: rules,
    __styleKey: styleKey,
  };
  if (source) record[STYLE_SRC] = `${source}#${styleKey}`;
  for (const [property, className] of ruleEntries) {
    record[property] = className;
  }
  return record as CompiledStyle;
}

function atomicRule(
  className: string,
  property: string,
  cssProperty: string,
  value: StylePrimitive,
  priority: number,
  context: CompileContext,
): AtomicRule {
  const selector = `.${className}${context.selectorSuffix}`;
  const declaration = `${cssProperty}:${cssLengthValue(cssProperty, value)}`;
  let rule = `${selector}{${declaration}}`;
  for (let index = context.atRules.length - 1; index >= 0; index -= 1) {
    rule = `${context.atRules[index]}{${rule}}`;
  }

  return {
    atRules: context.atRules,
    className,
    cssProperty,
    property,
    priority,
    rule,
    selectorSuffix: context.selectorSuffix,
    source: context.source,
    value,
  };
}

function mergeStyles(styles: readonly StyleInput[]): {
  readonly className: string;
  readonly inlineStyle: InlineStyle;
  readonly styleSources: readonly string[];
} {
  const state: MergeState = {
    classesByProperty: new Map(),
    inlineStyle: {},
    styleSources: [],
  };
  for (const style of styles) mergeStyleInput(style, state);
  return {
    className: [...state.classesByProperty.values()].join(' '),
    inlineStyle: state.inlineStyle,
    styleSources: [...new Set(state.styleSources)],
  };
}

function mergeStyleInput(style: StyleInput, state: MergeState): void {
  if (!style) return;
  if (Array.isArray(style)) {
    if (style.length === 2 && isStyleOrFalsy(style[0]) && isInlineStyle(style[1])) {
      mergeStyleInput(style[0], state);
      Object.assign(state.inlineStyle, style[1]);
      return;
    }
    for (const item of style) mergeStyleInput(item, state);
    return;
  }
  if (isCompiledStyle(style)) {
    const styleSource = style[STYLE_SRC];
    if (typeof styleSource === 'string' && styleSource.length > 0)
      state.styleSources.push(styleSource);
    const cssMarker = style[CSS_MARKER];
    if (typeof cssMarker === 'string' && cssMarker.length > 0) state.styleSources.push(cssMarker);
    for (const [property, className] of Object.entries(style)) {
      if (property === CSS_MARKER || property === STYLE_SRC || property.startsWith('__')) continue;
      if (typeof className !== 'string') continue;
      state.classesByProperty.delete(property);
      state.classesByProperty.set(property, className);
    }
  }
}

function classNameFor(
  namespace: string,
  cssProperty: string,
  value: StylePrimitive,
  context: CompileContext,
): string {
  return `kv-${namespace}-${propertyFamily(cssProperty)}-${hash(
    `${context.styleKey}:${cssProperty}:${String(value)}:${context.selectorSuffix}:${context.atRules.join('|')}`,
  )}`;
}

function conflictKey(cssProperty: string, context: CompileContext): string {
  return `${cssProperty}|${context.selectorSuffix}|${context.atRules.join('|')}`;
}

function serializeInlineStyle(style: InlineStyle): string {
  return Object.entries(style)
    .map(([property, value]) => `${toKebabCase(property)}:${String(value)}`)
    .join(';');
}

function isCompiledStyle(value: unknown): value is CompiledStyle {
  return Boolean(
    value && typeof value === 'object' && (value as Record<string, unknown>)[CSS_MARKER],
  );
}

function isStyleOrFalsy(value: unknown): value is Style {
  return value == null || value === false || isCompiledStyle(value);
}

function isInlineStyle(value: unknown): value is InlineStyle {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && !isCompiledStyle(value),
  );
}

function isNestedStyle(value: CssValue | StyleObject): value is StyleObject {
  return Boolean(value && typeof value === 'object');
}

function isSelectorSuffix(property: string): boolean {
  return property.startsWith(':') || property.startsWith('::') || property.startsWith('[');
}

function compareRules(left: AtomicRule, right: AtomicRule): number {
  return (
    left.priority - right.priority ||
    left.className.localeCompare(right.className) ||
    left.rule.localeCompare(right.rule)
  );
}

function propertyFamily(property: string): string {
  if (property.startsWith('--')) return 'var';
  if (property.startsWith('background')) return 'bg';
  if (property.startsWith('border')) return 'bd';
  if (property.startsWith('padding')) return 'pad';
  if (property.startsWith('margin')) return 'm';
  if (property.startsWith('font')) return 'font';
  if (property === 'color') return 'fg';
  if (property === 'display') return 'd';
  if (property === 'height') return 'h';
  if (property === 'width') return 'w';
  return property.split('-')[0] ?? 'x';
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function slug(value: string): string {
  return (
    toKebabCase(value)
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'style'
  );
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36).slice(0, 6);
}
