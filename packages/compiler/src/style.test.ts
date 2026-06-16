import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

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
}, { namespace: 'button', source: 'button.tsx' });

export const Button = component({
  render: () => <button style={base.root}>Buy</button>,
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source;
    const cssSource = result.files.find((file) => file.kind === 'css')?.source;

    expect(serverSource).toContain(
      'class="kv-button-bg-',
    );
    expect(serverSource).toContain('data-style-src="button.tsx#root"');
    expect(serverSource).not.toContain('style={base.root}');
    expect(cssSource).toContain('@layer kovo-style.3000');
    expect(cssSource).toContain('.kv-button-bg-');
    expect(cssSource).toContain('background-color:black');
    expect(result.cssAssets[0]?.styleRuleUsages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleFileName: 'components/button.tsx',
          source: 'button.tsx#root',
          styleRef: 'base.root',
        }),
      ]),
    );
    expect(result.componentGraphFacts[0]?.styleRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: expect.stringMatching(/^kv-button-bg-/),
          source: 'button.tsx#root',
          styleRef: 'base.root',
        }),
      ]),
    );
    expect(result.files.find((file) => file.kind === 'registry')?.source).toContain(
      'export interface ComponentStyleRules',
    );
    expect(result.files.find((file) => file.kind === 'registry')?.source).toContain(
      "source: 'button.tsx#root'; styleRef: 'base.root'; moduleFileName: 'components/button.tsx';",
    );
    expect(() => assertFixpoint(result)).not.toThrow();
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
}, { namespace: 'button', source: 'button.tsx' });

const overrides = style.create({
  danger: {
    backgroundColor: 'red',
  },
}, { namespace: 'buttonOverride', source: 'button.override.tsx' });

export const Button = component({
  render: () => <button style={[base.root, false, overrides.danger]}>Delete</button>,
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(serverSource).toContain('class="kv-button-fg-');
    expect(serverSource).toContain('kv-button-override-bg-');
    expect(serverSource).not.toContain('kv-button-bg-');
    expect(serverSource).toContain(
      'data-style-src="button.tsx#root; button.override.tsx#danger"',
    );
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
}, { namespace: 'badge', source: 'badge.tsx' });

const motion = style.create({
  bounce: {
    backgroundColor: 'red',
  },
}, { namespace: 'badgeMotion', source: 'badge.motion.tsx' });

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
    expect(serverSource).toContain('data-bind:class="/c/components/badge.client.js?v=');
    expect(serverSource).toContain('#Badge$style_class_derive');
    expect(serverSource).not.toContain('style={[base.root');
    expect(clientSource).toContain(
      'export const Badge$style_class_derive = derive(["state"], (state) =>',
    );
    expect(clientSource).toContain('state.bouncing');
    expect(result.clientExports).toContain('Badge$style_class_derive');
    expect(result.queryUpdatePlans).toEqual([]);
    expect(result.updateCoverage).toContainEqual(
      {
        componentName: 'Badge',
        detail: 'style-object toggle',
        position: 'attribute',
        query: 'state.bouncing',
        source: 'state',
        status: 'plan',
      },
    );
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
}, { namespace: 'cartButton', source: 'cart-button.tsx' });

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
