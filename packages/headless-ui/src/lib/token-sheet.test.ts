import { describe, expect, it } from 'vitest';

import { jisoUiTailwindThemeCss, jisoUiTokenSheet, jisoUiTokenSheetCss } from './token-sheet.js';

describe('jiso ui token sheet', () => {
  it('defines the bounded semantic tokens used by the styled layer', () => {
    expect(jisoUiTokenSheet.map((token) => token.name)).toEqual([
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

    const properties = jisoUiTokenSheet.map((token) => token.property);
    expect(new Set(properties).size).toBe(properties.length);
    expect(properties.every((property) => property.startsWith('--jiso-'))).toBe(true);
  });

  it('renders document-level CSS custom properties for light and dark themes', () => {
    expect(jisoUiTokenSheetCss).toContain(':root {\n  --jiso-color-background: 0 0% 100%;');
    expect(jisoUiTokenSheetCss).toContain(
      ':root[data-theme="dark"] {\n  --jiso-color-background: 222.2 84% 4.9%;',
    );

    for (const token of jisoUiTokenSheet) {
      expect(jisoUiTokenSheetCss).toContain(`  ${token.property}: ${token.light};`);
      expect(jisoUiTokenSheetCss).toContain(`  ${token.property}: ${token.dark};`);
    }
  });

  it('renders Tailwind theme aliases without dynamic utility class names', () => {
    expect(jisoUiTailwindThemeCss).toContain('@theme inline {');
    expect(jisoUiTailwindThemeCss).toContain(
      '  --color-background: hsl(var(--jiso-color-background));',
    );
    expect(jisoUiTailwindThemeCss).toContain('  --radius-md: var(--jiso-radius-md);');

    for (const token of jisoUiTokenSheet) {
      if (token.tailwindThemeProperty) {
        expect(jisoUiTailwindThemeCss).toContain(
          `  ${token.tailwindThemeProperty}: ${token.tailwindThemeValue};`,
        );
      }
    }
  });
});
