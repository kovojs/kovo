import { cssLengthValue, getPriority } from './internal.js';
import {
  assertCssCustomPropertyNameSafe,
  assertCssSyntaxFragmentSafe,
  assertCssValueSafe,
  assertCssVarReferenceSafe,
  cssPrimitiveText,
} from './css-security.js';
import {
  styleArrayIsArray,
  styleArrayJoin,
  styleArrayPush,
  styleArraySort,
  styleDenseArraySnapshot,
  styleFreeze,
  styleJsonStringify,
  styleMap,
  styleMapDelete,
  styleMapEntries,
  styleMapGet,
  styleMapHas,
  styleMapSet,
  styleMapValues,
  styleMathImul,
  styleNumber,
  styleNumberIsFinite,
  styleNumberToBase36,
  styleOwnDataEntries,
  styleOwnDataValue,
  styleErrorStack,
  styleRegExpExec,
  styleStringEndsWith,
  styleStringCharCodeAt,
  styleStringIncludes,
  styleStringLastIndexOf,
  styleStringLocaleCompare,
  styleStringReplace,
  styleStringReplaceAll,
  styleStringSlice,
  styleStringSplit,
  styleStringStartsWith,
  styleStringTrim,
  styleWeakSet,
  styleWeakSetAdd,
  styleWeakSetHas,
} from './style-security-intrinsics.js';

const CSS_MARKER = '$$css';
const STYLE_SRC = 'data-style-src';
const DEFAULT_LAYER_NAME = 'kovo-style';
const trustedAtomicRules = styleWeakSet<AtomicRule>();
const trustedKeyframes = styleWeakSet<KeyframesResult>();

/** CSS scalar values Kovo's static atomic compiler can emit without runtime CSS parsing. */
export type StylePrimitive = string | number;

/**
 * Explicit raw inline style payload used only through the internal `raw(...)`
 * escape hatch. Not part of the public `@kovojs/style` surface; the raw tuple
 * form is inlined into `StyleInput` so the public type does not name this alias
 * (rules/api-surface.md recursive publicness).
 * @internal
 */
export type InlineStyle = Readonly<Record<string, StylePrimitive>>;

/** Values accepted in a Kovo static style object. */
export type CssValue = StylePrimitive | null | undefined;

/** Static style object accepted by `style.create`, including nested pseudos and at-rules. */
export interface StyleObject {
  readonly [property: string]: CssValue | StyleObject;
}

/** Opaque compiled style record that may be passed to `style.attrs`. */
export interface StyleRecord {
  readonly [CSS_MARKER]: true | string;
  readonly [STYLE_SRC]?: string;
  readonly __rules?: unknown;
  readonly __styleKey?: string;
  readonly [property: string]: unknown;
}

/** Opaque compiled style object that may be passed to `style.attrs`. */
export type Style = StyleRecord | null | false | undefined;

/** A style argument accepted by `attrs`, including arrays and raw inline tuples. */
export type StyleInput =
  | Style
  | ReadonlyArray<StyleInput>
  | readonly [Style, Readonly<Record<string, StylePrimitive>>];

/** Compiler-produced atomic style record keyed by CSS-property conflict group. */
export interface CompiledStyle {
  readonly [CSS_MARKER]: true | string;
  readonly [STYLE_SRC]?: string;
  readonly __rules?: readonly AtomicRule[];
  readonly __styleKey?: string;
  readonly [property: string]: string | true | readonly AtomicRule[] | undefined;
}

/** Result shape of `style.create`: one opaque style record per named namespace key. */
export type StyleNamespaces<Styles extends Record<string, StyleObject>> = {
  readonly [Key in keyof Styles]: StyleRecord;
};

/** Typed CSS variable group returned by `defineVars`; token values are `var(--kovo-*)` strings. */
export type Vars<Tokens extends Record<string, CssValue>> = {
  readonly [Key in keyof Tokens]: string;
} & {
  readonly [CSS_MARKER]: true | string;
  readonly __vars: true;
  readonly __rules?: unknown;
};

/** @internal Compile-time constants returned unchanged for use inside static style objects. */
export type Consts<Constants extends Record<string, StylePrimitive>> = Readonly<Constants>;

