export type KovoUiTokenCategory = 'color' | 'radius';
export type KovoUiTokenMode = 'light' | 'dark';
export type KovoUiTokenProperty = `--kovo-${string}`;
export type KovoUiTailwindThemeProperty = `--color-${string}` | `--radius-${string}`;

export interface KovoUiTokenDefinition {
  readonly category: KovoUiTokenCategory;
  readonly dark: string;
  readonly light: string;
  readonly name: string;
  readonly property: KovoUiTokenProperty;
  readonly tailwindThemeProperty?: KovoUiTailwindThemeProperty;
  readonly tailwindThemeValue?: string;
}

interface KovoUiTailwindTokenDefinition extends KovoUiTokenDefinition {
  readonly tailwindThemeProperty: KovoUiTailwindThemeProperty;
  readonly tailwindThemeValue: string;
}

export const kovoUiTokenSheet = [
  colorToken('background', '0 0% 100%', '222.2 84% 4.9%'),
  colorToken('foreground', '222.2 84% 4.9%', '210 40% 98%'),
  colorToken('card', '0 0% 100%', '222.2 84% 4.9%'),
  colorToken('card-foreground', '222.2 84% 4.9%', '210 40% 98%'),
  colorToken('popover', '0 0% 100%', '222.2 84% 4.9%'),
  colorToken('popover-foreground', '222.2 84% 4.9%', '210 40% 98%'),
  colorToken('primary', '221.2 83.2% 53.3%', '217.2 91.2% 59.8%'),
  colorToken('primary-foreground', '210 40% 98%', '222.2 47.4% 11.2%'),
  colorToken('secondary', '210 40% 96.1%', '217.2 32.6% 17.5%'),
  colorToken('secondary-foreground', '222.2 47.4% 11.2%', '210 40% 98%'),
  colorToken('muted', '210 40% 96.1%', '217.2 32.6% 17.5%'),
  colorToken('muted-foreground', '215.4 16.3% 46.9%', '215 20.2% 65.1%'),
  colorToken('accent', '210 40% 96.1%', '217.2 32.6% 17.5%'),
  colorToken('accent-foreground', '222.2 47.4% 11.2%', '210 40% 98%'),
  colorToken('destructive', '0 84.2% 60.2%', '0 62.8% 30.6%'),
  colorToken('destructive-foreground', '210 40% 98%', '210 40% 98%'),
  colorToken('border', '214.3 31.8% 91.4%', '217.2 32.6% 17.5%'),
  colorToken('input', '214.3 31.8% 91.4%', '217.2 32.6% 17.5%'),
  colorToken('ring', '221.2 83.2% 53.3%', '224.3 76.3% 48%'),
  radiusToken('sm', '0.375rem'),
  radiusToken('md', '0.5rem'),
  radiusToken('lg', '0.75rem'),
] as const satisfies readonly KovoUiTokenDefinition[];

export type KovoUiTokenName = (typeof kovoUiTokenSheet)[number]['name'];

export const kovoUiTailwindThemeCss = renderTailwindThemeCss();
export const kovoUiTokenSheetCss = `${kovoUiTailwindThemeCss}\n\n${renderTokenBlock(
  ':root',
  'light',
)}\n\n${renderTokenBlock(':root[data-theme="dark"]', 'dark')}\n`;

function colorToken<const Name extends string>(name: Name, light: string, dark: string) {
  const property = `--kovo-color-${name}` as const;

  return {
    category: 'color',
    dark,
    light,
    name,
    property,
    tailwindThemeProperty: `--color-${name}`,
    tailwindThemeValue: `hsl(var(${property}))`,
  } satisfies KovoUiTokenDefinition;
}

function radiusToken<const Name extends string>(name: Name, value: string) {
  const property = `--kovo-radius-${name}` as const;

  return {
    category: 'radius',
    dark: value,
    light: value,
    name: `radius-${name}` as const,
    property,
    tailwindThemeProperty: `--radius-${name}`,
    tailwindThemeValue: `var(${property})`,
  } satisfies KovoUiTokenDefinition;
}

function renderTokenBlock(selector: string, mode: KovoUiTokenMode): string {
  const declarations = kovoUiTokenSheet
    .map((token) => `  ${token.property}: ${mode === 'light' ? token.light : token.dark};`)
    .join('\n');

  return `${selector} {\n${declarations}\n}`;
}

function renderTailwindThemeCss(): string {
  const declarations = kovoUiTokenSheet
    .filter(hasTailwindThemeAlias)
    .map((token) => `  ${token.tailwindThemeProperty}: ${token.tailwindThemeValue};`)
    .join('\n');

  // SPEC.md §13.1 keeps classes statically discoverable while design tokens stay as
  // document-level CSS custom properties with no shadow boundary.
  return `@theme inline {\n${declarations}\n}`;
}

function hasTailwindThemeAlias(
  token: KovoUiTokenDefinition,
): token is KovoUiTailwindTokenDefinition {
  return token.tailwindThemeProperty !== undefined && token.tailwindThemeValue !== undefined;
}
