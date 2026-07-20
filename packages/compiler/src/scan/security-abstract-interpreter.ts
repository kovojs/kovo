import type { SecuritySemanticBudgets } from '@kovojs/core/internal/security-operation-ir';

import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerCreateMap,
  compilerCreateSet,
  compilerMapGet,
  compilerMapSet,
  compilerMapSize,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
} from '../compiler-security-intrinsics.js';
import censusDocument from './security-abstract-interpreter-census.v1.json' with { type: 'json' };
import {
  serverMemberProvenanceFromRelation,
  serverProvenanceAtOrBelowAuthorityTop,
  type ServerValueProvenance,
} from './security-provenance-relation.js';

/**
 * Versioned transfer identities for the deliberately finite server analyzer.
 *
 * The JSON census is the reviewed vocabulary and the production analyzer must call
 * `securityAbstractTransfer` at every transfer site. The root census gate compares those call sites
 * with this exact list and the generator productions (SPEC §2, §6.6, and §11.2).
 */
export const securityAbstractTransferIds = [
  'alias.fixed-point',
  'alias.const-preserve',
  'alias.mutable-authority-top',
  'alias.join',
  'binding.static-member',
  'binding.rest',
  'binding.default-join',
  'expression.identifier',
  'expression.implicit-protocol',
  'expression.new',
  'expression.call-scope',
  'expression.call-scoped-key',
  'expression.call-intrinsic-identity',
  'expression.call-response',
  'expression.call-unknown-authority',
  'expression.call-local',
  'expression.binary-join',
  'expression.conditional-join',
  'expression.static-member',
  'expression.fallthrough-foreign',
  'expression.fallthrough-authority',
  'helper.call-map',
  'helper.spread-close',
  'helper.rest-argument-close',
  'helper.extra-argument-close',
  'helper.rest-parameter-close',
  'helper.arguments-close',
  'helper.cycle-close',
  'budget.call-depth-close',
  'budget.node-count-close',
  'budget.operation-count-close',
  'budget.summary-count-close',
  'effect.invoke',
] as const;

export type SecurityAbstractTransferId = (typeof securityAbstractTransferIds)[number];

export interface SecurityAbstractTransferRule {
  readonly id: SecurityAbstractTransferId;
  readonly label?: string;
  readonly production: string;
  readonly semantics: string;
}

export interface SecurityAbstractInterpreterCensus {
  readonly language: {
    readonly defaultSeed: string;
    readonly effectDoors: readonly string[];
    readonly excludedJavaScriptSemantics: readonly string[];
    readonly generatedProgramBudget: number;
    readonly latticeWitnessExecution: string;
    readonly maxAliasDepth: number;
    readonly maxHelperDepth: number;
    readonly maxStatements: number;
    readonly observation: string;
    readonly schema: 'kovo-security-analyzer-language/v1';
    readonly seedAlgorithm: 'mulberry32';
    readonly transferWitnessExecution: string;
  };
  readonly lattice: {
    readonly elements: readonly ServerValueProvenance[];
    readonly top: 'unknown-authority';
  };
  readonly provenanceRelationSchema: 'kovo-security-provenance-relation/v1';
  readonly resourceBounds: SecuritySemanticBudgets;
  readonly schema: 'kovo-security-abstract-interpreter-census/v1';
  readonly transfers: readonly SecurityAbstractTransferRule[];
  readonly version: 1;
}

export const securityAbstractInterpreterCensus =
  censusDocument as SecurityAbstractInterpreterCensus;

interface SecurityAbstractTransferCapture {
  readonly seen: Set<SecurityAbstractTransferId>;
  readonly weakenTransferId?: 'effect.invoke';
}

export interface SecurityAbstractTransferCaptureResult<Result> {
  readonly result: Result;
  readonly witnessedTransfers: readonly SecurityAbstractTransferId[];
}

let activeTransferCapture: SecurityAbstractTransferCapture | undefined;

