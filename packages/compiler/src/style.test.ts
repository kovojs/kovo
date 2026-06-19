import { describe, expect, it } from 'vitest';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from './index.js';
import { parseComponentModule } from './scan/parse.js';
import { extractKovoStyles } from './style.js';

describe('Kovo Style extraction', () => {
  it('lowers static style.create references to readable classes and atomic CSS', () => {
    const result = compileComponentModule({
      fileName: 'components/button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const base = style.create({
  root: {
    backgroundColor: 'black',
    color: 'white',
  },
});

export const Button = component({
  render: () => <button style={base.root}>Buy</button>,
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source;
    const cssSource = result.files.find((file) => file.kind === 'css')?.source;

    expect(serverSource).toContain('class="kv-button-bg-');
    expect(serverSource).toContain('data-style-src="components/button.tsx#root"');
    expect(serverSource).not.toContain('style={base.root}');
    expect(result.loweredSource).toContain(
      '{ namespace: "button", source: "components/button.tsx" }',
    );
    expect(cssSource).toContain('@layer kovo-style-3000');
    expect(cssSource).toContain('.kv-button-bg-');
    expect(cssSource).toContain('background-color:black');
    expect(result.cssAssets[0]?.styleRuleUsages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleFileName: 'components/button.tsx',
          source: 'components/button.tsx#root',
          styleRef: 'base.root',
        }),
      ]),
    );
    expect(result.componentGraphFacts[0]?.styleRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: expect.stringMatching(/^kv-button-bg-/),
          source: 'components/button.tsx#root',
          styleRef: 'base.root',
        }),
      ]),
    );
    expect(result.files.find((file) => file.kind === 'registry')?.source).toContain(
      'export interface ComponentStyleRules',
    );
    expect(result.files.find((file) => file.kind === 'registry')?.source).toContain(
      "source: 'components/button.tsx#root'; styleRef: 'base.root'; moduleFileName: 'components/button.tsx';",
    );
    expect(() => assertFixpoint(result)).not.toThrow();
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('lowers styles after child structural rewrites without overlapping source spans', () => {
    const result = compileComponentModule({
      fileName: 'components/cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const badgeStyles = style.create({
  badge: {
    alignItems: 'center',
    display: 'inline-flex',
  },
});

export const CartBadge = component({
  queries: { cart: true },
  render: ({ cart }) => (
    <cart-badge style={badgeStyles.badge}>
      <span>{cart.count}</span>
    </cart-badge>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(serverSource).toContain('class="kv-badge-align-');
    expect(serverSource).toContain('data-style-src="components/cart-badge.tsx#badge"');
    expect(serverSource).toContain('data-bind="cart.count"');
    expect(() => assertRenderEquivalence(result)).not.toThrow();
  });

  it('lowers static style arrays with author-last property wins', () => {
    const result = compileComponentModule({
      fileName: 'components/button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const base = style.create({
  root: {
    backgroundColor: 'black',
    color: 'white',
  },
});

const overrides = style.create({
  danger: {
    backgroundColor: 'red',
  },
});

export const Button = component({
  render: () => <button style={[base.root, false, overrides.danger]}>Delete</button>,
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(serverSource).toContain('class="kv-button-fg-');
    expect(serverSource).toContain('kv-button-overrides-bg-');
    expect(serverSource).not.toContain('kv-button-bg-');
    expect(serverSource).toContain(
      'data-style-src="components/button.tsx#root; components/button.tsx#danger"',
    );
  });

  it('extracts same-file defineVars and createTheme rules into CSS assets', () => {
    const result = compileComponentModule({
      fileName: 'components/themed-button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const buttonVars = style.defineVars({
  accent: '#2563eb',
  onAccent: 'white',
});

const successTheme = style.createTheme(
  buttonVars,
  { accent: '#16a34a' },
);

const base = style.create({
  root: {
    backgroundColor: buttonVars.accent,
    color: buttonVars.onAccent,
  },
});

export const Button = component({
  render: () => <button style={base.root}>Buy</button>,
});
`,
    });

    const cssSource = result.files.find((file) => file.kind === 'css')?.source ?? '';
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(cssSource).toContain(':root{--kovo-button-accent:#2563eb}');
    expect(cssSource).toContain(':root{--kovo-button-on-accent:white}');
    expect(cssSource).toContain('--kovo-button-accent:#16a34a');
    expect(cssSource).toContain('background-color:var(--kovo-button-accent)');
    expect(cssSource).toContain('color:var(--kovo-button-on-accent)');
    expect(serverSource).toContain('kv-themed-button-bg-');
    expect(result.cssAssets[0]?.styleRuleUsages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleFileName: 'components/themed-button.tsx',
          source: 'components/themed-button.tsx#accent',
          styleRef: 'buttonVars.accent',
        }),
        expect.objectContaining({
          moduleFileName: 'components/themed-button.tsx',
          source: 'components/themed-button.tsx#accent',
          styleRef: 'successTheme.accent',
        }),
        expect.objectContaining({
          moduleFileName: 'components/themed-button.tsx',
          source: 'components/themed-button.tsx#root',
          styleRef: 'base.root',
        }),
      ]),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('resolves public theme token imports in static style.create objects', () => {
    const result = compileComponentModule({
      fileName: 'components/token-button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';
import { tokens } from '@kovojs/style';

const base = style.create({
  root: {
    backgroundColor: tokens.sys.color.primary,
    borderRadius: tokens.sys.shape.cornerMedium,
    color: style.tokens.sys.color.onPrimary,
  },
});

export const Button = component({
  render: () => <button style={base.root}>Buy</button>,
});
`,
    });

    const cssSource = result.files.find((file) => file.kind === 'css')?.source ?? '';

    expect(cssSource).toContain('background-color:var(--kovo-theme-sys-color-primary)');
    expect(cssSource).toContain('border-radius:var(--kovo-theme-sys-shape-corner-medium)');
    expect(cssSource).toContain('color:var(--kovo-theme-sys-color-on-primary)');
    expect(result.diagnostics).toEqual([]);
  });

  it('resolves bounded same-package static token adapters', () => {
    const source = `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';
import { uiTheme } from './theme.js';

const base = style.create({
  root: {
    backgroundColor: uiTheme.color.accent,
    borderRadius: uiTheme.radius.md,
    color: uiTheme.color.accentForeground,
  },
});

export const Button = component({
  render: () => <button style={base.root}>Buy</button>,
});
`;
    const model = parseComponentModule('components/button.tsx', source);
    const result = extractKovoStyles('components/button.tsx', source, model, 'Button', {
      resolveStaticImport: (_fromFileName, specifier) =>
        specifier === './theme.js'
          ? `
import { tokens } from '@kovojs/style';

const color = tokens.sys.color;
const shape = tokens.sys.shape;

export const uiTheme = Object.freeze({
  color: {
    accent: color.primary,
    accentForeground: color.onPrimary,
  },
  radius: {
    md: shape.cornerMedium,
  },
} as const);
`
          : null,
    });

    expect(result.css).toContain('background-color:var(--kovo-theme-sys-color-primary)');
    expect(result.css).toContain('border-radius:var(--kovo-theme-sys-shape-corner-medium)');
    expect(result.css).toContain('color:var(--kovo-theme-sys-color-on-primary)');
    expect(result.diagnostics).toEqual([]);
  });

  it('diagnoses unresolved token-like style values instead of dropping CSS silently', () => {
    const source = `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';
import { theme } from './theme.js';

const base = style.create({
  root: {
    backgroundColor: theme.color.primary,
  },
});

export const Button = component({
  render: () => <button style={base.root}>Buy</button>,
});
`;
    const model = parseComponentModule('components/broken-token.tsx', source);
    const result = extractKovoStyles('components/broken-token.tsx', source, model, 'Button');

    expect(result.css).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV236',
        fileName: 'components/broken-token.tsx',
        help: expect.stringContaining(
          'the style extractor only accepts literals, same-file defineVars/createTheme values, and public @kovojs/style theme token references',
        ),
        message: 'Static style extraction could not prove style.create values.',
      }),
    ]);
  });

  it('composes generated StyleX classes with authored static class writers', () => {
    const result = compileComponentModule({
      fileName: 'components/button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const base = style.create({
  root: {
    backgroundColor: 'black',
    color: 'white',
  },
});

export const Button = component({
  render: () => <button class="manual" style={base.root}>Buy</button>,
});
`,
    });

    expect(result.loweredSource).toMatchInlineSnapshot(`
      "
      import { component } from '@kovojs/core';
      import * as style from '@kovojs/style';

      const base = style.create({
        root: {
          backgroundColor: 'black',
          color: 'white',
        },
      });

      export const Button = component({
        render: () => <button class="manual kv-button-bg-e38gwa kv-button-fg-c5dqff" data-style-src="components/button.tsx#root">Buy</button>,
      });
      Button.name = "components/button/button";
      "
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports unmergeable author class expression conflicts with the StyleX lowerer', () => {
    const result = compileComponentModule({
      fileName: 'components/button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const base = style.create({
  root: {
    backgroundColor: 'black',
  },
});

export const Button = component({
  render: ({ className }) => <button class={className} style={base.root}>Buy</button>,
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV231'))
      .toMatchInlineSnapshot(`
      [
        {
          "code": "KV231",
          "fileName": "components/button.tsx",
          "help": "Would lower to: a single composed attribute set for primitive composition.
      Blocked reason: both primitive and author write an attribute whose merge rule is ambiguous or unsafe, such as IDREF, data-p-*, kovo-c, or kovo-state.
      Fixes: keep one writer, pass the value through the primitive API, or move the relationship/state ownership to one component.
      SPEC §4.6 defines primitive attribute merge rules and treats double-wired relationships as errors.",
          "length": 17,
          "message": "Unmergeable attribute conflict in primitive composition. class (writers: author JSX, style lowerer)",
          "severity": "error",
          "start": {
            "column": 38,
            "line": 12,
          },
        },
      ]
    `);
  });

  it('lowers state-driven style object toggles through versioned state derives', () => {
    const result = compileComponentModule({
      fileName: 'components/badge.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const base = style.create({
  root: {
    backgroundColor: 'black',
    color: 'white',
  },
});

const motion = style.create({
  bounce: {
    backgroundColor: 'red',
  },
});

export const Badge = component({
  state: () => ({ bouncing: false }),
  render: (_queries, state) => (
    <button style={[base.root, state.bouncing ? motion.bounce : null]}>Cart</button>
  ),
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(serverSource).toContain('class={((state.bouncing))');
    expect(serverSource).toContain('kv-badge-fg-');
    expect(serverSource).toContain('kv-badge-motion-bg-');
    expect(serverSource).toContain('data-bind:class="/c/__v/');
    expect(serverSource).toContain('/components/badge.client.js#Badge$style_class_derive');
    expect(serverSource).toContain('#Badge$style_class_derive');
    expect(serverSource).not.toContain('style={[base.root');
    expect(clientSource).toContain(
      'export const Badge$style_class_derive = derive(["state"], (state) =>',
    );
    expect(clientSource).toContain('state.bouncing');
    expect(clientSource).not.toContain('setAttribute');
    expect(result.clientExports).toContain('Badge$style_class_derive');
    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toContainEqual({
      componentName: 'Badge',
      detail: 'style-object toggle',
      position: 'attribute',
      query: 'state.bouncing',
      source: 'state',
      status: 'plan',
    });
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers query-driven style object toggles through compiled attribute stamps', () => {
    const result = compileComponentModule({
      fileName: 'components/cart-button.tsx',
      source: `
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

const buttonStates = style.create({
  empty: {
    backgroundColor: 'gray',
    color: 'white',
  },
  ready: {
    backgroundColor: 'green',
    color: 'white',
  },
});

export const CartButton = component({
  queries: { cart: true },
  render: ({ cart }) => (
    <button style={cart.count > 0 ? buttonStates.ready : buttonStates.empty}>Cart</button>
  ),
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(serverSource).toContain(
      'data-derive="cart.CartButton$style_class_derive" data-derive-attr="class"',
    );
    expect(serverSource).not.toContain('style={cart.count');
    expect(clientSource).toContain(
      'export const CartButton$style_class_derive = derive(["cart"], (cart) =>',
    );
    expect(clientSource).toContain('cart.count > 0');
    expect(clientSource).toContain(
      'stamps: [{ attr: "class", selector: "[data-derive=\\"cart.CartButton$style_class_derive\\"]"',
    );
    expect(clientSource).not.toContain('setAttribute');
    expect(result.queryUpdatePlans).toEqual([
      {
        componentName: 'CartButton',
        paths: [],
        query: 'cart',
        stamps: [
          expect.objectContaining({
            attr: 'class',
            derive: expect.objectContaining({
              exportName: 'CartButton$style_class_derive',
              input: 'cart',
            }),
            selector: '[data-derive="cart.CartButton$style_class_derive"]',
          }),
        ],
      },
    ]);
    expect(result.updateCoverage).toEqual([
      {
        componentName: 'CartButton',
        detail: 'style-object toggle',
        position: 'attribute',
        query: 'cart.count',
        status: 'plan',
      },
    ]);
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'KV311' }));
    expect(() => assertFixpoint(result)).not.toThrow();
  });
});
