import { describe, expect, it } from 'vitest';

import { kovoUiTailwindThemeCss, kovoUiTokenSheet, kovoUiTokenSheetCss } from './token-sheet.js';

describe('kovo ui token sheet', () => {
  it('defines the bounded semantic tokens used by the styled layer', () => {
    expect(kovoUiTokenSheet.map((token) => token.name)).toEqual([
      'background',
      'foreground',
      'card',
      'card-foreground',
      'popover',
      'popover-foreground',
      'primary',
      'primary-foreground',
      'secondary',
      'secondary-foreground',
      'muted',
      'muted-foreground',
      'accent',
      'accent-foreground',
      'destructive',
      'destructive-foreground',
      'border',
      'input',
      'ring',
      'radius-sm',
      'radius-md',
      'radius-lg',
    ]);

    const properties = kovoUiTokenSheet.map((token) => token.property);
    expect(new Set(properties).size).toBe(properties.length);
    expect(properties.every((property) => property.startsWith('--kovo-'))).toBe(true);
  });

  it('renders document-level CSS custom properties for light and dark themes', () => {
    expect(kovoUiTokenSheetCss).toContain(':root {\n  --kovo-color-background: 0 0% 100%;');
    expect(kovoUiTokenSheetCss).toContain(
      ':root[data-theme="dark"] {\n  --kovo-color-background: 222.2 84% 4.9%;',
    );

    for (const token of kovoUiTokenSheet) {
      expect(kovoUiTokenSheetCss).toContain(`  ${token.property}: ${token.light};`);
      expect(kovoUiTokenSheetCss).toContain(`  ${token.property}: ${token.dark};`);
    }
  });

  it('renders Tailwind theme aliases without dynamic utility class names', () => {
    expect(kovoUiTailwindThemeCss).toContain('@theme inline {');
    expect(kovoUiTailwindThemeCss).toContain(
      '  --color-background: hsl(var(--kovo-color-background));',
    );
    expect(kovoUiTailwindThemeCss).toContain('  --radius-md: var(--kovo-radius-md);');

    for (const token of kovoUiTokenSheet) {
      if (token.tailwindThemeProperty) {
        expect(kovoUiTailwindThemeCss).toContain(
          `  ${token.tailwindThemeProperty}: ${token.tailwindThemeValue};`,
        );
      }
    }
  });
});
