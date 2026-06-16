import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';
import type { CompilerDiagnostic } from './diagnostics.js';

function diagnosticTextSnapshot(diagnostics: readonly CompilerDiagnostic[]): Array<{
  code: string;
  fileName: string;
  help?: string;
  length?: number;
  message: string;
  severity: string;
  start?: { column: number; line: number };
}> {
  return diagnostics.map(({ code, fileName, help, length, message, severity, start }) => ({
    code,
    fileName,
    ...(help === undefined ? {} : { help: normalizeDiagnosticHelp(help) }),
    ...(length === undefined ? {} : { length }),
    message,
    severity,
    ...(start === undefined ? {} : { start }),
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
            "fileName": "cart-badge.tsx",
            "help": "Would lower to: on:click="/c/cart-badge.client.js?v=<version>#CartBadge$button_click"
        Blocked expression: () => window.alert("x")
        Element params: -
        Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.
        Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.
        SPEC §4.3 and §5.2 require handler lowering to cross only explicit serializable capture channels.",
            "length": 8,
            "message": "Closure captures unserializable value.",
            "severity": "error",
            "start": {
              "column": 9,
              "line": 1,
            },
          },
          {
            "code": "KV230",
            "fileName": "cart-row.tsx",
            "help": "Would hoist children to: CartRow$slot_children
        Blocked children: <span>{escapeText(snapshot.total)}</span>
        Blocked reason: fragment responses must fully describe the DOM they produce, but these children cannot be hoisted through serializable props.
        Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.
        SPEC §4.5 requires fragment-target children to lower to component references when they cross the target boundary.",
            "length": 41,
            "message": "Fragment-target children cannot lower to a component reference. CartRow",
            "severity": "error",
            "start": {
              "column": 11,
              "line": 15,
            },
          },
          {
            "code": "KV235",
            "fileName": "cart-badge.tsx",
            "help": "Blocked reason: app source is hand-authoring lowered string/render IR instead of TSX.
        Fixes: write JSX with typed expressions and let the compiler emit renderSource(), kovo-c, kovo-deps, and data-bind.
        SPEC §5.2: TSX is the sole app-authoring surface.
        Escape: there is no v1 suppression or ejection workflow for hand-authored lowered IR.
        TSX equivalent direction: render with JSX, for example \`render: (...) => (<cart-badge>...</cart-badge>)\`, and use typed expressions such as \`{cart.count}\` instead of data-bind strings.",
            "length": 93,
            "message": "App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.",
            "severity": "error",
            "start": {
              "column": 25,
              "line": 4,
            },
          },
          {
            "code": "KV311",
            "fileName": "cart-badge.tsx",
            "help": "Coverage classification: CartBadge expression UNHANDLED
        Blocked update: query expression has no data-bind, renderOnce, fragment, or isomorphic status
        Fixes: add a data-bind/query update plan, mark the expression renderOnce, move the subtree behind a fragment target, or make the component isomorphic.
        SPEC §4.9 requires every query/state-dependent rendered position to have plan, fragment, isomorphic, or renderOnce coverage.",
            "length": 13,
            "message": "Query/state-dependent DOM position has no update status. CartBadge cart.discount expression",
            "severity": "warn",
            "start": {
              "column": 44,
              "line": 4,
            },
          },
        ]
      `);
  });
});
