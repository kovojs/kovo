import { diagnosticDefinitions } from '@jiso/core';
import { describe, expect, it } from 'vitest';

import { collectMinifierReservedNames, compileComponentModule } from './index.js';
import { lowerEventHandlers } from './lower/handlers.js';
import { parseComponentModule } from './scan/parse.js';

const fw210 = diagnosticDefinitions.FW210;

function expectHandlerRef(source: string, path: string, exportName: string): void {
  expect(source).toMatch(
    new RegExp(`${escapeRegExp(path)}\\?v=[0-9a-f]{8}#${escapeRegExp(exportName)}`),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('handler lowering', () => {
  it('names element params from parsed property-access terminal facts', () => {
    const source = `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => <button onClick={() => state.count += item.quantity}>Add one</button>,
});
`;
    const [handler] = lowerEventHandlers(
      { fileName: 'components/cart/cart-actions.tsx', source },
      'CartActions',
      parseComponentModule('components/cart/cart-actions.tsx', source),
    );

    expect(handler?.params).toEqual([
      {
        attributeName: 'data-p-quantity',
        expression: 'item.quantity',
        type: 'number',
        value: '{item.quantity}',
      },
    ]);
  });

  it('collects emitted handler export names for minifier preservation', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart/cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  render: () => (
    <div>
      <button onClick={removeItem}>Remove</button>
      <button onClick={() => clearCart(state.cartId)}>Clear</button>
    </div>
  ),
});
`,
    });
    const cartDrawer = compileComponentModule({
      fileName: 'components/cart/cart-drawer.tsx',
      source: `
import { component } from '@jiso/core';

export const CartDrawer = component('cart-drawer', {
  render: () => (
    <button onClick={removeItem}>Remove</button>
  ),
});
`,
    });

    expect(collectMinifierReservedNames([cartDrawer, cartBadge, cartBadge])).toEqual([
      'CartBadge$button_click',
      'CartBadge$removeItem',
      'CartDrawer$removeItem',
    ]);
  });

  it('reports FW210 for anonymous handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
import { component } from '@jiso/core';

export const CartBadge = component('cart-badge', {
  fragmentTarget: true,
  queries: { cart: {} },
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW210',
        fileName: 'cart-badge.tsx',
        length: 5,
        message: fw210.message,
        severity: fw210.severity,
        start: { column: 13, line: 8 },
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
        code: 'FW210',
        severity: fw210.severity,
      },
      {
        code: 'FW201',
        severity: 'error',
      },
    ]);
    const fw201 = result.diagnostics.find((diagnostic) => diagnostic.code === 'FW201');
    expect(fw201?.help).toMatch(
      /Would lower to: on:click="\/c\/cart-badge\.client\.js\?v=[0-9a-f]{8}#CartBadge\$button_click"/,
    );
    expect(fw201?.help).toContain('Blocked expression: () => window.alert("x")');
    expect(fw201?.help).toContain(
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    );
    expect(fw201?.help).toContain(
      'The compiler conservatively blocks free identifier references named window, document, db, request, response, Date, Map, or Set.',
    );
    expect(fw201?.start).toEqual({ column: 9, line: 1 });
  });

  it('reports stable-name and serializability diagnostics for anonymous browser handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['FW210', 'FW201']);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'FW210',
      severity: fw210.severity,
      start: { column: 9, line: 1 },
    });
    expect(result.diagnostics[1]).toMatchObject({
      code: 'FW201',
      severity: 'error',
      start: { column: 9, line: 1 },
    });
  });

  it('does not report FW201 for local variables named like non-serializable captures', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  render: () => (
    <button onClick={() => { const response = { ok: true }; return response.ok; }}>
      Check
    </button>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW210',
        fileName: 'cart-badge.tsx',
        length: 5,
        message: fw210.message,
        severity: fw210.severity,
        start: { column: 13, line: 4 },
      },
    ]);
  });

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

  it('uses parser reference facts for standalone call argument param names', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: ({ quantity }) => (
    <button onClick={() => track(quantity)}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-quantity="{quantity}"');
    expect(clientSource).toContain('return track(ctx.params.quantity);');
  });

  it('does not fabricate params for unmodeled call argument expressions', () => {
    const source = `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => track(getQuantity())}>Add</button>
  ),
});
`;
    const [handler] = lowerEventHandlers(
      { fileName: 'components/cart/cart-actions.tsx', source },
      'CartActions',
      parseComponentModule('components/cart/cart-actions.tsx', source),
    );

    expect(handler?.params).toEqual([]);
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

// SPEC §5.2: handler lowering must decide named-vs-anonymous and emit the client body from typed
// model facts, never from the raw attribute snippet. These fixtures vary whitespace,
// parenthesization, and comments around an otherwise identical handler and assert the lowering
// decision (named export name / element params) and the emitted client output are byte-identical.
describe('handler lowering is formatting-resistant', () => {
  function lowerSingle(handlerAttribute: string) {
    const fileName = 'components/cart/cart-actions.tsx';
    const source = `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (<button ${handlerAttribute}>Act</button>),
});
`;
    const [handler] = lowerEventHandlers(
      { fileName, source },
      'CartActions',
      parseComponentModule(fileName, source),
    );
    return handler;
  }

  function clientHandlerSource(handlerAttribute: string): string {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@jiso/core';

export const CartActions = component('cart-actions', {
  render: () => (<button ${handlerAttribute}>Act</button>),
});
`,
    });
    return result.files.find((file) => file.kind === 'client')?.source ?? '';
  }

  it('lowers a bare-named handler identically across whitespace, parentheses, and comments', () => {
    const variants = [
      'onClick={handleClick}',
      'onClick={ handleClick }',
      'onClick={(handleClick)}',
      'onClick={((handleClick))}',
      'onClick={/* keep stable */ handleClick}',
    ];

    const canonical = lowerSingle(variants[0]!);
    expect(canonical?.isBareNamedHandler).toBe(true);
    expect(canonical?.exportName).toBe('CartActions$handleClick');
    expect(canonical?.params).toEqual([]);

    for (const variant of variants) {
      const handler = lowerSingle(variant);
      expect(handler?.isBareNamedHandler).toBe(true);
      expect(handler?.exportName).toBe(canonical?.exportName);
      expect(handler?.params).toEqual(canonical?.params);
      expect(clientHandlerSource(variant)).toBe(clientHandlerSource(variants[0]!));
    }
  });

  it('lowers an anonymous member-capturing handler with identical decision facts across formatting', () => {
    // The arrow body is carried verbatim and rewritten by span (SPEC §5.2 allowed source-patch
    // boundary), so author whitespace inside the body is intentionally preserved. What must be
    // formatting-invariant is the lowering DECISION: named-vs-anonymous, export name, and the typed
    // element-param facts derived from the parsed call arguments.
    const variants = [
      'onClick={() => add(item.id, item.quantity)}',
      'onClick={ () => add( item.id , item.quantity ) }',
      'onClick={() => add((item.id), (item.quantity))}',
      'onClick={() => /* capture */ add(item.id, item.quantity)}',
    ];

    const expectedParams = [
      {
        attributeName: 'data-p-id',
        expression: 'item.id',
        type: 'string',
        value: '{item.id}',
      },
      {
        attributeName: 'data-p-quantity',
        expression: 'item.quantity',
        type: 'string',
        value: '{item.quantity}',
      },
    ];

    for (const variant of variants) {
      const handler = lowerSingle(variant);
      expect(handler?.isBareNamedHandler).toBe(false);
      expect(handler?.exportName).toBe('CartActions$button_click');
      expect(handler?.params).toEqual(expectedParams);
      // Captured paths are rewritten to ctx.params regardless of surrounding formatting.
      const client = clientHandlerSource(variant);
      expect(client).toContain('ctx.params.id');
      expect(client).toContain('ctx.params.quantity');
      expect(client).not.toContain('item.id');
      expect(client).not.toContain('item.quantity');
    }
  });

  it('does not promote a wrapped nested call argument to an element param across formatting', () => {
    for (const variant of [
      'onClick={() => track(getQuantity())}',
      'onClick={() => track( getQuantity() )}',
      'onClick={() => track((getQuantity)())}',
    ]) {
      const handler = lowerSingle(variant);
      expect(handler?.isBareNamedHandler).toBe(false);
      expect(handler?.params).toEqual([]);
    }
  });
});
