import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';
import { collectMinifierReservedNames } from './internal.js';
import { capturesUnserializableReferences, lowerEventHandlers } from './lower/handlers.js';
import { parseComponentModule } from './scan/parse.js';

const kv210 = diagnosticDefinitions.KV210;

function expectHandlerRef(source: string, path: string, exportName: string): void {
  const relativePath = escapeRegExp(path.replace(/^\/c\//, ''));
  expect(source).toMatch(
    new RegExp(`/c/__v/[0-9a-f]{16}-[0-9a-f]{8}/${relativePath}#${escapeRegExp(exportName)}`),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('handler lowering', () => {
  it('requires parsed model facts to allow module imports and constants as serializable captures', () => {
    const fileName = 'components/cart/cart-actions.tsx';
    const source = `
import { component } from '@kovojs/core';
import { track } from './analytics';

const LABEL = 'cart';

export const CartActions = component({
  render: () => <button onClick={() => track(LABEL)}>Track</button>,
});
`;
    const model = parseComponentModule(fileName, source);
    const emptyModel = parseComponentModule(
      'components/cart/empty.tsx',
      'export const Empty = component({ render: () => <button>Empty</button> });',
    );

    expect(capturesUnserializableReferences(['track', 'LABEL'], { model })).toBe(false);
    expect(capturesUnserializableReferences(['track', 'LABEL'], { model: emptyModel })).toBe(true);
  });

  it('names element params from parsed property-access terminal facts', () => {
    const source = `
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartBadge = component({
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
import { component } from '@kovojs/core';

export const CartDrawer = component({
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

  it('collects state derive export names for minifier preservation', () => {
    const disclosure = compileComponentModule({
      fileName: 'disclosure-demo.tsx',
      source: `
import { component } from '@kovojs/core';

export const DisclosureDemo = component({
  state: () => ({ open: false }),
  render: (_queries, state) => (
    <section hidden={!state.open}>Panel</section>
  ),
});
`,
    });

    expect(disclosure.handlerExports).toEqual([]);
    expect(disclosure.clientExports).toEqual(['DisclosureDemo$section_hidden_derive']);
    expect(collectMinifierReservedNames(disclosure)).toEqual([
      'DisclosureDemo$section_hidden_derive',
    ]);
  });

  it('reports KV210 for anonymous handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';
import { removeItem } from './actions';

export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV210',
        fileName: 'cart-badge.tsx',
        length: 5,
        message: kv210.message,
        severity: kv210.severity,
        start: { column: 13, line: 8 },
      },
    ]);
  });

  it('reports KV201 when a handler captures non-serializable browser objects', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV210',
        severity: kv210.severity,
      },
      {
        code: 'KV201',
        severity: 'error',
      },
    ]);
    const kv201 = result.diagnostics.find((diagnostic) => diagnostic.code === 'KV201');
    expect(kv201?.help).toMatch(
      /Would lower to: on:click="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\/cart-badge\.client\.js#CartBadge\$button_click"/,
    );
    expect(kv201?.help).toContain('Blocked expression: () => window.alert("x")');
    expect(kv201?.help).toContain(
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    );
    expect(kv201?.help).toContain(
      'Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.',
    );
    expect(kv201?.start).toEqual({ column: 9, line: 1 });
  });

  it('reports KV201 for globals outside the handler channels', () => {
    for (const expression of ['fetch("/api/cart")', 'localStorage.getItem("cart")']) {
      const result = compileComponentModule({
        fileName: 'cart-badge.tsx',
        source: `<button onClick={() => ${expression}}>x</button>`,
      });

      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210', 'KV201']);
    }
  });

  it('reports KV201 for captured outer locals that are not element params', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';
import { track } from './analytics';

export const CartBadge = component({
  render: () => {
    const snapshot = readSnapshot();
    return <button onClick={() => track(snapshot)}>Track</button>;
  },
});
`,
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210', 'KV201']);
  });

  it('allows handler references through state, element params, named imports, and static module constants', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';
import { track } from './analytics';

const LABEL = 'cart';

export const CartBadge = component({
  state: () => ({ count: 0 }),
  render: ({ quantity }) => (
    <button onClick={() => {
      state.count += quantity;
      track(LABEL, event.type, state.count);
    }}>Track</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210']);
    expect(serverSource).toContain('data-p-quantity="{quantity}"');
    expect(clientSource).toContain('import { track } from "./analytics";');
    expect(clientSource).toContain("const LABEL = 'cart';");
    expect(clientSource).toContain('ctx.state.count += ctx.params.quantity;');
    expect(clientSource).toContain('track(LABEL, event.type, ctx.state.count);');
  });

  it('reports KV201 instead of emitting secret-provenance module constants to the client', () => {
    for (const secretBinding of [
      'const KEY = process.env.API_KEY;',
      'const KEY = secret("api-key");',
      'const RAW = process.env.API_KEY; const KEY = RAW.slice(0, 4);',
      'const RAW = process.env.API_KEY; const KEY = { value: RAW };',
      'const RAW = process.env.API_KEY; const KEY = RAW ? RAW : "";',
    ]) {
      const result = compileComponentModule({
        fileName: 'cart-badge.tsx',
        source: `
import { component } from '@kovojs/core';
import { track } from './analytics';

${secretBinding}

export const CartBadge = component({
  render: () => <button onClick={() => track(KEY)}>Track</button>,
});
`,
      });
      const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210', 'KV201']);
      expect(clientSource).not.toContain('process.env');
      expect(clientSource).not.toContain('api-key');
      expect(clientSource).not.toContain('const KEY =');
      expect(clientSource).not.toContain('const RAW =');
    }
  });

  it('reports KV201 for imported data captures while preserving imported handler callees', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
import { component } from '@kovojs/core';
import { API_KEY, track } from './analytics';

export const CartBadge = component({
  render: () => <button onClick={() => track(API_KEY)}>Track</button>,
});
`,
    });
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210', 'KV201']);
    expect(clientSource).toContain('import { track } from "./analytics";');
    expect(clientSource).not.toContain('API_KEY');
  });

  it('passes a model-backed capture context through handler lowering', () => {
    const fileName = 'components/cart/cart-actions.tsx';
    const source = `
import { component } from '@kovojs/core';
import { track } from './analytics';

const LABEL = 'cart';

export const CartActions = component({
  state: () => ({ count: 0 }),
  render: () => (
    <button onClick={() => track(LABEL, state.count)}>Track</button>
  ),
});
`;
    const [handler] = lowerEventHandlers(
      { fileName, source },
      'CartActions',
      parseComponentModule(fileName, source),
    );

    expect(handler?.diagnostics?.map((diagnostic) => diagnostic.code)).toEqual(['KV210']);
  });

  it('allows standard expression roots without treating them as captures', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  state: () => ({ value: '' }),
  render: () => (
    <button onClick={() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          state.value = Object(event)['target']?.value?.toString?.() ?? undefined;
          clearTimeout(undefined);
          resolve(undefined);
        }, 0);
      });
    }}>Track</button>
  ),
});
`,
    });

    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210']);
    expect(clientSource).toContain(
      "ctx.state.value = Object(event)['target']?.value?.toString?.() ?? undefined;",
    );
    expect(clientSource).toContain('return new Promise((resolve) => {');
    expect(clientSource).toContain('setTimeout(() => {');
    expect(clientSource).toContain('clearTimeout(undefined);');
  });

  it('reports stable-name and serializability diagnostics for anonymous browser handlers', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV210', 'KV201']);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'KV210',
      severity: kv210.severity,
      start: { column: 9, line: 1 },
    });
    expect(result.diagnostics[1]).toMatchObject({
      code: 'KV201',
      severity: 'error',
      start: { column: 9, line: 1 },
    });
  });

  it('does not report KV201 for local variables named like non-serializable captures', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  render: () => (
    <button onClick={() => { const response = { ok: true }; return response.ok; }}>
      Check
    </button>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV210',
        fileName: 'cart-badge.tsx',
        length: 5,
        message: kv210.message,
        severity: kv210.severity,
        start: { column: 13, line: 4 },
      },
    ]);
  });

  it('versions handler URLs from the render-plan fingerprint plus emitted client module source', () => {
    const source = `
import { component } from '@kovojs/core';

export const CartBadge = component({
  render: () => <button onClick={() => add(item.id)}>Add</button>,
});
`;
    const first = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { count: 'number' } },
      source,
    });
    const second = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { count: 'number' } },
      source,
    });
    const shapeChanged = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { total: 'number' } },
      source,
    });
    const changed = compileComponentModule({
      fileName: 'cart-badge.tsx',
      queryShapes: { cart: { count: 'number' } },
      source: source.replace('add(item.id)', 'remove(item.id)'),
    });

    const versionPattern = /\/c\/__v\/([0-9a-f]{16})-([0-9a-f]{8})\//;
    const firstVersion = first.files[0]?.source.match(versionPattern);
    const secondVersion = second.files[0]?.source.match(versionPattern);
    const shapeChangedVersion = shapeChanged.files[0]?.source.match(versionPattern);
    const changedVersion = changed.files[0]?.source.match(versionPattern);

    expect(firstVersion).toBeDefined();
    expect(secondVersion?.[0]).toBe(firstVersion?.[0]);
    expect(shapeChangedVersion?.[1]).not.toBe(firstVersion?.[1]);
    expect(shapeChangedVersion?.[2]).toBe(firstVersion?.[2]);
    expect(changedVersion?.[1]).toBe(firstVersion?.[1]);
    expect(changedVersion?.[2]).not.toBe(firstVersion?.[2]);
  });

  it('emits executable handler bodies with stable unique anonymous names', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
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
    expect(serverSource).toContain('kovo-param-types="quantity:number"');
    expect(clientSource).toContain(
      'export const CartActions$button_click = handler((_event, ctx) => {',
    );
    expect(clientSource).toContain('return ctx.state.count += ctx.params.quantity;');
    expect(clientSource).toContain(
      'export const CartActions$button_click_2 = handler((_event, ctx) => {',
    );
    expect(clientSource).toContain(
      'return ctx.state.count = ctx.state.count - ctx.params.quantity;',
    );
  });

  it('preserves referenced named imports in generated client handler modules', () => {
    const result = compileComponentModule({
      fileName: 'components/tabs/tabs-demo.tsx',
      source: `
import { component } from '@kovojs/core';
import { tabsKeyDown as keyDown, tabsTriggerClick } from '@kovojs/headless-ui/tabs';

export const TabsDemo = component({
  state: () => ({ activeValue: 'overview', value: 'overview' }),
  render: () => (
    <section
      onKeyDown={() => {
        const result = keyDown(event, {
          activeValue: state.activeValue,
          items: [{ value: 'overview' }, { value: 'details' }],
          value: state.value,
        });
        if (result) {
          state.activeValue = result.activeValue ?? state.activeValue;
          state.value = result.value ?? state.value;
        }
      }}
      onClick={() => {
        const result = tabsTriggerClick(event, {
          itemValue: 'details',
          value: state.value,
        });
        if (result?.changed) {
          state.activeValue = result.value ?? state.activeValue;
          state.value = result.value ?? state.value;
        }
      }}
    />
  ),
});
`,
    });

    const clientSource = result.files[1]?.source ?? '';

    expect(clientSource).toContain(
      'import { tabsKeyDown as keyDown, tabsTriggerClick } from "@kovojs/headless-ui/tabs";',
    );
    expect(clientSource).toContain('const result = keyDown(event, {');
    expect(clientSource).toContain('activeValue: ctx.state.activeValue,');
    expect(clientSource).toContain('const result = tabsTriggerClick(event, {');
    expect(clientSource).toContain('value: ctx.state.value,');
    expect(clientSource).toContain(
      'ctx.state.activeValue = result.activeValue ?? ctx.state.activeValue;',
    );
    expect(clientSource).toContain('ctx.state.value = result.value ?? ctx.state.value;');
    expect(clientSource).not.toContain('ctx.params.value');
  });

  it('chains lowered author handlers before existing primitive on:* refs', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
  state: () => ({ count: 0 }),
  render: () => (
    <button
      on:click="/c/primitives/toggle.client.js#toggleTriggerClick"
      onClick={() => state.count += item.quantity}
    >
      Add one
    </button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\/components\/cart\/cart-actions\.client\.js#CartActions\$button_click \/c\/primitives\/toggle\.client\.js#toggleTriggerClick"/,
    );
    expect(serverSource).not.toContain('onClick=');
    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('kovo-param-types="quantity:number"');
    expect(clientSource).toContain(
      'export const CartActions$button_click = handler((_event, ctx) => {',
    );
    expect(clientSource).toContain('return ctx.state.count += ctx.params.quantity;');
  });

  it('expands static primitive attr spreads before chaining lowered author handlers', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
  state: () => ({ count: 0 }),
  render: () => (
    <button
      {...{
        'on:click': '/c/primitives/toggle.client.js#toggleTriggerClick',
        'data-state': 'off',
        role: 'button',
      }}
      onClick={() => state.count += item.quantity}
    >
      Add one
    </button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\/components\/cart\/cart-actions\.client\.js#CartActions\$button_click \/c\/primitives\/toggle\.client\.js#toggleTriggerClick"/,
    );
    expect(serverSource).toContain('data-state="off"');
    expect(serverSource).toContain('role="button"');
    expect(serverSource).not.toContain('{...{');
    expect(serverSource).not.toContain('onClick=');
    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('kovo-param-types="quantity:number"');
    expect(clientSource).toContain(
      'export const CartActions$button_click = handler((_event, ctx) => {',
    );
    expect(clientSource).toContain('return ctx.state.count += ctx.params.quantity;');
  });

  it('lowers asChild primitive wrappers onto the behavior-attribute merge path', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
  state: () => ({ count: 0 }),
  render: () => (
    <Tooltip.Trigger
      asChild
      attrs={{
        'on:click': '/c/primitives/tooltip.client.js#tooltipTriggerClick',
        'data-state': 'closed',
        role: 'button',
      }}
    >
      <button onClick={() => state.count += item.quantity}>Open</button>
    </Tooltip.Trigger>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\/components\/cart\/cart-actions\.client\.js#CartActions\$button_click \/c\/primitives\/tooltip\.client\.js#tooltipTriggerClick"/,
    );
    expect(serverSource).toContain('data-state="closed"');
    expect(serverSource).toContain('role="button"');
    expect(serverSource).not.toContain('Tooltip.Trigger');
    expect(serverSource).not.toContain('asChild');
    expect(serverSource).not.toContain('onClick=');
    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('kovo-param-types="quantity:number"');
  });

  it('lowers attrs-function primitive wrappers onto the behavior-attribute merge path', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
  state: () => ({ count: 0 }),
  render: () => (
    <Tooltip.Trigger
      attrs={{
        'on:click': '/c/primitives/tooltip.client.js#tooltipTriggerClick',
        'data-state': 'closed',
        role: 'button',
      }}
    >
      {(attrs) => (
        <button {...attrs} onClick={() => state.count += item.quantity}>Open</button>
      )}
    </Tooltip.Trigger>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toMatch(
      /on:click="\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\/components\/cart\/cart-actions\.client\.js#CartActions\$button_click \/c\/primitives\/tooltip\.client\.js#tooltipTriggerClick"/,
    );
    expect(serverSource).toContain('data-state="closed"');
    expect(serverSource).toContain('role="button"');
    expect(serverSource).not.toContain('Tooltip.Trigger');
    expect(serverSource).not.toContain('{(attrs)');
    expect(serverSource).not.toContain('{...attrs}');
    expect(serverSource).not.toContain('onClick=');
    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('kovo-param-types="quantity:number"');
  });

  it('declares boolean coercion for boolean-ish captured handler params', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
  render: () => (
    <button onClick={() => item.selected ? select(item.id) : deselect(item.id)}>Toggle</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('kovo-param-types="selected:boolean"');
    expect(serverSource).toContain('data-p-selected="{item.selected}"');
    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(clientSource).toContain(
      'return ctx.params.selected ? select(ctx.params.id) : deselect(ctx.params.id);',
    );
  });

  // SPEC §4.3 / §4.6 (KV231): two element-params that share a terminal property name must NOT
  // collapse onto one `data-p-*` attribute and one `ctx.params` slot. The browser keeps only the
  // first of two identical attributes, and the client call would resolve both arguments to the same
  // value, so the handler silently receives the wrong argument. Each distinct member expression
  // must get its own disambiguated param name end-to-end (server attribute + client `ctx.params`).
  it('disambiguates two element params that share a terminal property name', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
  render: () => (
    <button onClick={() => swap(item.id, item.parent.id)}>Swap</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    // Each distinct member expression keeps its own data-p-* attribute and value.
    expect(serverSource).toContain('data-p-id="{item.id}"');
    expect(serverSource).toContain('data-p-parent-id="{item.parent.id}"');

    // The colliding `data-p-id` must not be emitted twice (the browser would keep only the first).
    const idAttrMatches = serverSource.match(/data-p-id="/g) ?? [];
    expect(idAttrMatches).toHaveLength(1);

    // Each client argument maps to its OWN param slot — not both to ctx.params.id.
    expect(clientSource).toContain('return swap(ctx.params.id, ctx.params.parentId);');
    expect(clientSource).not.toContain('swap(ctx.params.id, ctx.params.id)');
  });

  it('extracts and rewrites handlers with nested object and block expressions', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
  render: () => (
    <button onClick={() => track(item.quantity, 'item.quantity > 0')}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).not.toContain('kovo-param-types="quantity:number"');
    expect(clientSource).toContain("return track(ctx.params.quantity, 'item.quantity > 0');");
  });

  it('infers element param types from AST usage contexts', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
  render: () => (
    <button onClick={() => track(item.quantity > 0, !item.selected)}>Add</button>
  ),
});
`,
    });

    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('data-p-quantity="{item.quantity}"');
    expect(serverSource).toContain('data-p-selected="{item.selected}"');
    expect(serverSource).toContain('kovo-param-types="quantity:number,selected:boolean"');
  });

  it('ignores event handler text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'components/cart/cart-actions.tsx',
      source: `
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
import { component } from '@kovojs/core';

export const CartActions = component({
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
