import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { kovoCheck, main } from './index.js';

describe('kovo check', () => {
  it('publishes as @kovojs/cli while preserving the kovo bin command', () => {
    const packageJson = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
    ) as {
      bin?: Record<string, string>;
      name?: string;
      publishConfig?: { bin?: Record<string, string> };
    };

    expect(packageJson.name).toBe('@kovojs/cli');
    expect(packageJson.bin).toEqual({ kovo: './src/bin.ts' });
    expect(packageJson.publishConfig?.bin).toEqual({ kovo: './dist/bin.mjs' });
  });

  it('emits stable OK output for an empty semantic graph', () => {
    expect(kovoCheck({})).toEqual({
      exitCode: 0,
      output: 'kovo-check/v1\nOK\n',
    });
  });

  it('reports unknown diagnostic codes as stable input errors', () => {
    expect(
      kovoCheck({
        lints: [{ code: 'KV999', site: 'cart.tsx:1' }],
      } as never),
    ).toEqual({
      exitCode: 1,
      output: 'kovo-check/v1\nERROR INPUT lints[0].code unknown diagnostic code "KV999"\n',
    });
  });

  it('fails on KV310 optimistic coverage gaps', () => {
    expect(
      kovoCheck({
        optimistic: [
          { mutation: 'cart/add', query: 'cartQuery.items', status: 'UNHANDLED' },
          { mutation: 'cart/add', query: 'cartQuery.count', status: 'hand-written' },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'kovo-check/v1\nWARN KV310 cart/add -> cartQuery.items Invalidated query lacks optimistic transform.\n',
    });
  });

  it('prints stable KV311 update coverage rows and warnings', () => {
    expect(
      kovoCheck({
        updateCoverage: [
          {
            component: 'CartBadge',
            position: 'conditional <dot>',
            query: 'cart.discount',
            status: 'UNHANDLED',
          },
          {
            component: 'CartBadge',
            detail: 'text binding',
            position: 'text',
            query: 'cart.count',
            status: 'plan',
          },
          {
            component: 'CartDrawer',
            position: 'root',
            query: 'cart',
            status: 'fragment',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'kovo-check/v1',
        'COVERAGE component=CartBadge query=cart.count position="text" status=plan detail="text binding"',
        'WARN KV311 component=CartBadge query=cart.discount position="conditional <dot>" Query/state-dependent DOM position has no update status.',
        'COVERAGE component=CartDrawer query=cart position="root" status=fragment',
        '',
      ].join('\n'),
    });
  });

  it('fails KV314 when renderOnce reads a query invalidated by modeled writes', () => {
    expect(
      kovoCheck(
        {
          mutations: [{ key: 'cart/add', writes: ['cart'] }],
          queries: [{ domains: ['cart'], query: 'cart' }],
          touchGraph: {
            'cart.addItem': {
              touches: [
                { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              ],
              unresolved: [],
            },
          },
          updateCoverage: [
            {
              component: 'CartBadge',
              detail: 'declared renderOnce',
              position: 'expression',
              query: 'cart.count',
              status: 'renderOnce',
            },
          ],
        },
        { family: 'coverage' },
      ),
    ).toEqual({
      exitCode: 1,
      output: [
        'kovo-check/v1',
        'ERROR KV314 component=CartBadge query=cart.count position="expression" invalidatedBy=cart.addItem,cart/add renderOnce position reads a query invalidated by a modeled write.',
        'COVERAGE component=CartBadge query=cart.count position="expression" status=renderOnce detail="declared renderOnce"',
        '',
      ].join('\n'),
    });
  });

  it('allows renderOnce coverage when modeled writes do not invalidate that query', () => {
    expect(
      kovoCheck(
        {
          mutations: [{ key: 'product/update', writes: ['product'] }],
          queries: [{ domains: ['cart'], query: 'cart' }],
          updateCoverage: [
            {
              component: 'CartBadge',
              detail: 'declared renderOnce',
              position: 'expression',
              query: 'cart.currency',
              status: 'renderOnce',
            },
          ],
        },
        { family: 'coverage' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'kovo-check/v1\nCOVERAGE component=CartBadge query=cart.currency position="expression" status=renderOnce detail="declared renderOnce"\n',
    });
  });

  it('prints state update coverage source markers when present', () => {
    expect(
      kovoCheck({
        updateCoverage: [
          {
            component: 'SwitchDemo',
            detail: 'state expression has no data-bind, renderOnce, or isomorphic status',
            position: 'expression',
            query: 'state.checked',
            source: 'state',
            status: 'UNHANDLED',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'kovo-check/v1\nWARN KV311 component=SwitchDemo query=state.checked source=state position="expression" Query/state-dependent DOM position has no update status. state expression has no data-bind, renderOnce, or isomorphic status\n',
    });
  });

  it('reports owner-domain accesses that are not session scoped', () => {
    expect(
      kovoCheck({
        ownerDomains: [{ domain: 'cart', owner: 'userId' }],
        scopeAudits: [
          {
            domain: 'cart',
            kind: 'query',
            name: 'cart',
            scope: 'session',
            site: 'cart.queries.ts:8',
          },
          {
            detail: 'where eq(carts.id, args.cartId)',
            domain: 'cart',
            kind: 'query',
            name: 'cartById',
            scope: 'args',
            site: 'cart.queries.ts:21',
          },
          {
            domain: 'product',
            kind: 'query',
            name: 'productGrid',
            scope: 'args',
            site: 'product.queries.ts:4',
          },
        ],
      }).output,
    ).toBe(
      [
        'kovo-check/v1',
        'WARN UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21 where eq(carts.id, args.cartId)',
        '',
      ].join('\n'),
    );
  });

  it('reports unguarded queries and pages alongside mutations', () => {
    expect(
      kovoCheck({
        mutations: [{ guards: ['authed'], key: 'cart/add', writes: ['cart'] }],
        optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'hand-written' }],
        pages: [
          { guards: ['authed'], route: '/cart' },
          { guards: [], queries: ['adminOrders'], route: '/admin' },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['order'], guards: [], query: 'adminOrders' },
        ],
      }).output,
    ).toBe(
      [
        'kovo-check/v1',
        'ERROR KV407 adminOrders reads order. Query read from undeclared domain. No mutation touch graph writes that domain.',
        'WARN UNGUARDED page /admin is reachable without an auth guard.',
        'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
        '',
      ].join('\n'),
    );
  });

  it('derives KV310 gaps from mutation invalidations and query read sets', () => {
    expect(
      kovoCheck({
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
      exitCode: 1,
      output:
        'kovo-check/v1\nWARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    });
  });

  it('accepts explicit optimistic statuses for every invalidated query', () => {
    expect(
      kovoCheck({
        mutations: [
          {
            guards: ['authed'],
            invalidates: ['cart'],
            key: 'cart/add',
            manualInvalidates: ['product'],
          },
        ],
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
      output:
        'kovo-check/v1\nWARN INVALIDATE cart/add -> product Manual invalidate escape hatch requires review.\n',
    });
  });

  it('derives KV310 gaps from manual invalidations', () => {
    expect(
      kovoCheck({
        mutations: [{ key: 'cart/add', manualInvalidates: ['product'] }],
        queries: [{ domains: ['product'], query: 'productGrid' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'product', keys: null, site: 'cart.domain.ts:1', via: 'products' }],
            unresolved: [],
          },
        },
      }).output,
    ).toBe(
      [
        'kovo-check/v1',
        'WARN KV310 cart/add -> productGrid Invalidated query lacks optimistic transform.',
        'WARN UNGUARDED cart/add mutation is reachable without an auth guard.',
        'WARN INVALIDATE cart/add -> product Manual invalidate escape hatch requires review.',
        '',
      ].join('\n'),
    );
  });

  it('derives KV310 gaps from mutation writes when invalidates are absent', () => {
    expect(
      kovoCheck({
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
      'kovo-check/v1\nWARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    );
  });

  it('derives KV310 gaps from writes even when explicit invalidates are incomplete', () => {
    expect(
      kovoCheck({
        mutations: [
          {
            guards: ['authed'],
            invalidates: ['cart'],
            key: 'cart/add',
            writes: ['cart', 'product'],
          },
        ],
        optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'hand-written' }],
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
      }).output,
    ).toBe(
      'kovo-check/v1\nWARN KV310 cart/add -> productGrid Invalidated query lacks optimistic transform.\n',
    );
  });

  it('reports semantic lints for local state, events, and direct db access', () => {
    expect(
      kovoCheck({
        lints: [
          {
            code: 'KV301',
            detail: 'state.cartCount mirrors query cart.count.',
            site: 'CartBadge.client.ts:8',
          },
          {
            code: 'KV320',
            detail: 'event cart:added carries product.unitPrice.',
            site: 'cart.events.ts:3',
          },
          {
            code: 'KV330',
            detail: 'handler addToCart receives db.',
            site: 'cart.mutation.ts:12',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-check/v1',
        'LINT KV301 CartBadge.client.ts:8 Server fact stored in island-local state. state.cartCount mirrors query cart.count.',
        'LINT KV320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice.',
        'LINT KV330 cart.mutation.ts:12 Direct db access in a mutation handler; route through domain. handler addToCart receives db.',
        '',
      ].join('\n'),
    });
  });

  it('prints KV302 data-bind path lints using the SPEC §11.3 diagnostic registry message', () => {
    expect(
      kovoCheck({
        lints: [
          {
            code: 'KV302',
            detail: 'cart.total',
            site: 'CartBadge.tsx:12',
          },
        ],
      }).output,
    ).toMatchInlineSnapshot(`
      "kovo-check/v1
      LINT KV302 CartBadge.tsx:12 data-bind path is not present in the declared query shape. cart.total
      "
    `);
  });

  it('prints KV303 fragment target input diagnostics using the registry message', () => {
    expect(
      kovoCheck({
        lints: [
          {
            code: 'KV303',
            detail: 'priceList',
            site: 'CartRow.tsx:7',
          },
        ],
      }).output,
    ).toMatchInlineSnapshot(`
      "kovo-check/v1
      LINT KV303 CartRow.tsx:7 Fragment target render input is not declared as query data or stamped props. priceList
      "
    `);
  });

  it('reports KV320 when event payload facts overlap query data facts', () => {
    expect(
      kovoCheck({
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
        'kovo-check/v1\nLINT KV320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice from query productCard.\n',
    });
  });

  it('keeps graph-derived KV320 output stable across duplicate query fields', () => {
    expect(
      kovoCheck({
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
      'kovo-check/v1\nLINT KV320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice from query cart,recommendations.\n',
    );
  });

  it('accepts event payload facts that do not overlap query data facts', () => {
    expect(
      kovoCheck({
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
      output: 'kovo-check/v1\nOK\n',
    });
  });

  it('reports unresolved touch graph sites as KV406', () => {
    expect(
      kovoCheck({
        touchGraph: {
          'cart.addItem': {
            touches: [],
            unresolved: [
              {
                code: 'KV406',
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
        'kovo-check/v1\nWARN KV406 cart.domain.ts:20 Statically un-analyzable write site; manual touches required.\n',
    });
  });

  it('reports non-equality touch graph predicates as KV409 notices', () => {
    expect(
      kovoCheck({
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
        'kovo-check/v1\nNOTICE KV409 product.domain.ts:20 Non-eq predicate degraded to table-level invalidation.\n',
    });
  });

  it('prints static Drizzle query diagnostics as kovo check findings', () => {
    expect(
      kovoCheck({
        diagnostics: [
          {
            code: 'KV410',
            site: 'cart.queries.ts:5',
          },
          {
            code: 'KV412',
            message:
              'Query reads an unmodeled relation. view product_search has no derived or declared domain.',
            site: 'product.queries.ts:9',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'kovo-check/v1\nERROR KV410 cart.queries.ts:5 Query result shape failed declared output schema.\nERROR KV412 product.queries.ts:9 Query reads an unmodeled relation. view product_search has no derived or declared domain.\n',
    });
  });

  it('prints static diagnostic source positions when present', () => {
    expect(
      kovoCheck({
        diagnostics: [
          {
            code: 'KV302',
            message: 'data-bind path is not present in the declared query shape. cart.missing',
            site: 'cart-badge.tsx',
            start: { column: 23, line: 3 },
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'kovo-check/v1\nERROR KV302 cart-badge.tsx:3:23 data-bind path is not present in the declared query shape. cart.missing\n',
    });
  });

  it('prints runtime verification diagnostics as kovo check findings', () => {
    expect(
      kovoCheck({
        verificationDiagnostics: [
          {
            branch: 'stock-reserve',
            code: 'KV405',
            domain: 'product',
            site: 'cart.domain.ts:2',
          },
          {
            code: 'KV402',
            detail: 'observed table audit_log',
            domain: 'audit',
          },
          {
            code: 'KV408',
            detail: 'expected id observed sku',
            domain: 'product',
            site: 'product.domain.ts:9',
          },
          {
            code: 'KV403',
            domain: 'order',
          },
          {
            code: 'KV404',
            detail: 'observed table unknown_table',
            domain: 'unknown_table',
          },
          {
            code: 'KV407',
            detail: 'observed table products',
            domain: 'product',
            site: 'cart.queries.ts:7',
          },
          {
            code: 'KV410',
            detail: 'cart Expected number',
            domain: 'cart',
            site: 'cart.queries.ts:11',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'kovo-check/v1',
        'WARN KV405 cart.domain.ts:2 Conditional write branch was never executed under instrumentation. domain=product branch=stock-reserve',
        'ERROR KV402 domain:audit Write touched an undeclared domain. domain=audit observed table audit_log',
        'ERROR KV408 product.domain.ts:9 Declared row key differs from observed row predicate. domain=product expected id observed sku',
        'WARN KV403 domain:order Declared domain was never observed written. domain=order',
        'ERROR KV404 domain:unknown_table Write to unmapped table. domain=unknown_table observed table unknown_table',
        'ERROR KV407 cart.queries.ts:7 Query read from undeclared domain. domain=product observed table products',
        'ERROR KV410 cart.queries.ts:11 Query result shape failed declared output schema. domain=cart cart Expected number',
        '',
      ].join('\n'),
    });
  });

  it('fails when verifier coverage leaves a query unobserved', () => {
    expect(
      kovoCheck({
        verificationCoverage: [
          { key: 'cart/add', kind: 'mutation', observed: true, site: 'cart.domain.ts:12' },
          { key: 'productGrid', kind: 'query', observed: false, site: 'cart.queries.ts:7' },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'kovo-check/v1\nERROR VERIFY cart.queries.ts:7 query productGrid has no verifier coverage.\n',
    });
  });

  it('fails when a query reads a domain no mutation can invalidate', () => {
    expect(
      kovoCheck({
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
        'kovo-check/v1\nERROR KV407 productPage reads product. Query read from undeclared domain. No mutation touch graph writes that domain.\n',
    });
  });

  it('fails when declared query reads are narrower than derived query reads', () => {
    expect(
      kovoCheck({
        derivedQueries: [{ domains: ['contact', 'deal'], query: 'contactList' }],
        queries: [{ domains: ['contact'], query: 'contactList' }],
        touchGraph: {
          'contact.update': {
            touches: [{ domain: 'contact', keys: null, site: 'contacts.ts:1', via: 'contacts' }],
            unresolved: [],
          },
          'deal.create': {
            touches: [{ domain: 'deal', keys: null, site: 'deals.ts:1', via: 'deals' }],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'kovo-check/v1\nERROR KV407 contactList reads deal. Query read from undeclared domain. Derived read set is not covered by declared query domains.\n',
    });
  });

  it('fails when declared mutation domains are narrower than derived touch domains', () => {
    expect(
      kovoCheck({
        derivedMutations: [
          { domains: ['contact', 'deal'], mutation: 'createDeal', site: 'deals.ts:9' },
        ],
        mutations: [{ guards: ['authed'], invalidates: ['deal'], key: 'createDeal' }],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'kovo-check/v1\nERROR KV402 deals.ts:9 createDeal touches contact. Write touched an undeclared domain. Derived touch set is not covered by declared mutation domains.\n',
    });
  });

  it('accepts query read domains covered by the touch graph', () => {
    expect(
      kovoCheck({
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
      output: 'kovo-check/v1\nOK\n',
    });
  });

  it('fails when declared mutation invalidations lack optimistic coverage', () => {
    expect(
      kovoCheck({
        mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
        queries: [{ domains: ['cart'], query: 'cart' }],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'kovo-check/v1\nWARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    });
  });

  it('reports fixpoint invariant failures as stable ERROR diagnostics', () => {
    // SPEC.md §5.2 requires generated output to be a CI-enforced compiler fixpoint.
    expect(
      kovoCheck({
        fixpointChecks: [
          {
            actual: 'sha256:bbb',
            artifact: 'components/z.generated.tsx',
            detail: 'compile(compile(src)) differed.',
            expected: 'sha256:aaa',
            ok: false,
          },
          {
            artifact: 'components/ok.generated.tsx',
            ok: true,
          },
          {
            artifact: 'components/a.generated.tsx',
            ok: false,
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'kovo-check/v1',
        'ERROR FIXPOINT components/a.generated.tsx Generated output must compile to itself.',
        'ERROR FIXPOINT components/z.generated.tsx compile(compile(src)) differed. expected="sha256:aaa" actual="sha256:bbb"',
        '',
      ].join('\n'),
    });
  });

  it('accepts satisfied fixpoint checks', () => {
    expect(
      kovoCheck({
        fixpointChecks: [
          {
            artifact: 'components/cart-badge.server.tsx',
            ok: true,
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'kovo-check/v1\nOK\n',
    });
  });

  it('reports render-equivalence failures as stable ERROR diagnostics', () => {
    expect(
      kovoCheck({
        renderEquivalenceChecks: [
          {
            actual: 'sha256:lowered',
            artifact: 'components/z.server.js',
            detail: 'render(src) differed from render(compile(src)).',
            expected: 'sha256:authored',
            ok: false,
          },
          {
            artifact: 'components/ok.server.js',
            ok: true,
          },
          {
            artifact: 'components/a.server.js',
            ok: false,
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'kovo-check/v1',
        'ERROR RENDER_EQUIV components/a.server.js Authored and lowered render output must match byte-for-byte.',
        'ERROR RENDER_EQUIV components/z.server.js render(src) differed from render(compile(src)). expected="sha256:authored" actual="sha256:lowered"',
        '',
      ].join('\n'),
    });
  });

  it('accepts satisfied render-equivalence checks', () => {
    expect(
      kovoCheck({
        renderEquivalenceChecks: [
          {
            artifact: 'components/cart-badge.server.js',
            ok: true,
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'kovo-check/v1\nOK\n',
    });
  });

  it('audits mutations reachable without an auth guard', () => {
    expect(
      kovoCheck({
        mutations: [
          { guards: ['rateLimit:session'], key: 'cart/add' },
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'kovo-check/v1\nWARN UNGUARDED cart/add mutation is reachable without an auth guard.\n',
    });
  });

  it('audits endpoints reachable without an auth declaration', () => {
    expect(
      kovoCheck({
        endpoints: [
          {
            auth: 'none',
            csrf: 'exempt',
            csrfJustification: 'oauth callback',
            method: 'POST',
            name: 'auth/callback',
            path: '/auth/callback',
          },
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'kovo-check/v1\nWARN UNGUARDED auth/callback endpoint is reachable without an auth declaration.\n',
    });
  });

  it('warns when endpoint CSRF exemptions are missing the named justification', () => {
    expect(
      kovoCheck({
        endpoints: [{ csrf: 'exempt', method: 'POST', name: 'stripe/webhook', path: '/stripe' }],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'kovo-check/v1',
        'WARN UNGUARDED stripe/webhook endpoint is reachable without an auth declaration.',
        'WARN ENDPOINT stripe/webhook csrf exemption requires a named justification.',
        '',
      ].join('\n'),
    });
  });

  it('audits manual invalidate escape-hatch usage', () => {
    expect(
      kovoCheck({
        mutations: [{ key: 'inventory/sync', manualInvalidates: ['product'] }],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'kovo-check/v1\nWARN UNGUARDED inventory/sync mutation is reachable without an auth guard.\nWARN INVALIDATE inventory/sync -> product Manual invalidate escape hatch requires review.\n',
    });
  });

  it('fails kovo check optimistic as a CLI command when coverage is unhandled', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-optimistic-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
          optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'UNHANDLED' }],
          queries: [{ domains: ['cart'], query: 'cart' }],
          updateCoverage: [
            {
              component: 'CartBadge',
              position: 'conditional <dot>',
              query: 'cart.discount',
              status: 'UNHANDLED',
            },
          ],
          touchGraph: {
            'cart.addItem': {
              reads: [{ domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' }],
              touches: [
                { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              ],
              unresolved: [
                {
                  code: 'KV406',
                  message: 'Statically un-analyzable write site; manual touches required.',
                  site: 'cart.domain.ts:3',
                },
              ],
            },
          },
        }),
      );

      expect(main(['check', 'optimistic', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      'kovo-check/v1\nWARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    );
  });

  it('fails kovo check coverage as a CLI command when coverage is unhandled', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-coverage-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
          optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'UNHANDLED' }],
          queries: [{ domains: ['product'], query: 'productPage' }],
          touchGraph: {
            'cart.addItem': {
              touches: [
                { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              ],
              unresolved: [
                {
                  code: 'KV406',
                  message: 'Statically un-analyzable write site; manual touches required.',
                  site: 'cart.domain.ts:3',
                },
              ],
            },
          },
          updateCoverage: [
            {
              component: 'CartBadge',
              position: 'conditional <dot>',
              query: 'cart.discount',
              status: 'UNHANDLED',
            },
          ],
        }),
      );

      expect(main(['check', 'coverage', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      'kovo-check/v1\nWARN KV311 component=CartBadge query=cart.discount position="conditional <dot>" Query/state-dependent DOM position has no update status.\n',
    );
  });

  it('rejects unsupported kovo check families with a stable diagnostic', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['check', 'optimstic', 'graph.json'])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toBe(
      'kovo: unsupported check family "optimstic". expected optimistic or coverage.\n',
    );
  });

  it('rejects extra args after supported kovo check families', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['check', 'coverage', 'graph.json', 'extra.json'])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toBe('kovo: usage: kovo check [optimistic|coverage] [graph.json]\n');
  });

  it('rejects unknown flags before treating them as graph paths', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['explain', '--json', 'component', 'CartBadge'])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toBe('kovo: unknown flag "--json"\n');
  });

  it('reports compile usage through the synchronous dispatcher', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['compile'])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toContain('kovo compile component <source.tsx>');
    expect(output).toContain('kovo compile graph <input.json> --out <graph.json>');
  });

  it('runs as a CLI entrypoint when the script path contains spaces', () => {
    const parent = mkdtempSync(join(tmpdir(), 'kovo-cli-entry-'));
    const spacedDir = join(parent, 'entry path with spaces');
    const entryPath = join(spacedDir, 'kovo.ts');

    try {
      mkdirSync(spacedDir, { recursive: true });
      mkdirSync(join(parent, 'node_modules/@kovojs/core'), { recursive: true });
      writeFileSync(
        join(parent, 'node_modules/@kovojs/core/package.json'),
        JSON.stringify({
          type: 'module',
          exports: {
            '.': './index.js',
            './internal/derivation': './internal/derivation.js',
            './internal/graph': './internal/graph.js',
          },
        }) + '\n',
        'utf8',
      );
      mkdirSync(join(parent, 'node_modules/@kovojs/core/internal'), { recursive: true });
      writeFileSync(
        join(parent, 'node_modules/@kovojs/core/index.js'),
        [
          'export const diagnosticDefinitions = {};',
          'export function diagnosticDefinitionText() { return ""; }',
          'export function isDiagnosticCode() { return false; }',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(parent, 'node_modules/@kovojs/core/internal/derivation.js'),
        ['export function puntReasonLabel() { return ""; }', ''].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(parent, 'node_modules/@kovojs/core/internal/graph.js'),
        ['export function validateKovoExplainInput() { return []; }', ''].join('\n'),
        'utf8',
      );
      writeFileSync(join(parent, 'package.json'), '{"type":"module"}\n', 'utf8');
      symlinkSync(new URL('./bin.ts', import.meta.url), entryPath);
      symlinkSync(new URL('./index.ts', import.meta.url), join(spacedDir, 'index.js'));
      symlinkSync(new URL('./add-catalog.ts', import.meta.url), join(spacedDir, 'add-catalog.js'));
      symlinkSync(
        new URL('./commands-manifest.ts', import.meta.url),
        join(spacedDir, 'commands-manifest.js'),
      );

      const output = execFileSync(process.execPath, ['--preserve-symlinks-main', entryPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      expect(output).toBe('kovo: add, audit, build, check, compile, explain, export, mcp\n');
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('reports a stable error for missing check input files', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['check', join(tmpdir(), 'missing-kovo-graph.json')])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toMatch(/^kovo: input file not found: .*missing-kovo-graph\.json\n$/);
  });

  it('reports a stable error for malformed JSON input', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-malformed-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '{');

      expect(main(['audit', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(`kovo: input file is not valid JSON: ${graphPath}\n`);
  });

  it('reports a stable error for non-object JSON input', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-shape-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '[]');

      expect(main(['explain', '--unguarded', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(`kovo: input JSON must be an object: ${graphPath}\n`);
  });

  it('reports a stable error for graph array fields with the wrong shape', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-field-shape-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '{"mutations":{}}');

      expect(main(['check', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(`kovo: input JSON field mutations must be an array: ${graphPath}\n`);
  });

  it('reports a stable error for malformed render-equivalence check facts', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-render-equiv-shape-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '{"renderEquivalenceChecks":{}}');

      expect(main(['check', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      `kovo: input JSON field renderEquivalenceChecks must be an array: ${graphPath}\n`,
    );
  });

  it('reports a stable error for touchGraph with the wrong shape', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'kovo-cli-touch-graph-shape-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '{"touchGraph":[]}');

      expect(main(['check', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(`kovo: input JSON field touchGraph must be an object: ${graphPath}\n`);
  });
});