const transferRules = compilerCreateMap<SecurityAbstractTransferId, SecurityAbstractTransferRule>();
const transferRuleSnapshot = compilerSnapshotDenseArray(
  securityAbstractInterpreterCensus.transfers,
  'Security abstract transfer census',
);
for (let index = 0; index < transferRuleSnapshot.length; index += 1) {
  const rule = transferRuleSnapshot[index]!;
  if (compilerMapGet(transferRules, rule.id) !== undefined) {
    throw new TypeError(`Duplicate security abstract transfer census row: ${rule.id}`);
  }
  compilerMapSet(transferRules, rule.id, rule);
}
let missingTransfer = compilerMapSize(transferRules) !== securityAbstractTransferIds.length;
for (let index = 0; index < securityAbstractTransferIds.length; index += 1) {
  if (compilerMapGet(transferRules, securityAbstractTransferIds[index]!) === undefined) {
    missingTransfer = true;
  }
}
if (missingTransfer) {
  throw new TypeError('Security abstract transfer census differs from the production vocabulary.');
}

export const securityAbstractInterpreterBudgets: SecuritySemanticBudgets = {
  callDepth: securityAbstractInterpreterCensus.resourceBounds.callDepth,
  nodes: securityAbstractInterpreterCensus.resourceBounds.nodes,
  operations: securityAbstractInterpreterCensus.resourceBounds.operations,
  summaries: securityAbstractInterpreterCensus.resourceBounds.summaries,
};

/** Return the reviewed row while making a production transfer site mechanically extractable. */
export function securityAbstractTransfer(
  id: SecurityAbstractTransferId,
): SecurityAbstractTransferRule {
  if (activeTransferCapture !== undefined) compilerSetAdd(activeTransferCapture.seen, id);
  const transfer = compilerMapGet(transferRules, id);
  if (transfer === undefined) {
    throw new TypeError(`Unknown security abstract transfer: ${id}`);
  }
  return transfer;
}

/**
 * Synchronously witness the exact production transfer markers reached by one compiler invocation.
 *
 * Compilation is synchronous, so the module-private scope cannot leak across an await boundary. The
 * optional weakening is a planted falsification canary and is consumed only by explicit transfer
 * functions; ordinary compiler callers never enter this scope (SPEC §11.2).
 */
export function captureSecurityAbstractTransfers<Result>(
  operation: () => Result,
  options: { readonly weakenTransferId?: 'effect.invoke' } = {},
): SecurityAbstractTransferCaptureResult<Result> {
  if (activeTransferCapture !== undefined) {
    throw new TypeError('Security abstract transfer capture cannot be nested.');
  }
  const capture: SecurityAbstractTransferCapture = {
    seen: compilerCreateSet<SecurityAbstractTransferId>(),
    ...(options.weakenTransferId === undefined
      ? {}
      : { weakenTransferId: options.weakenTransferId }),
  };
  activeTransferCapture = capture;
  try {
    const result = operation();
    const witnessedTransfers: SecurityAbstractTransferId[] = [];
    for (let index = 0; index < securityAbstractTransferIds.length; index += 1) {
      const id = securityAbstractTransferIds[index]!;
      if (compilerSetHas(capture.seen, id)) {
        compilerArrayAppend(witnessedTransfers, id, 'Security abstract transfer witnesses');
      }
    }
    return { result, witnessedTransfers };
  } finally {
    activeTransferCapture = undefined;
  }
}

function securityAbstractTransferIsWeakened(id: 'effect.invoke'): boolean {
  return activeTransferCapture?.weakenTransferId === id;
}

export function serverAliasDeclarationTransfer(
  authority: ServerValueProvenance,
  immutable: boolean,
): ServerValueProvenance {
  if (
    immutable ||
    authority === 'foreign-executable' ||
    authority === 'governed-data' ||
    authority === 'unsafe-wire-data'
  ) {
    securityAbstractTransfer('alias.const-preserve');
    return authority;
  }
  if (serverProvenanceAtOrBelowAuthorityTop(authority)) {
    securityAbstractTransfer('alias.mutable-authority-top');
    return 'unknown-authority';
  }
  return 'local';
}

/** Actual effect-invocation transfer, with one scoped planted weakening for the oracle. */
export function securityAbstractEffectInvocationTransfer(): boolean {
  securityAbstractTransfer('effect.invoke');
  return !securityAbstractTransferIsWeakened('effect.invoke');
}

