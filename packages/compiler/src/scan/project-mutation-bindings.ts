import * as ts from 'typescript';

import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetDelete,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringEndsWith,
  compilerStringLastIndexOf,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import { deriveMutationKey } from '../mutation-names.js';
import { ensureTypescriptRuntime } from '../ts-api.js';
import type {
  MutationInputFieldFact,
  ProjectMutationBindingFact,
  RegistryMutationInputFacts,
} from '../types.js';
import { mutationInputFactsFromSource } from './mutation-inputs.js';

ensureTypescriptRuntime(ts);

/** Immutable source carrier accepted by the project mutation-provenance scanner. */
export interface ProjectMutationSourceFile {
  readonly fileName: string;
  readonly source: string;
}

/** Typed facts consumed by mutation-form lowering after source parsing (SPEC §5.2 rule 10). */
export interface ProjectMutationRegistryFacts {
  readonly mutationBindings: readonly ProjectMutationBindingFact[];
  readonly mutationInputs: RegistryMutationInputFacts;
}

interface ProjectModule {
  readonly canonicalFileName: string;
  readonly fileName: string;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
  readonly valid: boolean;
}

interface ExactNamedImport {
  readonly importedName: string;
  readonly localName: string;
  readonly moduleSpecifier: string;
}

interface LocalExportRoute {
  readonly kind: 'local';
}

interface InvalidExportRoute {
  readonly kind: 'invalid';
}

interface RelativeExportRoute {
  readonly kind: 'relative';
  readonly moduleSpecifier: string;
}

type ExportRoute = InvalidExportRoute | LocalExportRoute | RelativeExportRoute;

interface MutationProof {
  readonly fields: readonly MutationInputFieldFact[];
  readonly identity: string;
  readonly key: string;
  readonly source: ProjectMutationBindingFact['source'];
}

interface CandidateBinding {
  readonly fileName: string;
  readonly localName: string;
  readonly proof: MutationProof;
}

interface ProjectIndex {
  readonly modules: ReadonlyMap<string, ProjectModule | null>;
  readonly mutationCache: Map<string, MutationProof>;
  readonly mutationResolving: Set<string>;
  readonly authFactoryCache: Map<string, true>;
  readonly authFactoryResolving: Set<string>;
}

const BETTER_AUTH_BINDING_CONSTRUCTORS = new Set([
  'createBetterAuthPostgresBindingsFromEnvironment',
  'createBetterAuthSqliteBindingsFromEnvironment',
]);

const BETTER_AUTH_SIGN_IN_FIELDS: readonly MutationInputFieldFact[] = [
  {
    coercion: 'string',
    defaulted: false,
    name: 'email',
    optional: false,
    provenance: 'registry',
    required: true,
  },
  {
    coercion: 'string',
    defaulted: false,
    name: 'next',
    optional: true,
    provenance: 'registry',
    required: false,
  },
  {
    coercion: 'string',
    defaulted: false,
    name: 'password',
    optional: false,
    provenance: 'registry',
    required: true,
  },
];

/**
 * Derive cross-module mutation-form authority from one pinned project source snapshot.
 *
 * Only direct, non-aliased named imports and named re-exports are followed. The terminal must be
 * either an exact `@kovojs/server` `mutation()` declaration or an exact projection from Kovo's
 * generated Better Auth environment binding constructor. Missing files, duplicate paths/exports,
 * cycles, namespace/computed access, aliases, structural lookalikes, and visible mutation all
 * produce no fact, so the existing KV242 form gate remains closed.
 */
