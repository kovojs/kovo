import {
  Blend,
  CorePalette,
  Hct,
  MaterialDynamicColors,
  Scheme,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeFruitSalad,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
  type DynamicScheme,
  type Theme as MaterialTheme,
} from '@material/material-color-utilities';

import {
  assertCssCustomPropertyNameSafe,
  assertCssSelectorSafe,
  assertCssSyntaxFragmentSafe,
  assertCssValueSafe,
  cssPrimitiveText,
} from './css-security.js';
import {
  styleArrayIsArray,
  styleArrayJoin,
  styleArrayPush,
  styleArraySort,
  styleDefineDataProperty,
  styleFreeze,
  styleMathMax,
  styleMathMin,
  styleNullRecord,
  styleNumberIsFinite,
  styleOwnDataEntries,
  styleOwnDataValue,
  styleStringLocaleCompare,
  styleStringSplit,
} from './style-security-intrinsics.js';

/** Seed color accepted by Kovo's build-time theme generator. */
export type ThemeSeed = string | number;

/** Material dynamic-color scheme variants supported by Kovo's public adapter. */
export type ThemeVariant =
  | 'content'
  | 'expressive'
  | 'fidelity'
  | 'fruit-salad'
  | 'monochrome'
  | 'neutral'
  | 'rainbow'
  | 'tonal-spot'
  | 'vibrant';

/** Named semantic color to harmonize with the seed color. */
export interface ThemeCustomColorInput {
  readonly blend?: boolean;
  readonly value: ThemeSeed;
}

/** Custom semantic color map, such as `{ success: '#16a34a' }`. */
export type ThemeCustomColorsInput = Readonly<Record<string, ThemeSeed | ThemeCustomColorInput>>;

/** Shape tokens emitted beside color tokens for copied UI components. */
export interface ThemeShapeInput {
  readonly cornerFull?: string;
  readonly cornerLarge?: string;
  readonly cornerMedium?: string;
  readonly cornerSmall?: string;
}

/** Theme options for seed-generated Kovo themes. */
export interface ThemeFromSeedOptions {
  /** Additional semantic colors generated through Material custom-color groups. */
  readonly colors?: ThemeCustomColorsInput;
  /** Material contrast level from -1 to 1. Defaults to 0. */
  readonly contrast?: number;
  /** Selector that receives dark system-token overrides. Defaults to `:root[data-theme="dark"]`. */
  readonly darkSelector?: string;
  /** Emit reference palette tone variables. Defaults to true. */
  readonly emitRef?: boolean;
  /** Shape token overrides. */
  readonly shape?: ThemeShapeInput;
  /** Selector that receives light/default variables. Defaults to `:root`. */
  readonly selector?: string;
  /** Material dynamic scheme variant. Defaults to `tonal-spot`. */
  readonly variant?: ThemeVariant;
}

/**
 * @internal Override form for deriving one app theme from a generated base
 * theme. Not part of the v1 public surface: `defineTheme` advertises the
 * seed form (SPEC.md §13.1); the base-derivation arm is repo-internal.
 */
export interface DefineThemeFromBaseOptions {
  readonly base: KovoTheme;
  readonly component?: ThemeComponentTokensInput;
  readonly darkSelector?: string;
  readonly selector?: string;
  readonly shape?: ThemeShapeInput;
  readonly sys?: ThemeSystemOverrides;
}

/** App-facing theme definition. The v1 public surface is the seed form (SPEC.md §13.1). */
export type DefineThemeOptions = { readonly seed: ThemeSeed } & ThemeFromSeedOptions;

/** Material reference palette groups exposed by Kovo themes. */
export type ThemeReferencePaletteName =
  | 'error'
  | 'neutral'
  | 'neutralVariant'
  | 'primary'
  | 'secondary'
  | 'tertiary';

/** Material system color role names exposed as Kovo's semantic color contract. */
export type ThemeSystemColorName =
  | 'background'
  | 'error'
  | 'errorContainer'
  | 'inverseOnSurface'
  | 'inversePrimary'
  | 'inverseSurface'
  | 'onBackground'
  | 'onError'
  | 'onErrorContainer'
  | 'onPrimary'
  | 'onPrimaryContainer'
  | 'onPrimaryFixed'
  | 'onPrimaryFixedVariant'
  | 'onSecondary'
  | 'onSecondaryContainer'
  | 'onSecondaryFixed'
  | 'onSecondaryFixedVariant'
  | 'onSurface'
  | 'onSurfaceVariant'
  | 'onTertiary'
  | 'onTertiaryContainer'
  | 'onTertiaryFixed'
  | 'onTertiaryFixedVariant'
  | 'outline'
  | 'outlineVariant'
  | 'primary'
  | 'primaryContainer'
  | 'primaryFixed'
  | 'primaryFixedDim'
  | 'scrim'
  | 'secondary'
  | 'secondaryContainer'
  | 'secondaryFixed'
  | 'secondaryFixedDim'
  | 'shadow'
  | 'surface'
  | 'surfaceBright'
  | 'surfaceContainer'
  | 'surfaceContainerHigh'
  | 'surfaceContainerHighest'
  | 'surfaceContainerLow'
  | 'surfaceContainerLowest'
  | 'surfaceDim'
  | 'surfaceTint'
  | 'surfaceVariant'
  | 'tertiary'
  | 'tertiaryContainer'
  | 'tertiaryFixed'
  | 'tertiaryFixedDim';