/** Theme class returned by `createTheme`, with extracted custom-property override rules. */
export interface Theme {
  readonly [CSS_MARKER]: true | string;
  readonly [STYLE_SRC]?: string;
  readonly __rules?: unknown;
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

/** Optional deterministic identity hint for extracted style and keyframe names. */
export interface StyleIdentityOptions {
  readonly namespace?: string;
  readonly source?: string;
}

interface StyleCallSite {
  readonly fileName: string;
}

/**
 * @internal Structured result for compiler callers that need both style records
 * and extracted CSS. The compiler ABI consumes this through `@kovojs/style/internal`.
 */
export interface AtomicCssResult<Styles extends Record<string, StyleObject>> {
  readonly styles: { readonly [Key in keyof Styles]: CompiledStyle };
  readonly rules: readonly AtomicRule[];
  readonly css: string;
}

/** Options for serializing extracted atom rules into CSS text. */
export interface CssEmitOptions {
  readonly layerName?: string;
  /**
   * `@keyframes` blocks (from `createKeyframes`) to emit alongside the atomic
   * layers. They are written once each, outside any `@layer` (keyframes do not
   * participate in the cascade), so a runtime caller that collects both atomic
   * rules and keyframes serializes a complete stylesheet (SPEC.md §13.1).
   */
  readonly keyframes?: readonly KeyframesResult[];
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
 * @internal Structured `@keyframes` extraction result. `name` is the deterministic
 * animation-name `keyframes(...)` returns; `css` is the full `@keyframes <name>
 * { … }` block, with declarations normalized identically to atomic rules (property
 * casing + unitless-length handling via `cssLengthValue`). The compiler consumes
 * this through `@kovojs/style/internal` to thread the block into extracted CSS so
 * a `style.keyframes` const used by `animationName` actually ships its animation
 * (SPEC.md §13.1). Not part of the app-facing public surface.
 */
export interface KeyframesResult {
  readonly name: string;
  readonly css: string;
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
  identity: { readonly namespace?: string; readonly source?: string },
): StyleNamespaces<Styles>;
export function create<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
  identity: { readonly namespace?: string; readonly source?: string } = {},
): StyleNamespaces<Styles> {
  assertObjectInput(styles, 'style.create', 'styles');
  return createAtomicStylesInternal(
    styles,
    snapshotStyleIdentity(identity, 'style.create identity'),
  ).styles;
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
  return createAtomicStylesInternal(
    styles,
    snapshotStyleIdentity(identity, 'style.createAtomicStyles identity'),
  );
}

function createAtomicStylesInternal<const Styles extends Record<string, StyleObject>>(
  styles: Styles,
  identity: StyleIdentityOptions,
): AtomicCssResult<Styles> {
  const resolvedIdentity = resolveStyleIdentity(styles, identity);
  const namespace = slug(resolvedIdentity.namespace ?? resolvedIdentity.source ?? 'style');
  const rulesByKey = styleMap<string, AtomicRule>();
  const compiled: Record<string, CompiledStyle> = {};

  const styleEntries = styleOwnDataEntries(styles, 'style.create styles');
  for (let styleIndex = 0; styleIndex < styleEntries.length; styleIndex += 1) {
    const [styleKey, styleObject] = styleEntries[styleIndex] as readonly [string, unknown];
    assertObjectInput(styleObject, 'style.create', `styles[${styleJsonStringify(styleKey)}]`);
    const ruleEntries: Array<readonly [string, string]> = [];
    const styleRules = compileObject(styleObject as StyleObject, {
      atRules: [],
      namespace,
      ruleEntries,
      rulesByKey,
      selectorSuffix: '',
      source: `${resolvedIdentity.source ?? namespace}#${styleKey}`,
      styleKey,
    });
    compiled[styleKey] = styleRecord(styleKey, styleRules, ruleEntries, resolvedIdentity.source);
  }

  const rules = styleArraySort(styleMapValues(rulesByKey), compareRules);
  return styleFreeze({
    styles: styleFreeze(compiled) as { readonly [Key in keyof Styles]: CompiledStyle },
    rules: styleFreeze(rules),
    css: emitAtomicCss(rules),
  });
}

function snapshotStyleIdentity(
  identity: StyleIdentityOptions,
  label: string,
): StyleIdentityOptions {
  assertObjectInput(identity, label, 'options');
  const namespace = styleOwnDataValue(identity, 'namespace', label);
  const source = styleOwnDataValue(identity, 'source', label);
  if (namespace !== undefined && typeof namespace !== 'string') {
    throw new TypeError(`${label}.namespace must be a string own data property.`);
  }
  if (source !== undefined && typeof source !== 'string') {
    throw new TypeError(`${label}.source must be a string own data property.`);
  }
  return styleFreeze({
    ...(namespace === undefined ? {} : { namespace }),
    ...(source === undefined ? {} : { source }),
  });
}

function resolveStyleIdentity(
  styles: Record<string, StyleObject>,
  identity: StyleIdentityOptions,
): StyleIdentityOptions {
  if (identity.namespace && identity.source) return identity;
  const callSite = inferStyleCallSite();
  if (!callSite) return identity;

  return {
    namespace: identity.namespace ?? derivedRuntimeStyleNamespace(callSite.fileName, styles),
    source: identity.source ?? callSite.fileName,
  };
}

function inferStyleCallSite(): StyleCallSite | null {
  const site = styleStackCallSite();
  if (!site) return null;
  const filePath = slashPath(site.filePath);
  if (
    !styleStringIncludes(filePath, '/packages/ui/src/') &&
    !styleStringIncludes(filePath, '/node_modules/@kovojs/ui/src/')
  ) {
    return null;
  }

  return {
    fileName: styleSourceFileName(site.filePath),
  };
}

function styleStackCallSite(): { column: number; filePath: string; line: number } | null {
  const stack = styleErrorStack();
  const stackLines = styleStringSplit(stack, '\n');
  for (let stackIndex = 0; stackIndex < stackLines.length; stackIndex += 1) {
    const line = stackLines[stackIndex] as string;
    const rawFrame = styleStringReplace(styleStringTrim(line), /^at\s+/, '');
    const frame = styleStringIncludes(rawFrame, '(')
      ? styleStringSlice(
          rawFrame,
          styleStringLastIndexOf(rawFrame, '(') + 1,
          styleStringEndsWith(rawFrame, ')') ? -1 : undefined,
        )
      : rawFrame;
    const match =
      styleRegExpExec(/\(?((?:file:\/\/)?\/[^():]+):(\d+):(\d+)\)?$/, frame) ??
      styleRegExpExec(/\(?([A-Za-z]:\\[^():]+):(\d+):(\d+)\)?$/, frame);
    if (!match) continue;
    const rawFilePath = match[1] ?? '';
    if (styleStringEndsWith(rawFilePath, '/packages/style/src/engine.ts')) continue;
    const filePath = styleStringStartsWith(rawFilePath, 'file://')
      ? new URL(rawFilePath).pathname
      : rawFilePath;
    return {
      column: styleNumber(match[3]),
      filePath,
      line: styleNumber(match[2]),
    };
  }
  return null;
}

function styleSourceFileName(filePath: string): string {
  const parts = styleStringSplit(filePath, /[\\/]/);
  let fileName = 'style.tsx';
  for (let index = 0; index < parts.length; index += 1) {
    if ((parts[index] ?? '') !== '') fileName = parts[index] ?? fileName;
  }
  if (styleRegExpExec(/\.[cm]?jsx?$/, fileName)) {
    return styleStringReplace(fileName, /\.[cm]?jsx?$/, '.tsx');
  }
  return fileName;
}

function slashPath(value: string): string {
  return styleStringReplaceAll(value, '\\', '/');
}

function derivedRuntimeStyleNamespace(
  fileName: string,
  styles: Record<string, StyleObject>,
): string {
  const fileParts = styleStringSplit(fileName, /[\\/]/);
  let fileBase: string | undefined;
  for (let index = 0; index < fileParts.length; index += 1) {
    if ((fileParts[index] ?? '') !== '') fileBase = fileParts[index];
  }
  if (fileBase !== undefined) {
    fileBase = styleStringReplace(fileBase, /\.[cm]?[tj]sx?$/, '');
  }
  const fileNamespace = fileBase && fileBase.length > 0 ? fileBase : 'style';
  const styleKeys: string[] = [];
  const entries = styleOwnDataEntries(styles, 'style identity styles');
  for (let index = 0; index < entries.length; index += 1) {
    styleArrayPush(styleKeys, (entries[index] as readonly [string, unknown])[0]);
  }

  if (isSubset(styleKeys, ['bottom', 'left', 'right', 'top'])) return `${fileNamespace}-side`;
  if (isSubset(styleKeys, ['horizontal', 'vertical'])) return `${fileNamespace}-orientation`;
  if (isSubset(styleKeys, ['lg', 'md', 'sm', 'xl', 'xs'])) return `${fileNamespace}-size`;
  if (
    isSubset(styleKeys, [
      'danger',
      'destructive',
      'ghost',
      'info',
      'neutral',
      'outline',
      'primary',
      'secondary',
      'subtle',
      'success',
      'warning',
    ])
  ) {
    return `${fileNamespace}-variant`;
  }
  return fileNamespace;
}

function isSubset(values: readonly string[], allowed: readonly string[]): boolean {
  if (values.length === 0) return false;
  for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
    let found = false;
    for (let allowedIndex = 0; allowedIndex < allowed.length; allowedIndex += 1) {
      if (values[valueIndex] === allowed[allowedIndex]) found = true;
    }
    if (!found) return false;
  }
  return true;
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
  if (merged.styleSources.length > 0) {
    result.styleSrc = styleArrayJoin(merged.styleSources, '; ');
  }
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
  if (styleOwnDataEntries(merged.inlineStyle, 'style.attrs inline style').length > 0)
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
  identity: { readonly namespace?: string; readonly source?: string } = {},
): Vars<Tokens> {
  assertObjectInput(tokens, 'style.defineVars', 'tokens');
  const stableIdentity = snapshotStyleIdentity(identity, 'style.defineVars identity');
  const namespace = slug(stableIdentity.namespace ?? stableIdentity.source ?? 'tokens');
  const result: Record<string, string | true | readonly AtomicRule[]> = {
    [CSS_MARKER]: true,
    __vars: true,
  };
  const rules: AtomicRule[] = [];

  const tokenEntries = styleOwnDataEntries(tokens, 'style.defineVars tokens');
  for (let tokenIndex = 0; tokenIndex < tokenEntries.length; tokenIndex += 1) {
    const [token, value] = tokenEntries[tokenIndex] as readonly [string, unknown];
    assertCssPrimitive(value, 'style.defineVars', token);
    assertCssNameSafe(token, 'style.defineVars', 'token');
    const cssProperty = `--kovo-${namespace}-${toKebabCase(token)}`;
    assertCssCustomPropertyNameSafe(cssProperty, 'style.defineVars', token);
    result[token] = `var(${cssProperty})`;
    if (value != null) {
      assertCssValueSafe(value, 'style.defineVars', token);
      styleArrayPush(
        rules,
        registerAtomicRule({
          atRules: [],
          className: ':root',
          cssProperty,
          property: token,
          priority: getPriority(cssProperty),
          rule: `:root{${cssProperty}:${cssPrimitiveText(value)}}`,
          selectorSuffix: '',
          source: `${stableIdentity.source ?? namespace}#${token}`,
          value,
        }),
      );
    }
  }

  result.__rules = styleFreeze(rules);
  return styleFreeze(result) as Vars<Tokens>;
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
  const snapshot: Record<string, StylePrimitive> = {};
  const constantEntries = styleOwnDataEntries(constants, 'style.defineConsts constants');
  for (let index = 0; index < constantEntries.length; index += 1) {
    const [name, value] = constantEntries[index] as readonly [string, unknown];
    assertCssPrimitive(value, 'style.defineConsts', name);
    snapshot[name] = value;
  }
  return styleFreeze(snapshot) as Consts<Constants>;
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
  identity: { readonly namespace?: string; readonly source?: string } = {},
): Theme {
  assertObjectInput(baseTokens, 'style.createTheme', 'baseTokens');
  assertObjectInput(overrides, 'style.createTheme', 'overrides');
  const stableIdentity = snapshotStyleIdentity(identity, 'style.createTheme identity');
  const overrideEntries = styleOwnDataEntries(overrides, 'style.createTheme overrides');
  const namespace = slug(stableIdentity.namespace ?? stableIdentity.source ?? 'theme');
  const className = `kv-${namespace}-theme-${hash(canonicalStyleData(overrides, 'style.createTheme overrides'))}`;
  const rules: AtomicRule[] = [];

  for (let overrideIndex = 0; overrideIndex < overrideEntries.length; overrideIndex += 1) {
    const [token, value] = overrideEntries[overrideIndex] as readonly [string, unknown];
    assertCssPrimitive(value, 'style.createTheme', token, true);
    if (value == null) continue;
    assertCssNameSafe(token, 'style.createTheme', 'token');
    assertCssCustomPropertyNameSafe(
      `--kovo-token-${toKebabCase(token)}`,
      'style.createTheme',
      token,
    );
    assertCssValueSafe(value, 'style.createTheme', token);
    const tokenValue = styleOwnDataValue(baseTokens, token, 'style.createTheme baseTokens');
    const cssProperty = assertCssVarReferenceSafe(tokenValue, 'style.createTheme', token);
    styleArrayPush(
      rules,
      registerAtomicRule({
        atRules: [],
        className,
        cssProperty,
        property: token,
        priority: getPriority(cssProperty),
        rule: `.${className}{${cssProperty}:${cssPrimitiveText(value)}}`,
        selectorSuffix: '',
        source: `${stableIdentity.source ?? namespace}#${token}`,
        value,
      }),
    );
  }

  const theme: {
    [CSS_MARKER]: true;
    [STYLE_SRC]?: string;
    __rules: readonly AtomicRule[];
    __theme: true;
    className: string;
  } = {
    [CSS_MARKER]: true,
    __rules: styleFreeze(rules),
    __theme: true,
    className,
  };
  if (stableIdentity.source) theme[STYLE_SRC] = stableIdentity.source;
  return styleFreeze(theme);
}