export function projectMutationRegistryFactsFromFiles(
  files: readonly ProjectMutationSourceFile[],
): ProjectMutationRegistryFacts {
  const modules = indexProjectModules(files);
  const project: ProjectIndex = {
    authFactoryCache: compilerCreateMap<string, true>(),
    authFactoryResolving: compilerCreateSet<string>(),
    modules,
    mutationCache: compilerCreateMap<string, MutationProof>(),
    mutationResolving: compilerCreateSet<string>(),
  };
  const candidates: CandidateBinding[] = [];

  const sourceFiles = compilerSnapshotDenseArray(files, 'Project mutation source files');
  for (let fileIndex = 0; fileIndex < sourceFiles.length; fileIndex += 1) {
    const rawFile = sourceFiles[fileIndex]!;
    const rawFileName = compilerOwnDataValue(
      rawFile,
      'fileName',
      `Project mutation source files[${fileIndex}]`,
    );
    if (typeof rawFileName !== 'string') continue;
    const module = compilerMapGet(modules, canonicalProjectFileName(rawFileName));
    if (!module || !module.valid || module.fileName !== rawFileName) continue;

    const imports = exactRelativeNamedImports(module);
    for (let importIndex = 0; importIndex < imports.length; importIndex += 1) {
      const imported = imports[importIndex]!;
      if (bindingHasVisibleMutation(module.sourceFile, imported.localName)) continue;
      const target = resolveRelativeProjectModule(project, module, imported.moduleSpecifier);
      if (!target) continue;
      const proof = resolveMutationExport(project, target, imported.importedName);
      if (!proof) continue;
      compilerArrayAppend(
        candidates,
        { fileName: module.fileName, localName: imported.localName, proof },
        'Project mutation binding candidates',
      );
    }
  }

  return unambiguousProjectFacts(candidates);
}

function indexProjectModules(
  files: readonly ProjectMutationSourceFile[],
): ReadonlyMap<string, ProjectModule | null> {
  const modules = compilerCreateMap<string, ProjectModule | null>();
  const sourceFiles = compilerSnapshotDenseArray(files, 'Project mutation source files');
  for (let index = 0; index < sourceFiles.length; index += 1) {
    const rawFile = sourceFiles[index]!;
    const fileName = compilerOwnDataValue(
      rawFile,
      'fileName',
      `Project mutation source files[${index}]`,
    );
    const source = compilerOwnDataValue(
      rawFile,
      'source',
      `Project mutation source files[${index}]`,
    );
    if (typeof fileName !== 'string' || typeof source !== 'string') continue;
    const canonicalFileName = canonicalProjectFileName(fileName);
    const existing = compilerMapGet(modules, canonicalFileName);
    if (existing !== undefined) {
      compilerMapSet(modules, canonicalFileName, null);
      continue;
    }
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      sourceScriptKind(fileName),
    );
    const parseDiagnostics = (
      sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
    ).parseDiagnostics;
    compilerMapSet(modules, canonicalFileName, {
      canonicalFileName,
      fileName,
      source,
      sourceFile,
      valid: parseDiagnostics === undefined || parseDiagnostics.length === 0,
    });
  }
  return modules;
}

function exactRelativeNamedImports(module: ProjectModule): ExactNamedImport[] {
  const result: ExactNamedImport[] = [];
  const statements = module.sourceFile.statements;
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!isRelativeModuleSpecifier(moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    const elements = clause.namedBindings.elements;
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex]!;
      if (element.isTypeOnly || element.propertyName !== undefined) continue;
      const localName = element.name.text;
      if (topLevelValueBindingCount(module.sourceFile, localName) !== 1) continue;
      const exact = exactNamedImport(module.sourceFile, localName);
      if (!exact || exact.importedName !== localName) continue;
      compilerArrayAppend(result, exact, 'Exact relative named imports');
    }
  }
  return result;
}

function exactNamedImport(sourceFile: ts.SourceFile, localName: string): ExactNamedImport | null {
  let match: ExactNamedImport | null = null;
  let count = 0;
  const statements = sourceFile.statements;
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    const elements = clause.namedBindings.elements;
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
      const element = elements[elementIndex]!;
      if (element.isTypeOnly || element.name.text !== localName) continue;
      count += 1;
      if (element.propertyName !== undefined) continue;
      match = {
        importedName: element.name.text,
        localName: element.name.text,
        moduleSpecifier: statement.moduleSpecifier.text,
      };
    }
  }
  return count === 1 ? match : null;
}