/** System shape token names for Kovo UI components. */
export type ThemeShapeTokenName = 'cornerFull' | 'cornerLarge' | 'cornerMedium' | 'cornerSmall';

/** Four-role Material custom color group generated from one semantic color. */
export interface ThemeCustomColorGroup {
  readonly color: string;
  readonly colorContainer: string;
  readonly onColor: string;
  readonly onColorContainer: string;
}

/** Actual generated values for one light or dark scheme. */
export interface ThemeSchemeValues {
  readonly custom: Readonly<Record<string, ThemeCustomColorGroup>>;
  readonly sys: {
    readonly color: ThemeSystemColorValues;
    readonly shape: ThemeShapeValues;
  };
}

/** Generated Kovo theme object. Values are concrete CSS values; `tokens` exports `var(...)` refs. */
export interface KovoTheme {
  readonly css: string;
  readonly custom: Readonly<Record<string, ThemeCustomColorGroup>>;
  readonly dark: ThemeSchemeValues;
  readonly light: ThemeSchemeValues;
  readonly ref: ThemeReferencePalettes;
  readonly seed: string;
  readonly sys: {
    readonly color: ThemeSystemColorValues;
    readonly shape: ThemeShapeValues;
  };
  readonly variant: ThemeVariant;
}

/** Concrete Material reference palette values by tone. */
export type ThemeReferencePalettes = Readonly<
  Record<ThemeReferencePaletteName, Readonly<Record<number, string>>>
>;

/** Concrete Material system color role values. */
export type ThemeSystemColorValues = Readonly<Record<ThemeSystemColorName, string>>;

/** Concrete Kovo shape token values. */
export type ThemeShapeValues = Readonly<Record<ThemeShapeTokenName, string>>;

/** @internal Concrete component token values emitted as `--kovo-theme-component-*` (base-derivation only). */
export type ThemeComponentTokensInput = Readonly<Record<string, string | number>>;

/** @internal Concrete system-token overrides for derived themes (base-derivation only). */
export interface ThemeSystemOverrides {
  readonly color?: Partial<ThemeSystemColorValues>;
  readonly shape?: Partial<ThemeShapeValues>;
}

/** Typed public `var(...)` references for app-authored `style.create(...)` objects (SPEC.md §13.1). */
export interface ThemeTokens {
  readonly customColor: (name: string) => ThemeCustomColorGroup;
  readonly ref: {
    readonly palette: ThemeReferencePalettes;
  };
  readonly sys: {
    readonly color: ThemeSystemColorValues;
    readonly shape: ThemeShapeValues;
  };
}

/** @internal Typed theme token refs that also expose derived component tokens. */
export interface InternalThemeTokens extends ThemeTokens {
  readonly component: (name: string) => string;
}

const DEFAULT_VARIANT: ThemeVariant = 'tonal-spot';
const DEFAULT_SELECTOR = ':root';
const DEFAULT_DARK_SELECTOR = ':root[data-theme="dark"]';
const DEFAULT_DARK_MEDIA_SELECTOR = ':root:not([data-theme="light"])';
const REFERENCE_TONES = [0, 10, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100];
const REFERENCE_PALETTE_NAMES = [
  'primary',
  'secondary',
  'tertiary',
  'neutral',
  'neutralVariant',
  'error',
] as const satisfies readonly ThemeReferencePaletteName[];
const SYSTEM_COLOR_NAMES = [
  'background',
  'onBackground',
  'surface',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'onSurface',
  'surfaceVariant',
  'onSurfaceVariant',
  'outline',
  'outlineVariant',
  'inverseSurface',
  'inverseOnSurface',
  'shadow',
  'scrim',
  'surfaceTint',
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'inversePrimary',
  'primaryFixed',
  'primaryFixedDim',
  'onPrimaryFixed',
  'onPrimaryFixedVariant',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'secondaryFixed',
  'secondaryFixedDim',
  'onSecondaryFixed',
  'onSecondaryFixedVariant',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'tertiaryFixed',
  'tertiaryFixedDim',
  'onTertiaryFixed',
  'onTertiaryFixedVariant',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
] as const satisfies readonly ThemeSystemColorName[];
const SHAPE_DEFAULTS = {
  cornerFull: '9999px',
  cornerLarge: '0.75rem',
  cornerMedium: '0.5rem',
  cornerSmall: '0.25rem',
} as const satisfies ThemeShapeValues;

/** Theme token references for authored styles; generated CSS supplies the values. */
const publicThemeTokens = deepFreezeData({
  customColor: (name: string) =>
    ({
      color: `var(${themeVar('custom', name, 'color')})`,
      colorContainer: `var(${themeVar('custom', name, 'color-container')})`,
      onColor: `var(${themeVar('custom', name, 'on-color')})`,
      onColorContainer: `var(${themeVar('custom', name, 'on-color-container')})`,
    }) satisfies ThemeCustomColorGroup,
  ref: {
    palette: referenceTokenVars(),
  },
  sys: {
    color: systemColorTokenVars(),
    shape: shapeTokenVars(),
  },
}) satisfies ThemeTokens;