/**
 * @internal Explicit raw inline-style escape hatch for truly dynamic values. Keep
 * this rare: the normal `style` prop is for typed atomic style objects, per the
 * Phase 0 decision in plans/claude-stylex.md and SPEC.md §13.1. Not part of the
 * v1 public surface.
 */
export function raw(style: InlineStyle): readonly [null, InlineStyle] {
  assertObjectInput(style, 'style.raw', 'style');
  const snapshot: Record<string, StylePrimitive> = {};
  const rawEntries = styleOwnDataEntries(style, 'style.raw style');
  for (let index = 0; index < rawEntries.length; index += 1) {
    const [property, value] = rawEntries[index] as readonly [string, unknown];
    assertCssPrimitive(value, 'style.raw', property);
    assertCssSyntaxFragmentSafe(property, 'style.raw', 'property', true);
    assertCssValueSafe(value, 'style.raw', property, { allowBackslash: true });
    snapshot[property] = value;
  }
  return styleFreeze([null, styleFreeze(snapshot)] as const);
}

/**
 * Define a CSS `@keyframes` animation, returning its deterministic
 * (`kv-<slug>-<hash>`) animation-name for use in `animationName`. The compiler's
 * StyleX extraction recognizes the `style.keyframes(...)` const, resolves this
 * name, and emits the matching `@keyframes` block into the served CSS asset
 * (SPEC.md §13.1); see `createKeyframes` for the engine's structured result.
 */
