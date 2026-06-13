import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  touchGraphProvenanceHonestyFact,
  touchGraphProvenanceFact,
  touchGraphSourceFacts,
  touchGraphSourceSiteSummaryFact,
  touchGraphSummaryFacts,
} from './touch-graph-fixtures.js';

describe('@jiso/test touch graph fixture seam', () => {
  it('summarizes touch-graph source provenance against resolved source lines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jiso-test-touch-graph-'));
    const touchGraph = {
      'cart.addItem': {
        touches: [
          { domain: 'cart', keys: null, site: 'src/cart.ts:2', via: 'cart_items' },
          {
            domain: 'product',
            keys: 'arg:productId',
            predicate: 'eq',
            site: 'src/cart.ts:3',
            via: 'products',
          },
        ],
        unresolved: [],
      },
    };

    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(
        join(root, 'src/cart.ts'),
        [
          'export function addToCart() {',
          '  db.write("cart_items", item);',
          '  db.write("products", productId);',
          '}',
        ].join('\n'),
      );

      await expect(touchGraphSourceFacts(root, touchGraph)).resolves.toEqual([
        {
          domain: 'cart',
          keys: null,
          line: 2,
          mutation: 'cart.addItem',
          path: 'src/cart.ts',
          predicate: undefined,
          sourceLine: 'db.write("cart_items", item);',
          via: 'cart_items',
        },
        {
          domain: 'product',
          keys: 'arg:productId',
          line: 3,
          mutation: 'cart.addItem',
          path: 'src/cart.ts',
          predicate: 'eq',
          sourceLine: 'db.write("products", productId);',
          via: 'products',
        },
      ]);
      await expect(touchGraphSummaryFacts(root, touchGraph)).resolves.toEqual({
        'cart.addItem': {
          reads: [],
          touches: [
            {
              domain: 'cart',
              keys: null,
              predicate: undefined,
              sitePath: 'src/cart.ts',
              sourceLineIncludesVia: true,
              via: 'cart_items',
            },
            {
              domain: 'product',
              keys: 'arg:productId',
              predicate: 'eq',
              sitePath: 'src/cart.ts',
              sourceLineIncludesVia: true,
              via: 'products',
            },
          ],
          unresolved: [],
        },
      });
      expect(touchGraphSourceSiteSummaryFact(touchGraph)).toEqual({
        count: 2,
        linesArePositive: true,
        paths: ['src/cart.ts'],
      });
      const provenance = await touchGraphProvenanceFact(root, touchGraph);

      expect(provenance).toEqual({
        entries: {
          'cart.addItem': {
            reads: [],
            touches: [
              {
                domain: 'cart',
                keys: null,
                predicate: undefined,
                sitePath: 'src/cart.ts',
                via: 'cart_items',
              },
              {
                domain: 'product',
                keys: 'arg:productId',
                predicate: 'eq',
                sitePath: 'src/cart.ts',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
        siteSummary: {
          count: 2,
          linesArePositive: true,
          paths: ['src/cart.ts'],
        },
        sourceLineMismatches: [],
        unresolvedMutations: [],
      });
      expect(touchGraphProvenanceHonestyFact(provenance)).toEqual({
        entryKeys: ['cart.addItem'],
        sourceLineMismatches: [],
        sourceSites: {
          count: 2,
          linesArePositive: true,
          paths: ['src/cart.ts'],
        },
        touchCountsByMutation: {
          'cart.addItem': 2,
        },
        unresolvedMutations: [],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects touch graph facts that do not name a source site', async () => {
    await expect(
      touchGraphSourceFacts('/tmp/unused', {
        'cart.addItem': {
          touches: [{ domain: 'cart', via: 'cart_items' }],
        },
      }),
    ).rejects.toThrow('Touch graph fact includes a source site: cart.addItem cart');
  });
});
