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

  it('accepts the exact proved owner-policy fact and rejects a missing binding description', () => {
    const fact = authorizationFact();
    const proved = {
      ...fact,
      correspondence: {
        ...fact.correspondence,
        guard: {
          facts: [
            {
              auth: 'session-user',
              kind: 'owns',
              name: 'owns#document%3Atenant#id#owner_id',
              ownerPolicy: {
                columnName: 'owner_id',
                domain: 'document:tenant',
                emissionSite: 'owner',
                keyColumnName: 'id',
                predicate: fact.correspondence.rls.predicate,
                tableName: 'documents',
              },
              principal: {
                expression: 'session.user.id',
                path: 'user.id',
                source: 'session',
              },
              staticProof: 'framework-derived-owner-column',
            },
          ],
          semantics: 'framework-derived-owner-column',
        },
        decision: {
          checkedModels: 3,
          expectedModels: 3,
          status: 'proved',
        },
        status: 'proved',
      },
    };
    expect(validateKovoExplainInput({ authorizationCorrespondence: [proved] })).toEqual([]);

    const withoutPolicy = structuredClone(proved);
    delete (withoutPolicy.correspondence.guard.facts[0] as { ownerPolicy?: unknown }).ownerPolicy;
    expect(
      validateKovoExplainInput({ authorizationCorrespondence: [withoutPolicy] }),
    ).toContainEqual({
      message: 'ownerPolicy must be an object',
      path: 'authorizationCorrespondence[0].correspondence.guard.facts[0].ownerPolicy',
    });

    const wrongSemantics = structuredClone(proved);
    wrongSemantics.correspondence.guard.semantics = 'none';
    const missingDecision = structuredClone(proved);
    delete (missingDecision.correspondence as { decision?: unknown }).decision;
    const divergentDecision = structuredClone(proved);
    divergentDecision.correspondence.decision.status = 'divergent';
    const mismatchedPolicy = structuredClone(proved);
    mismatchedPolicy.correspondence.guard.facts[0]!.ownerPolicy.tableName = 'invoices';
    const extraOpaqueGuard = structuredClone(proved);
    extraOpaqueGuard.correspondence.guard.facts.push({
      kind: 'opaque',
      name: 'extra-check',
    } as never);
    const ambiguousOwnerName = structuredClone(proved);
    ambiguousOwnerName.correspondence.guard.facts[0]!.name = 'owns:document:tenant:column:id';

    for (const contradictory of [
      wrongSemantics,
      missingDecision,
      divergentDecision,
      mismatchedPolicy,
      extraOpaqueGuard,
      ambiguousOwnerName,
    ]) {
      expect(
        validateKovoExplainInput({ authorizationCorrespondence: [contradictory] }),
      ).toContainEqual({
        message:
          'proved correspondence requires one exact framework-derived owner-column fact, matching owner RLS, and a 3/3 proved decision',
        path: 'authorizationCorrespondence[0].correspondence.status',
      });
    }
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