export function keyframes(frames: Keyframes): string;
export function keyframes(
  frames: Keyframes,
  identity: { readonly namespace?: string; readonly source?: string } = {},
): string {
  return createKeyframes(frames, identity).name;
}

/**
 * @internal Compile a `Keyframes` object into both its deterministic
 * animation-name and the extractable `@keyframes <name> { … }` CSS block. The
 * declarations are normalized identically to atomic rules (property casing via
 * `toKebabCase`, unitless-length handling via `cssLengthValue`) so a value like
 * `transform`/`opacity`/`width: 40` serializes the same inside the keyframe as it
 * would in a `style.create(...)` rule. Compiler integration consumes this through
 * `@kovojs/style/internal` (SPEC.md §13.1); not part of the app-facing surface.
 */
export function createKeyframes(frames: Keyframes): KeyframesResult;
export function createKeyframes(frames: Keyframes, identity: StyleIdentityOptions): KeyframesResult;
export function createKeyframes(
  frames: Keyframes,
  identity: StyleIdentityOptions = {},
): KeyframesResult {
  assertObjectInput(frames, 'style.keyframes', 'frames');
  const stableIdentity = snapshotStyleIdentity(identity, 'style.keyframes identity');
  const frameEntries = styleOwnDataEntries(frames, 'style.keyframes frames');
  // Hash the RAW frames object (not the emitted CSS) so the name is stable across
  // engine serialization changes and matches the prior name-only behavior.
  const name = `kv-${slug(stableIdentity.namespace ?? stableIdentity.source ?? 'keyframes')}-${hash(canonicalStyleData(frames, 'style.keyframes frames'))}`;
  const stepCss: string[] = [];
  for (let stepIndex = 0; stepIndex < frameEntries.length; stepIndex += 1) {
    const [step, declarations] = frameEntries[stepIndex] as readonly [string, unknown];
    assertCssSyntaxFragmentSafe(step, 'style.keyframes', 'step');
    assertObjectInput(declarations, 'style.keyframes', `frames[${styleJsonStringify(step)}]`);
    styleArrayPush(stepCss, `${step}{${keyframeDeclarations(declarations as StyleObject)}}`);
  }
  const result = styleFreeze({ css: `@keyframes ${name}{${styleArrayJoin(stepCss, '')}}`, name });
  styleWeakSetAdd(trustedKeyframes, result);
  return result;
}

