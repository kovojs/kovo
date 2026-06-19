import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mainAsync } from './index.js';

describe('kovo compile', () => {
  it('writes and checks component artifacts without app-authored compiler imports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-component-'));
    const sourcePath = join(root, 'cart-badge.tsx');
    const outPath = join(root, 'generated/cart-badge.tsx');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(
        sourcePath,
        `
import { component } from '@kovojs/core';

export const CartBadge = component({
  render: () => <span>Cart</span>,
});
`,
        'utf8',
      );

      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/components/cart-badge.tsx',
          '--fixpoint',
          '--render-equivalence',
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(outPath, 'utf8')).toContain('export const CartBadge = component({');
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('kovo-compile/v1\n');
      expect(output).toContain(`WRITE component path=${JSON.stringify(outPath)}`);

      stdout.mockClear();
      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/components/cart-badge.tsx',
          '--check',
        ]),
      ).resolves.toBe(0);
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `CHECK component path=${JSON.stringify(outPath)} status=current`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes component client files and graph facts through the CLI facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-component-facts-'));
    const sourcePath = join(root, 'counter.tsx');
    const outPath = join(root, 'generated/counter.tsx');
    const factsPath = join(root, 'generated/counter.facts.json');
    const clientPath = join(root, 'generated/counter.client.js');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        sourcePath,
        `
import { component } from '@kovojs/core';
import { removeItem } from './actions';

export const CartActions = component({
  render: () => <button onClick={removeItem}>Remove</button>,
});
`,
        'utf8',
      );

      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          join(root, 'generated/counter.tsx'),
          '--facts-out',
          factsPath,
          '--emit-client-files',
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(clientPath, 'utf8')).toContain('CartActions$removeItem');
      expect(JSON.parse(readFileSync(factsPath, 'utf8'))).toMatchObject({
        componentGraphFacts: [{ exportName: 'CartActions' }],
      });
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `WRITE client path=${JSON.stringify(clientPath)}`,
      );

      stdout.mockClear();
      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          join(root, 'generated/counter.tsx'),
          '--facts-out',
          factsPath,
          '--emit-client-files',
          '--check',
        ]),
      ).resolves.toBe(0);
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain(`CHECK component path=${JSON.stringify(outPath)} status=current`);
      expect(output).toContain(`CHECK client path=${JSON.stringify(clientPath)} status=current`);
      expect(output).toContain('SUMMARY artifacts=3 diagnostics=0');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows selected component diagnostics as warnings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-component-warn-'));
    const sourcePath = join(root, 'static-id.tsx');
    const outPath = join(root, 'generated/static-id.tsx');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        sourcePath,
        `
import { component } from '@kovojs/core';
import { removeItem } from './actions';

export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <button onClick={() => removeItem(state, item.id)}>
      <span data-bind="cart.count">2</span>
    </button>
  ),
});
`,
        'utf8',
      );

      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/components/static-id.tsx',
        ]),
      ).resolves.toBe(1);
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain('ERROR KV210');

      stderr.mockClear();
      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/components/static-id.tsx',
          '--allow-diagnostic',
          'KV210',
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('WARN KV210 file="src/components/static-id.tsx"');
      expect(output).toContain('SUMMARY artifacts=1 diagnostics=1');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes query-shape facts through the component compile facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-component-query-shapes-'));
    const sourcePath = join(root, 'product-card.tsx');
    const outPath = join(root, 'generated/product-card.tsx');
    const queryShapeFactsPath = join(root, 'query-shape-facts.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        sourcePath,
        `
import { component } from '@kovojs/core';

export const ProductCard = component({
  render: () => <span data-bind="product.details.name">Coffee</span>,
});
`,
        'utf8',
      );
      writeFileSync(
        queryShapeFactsPath,
        `${JSON.stringify(
          [
            {
              query: 'product',
              shape: { details: { kind: 'nullable', shape: { name: 'string' } } },
              source: 'generated/queries/product.shape.ts',
            },
          ],
          null,
          2,
        )}\n`,
      );

      await expect(
        mainAsync([
          'compile',
          'component',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/product-card.tsx',
          '--query-shape-facts',
          queryShapeFactsPath,
          '--allow-diagnostic',
          'KV227',
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('WARN KV227 file="src/product-card.tsx"');
      expect(output).toContain('SUMMARY artifacts=1 diagnostics=1');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes route page facts through the CLI facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-route-facts-'));
    const sourcePath = join(root, 'app-shell.tsx');
    const outPath = join(root, 'generated/app-shell.kovo-route.tsx');
    const factsPath = join(root, 'generated/app-shell.facts.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        sourcePath,
        `
import { route } from '@kovojs/server';
import { CartBadge } from './cart-badge.js';

route('/', {
  page: () => <CartBadge productId="p1" />,
});
`,
        'utf8',
      );

      await expect(
        mainAsync([
          'compile',
          'route',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/app-shell.tsx',
          '--artifact-file-name',
          'src/generated/app-shell.kovo-route.tsx',
          '--rewrite',
          'CartBadge=./cart-badge.js',
          '--facts-out',
          factsPath,
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(factsPath, 'utf8'))).toMatchObject({
        routePageFacts: [
          {
            components: [{ localName: 'CartBadge' }],
            route: '/',
          },
        ],
      });
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        'SUMMARY artifacts=2 diagnostics=0',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits a graph artifact through the CLI facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-graph-'));
    const inputPath = join(root, 'graph-input.json');
    const outPath = join(root, 'graph.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        inputPath,
        JSON.stringify({
          graph: {
            components: [{ component: 'CartBadge', queries: [], target: 'CartBadge' }],
          },
        }),
        'utf8',
      );

      await expect(mainAsync(['compile', 'graph', inputPath, '--out', outPath])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(outPath, 'utf8'))).toEqual({
        components: [{ component: 'CartBadge', queries: [], target: 'CartBadge' }],
      });
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `WRITE graph path=${JSON.stringify(outPath)}`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('extracts mutation input facts through the CLI facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-mutation-inputs-'));
    const sourcePath = join(root, 'app.ts');
    const outPath = join(root, 'mutation-inputs.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        sourcePath,
        `
import { mutation, s } from '@kovojs/server';

export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
    quantity: s.number().default(1),
  }),
  handler: async () => null,
});
`,
        'utf8',
      );

      await expect(
        mainAsync([
          'compile',
          'mutation-inputs',
          sourcePath,
          '--out',
          outPath,
          '--file-name',
          'src/app.ts',
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(outPath, 'utf8'))).toMatchObject({
        'cart/add': [
          { coercion: 'string', name: 'productId', provenance: 'registry', required: true },
          { coercion: 'number', defaulted: true, name: 'quantity', provenance: 'registry' },
        ],
      });
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `WRITE mutation-inputs path=${JSON.stringify(outPath)}`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes Drizzle static facts through the CLI facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-drizzle-static-'));
    const inputPath = join(root, 'static.json');
    const outPath = join(root, 'static-facts.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const touchGraph = {
      'cart.addItem': {
        reads: [],
        touches: [{ domain: 'cart', keys: null, site: 'src/app.ts:10', via: 'cart_items' }],
        unresolved: [],
      },
    };

    try {
      writeFileSync(
        inputPath,
        JSON.stringify(
          {
            invalidation: {
              constName: 'cartInvalidationSets',
              mutations: [{ mutation: 'cart/add', touchGraphKey: 'cart.addItem' }],
              queries: [{ domains: ['cart'], query: 'cart' }],
              touchGraph,
              typeName: 'CartInvalidationSets',
            },
            serializeTouchGraph: {
              exportName: 'cartTouchGraph',
              touchGraph,
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      await expect(
        mainAsync(['compile', 'drizzle-static', inputPath, '--out', outPath]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const facts = JSON.parse(readFileSync(outPath, 'utf8'));
      expect(facts.version).toBe('drizzle-static/v1');
      expect(facts.invalidationRegistrySource).toContain('export interface CartInvalidationSets');
      expect(facts.invalidationRegistrySource).toContain('cartInvalidationSets');
      expect(facts.mutationTouchRegistry).toEqual({
        'cart/add': [{ domain: 'cart', keys: null }],
      });
      expect(facts.mutationTouchRegistrySource).toContain('export const mutationInferredTouches');
      expect(facts.touchGraphSource).toContain('export const cartTouchGraph =');
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `WRITE drizzle-static path=${JSON.stringify(outPath)}`,
      );

      stdout.mockClear();
      await expect(
        mainAsync(['compile', 'drizzle-static', inputPath, '--out', outPath, '--check']),
      ).resolves.toBe(0);
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `CHECK drizzle-static path=${JSON.stringify(outPath)} status=current`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes materialized-view refresh facts through the Drizzle static CLI facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-drizzle-static-matview-'));
    const inputPath = join(root, 'static.json');
    const outPath = join(root, 'static-facts.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        inputPath,
        JSON.stringify(
          {
            extract: ['materializedViewRefreshFacts'],
            files: [
              {
                fileName: 'catalog.domain.ts',
                source: [
                  'import { pgMaterializedView, text, type PgDatabase } from "drizzle-orm/pg-core";',
                  'import { kovo } from "@kovojs/drizzle";',
                  '',
                  'export const productSearch = pgMaterializedView(',
                  '  "product_search",',
                  '  { productId: text("product_id") },',
                  '  kovo({ view: { of: "product", refresh: "async" } }),',
                  ');',
                  '',
                  'export async function refreshCatalog(db: PgDatabase<any, any, any>) {',
                  '  await db.refreshMaterializedView(productSearch);',
                  '}',
                ].join('\n'),
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      await expect(
        mainAsync(['compile', 'drizzle-static', inputPath, '--out', outPath]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(outPath, 'utf8')).materializedViewRefreshFacts).toEqual([
        {
          domain: 'product',
          mutation: 'refreshCatalog',
          optimisticStatus: 'await-fragment',
          refresh: 'async',
          site: 'catalog.domain.ts:11',
          view: 'product_search',
        },
      ]);
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `WRITE drizzle-static path=${JSON.stringify(outPath)}`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes Drizzle optimistic codegen through the CLI facade', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-drizzle-optimistic-'));
    const inputPath = join(root, 'optimistic.json');
    const outPath = join(root, 'cart-add.ts');
    const factsPath = join(root, 'optimistic-facts.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        inputPath,
        JSON.stringify(
          {
            complete: true,
            constName: 'cartAddDerivedOptimistic',
            effects: [
              {
                op: 'insert',
                table: 'cart_items',
                values: { qty: { kind: 'param', path: 'quantity' } },
              },
            ],
            entries: [
              {
                query: 'cart',
                shape: {
                  fields: {
                    count: {
                      arith: { column: 'qty', kind: 'col' },
                      kind: 'sum',
                      rowset: { filters: [], key: null, orderBy: [], table: 'cart_items' },
                    },
                  },
                  query: 'cart',
                },
              },
            ],
            formImport: { name: 'addToCartForm', path: '../../app.js' },
            queue: 'cart',
          },
          null,
          2,
        ),
        'utf8',
      );

      await expect(
        mainAsync([
          'compile',
          'drizzle-optimistic',
          inputPath,
          '--out',
          outPath,
          '--facts-out',
          factsPath,
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(outPath, 'utf8')).toContain('export const cartAddDerivedOptimistic = {');
      expect(JSON.parse(readFileSync(factsPath, 'utf8'))).toEqual([
        { derivation: { status: 'derived' }, query: 'cart', status: 'derived' },
      ]);
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `WRITE drizzle-optimistic path=${JSON.stringify(outPath)}`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('bridges materialized-view refresh facts into Drizzle optimistic await-fragment entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-compile-drizzle-optimistic-matview-'));
    const inputPath = join(root, 'optimistic.json');
    const outPath = join(root, 'refresh-catalog.ts');
    const factsPath = join(root, 'optimistic-facts.json');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        inputPath,
        JSON.stringify(
          {
            constName: 'refreshCatalogOptimistic',
            effects: [],
            entries: [{ query: 'productStats', shape: { query: 'productStats' } }],
            formImport: { name: 'refreshCatalogForm', path: '../../app.js' },
            materializedViewRefreshFacts: [
              {
                domain: 'product',
                mutation: 'refreshCatalog',
                optimisticStatus: 'await-fragment',
              },
            ],
            mutation: 'refreshCatalog',
            queryDomains: [{ domains: ['product'], query: 'productStats' }],
          },
          null,
          2,
        ),
        'utf8',
      );

      await expect(
        mainAsync([
          'compile',
          'drizzle-optimistic',
          inputPath,
          '--out',
          outPath,
          '--facts-out',
          factsPath,
        ]),
      ).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(readFileSync(outPath, 'utf8')).toContain(`productStats: 'await-fragment'`);
      expect(JSON.parse(readFileSync(factsPath, 'utf8'))).toEqual([
        { query: 'productStats', status: 'await-fragment' },
      ]);
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `WRITE drizzle-optimistic path=${JSON.stringify(outPath)}`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