function resolveMutationExport(
  project: ProjectIndex,
  module: ProjectModule,
  exportName: string,
): MutationProof | null {
  const token = `${module.canonicalFileName}#${exportName}`;
  const cached = compilerMapGet(project.mutationCache, token);
  if (cached !== undefined) return cached;
  if (compilerSetHas(project.mutationResolving, token)) return null;
  compilerSetAdd(project.mutationResolving, token);
  try {
    const routes = exportRoutes(module.sourceFile, exportName);
    if (routes.length !== 1) return null;
    const route = routes[0]!;
    if (route.kind === 'invalid') return null;
    let proof: MutationProof | null;
    if (route.kind === 'relative') {
      const target = resolveRelativeProjectModule(project, module, route.moduleSpecifier);
      proof = target ? resolveMutationExport(project, target, exportName) : null;
    } else {
      proof = resolveLocalMutation(project, module, exportName);
    }
    if (proof) compilerMapSet(project.mutationCache, token, proof);
    return proof;
  } finally {
    compilerSetDelete(project.mutationResolving, token);
  }
}

function resolveLocalMutation(
  project: ProjectIndex,
  module: ProjectModule,
  localName: string,
): MutationProof | null {
  const direct = directKovoMutationProof(module, localName);
  if (direct) return direct;
  const auth = generatedBetterAuthProjectionProof(project, module, localName);
  if (auth) return auth;

  const imported = exactNamedImport(module.sourceFile, localName);
  if (
    !imported ||
    imported.importedName !== localName ||
    !isRelativeModuleSpecifier(imported.moduleSpecifier) ||
    topLevelValueBindingCount(module.sourceFile, localName) !== 1 ||
    bindingHasVisibleMutation(module.sourceFile, localName)
  ) {
    return null;
  }
  const target = resolveRelativeProjectModule(project, module, imported.moduleSpecifier);
  return target ? resolveMutationExport(project, target, localName) : null;
}