/** Typed public token refs for app-authored source (SPEC.md §13.1). */
export const tokens = publicThemeTokens;

/** @internal Internal theme tokens include derived component vars for generated/repo-owned code only. */
export const internalThemeTokens = deepFreezeData({
  ...publicThemeTokens,
  component: (name: string) => `var(${themeVar('component', name)})`,
}) satisfies InternalThemeTokens;

/**
 * @internal Generate a Kovo theme from one seed color. Color math is build-time
 * and wraps Material Color Utilities without leaking upstream classes into app
 * code. The public seed entry point is `defineTheme({ seed })` (SPEC.md §13.1),
 * which delegates here.
 */
export function themeFromSeed(seed: ThemeSeed, options: ThemeFromSeedOptions = {}): KovoTheme {
  assertThemeSeed(seed, 'style.themeFromSeed seed');
  const stableOptions = snapshotThemeOptions(options);
  const argb = seedToArgb(seed);
  const variant = stableOptions.variant ?? DEFAULT_VARIANT;
  const contrast = clampContrast(stableOptions.contrast ?? 0);
  if (variant !== 'tonal-spot' || contrast !== 0) {
    return dynamicThemeFromSeed(argb, variant, contrast, stableOptions);
  }
  const material = createMaterialTheme(argb, variant);
  const ref = referencePalettes(material);
  const light = schemeValues(argb, material, false, stableOptions);
  const dark = schemeValues(argb, material, true, stableOptions);

  return themeFromValues({
    custom: light.custom,
    dark,
    emitRef: stableOptions.emitRef ?? true,
    light,
    ref,
    seed: hexFromArgb(argb),
    selector: stableOptions.selector ?? DEFAULT_SELECTOR,
    darkSelector: stableOptions.darkSelector ?? DEFAULT_DARK_SELECTOR,
    sys: light.sys,
    variant,
  });
}

function snapshotThemeOptions(options: ThemeFromSeedOptions): ThemeFromSeedOptions {
  assertPlainThemeRecord(options, 'style.defineTheme options');
  const contrast = styleOwnDataValue(options, 'contrast', 'style.defineTheme options');
  const darkSelector = styleOwnDataValue(options, 'darkSelector', 'style.defineTheme options');
  const emitRef = styleOwnDataValue(options, 'emitRef', 'style.defineTheme options');
  const selector = styleOwnDataValue(options, 'selector', 'style.defineTheme options');
  const variant = styleOwnDataValue(options, 'variant', 'style.defineTheme options');
  if (contrast !== undefined && (typeof contrast !== 'number' || !styleNumberIsFinite(contrast))) {
    throw new TypeError(
      'style.defineTheme options.contrast must be a finite number own data property.',
    );
  }
  if (emitRef !== undefined && typeof emitRef !== 'boolean') {
    throw new TypeError('style.defineTheme options.emitRef must be a boolean own data property.');
  }
  if (selector !== undefined && typeof selector !== 'string') {
    throw new TypeError('style.defineTheme options.selector must be a string own data property.');
  }
  if (darkSelector !== undefined && typeof darkSelector !== 'string') {
    throw new TypeError(
      'style.defineTheme options.darkSelector must be a string own data property.',
    );
  }
  if (selector !== undefined) assertCssSelectorSafe(selector, 'style.defineTheme', 'selector');
  if (darkSelector !== undefined) {
    assertCssSelectorSafe(darkSelector, 'style.defineTheme', 'darkSelector');
  }
  if (variant !== undefined && !isThemeVariant(variant)) {
    throw new TypeError('style.defineTheme options.variant must be a supported theme variant.');
  }

  const colorsValue = styleOwnDataValue(options, 'colors', 'style.defineTheme options');
  const shapeValue = styleOwnDataValue(options, 'shape', 'style.defineTheme options');
  const colors = colorsValue === undefined ? undefined : snapshotThemeColors(colorsValue);
  const shape = shapeValue === undefined ? undefined : snapshotThemeShape(shapeValue);
  return styleFreeze({
    ...(colors === undefined ? {} : { colors }),
    ...(contrast === undefined ? {} : { contrast }),
    ...(darkSelector === undefined ? {} : { darkSelector }),
    ...(emitRef === undefined ? {} : { emitRef }),
    ...(selector === undefined ? {} : { selector }),
    ...(shape === undefined ? {} : { shape }),
    ...(variant === undefined ? {} : { variant }),
  });
}

function snapshotThemeColors(value: unknown): ThemeCustomColorsInput {
  assertPlainThemeRecord(value, 'style.defineTheme options.colors');
  const snapshot = styleNullRecord<ThemeSeed | ThemeCustomColorInput>();
  const entries = styleOwnDataEntries(value, 'style.defineTheme options.colors');
  for (let index = 0; index < entries.length; index += 1) {
    const [name, input] = entries[index] as readonly [string, unknown];
    // Validate the final custom-property spelling now; it also rejects markup/rule delimiters.
    themeVar('custom', name, 'color');
    let stableInput: ThemeSeed | ThemeCustomColorInput;
    if (typeof input === 'object' && input !== null) {
      assertPlainThemeRecord(input, `style.defineTheme options.colors.${name}`);
      const seed = styleOwnDataValue(input, 'value', `style.defineTheme options.colors.${name}`);
      const blend = styleOwnDataValue(input, 'blend', `style.defineTheme options.colors.${name}`);
      assertThemeSeed(seed, `style.defineTheme options.colors.${name}.value`);
      if (blend !== undefined && typeof blend !== 'boolean') {
        throw new TypeError(`style.defineTheme options.colors.${name}.blend must be boolean.`);
      }
      stableInput = styleFreeze({
        ...(blend === undefined ? {} : { blend }),
        value: seed,
      });
    } else {
      assertThemeSeed(input, `style.defineTheme options.colors.${name}`);
      stableInput = input;
    }
    styleDefineDataProperty(snapshot, name, stableInput);
  }
  return styleFreeze(snapshot);
}

