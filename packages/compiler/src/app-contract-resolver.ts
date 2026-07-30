import * as ts from 'typescript';

import {
  frameworkExport,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import { normalizeComponentFileName } from './shared.js';

export const appContractDeclarationFamilies = [
  'endpoint',
  'layout',
  'mutation',
  'query',
  'route',
  'task',
] as const;

export type AppContractDeclarationFamily = (typeof appContractDeclarationFamilies)[number];

export const appContractMemberNames = [
  ...appContractDeclarationFamilies,
  'all',
  'assemble',
  'authenticated',
  'integrateMutation',
  'owns',
  'publicAccess',
  'rateLimit',
  'role',
  'verifiedAccess',
] as const;

export type AppContractMemberName = (typeof appContractMemberNames)[number];

export const appContractAccessGuardMemberNames = [
  'all',
  'authenticated',
  'owns',
  'rateLimit',
  'role',
] as const;

export type AppContractAccessGuardMemberName = (typeof appContractAccessGuardMemberNames)[number];

/**
 * Compiler-owned proof for one exact declaration-factory property access.
 *
 * This is deliberately private to the compiler package. Public compile options cannot submit
 * source spans, ownership, or package provenance. The exact Program node, SourceFile snapshot,
 * owner, and physical server package are retained together so none can be recomputed from an
 * unauthenticated caller claim (SPEC.md §5.2).
 */
export interface CompilerOwnedAppContractResolution {
  /**
   * Optional filename spelling authenticated by the compiler-owned Program for the current
   * consumer. This is not suffix matching: the project adds it only after resolving that exact
   * caller name back to `sourceFile`.
   */
  readonly consumerFileName?: string;
  readonly end: number;
  readonly exportName: AppContractDeclarationFamily;
  readonly node: ts.Node;
  readonly ownerKey: string;
  readonly serverPackageRoot: string;
  readonly sourceFile: ts.SourceFile;
  readonly sourceSnapshot: string;
  readonly start: number;
}

/**
 * Compiler-owned proof for one direct member access on an exact app contract.
 *
 * Unlike declaration-family facts, these facts never turn arbitrary member spelling into a root
 * factory. They let compiler-owned access/posture consumers distinguish `app.publicAccess(...)`
 * and `app.authenticated` from structural lookalikes after the same receiver proof has succeeded.
 */
export interface CompilerOwnedAppContractMemberResolution {
  readonly consumerFileName?: string;
  readonly end: number;
  readonly memberName: AppContractMemberName;
  readonly node: ts.PropertyAccessExpression;
  readonly ownerKey: string;
  readonly serverPackageRoot: string;
  readonly sourceFile: ts.SourceFile;
  readonly sourceSnapshot: string;
  readonly start: number;
}

export interface AppContractResolverDiagnostic {
  readonly code: 'D1A101' | 'D1A102' | 'D1A103' | 'D1A104' | 'D1A105' | 'D1A106' | 'D1A107';
  readonly fileName: string;
  readonly length: number;
  readonly message: string;
  readonly start: number;
}

interface ActiveResolutionSession {
  readonly facts: readonly CompilerOwnedAppContractResolution[];
  readonly members: readonly CompilerOwnedAppContractMemberResolution[];
}

const activeResolutionSessions: ActiveResolutionSession[] = [];

export function validateCompilerOwnedAppContractResolutions(
  facts: readonly CompilerOwnedAppContractResolution[],
): readonly AppContractResolverDiagnostic[] {
  const diagnostics: AppContractResolverDiagnostic[] = [];
  const ordered = [...facts].sort((left, right) => {
    const fileOrder = normalizeComponentFileName(left.sourceFile.fileName).localeCompare(
      normalizeComponentFileName(right.sourceFile.fileName),
    );
    return fileOrder || left.start - right.start || left.end - right.end;
  });

  for (let index = 0; index < ordered.length; index += 1) {
    const fact = ordered[index]!;
    const normalizedFileName = normalizeComponentFileName(fact.sourceFile.fileName);
    const diagnosticFileName = fact.sourceFile.fileName.replaceAll('\\', '/');
    const length = Math.max(1, fact.end - fact.start);
    if (fact.consumerFileName !== undefined && fact.consumerFileName.trim().length === 0) {
      diagnostics.push({
        code: 'D1A107',
        fileName: diagnosticFileName,
        length,
        message:
          'D1A107 compiler-owned app-contract resolution refused a blank authenticated consumer filename.',
        start: fact.start,
      });
      continue;
    }
    if (fact.ownerKey.trim().length === 0) {
      diagnostics.push({
        code: 'D1A105',
        fileName: diagnosticFileName,
        length,
        message: 'D1A105 compiler-owned app-contract resolution refused a blank owner key.',
        start: fact.start,
      });
      continue;
    }
    if (fact.serverPackageRoot.trim().length === 0) {
      diagnostics.push({
        code: 'D1A106',
        fileName: diagnosticFileName,
        length,
        message:
          'D1A106 compiler-owned app-contract resolution refused a blank physical server package root.',
        start: fact.start,
      });
      continue;
    }
    if (fact.sourceSnapshot !== fact.sourceFile.text) {
      diagnostics.push({
        code: 'D1A104',
        fileName: diagnosticFileName,
        length,
        message:
          'D1A104 compiler-owned app-contract resolution refused a stale source snapshot before lowering.',
        start: fact.start,
      });
      continue;
    }
    const previous = ordered[index - 1];
    if (
      previous &&
      normalizeComponentFileName(previous.sourceFile.fileName) === normalizedFileName &&
      previous.start === fact.start &&
      previous.end === fact.end
    ) {
      diagnostics.push({
        code: 'D1A101',
        fileName: diagnosticFileName,
        length,
        message:
          'D1A101 compiler-owned app-contract resolution refused duplicate facts for one exact source span.',
        start: fact.start,
      });
      continue;
    }
    if (
      previous &&
      normalizeComponentFileName(previous.sourceFile.fileName) === normalizedFileName &&
      previous.end > fact.start
    ) {
      diagnostics.push({
        code: 'D1A102',
        fileName: diagnosticFileName,
        length,
        message: 'D1A102 compiler-owned app-contract resolution refused overlapping source spans.',
        start: fact.start,
      });
      continue;
    }
    const exactFactoryNode =
      (ts.isPropertyAccessExpression(fact.node) && fact.node.name.text === fact.exportName) ||
      (ts.isIdentifier(fact.node) && fact.node.text.length > 0);
    if (
      !exactFactoryNode ||
      fact.node.getSourceFile() !== fact.sourceFile ||
      fact.node.getStart(fact.sourceFile) !== fact.start ||
      fact.node.getEnd() !== fact.end ||
      !isDeclarationFamily(fact.exportName)
    ) {
      diagnostics.push({
        code: 'D1A103',
        fileName: diagnosticFileName,
        length,
        message:
          'D1A103 compiler-owned app-contract resolution refused a span that does not identify its exact property-access node.',
        start: fact.start,
      });
    }
  }
  return diagnostics;
}

export function validateCompilerOwnedAppContractMemberResolutions(
  facts: readonly CompilerOwnedAppContractMemberResolution[],
): readonly AppContractResolverDiagnostic[] {
  const diagnostics: AppContractResolverDiagnostic[] = [];
  const ordered = [...facts].sort((left, right) => {
    const fileOrder = normalizeComponentFileName(left.sourceFile.fileName).localeCompare(
      normalizeComponentFileName(right.sourceFile.fileName),
    );
    return fileOrder || left.start - right.start || left.end - right.end;
  });

  for (let index = 0; index < ordered.length; index += 1) {
    const fact = ordered[index]!;
    const normalizedFileName = normalizeComponentFileName(fact.sourceFile.fileName);
    const diagnosticFileName = fact.sourceFile.fileName.replaceAll('\\', '/');
    const length = Math.max(1, fact.end - fact.start);
    const previous = ordered[index - 1];
    const invalid =
      (fact.consumerFileName !== undefined && fact.consumerFileName.trim().length === 0) ||
      fact.ownerKey.trim().length === 0 ||
      fact.serverPackageRoot.trim().length === 0 ||
      fact.sourceSnapshot !== fact.sourceFile.text ||
      fact.node.getSourceFile() !== fact.sourceFile ||
      fact.node.getStart(fact.sourceFile) !== fact.start ||
      fact.node.getEnd() !== fact.end ||
      fact.node.name.text !== fact.memberName ||
      !isAppContractMemberName(fact.memberName);
    if (invalid) {
      diagnostics.push({
        code: 'D1A103',
        fileName: diagnosticFileName,
        length,
        message:
          'D1A103 compiler-owned app-contract member resolution refused an invalid source, owner, package, or exact property-access span.',
        start: fact.start,
      });
      continue;
    }
    if (
      previous &&
      normalizeComponentFileName(previous.sourceFile.fileName) === normalizedFileName &&
      previous.start === fact.start &&
      previous.end === fact.end
    ) {
      diagnostics.push({
        code: 'D1A101',
        fileName: diagnosticFileName,
        length,
        message:
          'D1A101 compiler-owned app-contract member resolution refused duplicate facts for one exact source span.',
        start: fact.start,
      });
      continue;
    }
    if (
      previous &&
      normalizeComponentFileName(previous.sourceFile.fileName) === normalizedFileName &&
      previous.end > fact.start
    ) {
      diagnostics.push({
        code: 'D1A102',
        fileName: diagnosticFileName,
        length,
        message:
          'D1A102 compiler-owned app-contract member resolution refused overlapping source spans.',
        start: fact.start,
      });
    }
  }
  return diagnostics;
}

export function withCompilerOwnedAppContractResolutions<Value>(
  facts: readonly CompilerOwnedAppContractResolution[],
  operation: () => Value,
  members: readonly CompilerOwnedAppContractMemberResolution[] = [],
): Value {
  const diagnostics = [
    ...validateCompilerOwnedAppContractResolutions(facts),
    ...validateCompilerOwnedAppContractMemberResolutions(members),
  ];
  if (diagnostics.length > 0) {
    throw new TypeError(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const session: ActiveResolutionSession = {
    facts: Object.freeze([...facts]),
    members: Object.freeze([...members]),
  };
  activeResolutionSessions.push(session);
  let result!: Value;
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  const removed = activeResolutionSessions.pop();
  if (removed !== session) {
    activeResolutionSessions.length = 0;
    throw new TypeError('Compiler-owned app-contract resolver session stack was corrupted.');
  }
  if (operationFailed) throw operationError;
  return result;
}

/**
 * Consulted only at the six declaration-factory recognition sites. Security-sensitive exports such
 * as publicAccess and trustedHtml deliberately never consult this channel.
 */
export function compilerOwnedAppContractFactoryIdentity(
  typescript: FrameworkIdentityTypeScript,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): FrameworkExportIdentity | undefined {
  const session = activeResolutionSessions[activeResolutionSessions.length - 1];
  if (
    !session ||
    (!typescript.isPropertyAccessExpression(expression) && !typescript.isIdentifier(expression))
  ) {
    return undefined;
  }
  const fileName = normalizeComponentFileName(sourceFile.fileName);
  const start = expression.getStart(sourceFile);
  const end = expression.getEnd();
  const expressionName = typescript.isPropertyAccessExpression(expression)
    ? expression.name.text
    : expression.text;
  for (const fact of session.facts) {
    const factNodeName = typescript.isPropertyAccessExpression(fact.node)
      ? fact.node.name.text
      : typescript.isIdentifier(fact.node)
        ? fact.node.text
        : undefined;
    if (
      ![
        normalizeComponentFileName(fact.sourceFile.fileName),
        ...(fact.consumerFileName === undefined
          ? []
          : [normalizeComponentFileName(fact.consumerFileName)]),
      ].includes(fileName) ||
      fact.sourceSnapshot !== sourceFile.text ||
      fact.start !== start ||
      fact.end !== end ||
      expressionName !== factNodeName ||
      sourceFile.text.slice(start, end) !== fact.sourceSnapshot.slice(fact.start, fact.end)
    ) {
      continue;
    }
    return frameworkExport('@kovojs/server', fact.exportName);
  }
  return undefined;
}

export function compilerOwnedAppContractFactoryEquals(
  typescript: FrameworkIdentityTypeScript,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  identity: FrameworkExportIdentity,
): boolean {
  const resolved = compilerOwnedAppContractFactoryIdentity(typescript, sourceFile, expression);
  return (
    resolved?.module === identity.module &&
    resolved.exportName === identity.exportName &&
    identity.module === '@kovojs/server' &&
    isDeclarationFamily(identity.exportName)
  );
}

export function compilerOwnedAppContractMemberName(
  typescript: FrameworkIdentityTypeScript,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): AppContractMemberName | undefined {
  const session = activeResolutionSessions[activeResolutionSessions.length - 1];
  if (!session || !typescript.isPropertyAccessExpression(expression)) return undefined;
  const fileName = normalizeComponentFileName(sourceFile.fileName);
  const start = expression.getStart(sourceFile);
  const end = expression.getEnd();
  for (const fact of session.members) {
    if (
      ![
        normalizeComponentFileName(fact.sourceFile.fileName),
        ...(fact.consumerFileName === undefined
          ? []
          : [normalizeComponentFileName(fact.consumerFileName)]),
      ].includes(fileName) ||
      fact.sourceSnapshot !== sourceFile.text ||
      fact.start !== start ||
      fact.end !== end ||
      expression.name.text !== fact.memberName ||
      sourceFile.text.slice(start, end) !== fact.sourceSnapshot.slice(fact.start, fact.end)
    ) {
      continue;
    }
    return fact.memberName;
  }
  return undefined;
}

export function compilerOwnedAppContractMemberEquals(
  typescript: FrameworkIdentityTypeScript,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  memberName: AppContractMemberName,
): boolean {
  return compilerOwnedAppContractMemberName(typescript, sourceFile, expression) === memberName;
}

/**
 * Resolve one exact access-algebra member on a compiler-authenticated app contract.
 *
 * This finite projection does not classify a call result by spelling. Consumers must still
 * validate the member's exact call shape and arguments before emitting an access fact
 * (SPEC §6.2.1/§6.6/§10.2).
 */
export function compilerOwnedAppContractAccessGuardMemberName(
  typescript: FrameworkIdentityTypeScript,
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): AppContractAccessGuardMemberName | undefined {
  const memberName = compilerOwnedAppContractMemberName(typescript, sourceFile, expression);
  switch (memberName) {
    case 'all':
    case 'authenticated':
    case 'owns':
    case 'rateLimit':
    case 'role':
      return memberName;
    default:
      return undefined;
  }
}

function isDeclarationFamily(value: string): value is AppContractDeclarationFamily {
  return (appContractDeclarationFamilies as readonly string[]).includes(value);
}

function isAppContractMemberName(value: string): value is AppContractMemberName {
  return (appContractMemberNames as readonly string[]).includes(value);
}