function directKovoMutationProof(module: ProjectModule, localName: string): MutationProof | null {
  const declaration = uniqueTopLevelVariable(module.sourceFile, localName);
  if (!declaration || !variableDeclarationIsConst(declaration)) return null;
  if (topLevelValueBindingCount(module.sourceFile, localName) !== 1) return null;
  if (bindingHasVisibleMutation(module.sourceFile, localName)) return null;
  const initializer = unwrapExpression(declaration.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  const callee = unwrapExpression(initializer.expression);
  if (!callee || !ts.isIdentifier(callee) || callee.text !== 'mutation') return null;
  if (!hasExactPackageImport(module, 'mutation', '@kovojs/server')) return null;
  if (bindingHasVisibleMutation(module.sourceFile, 'mutation')) return null;

  let key: string;
  let definition: ts.Expression | undefined;
  if (initializer.arguments.length === 1) {
    key = deriveMutationKey(module.fileName, localName);
    definition = initializer.arguments[0];
  } else if (
    initializer.arguments.length === 2 &&
    ts.isStringLiteralLike(initializer.arguments[0]!)
  ) {
    key = initializer.arguments[0]!.text;
    definition = initializer.arguments[1];
  } else {
    return null;
  }
  const definitionExpression = unwrapExpression(definition);
  if (!definitionExpression || !ts.isObjectLiteralExpression(definitionExpression)) return null;

  const localInput = compilerMapGet(
    mutationInputFactsFromSource(module.fileName, module.source),
    localName,
  );
  const fields = localInput?.key === key ? registryInputFields(localInput.fields) : [];
  return {
    fields,
    identity: `${module.canonicalFileName}#${localName}`,
    key,
    source: { exportName: localName, fileName: module.fileName, kind: 'kovo-mutation' },
  };
}

function generatedBetterAuthProjectionProof(
  project: ProjectIndex,
  module: ProjectModule,
  localName: string,
): MutationProof | null {
  const declaration = uniqueTopLevelVariable(module.sourceFile, localName);
  if (!declaration || !variableDeclarationIsConst(declaration)) return null;
  if (topLevelValueBindingCount(module.sourceFile, localName) !== 1) return null;
  if (bindingHasVisibleMutation(module.sourceFile, localName)) return null;
  const initializer = unwrapExpression(declaration.initializer);
  if (!initializer || !ts.isPropertyAccessExpression(initializer)) return null;
  const receiver = unwrapExpression(initializer.expression);
  if (!receiver || !ts.isIdentifier(receiver)) return null;
  const member = initializer.name.text;
  if (member !== 'signIn' && member !== 'signOut') return null;

  const bindingName = receiver.text;
  const bindingDeclaration = uniqueTopLevelVariable(module.sourceFile, bindingName);
  if (!bindingDeclaration || !variableDeclarationIsConst(bindingDeclaration)) return null;
  if (topLevelValueBindingCount(module.sourceFile, bindingName) !== 1) return null;
  if (bindingHasVisibleMutation(module.sourceFile, bindingName)) return null;
  const bindingInitializer = unwrapExpression(bindingDeclaration.initializer);
  if (!bindingInitializer || !ts.isCallExpression(bindingInitializer)) return null;
  const bindingCallee = unwrapExpression(bindingInitializer.expression);
  if (!bindingCallee || !ts.isIdentifier(bindingCallee)) return null;
  if (bindingInitializer.arguments.length !== 1) return null;
  const options = unwrapExpression(bindingInitializer.arguments[0]);
  if (!options || !ts.isObjectLiteralExpression(options)) return null;

  const factoryName = bindingCallee.text;
  const factoryImport = exactNamedImport(module.sourceFile, factoryName);
  if (
    !factoryImport ||
    factoryImport.importedName !== factoryName ||
    !isRelativeModuleSpecifier(factoryImport.moduleSpecifier) ||
    topLevelValueBindingCount(module.sourceFile, factoryName) !== 1 ||
    bindingHasVisibleMutation(module.sourceFile, factoryName)
  ) {
    return null;
  }
  const factoryModule = resolveRelativeProjectModule(
    project,
    module,
    factoryImport.moduleSpecifier,
  );
  if (!factoryModule || !resolveGeneratedAuthFactory(project, factoryModule, factoryName)) {
    return null;
  }

  const signIn = member === 'signIn';
  return {
    fields: signIn ? BETTER_AUTH_SIGN_IN_FIELDS : [],
    identity: `${module.canonicalFileName}#${localName}`,
    key: signIn ? 'auth/sign-in' : 'auth/sign-out',
    source: {
      exportName: localName,
      fileName: module.fileName,
      kind: signIn ? 'better-auth-sign-in' : 'better-auth-sign-out',
    },
  };
}

function resolveGeneratedAuthFactory(
  project: ProjectIndex,
  module: ProjectModule,
  exportName: string,
): boolean {
  const token = `${module.canonicalFileName}#${exportName}`;
  if (compilerMapGet(project.authFactoryCache, token) === true) return true;
  if (compilerSetHas(project.authFactoryResolving, token)) return false;
  compilerSetAdd(project.authFactoryResolving, token);
  try {
    const routes = exportRoutes(module.sourceFile, exportName);
    if (routes.length !== 1) return false;
    const route = routes[0]!;
    if (route.kind === 'invalid') return false;
    let proven = false;
    if (route.kind === 'relative') {
      const target = resolveRelativeProjectModule(project, module, route.moduleSpecifier);
      proven = target ? resolveGeneratedAuthFactory(project, target, exportName) : false;
    } else {
      proven = directGeneratedAuthFactory(module, exportName);
      if (!proven) {
        const imported = exactNamedImport(module.sourceFile, exportName);
        if (
          imported?.importedName === exportName &&
          isRelativeModuleSpecifier(imported.moduleSpecifier) &&
          topLevelValueBindingCount(module.sourceFile, exportName) === 1 &&
          !bindingHasVisibleMutation(module.sourceFile, exportName)
        ) {
          const target = resolveRelativeProjectModule(project, module, imported.moduleSpecifier);
          proven = target ? resolveGeneratedAuthFactory(project, target, exportName) : false;
        }
      }
    }
    if (proven) compilerMapSet(project.authFactoryCache, token, true);
    return proven;
  } finally {
    compilerSetDelete(project.authFactoryResolving, token);
  }
}

function directGeneratedAuthFactory(module: ProjectModule, name: string): boolean {
  const declaration = uniqueTopLevelFunction(module.sourceFile, name);
  if (!declaration?.body || topLevelValueBindingCount(module.sourceFile, name) !== 1) return false;
  if (bindingHasVisibleMutation(module.sourceFile, name)) return false;
  if (declaration.body.statements.length !== 1) return false;
  const statement = declaration.body.statements[0]!;
  if (!ts.isReturnStatement(statement)) return false;
  const returned = unwrapExpression(statement.expression);
  if (!returned || !ts.isCallExpression(returned)) return false;
  const callee = unwrapExpression(returned.expression);
  if (!callee || !ts.isIdentifier(callee)) return false;
  if (!BETTER_AUTH_BINDING_CONSTRUCTORS.has(callee.text)) return false;
  if (returned.arguments.length !== 1) return false;
  const options = unwrapExpression(returned.arguments[0]);
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return (
    hasExactPackageImport(module, callee.text, '@kovojs/better-auth') &&
    !bindingHasVisibleMutation(module.sourceFile, callee.text)
  );
}

function hasExactPackageImport(
  module: ProjectModule,
  localName: string,
  moduleSpecifier: string,
): boolean {
  const imported = exactNamedImport(module.sourceFile, localName);
  return (
    imported?.importedName === localName &&
    imported.moduleSpecifier === moduleSpecifier &&
    topLevelValueBindingCount(module.sourceFile, localName) === 1
  );
}

function exportRoutes(sourceFile: ts.SourceFile, exportName: string): ExportRoute[] {
  const routes: ExportRoute[] = [];
  const statements = sourceFile.statements;
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (hasExportModifier(statement)) {
      if (ts.isVariableStatement(statement)) {
        const declarations = statement.declarationList.declarations;
        for (let index = 0; index < declarations.length; index += 1) {
          const declaration = declarations[index]!;
          if (ts.isIdentifier(declaration.name) && declaration.name.text === exportName) {
            compilerArrayAppend(routes, { kind: 'local' }, 'Mutation export routes');
          }
        }
      } else if (ts.isFunctionDeclaration(statement) && statement.name?.text === exportName) {
        compilerArrayAppend(routes, { kind: 'local' }, 'Mutation export routes');
      }
    }
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    const elements = statement.exportClause.elements;
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (element.isTypeOnly || element.name.text !== exportName) continue;
      if (element.propertyName !== undefined) {
        compilerArrayAppend(routes, { kind: 'invalid' }, 'Mutation export routes');
        continue;
      }
      if (statement.moduleSpecifier === undefined) {
        compilerArrayAppend(routes, { kind: 'local' }, 'Mutation export routes');
      } else if (
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        isRelativeModuleSpecifier(statement.moduleSpecifier.text)
      ) {
        compilerArrayAppend(
          routes,
          { kind: 'relative', moduleSpecifier: statement.moduleSpecifier.text },
          'Mutation export routes',
        );
      } else {
        compilerArrayAppend(routes, { kind: 'invalid' }, 'Mutation export routes');
      }
    }
  }
  return routes;
}