function snapshotThemeShape(value: unknown): ThemeShapeInput {
  assertPlainThemeRecord(value, 'style.defineTheme options.shape');
  const snapshot = styleNullRecord<string>();
  const entries = styleOwnDataEntries(value, 'style.defineTheme options.shape');
  for (let index = 0; index < entries.length; index += 1) {
    const [name, shapeValue] = entries[index] as readonly [string, unknown];
    if (!isThemeShapeName(name)) {
      throw new TypeError(
        `style.defineTheme options.shape.${name} is not a supported shape token.`,
      );
    }
    if (typeof shapeValue !== 'string') {
      throw new TypeError(`style.defineTheme options.shape.${name} must be a string.`);
    }
    assertCssValueSafe(shapeValue, 'style.defineTheme', `shape.${name}`);
    styleDefineDataProperty(snapshot, name, shapeValue);
  }
  return styleFreeze(snapshot) as ThemeShapeInput;
}

function assertThemeSeed(value: unknown, label: string): asserts value is ThemeSeed {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !styleNumberIsFinite(value))
  ) {
    throw new TypeError(`${label} must be a string or finite number.`);
  }
}

function assertPlainThemeRecord(value: unknown, label: string): asserts value is object {
  if (typeof value !== 'object' || value === null)
    throw new TypeError(`${label} must be an object.`);
  styleOwnDataEntries(value, label);
}

function isThemeVariant(value: unknown): value is ThemeVariant {
  switch (value) {
    case 'content':
    case 'expressive':
    case 'fidelity':
    case 'fruit-salad':
    case 'monochrome':
    case 'neutral':
    case 'rainbow':
    case 'tonal-spot':
    case 'vibrant':
      return true;
    default:
      return false;
  }
}

function isThemeShapeName(value: string): value is ThemeShapeTokenName {
  return (
    value === 'cornerFull' ||
    value === 'cornerLarge' ||
    value === 'cornerMedium' ||
    value === 'cornerSmall'
  );
}

function dynamicThemeFromSeed(
  argb: number,
  variant: ThemeVariant,
  contrast: number,
  options: ThemeFromSeedOptions,
): KovoTheme {
  const source = Hct.fromInt(argb);
  const lightScheme = createDynamicScheme(source, variant, false, contrast);
  const darkScheme = createDynamicScheme(source, variant, true, contrast);
  const ref = dynamicReferencePalettes(lightScheme);
  const light = dynamicSchemeValues(argb, lightScheme, false, options);
  const dark = dynamicSchemeValues(argb, darkScheme, true, options);

  return themeFromValues({
    custom: light.custom,
    dark,
    emitRef: options.emitRef ?? true,
    light,
    ref,
    seed: hexFromArgb(argb),
    selector: options.selector ?? DEFAULT_SELECTOR,
    darkSelector: options.darkSelector ?? DEFAULT_DARK_SELECTOR,
    sys: light.sys,
    variant,
  });
}

/**
 * Define the app theme from one seed color. The v1 public surface is the
 * seed form (SPEC.md §13.1); deriving from a generated base theme is a
 * repo-internal capability exposed through `defineThemeFromBase`.
 */
export function defineTheme(options: DefineThemeOptions): KovoTheme {
  assertPlainThemeRecord(options, 'style.defineTheme options');
  const seed = styleOwnDataValue(options, 'seed', 'style.defineTheme options');
  assertThemeSeed(seed, 'style.defineTheme options.seed');
  return themeFromSeed(seed, options);
}

/**
 * @internal Derive one final theme from a generated base theme without callback
 * overrides. Not part of the v1 public surface; kept for repo-internal callers
 * and conformance tests (SPEC.md §13.1).
 */
export function defineThemeFromBase(options: DefineThemeFromBaseOptions): KovoTheme {
  const light = mergeScheme(options.base.light, options.sys, options.shape);
  const dark = mergeScheme(options.base.dark, options.sys, options.shape);
  const component = options.component ?? {};

  return themeFromValues({
    component,
    custom: light.custom,
    dark,
    emitRef: true,
    light,
    ref: options.base.ref,
    seed: options.base.seed,
    selector: options.selector ?? DEFAULT_SELECTOR,
    darkSelector: options.darkSelector ?? DEFAULT_DARK_SELECTOR,
    sys: light.sys,
    variant: options.base.variant,
  });
}

