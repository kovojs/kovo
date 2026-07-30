import ts from 'typescript';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import { compilerOwnedAppContractFactoryEquals } from './app-contract-resolver.js';
import { deriveComponentNames } from './component-names.js';
import {
  agentModelOperationsForBinding,
  agentToolOperationsForBinding,
} from './agent-tool-facts.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateSet,
  compilerJsonStringify,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetForEach,
  compilerStringSlice,
} from './compiler-security-intrinsics.js';
import { deriveRegistryIdentity } from './registry-identities.js';
import { parseComponentModule, type ComponentModuleModel } from './scan/parse.js';
import { applySourceReplacements, type SourceReplacement } from './shared.js';

const helperModule = '@kovojs/server/internal/wire';
const COMPONENT_IDENTITY = frameworkExport('@kovojs/core', 'component');
const AGENT_IDENTITY = frameworkExport('@kovojs/server', 'agent');
const DOMAIN_IDENTITY = frameworkExport('@kovojs/server', 'domain');
const MUTATION_IDENTITY = frameworkExport('@kovojs/server', 'mutation');
const QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');
const TAG_IDENTITY = frameworkExport('@kovojs/server', 'tag');
const TASK_IDENTITY = frameworkExport('@kovojs/server', 'task');
const TOOL_IDENTITY = frameworkExport('@kovojs/server', 'tool');
const WEBHOOK_IDENTITY = frameworkExport('@kovojs/server', 'webhook');
const LEGACY_IDENTITIES = [
  COMPONENT_IDENTITY,
  AGENT_IDENTITY,
  DOMAIN_IDENTITY,
  MUTATION_IDENTITY,
  QUERY_IDENTITY,
  TAG_IDENTITY,
  TASK_IDENTITY,
  TOOL_IDENTITY,
  WEBHOOK_IDENTITY,
] as const;

const registryAssignmentTable = {
  component: {
    helper: {
      imported: 'assignDerivedComponentName',
      local: '__kovoAssignDerivedComponentName',
    },
    identities: [COMPONENT_IDENTITY],
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
    identities: [MUTATION_IDENTITY],
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
    identities: [QUERY_IDENTITY],
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
    identities: [TASK_IDENTITY],
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
    identities: [WEBHOOK_IDENTITY],
    key: registryIdentityKey,
    matches(_sourceFile: ts.SourceFile, call: ts.CallExpression) {
      return isPathFirstWebhookCall(call);
    },
    requiresExport: true,
  },
} as const;

type SourceDerivedPrimitive = keyof typeof registryAssignmentTable;
const SOURCE_DERIVED_PRIMITIVES: readonly SourceDerivedPrimitive[] = [
  'component',
  'domain',
  'mutation',
  'query',
  'task',
  'webhook',
];

interface SourceDerivedRegistryAssignment {
  binding: string;
  call: ts.CallExpression;
  primitive: SourceDerivedPrimitive;
}

/** @internal Lower standalone app/server registry declarations before Vite evaluates createApp(). */
export function lowerStandaloneSourceDerivedRegistryDeclarations(options: {
  fileName: string;
  /** Stable project-relative identity input when `fileName` is an absolute Program path. */
  identityFileName?: string;
  source: string;
}): string | null {
  const model = parseComponentModule(options.fileName, options.source);
  const sourceFile = model.sourceFile;
  const assignments = exportedRegistryAssignments(sourceFile);
  const agentAssignments = agentWitnessAssignments(sourceFile, model);
  const assignmentCount = compilerArrayLength(assignments, 'Source-derived assignments');
  const agentAssignmentCount = compilerArrayLength(agentAssignments, 'Agent witness assignments');
  if (assignmentCount === 0 && agentAssignmentCount === 0) return null;

  const replacements: SourceReplacement[] = [];
  for (let index = 0; index < assignmentCount; index += 1) {
    const assignment = compilerOwnDataValue(
      assignments,
      index,
      'Source-derived assignments',
    ) as SourceDerivedRegistryAssignment;
    const helper = registryAssignmentTable[assignment.primitive].helper.local;
    const key = derivedAssignmentKey(options.identityFileName ?? options.fileName, assignment);
    const encodedKey = compilerJsonStringify(key);
    if (encodedKey === undefined) throw new TypeError('Source-derived key could not be encoded.');
    const start = assignment.call.getStart(sourceFile);
    compilerArrayAppend(
      replacements,
      {
        end: assignment.call.end,
        replacement: `${helper}(${compilerStringSlice(
          options.source,
          start,
          assignment.call.end,
        )}, ${encodedKey})`,
        start,
      },
      'Source-derived replacements',
    );
  }
  for (let index = 0; index < agentAssignmentCount; index += 1) {
    const assignment = compilerOwnDataValue(
      agentAssignments,
      index,
      'Agent witness assignments',
    ) as AgentWitnessAssignment;
    const encodedOperations = compilerJsonStringify(assignment.operations);
    if (encodedOperations === undefined) {
      throw new TypeError('Agent operation closure could not be encoded.');
    }
    const start = assignment.call.getStart(sourceFile);
    compilerArrayAppend(
      replacements,
      {
        end: assignment.call.end,
        replacement: `${assignment.helper}(${compilerStringSlice(
          options.source,
          start,
          assignment.call.end,
        )}, ${encodedOperations})`,
        start,
      },
      'Agent witness replacements',
    );
  }

  const transformed = applySourceReplacements(options.source, replacements);
  return insertHelperImport(
    transformed,
    sourceFile,
    model.moduleImportInsertionOffset,
    requiredPrimitives(assignments),
    agentAssignmentCount === 0
      ? []
      : ['assignDerivedAgentModelOperations', 'assignDerivedAgentToolOperations'],
  );
}

