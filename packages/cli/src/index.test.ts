import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fwCheck, fwExplain, main } from './index.js';

describe('fw check', () => {
  it('emits stable OK output for an empty semantic graph', () => {
    expect(fwCheck({})).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('reports FW310 optimistic coverage gaps without failing the command', () => {
    expect(
      fwCheck({
        optimistic: [
          { mutation: 'cart/add', query: 'cartQuery.items', status: 'UNHANDLED' },
          { mutation: 'cart/add', query: 'cartQuery.count', status: 'hand-written' },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN FW310 cart/add -> cartQuery.items Invalidated query lacks optimistic transform.\n',
    });
  });

  it('derives FW310 gaps from mutation invalidations and query read sets', () => {
    expect(
      fwCheck({
        mutations: [
          {
            guards: ['authed'],
            invalidates: ['cart'],
            key: 'cart/add',
          },
        ],
        optimistic: [{ mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' }],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
        ],
        touchGraph: {
          'cart.addItem': {
            touches: [
              { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
            ],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    });
  });

  it('accepts explicit optimistic statuses for every invalidated query', () => {
    expect(
      fwCheck({
        mutations: [{ guards: ['authed'], invalidates: ['cart', 'product'], key: 'cart/add' }],
        optimistic: [
          { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
          { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
        ],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
        ],
        touchGraph: {
          'cart.addItem': {
            touches: [
              { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
            ],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('derives FW310 gaps from mutation writes when invalidates are absent', () => {
    expect(
      fwCheck({
        mutations: [{ guards: ['authed'], key: 'cart/add', writes: ['cart'] }],
        queries: [{ domains: ['cart'], query: 'cart' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
      }).output,
    ).toBe(
      'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    );
  });

  it('reports semantic lints for local state, events, and direct db access', () => {
    expect(
      fwCheck({
        lints: [
          {
            code: 'FW301',
            detail: 'state.cartCount mirrors query cart.count.',
            site: 'CartBadge.client.ts:8',
          },
          {
            code: 'FW320',
            detail: 'event cart:added carries product.unitPrice.',
            site: 'cart.events.ts:3',
          },
          {
            code: 'FW330',
            detail: 'handler addToCart receives db.',
            site: 'cart.mutation.ts:12',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-check/v1',
        'LINT FW301 CartBadge.client.ts:8 Server fact stored in island-local state. state.cartCount mirrors query cart.count.',
        'LINT FW320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice.',
        'LINT FW330 cart.mutation.ts:12 Direct db access in a mutation handler; route through domain. handler addToCart receives db.',
        '',
      ].join('\n'),
    });
  });

  it('prints FW302 data-bind path lints using the SPEC §11.3 diagnostic registry message', () => {
    expect(
      fwCheck({
        lints: [
          {
            code: 'FW302',
            detail: 'cart.total',
            site: 'CartBadge.tsx:12',
          },
        ],
      }).output,
    ).toMatchInlineSnapshot(`
      "fw-check/v1
      LINT FW302 CartBadge.tsx:12 data-bind path is not present in the declared query shape. cart.total
      "
    `);
  });

  it('reports FW320 when event payload facts overlap query data facts', () => {
    expect(
      fwCheck({
        eventPayloads: [
          {
            event: 'cart:added',
            fields: ['productId', 'product.unitPrice', 'quantity'],
            site: 'cart.events.ts:3',
          },
        ],
        queryData: [
          {
            fields: ['id', 'product.unitPrice', 'title'],
            query: 'productCard',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nLINT FW320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice from query productCard.\n',
    });
  });

  it('keeps graph-derived FW320 output stable across duplicate query fields', () => {
    expect(
      fwCheck({
        eventPayloads: [
          {
            event: 'cart:added',
            fields: ['product.unitPrice'],
            site: 'cart.events.ts:3',
          },
        ],
        queryData: [
          { fields: ['product.unitPrice'], query: 'recommendations' },
          { fields: ['product.unitPrice'], query: 'cart' },
          { fields: ['product.unitPrice'], query: 'cart' },
        ],
      }).output,
    ).toBe(
      'fw-check/v1\nLINT FW320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice from query cart,recommendations.\n',
    );
  });

  it('accepts event payload facts that do not overlap query data facts', () => {
    expect(
      fwCheck({
        eventPayloads: [
          {
            event: 'cart:added',
            fields: ['productId', 'quantity'],
            site: 'cart.events.ts:3',
          },
        ],
        queryData: [{ fields: ['product.unitPrice', 'title'], query: 'productCard' }],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('reports unresolved touch graph sites as FW406', () => {
    expect(
      fwCheck({
        touchGraph: {
          'cart.addItem': {
            touches: [],
            unresolved: [
              {
                code: 'FW406',
                message: 'Statically un-analyzable write site; manual touches required.',
                site: 'cart.domain.ts:20',
              },
            ],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN FW406 cart.domain.ts:20 Statically un-analyzable write site; manual touches required.\n',
    });
  });

  it('reports non-equality touch graph predicates as FW409 notices', () => {
    expect(
      fwCheck({
        touchGraph: {
          'cart.reserveStock': {
            touches: [
              {
                domain: 'product',
                keys: null,
                predicate: 'non-eq',
                site: 'product.domain.ts:20',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nNOTICE FW409 product.domain.ts:20 Non-eq predicate degraded to table-level invalidation.\n',
    });
  });

  it('fails when a query reads a domain no mutation can invalidate', () => {
    expect(
      fwCheck({
        queries: [{ domains: ['cart', 'product'], query: 'productPage' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nERROR FW407 productPage reads product but no mutation touch graph writes that domain.\n',
    });
  });

  it('accepts query read domains covered by the touch graph', () => {
    expect(
      fwCheck({
        queries: [{ domains: ['cart'], query: 'cart' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('audits mutations reachable without an auth guard', () => {
    expect(
      fwCheck({
        mutations: [
          { guards: ['rateLimit:session'], key: 'cart/add' },
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nWARN UNGUARDED cart/add mutation is reachable without an auth guard.\n',
    });
  });

  it('audits manual invalidate escape-hatch usage', () => {
    expect(
      fwCheck({
        mutations: [{ key: 'inventory/sync', manualInvalidates: ['product'] }],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN UNGUARDED inventory/sync mutation is reachable without an auth guard.\nWARN INVALIDATE inventory/sync -> product Manual invalidate escape hatch requires review.\n',
    });
  });
});

describe('fw explain', () => {
  it('explains component handlers, query consumers, and fragment targets', () => {
    expect(
      fwExplain(
        {
          components: [
            {
              fragments: ['cart-badge'],
              handlers: [
                {
                  event: 'click',
                  exportName: 'CartBadge$button_click',
                  params: ['itemId'],
                  ref: '/c/cart-badge.client.js#CartBadge$button_click',
                },
              ],
              name: 'CartBadge',
              queries: ['cart'],
            },
          ],
        },
        { kind: 'component', target: 'CartBadge' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'COMPONENT CartBadge',
        'queries: cart',
        'fragments: cart-badge',
        'HANDLER click export=CartBadge$button_click ref=/c/cart-badge.client.js#CartBadge$button_click params=itemId substitution=-',
        '',
      ].join('\n'),
    });
  });

  it('explains mutation guards, writes, invalidations, and optimistic coverage', () => {
    expect(
      fwExplain(
        {
          mutations: [
            {
              guards: ['authed'],
              invalidates: ['cart'],
              key: 'cart/add',
              manualInvalidates: ['product'],
              writes: ['cart', 'product'],
            },
          ],
          optimistic: [
            { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
            { mutation: 'cart/add', query: 'recommendations', status: 'await-fragment' },
            { mutation: 'cart/add', query: 'cart.discount', status: 'UNHANDLED' },
          ],
        },
        { kind: 'mutation', optimistic: true, target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: cart,product',
        'invalidates: cart',
        'manual-invalidates: product',
        'OPTIMISTIC cart hand-written',
        'OPTIMISTIC recommendations await-fragment',
        'OPTIMISTIC cart.discount UNHANDLED',
        'OPTIMISTIC-SUMMARY total=3 hand-written=1 await-fragment=1 UNHANDLED=1',
        '',
      ].join('\n'),
    });
  });

  it('audits unguarded mutations with stable explain output', () => {
    const result = fwExplain(
      {
        mutations: [
          {
            guards: ['rateLimit:session'],
            invalidates: ['cart'],
            key: 'cart/add',
            writes: ['cart'],
          },
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
          { key: 'inventory/sync', manualInvalidates: ['product'], writes: ['product'] },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNGUARDED
      MUTATION cart/add guards=rateLimit:session writes=cart invalidates=cart manual-invalidates=-
      MUTATION inventory/sync guards=- writes=product invalidates=- manual-invalidates=product
      SUMMARY total=2
      "
    `);
  });

  it('accepts fw explain --unguarded as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        }),
      );

      expect(main(['explain', '--unguarded', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNGUARDED
      MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-
      SUMMARY total=1
      "
    `);
  });

  it('explains query read sets and the writes that invalidate them', () => {
    expect(
      fwExplain(
        {
          components: [
            { name: 'Recommendations', queries: ['recommendations'] },
            { name: 'CartBadge', queries: ['cart'] },
          ],
          pages: [
            { queries: ['cart'], route: '/cart' },
            { queries: ['cart'], route: '/checkout' },
          ],
          queries: [{ domains: ['cart'], query: 'cart' }],
          touchGraph: {
            'cart.addItem': {
              touches: [
                {
                  domain: 'cart',
                  keys: null,
                  site: 'cart.domain.ts:1',
                  via: 'cart_items',
                },
              ],
              unresolved: [],
            },
          },
        },
        { kind: 'query', target: 'cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,page:/cart,page:/checkout\ninvalidated-by: cart.addItem\n',
    });
  });

  it('explains page prefetch, modulepreload, and query payloads', () => {
    expect(
      fwExplain(
        {
          pages: [
            {
              modulepreloads: ['/c/cart-badge.client.js'],
              prefetch: 'conservative',
              queries: ['cart'],
              route: '/cart',
            },
          ],
        },
        { kind: 'page', target: '/cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nPAGE /cart\nprefetch: conservative\nmodulepreloads: /c/cart-badge.client.js\nqueries: cart\n',
    });
  });

  it('returns a stable not-found diagnostic for missing explain targets', () => {
    expect(fwExplain({}, { kind: 'component', target: 'Missing' })).toEqual({
      exitCode: 1,
      output: 'fw-explain/v1\nERROR NOT_FOUND component Missing\n',
    });
  });
});
