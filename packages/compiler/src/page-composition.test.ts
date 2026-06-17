import { describe, expect, it } from 'vitest';

import { compileComponentModule, composePageComponentArtifacts } from './index.js';

describe('page component artifact composition', () => {
  it('rewrites duplicate dashed host leaves to stable registry-key kovo-c stamps and CSS scopes', () => {
    const accordionRoot = compileComponentModule({
      fileName: 'components/accordion.tsx',
      source: `
export const Root = component({
  css: \`
    .label { color: teal; }
  \`,
  render: () => <root><span class="label">Accordion</span></root>,
});
`,
    });
    const tabsRoot = compileComponentModule({
      fileName: 'components/tabs.tsx',
      source: `
export const Root = component({
  css: \`
    .label { color: orange; }
  \`,
  render: () => <root><span class="label">Tabs</span></root>,
});
`,
    });

    const [composedAccordion, composedTabs] = composePageComponentArtifacts([
      accordionRoot,
      tabsRoot,
    ]);

    expect(composedAccordion?.componentGraphFacts).toEqual([
      {
        disambiguatedDomName: 'components/accordion/root',
        domName: 'root',
        name: 'components/accordion/root',
      },
    ]);
    expect(composedTabs?.componentGraphFacts).toEqual([
      {
        disambiguatedDomName: 'components/tabs/root',
        domName: 'root',
        name: 'components/tabs/root',
      },
    ]);
    expect(composedAccordion?.files.find((file) => file.kind === 'server')?.source).toContain(
      '<root kovo-c="components/accordion/root">',
    );
    expect(composedAccordion?.files.find((file) => file.kind === 'css')?.source).toContain(
      '@scope ([kovo-c="components/accordion/root"]) to (:scope [kovo-c])',
    );
    expect(composedAccordion?.files.find((file) => file.kind === 'css')?.source).toContain(
      '[kovo-c="components/accordion/root"] .label:not([kovo-c]):not([kovo-c] *)',
    );
    expect(composedAccordion?.cssAssets).toEqual([
      expect.objectContaining({
        componentName: 'components/accordion/root',
        criticalCss: expect.stringContaining('[kovo-c="components/accordion/root"]'),
      }),
    ]);
  });

  it('rewrites duplicate native host kovo-c values in emitted server artifacts', () => {
    const cartRow = compileComponentModule({
      fileName: 'components/cart-row.tsx',
      source: `
export const Row = component({
  render: () => <tr><td>Cart</td></tr>,
});
`,
    });
    const orderRow = compileComponentModule({
      fileName: 'components/order-row.tsx',
      source: `
export const Row = component({
  render: () => <tr><td>Order</td></tr>,
});
`,
    });

    const [composedCartRow, composedOrderRow] = composePageComponentArtifacts([cartRow, orderRow]);

    const cartServerSource = composedCartRow?.files.find((file) => file.kind === 'server')?.source;
    const orderServerSource = composedOrderRow?.files.find(
      (file) => file.kind === 'server',
    )?.source;
    expect(cartServerSource).toContain('<tr kovo-c="components/cart-row/row">');
    expect(orderServerSource).toContain('<tr kovo-c="components/order-row/row">');
    expect(cartServerSource).not.toContain('kovo-c="row"');
    expect(orderServerSource).not.toContain('kovo-c="row"');
  });

  it('leaves unique page component leaves unchanged', () => {
    const cartBadge = compileComponentModule({
      fileName: 'components/cart-badge.tsx',
      source: `
export const CartBadge = component({
  render: () => <cart-badge>Cart</cart-badge>,
});
`,
    });

    expect(composePageComponentArtifacts([cartBadge])).toEqual([cartBadge]);
  });
});