function keyframeDeclarations(declarations: StyleObject): string {
  const parts: string[] = [];
  const declarationEntries = styleOwnDataEntries(declarations, 'style.keyframes declarations');
  for (let index = 0; index < declarationEntries.length; index += 1) {
    const [property, value] = declarationEntries[index] as readonly [string, unknown];
    // Keyframe steps carry only flat declarations (no pseudos/at-rules/nesting),
    // matching CSS `@keyframes`. Skip null/undefined like atomic compilation does.
    if (value == null || isNestedStyle(value)) continue;
    assertCssPrimitive(value, 'style.keyframes', property);
    assertCssSyntaxFragmentSafe(property, 'style.keyframes', 'property', true);
    assertCssValueSafe(value, 'style.keyframes', property, { allowBackslash: true });
    const cssProperty = styleStringStartsWith(property, '--') ? property : toKebabCase(property);
    styleArrayPush(parts, `${cssProperty}:${cssLengthValue(cssProperty, value)}`);
  }
  return styleArrayJoin(parts, ';');
}

/** Emit atomic CSS in priority layers so split files do not depend on link order. */
export function emitAtomicCss(rules: readonly AtomicRule[], options: CssEmitOptions = {}): string {
  const stableRules = styleDenseArraySnapshot(rules, 'style.emitAtomicCss rules', (rule, index) => {
    if (
      typeof rule !== 'object' ||
      rule === null ||
      !styleWeakSetHas(trustedAtomicRules, rule as AtomicRule)
    ) {
      throw new TypeError(
        `style.emitAtomicCss rules[${index}] must be a framework-created atomic rule.`,
      );
    }
    return rule as AtomicRule;
  });
  assertObjectInput(options, 'style.emitAtomicCss', 'options');
  const suppliedLayerName = styleOwnDataValue(options, 'layerName', 'style.emitAtomicCss options');
  if (suppliedLayerName !== undefined && typeof suppliedLayerName !== 'string') {
    throw new TypeError(
      'style.emitAtomicCss options.layerName must be a string own data property.',
    );
  }
  const layerName = suppliedLayerName ?? DEFAULT_LAYER_NAME;
  assertCssCustomPropertyNameSafe(`--${layerName}`, 'style.emitAtomicCss', 'layerName');
  const suppliedKeyframes = styleOwnDataValue(options, 'keyframes', 'style.emitAtomicCss options');
  const keyframes =
    suppliedKeyframes === undefined
      ? styleFreeze([] as KeyframesResult[])
      : styleDenseArraySnapshot(
          suppliedKeyframes,
          'style.emitAtomicCss options.keyframes',
          (entry, index) => {
            if (
              typeof entry !== 'object' ||
              entry === null ||
              !styleWeakSetHas(trustedKeyframes, entry as KeyframesResult)
            ) {
              throw new TypeError(
                `style.emitAtomicCss options.keyframes[${index}] must be a framework-created keyframes result.`,
              );
            }
            return entry as KeyframesResult;
          },
        );
  const byPriority = styleMap<number, AtomicRule[]>();
  for (let index = 0; index < stableRules.length; index += 1) {
    const rule = stableRules[index] as AtomicRule;
    const bucket = styleMapGet(byPriority, rule.priority) ?? [];
    styleArrayPush(bucket, rule);
    styleMapSet(byPriority, rule.priority, bucket);
  }

  const priorityEntries = styleArraySort(
    styleMapEntries(byPriority),
    ([left], [right]) => left - right,
  );
  const layers: string[] = [];
  for (let index = 0; index < priorityEntries.length; index += 1) {
    const [priority, bucket] = priorityEntries[index] as [number, AtomicRule[]];
    styleArraySort(bucket, compareRules);
    const ruleText: string[] = [];
    for (let ruleIndex = 0; ruleIndex < bucket.length; ruleIndex += 1) {
      styleArrayPush(ruleText, (bucket[ruleIndex] as AtomicRule).rule);
    }
    const body = styleArrayJoin(ruleText, '');
    // `kovo-style-${priority}` (hyphen, not `.${priority}`): a CSS layer-name
    // segment cannot start with a digit, so `@layer kovo-style.1000` is invalid
    // and a browser drops the whole block. Separate top-level priority layers
    // keep the same cascade order (they order by first declaration, ascending
    // priority here), matching the compiler's served-CSS normalization.
    styleArrayPush(layers, `@layer ${layerName}-${priority}{${body}}`);
  }

  // `@keyframes` blocks are emitted outside `@layer` (they carry no cascade
  // priority) and deduped by name so a keyframe shared across rules is written
  // once. They lead so the animation is defined before any rule references it.
  const keyframeCss = dedupeKeyframes(keyframes);
  for (let index = 0; index < layers.length; index += 1) {
    styleArrayPush(keyframeCss, layers[index] as string);
  }
  return styleArrayJoin(keyframeCss, '\n');
}