interface ThemeValuesInput {
  readonly component?: ThemeComponentTokensInput;
  readonly custom: Readonly<Record<string, ThemeCustomColorGroup>>;
  readonly dark: ThemeSchemeValues;
  readonly darkSelector: string;
  readonly emitRef: boolean;
  readonly light: ThemeSchemeValues;
  readonly ref: ThemeReferencePalettes;
  readonly seed: string;
  readonly selector: string;
  readonly sys: ThemeSchemeValues['sys'];
  readonly variant: ThemeVariant;
}

function themeFromValues(input: ThemeValuesInput): KovoTheme {
  const theme = {
    css: emitThemeCss(input),
    custom: input.custom,
    dark: input.dark,
    light: input.light,
    ref: input.ref,
    seed: input.seed,
    sys: input.sys,
    variant: input.variant,
  };
  return deepFreezeData(theme);
}

function createMaterialTheme(argb: number, variant: ThemeVariant): MaterialTheme {
  if (variant === 'content') {
    const palette = CorePalette.contentOf(argb);
    return {
      customColors: [],
      palettes: {
        error: palette.error,
        neutral: palette.n1,
        neutralVariant: palette.n2,
        primary: palette.a1,
        secondary: palette.a2,
        tertiary: palette.a3,
      },
      schemes: {
        dark: Scheme.darkFromCorePalette(palette),
        light: Scheme.lightFromCorePalette(palette),
      },
      source: argb,
    };
  }
  return themeFromSourceColor(argb);
}

function createDynamicScheme(
  source: Hct,
  variant: ThemeVariant,
  isDark: boolean,
  contrast: number,
): DynamicScheme {
  switch (variant) {
    case 'content':
      return new SchemeContent(source, isDark, contrast);
    case 'expressive':
      return new SchemeExpressive(source, isDark, contrast);
    case 'fidelity':
      return new SchemeFidelity(source, isDark, contrast);
    case 'fruit-salad':
      return new SchemeFruitSalad(source, isDark, contrast);
    case 'monochrome':
      return new SchemeMonochrome(source, isDark, contrast);
    case 'neutral':
      return new SchemeNeutral(source, isDark, contrast);
    case 'rainbow':
      return new SchemeRainbow(source, isDark, contrast);
    case 'vibrant':
      return new SchemeVibrant(source, isDark, contrast);
    case 'tonal-spot':
      return new SchemeTonalSpot(source, isDark, contrast);
  }
}

function schemeValues(
  sourceArgb: number,
  material: MaterialTheme,
  isDark: boolean,
  options: Pick<ThemeFromSeedOptions, 'colors' | 'shape'>,
): ThemeSchemeValues {
  return {
    custom: customColors(sourceArgb, isDark, options.colors ?? {}),
    sys: {
      color: systemColors(material, isDark),
      shape: { ...SHAPE_DEFAULTS, ...options.shape },
    },
  };
}

function dynamicSchemeValues(
  sourceArgb: number,
  scheme: DynamicScheme,
  isDark: boolean,
  options: Pick<ThemeFromSeedOptions, 'colors' | 'shape'>,
): ThemeSchemeValues {
  return {
    custom: customColors(sourceArgb, isDark, options.colors ?? {}),
    sys: {
      color: dynamicSystemColors(scheme),
      shape: { ...SHAPE_DEFAULTS, ...options.shape },
    },
  };
}

function systemColors(material: MaterialTheme, isDark: boolean): ThemeSystemColorValues {
  const scheme = isDark ? material.schemes.dark : material.schemes.light;
  const schemeValues = scheme.toJSON() as Partial<Record<ThemeSystemColorName, number>>;
  const neutral = material.palettes.neutral;
  const primary = material.palettes.primary;
  const secondary = material.palettes.secondary;
  const tertiary = material.palettes.tertiary;
  const values: Partial<Record<ThemeSystemColorName, string>> = {};
  for (let index = 0; index < SYSTEM_COLOR_NAMES.length; index += 1) {
    const name = SYSTEM_COLOR_NAMES[index] as ThemeSystemColorName;
    values[name] = roleHex(schemeValues[name] ?? 0);
  }
  values.surfaceDim = paletteHex(neutral, isDark ? 6 : 87);
  values.surfaceBright = paletteHex(neutral, isDark ? 24 : 98);
  values.surfaceContainerLowest = paletteHex(neutral, isDark ? 4 : 100);
  values.surfaceContainerLow = paletteHex(neutral, isDark ? 10 : 96);
  values.surfaceContainer = paletteHex(neutral, isDark ? 12 : 94);
  values.surfaceContainerHigh = paletteHex(neutral, isDark ? 17 : 92);
  values.surfaceContainerHighest = paletteHex(neutral, isDark ? 22 : 90);
  values.surfaceTint = roleHex(schemeValues.primary ?? 0);
  values.primaryFixed = paletteHex(primary, 90);
  values.primaryFixedDim = paletteHex(primary, 80);
  values.onPrimaryFixed = paletteHex(primary, 10);
  values.onPrimaryFixedVariant = paletteHex(primary, 30);
  values.secondaryFixed = paletteHex(secondary, 90);
  values.secondaryFixedDim = paletteHex(secondary, 80);
  values.onSecondaryFixed = paletteHex(secondary, 10);
  values.onSecondaryFixedVariant = paletteHex(secondary, 30);
  values.tertiaryFixed = paletteHex(tertiary, 90);
  values.tertiaryFixedDim = paletteHex(tertiary, 80);
  values.onTertiaryFixed = paletteHex(tertiary, 10);
  values.onTertiaryFixedVariant = paletteHex(tertiary, 30);
  return values as ThemeSystemColorValues;
}

