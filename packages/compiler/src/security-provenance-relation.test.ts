import {
  browserSecurityOperationKinds,
  securityOperationDoorForKind,
  serverSecurityOperationKinds,
  type ServerSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';
import { describe, expect, it } from 'vitest';

import {
  browserOperationProvenanceStates,
  browserValueProvenanceStates,
  classifyServerMember,
  provenanceClosureCounterexamples,
  securitySemanticClosedReasons,
  serverAuthorityRelation,
  serverExpressionProvenanceArmCensus,
  serverMemberClassDefinitions,
  serverMemberClasses,
  serverMemberProvenanceFromRelation,
  serverMemberProvenanceTable,
  serverOperationDoorRelation,
  serverOperationProvenanceStates,
  serverProvenanceAtOrBelowAuthorityTop,
  serverValueProvenanceStates,
  type ServerMemberClass,
  type ServerValueProvenance,
} from './scan/security-provenance-relation.js';

describe('finite security provenance relation (SPEC §2/§6.6)', () => {
  it('censuses the current 40 server and 20 browser states against operation kinds', () => {
    expect(serverValueProvenanceStates).toHaveLength(40);
    expect(browserValueProvenanceStates).toHaveLength(20);
    expect(serverOperationProvenanceStates).toEqual(
      serverSecurityOperationKinds.map((kind) => `operation:${kind}`),
    );
    expect(browserOperationProvenanceStates).toEqual(
      browserSecurityOperationKinds.map((kind) => `operation:${kind}`),
    );
    expect(securitySemanticClosedReasons).toHaveLength(8);
    expect(serverExpressionProvenanceArmCensus.compositionalCore).toHaveLength(5);
    expect(serverExpressionProvenanceArmCensus.syntaxDependent).toEqual([
      'object-literal-implicit-protocol-shape',
    ]);
    expect(serverExpressionProvenanceArmCensus.nondeterministicOracle).toMatchObject({
      implementationWalks: [
        'foreign-executable-containment',
        'unsafe-wire-data-containment',
        'authority-containment',
      ],
      outcomes: ['local', 'foreign-executable', 'unsafe-wire-data', 'unknown-authority'],
    });
  });

  it('keeps every finite operation paired with its authoritative C9 door owner', () => {
    for (const kind of serverSecurityOperationKinds) {
      expect(serverOperationDoorRelation[kind], kind).toBe(securityOperationDoorForKind(kind));
    }
  });

  it('proves the quotient classes and all 2,240 relation pairs match the old classifier', () => {
    for (const definition of serverMemberClassDefinitions) {
      expect(classifyServerMember(definition.representative)).toBe(definition.id);
      for (const member of definition.effectiveMembers ?? []) {
        expect(classifyServerMember(member), member).toBe(definition.id);
      }
    }

    let executedPairs = 0;
    for (const state of serverValueProvenanceStates) {
      for (const definition of serverMemberClassDefinitions) {
        for (const member of definition.effectiveMembers ?? []) {
          expect(
            legacyServerMemberProvenance(state, member),
            `${state} × ${definition.id}:${member}`,
          ).toBe(legacyServerMemberProvenance(state, definition.representative));
          expect(serverMemberProvenanceFromRelation(state, member)).toBe(
            serverMemberProvenanceTable[state][definition.id],
          );
        }
        executedPairs += 1;
        expect(
          serverMemberProvenanceTable[state][definition.id],
          `${state} × ${definition.id}`,
        ).toBe(legacyServerMemberProvenance(state, definition.representative));
        expect(
          serverMemberProvenanceFromRelation(state, definition.representative),
          `${state}.${definition.representative}`,
        ).toBe(serverMemberProvenanceTable[state][definition.id]);
      }
    }
    expect(executedPairs).toBe(serverValueProvenanceStates.length * serverMemberClasses.length);
    expect(executedPairs).toBe(2_240);
  });

  it('derives authorityTop from the relation while unknown future states fail closed', () => {
    for (const state of serverValueProvenanceStates) {
      expect(serverProvenanceAtOrBelowAuthorityTop(state), state).toBe(
        legacyServerProvenanceCarriesAuthority(state),
      );
      expect(serverAuthorityRelation[state], state).toBe(
        legacyServerProvenanceCarriesAuthority(state),
      );
    }
    expect(serverProvenanceAtOrBelowAuthorityTop('planted-future-state')).toBe(true);
    expect(serverProvenanceAtOrBelowAuthorityTop(undefined)).toBe(false);
  });

  it('kills a mutated transition cell against the independent legacy relation', () => {
    const mutant = {
      ...serverMemberProvenanceTable,
      context: {
        ...serverMemberProvenanceTable.context,
        'literal:fetch': 'local' as const,
      },
    };
    const mismatches: string[] = [];
    for (const state of serverValueProvenanceStates) {
      for (const definition of serverMemberClassDefinitions) {
        if (
          mutant[state][definition.id] !==
          legacyServerMemberProvenance(state, definition.representative)
        ) {
          mismatches.push(`${state} × ${definition.id}`);
        }
      }
    }
    expect(mismatches).toEqual(['context × literal:fetch']);
  });

  it('computes closure to enrolled doors or the exact closed verdict domain', () => {
    expect(provenanceClosureCounterexamples()).toEqual([]);
  });

  it('reports a least-fixpoint counterexample path when a C9 owner disappears', () => {
    const counterexamples = provenanceClosureCounterexamples({
      doorForOperation: (kind) =>
        kind === 'server.egress.request' ? undefined : serverOperationDoorRelation[kind],
    });
    expect(counterexamples).toContainEqual({
      detail: 'operation server.egress.request has no enrolled C9 door owner',
      from: 'context',
      path: ['literal:fetch'],
      to: 'operation:server.egress.request',
    });
  });
});

function legacyServerMemberProvenance(
  receiver: ServerValueProvenance,
  member: string,
): ServerValueProvenance {
  if (receiver === 'unknown-authority' || receiver === 'foreign-executable') return receiver;
  if (receiver === 'unsafe-wire-data') return receiver;
  if (receiver.startsWith('operation:')) return 'unknown-authority';
  if (receiver === 'context') {
    if (member === 'db' || member === 'readonlyAppDb' || member === 'tx') return 'database';
    if (member === 'headers') return 'headers';
    if (member === 'respond') return 'respond';
    if (member === 'storage') return 'storage';
    if (member === 'request') return 'request';
    if (member === 'fetch') return legacyOperation('server.egress.request');
    if (
      member === 'forwardSetCookie' ||
      member === 'setCookie' ||
      member === 'setSessionRevocationClearSiteData'
    ) {
      return legacyOperation('server.response.cookie');
    }
    if (member === 'fail') return legacyOperation('server.response.outcome');
    if (member === 'signUrl') return legacyOperation('server.storage.read');
    if (member === 'stateKey' || member === 'systemStateKey') return 'scoped-key-call';
    if (
      member === 'invalidate' ||
      member === 'recordChange' ||
      member === 'runMutation' ||
      member === 'runQuery' ||
      member === 'schedule'
    ) {
      return legacyOperation('server.task.compose');
    }
    if (member === 'actAs' || member === 'declareSystemRead' || member === 'declareSystemWrite') {
      return 'scope-call';
    }
    if (member === 'header') return 'safe-call';
    return 'unknown-authority';
  }
  if (receiver === 'request') {
    if (member === 'db' || member === 'readonlyAppDb' || member === 'tx') return 'database';
    if (member === 'cancel' || member === 'schedule') {
      return legacyOperation('server.task.compose');
    }
    return 'unsafe-wire-data';
  }
  if (receiver === 'database') {
    if (member === 'read') return 'database-read-namespace';
    if (member === 'write') return 'database-write-namespace';
    if (member === 'query') return 'database-relational-query-namespace';
    const kind = legacyDatabaseOperationKind(member);
    if (kind) return legacyOperation(kind);
    if (legacyIsRawDatabaseCapabilityMember(member)) return 'unknown-authority';
    return 'database-table-namespace';
  }
  if (receiver === 'database-read-namespace') {
    if (member === 'query') return 'database-relational-query-namespace';
    return legacyDatabaseOperationKind(member) === 'server.database.read'
      ? legacyOperation('server.database.read')
      : 'unknown-authority';
  }
  if (receiver === 'database-write-namespace') {
    return legacyDatabaseOperationKind(member) === 'server.database.write'
      ? legacyOperation('server.database.write')
      : 'unknown-authority';
  }
  if (receiver === 'database-table-namespace') {
    return member === 'all' || member === 'count' || member === 'get' || member === 'values'
      ? legacyOperation('server.database.read')
      : 'unknown-authority';
  }
  if (receiver === 'database-relational-query-namespace') {
    return 'database-relational-table-namespace';
  }
  if (receiver === 'database-relational-table-namespace') {
    return member === 'findFirst' || member === 'findMany'
      ? legacyOperation('server.database.read')
      : 'unknown-authority';
  }
  if (receiver === 'headers') {
    if (member === 'append' || member === 'delete' || member === 'set') {
      return legacyOperation('server.response.header');
    }
    if (member === 'entries' || member === 'get' || member === 'has' || member === 'keys') {
      return 'safe-call';
    }
    return 'unknown-authority';
  }
  if (receiver === 'storage') {
    if (member === 'get' || member === 'stat' || member === 'stream') {
      return legacyOperation('server.storage.read');
    }
    if (member === 'delete' || member === 'put') {
      return legacyOperation('server.storage.write');
    }
    return 'unknown-authority';
  }
  if (receiver === 'respond') {
    if (member === 'file' || member === 'storedFile' || member === 'stream') {
      return legacyOperation('server.response.outcome');
    }
    return 'unknown-authority';
  }
  if (receiver === 'global-object') {
    return member === 'Response' ? 'response-constructor' : 'unknown-authority';
  }
  if (receiver === 'intrinsic-object') {
    return member === 'freeze' || member === 'seal' || member === 'preventExtensions'
      ? 'intrinsic-identity-call'
      : 'local';
  }
  if (receiver === 'response-constructor') {
    if (member === 'error' || member === 'json' || member === 'redirect') {
      return legacyOperation('server.response.raw');
    }
    return 'unknown-authority';
  }
  if (receiver === 'response-outcome') return 'unknown-authority';
  return 'local';
}

function legacyDatabaseOperationKind(method: string): ServerSecurityOperationKind | undefined {
  if (
    method === 'count' ||
    method === 'findFirst' ||
    method === 'findMany' ||
    method === 'read' ||
    method === 'select' ||
    method === 'get' ||
    method === 'all' ||
    method === 'values' ||
    method === 'rawRead'
  ) {
    return 'server.database.read';
  }
  if (
    method === 'batch' ||
    method === 'delete' ||
    method === 'execute' ||
    method === 'insert' ||
    method === 'put' ||
    method === 'run' ||
    method === 'transaction' ||
    method === 'update' ||
    method === 'write'
  ) {
    return 'server.database.write';
  }
  return undefined;
}

function legacyIsRawDatabaseCapabilityMember(member: string): boolean {
  return (
    member === '$client' ||
    member === 'client' ||
    member === 'pglite' ||
    member === 'session' ||
    member === 'sqlite'
  );
}

function legacyOperation(
  kind: ServerSecurityOperationKind,
): `operation:${ServerSecurityOperationKind}` {
  return `operation:${kind}`;
}

function legacyServerProvenanceCarriesAuthority(
  provenance: ServerValueProvenance | undefined,
): boolean {
  return (
    provenance !== undefined &&
    provenance !== 'foreign-executable' &&
    provenance !== 'intrinsic-identity-call' &&
    provenance !== 'intrinsic-object' &&
    provenance !== 'local' &&
    provenance !== 'safe-call' &&
    provenance !== 'unsafe-wire-data'
  );
}
