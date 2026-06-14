import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from '@jiso/compiler';
import { generatedComponentCommittedIrFacts } from '@jiso/test/generated-module-fixtures';
import { htmlDocumentFacts, htmlElementFacts } from '@jiso/test/html-fragment';

import {
  commerceMessageCatalog,
  commercePageHints,
  createCommerceDb,
  loadCartQuery,
  renderCommercePageHints,
  renderCartPage,
} from './app.js';
import { seedCartItems } from './app-test-helpers.js';

describe('commerce example', () => {
  it('renders Tailwind-first stylesheet hints and static utility classes', async () => {
    const cartPage = await renderCartPage();
    const pageHints = htmlDocumentFacts(commercePageHints.html);
    const cartDocument = htmlDocumentFacts(cartPage);

    expect(commerceMessageCatalog).toEqual({
      cartLabel: 'Cart',
      productStock: '{count} in stock',
    });
    expect(commercePageHints.earlyHints).toEqual({
      Link: '</assets/tailwind.css>; rel=preload; as=style',
    });
    expect(pageHints.title).toBe('Jiso Commerce (0)');
    expect(pageHints.metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with 0 verifiable cart item.',
            name: 'description',
          }),
        }),
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with 0 verifiable cart item.',
            property: 'og:description',
          }),
        }),
      ]),
    );
    expect(pageHints.jsonScripts.map((script) => script.json)).toEqual([commerceMessageCatalog]);
    expect(pageHints.links).toMatchObject([
      { attrs: { href: '/assets/tailwind.css', rel: 'stylesheet' }, tag: 'link' },
    ]);
    expect(cartDocument.bodyAttrs.class).toBe('min-h-dvh bg-slate-50 p-6');
    expect(
      htmlElementFacts(cartPage, {
        attrs: { class: 'rounded bg-teal-600 px-2 py-0.5 text-white' },
        tag: 'span',
      }),
    ).toHaveLength(1);
  });

  it('resolves commerce route meta from loaded cart query data', async () => {
    const db = createCommerceDb();
    await seedCartItems(db, [
      { productId: 'p1', qty: 3, unitPrice: 1499 },
      { productId: 'p2', qty: 2, unitPrice: 2599 },
    ]);

    expect(await loadCartQuery(db)).toEqual({ count: 5 });
    expect(htmlDocumentFacts(renderCommercePageHints(await loadCartQuery(db)).html).title).toBe(
      'Jiso Commerce (5)',
    );
    expect(htmlDocumentFacts(await renderCartPage(db)).metas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attrs: expect.objectContaining({
            content: 'Browse products and checkout with 5 verifiable cart item.',
            name: 'description',
          }),
        }),
      ]),
    );
  });

  it('builds the linked Tailwind stylesheet for commerce utility classes', () => {
    rmSync('examples/commerce/dist', { force: true, recursive: true });

    execFileSync('corepack', ['pnpm', '--filter', '@jiso/example-commerce', 'run', 'build'], {
      stdio: 'pipe',
    });

    const css = readFileSync('examples/commerce/dist/assets/tailwind.css', 'utf8');

    expect(css).toContain('.bg-slate-50');
    expect(css).toContain('.rounded');
    expect(css).toContain('.text-red-700');
    expect(css).toContain('.bg-teal-600');
    expect(css).toContain('.border-slate-200');
  });

  it('compiles TSX-authored components to committed IR through the fixpoint gate', () => {
    // SPEC.md sections 4.8 and 5.2: authored sugar carries no lowered stamps,
    // while committed generated IR must match the compiler output for the
    // source component and pass the compiler fixpoint/render-equivalence gates.
    expect(
      generatedComponentCommittedIrFacts({
        assertFixpoint,
        assertRenderEquivalence,
        compileComponentModule,
        components: ['cart-badge', 'order-history', 'product-grid'],
        projectFilePrefix: 'examples/commerce/src',
        sourceRootUrl: new URL('./', import.meta.url),
      }),
    ).toEqual([
      {
        authoredLoweredStampAttributes: [],
        authoredPath: 'components/cart-badge.tsx',
        diagnostics: [],
        fixpointAsserted: true,
        generatedHasLoweredIrMarker: true,
        generatedMatchesCompilerOutput: true,
        generatedPath: 'generated/cart-badge.tsx',
        loweredRenderSourcePresent: true,
        name: 'cart-badge',
        provenance: {
          fileName: 'examples/commerce/src/components/cart-badge.tsx',
          spec: 'SPEC.md section 5.2',
        },
        renderEquivalenceAsserted: true,
      },
      {
        authoredLoweredStampAttributes: [],
        authoredPath: 'components/order-history.tsx',
        diagnostics: [],
        fixpointAsserted: true,
        generatedHasLoweredIrMarker: true,
        generatedMatchesCompilerOutput: true,
        generatedPath: 'generated/order-history.tsx',
        loweredRenderSourcePresent: true,
        name: 'order-history',
        provenance: {
          fileName: 'examples/commerce/src/components/order-history.tsx',
          spec: 'SPEC.md section 5.2',
        },
        renderEquivalenceAsserted: true,
      },
      {
        authoredLoweredStampAttributes: [],
        authoredPath: 'components/product-grid.tsx',
        diagnostics: [],
        fixpointAsserted: true,
        generatedHasLoweredIrMarker: true,
        generatedMatchesCompilerOutput: true,
        generatedPath: 'generated/product-grid.tsx',
        loweredRenderSourcePresent: true,
        name: 'product-grid',
        provenance: {
          fileName: 'examples/commerce/src/components/product-grid.tsx',
          spec: 'SPEC.md section 5.2',
        },
        renderEquivalenceAsserted: true,
      },
    ]);
  });
});