/**
 * @internal Lower non-component registry factories as part of the component source-patch
 * pipeline. Free factories retain their canonical import proof; app-contract member factories
 * additionally require the caller's compiler-owned resolution session. Component naming stays
 * with the component compiler to avoid overlapping the structural JSX patch. Returning
 * replacements (rather than pre-patched source) lets the compiler compose authored diagnostic
 * offsets with the rest of structural lowering (SPEC §4.1/§5.2).
 */
export function componentSourceDerivedRegistryReplacements(options: {
  fileName: string;
  source: string;
}): readonly SourceReplacement[] {
  const model = parseComponentModule(options.fileName, options.source);
  const sourceFile = model.sourceFile;
  const allAssignments = exportedRegistryAssignments(sourceFile);
  const assignments: SourceDerivedRegistryAssignment[] = [];
  for (let index = 0; index < allAssignments.length; index += 1) {
    const assignment = allAssignments[index]!;
    if (assignment.primitive !== 'component') {
      compilerArrayAppend(assignments, assignment, 'Component source-derived registry assignments');
    }
  }
  if (assignments.length === 0) return [];

  const replacements = registryAssignmentReplacements(
    assignments,
    options.fileName,
    options.source,
    sourceFile,
  );
  const primitives = requiredPrimitives(assignments);
  const imported: string[] = [];
  compilerSetForEach(primitives, (primitive) => {
    const helper = registryAssignmentTable[primitive].helper;
    compilerArrayAppend(
      imported,
      `${helper.imported} as ${helper.local}`,
      'Component source-derived helper imports',
    );
  });
  const importLine = `import { ${compilerArrayJoin(imported, ', ')} } from '${helperModule}';\n`;
  const importDeclarationEnd = lastImportDeclarationEnd(sourceFile);
  const insertionOffset =
    importDeclarationEnd > 0 ? importDeclarationEnd : model.moduleImportInsertionOffset;
  compilerArrayAppend(
    replacements,
    {
      end: insertionOffset,
      replacement: importDeclarationEnd > 0 ? `\n${importLine}` : importLine,
      start: insertionOffset,
    },
    'Component source-derived replacements',
  );
  return replacements;
}

/** @internal Compatibility name for the complete standalone server lowering pass. */
export function lowerStandaloneServerSource(source: string, fileName: string): string {
  return lowerStandaloneSourceDerivedRegistryDeclarations({ fileName, source }) ?? source;
}

interface AgentWitnessAssignment {
  call: ts.CallExpression;
  helper: '__kovoAssignDerivedAgentModelOperations' | '__kovoAssignDerivedAgentToolOperations';
  operations: readonly unknown[];
}