function dedupeKeyframes(keyframes: readonly KeyframesResult[]): string[] {
  const byName = styleMap<string, string>();
  for (let index = 0; index < keyframes.length; index += 1) {
    const keyframe = keyframes[index] as KeyframesResult;
    if (!styleMapHas(byName, keyframe.name)) styleMapSet(byName, keyframe.name, keyframe.css);
  }
  return styleMapValues(byName);
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
  if (!value || typeof value !== 'object' || styleArrayIsArray(value)) {
    throw new TypeError(`${apiName} requires ${argumentName} to be an object.`);
  }
  // Force the plain-record and accessor checks before any caller value is read.
  styleOwnDataEntries(value, `${apiName} ${argumentName}`);
}

function assertCssPrimitive(
  value: unknown,
  apiName: string,
  token: string,
  allowNullish?: false,
): asserts value is StylePrimitive;
function assertCssPrimitive(
  value: unknown,
  apiName: string,
  token: string,
  allowNullish: true,
): asserts value is StylePrimitive | null | undefined;
function assertCssPrimitive(
  value: unknown,
  apiName: string,
  token: string,
  allowNullish = false,
): asserts value is StylePrimitive | null | undefined {
  if ((value === null || value === undefined) && allowNullish) return;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError(`${apiName} requires token "${token}" to be a string or number.`);
  }
  if (typeof value === 'number' && !styleNumberIsFinite(value)) {
    throw new TypeError(`${apiName} requires token "${token}" to be a finite number.`);
  }
}

function registerAtomicRule(rule: AtomicRule): AtomicRule {
  const stableAtRules = styleFreeze(copyStrings(rule.atRules));
  const stable = styleFreeze({ ...rule, atRules: stableAtRules });
  styleWeakSetAdd(trustedAtomicRules, stable);
  return stable;
}

function assertCssNameSafe(value: string, apiName: string, role: string): void {
  assertCssSyntaxFragmentSafe(value, apiName, role, true);
}

