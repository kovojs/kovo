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

/** Override form for deriving one app theme from a generated base theme. */
export interface DefineThemeFromBaseOptions {
  readonly base: KovoTheme;
  readonly component?: ThemeComponentTokensInput;
  readonly darkSelector?: string;
  readonly selector?: string;
  readonly shape?: ThemeShapeInput;
  readonly sys?: ThemeSystemOverrides;
}

/** Common app-facing theme definition. */
export type DefineThemeOptions =
  | ({ readonly seed: ThemeSeed } & ThemeFromSeedOptions)
  | DefineThemeFromBaseOptions;

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

/** Concrete component token values emitted as `--kovo-theme-component-*`. */
export type ThemeComponentTokensInput = Readonly<Record<string, string | number>>;

/** Concrete system-token overrides for derived themes. */
export interface ThemeSystemOverrides {
  readonly color?: Partial<ThemeSystemColorValues>;
  readonly shape?: Partial<ThemeShapeValues>;
}

/** Typed `var(...)` references for Kovo theme tokens used inside `style.create(...)`. */
export interface ThemeTokens {
  readonly component: (name: string) => string;
  readonly customColor: (name: string) => ThemeCustomColorGroup;
  readonly ref: {
    readonly palette: ThemeReferencePalettes;
  };
  readonly sys: {
    readonly color: ThemeSystemColorValues;
    readonly shape: ThemeShapeValues;
  };
}

const DEFAULT_VARIANT: ThemeVariant = 'tonal-spot';
const DEFAULT_SELECTOR = ':root';
const DEFAULT_DARK_SELECTOR = ':root[data-theme="dark"]';
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
export const tokens = Object.freeze({
  component: (name: string) => `var(${themeVar('component', name)})`,
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

/**
 * Generate a Kovo theme from one seed color. Color math is build-time and wraps
 * Material Color Utilities without leaking upstream classes into app code.
 */
export function themeFromSeed(seed: ThemeSeed, options: ThemeFromSeedOptions = {}): KovoTheme {
  const argb = seedToArgb(seed);
  const variant = options.variant ?? DEFAULT_VARIANT;
  const contrast = clampContrast(options.contrast ?? 0);
  if (variant !== 'tonal-spot' || contrast !== 0) {
    return dynamicThemeFromSeed(argb, variant, contrast, options);
  }
  const material = createMaterialTheme(argb, variant);
  const ref = referencePalettes(material);
  const light = schemeValues(argb, material, false, options);
  const dark = schemeValues(argb, material, true, options);

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
 * Define the app theme. The common form is seed-based; the `base` form derives
 * one final theme from generated values without callback overrides.
 */
export function defineTheme(options: DefineThemeOptions): KovoTheme {
  if ('base' in options) return defineThemeFromBase(options);
  return themeFromSeed(options.seed, options);
}

function defineThemeFromBase(options: DefineThemeFromBaseOptions): KovoTheme {
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
  return {
    css: emitThemeCss(input),
    custom: input.custom,
    dark: input.dark,
    light: input.light,
    ref: input.ref,
    seed: input.seed,
    sys: input.sys,
    variant: input.variant,
  };
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
  for (const name of SYSTEM_COLOR_NAMES) values[name] = roleHex(schemeValues[name] ?? 0);
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
  for (const name of SYSTEM_COLOR_NAMES) {
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
  const result: Record<string, ThemeCustomColorGroup> = {};
  for (const [name, input] of Object.entries(colors)) {
    const color = typeof input === 'object' ? input : { value: input, blend: true };
    const targetArgb = seedToArgb(color.value);
    const valueArgb = color.blend === false ? targetArgb : Blend.harmonize(targetArgb, sourceArgb);
    const palette = Hct.fromInt(valueArgb).toInt();
    result[name] = {
      color: hexFromArgb(tone(palette, isDark ? 80 : 40)),
      colorContainer: hexFromArgb(tone(palette, isDark ? 30 : 90)),
      onColor: hexFromArgb(tone(palette, isDark ? 20 : 100)),
      onColorContainer: hexFromArgb(tone(palette, isDark ? 90 : 10)),
    };
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
  for (const toneValue of REFERENCE_TONES) {
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
  const rootDeclarations = [
    ...(input.emitRef ? refDeclarations(input.ref) : []),
    ...sysColorDeclarations(input.light.sys.color),
    ...shapeDeclarations(input.light.sys.shape),
    ...customDeclarations(input.light.custom),
    ...componentDeclarations(input.component ?? {}),
  ];
  const darkDeclarations = [
    ...sysColorDeclarations(input.dark.sys.color),
    ...shapeDeclarations(input.dark.sys.shape),
    ...customDeclarations(input.dark.custom),
  ];
  return `${renderBlock(input.selector, rootDeclarations)}\n\n${renderBlock(
    input.darkSelector,
    darkDeclarations,
  )}`;
}

function refDeclarations(ref: ThemeReferencePalettes): string[] {
  const declarations: string[] = [];
  for (const palette of REFERENCE_PALETTE_NAMES) {
    for (const toneValue of REFERENCE_TONES) {
      declarations.push(
        `${themeVar('ref', 'palette', toKebabCase(palette), String(toneValue))}: ${ref[palette][toneValue]};`,
      );
    }
  }
  return declarations;
}

function sysColorDeclarations(colors: ThemeSystemColorValues): string[] {
  return SYSTEM_COLOR_NAMES.map(
    (name) => `${themeVar('sys', 'color', toKebabCase(name))}: ${colors[name]};`,
  );
}

function shapeDeclarations(shape: ThemeShapeValues): string[] {
  return Object.entries(shape).map(
    ([name, value]) => `${themeVar('sys', 'shape', toKebabCase(name))}: ${value};`,
  );
}

function customDeclarations(custom: Readonly<Record<string, ThemeCustomColorGroup>>): string[] {
  const declarations: string[] = [];
  for (const [name, group] of Object.entries(custom).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    declarations.push(`${themeVar('custom', name, 'color')}: ${group.color};`);
    declarations.push(`${themeVar('custom', name, 'on-color')}: ${group.onColor};`);
    declarations.push(`${themeVar('custom', name, 'color-container')}: ${group.colorContainer};`);
    declarations.push(
      `${themeVar('custom', name, 'on-color-container')}: ${group.onColorContainer};`,
    );
  }
  return declarations;
}

function componentDeclarations(component: ThemeComponentTokensInput): string[] {
  return Object.entries(component)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${themeVar('component', name)}: ${String(value)};`);
}

function renderBlock(selector: string, declarations: readonly string[]): string {
  return `${selector} {\n${declarations.map((declaration) => `  ${declaration}`).join('\n')}\n}`;
}

function referenceTokenVars(): ThemeReferencePalettes {
  const palettes: Partial<Record<ThemeReferencePaletteName, Readonly<Record<number, string>>>> = {};
  for (const palette of REFERENCE_PALETTE_NAMES) {
    const tones: Record<number, string> = {};
    for (const toneValue of REFERENCE_TONES) {
      tones[toneValue] =
        `var(${themeVar('ref', 'palette', toKebabCase(palette), String(toneValue))})`;
    }
    palettes[palette] = tones;
  }
  return palettes as ThemeReferencePalettes;
}

function systemColorTokenVars(): ThemeSystemColorValues {
  const result: Partial<Record<ThemeSystemColorName, string>> = {};
  for (const name of SYSTEM_COLOR_NAMES) {
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
  return Math.max(-1, Math.min(1, contrast));
}

function themeVar(...parts: readonly string[]): string {
  return `--kovo-theme-${parts.map(toKebabCase).join('-')}`;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}
