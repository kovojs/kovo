import { describe, expect, it } from 'vitest';

import {
  assertFixpoint,
  compileComponentModule,
  dedupeCss,
  jisoVitePlugin,
  scopeComponentCss,
} from './index.js';

const cartBadgeSource = `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`;

describe('compileComponentModule', () => {
  it('emits one server file, one client file, and registry metadata', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: cartBadgeSource,
    });

    expect(result.files.map((file) => file.fileName)).toEqual([
      'components/cart/cart-badge.server.js',
      'components/cart/cart-badge.client.js',
      'generated/registries.d.ts',
    ]);
    expect(result.files[1]?.source).toContain('export const CartBadge$button_click');
    expect(result.files[0]?.source).toContain(
      'on:click="./cart-badge.client.js#CartBadge$button_click"',
    );
    expect(result.files[0]?.source).toContain('data-p-id="{item.id}"');
    expect(result.files[2]?.source).toContain(
      "'#cart-badge': typeof import('../components/cart/cart-badge.client.js');",
    );
    expect(result.files[2]?.source).toContain("'cart-badge': unknown;");
  });

  it('reports FW210 for anonymous handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: cartBadgeSource,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'FW210',
        severity: 'lint',
      },
    ]);
  });

  it('reports FW201 when a handler captures non-serializable browser objects', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'FW201',
        severity: 'error',
      },
    ]);
  });

  it('preserves emitted IR on recompilation', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: cartBadgeSource,
    });

    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('lowers provable dialog behavior to platform attributes instead of client handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-button.tsx',
      source: `
export const CartButton = component('cart-button', {
  render: () => (
    <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>
      Open cart
    </button>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'show-modal',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'cart-drawer',
      },
    ]);
    expect(result.files[0]?.source).toContain('commandfor="cart-drawer" command="show-modal"');
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
    expect(result.files[2]?.source).toContain(
      "'CartButton:button:click:cart-drawer': 'dialog:show-modal';",
    );
  });

  it('lowers provable popover behavior to popover target attributes', () => {
    const result = compileComponentModule({
      fileName: 'filter-button.tsx',
      source: `
export const FilterButton = component('filter-button', {
  render: () => <button onClick={() => document.getElementById('filters')!.togglePopover()}>Filters</button>,
});
`,
    });

    expect(result.platformSubstitutions).toEqual([
      {
        action: 'toggle',
        event: 'click',
        kind: 'popover',
        tag: 'button',
        target: 'filters',
      },
    ]);
    expect(result.files[0]?.source).toContain(
      'popovertarget="filters" popovertargetaction="toggle"',
    );
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
  });

  it('stamps cross-document view transition names as real CSS', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component('product-card', {
  render: () => <img viewTransitionName="product-p1-image" src="/p1.png" />,
});
`,
    });

    expect(result.viewTransitions).toEqual([{ name: 'product-p1-image' }]);
    expect(result.files[0]?.source).toContain(
      '<img style="view-transition-name: product-p1-image" src="/p1.png" />',
    );
    expect(result.files[2]?.source).toContain("'product-p1-image': unknown;");
  });
});

describe('jisoVitePlugin', () => {
  it('exposes a Vite transform hook for component modules', () => {
    const plugin = jisoVitePlugin();

    expect(plugin.name).toBe('jiso');
    expect(plugin.transform?.(cartBadgeSource, 'cart-badge.tsx')).toMatchObject({
      code: expect.stringContaining('export function renderSource()'),
      map: null,
    });
  });
});

describe('component CSS helpers', () => {
  it('wraps component CSS in @scope and emits a prefixed fallback', () => {
    const result = scopeComponentCss(
      '[fw-c="cart-badge"]',
      '.count { color: red; }\nbutton, a { color: blue; }',
    );

    expect(result.scoped).toBe(
      '@scope ([fw-c="cart-badge"]) {\n  .count { color: red; }\n  button, a { color: blue; }\n}\n',
    );
    expect(result.fallback).toBe(
      '[fw-c="cart-badge"] .count { color: red; }[fw-c="cart-badge"] button, [fw-c="cart-badge"] a { color: blue; }',
    );
  });

  it('dedupes normalized CSS chunks in page order', () => {
    expect(dedupeCss(['.a{}', '.a{}', ' .b{} '])).toBe('.a{}\n\n.b{}');
  });
});
