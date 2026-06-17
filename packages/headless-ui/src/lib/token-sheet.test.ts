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
  });

  it('renders document-level CSS custom properties for light and dark themes', () => {
    expect(kovoUiTokenSheetCss).toMatchInlineSnapshot(`
      "@theme inline {
        --color-background: hsl(var(--kovo-color-background));
        --color-foreground: hsl(var(--kovo-color-foreground));
        --color-card: hsl(var(--kovo-color-card));
        --color-card-foreground: hsl(var(--kovo-color-card-foreground));
        --color-popover: hsl(var(--kovo-color-popover));
        --color-popover-foreground: hsl(var(--kovo-color-popover-foreground));
        --color-primary: hsl(var(--kovo-color-primary));
        --color-primary-foreground: hsl(var(--kovo-color-primary-foreground));
        --color-secondary: hsl(var(--kovo-color-secondary));
        --color-secondary-foreground: hsl(var(--kovo-color-secondary-foreground));
        --color-muted: hsl(var(--kovo-color-muted));
        --color-muted-foreground: hsl(var(--kovo-color-muted-foreground));
        --color-accent: hsl(var(--kovo-color-accent));
        --color-accent-foreground: hsl(var(--kovo-color-accent-foreground));
        --color-destructive: hsl(var(--kovo-color-destructive));
        --color-destructive-foreground: hsl(var(--kovo-color-destructive-foreground));
        --color-border: hsl(var(--kovo-color-border));
        --color-input: hsl(var(--kovo-color-input));
        --color-ring: hsl(var(--kovo-color-ring));
        --radius-sm: var(--kovo-radius-sm);
        --radius-md: var(--kovo-radius-md);
        --radius-lg: var(--kovo-radius-lg);
      }

      :root {
        --kovo-color-background: 0 0% 100%;
        --kovo-color-foreground: 222.2 84% 4.9%;
        --kovo-color-card: 0 0% 100%;
        --kovo-color-card-foreground: 222.2 84% 4.9%;
        --kovo-color-popover: 0 0% 100%;
        --kovo-color-popover-foreground: 222.2 84% 4.9%;
        --kovo-color-primary: 221.2 83.2% 53.3%;
        --kovo-color-primary-foreground: 210 40% 98%;
        --kovo-color-secondary: 210 40% 96.1%;
        --kovo-color-secondary-foreground: 222.2 47.4% 11.2%;
        --kovo-color-muted: 210 40% 96.1%;
        --kovo-color-muted-foreground: 215.4 16.3% 46.9%;
        --kovo-color-accent: 210 40% 96.1%;
        --kovo-color-accent-foreground: 222.2 47.4% 11.2%;
        --kovo-color-destructive: 0 84.2% 60.2%;
        --kovo-color-destructive-foreground: 210 40% 98%;
        --kovo-color-border: 214.3 31.8% 91.4%;
        --kovo-color-input: 214.3 31.8% 91.4%;
        --kovo-color-ring: 221.2 83.2% 53.3%;
        --kovo-radius-sm: 0.375rem;
        --kovo-radius-md: 0.5rem;
        --kovo-radius-lg: 0.75rem;
      }

      :root[data-theme="dark"] {
        --kovo-color-background: 222.2 84% 4.9%;
        --kovo-color-foreground: 210 40% 98%;
        --kovo-color-card: 222.2 84% 4.9%;
        --kovo-color-card-foreground: 210 40% 98%;
        --kovo-color-popover: 222.2 84% 4.9%;
        --kovo-color-popover-foreground: 210 40% 98%;
        --kovo-color-primary: 217.2 91.2% 59.8%;
        --kovo-color-primary-foreground: 222.2 47.4% 11.2%;
        --kovo-color-secondary: 217.2 32.6% 17.5%;
        --kovo-color-secondary-foreground: 210 40% 98%;
        --kovo-color-muted: 217.2 32.6% 17.5%;
        --kovo-color-muted-foreground: 215 20.2% 65.1%;
        --kovo-color-accent: 217.2 32.6% 17.5%;
        --kovo-color-accent-foreground: 210 40% 98%;
        --kovo-color-destructive: 0 62.8% 30.6%;
        --kovo-color-destructive-foreground: 210 40% 98%;
        --kovo-color-border: 217.2 32.6% 17.5%;
        --kovo-color-input: 217.2 32.6% 17.5%;
        --kovo-color-ring: 224.3 76.3% 48%;
        --kovo-radius-sm: 0.375rem;
        --kovo-radius-md: 0.5rem;
        --kovo-radius-lg: 0.75rem;
      }
      "
    `);
  });

  it('renders document token aliases', () => {
    expect(kovoUiDocumentTokenCss).toMatchInlineSnapshot(`
      "@theme inline {
        --color-background: hsl(var(--kovo-color-background));
        --color-foreground: hsl(var(--kovo-color-foreground));
        --color-card: hsl(var(--kovo-color-card));
        --color-card-foreground: hsl(var(--kovo-color-card-foreground));
        --color-popover: hsl(var(--kovo-color-popover));
        --color-popover-foreground: hsl(var(--kovo-color-popover-foreground));
        --color-primary: hsl(var(--kovo-color-primary));
        --color-primary-foreground: hsl(var(--kovo-color-primary-foreground));
        --color-secondary: hsl(var(--kovo-color-secondary));
        --color-secondary-foreground: hsl(var(--kovo-color-secondary-foreground));
        --color-muted: hsl(var(--kovo-color-muted));
        --color-muted-foreground: hsl(var(--kovo-color-muted-foreground));
        --color-accent: hsl(var(--kovo-color-accent));
        --color-accent-foreground: hsl(var(--kovo-color-accent-foreground));
        --color-destructive: hsl(var(--kovo-color-destructive));
        --color-destructive-foreground: hsl(var(--kovo-color-destructive-foreground));
        --color-border: hsl(var(--kovo-color-border));
        --color-input: hsl(var(--kovo-color-input));
        --color-ring: hsl(var(--kovo-color-ring));
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
          "value": "hsl(var(--kovo-color-background))",
        },
        {
          "name": "foreground",
          "property": "--color-foreground",
          "value": "hsl(var(--kovo-color-foreground))",
        },
        {
          "name": "card",
          "property": "--color-card",
          "value": "hsl(var(--kovo-color-card))",
        },
        {
          "name": "card-foreground",
          "property": "--color-card-foreground",
          "value": "hsl(var(--kovo-color-card-foreground))",
        },
        {
          "name": "popover",
          "property": "--color-popover",
          "value": "hsl(var(--kovo-color-popover))",
        },
        {
          "name": "popover-foreground",
          "property": "--color-popover-foreground",
          "value": "hsl(var(--kovo-color-popover-foreground))",
        },
        {
          "name": "primary",
          "property": "--color-primary",
          "value": "hsl(var(--kovo-color-primary))",
        },
        {
          "name": "primary-foreground",
          "property": "--color-primary-foreground",
          "value": "hsl(var(--kovo-color-primary-foreground))",
        },
        {
          "name": "secondary",
          "property": "--color-secondary",
          "value": "hsl(var(--kovo-color-secondary))",
        },
        {
          "name": "secondary-foreground",
          "property": "--color-secondary-foreground",
          "value": "hsl(var(--kovo-color-secondary-foreground))",
        },
        {
          "name": "muted",
          "property": "--color-muted",
          "value": "hsl(var(--kovo-color-muted))",
        },
        {
          "name": "muted-foreground",
          "property": "--color-muted-foreground",
          "value": "hsl(var(--kovo-color-muted-foreground))",
        },
        {
          "name": "accent",
          "property": "--color-accent",
          "value": "hsl(var(--kovo-color-accent))",
        },
        {
          "name": "accent-foreground",
          "property": "--color-accent-foreground",
          "value": "hsl(var(--kovo-color-accent-foreground))",
        },
        {
          "name": "destructive",
          "property": "--color-destructive",
          "value": "hsl(var(--kovo-color-destructive))",
        },
        {
          "name": "destructive-foreground",
          "property": "--color-destructive-foreground",
          "value": "hsl(var(--kovo-color-destructive-foreground))",
        },
        {
          "name": "border",
          "property": "--color-border",
          "value": "hsl(var(--kovo-color-border))",
        },
        {
          "name": "input",
          "property": "--color-input",
          "value": "hsl(var(--kovo-color-input))",
        },
        {
          "name": "ring",
          "property": "--color-ring",
          "value": "hsl(var(--kovo-color-ring))",
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
