import ts from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import { deriveComponentNames } from './component-names.js';
import { deriveRegistryIdentity } from './registry-identities.js';
import { parseSourceFile } from './scan/parse.js';
import { applySourceReplacements, type SourceReplacement } from './shared.js';

const helperModule = '@kovojs/server/internal/wire';
const COMPONENT_IDENTITY = frameworkExport('@kovojs/core', 'component');
const DOMAIN_IDENTITY = frameworkExport('@kovojs/server', 'domain');
const MUTATION_IDENTITY = frameworkExport('@kovojs/server', 'mutation');
const QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');
const TAG_IDENTITY = frameworkExport('@kovojs/server', 'tag');
const TASK_IDENTITY = frameworkExport('@kovojs/server', 'task');
const WEBHOOK_IDENTITY = frameworkExport('@kovojs/server', 'webhook');
const LEGACY_IDENTITIES = [
  COMPONENT_IDENTITY,
  DOMAIN_IDENTITY,
  MUTATION_IDENTITY,
  QUERY_IDENTITY,
  TAG_IDENTITY,
  TASK_IDENTITY,
  WEBHOOK_IDENTITY,
] as const;

const registryAssignmentTable = {
  component: {
    helper: {
      imported: 'assignDerivedComponentName',
      local: '__kovoAssignDerivedComponentName',
    },
    identity: COMPONENT_IDENTITY,
    key(fileName: string, binding: string) {
      return deriveComponentNames(fileName, { localName: binding }).registryKey;
    },
    matches(_sourceFile: ts.SourceFile, call: ts.CallExpression) {
      return isSingleObjectArgument(call);
    },
    requiresExport: false,
  },
  domain: {
    helper: {
      imported: 'assignDerivedDomainKey',
      local: '__kovoAssignDerivedDomainKey',
    },
    identities: [DOMAIN_IDENTITY, TAG_IDENTITY],
    key: registryIdentityKey,
    matches(_sourceFile: ts.SourceFile, call: ts.CallExpression) {
      return call.arguments.length === 0;
    },
    requiresExport: true,
  },
  mutation: {
    helper: {
      imported: 'assignDerivedMutationKey',
      local: '__kovoAssignDerivedMutationKey',
    },
    identity: MUTATION_IDENTITY,
    key: registryIdentityKey,
    matches(_sourceFile: ts.SourceFile, call: ts.CallExpression) {
      return isSingleObjectArgument(call);
    },
    requiresExport: true,
  },
  query: {
    helper: {
      imported: 'assignDerivedQueryKey',
      local: '__kovoAssignDerivedQueryKey',
    },
    identity: QUERY_IDENTITY,
    key: registryIdentityKey,
    matches(_sourceFile: ts.SourceFile, call: ts.CallExpression) {
      return isSingleObjectArgument(call);
    },
    requiresExport: true,
  },
  task: {
    helper: {
      imported: 'assignDerivedTaskKey',
      local: '__kovoAssignDerivedTaskKey',
    },
    identity: TASK_IDENTITY,
    key: registryIdentityKey,
    matches(_sourceFile: ts.SourceFile, call: ts.CallExpression) {
      return isSingleObjectArgument(call);
    },
    requiresExport: true,
  },
  webhook: {
    helper: {
      imported: 'assignDerivedWebhookName',
      local: '__kovoAssignDerivedWebhookName',
    },
    identity: WEBHOOK_IDENTITY,
    key: registryIdentityKey,
    matches(_sourceFile: ts.SourceFile, call: ts.CallExpression) {
      return isPathFirstWebhookCall(call);
    },
    requiresExport: true,
  },
} as const;

type SourceDerivedPrimitive = keyof typeof registryAssignmentTable;

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
    const helper = registryAssignmentTable[assignment.primitive].helper.local;
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

      const primitive = sourceDerivedPrimitive(sourceFile, call);
      if (primitive === null) continue;
      if (registryAssignmentTable[primitive].requiresExport && !exported) continue;
      assignments.push({ binding: declaration.name.text, call, primitive });
    }
  }
  return assignments;
}

function sourceDerivedPrimitive(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): SourceDerivedPrimitive | null {
  for (const primitive of Object.keys(registryAssignmentTable) as SourceDerivedPrimitive[]) {
    const entry = registryAssignmentTable[primitive];
    const identities = 'identities' in entry ? entry.identities : [entry.identity];
    if (
      identities.some((identity) => resolvesTo(sourceFile, call.expression, identity)) &&
      entry.matches(sourceFile, call)
    ) {
      return primitive;
    }
  }

  return null;
}

function resolvesTo(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  identity: FrameworkExportIdentity,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    identity,
    { legacyGlobals: LEGACY_IDENTITIES },
  );
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
    const helper = registryAssignmentTable[primitive].helper;
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
  return registryAssignmentTable[assignment.primitive].key(fileName, assignment.binding);
}

function registryIdentityKey(fileName: string, binding: string): string {
  return deriveRegistryIdentity(fileName, binding).key;
}

function hasExportModifier(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}
