import ts from 'typescript';

import { deriveComponentNames } from './component-names.js';
import { deriveRegistryIdentity } from './registry-identities.js';
import { parseSourceFile } from './scan/parse.js';
import { applySourceReplacements, type SourceReplacement } from './shared.js';

const helperModule = '@kovojs/server/internal/wire';
const helperImports = {
  component: {
    imported: 'assignDerivedComponentName',
    local: '__kovoAssignDerivedComponentName',
  },
  domain: {
    imported: 'assignDerivedDomainKey',
    local: '__kovoAssignDerivedDomainKey',
  },
  mutation: {
    imported: 'assignDerivedMutationKey',
    local: '__kovoAssignDerivedMutationKey',
  },
  query: {
    imported: 'assignDerivedQueryKey',
    local: '__kovoAssignDerivedQueryKey',
  },
  webhook: {
    imported: 'assignDerivedWebhookName',
    local: '__kovoAssignDerivedWebhookName',
  },
} as const;

type SourceDerivedPrimitive = keyof typeof helperImports;

interface SourceDerivedRegistryAssignment {
  binding: string;
  call: ts.CallExpression;
  primitive: SourceDerivedPrimitive;
}

/** @internal Lower standalone app/server registry declarations before Vite evaluates createApp(). */
export function lowerStandaloneSourceDerivedRegistryDeclarations(options: {
  fileName: string;
  source: string;
}): string | null {
  const sourceFile = parseSourceFile(options.fileName, options.source);
  const assignments = exportedRegistryAssignments(sourceFile);
  if (assignments.length === 0) return null;

  const replacements: SourceReplacement[] = assignments.map((assignment) => {
    const helper = helperImports[assignment.primitive].local;
    const key = derivedAssignmentKey(options.fileName, assignment);
    return {
      end: assignment.call.end,
      replacement: `${helper}(${options.source.slice(
        assignment.call.getStart(sourceFile),
        assignment.call.end,
      )}, ${JSON.stringify(key)})`,
      start: assignment.call.getStart(sourceFile),
    };
  });

  const transformed = applySourceReplacements(options.source, replacements);
  return insertHelperImport(transformed, sourceFile, requiredPrimitives(assignments));
}

function exportedRegistryAssignments(
  sourceFile: ts.SourceFile,
): readonly SourceDerivedRegistryAssignment[] {
  const assignments: SourceDerivedRegistryAssignment[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = hasExportModifier(statement);

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call)) continue;

      const primitive = sourceDerivedPrimitive(call);
      if (primitive === null) continue;
      if (primitive !== 'component' && !exported) continue;
      assignments.push({ binding: declaration.name.text, call, primitive });
    }
  }
  return assignments;
}

function sourceDerivedPrimitive(call: ts.CallExpression): SourceDerivedPrimitive | null {
  if (ts.isIdentifier(call.expression)) {
    if (call.expression.text === 'component' && isSingleObjectArgument(call)) return 'component';
    if (call.expression.text === 'domain' && call.arguments.length === 0) return 'domain';
    if (call.expression.text === 'mutation' && isSingleObjectArgument(call)) return 'mutation';
    if (call.expression.text === 'query' && isSingleObjectArgument(call)) return 'query';
    if (call.expression.text === 'tag' && call.arguments.length === 0) return 'domain';
    if (call.expression.text === 'webhook' && isPathFirstWebhookCall(call)) return 'webhook';
    return null;
  }

  if (
    ts.isPropertyAccessExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression) &&
    call.expression.expression.text === 'query' &&
    call.expression.name.text === 'elevated' &&
    isSingleObjectArgument(call)
  ) {
    return 'query';
  }

  return null;
}

function isSingleObjectArgument(call: ts.CallExpression): boolean {
  return call.arguments.length === 1 && ts.isObjectLiteralExpression(call.arguments[0]!);
}

function isPathFirstWebhookCall(call: ts.CallExpression): boolean {
  return (
    call.arguments.length === 2 &&
    ts.isStringLiteralLike(call.arguments[0]!) &&
    ts.isObjectLiteralExpression(call.arguments[1]!)
  );
}

function insertHelperImport(
  source: string,
  originalSourceFile: ts.SourceFile,
  primitives: ReadonlySet<SourceDerivedPrimitive>,
): string {
  const imported = [...primitives].map((primitive) => {
    const helper = helperImports[primitive];
    return `${helper.imported} as ${helper.local}`;
  });
  const importLine = `import { ${imported.join(', ')} } from '${helperModule}';\n`;
  const importDeclarationEnd =
    originalSourceFile.statements.findLast((statement) => ts.isImportDeclaration(statement))?.end ??
    0;

  if (importDeclarationEnd > 0) {
    return `${source.slice(0, importDeclarationEnd)}\n${importLine}${source.slice(
      importDeclarationEnd,
    )}`;
  }
  return `${importLine}${source}`;
}

function requiredPrimitives(
  assignments: readonly SourceDerivedRegistryAssignment[],
): ReadonlySet<SourceDerivedPrimitive> {
  return new Set(assignments.map((assignment) => assignment.primitive));
}

function derivedAssignmentKey(
  fileName: string,
  assignment: SourceDerivedRegistryAssignment,
): string {
  if (assignment.primitive === 'component') {
    return deriveComponentNames(fileName, { localName: assignment.binding }).registryKey;
  }
  return deriveRegistryIdentity(fileName, assignment.binding).key;
}

function hasExportModifier(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}