function uniqueTopLevelVariable(
  sourceFile: ts.SourceFile,
  name: string,
): ts.VariableDeclaration | null {
  let match: ts.VariableDeclaration | null = null;
  let count = 0;
  const statements = sourceFile.statements;
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (!ts.isVariableStatement(statement)) continue;
    const declarations = statement.declarationList.declarations;
    for (let index = 0; index < declarations.length; index += 1) {
      const declaration = declarations[index]!;
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      count += 1;
      match = declaration;
    }
  }
  return count === 1 ? match : null;
}

function uniqueTopLevelFunction(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | null {
  let match: ts.FunctionDeclaration | null = null;
  let count = 0;
  const statements = sourceFile.statements;
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== name) continue;
    count += 1;
    match = statement;
  }
  return count === 1 ? match : null;
}

function topLevelValueBindingCount(sourceFile: ts.SourceFile, name: string): number {
  let count = 0;
  const statements = sourceFile.statements;
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name?.text === name) count += 1;
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) count += 1;
      if (bindings && ts.isNamedImports(bindings)) {
        for (let index = 0; index < bindings.elements.length; index += 1) {
          const element = bindings.elements[index]!;
          if (!element.isTypeOnly && element.name.text === name) count += 1;
        }
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList.declarations;
      for (let index = 0; index < declarations.length; index += 1) {
        if (bindingNameContains(declarations[index]!.name, name)) count += 1;
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      count += 1;
    }
  }
  return count;
}