export function serverAliasJoinTransfer(
  previous: ServerValueProvenance | undefined,
  incoming: ServerValueProvenance,
): ServerValueProvenance | undefined {
  securityAbstractTransfer('alias.join');
  if (previous === incoming || previous === 'unknown-authority') return undefined;
  if (previous === undefined) return incoming;
  if (previous === 'governed-data' || incoming === 'governed-data') {
    const other = previous === 'governed-data' ? incoming : previous;
    const joined =
      other === 'foreign-executable'
        ? 'foreign-executable'
        : serverProvenanceAtOrBelowAuthorityTop(other)
          ? 'unknown-authority'
          : 'governed-data';
    return joined === previous ? undefined : joined;
  }
  if (previous === 'unsafe-wire-data' || incoming === 'unsafe-wire-data') {
    const other = previous === 'unsafe-wire-data' ? incoming : previous;
    const joined =
      other === 'foreign-executable'
        ? 'foreign-executable'
        : serverProvenanceAtOrBelowAuthorityTop(other)
          ? 'unknown-authority'
          : 'unsafe-wire-data';
    return joined === previous ? undefined : joined;
  }
  return 'unknown-authority';
}

export function serverBindingDefaultTransfer(
  projected: ServerValueProvenance,
  fallback: ServerValueProvenance,
): ServerValueProvenance {
  securityAbstractTransfer('binding.default-join');
  if (
    serverProvenanceAtOrBelowAuthorityTop(projected) ||
    serverProvenanceAtOrBelowAuthorityTop(fallback)
  ) {
    return projected === fallback ? projected : 'unknown-authority';
  }
  if (projected === 'foreign-executable' || fallback === 'foreign-executable') {
    return 'foreign-executable';
  }
  if (projected === 'governed-data' || fallback === 'governed-data') {
    return 'governed-data';
  }
  if (projected === 'unsafe-wire-data' || fallback === 'unsafe-wire-data') {
    return 'unsafe-wire-data';
  }
  return projected;
}

export function serverBindingProjectionTransfer(
  provenance: ServerValueProvenance,
  member: string,
  rest: boolean,
): ServerValueProvenance {
  if (rest) {
    securityAbstractTransfer('binding.rest');
    if (provenance === 'governed-data') return 'governed-data';
    if (provenance === 'unsafe-wire-data') return 'unsafe-wire-data';
    return serverProvenanceAtOrBelowAuthorityTop(provenance) ? 'unknown-authority' : 'local';
  }
  securityAbstractTransfer('binding.static-member');
  return serverMemberProvenanceFromRelation(provenance, member);
}

export function serverBinaryTransfer(
  left: ServerValueProvenance,
  right: ServerValueProvenance,
): ServerValueProvenance {
  securityAbstractTransfer('expression.binary-join');
  if (serverProvenanceAtOrBelowAuthorityTop(left) || serverProvenanceAtOrBelowAuthorityTop(right)) {
    return 'unknown-authority';
  }
  if (left === 'foreign-executable' || right === 'foreign-executable') {
    return 'foreign-executable';
  }
  if (left === 'governed-data' || right === 'governed-data') return 'governed-data';
  return left === 'unsafe-wire-data' || right === 'unsafe-wire-data' ? 'unsafe-wire-data' : 'local';
}

export function serverConditionalTransfer(
  whenTrue: ServerValueProvenance,
  whenFalse: ServerValueProvenance,
): ServerValueProvenance {
  securityAbstractTransfer('expression.conditional-join');
  if (whenTrue === whenFalse) return whenTrue;
  if (
    serverProvenanceAtOrBelowAuthorityTop(whenTrue) ||
    serverProvenanceAtOrBelowAuthorityTop(whenFalse)
  ) {
    return 'unknown-authority';
  }
  if (whenTrue === 'foreign-executable' || whenFalse === 'foreign-executable') {
    return 'foreign-executable';
  }
  if (whenTrue === 'governed-data' || whenFalse === 'governed-data') {
    return 'governed-data';
  }
  return whenTrue === 'unsafe-wire-data' || whenFalse === 'unsafe-wire-data'
    ? 'unsafe-wire-data'
    : 'local';
}

export function securityAbstractHelperTransfer(
  callable: string,
  authorityInputs: readonly string[],
): string {
  const transfer = securityAbstractTransfer('helper.call-map');
  if (transfer.label !== 'local:{callable}[{authorityInputs}]') {
    throw new TypeError('Security abstract helper transfer label drifted from its reviewed shape.');
  }
  return `local:${callable}[${compilerArrayJoin(authorityInputs, ',')}]`;
}