function compileObject(styleObject: StyleObject, context: CompileContext): AtomicRule[] {
  const rules: AtomicRule[] = [];

  const styleEntries = styleOwnDataEntries(styleObject, 'style.create style object');
  for (let styleIndex = 0; styleIndex < styleEntries.length; styleIndex += 1) {
    const [property, value] = styleEntries[styleIndex] as readonly [string, unknown];
    if (value == null) continue;
    assertCssSyntaxFragmentSafe(property, 'style.create', 'property');
    if (isNestedStyle(value)) {
      if (styleStringStartsWith(property, '@')) {
        const nestedRules = compileObject(value, {
          ...context,
          atRules: styleFreeze(copyStrings(context.atRules, property)),
        });
        for (let index = 0; index < nestedRules.length; index += 1) {
          styleArrayPush(rules, nestedRules[index] as AtomicRule);
        }
      } else if (isSelectorSuffix(property)) {
        const nestedRules = compileObject(value, {
          ...context,
          selectorSuffix: `${context.selectorSuffix}${property}`,
        });
        for (let index = 0; index < nestedRules.length; index += 1) {
          styleArrayPush(rules, nestedRules[index] as AtomicRule);
        }
      }
      continue;
    }

    assertCssPrimitive(value, 'style.create', property);

    const cssProperty = styleStringStartsWith(property, '--') ? property : toKebabCase(property);
    assertCssValueSafe(value, 'style.create', property, { allowBackslash: true });
    const priority = getPriority(cssProperty);
    const key = `${cssProperty}\u0000${cssPrimitiveText(value)}\u0000${context.selectorSuffix}\u0000${styleArrayJoin(context.atRules, '\u0001')}`;
    let rule = styleMapGet(context.rulesByKey, key);
    if (!rule) {
      const className = classNameFor(context.namespace, cssProperty, value, context);
      rule = atomicRule(className, property, cssProperty, value, priority, context);
      styleMapSet(context.rulesByKey, key, rule);
    }
    styleArrayPush(
      context.ruleEntries,
      styleFreeze([conflictKey(cssProperty, context), rule.className] as const),
    );
    styleArrayPush(rules, rule);
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
  for (let index = 0; index < ruleEntries.length; index += 1) {
    const [property, className] = ruleEntries[index] as readonly [string, string];
    record[property] = className;
  }
  return styleFreeze(record) as CompiledStyle;
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

  return registerAtomicRule({
    atRules: styleFreeze(copyStrings(context.atRules)),
    className,
    cssProperty,
    property,
    priority,
    rule,
    selectorSuffix: context.selectorSuffix,
    source: context.source,
    value,
  });
}

function mergeStyles(styles: readonly StyleInput[]): {
  readonly className: string;
  readonly inlineStyle: InlineStyle;
  readonly styleSources: readonly string[];
} {
  const state: MergeState = {
    classesByProperty: styleMap(),
    inlineStyle: {},
    styleSources: [],
  };
  for (let index = 0; index < styles.length; index += 1) {
    mergeStyleInput(styles[index] as StyleInput, state);
  }
  const uniqueSources = styleMap<string, true>();
  for (let index = 0; index < state.styleSources.length; index += 1) {
    styleMapSet(uniqueSources, state.styleSources[index] as string, true);
  }
  return styleFreeze({
    className: styleArrayJoin(styleMapValues(state.classesByProperty), ' '),
    inlineStyle: styleFreeze(state.inlineStyle),
    styleSources: styleFreeze(uniqueMapKeys(uniqueSources)),
  });
}

function uniqueMapKeys(map: Map<string, true>): string[] {
  const entries = styleMapEntries(map);
  const keys: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    styleArrayPush(keys, (entries[index] as [string, true])[0]);
  }
  return keys;
}

