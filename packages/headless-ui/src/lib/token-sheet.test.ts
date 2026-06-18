import { describe, expect, it } from 'vitest';

import { kovoUiDocumentTokenCss, kovoUiTokenSheet, kovoUiTokenSheetCss } from './token-sheet.js';

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

    expect(
      kovoUiTokenSheet.map((token) => ({
        name: token.name,
        property: token.property,
        themeTokenProperty: token.themeTokenProperty,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "name": "background",
          "property": "--kovo-color-background",
          "themeTokenProperty": "--kovo-theme-sys-color-background",
        },
        {
          "name": "foreground",
          "property": "--kovo-color-foreground",
          "themeTokenProperty": "--kovo-theme-sys-color-on-background",
        },
        {
          "name": "card",
          "property": "--kovo-color-card",
          "themeTokenProperty": "--kovo-theme-sys-color-surface-container-low",
        },
        {
          "name": "card-foreground",
          "property": "--kovo-color-card-foreground",
          "themeTokenProperty": "--kovo-theme-sys-color-on-surface",
        },
        {
          "name": "popover",
          "property": "--kovo-color-popover",
          "themeTokenProperty": "--kovo-theme-sys-color-surface-container-high",
        },
        {
          "name": "popover-foreground",
          "property": "--kovo-color-popover-foreground",
          "themeTokenProperty": "--kovo-theme-sys-color-on-surface",
        },
        {
          "name": "primary",
          "property": "--kovo-color-primary",
          "themeTokenProperty": "--kovo-theme-sys-color-primary",
        },
        {
          "name": "primary-foreground",
          "property": "--kovo-color-primary-foreground",
          "themeTokenProperty": "--kovo-theme-sys-color-on-primary",
        },
        {
          "name": "secondary",
          "property": "--kovo-color-secondary",
          "themeTokenProperty": "--kovo-theme-sys-color-secondary-container",
        },
        {
          "name": "secondary-foreground",
          "property": "--kovo-color-secondary-foreground",
          "themeTokenProperty": "--kovo-theme-sys-color-on-secondary-container",
        },
        {
          "name": "muted",
          "property": "--kovo-color-muted",
          "themeTokenProperty": "--kovo-theme-sys-color-surface-container",
        },
        {
          "name": "muted-foreground",
          "property": "--kovo-color-muted-foreground",
          "themeTokenProperty": "--kovo-theme-sys-color-on-surface-variant",
        },
        {
          "name": "accent",
          "property": "--kovo-color-accent",
          "themeTokenProperty": "--kovo-theme-sys-color-surface-container-high",
        },
        {
          "name": "accent-foreground",
          "property": "--kovo-color-accent-foreground",
          "themeTokenProperty": "--kovo-theme-sys-color-on-surface",
        },
        {
          "name": "destructive",
          "property": "--kovo-color-destructive",
          "themeTokenProperty": "--kovo-theme-sys-color-error",
        },
        {
          "name": "destructive-foreground",
          "property": "--kovo-color-destructive-foreground",
          "themeTokenProperty": "--kovo-theme-sys-color-on-error",
        },
        {
          "name": "border",
          "property": "--kovo-color-border",
          "themeTokenProperty": "--kovo-theme-sys-color-outline-variant",
        },
        {
          "name": "input",
          "property": "--kovo-color-input",
          "themeTokenProperty": "--kovo-theme-sys-color-outline",
        },
        {
          "name": "ring",
          "property": "--kovo-color-ring",
          "themeTokenProperty": "--kovo-theme-sys-color-primary",
        },
        {
          "name": "radius-sm",
          "property": "--kovo-radius-sm",
          "themeTokenProperty": "--kovo-theme-sys-shape-corner-small",
        },
        {
          "name": "radius-md",
          "property": "--kovo-radius-md",
          "themeTokenProperty": "--kovo-theme-sys-shape-corner-medium",
        },
        {
          "name": "radius-lg",
          "property": "--kovo-radius-lg",
          "themeTokenProperty": "--kovo-theme-sys-shape-corner-large",
        },
      ]
    `);
  });

  it('renders document-level CSS custom properties for light and dark themes', () => {
    expect(kovoUiTokenSheetCss).toMatchInlineSnapshot(`
      "@theme inline {
        --color-background: var(--kovo-color-background);
        --color-foreground: var(--kovo-color-foreground);
        --color-card: var(--kovo-color-card);
        --color-card-foreground: var(--kovo-color-card-foreground);
        --color-popover: var(--kovo-color-popover);
        --color-popover-foreground: var(--kovo-color-popover-foreground);
        --color-primary: var(--kovo-color-primary);
        --color-primary-foreground: var(--kovo-color-primary-foreground);
        --color-secondary: var(--kovo-color-secondary);
        --color-secondary-foreground: var(--kovo-color-secondary-foreground);
        --color-muted: var(--kovo-color-muted);
        --color-muted-foreground: var(--kovo-color-muted-foreground);
        --color-accent: var(--kovo-color-accent);
        --color-accent-foreground: var(--kovo-color-accent-foreground);
        --color-destructive: var(--kovo-color-destructive);
        --color-destructive-foreground: var(--kovo-color-destructive-foreground);
        --color-border: var(--kovo-color-border);
        --color-input: var(--kovo-color-input);
        --color-ring: var(--kovo-color-ring);
        --radius-sm: var(--kovo-radius-sm);
        --radius-md: var(--kovo-radius-md);
        --radius-lg: var(--kovo-radius-lg);
      }

      :root {
        --kovo-color-background: var(--kovo-theme-sys-color-background);
        --kovo-color-foreground: var(--kovo-theme-sys-color-on-background);
        --kovo-color-card: var(--kovo-theme-sys-color-surface-container-low);
        --kovo-color-card-foreground: var(--kovo-theme-sys-color-on-surface);
        --kovo-color-popover: var(--kovo-theme-sys-color-surface-container-high);
        --kovo-color-popover-foreground: var(--kovo-theme-sys-color-on-surface);
        --kovo-color-primary: var(--kovo-theme-sys-color-primary);
        --kovo-color-primary-foreground: var(--kovo-theme-sys-color-on-primary);
        --kovo-color-secondary: var(--kovo-theme-sys-color-secondary-container);
        --kovo-color-secondary-foreground: var(--kovo-theme-sys-color-on-secondary-container);
        --kovo-color-muted: var(--kovo-theme-sys-color-surface-container);
        --kovo-color-muted-foreground: var(--kovo-theme-sys-color-on-surface-variant);
        --kovo-color-accent: var(--kovo-theme-sys-color-surface-container-high);
        --kovo-color-accent-foreground: var(--kovo-theme-sys-color-on-surface);
        --kovo-color-destructive: var(--kovo-theme-sys-color-error);
        --kovo-color-destructive-foreground: var(--kovo-theme-sys-color-on-error);
        --kovo-color-border: var(--kovo-theme-sys-color-outline-variant);
        --kovo-color-input: var(--kovo-theme-sys-color-outline);
        --kovo-color-ring: var(--kovo-theme-sys-color-primary);
        --kovo-radius-sm: var(--kovo-theme-sys-shape-corner-small);
        --kovo-radius-md: var(--kovo-theme-sys-shape-corner-medium);
        --kovo-radius-lg: var(--kovo-theme-sys-shape-corner-large);
      }

      :root[data-theme="dark"] {
        --kovo-color-background: var(--kovo-theme-sys-color-background);
        --kovo-color-foreground: var(--kovo-theme-sys-color-on-background);
        --kovo-color-card: var(--kovo-theme-sys-color-surface-container-low);
        --kovo-color-card-foreground: var(--kovo-theme-sys-color-on-surface);
        --kovo-color-popover: var(--kovo-theme-sys-color-surface-container-high);
        --kovo-color-popover-foreground: var(--kovo-theme-sys-color-on-surface);
        --kovo-color-primary: var(--kovo-theme-sys-color-primary);
        --kovo-color-primary-foreground: var(--kovo-theme-sys-color-on-primary);
        --kovo-color-secondary: var(--kovo-theme-sys-color-secondary-container);
        --kovo-color-secondary-foreground: var(--kovo-theme-sys-color-on-secondary-container);
        --kovo-color-muted: var(--kovo-theme-sys-color-surface-container);
        --kovo-color-muted-foreground: var(--kovo-theme-sys-color-on-surface-variant);
        --kovo-color-accent: var(--kovo-theme-sys-color-surface-container-high);
        --kovo-color-accent-foreground: var(--kovo-theme-sys-color-on-surface);
        --kovo-color-destructive: var(--kovo-theme-sys-color-error);
        --kovo-color-destructive-foreground: var(--kovo-theme-sys-color-on-error);
        --kovo-color-border: var(--kovo-theme-sys-color-outline-variant);
        --kovo-color-input: var(--kovo-theme-sys-color-outline);
        --kovo-color-ring: var(--kovo-theme-sys-color-primary);
        --kovo-radius-sm: var(--kovo-theme-sys-shape-corner-small);
        --kovo-radius-md: var(--kovo-theme-sys-shape-corner-medium);
        --kovo-radius-lg: var(--kovo-theme-sys-shape-corner-large);
      }
      "
    `);
  });

  it('renders document token aliases', () => {
    expect(kovoUiDocumentTokenCss).toMatchInlineSnapshot(`
      "@theme inline {
        --color-background: var(--kovo-color-background);
        --color-foreground: var(--kovo-color-foreground);
        --color-card: var(--kovo-color-card);
        --color-card-foreground: var(--kovo-color-card-foreground);
        --color-popover: var(--kovo-color-popover);
        --color-popover-foreground: var(--kovo-color-popover-foreground);
        --color-primary: var(--kovo-color-primary);
        --color-primary-foreground: var(--kovo-color-primary-foreground);
        --color-secondary: var(--kovo-color-secondary);
        --color-secondary-foreground: var(--kovo-color-secondary-foreground);
        --color-muted: var(--kovo-color-muted);
        --color-muted-foreground: var(--kovo-color-muted-foreground);
        --color-accent: var(--kovo-color-accent);
        --color-accent-foreground: var(--kovo-color-accent-foreground);
        --color-destructive: var(--kovo-color-destructive);
        --color-destructive-foreground: var(--kovo-color-destructive-foreground);
        --color-border: var(--kovo-color-border);
        --color-input: var(--kovo-color-input);
        --color-ring: var(--kovo-color-ring);
        --radius-sm: var(--kovo-radius-sm);
        --radius-md: var(--kovo-radius-md);
        --radius-lg: var(--kovo-radius-lg);
      }"
    `);
    expect(
      kovoUiTokenSheet.map((token) => ({
        name: token.name,
        property: token.documentTokenProperty,
        value: token.documentTokenValue,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "name": "background",
          "property": "--color-background",
          "value": "var(--kovo-color-background)",
        },
        {
          "name": "foreground",
          "property": "--color-foreground",
          "value": "var(--kovo-color-foreground)",
        },
        {
          "name": "card",
          "property": "--color-card",
          "value": "var(--kovo-color-card)",
        },
        {
          "name": "card-foreground",
          "property": "--color-card-foreground",
          "value": "var(--kovo-color-card-foreground)",
        },
        {
          "name": "popover",
          "property": "--color-popover",
          "value": "var(--kovo-color-popover)",
        },
        {
          "name": "popover-foreground",
          "property": "--color-popover-foreground",
          "value": "var(--kovo-color-popover-foreground)",
        },
        {
          "name": "primary",
          "property": "--color-primary",
          "value": "var(--kovo-color-primary)",
        },
        {
          "name": "primary-foreground",
          "property": "--color-primary-foreground",
          "value": "var(--kovo-color-primary-foreground)",
        },
        {
          "name": "secondary",
          "property": "--color-secondary",
          "value": "var(--kovo-color-secondary)",
        },
        {
          "name": "secondary-foreground",
          "property": "--color-secondary-foreground",
          "value": "var(--kovo-color-secondary-foreground)",
        },
        {
          "name": "muted",
          "property": "--color-muted",
          "value": "var(--kovo-color-muted)",
        },
        {
          "name": "muted-foreground",
          "property": "--color-muted-foreground",
          "value": "var(--kovo-color-muted-foreground)",
        },
        {
          "name": "accent",
          "property": "--color-accent",
          "value": "var(--kovo-color-accent)",
        },
        {
          "name": "accent-foreground",
          "property": "--color-accent-foreground",
          "value": "var(--kovo-color-accent-foreground)",
        },
        {
          "name": "destructive",
          "property": "--color-destructive",
          "value": "var(--kovo-color-destructive)",
        },
        {
          "name": "destructive-foreground",
          "property": "--color-destructive-foreground",
          "value": "var(--kovo-color-destructive-foreground)",
        },
        {
          "name": "border",
          "property": "--color-border",
          "value": "var(--kovo-color-border)",
        },
        {
          "name": "input",
          "property": "--color-input",
          "value": "var(--kovo-color-input)",
        },
        {
          "name": "ring",
          "property": "--color-ring",
          "value": "var(--kovo-color-ring)",
        },
        {
          "name": "radius-sm",
          "property": "--radius-sm",
          "value": "var(--kovo-radius-sm)",
        },
        {
          "name": "radius-md",
          "property": "--radius-md",
          "value": "var(--kovo-radius-md)",
        },
        {
          "name": "radius-lg",
          "property": "--radius-lg",
          "value": "var(--kovo-radius-lg)",
        },
      ]
    `);
  });
});
