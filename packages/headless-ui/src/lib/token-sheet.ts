export type KovoUiTokenCategory = 'color' | 'radius';
export type KovoUiTokenMode = 'light' | 'dark';
export type KovoUiTokenProperty = `--kovo-${string}`;

/**
 * Document-level token aliases exposed for app styles and generated component CSS.
 */
export type KovoUiDocumentTokenProperty = `--color-${string}` | `--radius-${string}`;

export interface KovoUiTokenDefinition {
  readonly category: KovoUiTokenCategory;
  readonly dark: string;
  readonly light: string;
  readonly themeTokenProperty: `--kovo-theme-${string}`;
  readonly name: string;
  readonly property: KovoUiTokenProperty;
  readonly documentTokenProperty?: KovoUiDocumentTokenProperty;
  readonly documentTokenValue?: string;
}

interface KovoUiDocumentTokenDefinition extends KovoUiTokenDefinition {
  readonly documentTokenProperty: KovoUiDocumentTokenProperty;
  readonly documentTokenValue: string;
}

export const kovoUiTokenSheet = [
  colorToken('background', '--kovo-theme-sys-color-background'),
  colorToken('foreground', '--kovo-theme-sys-color-on-background'),
  colorToken('card', '--kovo-theme-sys-color-surface-container-low'),
  colorToken('card-foreground', '--kovo-theme-sys-color-on-surface'),
  colorToken('popover', '--kovo-theme-sys-color-surface-container-high'),
  colorToken('popover-foreground', '--kovo-theme-sys-color-on-surface'),
  colorToken('primary', '--kovo-theme-sys-color-primary'),
  colorToken('primary-foreground', '--kovo-theme-sys-color-on-primary'),
  colorToken('secondary', '--kovo-theme-sys-color-secondary-container'),
  colorToken('secondary-foreground', '--kovo-theme-sys-color-on-secondary-container'),
  colorToken('muted', '--kovo-theme-sys-color-surface-container'),
  colorToken('muted-foreground', '--kovo-theme-sys-color-on-surface-variant'),
  colorToken('accent', '--kovo-theme-sys-color-surface-container-high'),
  colorToken('accent-foreground', '--kovo-theme-sys-color-on-surface'),
  colorToken('destructive', '--kovo-theme-sys-color-error'),
  colorToken('destructive-foreground', '--kovo-theme-sys-color-on-error'),
  colorToken('border', '--kovo-theme-sys-color-outline-variant'),
  colorToken('input', '--kovo-theme-sys-color-outline'),
  colorToken('ring', '--kovo-theme-sys-color-primary'),
  radiusToken('sm', '--kovo-theme-sys-shape-corner-small'),
  radiusToken('md', '--kovo-theme-sys-shape-corner-medium'),
  radiusToken('lg', '--kovo-theme-sys-shape-corner-large'),
] as const satisfies readonly KovoUiTokenDefinition[];

export type KovoUiTokenName = (typeof kovoUiTokenSheet)[number]['name'];

/**
 * CSS aliases that make Kovo UI semantic tokens available as document-scoped style tokens.
 */
export const kovoUiDocumentTokenCss = renderDocumentTokenCss();
export const kovoUiTokenSheetCss = `${kovoUiDocumentTokenCss}\n\n${renderTokenBlock(
  ':root',
  'light',
)}\n\n${renderTokenBlock(':root[data-theme="dark"]', 'dark')}\n`;

function colorToken<const Name extends string>(
  name: Name,
  themeTokenProperty: `--kovo-theme-sys-color-${string}`,
) {
  const property = `--kovo-color-${name}` as const;
  const value = `var(${themeTokenProperty})`;

  return {
    category: 'color',
    dark: value,
    light: value,
    themeTokenProperty,
    name,
    property,
    documentTokenProperty: `--color-${name}`,
    documentTokenValue: `var(${property})`,
  } satisfies KovoUiTokenDefinition;
}

function radiusToken<const Name extends string>(
  name: Name,
  themeTokenProperty: `--kovo-theme-sys-shape-${string}`,
) {
  const property = `--kovo-radius-${name}` as const;
  const value = `var(${themeTokenProperty})`;

  return {
    category: 'radius',
    dark: value,
    light: value,
    themeTokenProperty,
    name: `radius-${name}` as const,
    property,
    documentTokenProperty: `--radius-${name}`,
    documentTokenValue: `var(${property})`,
  } satisfies KovoUiTokenDefinition;
}

function renderTokenBlock(selector: string, mode: KovoUiTokenMode): string {
  const declarations = kovoUiTokenSheet
    .map((token) => `  ${token.property}: ${mode === 'light' ? token.light : token.dark};`)
    .join('\n');

  return `${selector} {\n${declarations}\n}`;
}

function renderDocumentTokenCss(): string {
  const declarations = kovoUiTokenSheet
    .filter(hasDocumentTokenAlias)
    .map((token) => `  ${token.documentTokenProperty}: ${token.documentTokenValue};`)
    .join('\n');

  return `@theme inline {\n${declarations}\n}`;
}

function hasDocumentTokenAlias(
  token: KovoUiTokenDefinition,
): token is KovoUiDocumentTokenDefinition {
  return token.documentTokenProperty !== undefined && token.documentTokenValue !== undefined;
}
