import { describe, expect, it } from 'vitest';

import {
  fwCheckAssertionFact,
  fwCheckCoverageAssertionFacts,
  fwCheckCoverageFacts,
  fwCheckDiagnosticAssertionFacts,
  fwCheckDiagnosticFacts,
  fwCheckOkAssertionFact,
  fwCheckResultFact,
  parseFwCheckOutput,
} from './fw-check-fixtures.js';

describe('@jiso/test fw-check fixture seam', () => {
  it('parses OK output without pinning raw output strings in consumers', () => {
    expect(fwCheckResultFact({ exitCode: 0, output: 'fw-check/v1\nOK\n' })).toEqual({
      coverage: [],
      diagnostics: [],
      exitCode: 0,
      status: 'ok',
      version: 'fw-check/v1',
    });
    expect(fwCheckAssertionFact({ exitCode: 0, output: 'fw-check/v1\nOK\n' })).toEqual({
      coverage: [],
      diagnostics: [],
      exitCode: 0,
      status: 'ok',
      version: 'fw-check/v1',
    });
    expect(fwCheckOkAssertionFact({ exitCode: 0, output: 'fw-check/v1\nOK\n' })).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'fw-check/v1',
    });
  });

  it('turns warnings and coverage rows into structured facts', () => {
    const output = [
      'fw-check/v1',
      'WARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.',
      'WARN FW311 component=CartBadge query=cart.discount position="conditional <dot>" Query-dependent DOM position has no update status.',
      'COVERAGE component=OrderHistory query=orderHistory position=undefined status=fragment detail="text binding"',
      'WARN UNGUARDED cart/add mutation is reachable without an auth guard.',
      'WARN UNGUARDED page /admin is reachable without an auth guard.',
      'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
      '',
    ].join('\n');

    expect(fwCheckDiagnosticFacts(output)).toEqual([
      {
        code: 'FW310',
        message: 'Invalidated query lacks optimistic transform.',
        properties: {},
        raw: 'WARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.',
        severity: 'WARN',
        target: 'cart/add -> cart',
      },
      {
        code: 'FW311',
        message: 'Query-dependent DOM position has no update status.',
        properties: {
          component: 'CartBadge',
          position: 'conditional <dot>',
          query: 'cart.discount',
        },
        raw: 'WARN FW311 component=CartBadge query=cart.discount position="conditional <dot>" Query-dependent DOM position has no update status.',
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
    expect(fwCheckCoverageFacts(output)).toEqual([
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
    expect(fwCheckDiagnosticAssertionFacts(output)).toEqual([
      {
        code: 'FW310',
        message: 'Invalidated query lacks optimistic transform.',
        properties: {},
        severity: 'WARN',
        target: 'cart/add -> cart',
      },
      {
        code: 'FW311',
        message: 'Query-dependent DOM position has no update status.',
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
    expect(fwCheckCoverageAssertionFacts(output)).toEqual([
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
    expect(() => parseFwCheckOutput('fw-explain/v1\nQUERY cart\n')).toThrow(
      'fw check output starts with fw-check/v1: fw-explain/v1',
    );
  });

  it('rejects non-OK results through the OK assertion seam', () => {
    expect(() =>
      fwCheckOkAssertionFact({
        exitCode: 1,
        output:
          'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
      }),
    ).toThrow('fw check expected OK: exitCode=1 status=issues diagnostics=1 coverage=0');
  });
});