function agentWitnessAssignments(
  sourceFile: ts.SourceFile,
  model: ComponentModuleModel,
): readonly AgentWitnessAssignment[] {
  const assignments: AgentWitnessAssignment[] = [];
  const statements = compilerSnapshotStatements(sourceFile);
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (!ts.isVariableStatement(statement)) continue;
    const declarations = statement.declarationList.declarations;
    const declarationCount = compilerArrayLength(declarations, 'Agent witness declarations');
    for (let declarationIndex = 0; declarationIndex < declarationCount; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        declarations,
        declarationIndex,
        'Agent witness declarations',
      ) as ts.VariableDeclaration;
      if (!ts.isIdentifier(declaration.name)) continue;
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call)) continue;
      if (resolvesTo(sourceFile, call.expression, AGENT_IDENTITY)) {
        const operations = agentModelOperationsForBinding(model, declaration.name.text);
        if (operations !== undefined) {
          compilerArrayAppend(
            assignments,
            {
              call,
              helper: '__kovoAssignDerivedAgentModelOperations',
              operations,
            },
            'Agent witness assignments',
          );
        }
      }
      if (resolvesTo(sourceFile, call.expression, TOOL_IDENTITY)) {
        const operations = agentToolOperationsForBinding(model, declaration.name.text);
        if (operations !== undefined) {
          compilerArrayAppend(
            assignments,
            {
              call,
              helper: '__kovoAssignDerivedAgentToolOperations',
              operations,
            },
            'Agent witness assignments',
          );
        }
      }
    }
  }
  return assignments;
}

function compilerSnapshotStatements(sourceFile: ts.SourceFile): readonly ts.Statement[] {
  const result: ts.Statement[] = [];
  const length = compilerArrayLength(sourceFile.statements, 'Agent witness statements');
  for (let index = 0; index < length; index += 1) {
    compilerArrayAppend(
      result,
      compilerOwnDataValue(
        sourceFile.statements,
        index,
        'Agent witness statements',
      ) as ts.Statement,
      'Agent witness statements',
    );
  }
  return result;
}

function exportedRegistryAssignments(
  sourceFile: ts.SourceFile,
  appContractOnly = false,
): readonly SourceDerivedRegistryAssignment[] {
  const assignments: SourceDerivedRegistryAssignment[] = [];
  const statementCount = compilerArrayLength(
    sourceFile.statements,
    'Source-derived source statements',
  );
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Source-derived source statements',
    ) as ts.Statement;
    if (!ts.isVariableStatement(statement)) continue;
    const exported = hasExportModifier(statement);

    const declarations = statement.declarationList.declarations;
    const declarationCount = compilerArrayLength(
      declarations,
      'Source-derived variable declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationCount; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        declarations,
        declarationIndex,
        'Source-derived variable declarations',
      ) as ts.VariableDeclaration;
      if (!ts.isIdentifier(declaration.name)) continue;
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call)) continue;

      const primitive = sourceDerivedPrimitive(sourceFile, call, appContractOnly);
      if (primitive === null) continue;
      if (registryAssignmentTable[primitive].requiresExport && !exported) continue;
      compilerArrayAppend(
        assignments,
        { binding: declaration.name.text, call, primitive },
        'Source-derived assignments',
      );
    }
  }
  return assignments;
}

