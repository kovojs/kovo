import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

describe('structural JSX IR lowering', () => {
  it('composes overlap-prone JSX rewrites through one canonical tree', () => {
    const result = compileComponentModule({
      fileName: 'product-page.tsx',
      registryFacts: { queries: { product: 'ProductQuery' }, routes: ['/products/:id'] },
      source: `
import { selectProduct } from './handlers';

export const ProductPage = component({
  fragmentTarget: true,
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
          title={product.name.toUpperCase()}
          hidden={!state.open}
          onClick={selectProduct}
        >
          Product {product.name}
          <span>{state.open ? 'open' : 'closed'}</span>
        </Link>
      </Tooltip.Trigger>
      <button onClick={() => document.getElementById('details')!.showModal()}>Details</button>
      <dialog id="details">Details</dialog>
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
    expect(serverSource).toMatch(
      /on:click="\/c\/product-page\.client\.js\?v=[0-9a-f]{8}#ProductPage\$selectProduct \/c\/primitive#click"/,
    );
    expect(serverSource).toContain('data-state="closed"');
    expect(serverSource).toContain('commandfor="details" command="show-modal"');
    expect(serverSource).toContain('<dialog id="details">Details</dialog>');
    expect(serverSource).toContain('data-derive="product.ProductPage$a_title_derive"');
    expect(serverSource).toContain('data-derive-attr="title"');
    expect(serverSource).toContain('data-bind:hidden="/c/product-page.client.js?v=');
    expect(serverSource).toContain('Product <span data-bind="product.name">{product.name}</span>');
    expect(serverSource).toContain('#ProductPage$span_text_derive');
    expect(clientSource).toContain(
      "import { applyCompiledQueryUpdatePlan, derive, handler } from '@kovojs/runtime';",
    );
    expect(clientSource).toContain(
      'export const ProductPage$a_title_derive = derive(["product"], (product) => product.name.toUpperCase());',
    );
    expect(clientSource).toContain('export const ProductPage$selectProduct');
    expect(clientSource).toContain('selectProduct(event, ctx)');
    expect(clientSource).toContain(
      'export const ProductPage$a_hidden_derive = derive(["state"], (state) => ((!state.open) ? "" : null));',
    );
    expect(clientSource).toContain(
      "export const ProductPage$span_text_derive = derive([\"state\"], (state) => state.open ? 'open' : 'closed');",
    );
    expect(result.queryUpdatePlans).toEqual([
      expect.objectContaining({
        query: 'product',
        stamps: expect.arrayContaining([
          expect.objectContaining({ attr: 'title' }),
        ]),
      }),
    ]);
    expect(result.componentGraphFacts[0]).toMatchObject({
      fragments: ['product-page/product-page'],
    });
    expect(result.platformSubstitutions).toEqual([
      {
        action: 'show-modal',
        event: 'click',
        kind: 'dialog',
        tag: 'button',
        target: 'details',
      },
    ]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('inserts generated imports deterministically for mixed structural helpers', () => {
    const result = compileComponentModule({
      fileName: 'import-order.tsx',
      source: `
/** @jsxImportSource @kovojs/server */
export const ImportOrder = component({
  queries: { product: productQuery },
  state: () => ({ value: 50 }),
  render: ({ product, label }, state) => (
    <import-order>
      <img viewTransitionName={product.slug} src="/p1.png" />
      <span style={{ width: \`\${state.value}%\` }} />
      <strong>{label.name}</strong>
    </import-order>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect({
      clientSource: clientSource.replace(/v=[0-9a-f]{8}/g, 'v=HASH'),
      diagnostics: result.diagnostics,
      serverSource: serverSource.replace(/v=[0-9a-f]{8}/g, 'v=HASH'),
    }).toMatchInlineSnapshot(`
      {
        "clientSource": "// @kovojs-ir
      import { applyCompiledQueryUpdatePlan, derive, kovoStyleProperty } from '@kovojs/runtime';

      export const ImportOrder$span_style_derive = derive(["state"], (state) => [kovoStyleProperty("width", \`\${state.value}%\`)].filter(Boolean).join('; '));

      export const ImportOrder$img_style_derive = derive(["product"], (product) => kovoStyleProperty("view-transition-name", product.slug));

      export const ImportOrder$queryUpdatePlans = {
        "product"(root, value) {
          return applyCompiledQueryUpdatePlan(root, "product", value, { bindings: true, derives: [], stamps: [{ attr: "style", selector: "[data-derive=\\"product.ImportOrder$img_style_derive\\"]", select(value) { return ImportOrder$img_style_derive.run(value); } }], templateStamps: [] });
        },
      };
      ",
        "diagnostics": [],
        "serverSource": "// @kovojs-ir
      export function renderSource() {
        return \`import { escapeText } from '@kovojs/server';
      import { derive, kovoStyleProperty } from '@kovojs/runtime';

      export const ImportOrder$img_style_derive = derive(["product"], (product) => kovoStyleProperty("view-transition-name", product.slug));
      export const ImportOrder$span_style_derive = derive(["state"], (state: any) => [kovoStyleProperty("width", \\\`\\\${state.value}%\\\`)].filter(Boolean).join('; '));


      /** @jsxImportSource @kovojs/server */
      export const ImportOrder = component({
        queries: { product: productQuery },
        state: () => ({ value: 50 }),
        render: ({ product, label }, state) => (
          <import-order kovo-deps="product" kovo-state="{&quot;value&quot;:50}">
            <img data-derive="product.ImportOrder$img_style_derive" data-derive-attr="style" src="/p1.png" />
            <span style={{ width: \\\`\\\${state.value}%\\\` }} data-bind:style="/c/import-order.client.js?v=HASH#ImportOrder$span_style_derive" />
            <strong>{escapeText(label.name)}</strong>
          </import-order>
        ),
      });
      ImportOrder.name = "import-order/import-order";
      \`;
      }
      ",
      }
    `);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('names both primitive and author writers for overlapping structural conflicts', () => {
    const result = compileComponentModule({
      fileName: 'primitive-conflict.tsx',
      source: `
export const PrimitiveConflict = component({
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