function dynamicSystemColors(scheme: DynamicScheme): ThemeSystemColorValues {
  const values: Partial<Record<ThemeSystemColorName, string>> = {};
  const material = MaterialDynamicColors as unknown as Record<
    string,
    { getArgb: (scheme: DynamicScheme) => number } | undefined
  >;
  for (let index = 0; index < SYSTEM_COLOR_NAMES.length; index += 1) {
    const name = SYSTEM_COLOR_NAMES[index] as ThemeSystemColorName;
    const color = material[name];
    if (color) values[name] = hexFromArgb(color.getArgb(scheme));
  }
  values.surfaceTint = values.primary ?? paletteHex(scheme.primaryPalette, scheme.isDark ? 80 : 40);
  return values as ThemeSystemColorValues;
}

function customColors(
  sourceArgb: number,
  isDark: boolean,
  colors: ThemeCustomColorsInput,
): Readonly<Record<string, ThemeCustomColorGroup>> {
  const result = styleNullRecord<ThemeCustomColorGroup>();
  const colorEntries = styleOwnDataEntries(colors, 'style.defineTheme colors');
  for (let index = 0; index < colorEntries.length; index += 1) {
    const [name, input] = colorEntries[index] as readonly [
      string,
      ThemeSeed | ThemeCustomColorInput,
    ];
    const color = typeof input === 'object' ? input : { value: input, blend: true };
    const targetArgb = seedToArgb(color.value);
    const valueArgb = color.blend === false ? targetArgb : Blend.harmonize(targetArgb, sourceArgb);
    const palette = Hct.fromInt(valueArgb).toInt();
    styleDefineDataProperty(
      result,
      name,
      styleFreeze({
        color: hexFromArgb(tone(palette, isDark ? 80 : 40)),
        colorContainer: hexFromArgb(tone(palette, isDark ? 30 : 90)),
        onColor: hexFromArgb(tone(palette, isDark ? 20 : 100)),
        onColorContainer: hexFromArgb(tone(palette, isDark ? 90 : 10)),
      }),
    );
  }
  return result;
}

function tone(argb: number, toneValue: number): number {
  const hct = Hct.fromInt(argb);
  hct.tone = toneValue;
  return hct.toInt();
}

function referencePalettes(theme: MaterialTheme): ThemeReferencePalettes {
  return {
    error: paletteTones(theme.palettes.error),
    neutral: paletteTones(theme.palettes.neutral),
    neutralVariant: paletteTones(theme.palettes.neutralVariant),
    primary: paletteTones(theme.palettes.primary),
    secondary: paletteTones(theme.palettes.secondary),
    tertiary: paletteTones(theme.palettes.tertiary),
  };
}

function dynamicReferencePalettes(scheme: DynamicScheme): ThemeReferencePalettes {
  return {
    error: paletteTones(scheme.errorPalette),
    neutral: paletteTones(scheme.neutralPalette),
    neutralVariant: paletteTones(scheme.neutralVariantPalette),
    primary: paletteTones(scheme.primaryPalette),
    secondary: paletteTones(scheme.secondaryPalette),
    tertiary: paletteTones(scheme.tertiaryPalette),
  };
}

function roleHex(argb: number): string {
  return hexFromArgb(argb);
}

function paletteHex(palette: { tone: (tone: number) => number }, toneValue: number): string {
  return hexFromArgb(palette.tone(toneValue));
}

function paletteTones(palette: {
  tone: (tone: number) => number;
}): Readonly<Record<number, string>> {
  const values: Record<number, string> = {};
  for (let index = 0; index < REFERENCE_TONES.length; index += 1) {
    const toneValue = REFERENCE_TONES[index] as number;
    values[toneValue] = hexFromArgb(palette.tone(toneValue));
  }
  return values;
}

function mergeScheme(
  scheme: ThemeSchemeValues,
  sys: ThemeSystemOverrides | undefined,
  shape: ThemeShapeInput | undefined,
): ThemeSchemeValues {
  return {
    custom: scheme.custom,
    sys: {
      color: { ...scheme.sys.color, ...sys?.color },
      shape: { ...scheme.sys.shape, ...sys?.shape, ...shape },
    },
  };
}

function emitThemeCss(input: ThemeValuesInput): string {
  const rootDeclarations: string[] = [];
  if (input.emitRef) appendStrings(rootDeclarations, refDeclarations(input.ref));
  appendStrings(rootDeclarations, sysColorDeclarations(input.light.sys.color));
  appendStrings(rootDeclarations, shapeDeclarations(input.light.sys.shape));
  appendStrings(rootDeclarations, customDeclarations(input.light.custom));
  appendStrings(rootDeclarations, componentDeclarations(input.component ?? {}));
  const darkDeclarations: string[] = [];
  appendStrings(darkDeclarations, sysColorDeclarations(input.dark.sys.color));
  appendStrings(darkDeclarations, shapeDeclarations(input.dark.sys.shape));
  appendStrings(darkDeclarations, customDeclarations(input.dark.custom));
  const darkBlocks =
    input.darkSelector === DEFAULT_DARK_SELECTOR
      ? [
          renderMediaBlock(
            '(prefers-color-scheme: dark)',
            DEFAULT_DARK_MEDIA_SELECTOR,
            darkDeclarations,
          ),
          renderBlock(input.darkSelector, darkDeclarations),
        ]
      : [renderBlock(input.darkSelector, darkDeclarations)];
  const blocks = [renderBlock(input.selector, rootDeclarations)];
  appendStrings(blocks, darkBlocks);
  return styleArrayJoin(blocks, '\n\n');
}

