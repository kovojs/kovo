import type { StructuredAuditObligationFact } from '@kovojs/core/internal/graph';
import { Node, SyntaxKind } from 'ts-morph';

import { runtimeNullRecord, runtimeRegExpTest } from '../runtime-security-intrinsics.js';

const auditReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/u;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

/**
 * Parse the deliberately finite trustedAssign obligation grammar at the scanner boundary.
 * Downstream analyzers consume this typed fact rather than re-reading source text (SPEC §5.2
 * rule 10; §§6.6, 10.3, 11.1).
 *
 * @internal
 */
export function structuredTrustedAssignObligation(
  value: Node | undefined,
): StructuredAuditObligationFact | undefined {
  const obligation = unwrap(value);
  if (!obligation || !Node.isObjectLiteralExpression(obligation)) return undefined;
  const fields = exactProperties(obligation, ['evidence', 'invariant', 'why']);
  if (!fields) return undefined;
  if (literal(fields.invariant) !== 'governed-write.authorized-principal') return undefined;
  const evidence = structuredEvidence(fields.evidence);
  const why = structuredWhy(fields.why);
  if (!evidence || !why) return undefined;
  return {
    evidence,
    invariant: 'governed-write.authorized-principal',
    why,
  };
}

function structuredEvidence(value: Node): StructuredAuditObligationFact['evidence'] | undefined {
  const object = unwrap(value);
  if (!object || !Node.isObjectLiteralExpression(object)) return undefined;
  const fields = exactProperties(object, ['digest', 'kind', 'reference']);
  if (!fields) return undefined;
  const digest = literal(fields.digest);
  const kind = literal(fields.kind);
  const reference = literal(fields.reference);
  if (
    digest === undefined ||
    !runtimeRegExpTest(sha256Pattern, digest) ||
    (kind !== 'policy-review' && kind !== 'test') ||
    reference === undefined ||
    !runtimeRegExpTest(auditReferencePattern, reference)
  ) {
    return undefined;
  }
  return { digest: digest as `sha256:${string}`, kind, reference };
}

function structuredWhy(value: Node): StructuredAuditObligationFact['why'] | undefined {
  const object = unwrap(value);
  if (!object || !Node.isObjectLiteralExpression(object)) return undefined;
  const kindProperty = object.getProperty('kind');
  if (!Node.isPropertyAssignment(kindProperty)) return undefined;
  const kind = literal(kindProperty.getInitializer());
  if (kind === 'guard-chain') {
    const fields = exactProperties(object, ['guard', 'kind']);
    const guard = fields ? literal(fields.guard) : undefined;
    return guard !== undefined && runtimeRegExpTest(auditReferencePattern, guard)
      ? { guard, kind: 'guard-chain' }
      : undefined;
  }
  if (kind === 'policy') {
    const fields = exactProperties(object, ['kind', 'policy']);
    const policy = fields ? literal(fields.policy) : undefined;
    return policy !== undefined && runtimeRegExpTest(auditReferencePattern, policy)
      ? { kind: 'policy', policy }
      : undefined;
  }
  return undefined;
}

function exactProperties<const Name extends string>(
  object: import('ts-morph').ObjectLiteralExpression,
  names: readonly Name[],
): Record<Name, Node> | undefined {
  const properties = object.getProperties();
  if (properties.length !== names.length) return undefined;
  const result = runtimeNullRecord() as Record<Name, Node>;
  for (const property of properties) {
    if (
      !Node.isPropertyAssignment(property) ||
      Node.isComputedPropertyName(property.getNameNode())
    ) {
      return undefined;
    }
    const name = property.getName();
    if (!expectedPropertyName(names, name) || result[name] !== undefined) return undefined;
    const initializer = property.getInitializer();
    if (!initializer) return undefined;
    result[name] = initializer;
  }
  for (let index = 0; index < names.length; index += 1) {
    if (result[names[index]!] === undefined) return undefined;
  }
  return result;
}

function expectedPropertyName<const Name extends string>(
  names: readonly Name[],
  candidate: string,
): candidate is Name {
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] === candidate) return true;
  }
  return false;
}

function literal(value: Node | undefined): string | undefined {
  const node = unwrap(value);
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    ? node.getLiteralText()
    : undefined;
}

function unwrap(value: Node | undefined): Node | undefined {
  let current = value;
  while (
    current &&
    (Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      current.getKind() === SyntaxKind.TypeAssertionExpression)
  ) {
    current = (current as unknown as { getExpression(): Node }).getExpression();
  }
  return current;
}
