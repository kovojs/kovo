import { describe, expect, it } from 'vitest';

import { validateKovoExplainInput } from './graph.js';

describe('authorization correspondence graph validation', () => {
  it('accepts the generated nested record and rejects a forged live role GUC claim', () => {
    const fact = authorizationFact();
    expect(validateKovoExplainInput({ authorizationCorrespondence: [fact] })).toEqual([]);

    expect(
      validateKovoExplainInput({
        authorizationCorrespondence: [
          {
            ...fact,
            correspondence: {
              ...fact.correspondence,
              roleGuc: { ...fact.correspondence.roleGuc, status: 'live' },
            },
          },
        ],
      }),
    ).toContainEqual({
      message: 'roleGuc.status must be "dead"',
      path: 'authorizationCorrespondence[0].correspondence.roleGuc.status',
    });
  });
});

function authorizationFact() {
  return {
    activation: { source: 'build', status: 'environment-unchecked' },
    correspondence: {
      guard: { facts: [], semantics: 'none' },
      reason: 'No framework-derived ownsRow term is bound to this executable guard.',
      rls: {
        emissionSite: 'owner',
        predicate: `"owner_id" = current_setting('kovo.principal', true)`,
        tableName: 'documents',
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
    surface: { kind: 'query', name: 'document/read' },
    table: { domain: 'document', name: 'documents' },
  };
}
