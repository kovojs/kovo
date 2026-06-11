import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { fwAudit, fwCheck, fwExplain, main } from './index.js';

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

  it('prints stable FW311 update coverage rows and warnings', () => {
    expect(
      fwCheck({
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
      exitCode: 0,
      output: [
        'fw-check/v1',
        'COVERAGE component=CartBadge query=cart.count position="text" status=plan detail="text binding"',
        'WARN FW311 component=CartBadge query=cart.discount position="conditional <dot>" Query-dependent DOM position has no update status.',
        'COVERAGE component=CartDrawer query=cart position="root" status=fragment',
        '',
      ].join('\n'),
    });
  });

  it('reports owner-domain accesses that are not session scoped', () => {
    expect(
      fwCheck({
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
        'fw-check/v1',
        'WARN UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21 where eq(carts.id, args.cartId)',
        '',
      ].join('\n'),
    );
  });

  it('reports unguarded queries and pages alongside mutations', () => {
    expect(
      fwCheck({
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
        'fw-check/v1',
        'ERROR FW407 adminOrders reads order but no mutation touch graph writes that domain.',
        'WARN UNGUARDED page /admin is reachable without an auth guard.',
        'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
        '',
      ].join('\n'),
    );
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
        'fw-check/v1\nWARN INVALIDATE cart/add -> product Manual invalidate escape hatch requires review.\n',
    });
  });

  it('derives FW310 gaps from manual invalidations', () => {
    expect(
      fwCheck({
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
        'fw-check/v1',
        'WARN FW310 cart/add -> productGrid Invalidated query lacks optimistic transform.',
        'WARN UNGUARDED cart/add mutation is reachable without an auth guard.',
        'WARN INVALIDATE cart/add -> product Manual invalidate escape hatch requires review.',
        '',
      ].join('\n'),
    );
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

  it('derives FW310 gaps from writes even when explicit invalidates are incomplete', () => {
    expect(
      fwCheck({
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
      'fw-check/v1\nWARN FW310 cart/add -> productGrid Invalidated query lacks optimistic transform.\n',
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

  it('prints FW303 fragment target input diagnostics using the registry message', () => {
    expect(
      fwCheck({
        lints: [
          {
            code: 'FW303',
            detail: 'priceList',
            site: 'CartRow.tsx:7',
          },
        ],
      }).output,
    ).toMatchInlineSnapshot(`
      "fw-check/v1
      LINT FW303 CartRow.tsx:7 Fragment target render input is not declared as query data or stamped props. priceList
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

  it('prints static Drizzle FW410 diagnostics as fw check findings', () => {
    expect(
      fwCheck({
        diagnostics: [
          {
            code: 'FW410',
            site: 'cart.queries.ts:5',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nERROR FW410 cart.queries.ts:5 Query result shape failed declared output schema.\n',
    });
  });

  it('prints static diagnostic source positions when present', () => {
    expect(
      fwCheck({
        diagnostics: [
          {
            code: 'FW302',
            message: 'data-bind path is not present in the declared query shape. cart.missing',
            site: 'cart-badge.tsx',
            start: { column: 23, line: 3 },
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nERROR FW302 cart-badge.tsx:3:23 data-bind path is not present in the declared query shape. cart.missing\n',
    });
  });

  it('prints runtime verification diagnostics as fw check findings', () => {
    expect(
      fwCheck({
        verificationDiagnostics: [
          {
            branch: 'stock-reserve',
            code: 'FW405',
            domain: 'product',
            site: 'cart.domain.ts:2',
          },
          {
            code: 'FW402',
            detail: 'observed table audit_log',
            domain: 'audit',
          },
          {
            code: 'FW408',
            detail: 'expected id observed sku',
            domain: 'product',
            site: 'product.domain.ts:9',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'fw-check/v1',
        'WARN FW405 cart.domain.ts:2 Conditional write branch was never executed under instrumentation. domain=product branch=stock-reserve',
        'ERROR FW402 domain:audit Write touched an undeclared domain. domain=audit observed table audit_log',
        'ERROR FW408 product.domain.ts:9 Declared row key differs from observed row predicate. domain=product expected id observed sku',
        '',
      ].join('\n'),
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

  it('accepts query read domains covered by declared mutation invalidations', () => {
    expect(
      fwCheck({
        mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
        queries: [{ domains: ['cart'], query: 'cart' }],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    });
  });

  it('reports fixpoint invariant failures as stable ERROR diagnostics', () => {
    // SPEC.md §5.2 requires generated output to be a CI-enforced compiler fixpoint.
    expect(
      fwCheck({
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
        'fw-check/v1',
        'ERROR FIXPOINT components/a.generated.tsx Generated output must compile to itself.',
        'ERROR FIXPOINT components/z.generated.tsx compile(compile(src)) differed. expected="sha256:aaa" actual="sha256:bbb"',
        '',
      ].join('\n'),
    });
  });

  it('accepts satisfied fixpoint checks', () => {
    expect(
      fwCheck({
        fixpointChecks: [
          {
            artifact: 'components/cart-badge.server.tsx',
            ok: true,
          },
        ],
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

  it('accepts fw check optimistic as a CLI command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-optimistic-'));
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
                  code: 'FW406',
                  message: 'Statically un-analyzable write site; manual touches required.',
                  site: 'cart.domain.ts:3',
                },
              ],
            },
          },
        }),
      );

      expect(main(['check', 'optimistic', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    );
  });

  it('accepts fw check coverage as a CLI command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-coverage-'));
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
                  code: 'FW406',
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

      expect(main(['check', 'coverage', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      'fw-check/v1\nWARN FW311 component=CartBadge query=cart.discount position="conditional <dot>" Query-dependent DOM position has no update status.\n',
    );
  });

  it('reports a stable error for missing check input files', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['check', join(tmpdir(), 'missing-jiso-graph.json')])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toMatch(/^fw: input file not found: .*missing-jiso-graph\.json\n$/);
  });

  it('reports a stable error for malformed JSON input', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-malformed-'));
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

    expect(output).toBe(`fw: input file is not valid JSON: ${graphPath}\n`);
  });

  it('reports a stable error for non-object JSON input', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-shape-'));
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

    expect(output).toBe(`fw: input JSON must be an object: ${graphPath}\n`);
  });
});

describe('fw audit', () => {
  it('prints stable unguarded and manual invalidate audit output', () => {
    expect(
      fwAudit({
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
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=cart manual-invalidates=-',
        'MUTATION inventory/sync guards=- writes=product invalidates=- manual-invalidates=product',
        'MANUAL-INVALIDATES',
        'MUTATION inventory/sync domains=product',
        'SUMMARY unguarded=2 manual-invalidates=1',
        '',
      ].join('\n'),
    });
  });

  it('prints OK when there are no audit findings', () => {
    expect(
      fwAudit({
        mutations: [
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-audit/v1\nOK\n',
    });
  });

  it('accepts fw audit as a CLI command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-audit-'));
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

      expect(main(['audit', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'fw-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    );
  });
});

describe('fw explain', () => {
  it('explains component handlers, query consumers, and fragment targets', () => {
    expect(
      fwExplain(
        {
          components: [
            {
              attributeMerges: [
                {
                  attr: 'aria-expanded',
                  decision: 'author-wins',
                  diagnostics: ['FW232'],
                  element: 'button',
                  rule: 'aria-author-override',
                },
                {
                  attr: 'data-bind:hidden',
                  decision: 'error',
                  diagnostics: ['FW233'],
                  element: 'button',
                  rule: 'binding-target-conflict',
                },
              ],
              derives: [
                {
                  inputs: ['cart'],
                  name: 'CartBadge$isEmpty',
                  ref: '/c/cart-badge.client.js#CartBadge$isEmpty',
                  target: 'button[data-bind:disabled]',
                },
              ],
              fragments: ['cart-badge'],
              handlers: [
                {
                  captures: ['ctx', 'element-params'],
                  event: 'click',
                  exportName: 'CartBadge$button_click',
                  params: ['itemId'],
                  ref: '/c/cart-badge.client.js#CartBadge$button_click',
                },
              ],
              name: 'CartBadge',
              platformSubstitutions: [
                {
                  action: 'show-modal',
                  event: 'click',
                  kind: 'dialog',
                  tag: 'button',
                  target: 'cart-drawer',
                },
              ],
              queries: ['cart'],
              triggers: [
                {
                  deps: ['cart'],
                  exportName: 'CartBadge$mountChart',
                  justification: 'chart boots when visible',
                  ref: '/c/cart-badge.client.js#CartBadge$mountChart',
                  trigger: 'visible',
                },
              ],
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
        'HANDLER click export=CartBadge$button_click ref=/c/cart-badge.client.js#CartBadge$button_click captures=ctx,element-params params=itemId substitution=-',
        'SUBSTITUTION dialog tag=button event=click target=cart-drawer action=show-modal',
        'DERIVE CartBadge$isEmpty inputs=cart ref=/c/cart-badge.client.js#CartBadge$isEmpty target=button[data-bind:disabled]',
        'TRIGGER visible export=CartBadge$mountChart ref=/c/cart-badge.client.js#CartBadge$mountChart deps=cart justification=chart boots when visible',
        'MERGE button attr=aria-expanded rule=aria-author-override decision=author-wins diagnostics=FW232',
        'MERGE button attr=data-bind:hidden rule=binding-target-conflict decision=error diagnostics=FW233',
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
              enctype: 'multipart/form-data',
              fileFields: ['receipt'],
              guards: ['authed'],
              invalidates: ['cart'],
              inputFields: ['productId', 'quantity', 'receipt'],
              key: 'cart/add',
              manualInvalidates: ['product'],
              session: 'commerceSession',
              writes: ['cart', 'product'],
            },
          ],
          optimistic: [
            { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
            { mutation: 'cart/add', query: 'recommendations', status: 'await-fragment' },
            { mutation: 'cart/add', query: 'cart.discount', status: 'UNHANDLED' },
          ],
          components: [
            { name: 'CartBadge', queries: ['cart'] },
            { name: 'Recommendations', queries: ['recommendations'] },
          ],
          pages: [{ queries: ['cart'], route: '/cart' }],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'recommendations' },
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
        'session: commerceSession',
        'enctype: multipart/form-data',
        'input-fields: productId,quantity,receipt',
        'file-fields: receipt',
        'writes: cart,product',
        'invalidates: cart',
        'manual-invalidates: product',
        'updates: cart->component:CartBadge,page:/cart; recommendations->component:Recommendations',
        'OPTIMISTIC cart hand-written',
        'OPTIMISTIC recommendations await-fragment',
        'OPTIMISTIC-SUMMARY total=2 hand-written=1 await-fragment=1 UNHANDLED=0',
        '',
      ].join('\n'),
    });
  });

  it('explains missing optimistic coverage as derived UNHANDLED rows and ignores unrelated statuses', () => {
    expect(
      fwExplain(
        {
          mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
          optimistic: [
            { mutation: 'cart/add', query: 'recommendations', status: 'await-fragment' },
          ],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'recommendations' },
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
        'writes: -',
        'invalidates: cart',
        'manual-invalidates: -',
        'updates: -',
        'OPTIMISTIC cart UNHANDLED',
        "  -> hand-write in the mutation module, or declare 'await-fragment'",
        'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=0 UNHANDLED=1',
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

  it('audits unguarded queries and pages with stable explain output', () => {
    const result = fwExplain(
      {
        mutations: [
          { guards: ['authed'], key: 'cart/add' },
          { guards: ['rateLimit:session'], key: 'inventory/sync', writes: ['product'] },
        ],
        pages: [
          { guards: ['authed'], queries: ['cart'], route: '/cart' },
          { guards: [], queries: ['adminOrders'], route: '/admin' },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['order'], guards: [], query: 'adminOrders' },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNGUARDED
      MUTATION inventory/sync guards=rateLimit:session writes=product invalidates=- manual-invalidates=-
      PAGE /admin guards=- queries=adminOrders
      QUERY adminOrders guards=- reads=order
      SUMMARY total=3
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

  it('audits owner-scoped queries and writes with stable explain output', () => {
    const result = fwExplain(
      {
        ownerDomains: [{ domain: 'cart', owner: 'userId' }],
        scopeAudits: [
          {
            domain: 'cart',
            kind: 'write',
            name: 'cart.merge',
            scope: 'unknown',
            site: 'cart.domain.ts:30',
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
            domain: 'cart',
            kind: 'query',
            name: 'cart',
            scope: 'session',
            site: 'cart.queries.ts:8',
          },
          {
            domain: 'product',
            kind: 'query',
            name: 'productGrid',
            scope: 'unscoped',
            site: 'product.queries.ts:4',
          },
        ],
      },
      { unscoped: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNSCOPED
      UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21 where eq(carts.id, args.cartId)
      UNSCOPED WRITE cart.merge domain=cart scope=unknown site=cart.domain.ts:30
      SUMMARY total=2
      "
    `);
  });

  it('accepts fw explain --unscoped as a CLI audit mode', () => {
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
          ownerDomains: [{ domain: 'cart', owner: 'userId' }],
          scopeAudits: [
            {
              domain: 'cart',
              kind: 'query',
              name: 'cartById',
              scope: 'args',
              site: 'cart.queries.ts:21',
            },
          ],
        }),
      );

      expect(main(['explain', '--unscoped', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNSCOPED
      UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21
      SUMMARY total=1
      "
    `);
  });

  it('explains query read sets with mutation invalidators separated per SPEC.md section 5.3', () => {
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
        'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,page:/cart,page:/checkout\ninvalidated-by: -\ndomain-writes: cart.addItem\n',
    });
  });

  it('explains query invalidations from declared mutation domains without a touch graph', () => {
    expect(
      fwExplain(
        {
          components: [{ name: 'CartBadge', queries: ['cart'] }],
          mutations: [
            { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
            { guards: ['authed'], invalidates: ['cart'], key: 'cart/remove' },
          ],
          queries: [{ domains: ['cart'], query: 'cart' }],
        },
        { kind: 'query', target: 'cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge\ninvalidated-by: cart/add,cart/remove\ndomain-writes: -\n',
    });
  });

  it('explains mutation updates from writes when invalidates are absent', () => {
    expect(
      fwExplain(
        {
          components: [{ name: 'CartBadge', queries: ['cart'] }],
          mutations: [{ guards: ['authed'], key: 'cart/add', writes: ['cart'] }],
          pages: [{ queries: ['cart'], route: '/checkout' }],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'productGrid' },
          ],
        },
        { kind: 'mutation', target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: cart',
        'invalidates: -',
        'manual-invalidates: -',
        'updates: cart->component:CartBadge,page:/checkout',
        '',
      ].join('\n'),
    });
  });

  it('explains mutation updates from writes even when invalidates are incomplete', () => {
    expect(
      fwExplain(
        {
          components: [
            { name: 'CartBadge', queries: ['cart'] },
            { name: 'ProductGrid', queries: ['productGrid'] },
          ],
          mutations: [
            {
              guards: ['authed'],
              invalidates: ['cart'],
              key: 'cart/add',
              writes: ['cart', 'product'],
            },
          ],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'productGrid' },
          ],
        },
        { kind: 'mutation', target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: cart,product',
        'invalidates: cart',
        'manual-invalidates: -',
        'updates: cart->component:CartBadge; productGrid->component:ProductGrid',
        '',
      ].join('\n'),
    });
  });

  it('explains page prefetch, modulepreload, and query payloads', () => {
    expect(
      fwExplain(
        {
          pages: [
            {
              i18n: ['en-US:cartLabel,productStock'],
              meta: {
                description: 'Browse products.',
                title: 'Jiso Commerce',
              },
              modulepreloads: ['/c/cart-badge.client.js'],
              prefetch: 'conservative',
              queries: ['cart'],
              route: '/cart',
              stylesheets: ['/assets/tailwind.css'],
              viewTransitions: ['product-p1-image'],
            },
          ],
        },
        { kind: 'page', target: '/cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nPAGE /cart\nprefetch: conservative\nmeta: title=Jiso Commerce description=Browse products. image=-\ni18n: en-US:cartLabel,productStock\nmodulepreloads: /c/cart-badge.client.js\nstylesheets: /assets/tailwind.css\nqueries: cart\nview-transitions: product-p1-image\n',
    });
  });

  it('returns a stable not-found diagnostic for missing explain targets', () => {
    expect(fwExplain({}, { kind: 'component', target: 'Missing' })).toEqual({
      exitCode: 1,
      output: 'fw-explain/v1\nERROR NOT_FOUND component Missing\n',
    });
  });
});
