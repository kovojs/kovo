import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

describe('structural JSX IR lowering', () => {
  it('composes overlap-prone JSX rewrites through one canonical tree', () => {
    const result = compileComponentModule({
      fileName: 'product-page.tsx',
      registryFacts: { queries: { product: 'ProductQuery' }, routes: ['/products/:id'] },
      source: `
export const ProductPage = component('product-page', {
  queries: { product: productQuery },
  state: () => ({ open: false }),
  render: (_queries, state) => (
    <product-page>
      <Tooltip.Trigger
        asChild
        attrs={{
          class: 'primitive',
          'on:click': '/c/primitive#click',
          'data-state': 'closed',
        }}
      >
        <Link
          class="nav-link"
          to="/products/:id"
          params={{ id: 'p1' }}
          viewTransitionName={product.slug}
          title={product.name.toUpperCase()}
          hidden={!state.open}
        >
          Product {product.name}
          <span>{state.open ? 'open' : 'closed'}</span>
        </Link>
      </Tooltip.Trigger>
    </product-page>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';
    const clientSource = result.files[1]?.source ?? '';

    expect(result.diagnostics).toEqual([]);
    expect(serverSource).not.toContain('Tooltip.Trigger');
    expect(serverSource).not.toContain('<Link');
    expect(serverSource).not.toContain('viewTransitionName=');
    expect(serverSource).toContain('class="primitive nav-link"');
    expect(serverSource).toContain('href="/products/p1"');
    expect(serverSource).toContain('on:click="/c/primitive#click"');
    expect(serverSource).toContain('data-state="closed"');
    expect(serverSource).toContain('data-derive="product.ProductPage$a_style_derive"');
    expect(serverSource).toContain('data-derive-attr="style"');
    expect(serverSource).toContain('data-bind:title="product.ProductPage$a_title_derive"');
    expect(serverSource).toContain('data-bind:hidden="/c/product-page.client.js?v=');
    expect(serverSource).toContain(
      'Product <span data-bind="product.name">{product.name}</span>',
    );
    expect(serverSource).toContain('#ProductPage$span_text_derive');
    expect(clientSource).toContain(
      'export const ProductPage$a_style_derive = derive(["product"], (product) => kovoStyleProperty("view-transition-name", product.slug));',
    );
    expect(clientSource).toContain(
      "import { applyCompiledQueryUpdatePlan, derive, kovoStyleProperty } from '@kovojs/runtime';",
    );
    expect(clientSource).toContain(
      'export const ProductPage$a_title_derive = derive(["product"], (product) => product.name.toUpperCase());',
    );
    expect(clientSource).toContain(
      "export const ProductPage$a_hidden_derive = derive([\"state\"], (state) => ((!state.open) ? \"\" : null));",
    );
    expect(clientSource).toContain(
      "export const ProductPage$span_text_derive = derive([\"state\"], (state) => state.open ? 'open' : 'closed');",
    );
    expect(result.queryUpdatePlans).toEqual([
      expect.objectContaining({
        query: 'product',
        stamps: expect.arrayContaining([
          expect.objectContaining({ attr: 'style' }),
          expect.objectContaining({ attr: 'title' }),
        ]),
      }),
    ]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('names both primitive and author writers for overlapping structural conflicts', () => {
    const result = compileComponentModule({
      fileName: 'primitive-conflict.tsx',
      source: `
export const PrimitiveConflict = component('primitive-conflict', {
  render: () => (
    <Tooltip.Trigger asChild attrs={{ commandfor: 'drawer' }}>
      <button commandfor="confirm">Open</button>
    </Tooltip.Trigger>
  ),
});
`,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'KV231',
        message:
          'Unmergeable attribute conflict in primitive composition. commandfor (writers: primitive attrs, author JSX)',
        start: { column: 15, line: 5 },
      }),
    );
  });
});
