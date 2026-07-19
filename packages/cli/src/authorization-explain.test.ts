import { describe, expect, it } from 'vitest';

import { parseExplainArgs } from './graph-args.js';
import { kovoExplain } from './graph-output.js';

describe('kovo explain --authorization', () => {
  it('prints deterministic quoted non-correspondence records and one dead-role warning', () => {
    const result = kovoExplain(
      { authorizationCorrespondence: [authorizationFact()] },
      { authorization: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('AUTHORIZATION\n');
    expect(result.output.match(/WARNING role-guc/gu)).toHaveLength(1);
    expect(result.output).toContain('policy=authzPolicy');
    expect(result.output).toContain('activation=environment-unchecked');
    expect(result.output).toContain('status=unproven');
    expect(result.output).toContain('predicate="organization_id = 1\\nFORGED"');
    expect(result.output).not.toContain('\nFORGED\n');
    expect(result.output).toContain(
      'SUMMARY total=1 unproven=1 divergent=0 environmentUnchecked=1',
    );
  });

  it('parses the authorization audit as a standalone explain mode', () => {
    expect(parseExplainArgs(['--authorization', 'graph.json'])).toEqual({
      inputPath: 'graph.json',
      ok: true,
      options: { authorization: true },
    });
  });
});

function authorizationFact() {
  return {
    activation: { source: 'build', status: 'environment-unchecked' },
    correspondence: {
      guard: { facts: [], semantics: 'none' },
      reason: 'authzPolicy lies outside the two-constructor owner correspondence fragment.',
      rls: {
        emissionSite: 'authzPolicy',
        predicate: 'organization_id = 1\nFORGED',
        tableName: 'invoices',
      },
      roleGuc: {
        readers: 0,
        status: 'dead',
        warning:
          'kovo.role is written by the managed transaction frame but no generated RLS predicate reads it; guards.role() is not SQL authorization.',
        writers: 1,
      },
      schema: 'kovo.postgres.authorization-correspondence/v1',
      status: 'unproven',
    },
    schema: 'kovo.postgres.authorization-surface/v1',
    surface: { kind: 'mutation', name: 'invoice/update' },
    table: { domain: 'invoice', name: 'invoices' },
  };
}
