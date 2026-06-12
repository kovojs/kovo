import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function expectHandlerRef(source: string, path: string, exportName: string): void {
  expect(source).toMatch(
    new RegExp(`${escapeRegExp(path)}\\?v=[0-9a-f]{8}#${escapeRegExp(exportName)}`),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('handler lowering', () => {
  it('versions handler URLs from the emitted client module source', () => {
    const source = `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  render: () => <button onClick={() => add(item.id)}>Add</button>,
});
`;
    const first = compileComponentModule({ fileName: 'cart-badge.tsx', source });
    const second = compileComponentModule({ fileName: 'cart-badge.tsx', source });
    const changed = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: source.replace('add(item.id)', 'remove(item.id)'),
    });

    const firstVersion = first.files[0]?.source.match(/\.client\.js\?v=([0-9a-f]{8})#/)?.[1];
    const secondVersion = second.files[0]?.source.match(/\.client\.js\?v=([0-9a-f]{8})#/)?.[1];
    const changedVersion = changed.files[0]?.source.match(/\.client\.js\?v=([0-9a-f]{8})#/)?.[1];

    expect(firstVersion).toBeDefined();
    expect(secondVersion).toBe(firstVersion);
    expect(changedVersion).not.toBe(firstVersion);
  });

  it('emits executable handler bodies with stable unique anonymous names', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  state: () => ({ count: 0 }),
  render: () => (
    <div>
      <button onClick={() => state.count += item.quantity}>Add one</button>
      <button onClick={() => state.count = state.count - item.quantity}>Remove one</button>
    </div>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expectHandlerRef(
      serverSource,
      '/c/components/cart/cart-actions.client.js',
      'CartActions$button_click',
    );
    expectHandlerRef(
      serverSource,
      '/c/components/cart/cart-actions.client.js',
      'CartActions$button_click_2',
    );
    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('fw-param-types="quantity:number"');
    expect(clientSource).toContain(
      'export const CartActions$button_click = handler((event, ctx) => {',
    );
    expect(clientSource).toContain('return ctx.state.count += ctx.params.quantity;');
    expect(clientSource).toContain(
      'export const CartActions$button_click_2 = handler((event, ctx) => {',
    );
    expect(clientSource).toContain(
      'return ctx.state.count = ctx.state.count - ctx.params.quantity;',
    );
  });

  it('declares boolean coercion for boolean-ish captured handler params', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => item.selected ? select(item.id) : deselect(item.id)}>Toggle</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('fw-param-types="selected:boolean"');
    expect(serverSource).toContain('data-p-selected="{item.selected}"');
    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(clientSource).toContain(
      'return ctx.params.selected ? select(ctx.params.id) : deselect(ctx.params.id);',
    );
  });

  it('extracts and rewrites handlers with nested object and block expressions', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <div>
      <button onClick={() => emit('cart:add', { id: item.id })}>Add</button>
      <button onClick={() => { log(item.id); emit('cart:remove', { id: item.id }); }}>Remove</button>
    </div>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expectHandlerRef(
      serverSource,
      '/c/components/cart/cart-actions.client.js',
      'CartActions$button_click',
    );
    expectHandlerRef(
      serverSource,
      '/c/components/cart/cart-actions.client.js',
      'CartActions$button_click_2',
    );
    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(serverSource).not.toContain('onClick={');
    expect(clientSource).toContain("return emit('cart:add', { id: ctx.params.id });");
    expect(clientSource).toContain(
      "log(ctx.params.id); emit('cart:remove', { id: ctx.params.id });",
    );
  });

  it('does not rewrite one element param inside a longer member expression', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => emit('cart:add', { id: item.id, idx: item.idx })}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(serverSource).toContain('data-p-idx="{item.idx}"');
    expect(clientSource).toContain(
      "return emit('cart:add', { id: ctx.params.id, idx: ctx.params.idx });",
    );
    expect(clientSource).not.toContain('id: ctx.params.idx');
  });

  it('rewrites handler captures without touching strings or template literal text', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  state: () => ({ count: 0 }),
  render: () => (
    <button onClick={() => {
      log('state changed for item.id');
      log(\`literal item.quantity stays text\`);
      state.count += item.quantity;
    }}>Add</button>
  ),
});
`,
    });

    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain("log('state changed for item.id');");
    expect(clientSource).toContain('log(`literal item.quantity stays text`);');
    expect(clientSource).toContain('ctx.state.count += ctx.params.quantity;');
    expect(clientSource).not.toContain('ctx.state changed');
    expect(clientSource).not.toContain('literal ctx.params.quantity stays text');
  });

  it('extracts element params from wrapper calls with quoted commas', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => track('cart,add', item.id, { qty: item.quantity })}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(clientSource).toContain(
      "return track('cart,add', ctx.params.id, { qty: ctx.params.quantity });",
    );
  });

  it('emits typed zero-argument arrow handlers from the TypeScript AST', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={(): void => track(item.id)}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(clientSource).toContain('return track(ctx.params.id);');
    expect(clientSource).not.toContain('unsupported handler expression');
  });

  it('does not extract element params from string literal text', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => log('item.id stays text')}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).not.toContain('data-p-id=');
    expect(clientSource).toContain("return log('item.id stays text');");
    expect(clientSource).not.toContain('ctx.params.id');
  });

  it('does not infer element param types from string literal comparisons', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => track(item.quantity, 'item.quantity > 0')}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).not.toContain('fw-param-types="quantity:number"');
    expect(clientSource).toContain("return track(ctx.params.quantity, 'item.quantity > 0');");
  });

  it('infers element param types from AST usage contexts', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => track(item.quantity > 0, !item.selected)}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('data-p-selected="{item.selected}"');
    expect(serverSource).toContain('fw-param-types="quantity:number,selected:boolean"');
  });

  it('ignores event handler text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => {
    const sample = '<button onClick={() => window.alert("x")}>Add</button>';
    // <button onClick={() => document.body.remove()}>Remove</button>
    return <button>Static</button>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.handlerExports).toEqual([]);
    expect(result.files[1]?.source).toContain('// no client handlers emitted');
  });
});
