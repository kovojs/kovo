import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertFixpoint, assertRenderEquivalence, compileComponentModule } from '@kovojs/compiler';
import { generatedComponentCommittedIrFacts } from '@kovojs/conformance-fixtures/generated-module-fixtures';
import { htmlDocumentFacts, htmlElementFacts } from '@kovojs/test/html-fragment';

import {
  commerceMessageCatalog,
  commercePageHints,
  createCommerceDb,
  loadCartQuery,
  renderCommercePageHints,
  renderCartPage,
} from './app.js';
import { seedCartItems } from './app-test-helpers.js';

const commerceRoot = fileURLToPath(new URL('..', import.meta.url));

describe('commerce example', () => {
  it('renders StyleX-first stylesheet hints and static utility classes', async () => {
    const cartPage = await renderCartPage();
    const pageHints = htmlDocumentFacts(commercePageHints.html);
    const cartDocument = htmlDocumentFacts(cartPage);

    expect(commerceMessageCatalog).toEqual({
      cartLabel: 'Cart',
      productStock: '{count} in stock',
    });
    expect(commercePageHints.earlyHints).toEqual({
      Link: '</assets/styles.css>; rel=preload; as=style',
    });
    expect(pageHints.title).toBe('Kovo Commerce (0)');
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
      { attrs: { href: '/assets/styles.css', rel: 'stylesheet' }, tag: 'link' },
    ]);
    expect(cartDocument.bodyAttrs.class).toBe('min-h-dvh bg-slate-50 p-6');
    expect(
      htmlElementFacts(cartPage, {
        attrs: {
          class:
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-xs font-semibold tabular-nums text-white',
        },
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
      'Kovo Commerce (5)',
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

  it('builds the linked app stylesheet for commerce utility classes', () => {
    rmSync(path.join(commerceRoot, 'dist'), { force: true, recursive: true });

    execFileSync('corepack', ['pnpm', '--filter', '@kovojs/example-commerce', 'run', 'build'], {
      cwd: path.join(commerceRoot, '..', '..'),
      stdio: 'pipe',
    });

    const css = readFileSync(path.join(commerceRoot, 'dist', 'assets', 'styles.css'), 'utf8');

    expect(css).toContain('.bg-slate-50');
    expect(css).toContain('.rounded');
    expect(css).toContain('.text-red-700');
    expect(css).toContain('.bg-teal-600');
    expect(css).toContain('.border-slate-200');
  });

  it('compiles TSX-authored components to committed IR through the fixpoint gate', () => {
    // SPEC.md sections 4.8 and 5.2: authored sugar carries no lowered stamps,
    // while committed generated IR must match the compiler output for the
    // source component and pass the compiler fixpoint gate.
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