function mergeStyleInput(style: StyleInput, state: MergeState): void {
  if (!style) return;
  if (styleArrayIsArray(style)) {
    const stableStyles = styleDenseArraySnapshot(
      style,
      'style.attrs style array',
      (entry) => entry,
    );
    if (
      stableStyles.length === 2 &&
      isStyleOrFalsy(stableStyles[0]) &&
      isInlineStyle(stableStyles[1])
    ) {
      mergeStyleInput(stableStyles[0] as StyleInput, state);
      const inlineEntries = styleOwnDataEntries(
        stableStyles[1] as object,
        'style.attrs inline style',
      );
      for (let index = 0; index < inlineEntries.length; index += 1) {
        const [property, value] = inlineEntries[index] as readonly [string, unknown];
        assertCssPrimitive(value, 'style.attrs inline style', property);
        assertCssSyntaxFragmentSafe(property, 'style.attrs', 'inline property', true);
        assertCssValueSafe(value, 'style.attrs', property, { allowBackslash: true });
        state.inlineStyle[property] = value;
      }
      return;
    }
    for (let index = 0; index < stableStyles.length; index += 1) {
      mergeStyleInput(stableStyles[index] as StyleInput, state);
    }
    return;
  }
  if (isCompiledStyle(style)) {
    const styleSource = styleOwnDataValue(style, STYLE_SRC, 'style.attrs compiled style');
    if (typeof styleSource === 'string' && styleSource.length > 0)
      styleArrayPush(state.styleSources, styleSource);
    const cssMarker = styleOwnDataValue(style, CSS_MARKER, 'style.attrs compiled style');
    if (typeof cssMarker === 'string' && cssMarker.length > 0) {
      styleArrayPush(state.styleSources, cssMarker);
    }
    const compiledEntries = styleOwnDataEntries(style, 'style.attrs compiled style');
    for (let index = 0; index < compiledEntries.length; index += 1) {
      const [property, className] = compiledEntries[index] as readonly [string, unknown];
      if (
        property === CSS_MARKER ||
        property === STYLE_SRC ||
        styleStringStartsWith(property, '__')
      )
        continue;
      if (typeof className !== 'string') continue;
      assertCssCustomPropertyNameSafe(`--${className}`, 'style.attrs', property);
      styleMapDelete(state.classesByProperty, property);
      styleMapSet(state.classesByProperty, property, className);
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
    `${context.styleKey}:${cssProperty}:${cssPrimitiveText(value)}:${context.selectorSuffix}:${styleArrayJoin(context.atRules, '|')}`,
  )}`;
}

function conflictKey(cssProperty: string, context: CompileContext): string {
  return `${cssProperty}|${context.selectorSuffix}|${styleArrayJoin(context.atRules, '|')}`;
}

function serializeInlineStyle(style: InlineStyle): string {
  const declarations: string[] = [];
  const entries = styleOwnDataEntries(style, 'style.attrs inline style');
  for (let index = 0; index < entries.length; index += 1) {
    const [property, value] = entries[index] as readonly [string, unknown];
    assertCssPrimitive(value, 'style.attrs', property);
    assertCssSyntaxFragmentSafe(property, 'style.attrs', 'inline property', true);
    assertCssValueSafe(value, 'style.attrs', property, { allowBackslash: true });
    styleArrayPush(declarations, `${toKebabCase(property)}:${cssPrimitiveText(value)}`);
  }
  return styleArrayJoin(declarations, ';');
}

function isCompiledStyle(value: unknown): value is CompiledStyle {
  if (!value || typeof value !== 'object') return false;
  const marker = styleOwnDataValue(value, CSS_MARKER, 'style.attrs compiled style');
  return marker === true || (typeof marker === 'string' && marker.length > 0);
}

function isStyleOrFalsy(value: unknown): value is Style {
  return value == null || value === false || isCompiledStyle(value);
}

function isInlineStyle(value: unknown): value is InlineStyle {
  return Boolean(
    value && typeof value === 'object' && !styleArrayIsArray(value) && !isCompiledStyle(value),
  );
}

function isNestedStyle(value: unknown): value is StyleObject {
  return Boolean(value && typeof value === 'object');
}

function isSelectorSuffix(property: string): boolean {
  return (
    styleStringStartsWith(property, ':') ||
    styleStringStartsWith(property, '::') ||
    styleStringStartsWith(property, '[')
  );
}

function compareRules(left: AtomicRule, right: AtomicRule): number {
  return (
    left.priority - right.priority ||
    styleStringLocaleCompare(left.className, right.className) ||
    styleStringLocaleCompare(left.rule, right.rule)
  );
}

function propertyFamily(property: string): string {
  if (styleStringStartsWith(property, '--')) return 'var';
  if (styleStringStartsWith(property, 'background')) return 'bg';
  if (styleStringStartsWith(property, 'border')) return 'bd';
  if (styleStringStartsWith(property, 'padding')) return 'pad';
  if (styleStringStartsWith(property, 'margin')) return 'm';
  if (styleStringStartsWith(property, 'font')) return 'font';
  if (property === 'color') return 'fg';
  if (property === 'display') return 'd';
  if (property === 'height') return 'h';
  if (property === 'width') return 'w';
  return styleStringSplit(property, '-')[0] ?? 'x';
}

function toKebabCase(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character >= 'A' && character <= 'Z') {
      output += `-${asciiLower(character)}`;
    } else {
      output += character;
    }
  }
  return output;
}

function slug(value: string): string {
  const kebab = toKebabCase(value);
  let output = '';
  let previousWasSeparator = false;
  for (let index = 0; index < kebab.length && output.length < 48; index += 1) {
    const character = kebab[index] ?? '';
    const allowed =
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9') ||
      character === '_';
    if (allowed) {
      output += character;
      previousWasSeparator = false;
    } else if (!previousWasSeparator && output.length > 0) {
      output += '-';
      previousWasSeparator = true;
    }
  }
  while (output[output.length - 1] === '-') output = styleStringSlice(output, 0, -1);
  return output || 'style';
}

function asciiLower(character: string): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < upper.length; index += 1) {
    if (upper[index] === character) return lower[index] ?? character;
  }
  return character;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= styleStringCharCodeAt(value, index);
    result = styleMathImul(result, 0x01000193);
  }
  return styleStringSlice(styleNumberToBase36(result >>> 0), 0, 6);
}

function canonicalStyleData(value: unknown, label: string): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return styleJsonStringify(value);
  if (typeof value === 'number') return cssPrimitiveText(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (styleArrayIsArray(value)) {
    const entries = styleDenseArraySnapshot(value, label, (entry) => entry);
    const rendered: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      styleArrayPush(rendered, canonicalStyleData(entries[index], `${label}[${index}]`));
    }
    return `[${styleArrayJoin(rendered, ',')}]`;
  }
  if (typeof value === 'object') {
    const entries = styleOwnDataEntries(value, label);
    const rendered: string[] = [];
    for (let index = 0; index < entries.length; index += 1) {
      const [key, entry] = entries[index] as readonly [string, unknown];
      styleArrayPush(
        rendered,
        `${styleJsonStringify(key)}:${canonicalStyleData(entry, `${label}.${key}`)}`,
      );
    }
    return `{${styleArrayJoin(rendered, ',')}}`;
  }
  throw new TypeError(`${label} contains a non-data value.`);
}

function copyStrings(values: readonly string[], appended?: string): string[] {
  const copy: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    styleArrayPush(copy, values[index] as string);
  }
  if (appended !== undefined) styleArrayPush(copy, appended);
  return copy;
}
