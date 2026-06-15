import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

describe('ID and content-model validation', () => {
  it('accepts literal IDREFs that reference ids in component scope', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <label for="cart-search">Search</label>
      <input id="cart-search" aria-describedby="cart-help cart-extra" />
      <p id="cart-help">Filter cart items.</p>
      <p id="cart-extra">Updates as you type.</p>
      <button commandfor="cart-drawer" command="show-modal">Open</button>
      <dialog id="cart-drawer">Cart</dialog>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('accepts package-prefixed behavior IDREFs that reference ids in component scope', () => {
    const result = compileComponentModule({
      fileName: 'pricing-link.tsx',
      packageComponentPrefixes: [
        {
          idrefBehaviorAttributes: ['tooltip'],
          packageName: '@jiso/headless-ui',
          prefix: 'jiso-',
        },
      ],
      source: `
export const PricingLink = component('pricing-link', {
  render: () => (
    <section>
      <a href="/pricing" jiso-tooltip="pricing-tip">Pricing</a>
      <p id="pricing-tip">Starts at $20.</p>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW221 when an IDREF is only satisfied by another component', () => {
    const result = compileComponentModule({
      fileName: 'search-controls.tsx',
      source: `
export const SearchLabel = component('search-label', {
  render: () => <label for="shared-search">Search</label>,
});

export const SearchInput = component('search-input', {
  render: () => <input id="shared-search" />,
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW221',
        fileName: 'search-controls.tsx',
        length: 19,
        message: 'IDREF references an id not present in component scope. shared-search',
        severity: 'error',
        start: { column: 24, line: 3 },
      },
    ]);
  });

  it('reports FW221 for package-prefixed behavior IDREFs that miss component scope ids', () => {
    const result = compileComponentModule({
      fileName: 'pricing-link.tsx',
      packageComponentPrefixes: [
        {
          effectivePrefix: 'acme-ui-',
          idrefBehaviorAttributes: ['tooltip'],
          packageName: '@acme/headless-ui',
          prefix: 'acme-',
        },
      ],
      source: `
export const PricingLink = component('pricing-link', {
  render: () => (
    <section>
      <a href="/pricing" acme-ui-tooltip="missing-tip" fw-tooltip="framework-owned">Pricing</a>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW221',
        fileName: 'pricing-link.tsx',
        length: 29,
        message: 'IDREF references an id not present in component scope. missing-tip',
        severity: 'error',
        start: { column: 26, line: 5 },
      },
    ]);
  });

  it('reports FW221 for literal IDREFs that miss component scope ids', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <label for="cart-search">Search</label>
      <input id="cart-query" aria-describedby="cart-help missing-help" />
      <p id="cart-help">Filter cart items.</p>
      <button popovertarget="filters">Filters</button>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW221',
        fileName: 'cart-shell.tsx',
        length: 17,
        message: 'IDREF references an id not present in component scope. cart-search',
        severity: 'error',
        start: { column: 14, line: 5 },
      },
      {
        code: 'FW221',
        fileName: 'cart-shell.tsx',
        length: 41,
        message: 'IDREF references an id not present in component scope. missing-help',
        severity: 'error',
        start: { column: 30, line: 6 },
      },
      {
        code: 'FW221',
        fileName: 'cart-shell.tsx',
        length: 23,
        message: 'IDREF references an id not present in component scope. filters',
        severity: 'error',
        start: { column: 15, line: 8 },
      },
    ]);
  });

  it('ignores ID and IDREF text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => {
    const sample = '<label for="missing">Search</label><input id="duplicate" id="duplicate" />';
    // <button popovertarget="missing-popover"></button>
    return <section><span id="cart-title">Cart</span></section>;
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW224 for duplicate literal ids in component scope', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <h2 id="cart-title">Cart</h2>
      <output id="cart-title">2 items</output>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW224',
        fileName: 'cart-shell.tsx',
        message:
          'Static id appears in a repeatable component or duplicate page composition. duplicate id="cart-title"',
        severity: 'error',
        start: { column: 15, line: 6 },
        length: 15,
      },
    ]);
  });

  it('reports FW224 without FW221 when an IDREF targets a duplicated id', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <button commandfor="cart-drawer" command="show-modal">Open</button>
      <dialog id="cart-drawer">Cart</dialog>
      <dialog id="cart-drawer">Duplicate</dialog>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW224',
        fileName: 'cart-shell.tsx',
        message:
          'Static id appears in a repeatable component or duplicate page composition. duplicate id="cart-drawer"',
        severity: 'error',
        start: { column: 15, line: 7 },
        length: 16,
      },
    ]);
  });

  it('reports FW224 for static ids inside repeatable list stamps', () => {
    const result = compileComponentModule({
      fileName: 'cart-list.tsx',
      source: `
export const CartList = component('cart-list', {
  render: () => (
    <ul data-bind-list="cart.items" fw-key="productId">
      <template fw-stamp>
        <li id="cart-row"><span data-bind=".name">Mug</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW224',
        fileName: 'cart-list.tsx',
        message:
          'Static id appears in a repeatable component or duplicate page composition. repeatable id="cart-row"',
        severity: 'error',
        start: { column: 13, line: 6 },
        length: 13,
      },
    ]);
  });

  it('allows static ids on non-repeated data-bind-list containers', () => {
    const result = compileComponentModule({
      fileName: 'cart-list.tsx',
      source: `
export const CartList = component('cart-list', {
  render: () => (
    <ul id="cart-items" data-bind-list="cart.items" fw-key="productId">
      <template fw-stamp>
        <li><span data-bind=".name">Mug</span></li>
      </template>
    </ul>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('accepts native table rows when the parser keeps the authored tree shape', () => {
    const result = compileComponentModule({
      fileName: 'cart-table.tsx',
      registryFacts: {
        components: ['cart-row'],
      },
      source: `
export const CartTable = component('cart-table', {
  render: () => (
    <table>
      <tbody>
        <tr fw-c="cart-row">
          <td>Cart row</td>
        </tr>
      </tbody>
    </table>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('reports FW225 for parser-reparented HTML content-model violations', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <p>
        Cart intro
        <div>Parser closes the paragraph before this div.</div>
      </p>
      <tr>
        <td>Detached row</td>
      </tr>
    </section>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([
      {
        code: 'FW225',
        fileName: 'cart-shell.tsx',
        length: 5,
        message: 'JSX nesting violates the HTML content model. <div> cannot appear inside <p>',
        severity: 'error',
        start: { column: 9, line: 7 },
      },
      {
        code: 'FW225',
        fileName: 'cart-shell.tsx',
        length: 4,
        message:
          'JSX nesting violates the HTML content model. <tr> must be inside a table section or table',
        severity: 'error',
        start: { column: 7, line: 9 },
      },
    ]);
  });

  it('ignores HTML content-model text inside strings and comments', () => {
    const result = compileComponentModule({
      fileName: 'cart-shell.tsx',
      source: `
export const CartShell = component('cart-shell', {
  render: () => {
    const sample = '<p><div>Not JSX</div></p><tr><td>Detached</td></tr>';
    // <p><section>Not JSX</section></p>
    return (
      <section>
        <p>Cart intro</p>
        <table><tbody><tr><td>Attached row</td></tr></tbody></table>
      </section>
    );
  },
});
`,
    });

    expect(result.diagnostics).toEqual([]);
  });
});
