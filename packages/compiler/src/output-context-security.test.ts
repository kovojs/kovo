import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

const kv236 = 'Unsafe output context requires an explicit trusted Kovo escape hatch.';

describe('compiler output-context security', () => {
  it('keeps text and title/aria attributes in safe output contexts', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component({
  render: ({ product }) => (
    <article title={product.name} aria-label={product.name}>
      <h2>{product.name}</h2>
    </article>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    // SPEC §1/§5.2: text children are a text output context; title/aria stay attributes.
    expect(serverSource).toContain('{escapeText(product.name)}</h2>');
    expect(serverSource).toContain('title={product.name}');
    expect(serverSource).toContain('aria-label={product.name}');
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('rejects unsafe and implicit-external literal URL attributes', () => {
    const result = compileComponentModule({
      fileName: 'links.tsx',
      source: `
export const Links = component({
  render: () => (
    <nav>
      <a href="javascript:alert(1)">bad</a>
      <a href="https://example.com/pricing">external</a>
      <a href="https://trusted.example/docs" external>trusted external</a>
      <a href="/pricing">internal</a>
    </nav>
  ),
});
`,
      registryFacts: { routes: ['/pricing'] },
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} href="javascript:alert(1)" uses an unsafe URL scheme`,
        }),
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} href="https://example.com/pricing" is an external literal URL without external`,
        }),
      ]),
    );
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('https://trusted.example/docs'),
        }),
      ]),
    );
  });

  it('rejects arbitrary dynamic style text and unsafe static CSS urls', () => {
    const result = compileComponentModule({
      fileName: 'styled-card.tsx',
      source: `
export const StyledCard = component({
  styles: \`
    .card { background-image: url("javascript:alert(1)"); }
  \`,
  render: ({ product }) => <article class="card" style={product.css}>Card</article>,
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} dynamic style text`,
        }),
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} styles contains an unsafe CSS url()`,
        }),
      ]),
    );
  });

  it('emits generated style properties through the runtime output helper', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component({
  queries: { product: productQuery },
  render: ({ product }) => <img viewTransitionName={product.slug} src="/p1.png" />,
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(serverSource).toContain(
      `import { derive, kovoStyleProperty } from '@kovojs/browser/generated';`,
    );
    expect(serverSource).toContain(
      `derive(["product"], (product) => kovoStyleProperty("view-transition-name", product.slug));`,
    );
    expect(clientSource).toContain(
      `import { applyCompiledQueryUpdatePlan, derive, kovoStyleProperty } from '@kovojs/browser/generated';`,
    );
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
  });

  it('lowers state style objects through generated style-property derives', () => {
    const result = compileComponentModule({
      fileName: 'slider-demo.tsx',
      source: `
export const SliderDemo = component({
  state: () => ({ value: 50 }),
  render: (_queries, state) => (
    <slider-demo>
      <span style={{ width: \`\${state.value}%\` }} />
      <span style={{ left: \`\${state.value}%\`, top: '50%', transform: 'translate(-50%, -50%)' }} />
    </slider-demo>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect({
      clientSource: clientSource.replace(/\/c\/__v\/[0-9a-f]{8}\//g, '/c/__v/HASH/'),
      diagnostics: result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236'),
      serverSource: serverSource.replace(/\/c\/__v\/[0-9a-f]{8}\//g, '/c/__v/HASH/'),
    }).toMatchInlineSnapshot(`
      {
        "clientSource": "// @kovojs-ir
      import { derive, kovoStyleProperty } from '@kovojs/browser/generated';

      export const SliderDemo$span_style_derive = derive(["state"], (state) => [kovoStyleProperty("width", \`\${state.value}%\`)].filter(Boolean).join('; '));
      export const SliderDemo$span_style_derive_2 = derive(["state"], (state) => [kovoStyleProperty("left", \`\${state.value}%\`), kovoStyleProperty("top", '50%'), kovoStyleProperty("transform", 'translate(-50%, -50%)')].filter(Boolean).join('; '));
      ",
        "diagnostics": [],
        "serverSource": "// @kovojs-ir
      export function renderSource() {
        return \`import { derive, kovoStyleProperty } from '@kovojs/browser/generated';

      export const SliderDemo$span_style_derive = derive(["state"], (state: any) => [kovoStyleProperty("width", \\\`\\\${state.value}%\\\`)].filter(Boolean).join('; '));
      export const SliderDemo$span_style_derive_2 = derive(["state"], (state: any) => [kovoStyleProperty("left", \\\`\\\${state.value}%\\\`), kovoStyleProperty("top", '50%'), kovoStyleProperty("transform", 'translate(-50%, -50%)')].filter(Boolean).join('; '));


      export const SliderDemo = component({
        state: () => ({ value: 50 }),
        render: (_queries, state) => (
          <slider-demo kovo-state="{&quot;value&quot;:50}">
            <span style={{ width: \\\`\\\${state.value}%\\\` }} data-bind:style="/c/__v/HASH/slider-demo.client.js#SliderDemo$span_style_derive" />
            <span style={{ left: \\\`\\\${state.value}%\\\`, top: '50%', transform: 'translate(-50%, -50%)' }} data-bind:style="/c/__v/HASH/slider-demo.client.js#SliderDemo$span_style_derive_2" />
          </slider-demo>
        ),
      });
      SliderDemo.name = "slider-demo/slider-demo";
      \`;
      }
      ",
      }
    `);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('escapes list template stamps in the client HTML-fragment path', () => {
    const result = compileComponentModule({
      fileName: 'cart-list.tsx',
      source: `
export const CartList = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="sku">
      <template kovo-stamp>
        <li title="Item"><span data-bind=".name">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(serverSource).toContain('<span data-bind=".name">Item</span>');
    expect(clientSource).toContain('kovoEscapeHtml');
    expect(clientSource).toContain('return [');
    expect(result.queryUpdatePlans[0]?.templateStamps).toHaveLength(1);
  });

  it('escapes fragment-target text and rejects raw HTML strings unless wrapped', () => {
    const unsafe = compileComponentModule({
      fileName: 'promo.tsx',
      source: `
export const Promo = component({
  render: ({ promo }) => (
    <section>
      <h2>{promo.title}</h2>
      <div dangerouslySetInnerHTML={"<img src=x onerror=alert(1)>"} />
    </section>
  ),
});
`,
    });
    const safe = compileComponentModule({
      fileName: 'trusted-promo.tsx',
      source: `
import { trustedHtml } from '@kovojs/browser';

export const TrustedPromo = component({
  render: ({ promo }) => <div dangerouslySetInnerHTML={trustedHtml("<b>safe</b>")} />,
});
`,
    });

    expect(unsafe.files.find((file) => file.kind === 'server')?.source).toContain(
      '{escapeText(promo.title)}</h2>',
    );
    expect(unsafe.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} dangerouslySetInnerHTML receives a plain string; use Kovo TrustedHtml`,
        }),
      ]),
    );
    expect(safe.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
  });
});
