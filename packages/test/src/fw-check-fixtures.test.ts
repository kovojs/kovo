import { describe, expect, it } from 'vitest';

import {
  fwCheckCoverageFacts,
  fwCheckDiagnosticFacts,
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
  });

  it('turns warnings and coverage rows into structured facts', () => {
    const output = [
      'fw-check/v1',
      'WARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.',
      'WARN FW311 component=CartBadge query=cart.discount position=undefined Query-dependent DOM position has no update status.',
      'COVERAGE component=OrderHistory query=orderHistory position=undefined status=fragment',
      'WARN UNGUARDED cart/add mutation is reachable without an auth guard.',
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
          position: 'undefined',
          query: 'cart.discount',
        },
        raw: 'WARN FW311 component=CartBadge query=cart.discount position=undefined Query-dependent DOM position has no update status.',
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
    ]);
    expect(fwCheckCoverageFacts(output)).toEqual([
      {
        properties: {
          component: 'OrderHistory',
          position: 'undefined',
          query: 'orderHistory',
          status: 'fragment',
        },
        raw: 'COVERAGE component=OrderHistory query=orderHistory position=undefined status=fragment',
      },
    ]);
  });

  it('rejects unrelated command output', () => {
    expect(() => parseFwCheckOutput('fw-explain/v1\nQUERY cart\n')).toThrow(
      'fw check output starts with fw-check/v1: fw-explain/v1',
    );
  });
});