function refDeclarations(ref: ThemeReferencePalettes): string[] {
  const declarations: string[] = [];
  for (let paletteIndex = 0; paletteIndex < REFERENCE_PALETTE_NAMES.length; paletteIndex += 1) {
    const palette = REFERENCE_PALETTE_NAMES[paletteIndex] as ThemeReferencePaletteName;
    for (let toneIndex = 0; toneIndex < REFERENCE_TONES.length; toneIndex += 1) {
      const toneValue = REFERENCE_TONES[toneIndex] as number;
      const value = ref[palette][toneValue];
      if (typeof value !== 'string') {
        throw new TypeError(`style.defineTheme ref.${palette}.${toneValue} must be a string.`);
      }
      assertCssValueSafe(value, 'style.defineTheme', `ref.${palette}.${toneValue}`);
      styleArrayPush(
        declarations,
        `${themeVar('ref', 'palette', toKebabCase(palette), cssPrimitiveText(toneValue))}: ${value};`,
      );
    }
  }
  return declarations;
}

function sysColorDeclarations(colors: ThemeSystemColorValues): string[] {
  const declarations: string[] = [];
  for (let index = 0; index < SYSTEM_COLOR_NAMES.length; index += 1) {
    const name = SYSTEM_COLOR_NAMES[index] as ThemeSystemColorName;
    const value = styleOwnDataValue(colors, name, 'style.defineTheme system colors');
    if (typeof value !== 'string')
      throw new TypeError(`style.defineTheme system color ${name} must be a string.`);
    assertCssValueSafe(value, 'style.defineTheme', `sys.color.${name}`);
    styleArrayPush(declarations, `${themeVar('sys', 'color', toKebabCase(name))}: ${value};`);
  }
  return declarations;
}

function shapeDeclarations(shape: ThemeShapeValues): string[] {
  const declarations: string[] = [];
  const entries = styleOwnDataEntries(shape, 'style.defineTheme shape');
  for (let index = 0; index < entries.length; index += 1) {
    const [name, value] = entries[index] as readonly [string, unknown];
    if (typeof value !== 'string')
      throw new TypeError(`style.defineTheme shape ${name} must be a string.`);
    assertCssValueSafe(value, 'style.defineTheme', `shape.${name}`);
    styleArrayPush(declarations, `${themeVar('sys', 'shape', toKebabCase(name))}: ${value};`);
  }
  return declarations;
}

function customDeclarations(custom: Readonly<Record<string, ThemeCustomColorGroup>>): string[] {
  const declarations: string[] = [];
  const entries = mutableEntryCopy(styleOwnDataEntries(custom, 'style.defineTheme custom colors'));
  styleArraySort(entries, ([left], [right]) => styleStringLocaleCompare(left, right));
  for (let index = 0; index < entries.length; index += 1) {
    const [name, group] = entries[index] as readonly [string, unknown];
    assertPlainThemeRecord(group, `style.defineTheme custom color ${name}`);
    const color = requiredCssString(group, 'color', `custom.${name}`);
    const onColor = requiredCssString(group, 'onColor', `custom.${name}`);
    const colorContainer = requiredCssString(group, 'colorContainer', `custom.${name}`);
    const onColorContainer = requiredCssString(group, 'onColorContainer', `custom.${name}`);
    styleArrayPush(declarations, `${themeVar('custom', name, 'color')}: ${color};`);
    styleArrayPush(declarations, `${themeVar('custom', name, 'on-color')}: ${onColor};`);
    styleArrayPush(
      declarations,
      `${themeVar('custom', name, 'color-container')}: ${colorContainer};`,
    );
    styleArrayPush(
      declarations,
      `${themeVar('custom', name, 'on-color-container')}: ${onColorContainer};`,
    );
  }
  return declarations;
}

function componentDeclarations(component: ThemeComponentTokensInput): string[] {
  const entries = mutableEntryCopy(
    styleOwnDataEntries(component, 'style.defineTheme component tokens'),
  );
  styleArraySort(entries, ([left], [right]) => styleStringLocaleCompare(left, right));
  const declarations: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const [name, value] = entries[index] as readonly [string, unknown];
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError(`style.defineTheme component token ${name} must be a string or number.`);
    }
    const text = cssPrimitiveText(value);
    assertCssValueSafe(value, 'style.defineTheme', `component.${name}`);
    styleArrayPush(declarations, `${themeVar('component', name)}: ${text};`);
  }
  return declarations;
}