function bindingNameContains(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  const elements = binding.elements;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (!ts.isBindingElement(element)) continue;
    if (bindingNameContains(element.name, name)) return true;
  }
  return false;
}

function variableDeclarationIsConst(declaration: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

function hasExportModifier(
  node: ts.Node & { readonly modifiers?: ts.NodeArray<ts.ModifierLike> },
): boolean {
  const modifiers = node.modifiers;
  if (!modifiers) return false;
  for (let index = 0; index < modifiers.length; index += 1) {
    if (modifiers[index]!.kind === ts.SyntaxKind.ExportKeyword) return true;
  }
  return false;
}

function bindingHasVisibleMutation(sourceFile: ts.SourceFile, bindingName: string): boolean {
  let mutated = false;
  const visit = (node: ts.Node): void => {
    if (mutated) return;
    if (
      ts.isBinaryExpression(node) &&
      assignmentOperator(node.operatorToken.kind) &&
      assignmentTargetContainsBinding(node.left, bindingName)
    ) {
      mutated = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      expressionRootIsBinding(node.operand, bindingName)
    ) {
      mutated = true;
      return;
    }
    if (ts.isDeleteExpression(node) && expressionRootIsBinding(node.expression, bindingName)) {
      mutated = true;
      return;
    }
    if (ts.isCallExpression(node) && knownMutatorTargetsBinding(node, bindingName)) {
      mutated = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return mutated;
}

function assignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function assignmentTargetContainsBinding(target: ts.Expression, bindingName: string): boolean {
  const expression = unwrapExpression(target);
  if (!expression) return false;
  if (expressionRootIsBinding(expression, bindingName)) return true;
  if (ts.isArrayLiteralExpression(expression)) {
    for (let index = 0; index < expression.elements.length; index += 1) {
      const element = expression.elements[index]!;
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isSpreadElement(element)) {
        if (assignmentTargetContainsBinding(element.expression, bindingName)) return true;
      } else if (assignmentTargetContainsBinding(element, bindingName)) {
        return true;
      }
    }
  }
  if (ts.isObjectLiteralExpression(expression)) {
    for (let index = 0; index < expression.properties.length; index += 1) {
      const property = expression.properties[index]!;
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === bindingName) {
        return true;
      }
      if (ts.isPropertyAssignment(property) && ts.isExpression(property.initializer)) {
        if (assignmentTargetContainsBinding(property.initializer, bindingName)) return true;
      }
      if (ts.isSpreadAssignment(property)) {
        if (assignmentTargetContainsBinding(property.expression, bindingName)) return true;
      }
    }
  }
  return false;
}

function expressionRootIsBinding(expression: ts.Expression, bindingName: string): boolean {
  const unwrapped = unwrapExpression(expression);
  if (!unwrapped) return false;
  if (ts.isIdentifier(unwrapped)) return unwrapped.text === bindingName;
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return expressionRootIsBinding(unwrapped.expression, bindingName);
  }
  return false;
}

