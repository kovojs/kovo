import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule, deriveAppGraph } from './index.js';

const kv230 = diagnosticDefinitions.KV230;
const kv303 = diagnosticDefinitions.KV303;
const kv316 = diagnosticDefinitions.KV316;

describe('fragment target validation', () => {
  it('reports removed fragmentTarget usage and points to query inference', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component({
  fragmentTarget: true,
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge>{cart.count}</cart-badge>,
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV223',
        help: expect.stringContaining('disableServerRefresh: true'),
        message:
          'Redundant removed component option; query-backed components infer server refresh targets. fragmentTarget',
        severity: 'lint',
      }),
    );
  });

  it('reports KV238 for duplicate derived fragment-target registry names', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr data-row={rowId}></tr>,
});

export const Cart_Row = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr data-row={rowId}></tr>,
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV238'))
      .toMatchInlineSnapshot(`
      [
        {
          "code": "KV238",
          "fileName": "cart-row.tsx",
          "help": "Would lower to: one derived fragment-target registry key that maps to exactly one component render entry.
      Blocked reason: duplicate fragment-target wire names make enhanced fragment patch routing ambiguous.
      Fixes: rename the exported component binding, add stable authored key identity for repeated instances, move one component so its derived module path namespace differs, or set disableServerRefresh: true on the query-backed component that should not receive enhanced patches.
      SPEC §4.5, §4.8, and §6.2 make fragment-target names derived registry-visible identities; duplicate keys make enhanced fragment patches ambiguous.
      Fragment target: cart-row/cart-row
      First writer: CartRow
      Duplicate writer: Cart_Row
      Would emit registry:
      interface FragmentTargets {
        'cart-row/cart-row': ...;
      }",
          "length": 8,
          "message": "Duplicate fragment-target wire name. cart-row/cart-row is used by CartRow and Cart_Row.",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 8,
          },
        },
      ]
    `);
  });

  it('accepts distinct fragment-target wire names', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr data-row={rowId}></tr>,
});