function sourceDerivedPrimitive(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  appContractOnly: boolean,
): SourceDerivedPrimitive | null {
  const primitiveCount = compilerArrayLength(
    SOURCE_DERIVED_PRIMITIVES,
    'Source-derived primitive list',
  );
  for (let primitiveIndex = 0; primitiveIndex < primitiveCount; primitiveIndex += 1) {
    const primitive = compilerOwnDataValue(
      SOURCE_DERIVED_PRIMITIVES,
      primitiveIndex,
      'Source-derived primitive list',
    ) as SourceDerivedPrimitive;
    const entry = registryAssignmentTable[primitive];
    const identityCount = compilerArrayLength(entry.identities, 'Source-derived identities');
    let identityMatches = false;
    for (let identityIndex = 0; identityIndex < identityCount; identityIndex += 1) {
      const identity = compilerOwnDataValue(
        entry.identities,
        identityIndex,
        'Source-derived identities',
      ) as FrameworkExportIdentity;
      if (
        appContractOnly
          ? compilerOwnedAppContractFactoryEquals(
              ts as FrameworkIdentityTypeScript,
              sourceFile,
              call.expression,
              identity,
            )
          : resolvesTo(sourceFile, call.expression, identity)
      ) {
        identityMatches = true;
        break;
      }
    }
    if (identityMatches && entry.matches(sourceFile, call)) {
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
  return (
    compilerOwnedAppContractFactoryEquals(
      ts as FrameworkIdentityTypeScript,
      sourceFile,
      expression,
      identity,
    ) ||
    expressionResolvesToFrameworkExport(
      ts as FrameworkIdentityTypeScript,
      sourceFile,
      expression,
      identity,
      { legacyGlobals: LEGACY_IDENTITIES },
    )
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
  moduleImportInsertionOffset: number,
  primitives: ReadonlySet<SourceDerivedPrimitive>,
  extraImports: readonly string[] = [],
): string {
  const imported: string[] = [];
  compilerSetForEach(primitives, (primitive) => {
    const helper = registryAssignmentTable[primitive].helper;
    compilerArrayAppend(
      imported,
      `${helper.imported} as ${helper.local}`,
      'Source-derived helper imports',
    );
  });
  for (let index = 0; index < extraImports.length; index += 1) {
    const importedName = extraImports[index]!;
    const localName =
      importedName === 'assignDerivedAgentModelOperations'
        ? '__kovoAssignDerivedAgentModelOperations'
        : '__kovoAssignDerivedAgentToolOperations';
    compilerArrayAppend(
      imported,
      `${importedName} as ${localName}`,
      'Source-derived helper imports',
    );
  }
  const importLine = `import { ${compilerArrayJoin(imported, ', ')} } from '${helperModule}';\n`;
  const importDeclarationEnd = lastImportDeclarationEnd(originalSourceFile);

  if (importDeclarationEnd > 0) {
    return `${compilerStringSlice(source, 0, importDeclarationEnd)}\n${importLine}${compilerStringSlice(
      source,
      importDeclarationEnd,
    )}`;
  }
  return `${compilerStringSlice(source, 0, moduleImportInsertionOffset)}${importLine}${compilerStringSlice(source, moduleImportInsertionOffset)}`;
}

function lastImportDeclarationEnd(sourceFile: ts.SourceFile): number {
  const statements = sourceFile.statements;
  const statementCount = compilerArrayLength(statements, 'Source-derived source statements');
  for (let index = statementCount - 1; index >= 0; index -= 1) {
    const statement = compilerOwnDataValue(
      statements,
      index,
      'Source-derived source statements',
    ) as ts.Statement;
    if (ts.isImportDeclaration(statement)) return statement.end;
  }
  return 0;
}

function registryAssignmentReplacements(
  assignments: readonly SourceDerivedRegistryAssignment[],
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
): SourceReplacement[] {
  const replacements: SourceReplacement[] = [];
  const assignmentCount = compilerArrayLength(assignments, 'Source-derived assignments');
  for (let index = 0; index < assignmentCount; index += 1) {
    const assignment = compilerOwnDataValue(
      assignments,
      index,
      'Source-derived assignments',
    ) as SourceDerivedRegistryAssignment;
    const helper = registryAssignmentTable[assignment.primitive].helper.local;
    const key = derivedAssignmentKey(fileName, assignment);
    const encodedKey = compilerJsonStringify(key);
    if (encodedKey === undefined) throw new TypeError('Source-derived key could not be encoded.');
    const start = assignment.call.getStart(sourceFile);
    compilerArrayAppend(
      replacements,
      {
        end: assignment.call.end,
        replacement: `${helper}(${compilerStringSlice(source, start, assignment.call.end)}, ${encodedKey})`,
        start,
      },
      'Source-derived replacements',
    );
  }
  return replacements;
}

function requiredPrimitives(
  assignments: readonly SourceDerivedRegistryAssignment[],
): ReadonlySet<SourceDerivedPrimitive> {
  const primitives = compilerCreateSet<SourceDerivedPrimitive>();
  const count = compilerArrayLength(assignments, 'Source-derived assignments');
  for (let index = 0; index < count; index += 1) {
    const assignment = compilerOwnDataValue(
      assignments,
      index,
      'Source-derived assignments',
    ) as SourceDerivedRegistryAssignment;
    compilerSetAdd(primitives, assignment.primitive);
  }
  return primitives;
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
  const modifiers = statement.modifiers;
  if (modifiers === undefined) return false;
  const count = compilerArrayLength(modifiers, 'Source-derived declaration modifiers');
  for (let index = 0; index < count; index += 1) {
    const modifier = compilerOwnDataValue(
      modifiers,
      index,
      'Source-derived declaration modifiers',
    ) as ts.ModifierLike;
    if (modifier.kind === ts.SyntaxKind.ExportKeyword) return true;
  }
  return false;
}