function knownMutatorTargetsBinding(call: ts.CallExpression, bindingName: string): boolean {
  const first = call.arguments[0];
  if (!first || !expressionRootIsBinding(first, bindingName)) return false;
  const callee = unwrapExpression(call.expression);
  if (!callee) return false;
  const member = staticMemberAccess(callee);
  if (!member) return false;
  if (member.owner === 'Object') {
    return (
      member.name === 'assign' ||
      member.name === 'defineProperties' ||
      member.name === 'defineProperty' ||
      member.name === 'setPrototypeOf'
    );
  }
  return (
    member.owner === 'Reflect' &&
    (member.name === 'defineProperty' ||
      member.name === 'deleteProperty' ||
      member.name === 'set' ||
      member.name === 'setPrototypeOf')
  );
}

function staticMemberAccess(
  expression: ts.Expression,
): { readonly name: string; readonly owner: string } | null {
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return { name: expression.name.text, owner: expression.expression.text };
  }
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return { name: expression.argumentExpression.text, owner: expression.expression.text };
  }
  return null;
}

function resolveRelativeProjectModule(
  project: ProjectIndex,
  importer: ProjectModule,
  moduleSpecifier: string,
): ProjectModule | null {
  if (!isRelativeModuleSpecifier(moduleSpecifier)) return null;
  const base = normalizeProjectPath(
    `${projectDirname(importer.canonicalFileName)}/${moduleSpecifier}`,
  );
  const candidates = sourceFileCandidates(base);
  let match: ProjectModule | null = null;
  let count = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = compilerMapGet(project.modules, candidates[index]!);
    if (!candidate) continue;
    count += 1;
    match = candidate;
  }
  return count === 1 ? match : null;
}

function sourceFileCandidates(base: string): string[] {
  const result: string[] = [];
  const seen = compilerCreateSet<string>();
  const append = (value: string): void => {
    const normalized = normalizeProjectPath(value);
    if (compilerSetHas(seen, normalized)) return;
    compilerSetAdd(seen, normalized);
    compilerArrayAppend(result, normalized, 'Project source-file candidates');
  };

  const extension = projectSourceExtension(base);
  if (extension !== null) {
    const withoutExtension = compilerStringSlice(base, 0, -extension.length);
    if (extension === '.js') {
      append(`${withoutExtension}.ts`);
      append(`${withoutExtension}.tsx`);
    } else if (extension === '.jsx') {
      append(`${withoutExtension}.tsx`);
      append(`${withoutExtension}.ts`);
    } else if (extension === '.mjs') {
      append(`${withoutExtension}.mts`);
      append(`${withoutExtension}.mtsx`);
    } else if (extension === '.cjs') {
      append(`${withoutExtension}.cts`);
      append(`${withoutExtension}.ctsx`);
    }
    append(base);
    return result;
  }

  const extensions = ['.ts', '.tsx', '.mts', '.mtsx', '.cts', '.ctsx', '.js', '.jsx'];
  for (let index = 0; index < extensions.length; index += 1) {
    append(`${base}${extensions[index]!}`);
  }
  for (let index = 0; index < extensions.length; index += 1) {
    append(`${base}/index${extensions[index]!}`);
  }
  return result;
}