export const OrderRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr data-row={rowId}></tr>,
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV238')).toEqual([]);
  });

  it('reports KV238 when registry facts already contain the fragment target name', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      registryFacts: { fragmentTargets: ['cart-row/cart-row'] },
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr data-row={rowId}></tr>,
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV238'))
      .toMatchInlineSnapshot(`
      [
        {
          "code": "KV238",
          "fileName": "cart-row.tsx",
          "help": "Would lower to: one derived fragment-target registry key that maps to exactly one component render entry.
      Blocked reason: duplicate fragment-target wire names make enhanced fragment patch routing ambiguous.
      Fixes: rename the exported component binding, add stable authored key identity for repeated instances, move one component so its derived module path namespace differs, or set disableServerRefresh: true on the query-backed component that should not receive enhanced patches.
      SPEC §4.5, §4.8, and §6.2 make fragment-target names derived registry-visible identities; duplicate keys make enhanced fragment patches ambiguous.
      Fragment target: cart-row/cart-row
      Registry writer: registryFacts.fragmentTargets
      Duplicate writer: CartRow
      Would emit registry:
      interface FragmentTargets {
        'cart-row/cart-row': ...;
      }",
          "length": 7,
          "message": "Duplicate fragment-target wire name. cart-row/cart-row is already present in registry facts and is reused by CartRow.",
          "severity": "error",
          "start": {
            "column": 14,
            "line": 2,
          },
        },
      ]
    `);
  });

  it('accepts fragment target render inputs declared as queries or stamped props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String, quantity: Number, selected: Boolean },
  render: ({ cart, rowId }) => <tr kovo-c="cart-row" data-row={rowId}>{renderOnce(cart.count)}</tr>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[2]?.source).toContain(
      "'cart-row/cart-row': { rowId: string; quantity: number; selected: boolean };",
    );
    expect(result.files[2]?.source).toContain(`interface FragmentTargets {
  'cart-row/cart-row': { rowId: string; quantity: number; selected: boolean };
  }`);
  });

  it('preserves unknown declared prop types in fragment target registry facts', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
const jsonProp = createJsonProp();

export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String, payload: jsonProp },
  render: ({ rowId, payload }) => <tr kovo-c="cart-row" data-row={rowId}>{renderOnce(payload.label)}</tr>,
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.files[2]?.source).toContain(
      "'cart-row/cart-row': { rowId: string; payload: unknown };",
    );
    expect(result.files[2]?.source).not.toContain("'cart-row/cart-row': {};");
  });

  it('reports KV303 when fragment target render inputs cannot be rerendered from queries or stamped props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  render: ({ cart, priceList }) => <tr kovo-c="cart-row">{renderOnce(cart.count)}{priceList.version}</tr>,
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV303',
        fileName: 'cart-row.tsx',
        message: `${kv303.message} priceList`,
        severity: kv303.severity,
        // SECURITY_FINDINGS.md C1: the escapeText import prepended for the escaped static text
        // child (`priceList.version`) shifts the lowered-artifact diagnostic down one line.
        start: { column: 20, line: 5 },
        length: 9,
      },
    ]);
  });

  it('accepts isomorphic render inputs declared as queries, props, state, or static module constants', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
const DISPLAY = { currency: 'USD' };

export const CartBadge = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  props: { rowId: String },
  state: () => ({ selected: false }),
  render: ({ cart, rowId }, state) => (
    <cart-badge data-row={rowId} data-selected={state.selected}>
      {cart.count} {DISPLAY.currency}
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('accepts isomorphic mapped lists with lambda params and render-local consts', () => {
    const result = compileComponentModule({
      fileName: 'contact-list.tsx',
      source: `
export const ContactList = component({
  isomorphic: true,
  queries: { contacts: contactsQuery },
  state: () => ({ filter: '' }),
  render: ({ contacts }, state) => {
    const visible = contacts.items.filter((contact) => contact.name.includes(state.filter));
    const rows = visible.map((contact) => ({ id: contact.id, label: contact.name }));

    return (
      <ul>
        {rows.map((row) => (
          <li data-id={row.id}>{row.label}</li>
        ))}
        <li>{visible.length}</li>
      </ul>
    );
  },
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV303')).toEqual([]);
  });

  it('explains KV303 when render destructuring aliases a declared query key', () => {
    const result = compileComponentModule({
      fileName: 'task-list.tsx',
      source: `
export const TaskList = component({
  queries: { taskList: taskListQuery },
  render: ({ taskList: list }) => <ul kovo-c="task-list">{list.items.map((item) => <li>{item.title}</li>)}</ul>,
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV303')).toMatchObject([
      {
        code: 'KV303',
        fileName: 'task-list.tsx',
        help: expect.stringContaining('render destructuring renamed a declared query/prop key'),
        message: `${kv303.message} list (render destructuring aliases declared key taskList; use the declared key name in the render parameter)`,
        severity: kv303.severity,
      },
    ]);
  });

  it('reports KV303 when isomorphic render inputs are not live-declared', () => {
    const result = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
const env = getEnv();

export const CartBadge = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart, priceList }) => (
    <cart-badge>
      {cart.count} {priceList.version} {env.discountRate}
    </cart-badge>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV303')).toMatchObject([
      {
        code: 'KV303',
        fileName: 'cart-badge.tsx',
        message: `${kv303.message} priceList`,
        severity: kv303.severity,
      },
      {
        code: 'KV303',
        fileName: 'cart-badge.tsx',
        message: `${kv303.message} env`,
        severity: kv303.severity,
      },
    ]);
  });

  it('accepts fragment target children that can hoist through serializable props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{cart.count}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports KV230 when fragment target children capture unserializable values', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{window.location.href}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toMatchObject([
      {
        code: 'KV230',
        fileName: 'cart-row.tsx',
        help: [
          `${kv230.detailLabels.slotHoist} CartRow$slot_children`,
          `${kv230.detailLabels.blockedChildren} <span>{escapeText(window.location.href)}</span>`,
          kv230.help,
        ].join('\n'),
        message: `${kv230.message} CartRow`,
        severity: kv230.severity,
        // SECURITY_FINDINGS.md C1: the static text child is wrapped in escapeText(...) during
        // lowering (and the escapeText import prepended), so the blocked-children snippet shows the
        // escaped form and the diagnostic shifts down one line.
        start: { column: 9, line: 17 },
        length: 47,
      },
    ]);
  });

  it('reports KV230 when fragment target children capture outer locals outside stamped props', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => {
    const snapshot = readSnapshot();
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{snapshot.total}</span>
        </CartRow>
      </table>
    );
  },
});
`,
    });

    expect(
      result.diagnostics.map(({ code, help, message, severity }) => ({
        code,
        help,
        message,
        severity,
      })),
    ).toMatchInlineSnapshot(`
      [
        {
          "code": "KV230",
          "help": "Would hoist children to: CartRow$slot_children
      Blocked children: <span>{escapeText(snapshot.total)}</span>
      Blocked reason: fragment responses must fully describe the DOM they produce, but these children cannot be hoisted through serializable props.
      Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.
      SPEC §4.5 requires fragment-target children to lower to component references when they cross the target boundary.",
          "message": "Fragment-target children cannot lower to a component reference. CartRow",
          "severity": "error",
        },
      ]
    `);
  });

  it('allows fragment target children to use model-backed imports and constants', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
import { formatMoney } from './money';

const CURRENCY = 'USD';

export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => (
    <table>
      <CartRow rowId={cart.rowId}>
        <span>{formatMoney(cart.total)} {CURRENCY}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('does not report KV230 for local child variables named like non-serializable captures', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => {
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{(() => { const response = { label: 'ok' }; return response.label; })()}</span>
        </CartRow>
      </table>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target child text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component({
  queries: { cart: cartQuery },
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component({
  render: ({ cart }) => {
    const sample = '<CartRow><span>{window.location.href}</span></CartRow>';
    // <CartRow><span>{request.url}</span></CartRow>
    return (
      <table>
        <CartRow rowId={cart.rowId}>
          <span>{cart.count}</span>
        </CartRow>
      </table>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target declarations inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
const sample = "export const CartRow = component({ fragmentTarget: true, render: () => null });";
// export const OtherRow = component({ fragmentTarget: true, render: () => null });
export const CartTable = component({
  render: () => (
    <table>
      <CartRow>
        <span>{window.location.href}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores fragment target declarations inside strings and comments for graph facts', () => {
    const result = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
const sample = "export const CartRow = component({ fragmentTarget: true, render: () => null });";
// export const OtherRow = component({ fragmentTarget: true, render: () => null });
export const CartTable = component({
  queries: { cart: {} },
  render: () => (
    <table>
      <CartRow>
        <span>{cart.count}</span>
      </CartRow>
    </table>
  ),
});
`,
    });

    expect(result.componentGraphFacts).toEqual([
      {
        domName: 'cart-table',
        exportName: 'CartTable',
        fragments: ['cart-row/cart-table'],
        name: 'cart-row/cart-table',
        queries: ['cart'],
      },
    ]);
  });
});

