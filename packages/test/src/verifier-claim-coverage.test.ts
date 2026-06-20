import { describe, expect, it } from 'vitest';

import { mutation, s } from '@kovojs/server';

import {
  createFakeDb,
  createVerifiedFakeHarness,
  expectedDiagnostic,
  expectedDiagnosticMessage,
  type FakeDb,
} from './test-fixtures.js';
import { createKovoTestHarness } from './harness.js';
import { createDbVerifier } from './verifier.js';

// SPEC.md §11.2 requires the runtime verifier to cross-check the touch graph in
// *both* directions: observed ⊆ declared (KV402/KV404) *and* declared claims
// that were never observed (KV403 stale claim, KV405 un-taken conditional
// branch) plus row-key disagreements (KV408 declared row key ≠ observed
// predicate). These tests regression-lock the reverse-direction emission both
// at the unit (`createDbVerifier`) seam and through the harness integration
// seam (`exec`/`query`/`page`), which is the gap tracked by plan item C7c.
describe('@kovojs/test verifier declared-claim coverage (KV403/KV405/KV408)', () => {
  describe('KV403 — declared write domain never observed', () => {
    it('emits KV403 for a declared touch the run never wrote', () => {
      const verifier = createDbVerifier(
        {
          'cart.addItem': {
            touches: [
              { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
            ],
            unresolved: [],
          },
        },
        { domainByTable: { cart_items: 'cart', products: 'product' } },
      );
      const db = verifier.wrap(createFakeDb());

      // Only the cart write executes; the declared `product` touch is stale.
      db.write('cart_items', 'p1');

      expect(verifier.diagnostics()).toEqual([
        {
          code: 'KV403',
          domain: 'product',
          message: expectedDiagnosticMessage('KV403'),
          severity: 'warn',
        },
      ]);
    });

    it('surfaces KV403 through the harness verificationDiagnostics() integration seam', async () => {
      const cartMutation = mutation('cart/add', {
        csrf: false,
        input: s.object({ productId: s.string() }),
        handler(input, request: { db: FakeDb }) {
          request.db.write('cart_items', input.productId);
          return input.productId;
        },
      });
      const harness = createVerifiedFakeHarness({
        touchGraph: {
          'cart.addItem': {
            touches: [
              { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
            ],
            unresolved: [],
          },
        },
        verification: { domainByTable: { cart_items: 'cart', products: 'product' } },
      });

      await harness.exec(cartMutation, { productId: 'p1' });

      expect(harness.verificationDiagnostics()).toEqual([
        {
          code: 'KV403',
          domain: 'product',
          message: expectedDiagnosticMessage('KV403'),
          severity: 'warn',
        },
      ]);
    });
  });

  describe('KV405 — conditional write branch never executed', () => {
    it('emits KV405 (plus KV403) when a declared conditional branch is never taken', () => {
      const verifier = createDbVerifier(
        {
          'cart.addItem': {
            touches: [
              {
                branch: 'stock-reserve',
                domain: 'product',
                keys: 'arg:productId',
                site: 'cart.domain.ts:12',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        { domainByTable: { products: 'product' } },
      );
      const db = verifier.wrap(createFakeDb());

      // The conditional branch's write never runs under instrumentation.
      void db;

      expect(verifier.diagnostics()).toEqual([
        {
          branch: 'stock-reserve',
          code: 'KV405',
          domain: 'product',
          message: expectedDiagnosticMessage('KV405'),
          severity: 'warn',
          site: 'cart.domain.ts:12',
        },
        {
          code: 'KV403',
          domain: 'product',
          message: expectedDiagnosticMessage('KV403'),
          severity: 'warn',
        },
      ]);
    });

    it('surfaces KV405 through the harness when the handler skips the conditional arm', async () => {
      // The handler only writes the unconditional `cart` line; the declared
      // `stock-reserve` branch on `products` is never observed → KV405 + KV403.
      const cartMutation = mutation('cart/add', {
        csrf: false,
        input: s.object({ productId: s.string(), reserve: s.boolean() }),
        handler(input, request: { db: FakeDb }) {
          request.db.write('cart_items', input.productId, { branch: 'cart-line' });
          if (input.reserve) {
            request.db.write('products', input.productId, { branch: 'stock-reserve' });
          }
          return input.productId;
        },
      });
      const harness = createVerifiedFakeHarness({
        touchGraph: {
          'cart.addItem': {
            touches: [
              {
                branch: 'cart-line',
                domain: 'cart',
                keys: null,
                site: 'cart.domain.ts:1',
                via: 'cart_items',
              },
              {
                branch: 'stock-reserve',
                domain: 'product',
                keys: 'arg:productId',
                site: 'cart.domain.ts:12',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        verification: { domainByTable: { cart_items: 'cart', products: 'product' } },
      });

      await harness.exec(cartMutation, { productId: 'p1', reserve: false });

      expect(harness.verificationDiagnostics()).toEqual([
        {
          branch: 'stock-reserve',
          code: 'KV405',
          domain: 'product',
          message: expectedDiagnosticMessage('KV405'),
          severity: 'warn',
          site: 'cart.domain.ts:12',
        },
        {
          code: 'KV403',
          domain: 'product',
          message: expectedDiagnosticMessage('KV403'),
          severity: 'warn',
        },
      ]);
    });

    it('clears KV405 when the conditional arm runs under instrumentation', async () => {
      const cartMutation = mutation('cart/add', {
        csrf: false,
        input: s.object({ productId: s.string(), reserve: s.boolean() }),
        handler(input, request: { db: FakeDb }) {
          request.db.write('cart_items', input.productId, { branch: 'cart-line' });
          if (input.reserve) {
            request.db.write('products', input.productId, { branch: 'stock-reserve' });
          }
          return input.productId;
        },
      });
      const harness = createVerifiedFakeHarness({
        touchGraph: {
          'cart.addItem': {
            touches: [
              {
                branch: 'cart-line',
                domain: 'cart',
                keys: null,
                site: 'cart.domain.ts:1',
                via: 'cart_items',
              },
              {
                branch: 'stock-reserve',
                domain: 'product',
                keys: 'arg:productId',
                site: 'cart.domain.ts:12',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        verification: { domainByTable: { cart_items: 'cart', products: 'product' } },
      });

      await harness.exec(cartMutation, { productId: 'p1', reserve: true });

      expect(harness.verificationDiagnostics()).toEqual([]);
    });
  });

  describe('KV408 — declared row key differs from observed predicate', () => {
    it('throws KV408 when an observed write predicate disagrees with the declared key', () => {
      const verifier = createDbVerifier(
        {
          'cart.addItem': {
            touches: [
              {
                domain: 'product',
                keys: 'arg:productId',
                site: 'cart.domain.ts:12',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
      );
      const db = verifier.wrap(createFakeDb());

      // The write is keyed by `sku`, but the declared/configured row key is `id`.
      db.write('products', { sku: 'sku-1' }, { rowKey: 'sku' });

      expect(() => verifier.assertCovered()).toThrow(
        expectedDiagnostic('KV408', 'products expected id observed sku'),
      );
    });

    it('fires KV408 through the harness mutation exec seam', async () => {
      const reserveMutation = mutation('stock/reserve', {
        csrf: false,
        input: s.object({ productId: s.string() }),
        handler(input, request: { db: FakeDb }) {
          request.db.write('products', { sku: input.productId }, { rowKey: 'sku' });
          return input.productId;
        },
      });
      const harness = createVerifiedFakeHarness({
        touchGraph: {
          'stock.reserve': {
            touches: [
              {
                domain: 'product',
                keys: 'arg:productId',
                site: 'stock.domain.ts:3',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        verification: { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
      });

      await expect(harness.exec(reserveMutation, { productId: 'p1' })).rejects.toThrow(
        expectedDiagnostic('KV408', 'products expected id observed sku'),
      );
    });

    it('fires KV408 through the harness query read seam', async () => {
      const verifier = createDbVerifier(
        {},
        { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
      );
      const db = verifier.wrap(createFakeDb());

      // Read predicate keyed by `sku` disagrees with the configured `id` key.
      db.sql("select * from products where sku = 'sku-1'");

      expect(() => verifier.assertReadsCovered(['product'])).toThrow(
        expectedDiagnostic('KV408', 'products expected id observed sku'),
      );
    });
  });

  describe('page-render (route.page) read verification', () => {
    it('verifies page-render reads against the declared read set (covered)', async () => {
      const harness = createKovoTestHarness({
        db: createFakeDb(),
        pages: {
          '/cart': {
            reads: ['cart'],
            render({ db }) {
              const rows = db.read('cart_items');
              return `<main data-count="${rows.length}"></main>`;
            },
          },
        },
        touchGraph: {},
        verification: { domainByTable: { cart_items: 'cart' } },
      });

      const page = await harness.page('/cart');
      expect(page.html).toContain('data-count="0"');
    });

    it('fails page-render verification when the loader reads an undeclared domain (KV407)', async () => {
      const harness = createKovoTestHarness({
        db: createFakeDb(),
        pages: {
          '/cart': {
            reads: ['cart'],
            render({ db }) {
              db.read('cart_items');
              db.read('products');
              return '<main></main>';
            },
          },
        },
        touchGraph: {},
        verification: { domainByTable: { cart_items: 'cart', products: 'product' } },
      });

      await expect(harness.page('/cart')).rejects.toThrow(expectedDiagnostic('KV407', 'product'));
    });

    it('fails page-render verification on a row-key mismatch (KV408)', async () => {
      const harness = createKovoTestHarness({
        db: createFakeDb(),
        pages: {
          '/product': {
            reads: ['product'],
            render({ db }) {
              db.read('products', { rowKey: 'sku' });
              return '<main></main>';
            },
          },
        },
        touchGraph: {},
        verification: { domainByTable: { products: 'product' }, keyByTable: { products: 'id' } },
      });

      await expect(harness.page('/product')).rejects.toThrow(
        expectedDiagnostic('KV408', 'products expected id observed sku'),
      );
    });

    it('still serves string and thunk page fixtures unchanged', async () => {
      const harness = createKovoTestHarness({
        db: createFakeDb(),
        pages: {
          '/static': '<main id="static"></main>',
          '/thunk': () => '<main id="thunk"></main>',
        },
        touchGraph: {},
        verification: { domainByTable: { cart_items: 'cart' } },
      });

      expect((await harness.page('/static')).html).toContain('id="static"');
      expect((await harness.page('/thunk')).html).toContain('id="thunk"');
    });
  });
});
