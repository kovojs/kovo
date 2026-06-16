import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';
import type { CompilerDiagnostic } from './diagnostics.js';

function diagnosticTextSnapshot(diagnostics: readonly CompilerDiagnostic[]): Array<{
  code: string;
  help?: string;
  message: string;
  severity: string;
}> {
  return diagnostics.map(({ code, help, message, severity }) => ({
    code,
    ...(help === undefined ? {} : { help: normalizeDiagnosticHelp(help) }),
    message,
    severity,
  }));
}

function normalizeDiagnosticHelp(help: string): string {
  return help.replaceAll(/\?v=[0-9a-f]{8}/g, '?v=<version>');
}

describe('compiler conformance compatibility diagnostics', () => {
  it('snapshots high-value SPEC diagnostic text without browser artifacts', () => {
    const kv201 = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    }).diagnostics.filter((diagnostic) => diagnostic.code === 'KV201');

    const kv230 = compileComponentModule({
      fileName: 'cart-row.tsx',
      source: `
export const CartRow = component('cart-row', {
  fragmentTarget: true,
  props: { rowId: String },
  render: ({ rowId }) => <tr kovo-c="cart-row" data-row={rowId}></tr>,
});

export const CartTable = component('cart-table', {
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
    }).diagnostics.filter((diagnostic) => diagnostic.code === 'KV230');

    const kv235 = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => \`<cart-badge kovo-deps="cart"><span data-bind="cart.count">\${cart.count}</span></cart-badge>\`,
});
`,
    }).diagnostics.filter((diagnostic) => diagnostic.code === 'KV235');

    const kv311 = compileComponentModule({
      fileName: 'cart-badge.tsx',
      source: `
export const CartBadge = component('cart-badge', {
  queries: { cart: cartQuery },
  render: ({ cart }) => <strong className={cart.discount}>Discount</strong>,
});
`,
    }).diagnostics.filter((diagnostic) => diagnostic.code === 'KV311');

    expect(diagnosticTextSnapshot([...kv201, ...kv230, ...kv235, ...kv311]))
      .toMatchInlineSnapshot(`
        [
          {
            "code": "KV201",
            "help": "Would lower to: on:click="/c/cart-badge.client.js?v=<version>#CartBadge$button_click"
        Blocked expression: () => window.alert("x")
        Element params: -
        Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.
        Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.",
            "message": "Closure captures unserializable value.",
            "severity": "error",
          },
          {
            "code": "KV230",
            "help": "Would hoist children to: CartRow$slot_children
        Blocked children: <span>{escapeText(snapshot.total)}</span>
        Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.",
            "message": "Fragment-target children cannot lower to a component reference. CartRow",
            "severity": "error",
          },
          {
            "code": "KV235",
            "help": "SPEC §5.2: TSX is the sole app-authoring surface. Write JSX with typed expressions and let the compiler emit renderSource(), kovo-c, kovo-deps, and data-bind.
        TSX equivalent direction: render with JSX, for example \`render: (...) => (<cart-badge>...</cart-badge>)\`, and use typed expressions such as \`{cart.count}\` instead of data-bind strings.",
            "message": "App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.",
            "severity": "error",
          },
          {
            "code": "KV311",
            "help": "Coverage classification: CartBadge expression UNHANDLED
        Blocked update: query expression has no data-bind, renderOnce, fragment, or isomorphic status
        Fixes: add a data-bind/query update plan, mark the expression renderOnce, move the subtree behind a fragment target, or make the component isomorphic.
        SPEC §4.9 requires every query/state-dependent rendered position to have plan, fragment, isomorphic, or renderOnce coverage.",
            "message": "Query/state-dependent DOM position has no update status. CartBadge cart.discount expression",
            "severity": "warn",
          },
        ]
      `);
  });
});