// SPEC §4.5/§4.8 (KV316): a client self-render has no slot/children arguments, so an isomorphic
// island that composes children or named slots would drift from the server render.
describe('KV316 isomorphic slot composition', () => {
  it('reports KV316 when an isomorphic island accepts destructured children/slots', () => {
    const result = compileComponentModule({
      fileName: 'panel.tsx',
      source: `
export const Panel = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }, _state, { children, footer }) => (
    <panel-card>
      {children}
      <strong>{cart.count}</strong>
      <div>{footer}</div>
    </panel-card>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV316')).toMatchObject([
      {
        code: 'KV316',
        fileName: 'panel.tsx',
        message: `${kv316.message} children, footer`,
        severity: kv316.severity,
      },
    ]);
  });

  it('reports KV316 when an isomorphic island accepts an identifier slots parameter', () => {
    const result = compileComponentModule({
      fileName: 'shell.tsx',
      source: `
export const Shell = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }, _state, slots) => <app-shell>{slots.children}{cart.count}</app-shell>,
});
`,
    });

    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV316').length,
    ).toBeGreaterThan(0);
  });

  it('does not report KV316 for an isomorphic island without a slots parameter', () => {
    const result = compileComponentModule({
      fileName: 'badge.tsx',
      source: `
export const Badge = component({
  isomorphic: true,
  queries: { cart: cartQuery },
  render: ({ cart }) => <cart-badge>{cart.count}</cart-badge>,
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV316')).toEqual([]);
  });

  it('does not report KV316 for a children-accepting component that is not isomorphic', () => {
    const result = compileComponentModule({
      fileName: 'card.tsx',
      source: `
export const Card = component({
  render: (_queries, _state, { children, footer }) => (
    <div class="card">
      {children}
      <div class="card-footer">{footer}</div>
    </div>
  ),
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV316')).toEqual([]);
  });
});

// SPEC §4.5/§4.9/§9.1 (KV420): an island declaring mutable local `state` may not render inside
// another component's inferred server-refreshable fragment target — the morph carries no
// island-local kovo-state serialization and would clobber the child's live value on refresh.
const kv420 = diagnosticDefinitions.KV420;

describe('KV420 nested stateful island in a server-refreshable fragment target', () => {
  it('reports a same-module stateful child rendered inside a query-backed parent', () => {
    const result = compileComponentModule({
      fileName: 'cart-page.tsx',
      source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <section>
      <p>{cart.total}</p>
      <Stepper />
    </section>
  ),
});
`,
    });

    const kv420Diagnostics = result.diagnostics.filter((d) => d.code === 'KV420');
    expect(kv420Diagnostics).toHaveLength(1);
    expect(kv420Diagnostics[0]).toMatchObject({
      code: 'KV420',
      fileName: 'cart-page.tsx',
      help: kv420.help,
      severity: 'error',
    });
    expect(kv420Diagnostics[0]?.message).toContain('Stepper');
    expect(kv420Diagnostics[0]?.message).toContain('CartPanel');
  });

  it('reports an imported stateful child rendered inside a query-backed parent', () => {
    const stepper = compileComponentModule({
      fileName: 'src/components/stepper.tsx',
      source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});
`,
    });
    const { registryFacts } = deriveAppGraph({ components: [stepper] });

    const result = compileComponentModule({
      fileName: 'src/panels/cart-panel.tsx',
      registryFacts,
      source: `
import { Stepper } from '../components/stepper.js';

export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <section>
      <p>{cart.total}</p>
      <Stepper />
    </section>
  ),
});
`,
    });

    const kv420Diagnostics = result.diagnostics.filter((d) => d.code === 'KV420');
    expect(registryFacts.statefulComponents).toEqual(['components/stepper/stepper']);
    expect(kv420Diagnostics).toHaveLength(1);
    expect(kv420Diagnostics[0]?.message).toContain('Stepper');
    expect(kv420Diagnostics[0]?.message).toContain('CartPanel');
  });

  it('does not report when the stateful child is NOT inside a refreshable target (no queries)', () => {
    const result = compileComponentModule({
      fileName: 'cart-page.tsx',
      source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  render: () => (
    <section>
      <Stepper />
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((d) => d.code === 'KV420')).toEqual([]);
  });

  it('does not report when the parent sets disableServerRefresh: true', () => {
    const result = compileComponentModule({
      fileName: 'cart-page.tsx',
      source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: ({ cart }) => (
    <section>
      <p>{cart.total}</p>
      <Stepper />
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((d) => d.code === 'KV420')).toEqual([]);
  });

  it('does not report when the nested child declares no local state', () => {
    const result = compileComponentModule({
      fileName: 'cart-page.tsx',
      source: `
export const Stepper = component({
  props: { label: String },
  render: ({ label }) => <span>{label}</span>,
});

export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <section>
      <p>{cart.total}</p>
      <Stepper label="step" />
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((d) => d.code === 'KV420')).toEqual([]);
  });

  it('does not report when the nested stateful child is marked isomorphic (it self-renders)', () => {
    const result = compileComponentModule({
      fileName: 'cart-page.tsx',
      source: `
export const Stepper = component({
  isomorphic: true,
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <section>
      <p>{cart.total}</p>
      <Stepper />
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((d) => d.code === 'KV420')).toEqual([]);
  });

  it('does not report when the child local state is renderOnce (document-lifetime-immutable)', () => {
    const result = compileComponentModule({
      fileName: 'cart-page.tsx',
      source: `
export const Stepper = component({
  state: () => ({ id: crypto.randomUUID() }),
  render: (_, state) => <span>{renderOnce(state.id)}</span>,
});

export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => (
    <section>
      <p>{cart.total}</p>
      <Stepper />
    </section>
  ),
});
`,
    });

    expect(result.diagnostics.filter((d) => d.code === 'KV420')).toEqual([]);
  });

  it('does not report a stateful sibling that the refreshable parent never renders', () => {
    const result = compileComponentModule({
      fileName: 'cart-page.tsx',
      source: `
export const Stepper = component({
  state: () => ({ count: 0 }),
  render: (_, state) => <span>{state.count}</span>,
});

export const CartPanel = component({
  queries: { cart: {} },
  render: ({ cart }) => <section><p>{cart.total}</p></section>,
});
`,
    });

    expect(result.diagnostics.filter((d) => d.code === 'KV420')).toEqual([]);
  });
});