function projectSourceExtension(fileName: string): string | null {
  const extensions = [
    '.mtsx',
    '.ctsx',
    '.tsx',
    '.jsx',
    '.mts',
    '.cts',
    '.mjs',
    '.cjs',
    '.ts',
    '.js',
  ];
  for (let index = 0; index < extensions.length; index += 1) {
    const extension = extensions[index]!;
    if (compilerStringEndsWith(fileName, extension)) return extension;
  }
  return null;
}

function canonicalProjectFileName(fileName: string): string {
  return normalizeProjectPath(compilerStringReplaceAll(fileName, '\\', '/'));
}

function normalizeProjectPath(fileName: string): string {
  const slash = compilerStringReplaceAll(fileName, '\\', '/');
  const absolute = compilerStringStartsWith(slash, '/');
  const segments = compilerStringSplit(slash, '/');
  const normalized: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      const previous = normalized[normalized.length - 1];
      if (previous !== undefined && previous !== '..') normalized.length -= 1;
      else if (!absolute)
        compilerArrayAppend(normalized, segment, 'Normalized project path segments');
      continue;
    }
    compilerArrayAppend(normalized, segment, 'Normalized project path segments');
  }
  const joined = compilerArrayJoin(normalized, '/');
  return absolute ? `/${joined}` : joined || '.';
}

function projectDirname(fileName: string): string {
  const separator = compilerStringLastIndexOf(fileName, '/');
  if (separator < 0) return '.';
  if (separator === 0) return '/';
  return compilerStringSlice(fileName, 0, separator);
}

function isRelativeModuleSpecifier(value: string): boolean {
  return (
    value === '.' ||
    value === '..' ||
    compilerStringStartsWith(value, './') ||
    compilerStringStartsWith(value, '../')
  );
}

function sourceScriptKind(fileName: string): ts.ScriptKind {
  if (compilerStringEndsWith(fileName, '.tsx') || compilerStringEndsWith(fileName, '.jsx')) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
}

function unwrapExpression(expression: ts.Expression | undefined): ts.Expression | null {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current ?? null;
}

function registryInputFields(fields: readonly MutationInputFieldFact[]): MutationInputFieldFact[] {
  const source = compilerSnapshotDenseArray(fields, 'Local mutation input fields');
  const result: MutationInputFieldFact[] = [];
  for (let index = 0; index < source.length; index += 1) {
    compilerArrayAppend(
      result,
      { ...source[index]!, provenance: 'registry' },
      'Project registry mutation input fields',
    );
  }
  return result;
}

function unambiguousProjectFacts(
  candidates: readonly CandidateBinding[],
): ProjectMutationRegistryFacts {
  const source = compilerSnapshotDenseArray(candidates, 'Project mutation binding candidates');
  const identities = compilerCreateMap<string, string | null>();
  for (let index = 0; index < source.length; index += 1) {
    const proof = source[index]!.proof;
    const prior = compilerMapGet(identities, proof.key);
    if (prior === undefined) compilerMapSet(identities, proof.key, proof.identity);
    else if (prior !== proof.identity) compilerMapSet(identities, proof.key, null);
  }

  const bindings: ProjectMutationBindingFact[] = [];
  const mutationInputs = compilerCreateNullRecord<readonly MutationInputFieldFact[]>();
  const writtenInputs = compilerCreateSet<string>();
  for (let index = 0; index < source.length; index += 1) {
    const candidate = source[index]!;
    if (compilerMapGet(identities, candidate.proof.key) !== candidate.proof.identity) continue;
    compilerArrayAppend(
      bindings,
      {
        fileName: candidate.fileName,
        key: candidate.proof.key,
        localName: candidate.localName,
        source: candidate.proof.source,
      },
      'Project mutation binding facts',
    );
    if (compilerSetHas(writtenInputs, candidate.proof.key)) continue;
    compilerSetAdd(writtenInputs, candidate.proof.key);
    compilerDefineOwnDataProperty(mutationInputs, candidate.proof.key, candidate.proof.fields);
  }
  return { mutationBindings: bindings, mutationInputs };
}
