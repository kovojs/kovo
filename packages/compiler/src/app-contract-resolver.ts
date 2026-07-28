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

/**
 * Compiler-owned proof for one exact declaration-factory property access.
 *
 * This is deliberately private to the compiler package. Public compile options cannot submit
 * source spans, ownership, or package provenance. The exact Program node, SourceFile snapshot,
 * owner, and physical server package are retained together so none can be recomputed from an
 * unauthenticated caller claim (SPEC.md §5.2).
 */
export interface CompilerOwnedAppContractResolution {
  readonly end: number;
  readonly exportName: AppContractDeclarationFamily;
  readonly node: ts.Node;
  readonly ownerKey: string;
  readonly serverPackageRoot: string;
  readonly sourceFile: ts.SourceFile;
  readonly sourceSnapshot: string;
  readonly start: number;
}

export interface AppContractResolverDiagnostic {
  readonly code: 'D1A101' | 'D1A102' | 'D1A103' | 'D1A104' | 'D1A105' | 'D1A106';
  readonly fileName: string;
  readonly length: number;
  readonly message: string;
  readonly start: number;
}

interface ActiveResolutionSession {
  readonly facts: readonly CompilerOwnedAppContractResolution[];
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
    if (
      !ts.isPropertyAccessExpression(fact.node) ||
      fact.node.getSourceFile() !== fact.sourceFile ||
      fact.node.getStart(fact.sourceFile) !== fact.start ||
      fact.node.getEnd() !== fact.end ||
      fact.node.name.text !== fact.exportName ||
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

export function withCompilerOwnedAppContractResolutions<Value>(
  facts: readonly CompilerOwnedAppContractResolution[],
  operation: () => Value,
): Value {
  const diagnostics = validateCompilerOwnedAppContractResolutions(facts);
  if (diagnostics.length > 0) {
    throw new TypeError(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  const session: ActiveResolutionSession = { facts: Object.freeze([...facts]) };
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
  if (!session || !typescript.isPropertyAccessExpression(expression)) return undefined;
  const fileName = normalizeComponentFileName(sourceFile.fileName);
  const start = expression.getStart(sourceFile);
  const end = expression.getEnd();
  for (const fact of session.facts) {
    if (
      normalizeComponentFileName(fact.sourceFile.fileName) !== fileName ||
      fact.sourceSnapshot !== sourceFile.text ||
      fact.start !== start ||
      fact.end !== end ||
      expression.name.text !== fact.exportName ||
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

function isDeclarationFamily(value: string): value is AppContractDeclarationFamily {
  return (appContractDeclarationFamilies as readonly string[]).includes(value);
}