function renderBlock(selector: string, declarations: readonly string[]): string {
  assertCssSelectorSafe(selector, 'style.defineTheme', 'selector');
  const indented: string[] = [];
  for (let index = 0; index < declarations.length; index += 1) {
    styleArrayPush(indented, `  ${declarations[index] as string}`);
  }
  return `${selector} {\n${styleArrayJoin(indented, '\n')}\n}`;
}

function renderMediaBlock(
  query: string,
  selector: string,
  declarations: readonly string[],
): string {
  assertCssSyntaxFragmentSafe(query, 'style.defineTheme', 'media query');
  const lines = styleStringSplit(renderBlock(selector, declarations), '\n');
  const indented: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    styleArrayPush(indented, `  ${lines[index] as string}`);
  }
  return `@media ${query} {\n${styleArrayJoin(indented, '\n')}\n}`;
}

function referenceTokenVars(): ThemeReferencePalettes {
  const palettes: Partial<Record<ThemeReferencePaletteName, Readonly<Record<number, string>>>> = {};
  for (let paletteIndex = 0; paletteIndex < REFERENCE_PALETTE_NAMES.length; paletteIndex += 1) {
    const palette = REFERENCE_PALETTE_NAMES[paletteIndex] as ThemeReferencePaletteName;
    const tones: Record<number, string> = {};
    for (let toneIndex = 0; toneIndex < REFERENCE_TONES.length; toneIndex += 1) {
      const toneValue = REFERENCE_TONES[toneIndex] as number;
      tones[toneValue] =
        `var(${themeVar('ref', 'palette', toKebabCase(palette), cssPrimitiveText(toneValue))})`;
    }
    palettes[palette] = tones;
  }
  return palettes as ThemeReferencePalettes;
}

function systemColorTokenVars(): ThemeSystemColorValues {
  const result: Partial<Record<ThemeSystemColorName, string>> = {};
  for (let index = 0; index < SYSTEM_COLOR_NAMES.length; index += 1) {
    const name = SYSTEM_COLOR_NAMES[index] as ThemeSystemColorName;
    result[name] = `var(${themeVar('sys', 'color', toKebabCase(name))})`;
  }
  return result as ThemeSystemColorValues;
}

function shapeTokenVars(): ThemeShapeValues {
  return {
    cornerFull: `var(${themeVar('sys', 'shape', 'corner-full')})`,
    cornerLarge: `var(${themeVar('sys', 'shape', 'corner-large')})`,
    cornerMedium: `var(${themeVar('sys', 'shape', 'corner-medium')})`,
    cornerSmall: `var(${themeVar('sys', 'shape', 'corner-small')})`,
  };
}

function seedToArgb(seed: ThemeSeed): number {
  if (typeof seed === 'number') return seed;
  return argbFromHex(seed);
}

function clampContrast(contrast: number): number {
  return styleMathMax(-1, styleMathMin(1, contrast));
}

function themeVar(...parts: readonly string[]): string {
  const normalized: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    styleArrayPush(normalized, toKebabCase(parts[index] as string));
  }
  const property = `--kovo-theme-${styleArrayJoin(normalized, '-')}`;
  assertCssCustomPropertyNameSafe(property, 'style.defineTheme', styleArrayJoin(parts, '.'));
  return property;
}

function toKebabCase(value: string): string {
  let output = '';
  let previousWasLowerOrDigit = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    const upper = character >= 'A' && character <= 'Z';
    const separator =
      character === '_' ||
      character === ' ' ||
      character === '\t' ||
      character === '\n' ||
      character === '\r' ||
      character === '\f';
    if (separator) {
      if (output[output.length - 1] !== '-') output += '-';
      previousWasLowerOrDigit = false;
      continue;
    }
    if (upper && previousWasLowerOrDigit) output += '-';
    output += upper ? themeAsciiLower(character) : character;
    previousWasLowerOrDigit =
      (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9');
  }
  return output;
}

function themeAsciiLower(character: string): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  for (let index = 0; index < upper.length; index += 1) {
    if (upper[index] === character) return lower[index] ?? character;
  }
  return character;
}

function requiredCssString(value: object, property: string, label: string): string {
  const result = styleOwnDataValue(value, property, label);
  if (typeof result !== 'string') {
    throw new TypeError(`style.defineTheme ${label}.${property} must be a string.`);
  }
  assertCssValueSafe(result, 'style.defineTheme', `${label}.${property}`);
  return result;
}

function mutableEntryCopy(
  entries: readonly (readonly [string, unknown])[],
): (readonly [string, unknown])[] {
  const copy: (readonly [string, unknown])[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    styleArrayPush(copy, entries[index] as readonly [string, unknown]);
  }
  return copy;
}

function deepFreezeData<T>(value: T): T {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return value;
  if (styleArrayIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) deepFreezeData(value[index]);
    return styleFreeze(value) as T;
  }
  if (typeof value === 'function') return styleFreeze(value) as T;
  const entries = styleOwnDataEntries(value, 'style theme output');
  for (let index = 0; index < entries.length; index += 1) {
    deepFreezeData((entries[index] as readonly [string, unknown])[1]);
  }
  return styleFreeze(value) as T;
}

function appendStrings(target: string[], values: readonly string[]): void {
  for (let index = 0; index < values.length; index += 1) {
    styleArrayPush(target, values[index] as string);
  }
}
