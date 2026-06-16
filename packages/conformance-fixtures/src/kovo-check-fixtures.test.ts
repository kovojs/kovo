import { describe, expect, it } from 'vitest';

import {
  kovoCheckAssertionFact,
  kovoCheckCoverageAssertionFacts,
  kovoCheckCoverageFacts,
  kovoCheckDiagnosticAssertionFacts,
  kovoCheckDiagnosticFacts,
  kovoCheckOkAssertionFact,
  kovoCheckResultFact,
  kovoCheckUnguardedAuditBehaviorFact,
  parseKovoCheckOutput,
} from './kovo-check-fixtures.js';

describe('@kovojs/test kovo-check fixture seam', () => {
  it('parses OK output without pinning raw output strings in consumers', () => {
    expect(kovoCheckResultFact({ exitCode: 0, output: 'kovo-check/v1\nOK\n' })).toEqual({
      coverage: [],
      diagnostics: [],
      exitCode: 0,
      status: 'ok',
      version: 'kovo-check/v1',
    });
    expect(kovoCheckAssertionFact({ exitCode: 0, output: 'kovo-check/v1\nOK\n' })).toEqual({
      coverage: [],
      diagnostics: [],
      exitCode: 0,
      status: 'ok',
      version: 'kovo-check/v1',
    });
    expect(kovoCheckOkAssertionFact({ exitCode: 0, output: 'kovo-check/v1\nOK\n' })).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'kovo-check/v1',
    });
  });

  it('turns warnings and coverage rows into structured facts', () => {
    const output = [
      'kovo-check/v1',
      'WARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.',
      'WARN KV311 component=CartBadge query=cart.discount position="conditional <dot>" Query/state-dependent DOM position has no update status.',
      'COVERAGE component=OrderHistory query=orderHistory position=undefined status=fragment detail="text binding"',
      'WARN UNGUARDED cart/add mutation is reachable without an auth guard.',
      'WARN UNGUARDED page /admin is reachable without an auth guard.',
      'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
      '',
    ].join('\n');

    expect(kovoCheckDiagnosticFacts(output)).toEqual([
      {
        code: 'KV310',
        message: 'Invalidated query lacks optimistic transform.',
        properties: {},
        raw: 'WARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.',
        severity: 'WARN',
        target: 'cart/add -> cart',
      },
      {
        code: 'KV311',
        message: 'Query/state-dependent DOM position has no update status.',
        properties: {
          component: 'CartBadge',
          position: 'conditional <dot>',
          query: 'cart.discount',
        },
        raw: 'WARN KV311 component=CartBadge query=cart.discount position="conditional <dot>" Query/state-dependent DOM position has no update status.',
        severity: 'WARN',
        target: '',
      },
      {
        code: 'UNGUARDED',
        message: 'mutation is reachable without an auth guard.',
        properties: {},
        raw: 'WARN UNGUARDED cart/add mutation is reachable without an auth guard.',
        severity: 'WARN',
        target: 'cart/add',
      },
      {
        code: 'UNGUARDED',
        message: 'is reachable without an auth guard.',
        properties: {},
        raw: 'WARN UNGUARDED page /admin is reachable without an auth guard.',
        severity: 'WARN',
        target: 'page /admin',
      },
      {
        code: 'UNGUARDED',
        message: 'is reachable without an auth guard.',
        properties: {},
        raw: 'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
        severity: 'WARN',
        target: 'query adminOrders',
      },
    ]);
    expect(kovoCheckCoverageFacts(output)).toEqual([
      {
        properties: {
          component: 'OrderHistory',
          detail: 'text binding',
          position: 'undefined',
          query: 'orderHistory',
          status: 'fragment',
        },
        raw: 'COVERAGE component=OrderHistory query=orderHistory position=undefined status=fragment detail="text binding"',
      },
    ]);
    expect(kovoCheckDiagnosticAssertionFacts(output)).toEqual([
      {
        code: 'KV310',
        message: 'Invalidated query lacks optimistic transform.',
        properties: {},
        severity: 'WARN',
        target: 'cart/add -> cart',
      },
      {
        code: 'KV311',
        message: 'Query/state-dependent DOM position has no update status.',
        properties: {
          component: 'CartBadge',
          position: 'conditional <dot>',
          query: 'cart.discount',
        },
        severity: 'WARN',
        target: '',
      },
      {
        code: 'UNGUARDED',
        message: 'mutation is reachable without an auth guard.',
        properties: {},
        severity: 'WARN',
        target: 'cart/add',
      },
      {
        code: 'UNGUARDED',
        message: 'is reachable without an auth guard.',
        properties: {},
        severity: 'WARN',
        target: 'page /admin',
      },
      {
        code: 'UNGUARDED',
        message: 'is reachable without an auth guard.',
        properties: {},
        severity: 'WARN',
        target: 'query adminOrders',
      },
    ]);
    expect(kovoCheckCoverageAssertionFacts(output)).toEqual([
      {
        properties: {
          component: 'OrderHistory',
          detail: 'text binding',
          position: 'undefined',
          query: 'orderHistory',
          status: 'fragment',
        },
      },
    ]);
  });

  it('rejects unrelated command output', () => {
    expect(() => parseKovoCheckOutput('kovo-explain/v1\nQUERY cart\n')).toThrow(
      'kovo check output starts with kovo-check/v1: kovo-explain/v1',
    );
  });

  it('rejects non-OK results through the OK assertion seam', () => {
    expect(() =>
      kovoCheckOkAssertionFact({
        exitCode: 1,
        output:
          'kovo-check/v1\nWARN KV310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
      }),
    ).toThrow('kovo check expected OK: exitCode=1 status=issues diagnostics=1 coverage=0');
  });

  it('projects unguarded route, query, and mutation audits through a reusable behavior fact', () => {
    const observedGraphs: unknown[] = [];
    const fact = kovoCheckUnguardedAuditBehaviorFact({
      kovoCheck(graph) {
        observedGraphs.push(graph);
        return {
          exitCode: 0,
          output: [
            'kovo-check/v1',
            'WARN UNGUARDED inventory/sync mutation is reachable without an auth guard.',
            'WARN UNGUARDED page /admin is reachable without an auth guard.',
            'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
            '',
          ].join('\n'),
        };
      },
    });

    expect(fact).toEqual({
      coverage: [],
      diagnostics: [
        {
          code: 'UNGUARDED',
          message: 'mutation is reachable without an auth guard.',
          properties: {},
          severity: 'WARN',
          target: 'inventory/sync',
        },
        {
          code: 'UNGUARDED',
          message: 'is reachable without an auth guard.',
          properties: {},
          severity: 'WARN',
          target: 'page /admin',
        },
        {
          code: 'UNGUARDED',
          message: 'is reachable without an auth guard.',
          properties: {},
          severity: 'WARN',
          target: 'query adminOrders',
        },
      ],
      exitCode: 0,
      status: 'issues',
      targets: {
        mutation: ['inventory/sync'],
        page: ['/admin'],
        query: ['adminOrders'],
      },
      version: 'kovo-check/v1',
    });
    expect(observedGraphs).toEqual([
      {
        mutations: [
          { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
          { guards: ['rateLimit:session'], key: 'inventory/sync', writes: ['product'] },
        ],
        optimistic: [
          { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
          { mutation: 'inventory/sync', query: 'adminOrders', status: 'await-fragment' },
        ],
        pages: [
          { guards: ['authed'], queries: ['cart'], route: '/cart' },
          { guards: [], queries: ['adminOrders'], route: '/admin' },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['product'], guards: [], query: 'adminOrders' },
        ],
      },
    ]);
  });
});
