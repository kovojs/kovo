import { describe, expect, it } from 'vitest';
import { Project, type Node } from 'ts-morph';

import {
  pnfAllEqOperandPairs,
  pnfExactConjuncts,
  predicatePnf,
  queryOwnerPrivateScopedKeys,
  type ExtractedTable,
  type PredicatePnf,
  type QueryInstanceKeyComparisons,
} from '@kovojs/drizzle/internal/static';

function initializerFor(source: string, name: string): Node {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('predicate.ts', source);
  const declaration = file.getVariableDeclarationOrThrow(name);
  const initializer = declaration.getInitializerOrThrow();
  return initializer;
}

function predicateFromExpression(expression: string): PredicatePnf {
  return predicatePnf(
    initializerFor(
      `
        const users = {
          id: "users.id",
          orgId: "users.orgId",
          status: "users.status",
        };
        const input = { id: "u1", orgId: "o1" };
        const predicate = ${expression};
      `,
      'predicate',
    ),
  );
}

describe('@kovojs/drizzle predicate PNF exhaustiveness', () => {
  it('keeps known exact-conjunct variants working', () => {
    const conjuncts = pnfExactConjuncts(
      predicateFromExpression('and(eq(users.id, input.id), eq(users.orgId, input.orgId))'),
    );

    expect(conjuncts?.map(({ left, right }) => [left.getText(), right.getText()])).toEqual([
      ['users.id', 'input.id'],
      ['users.orgId', 'input.orgId'],
    ]);
  });

  it('keeps known non-exact and operand-pair variants working', () => {
    const orPnf = predicateFromExpression(
      'or(eq(users.id, input.id), eq(users.orgId, input.orgId))',
    );
    const notInPnf = predicateFromExpression('notInArray(users.status, ["deleted", "banned"])');

    expect(pnfExactConjuncts(orPnf)).toBeNull();
    expect(
      pnfAllEqOperandPairs(notInPnf).map(({ left, right }) => [left.getText(), right.getText()]),
    ).toEqual([
      ['users.status', '"deleted"'],
      ['users.status', '"banned"'],
    ]);
  });

  it('throws when a future PredicatePnf variant reaches central dispatchers', () => {
    const future = { kind: 'future-predicate' } as unknown as PredicatePnf;

    expect(() => pnfExactConjuncts(future)).toThrow(
      'Unhandled predicate PNF kind: {"kind":"future-predicate"}',
    );
    expect(() => pnfAllEqOperandPairs(future)).toThrow(
      'Unhandled predicate PNF kind: {"kind":"future-predicate"}',
    );
  });

  it('keeps known owner-scope comparison variants working', () => {
    const tables = new Map<string, ExtractedTable[]>([
      [
        'users',
        [
          {
            annotation: { domain: 'user', key: 'id', name: 'users', owner: 'ownerId' },
            columns: {},
            exported: true,
          },
        ],
      ],
    ]);
    const eq = {
      comparison: {
        left: { tableKey: { key: 'ownerId', tableIdentifier: 'users' } },
        right: { privateKey: 'session:userId' },
      },
      kind: 'eq',
    } as const;
    const comparisons: QueryInstanceKeyComparisons = {
      argCandidates: [],
      instanceKey: [],
      ownerScopePredicates: [
        eq,
        { kind: 'and', nodes: [eq] },
        { kind: 'or', nodes: [eq, eq] },
        { kind: 'non-eq' },
        { kind: 'opaque' },
      ],
    };

    expect(queryOwnerPrivateScopedKeys(comparisons, tables)).toEqual([
      { domain: 'user', privateKey: 'session:userId' },
    ]);
  });

  it('throws when a future owner-scope comparison variant reaches dispatch', () => {
    const comparisons = {
      argCandidates: [],
      instanceKey: [],
      ownerScopePredicates: [{ kind: 'future-comparison' }],
    } as unknown as QueryInstanceKeyComparisons;

    expect(() => queryOwnerPrivateScopedKeys(comparisons, new Map())).toThrow(
      'Unhandled query predicate comparison PNF kind: {"kind":"future-comparison"}',
    );
  });
});
