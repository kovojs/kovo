import { createHash } from 'node:crypto';
import { realpathSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import * as ts from 'typescript';

import { compileComponentModule } from './compile.js';
import {
  appContractDeclarationFamilies,
  type AppContractDeclarationFamily,
  type AppContractResolverDiagnostic,
  type CompilerOwnedAppContractResolution,
  validateCompilerOwnedAppContractResolutions,
  withCompilerOwnedAppContractResolutions,
} from './app-contract-resolver.js';
import { deriveAppGraph } from './graph.js';
import { compileRouteModule } from './scan/route-pages.js';
import { parseComponentModule } from './scan/parse.js';
import { lowerStandaloneSourceDerivedRegistryDeclarations } from './source-derived-lowering.js';
import type { CompileResult, CompileRouteModuleResult } from './types.js';

/** @internal D1 diagnostic emitted by the compiler-owned app resolver. */
export interface CompilerOwnedAppContractDiagnostic {
  readonly code:
    | 'D1A001'
    | 'D1A002'
    | 'D1A003'
    | 'D1A004'
    | 'D1A005'
    | 'D1A006'
    | 'D1A007'
    | 'D1A008'
    | 'D1A009'
    | 'D1B001'
    | 'D1B002'
    | 'D1B003'
    | 'D1B004'
    | 'D1B005'
    | 'D1B006'
    | 'D1B007'
    | 'D1B008'
    | 'D1B009'
    | 'D1X001';
  readonly fileName: string;
  readonly length: number;
  readonly message: string;
  readonly start: number;
}

/** @internal D1 result for one exact Program source file. */
export interface CompilerOwnedAppContractEntry {
  readonly component?: CompileResult;
  readonly diagnostics: readonly CompilerOwnedAppContractDiagnostic[];
  readonly graph: {
    readonly handlerRoots: number;
    readonly pages: number;
  };
  readonly loweredSource: string | null;
  readonly ownerKey: string | null;
  readonly parsedFactories: readonly AppContractDeclarationFamily[];
  readonly resolver: {
    readonly exactNodeCount: number;
    readonly schema: 'kovo.app-contract-d1-compiler-resolver/v2';
    readonly sourceFileName: string;
  };
  readonly route?: CompileRouteModuleResult;
  readonly semanticGraph?: unknown;
  readonly serverPackageRoots: readonly string[];
  readonly source: string;
}

/** @internal Exact filesystem project. No method accepts an identity claim. */
export interface CompilerOwnedAppContractProject {
  compileEntry(fileName: string): CompilerOwnedAppContractEntry;
  diagnosticCodesForFile(fileName: string): readonly number[];
  resolverIntegrityMutations(
    fileName: string,
  ): Readonly<Record<string, readonly AppContractResolverDiagnostic[]>>;
}

/** @internal Exact root names used to construct the compiler-owned TypeScript Program. */
export interface CreateCompilerOwnedAppContractProjectOptions {
  readonly rootNames: readonly string[];
}

type ReceiverProof =
  | {
      readonly kind: 'app';
      readonly ownerKey: string;
      readonly serverPackageRoot: string;
    }
  | {
      readonly diagnostic: CompilerOwnedAppContractDiagnostic;
      readonly kind: 'diagnostic';
    }
  | { readonly kind: 'none' };

type FactoryProof =
  | {
      readonly exportName: AppContractDeclarationFamily;
      readonly kind: 'factory';
      readonly ownerKey: string;
      readonly serverPackageRoot: string;
    }
  | {
      readonly diagnostic: CompilerOwnedAppContractDiagnostic;
      readonly kind: 'diagnostic';
    }
  | { readonly kind: 'none' };

interface EntryAnalysis {
  readonly diagnostics: readonly CompilerOwnedAppContractDiagnostic[];
  readonly facts: readonly CompilerOwnedAppContractResolution[];
  readonly ownerKey: string | null;
  readonly serverPackageRoots: readonly string[];
}

interface ProvenanceContext {
  readonly checker: ts.TypeChecker;
  readonly options: ts.CompilerOptions;
  readonly program: ts.Program;
}

/**
 * Build the Arm A project from filesystem roots. Identity is derived from compiler-owned AST and
 * package facts, then consumed only while lowering the exact source snapshot (SPEC.md §5.2).
 */
export function createCompilerOwnedAppContractProject(
  rawOptions: CreateCompilerOwnedAppContractProjectOptions,
): CompilerOwnedAppContractProject {
  const rootNames = snapshotRootNames(rawOptions);
  const options = appContractCompilerOptions();
  const program = ts.createProgram({ options, rootNames });
  const checker = program.getTypeChecker();
  const semanticDiagnostics = ts.getPreEmitDiagnostics(program);
  const context: ProvenanceContext = { checker, options, program };

  const sourceFileFor = (fileName: string): ts.SourceFile => {
    const normalized = normalizeFileName(fileName);
    const exact =
      program.getSourceFile(fileName) ??
      program
        .getSourceFiles()
        .find((candidate) => normalizeFileName(candidate.fileName) === normalized);
    if (!exact) throw new TypeError(`App-contract project does not contain ${fileName}.`);
    return exact;
  };

  const analyzeEntry = (fileName: string): EntryAnalysis => {
    const sourceFile = sourceFileFor(fileName);
    const diagnostics: CompilerOwnedAppContractDiagnostic[] = [];
    const facts: CompilerOwnedAppContractResolution[] = [];
    const dynamicImport = firstAppProviderDynamicImport(sourceFile, context);
    if (dynamicImport) {
      diagnostics.push(
        diagnosticAt(
          sourceFile,
          dynamicImport,
          'D1A009',
          'D1A009 receiver provenance refuses dynamically imported app contracts.',
        ),
      );
    }
    const visit = (node: ts.Node): void => {
      if (diagnostics.length > 0) return;
      if (
        node !== sourceFile &&
        (ts.isArrowFunction(node) ||
          ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isMethodDeclaration(node))
      ) {
        return;
      }
      if (ts.isCallExpression(node)) {
        const proof = proveFactoryCall(sourceFile, node, context);
        if (proof.kind === 'diagnostic') {
          diagnostics.push(proof.diagnostic);
        } else if (proof.kind === 'factory') {
          const expression = node.expression;
          facts.push({
            end: expression.getEnd(),
            exportName: proof.exportName,
            node: expression,
            ownerKey: proof.ownerKey,
            serverPackageRoot: proof.serverPackageRoot,
            sourceFile,
            sourceSnapshot: sourceFile.text,
            start: expression.getStart(sourceFile),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const integrity = validateCompilerOwnedAppContractResolutions(facts);
    if (integrity.length > 0) {
      throw new TypeError(integrity.map((entry) => entry.message).join('\n'));
    }

    // Both channels are required. Reachability catches unused/bridged copies; retained fact roots
    // catch two exact app facts even when their owner strings happen to be identical.
    const serverPackageRoots = unique([
      ...reachableServerPackageRoots(sourceFile, context),
      ...facts.map((fact) => fact.serverPackageRoot),
    ]);
    if (serverPackageRoots.length > 1) {
      const target = facts[0]?.node ?? firstTopLevelCall(sourceFile)?.expression ?? sourceFile;
      return {
        diagnostics: [
          diagnosticAt(
            sourceFile,
            target,
            'D1X001',
            `D1X001 app contract mixes physical @kovojs/server packages before evaluation: ${serverPackageRoots.join(
              ' and ',
            )}.`,
          ),
        ],
        facts: [],
        ownerKey: null,
        serverPackageRoots,
      };
    }

    const ownerKeys = unique(facts.map((fact) => fact.ownerKey));
    if (ownerKeys.length > 1) {
      diagnostics.push(
        diagnosticAt(
          sourceFile,
          facts[0]?.node ?? sourceFile,
          'D1A006',
          'D1A006 receiver provenance refuses joined app owners in one declaration module.',
        ),
      );
    }
    const finalDiagnostics = dedupeDiagnostics(diagnostics);
    return {
      diagnostics: finalDiagnostics,
      facts: finalDiagnostics.length === 0 ? facts : [],
      ownerKey: finalDiagnostics.length === 0 ? (ownerKeys[0] ?? null) : null,
      serverPackageRoots,
    };
  };

  return Object.freeze({
    compileEntry(fileName: string): CompilerOwnedAppContractEntry {
      const sourceFile = sourceFileFor(fileName);
      const analysis = analyzeEntry(fileName);
      if (analysis.diagnostics.length > 0) {
        return rejectedEntry(sourceFile, analysis);
      }
      return withCompilerOwnedAppContractResolutions(analysis.facts, () => {
        const component = compileComponentModule({
          fileName: sourceFile.fileName,
          source: sourceFile.text,
        });
        const route = compileRouteModule({
          fileName: sourceFile.fileName,
          source: sourceFile.text,
        });
        const parsed = parseComponentModule(sourceFile.fileName, sourceFile.text);
        const loweredSource = lowerStandaloneSourceDerivedRegistryDeclarations({
          fileName: sourceFile.fileName,
          source: sourceFile.text,
        });
        const graphResult = deriveAppGraph({ components: [component], routePages: [route] });
        return {
          component,
          diagnostics: [],
          graph: {
            handlerRoots: countHandlerRoots(graphResult.graph),
            pages: graphResult.graph.pages?.length ?? 0,
          },
          loweredSource,
          ownerKey: analysis.ownerKey,
          parsedFactories: unique(
            parsed.calls.flatMap((call) =>
              isDeclarationFamily(call.frameworkFactory) ? [call.frameworkFactory] : [],
            ),
          ),
          resolver: {
            exactNodeCount: analysis.facts.length,
            schema: 'kovo.app-contract-d1-compiler-resolver/v2',
            sourceFileName: normalizeFileName(sourceFile.fileName),
          },
          route,
          semanticGraph: graphResult.graph,
          serverPackageRoots: analysis.serverPackageRoots,
          source: sourceFile.text,
        };
      });
    },

    diagnosticCodesForFile(fileName: string): readonly number[] {
      const normalized = normalizeFileName(sourceFileFor(fileName).fileName);
      return uniqueNumbers(
        semanticDiagnostics.flatMap((diagnostic) =>
          diagnostic.file && normalizeFileName(diagnostic.file.fileName) === normalized
            ? [diagnostic.code]
            : [],
        ),
      );
    },

    resolverIntegrityMutations(
      fileName: string,
    ): Readonly<Record<string, readonly AppContractResolverDiagnostic[]>> {
      const analysis = analyzeEntry(fileName);
      const fact = analysis.facts[0];
      if (!fact || analysis.diagnostics.length > 0) {
        throw new TypeError('Resolver-integrity probe requires one accepted Arm A declaration.');
      }
      return Object.freeze({
        'blank-owner-key': validateCompilerOwnedAppContractResolutions([{ ...fact, ownerKey: '' }]),
        'blank-server-package-root': validateCompilerOwnedAppContractResolutions([
          { ...fact, serverPackageRoot: '' },
        ]),
        'duplicate-span': validateCompilerOwnedAppContractResolutions([fact, fact]),
        'overlapping-span': validateCompilerOwnedAppContractResolutions([
          fact,
          { ...fact, start: fact.start + 1 },
        ]),
        'stale-source-reparse': validateCompilerOwnedAppContractResolutions([
          { ...fact, sourceSnapshot: `${fact.sourceSnapshot}\n// stale` },
        ]),
        'wrong-node-span': validateCompilerOwnedAppContractResolutions([
          {
            ...fact,
            node: ts.isPropertyAccessExpression(fact.node) ? fact.node.expression : fact.sourceFile,
          },
        ]),
      });
    },
  });
}

function rejectedEntry(
  sourceFile: ts.SourceFile,
  analysis: EntryAnalysis,
): CompilerOwnedAppContractEntry {
  return {
    diagnostics: analysis.diagnostics,
    graph: { handlerRoots: 0, pages: 0 },
    loweredSource: null,
    ownerKey: null,
    parsedFactories: [],
    resolver: {
      exactNodeCount: 0,
      schema: 'kovo.app-contract-d1-compiler-resolver/v2',
      sourceFileName: normalizeFileName(sourceFile.fileName),
    },
    serverPackageRoots: analysis.serverPackageRoots,
    source: sourceFile.text,
  };
}

function proveFactoryCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  context: ProvenanceContext,
): FactoryProof {
  const expression = call.expression;
  if (ts.isPropertyAccessExpression(expression) && isDeclarationFamily(expression.name.text)) {
    const receiver = proveReceiver(sourceFile, expression.expression, context, new Set(), 0);
    if (receiver.kind !== 'app') return receiver;
    return {
      exportName: expression.name.text,
      kind: 'factory',
      ownerKey: receiver.ownerKey,
      serverPackageRoot: receiver.serverPackageRoot,
    };
  }

  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    staticMemberName(expression.argumentExpression) !== undefined &&
    isDeclarationFamily(staticMemberName(expression.argumentExpression))
  ) {
    const receiver = proveReceiver(sourceFile, expression.expression, context, new Set(), 0);
    if (
      receiver.kind === 'app' ||
      receiver.kind === 'diagnostic' ||
      expressionDerivesFromApp(expression.expression, context, new Set(), 0)
    ) {
      return {
        diagnostic: diagnosticAt(
          sourceFile,
          expression,
          'D1A008',
          'D1A008 receiver provenance refuses computed declaration-factory access.',
        ),
        kind: 'diagnostic',
      };
    }
  }

  if (ts.isIdentifier(expression)) {
    const generated = proveGeneratedAppFactory(sourceFile, expression, context);
    if (generated) return generated;
  }
  const unsafeGenerated = proveUnsafeGeneratedFactoryCall(sourceFile, call, context);
  if (unsafeGenerated) return unsafeGenerated;

  const callback = call.arguments.find(
    (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
  );
  if (
    callback &&
    functionContainsDeclarationFactoryAccess(callback) &&
    (functionContainsAppDeclarationFactory(callback, context) ||
      expressionDerivesFromApp(expression, context, new Set(), 0) ||
      call.arguments.some(
        (argument) =>
          argument !== callback && expressionDerivesFromApp(argument, context, new Set(), 0),
      ))
  ) {
    return {
      diagnostic: diagnosticAt(
        sourceFile,
        expression,
        'D1A007',
        'D1A007 receiver provenance refuses an app contract transferred through a callback.',
      ),
      kind: 'diagnostic',
    };
  }

  if (!ts.isIdentifier(expression)) return { kind: 'none' };
  const localDeclaration = localSymbolDeclaration(context.checker, expression);
  if (localDeclaration && ts.isBindingElement(localDeclaration)) {
    const member = bindingMemberName(localDeclaration);
    const variable = enclosingVariableDeclaration(localDeclaration);
    if (
      member &&
      isDeclarationFamily(member) &&
      variable?.initializer &&
      expressionDerivesFromApp(variable.initializer, context, new Set(), 0)
    ) {
      return {
        diagnostic: diagnosticAt(
          sourceFile,
          expression,
          'D1A003',
          'D1A003 receiver provenance refuses destructured declaration factories; call the immutable app receiver directly.',
        ),
        kind: 'diagnostic',
      };
    }
  }

  const functionLike = localDeclaration ? functionLikeDeclaration(localDeclaration) : undefined;
  if (functionLike && functionContainsAppDeclarationFactory(functionLike, context)) {
    const code = functionLike.parameters.length === 0 ? 'D1A007' : 'D1A001';
    return {
      diagnostic: diagnosticAt(
        sourceFile,
        expression,
        code,
        code === 'D1A001'
          ? 'D1A001 receiver provenance refuses wrapper results because the declaration call-site owner cannot be proved exactly.'
          : 'D1A007 receiver provenance refuses declaration calls hidden in a function body.',
      ),
      kind: 'diagnostic',
    };
  }

  if (
    functionLike &&
    functionContainsDeclarationFactoryAccess(functionLike) &&
    call.arguments.some((argument) =>
      expressionDerivesFromApp(argument, context, new Set(), 0),
    )
  ) {
    return {
      diagnostic: diagnosticAt(
        sourceFile,
        expression,
        'D1A007',
        'D1A007 receiver provenance refuses an app contract transferred through a function parameter.',
      ),
      kind: 'diagnostic',
    };
  }

  if (
    localDeclaration &&
    ts.isVariableDeclaration(localDeclaration) &&
    localDeclaration.initializer &&
    expressionContainsDeclarationFactoryAccess(localDeclaration.initializer) &&
    expressionDerivesFromApp(localDeclaration.initializer, context, new Set(), 0)
  ) {
    const bound = expressionIsBoundAppFactory(localDeclaration.initializer, context);
    return {
      diagnostic: diagnosticAt(
        sourceFile,
        expression,
        bound ? 'D1A007' : 'D1A002',
        bound
          ? 'D1A007 receiver provenance refuses declaration factories transferred through Function.bind.'
          : 'D1A002 receiver provenance refuses dynamic declaration-factory selection.',
      ),
      kind: 'diagnostic',
    };
  }
  return { kind: 'none' };
}

function proveReceiver(
  diagnosticSourceFile: ts.SourceFile,
  rawExpression: ts.Expression,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): ReceiverProof {
  if (depth > 48) {
    return {
      diagnostic: diagnosticAt(
        diagnosticSourceFile,
        rawExpression,
        'D1A007',
        'D1A007 app-derived receiver provenance exceeded the bounded proof depth.',
      ),
      kind: 'diagnostic',
    };
  }
  const expression = unwrapExpression(rawExpression);
  if (ts.isConditionalExpression(expression) || isJoiningBinaryExpression(expression)) {
    if (expressionDerivesFromApp(expression, context, new Set(), depth + 1)) {
      return {
        diagnostic: diagnosticAt(
          diagnosticSourceFile,
          expression,
          'D1A006',
          'D1A006 receiver provenance refuses joined receiver aliases.',
        ),
        kind: 'diagnostic',
      };
    }
    return { kind: 'none' };
  }

  if (ts.isIdentifier(expression)) {
    const localDeclaration = localSymbolDeclaration(context.checker, expression);
    if (
      localDeclaration &&
      ts.isBindingElement(localDeclaration) &&
      declarationDerivesFromApp(localDeclaration, context, new Set(), depth + 1)
    ) {
      return {
        diagnostic: diagnosticAt(
          diagnosticSourceFile,
          expression,
          'D1A007',
          'D1A007 receiver provenance refuses app contracts transferred through binding elements.',
        ),
        kind: 'diagnostic',
      };
    }
    if (localDeclaration && ts.isVariableDeclaration(localDeclaration)) {
      const proof = proveVariableReceiver(
        diagnosticSourceFile,
        expression,
        localDeclaration,
        context,
        seen,
        depth,
      );
      if (proof.kind !== 'none') return proof;
    }

    const declaration = symbolDeclaration(context.checker, expression);
    if (declaration && declaration !== localDeclaration && ts.isVariableDeclaration(declaration)) {
      const proof = proveVariableReceiver(
        diagnosticSourceFile,
        expression,
        declaration,
        context,
        seen,
        depth,
      );
      if (proof.kind !== 'none') return proof;
    }
    return { kind: 'none' };
  }

  if (expressionDerivesFromApp(expression, context, new Set(), depth + 1)) {
    return {
      diagnostic: diagnosticAt(
        diagnosticSourceFile,
        expression,
        'D1A007',
        'D1A007 receiver provenance refuses an app-derived receiver whose exact binding cannot be proved.',
      ),
      kind: 'diagnostic',
    };
  }
  return { kind: 'none' };
}

function proveVariableReceiver(
  diagnosticSourceFile: ts.SourceFile,
  expression: ts.Identifier,
  declaration: ts.VariableDeclaration,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): ReceiverProof {
  if (seen.has(declaration)) {
    return {
      diagnostic: diagnosticAt(
        diagnosticSourceFile,
        expression,
        'D1A006',
        'D1A006 receiver provenance refuses cyclic or joined receiver aliases.',
      ),
      kind: 'diagnostic',
    };
  }
  const nextSeen = new Set(seen);
  nextSeen.add(declaration);
  if (!declaration.initializer) return { kind: 'none' };
  const derives = expressionDerivesFromApp(declaration.initializer, context, new Set(), depth + 1);
  if (!derives) return { kind: 'none' };
  if (!variableDeclarationIsConst(declaration)) {
    return {
      diagnostic: diagnosticAt(
        diagnosticSourceFile,
        expression,
        'D1A004',
        'D1A004 app receivers must be declared with const.',
      ),
      kind: 'diagnostic',
    };
  }
  if (variableIsReassigned(declaration, context.checker, context.program)) {
    return {
      diagnostic: diagnosticAt(
        diagnosticSourceFile,
        expression,
        'D1A005',
        'D1A005 app receiver provenance refuses a reassigned binding.',
      ),
      kind: 'diagnostic',
    };
  }

  const initializer = unwrapExpression(declaration.initializer);
  if (ts.isConditionalExpression(initializer) || isJoiningBinaryExpression(initializer)) {
    return {
      diagnostic: diagnosticAt(
        diagnosticSourceFile,
        expression,
        'D1A006',
        'D1A006 receiver provenance refuses joined receiver aliases.',
      ),
      kind: 'diagnostic',
    };
  }
  const direct = proveDirectDefineKovo(declaration, initializer, context);
  if (direct) return direct;
  if (ts.isIdentifier(initializer)) {
    return proveReceiver(diagnosticSourceFile, initializer, context, nextSeen, depth + 1);
  }
  return {
    diagnostic: diagnosticAt(
      diagnosticSourceFile,
      expression,
      'D1A007',
      'D1A007 receiver provenance refuses an app-derived receiver whose exact binding cannot be proved.',
    ),
    kind: 'diagnostic',
  };
}

function proveDirectDefineKovo(
  declaration: ts.VariableDeclaration,
  initializer: ts.Expression,
  context: ProvenanceContext,
): Extract<ReceiverProof, { kind: 'app' }> | undefined {
  if (
    !ts.isCallExpression(initializer) ||
    initializer.arguments.length !== 1 ||
    !ts.isIdentifier(initializer.expression)
  ) {
    return undefined;
  }
  const argument = initializer.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined;
  const serverPackageRoot = serverPackageRootForDefineKovo(initializer.expression, context.checker);
  if (!serverPackageRoot) return undefined;
  const appId = stringProperty(argument, 'appId');
  const providerKey = stringProperty(argument, 'providerKey');
  const providerIdentity = importedProviderIdentity(argument, providerKey, context);
  if (!appId || !providerKey || !providerIdentity) return undefined;
  // Bind the proof to the declaration that owns the initializer, not merely an equivalent call.
  if (initializer.getSourceFile() !== declaration.getSourceFile()) return undefined;
  return {
    kind: 'app',
    ownerKey: `d1v6:${createHash('sha256')
      .update(
        JSON.stringify({
          appId,
          providerExportBinding: providerIdentity.exportBinding,
          providerImportSpecifier: providerIdentity.importSpecifier,
          providerKey,
        }),
      )
      .digest('hex')}`,
    serverPackageRoot,
  };
}

function importedProviderIdentity(
  options: ts.ObjectLiteralExpression,
  providerKey: string | undefined,
  context: ProvenanceContext,
): { readonly exportBinding: string; readonly importSpecifier: string } | undefined {
  if (!providerKey) return undefined;
  const providerProperty = options.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === 'provider') ||
        (ts.isStringLiteralLike(property.name) && property.name.text === 'provider')),
  );
  if (!providerProperty || !ts.isIdentifier(providerProperty.initializer)) return undefined;
  const localDeclaration = localSymbolDeclaration(context.checker, providerProperty.initializer);
  if (!localDeclaration || !ts.isImportSpecifier(localDeclaration)) return undefined;
  const importDeclaration = localDeclaration.parent.parent.parent;
  if (
    !ts.isImportDeclaration(importDeclaration) ||
    !ts.isStringLiteralLike(importDeclaration.moduleSpecifier)
  ) {
    return undefined;
  }
  const resolvedDeclaration = symbolDeclaration(context.checker, providerProperty.initializer);
  if (
    !resolvedDeclaration ||
    !ts.isVariableDeclaration(resolvedDeclaration) ||
    !resolvedDeclaration.initializer ||
    !ts.isObjectLiteralExpression(unwrapExpression(resolvedDeclaration.initializer))
  ) {
    return undefined;
  }
  const providerDefinition = unwrapExpression(
    resolvedDeclaration.initializer,
  ) as ts.ObjectLiteralExpression;
  if (stringProperty(providerDefinition, 'key') !== providerKey) return undefined;
  return {
    exportBinding: localDeclaration.propertyName?.text ?? localDeclaration.name.text,
    importSpecifier: importDeclaration.moduleSpecifier.text,
  };
}

function expressionDerivesFromApp(
  rawExpression: ts.Expression,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (depth > 48) return true;
  const expression = unwrapExpression(rawExpression);
  if (ts.isIdentifier(expression)) {
    const local = localSymbolDeclaration(context.checker, expression);
    if (local && declarationDerivesFromApp(local, context, seen, depth + 1)) return true;
    const resolved = symbolDeclaration(context.checker, expression);
    return (
      resolved !== undefined &&
      resolved !== local &&
      declarationDerivesFromApp(resolved, context, seen, depth + 1)
    );
  }
  if (ts.isCallExpression(expression)) {
    if (
      ts.isIdentifier(expression.expression) &&
      serverPackageRootForDefineKovo(expression.expression, context.checker) &&
      expression.arguments.length === 1 &&
      ts.isObjectLiteralExpression(expression.arguments[0]!)
    ) {
      return true;
    }
    const calleeDeclaration = ts.isIdentifier(expression.expression)
      ? localSymbolDeclaration(context.checker, expression.expression)
      : undefined;
    const functionLike = calleeDeclaration ? functionLikeDeclaration(calleeDeclaration) : undefined;
    if (functionLike && functionReturnsApp(functionLike, context, seen, depth + 1)) return true;
    if (
      ts.isPropertyAccessExpression(expression.expression) ||
      ts.isElementAccessExpression(expression.expression)
    ) {
      if (expressionDerivesFromApp(expression.expression.expression, context, seen, depth + 1)) {
        return true;
      }
    }
    return expression.arguments.some((argument) =>
      expressionDerivesFromApp(argument, context, seen, depth + 1),
    );
  }
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expressionDerivesFromApp(expression.expression, context, seen, depth + 1);
  }
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return functionReturnsApp(expression, context, seen, depth + 1);
  }

  let derives = false;
  const visitChild = (child: ts.Node): void => {
    if (derives || ts.isFunctionLike(child)) return;
    if (ts.isExpression(child) && expressionDerivesFromApp(child, context, seen, depth + 1)) {
      derives = true;
      return;
    }
    ts.forEachChild(child, visitChild);
  };
  ts.forEachChild(expression, visitChild);
  return derives;
}

function declarationDerivesFromApp(
  declaration: ts.Declaration,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (depth > 48 || seen.has(declaration)) return depth > 48;
  const nextSeen = new Set(seen);
  nextSeen.add(declaration);
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const initializer = unwrapExpression(declaration.initializer);
    return (
      proveDirectDefineKovo(declaration, initializer, context) !== undefined ||
      expressionDerivesFromApp(initializer, context, nextSeen, depth + 1)
    );
  }
  if (ts.isBindingElement(declaration)) {
    const variable = enclosingVariableDeclaration(declaration);
    return (
      variable?.initializer !== undefined &&
      expressionDerivesFromApp(variable.initializer, context, nextSeen, depth + 1)
    );
  }
  const functionLike = functionLikeDeclaration(declaration);
  return functionLike ? functionReturnsApp(functionLike, context, nextSeen, depth + 1) : false;
}

function functionReturnsApp(
  declaration: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (!declaration.body) return false;
  if (!ts.isBlock(declaration.body)) {
    return expressionDerivesFromApp(declaration.body, context, seen, depth + 1);
  }
  let derives = false;
  const visit = (node: ts.Node): void => {
    if (derives) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      expressionDerivesFromApp(node.expression, context, seen, depth + 1)
    ) {
      derives = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return derives;
}

function functionContainsAppDeclarationFactory(
  declaration: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  context: ProvenanceContext,
): boolean {
  if (!declaration.body) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        isDeclarationFamily(callee.name.text) &&
        expressionDerivesFromApp(callee.expression, context, new Set(), 0)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function proveGeneratedAppFactory(
  callSourceFile: ts.SourceFile,
  expression: ts.Identifier,
  context: ProvenanceContext,
): Exclude<FactoryProof, { kind: 'none' }> | undefined {
  const declaration = symbolDeclaration(context.checker, expression);
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !ts.isIdentifier(declaration.name) ||
    !isDeclarationFamily(declaration.name.text) ||
    !declaration.initializer
  ) {
    return undefined;
  }
  const generatedSourceFile = declaration.getSourceFile();
  const normalizedGeneratedFile = normalizeFileName(generatedSourceFile.fileName);
  if (
    !normalizedGeneratedFile.includes('/.kovo/') ||
    !normalizedGeneratedFile.endsWith('/app.ts')
  ) {
    return undefined;
  }
  if (
    !generatedSourceFile.text.startsWith(
      '/* kovo-app-contract-prototype/v6: compiler generated; do not edit */',
    ) ||
    !sourceReachesGeneratedModuleThroughKovoAlias(
      callSourceFile,
      generatedSourceFile,
      context,
      new Set(),
      false,
    ) ||
    !generatedModuleMatchesManifest(generatedSourceFile)
  ) {
    return {
      diagnostic: diagnosticAt(
        callSourceFile,
        expression,
        'D1B009',
        'D1B009 generated app factory identity is not bound to an authenticated #kovo module.',
      ),
      kind: 'diagnostic',
    };
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (
    !ts.isPropertyAccessExpression(initializer) ||
    initializer.name.text !== declaration.name.text
  ) {
    return {
      diagnostic: diagnosticAt(
        callSourceFile,
        expression,
        'D1B009',
        'D1B009 generated app factory does not lower to its exact app receiver.',
      ),
      kind: 'diagnostic',
    };
  }
  const receiver = proveReceiver(
    generatedSourceFile,
    initializer.expression,
    context,
    new Set(),
    0,
  );
  if (receiver.kind !== 'app') {
    return {
      diagnostic: diagnosticAt(
        callSourceFile,
        expression,
        'D1B009',
        'D1B009 generated app factory owner could not be derived from its provider.',
      ),
      kind: 'diagnostic',
    };
  }
  return {
    exportName: declaration.name.text,
    kind: 'factory',
    ownerKey: receiver.ownerKey,
    serverPackageRoot: receiver.serverPackageRoot,
  };
}

function proveUnsafeGeneratedFactoryCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  context: ProvenanceContext,
): Extract<FactoryProof, { kind: 'diagnostic' }> | undefined {
  const expression = unwrapExpression(call.expression);
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    isDeclarationFamily(staticMemberName(expression.argumentExpression)) &&
    ts.isIdentifier(unwrapExpression(expression.expression)) &&
    namespaceResolvesToGeneratedApp(
      unwrapExpression(expression.expression) as ts.Identifier,
      context,
    )
  ) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B008',
      'generated app factories require a static named import',
    );
  }
  if (
    (ts.isCallExpression(expression) ||
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)) &&
    expressionDerivesFromGeneratedFactory(expression, context, new Set(), 0)
  ) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B007',
      'generated app factory binding is indirectly derived',
    );
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const declaration = localSymbolDeclaration(context.checker, expression);
  if (declaration && ts.isBindingElement(declaration)) {
    const member = bindingMemberName(declaration);
    const variable = enclosingVariableDeclaration(declaration);
    if (
      member &&
      isDeclarationFamily(member) &&
      variable?.initializer &&
      ts.isIdentifier(unwrapExpression(variable.initializer)) &&
      namespaceResolvesToGeneratedApp(
        unwrapExpression(variable.initializer) as ts.Identifier,
        context,
      )
    ) {
      return generatedDiagnostic(
        sourceFile,
        expression,
        'D1B003',
        'generated app factories may not be destructured from a namespace',
      );
    }
  }
  const functionLike = declaration ? functionLikeDeclaration(declaration) : undefined;
  if (functionLike && functionContainsGeneratedFactoryCall(functionLike, context)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B001',
      'generated app factory wrappers are not an exact generated binding',
    );
  }
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer ||
    !expressionDerivesFromGeneratedFactory(declaration.initializer, context, new Set(), 0)
  ) {
    return undefined;
  }
  if (!variableDeclarationIsConst(declaration)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B004',
      'generated app factory aliases must be const',
    );
  }
  if (variableIsReassigned(declaration, context.checker, context.program)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B005',
      'generated app factory aliases may not be reassigned',
    );
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (ts.isConditionalExpression(initializer) || isJoiningBinaryExpression(initializer)) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B006',
      'generated app factory aliases may not join control-flow branches',
    );
  }
  if (
    ts.isElementAccessExpression(initializer) &&
    !ts.isArrayLiteralExpression(unwrapExpression(initializer.expression))
  ) {
    return generatedDiagnostic(
      sourceFile,
      expression,
      'D1B002',
      'generated app factories may not be dynamically selected',
    );
  }
  return generatedDiagnostic(
    sourceFile,
    expression,
    'D1B007',
    'generated app factory binding is indirectly derived',
  );
}

function generatedDiagnostic(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code:
    | 'D1B001'
    | 'D1B002'
    | 'D1B003'
    | 'D1B004'
    | 'D1B005'
    | 'D1B006'
    | 'D1B007'
    | 'D1B008',
  detail: string,
): Extract<FactoryProof, { kind: 'diagnostic' }> {
  return {
    diagnostic: diagnosticAt(
      sourceFile,
      node,
      code,
      `${code} ${detail}; import and call the exact #kovo named export.`,
    ),
    kind: 'diagnostic',
  };
}

function expressionDerivesFromGeneratedFactory(
  rawExpression: ts.Expression,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (depth > 48) return true;
  const expression = unwrapExpression(rawExpression);
  if (ts.isIdentifier(expression)) {
    const direct = proveGeneratedAppFactory(expression.getSourceFile(), expression, context);
    if (direct?.kind === 'factory') return true;
    const declaration = localSymbolDeclaration(context.checker, expression);
    if (!declaration || seen.has(declaration)) return false;
    const nextSeen = new Set(seen);
    nextSeen.add(declaration);
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return expressionDerivesFromGeneratedFactory(
        declaration.initializer,
        context,
        nextSeen,
        depth + 1,
      );
    }
    const functionLike = functionLikeDeclaration(declaration);
    return functionLike
      ? functionReturnsGeneratedFactory(functionLike, context, nextSeen, depth + 1)
      : false;
  }
  if (ts.isCallExpression(expression)) {
    if (
      ts.isIdentifier(expression.expression) &&
      expressionDerivesFromGeneratedFactory(expression.expression, context, seen, depth + 1)
    ) {
      return true;
    }
    const declaration = ts.isIdentifier(expression.expression)
      ? localSymbolDeclaration(context.checker, expression.expression)
      : undefined;
    const functionLike = declaration ? functionLikeDeclaration(declaration) : undefined;
    if (
      functionLike &&
      functionReturnsGeneratedFactory(functionLike, context, seen, depth + 1)
    ) {
      return true;
    }
  }
  let derives = false;
  const visit = (node: ts.Node): void => {
    if (derives || ts.isFunctionLike(node)) return;
    if (
      ts.isExpression(node) &&
      node !== expression &&
      expressionDerivesFromGeneratedFactory(node, context, seen, depth + 1)
    ) {
      derives = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(expression, visit);
  return derives;
}

function functionReturnsGeneratedFactory(
  declaration: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  context: ProvenanceContext,
  seen: Set<ts.Declaration>,
  depth: number,
): boolean {
  if (!declaration.body) return false;
  if (!ts.isBlock(declaration.body)) {
    return expressionDerivesFromGeneratedFactory(declaration.body, context, seen, depth + 1);
  }
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isReturnStatement(node) &&
      node.expression &&
      expressionDerivesFromGeneratedFactory(node.expression, context, seen, depth + 1)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function functionContainsGeneratedFactoryCall(
  declaration: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  context: ProvenanceContext,
): boolean {
  if (!declaration.body) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      proveGeneratedAppFactory(node.getSourceFile(), node.expression, context)?.kind === 'factory'
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function namespaceResolvesToGeneratedApp(
  expression: ts.Identifier,
  context: ProvenanceContext,
): boolean {
  const declaration = localSymbolDeclaration(context.checker, expression);
  if (!declaration || !ts.isNamespaceImport(declaration)) return false;
  const importDeclaration = declaration.parent.parent;
  if (
    !ts.isImportDeclaration(importDeclaration) ||
    !ts.isStringLiteralLike(importDeclaration.moduleSpecifier) ||
    importDeclaration.moduleSpecifier.text !== '#kovo'
  ) {
    return false;
  }
  const resolved = resolveModule(
    importDeclaration.moduleSpecifier.text,
    importDeclaration.getSourceFile().fileName,
    context.options,
  );
  if (!resolved) return false;
  const target =
    context.program.getSourceFile(resolved.resolvedFileName) ??
    context.program
      .getSourceFiles()
      .find(
        (candidate) =>
          normalizeFileName(candidate.fileName) === normalizeFileName(resolved.resolvedFileName),
      );
  return (
    target !== undefined &&
    normalizeFileName(target.fileName).includes('/.kovo/') &&
    generatedModuleMatchesManifest(target)
  );
}

function sourceReachesGeneratedModuleThroughKovoAlias(
  sourceFile: ts.SourceFile,
  generatedSourceFile: ts.SourceFile,
  context: ProvenanceContext,
  seen: Set<string>,
  aliasObserved: boolean,
): boolean {
  const seenKey = `${normalizeFileName(sourceFile.fileName)}:${String(aliasObserved)}`;
  if (seen.has(seenKey)) return false;
  seen.add(seenKey);
  for (const statement of sourceFile.statements) {
    const moduleSpecifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier
        : undefined;
    if (!moduleSpecifier) continue;
    const resolved = resolveModule(moduleSpecifier.text, sourceFile.fileName, context.options);
    if (!resolved) continue;
    const nextAliasObserved = aliasObserved || moduleSpecifier.text === '#kovo';
    const normalizedResolved = normalizeFileName(resolved.resolvedFileName);
    if (
      nextAliasObserved &&
      normalizedResolved === normalizeFileName(generatedSourceFile.fileName)
    ) {
      return true;
    }
    const dependency =
      context.program.getSourceFile(resolved.resolvedFileName) ??
      context.program
        .getSourceFiles()
        .find((candidate) => normalizeFileName(candidate.fileName) === normalizedResolved);
    if (
      dependency &&
      sourceReachesGeneratedModuleThroughKovoAlias(
        dependency,
        generatedSourceFile,
        context,
        seen,
        nextAliasObserved,
      )
    ) {
      return true;
    }
  }
  return false;
}

function generatedModuleMatchesManifest(sourceFile: ts.SourceFile): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(sourceFile.fileName), 'app.manifest.json'), 'utf8'),
    ) as {
      generatedModuleSha256?: unknown;
      schema?: unknown;
    };
    return (
      manifest.schema === 'kovo.generated-app-contract/v6' &&
      manifest.generatedModuleSha256 ===
        createHash('sha256').update(sourceFile.text).digest('hex')
    );
  } catch {
    return false;
  }
}

function functionContainsDeclarationFactoryAccess(
  declaration: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
): boolean {
  if (!declaration.body) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== declaration.body && ts.isFunctionLike(node)) return;
    if (
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        isDeclarationFamily(node.expression.name.text)) ||
        (ts.isElementAccessExpression(node.expression) &&
          node.expression.argumentExpression !== undefined &&
          isDeclarationFamily(staticMemberName(node.expression.argumentExpression))))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.body);
  return found;
}

function expressionIsBoundAppFactory(
  rawExpression: ts.Expression,
  context: ProvenanceContext,
): boolean {
  const expression = unwrapExpression(rawExpression);
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== 'bind'
  ) {
    return false;
  }
  const target = expression.expression.expression;
  return (
    ts.isPropertyAccessExpression(target) &&
    isDeclarationFamily(target.name.text) &&
    expressionDerivesFromApp(target.expression, context, new Set(), 0)
  );
}

function firstAppProviderDynamicImport(
  sourceFile: ts.SourceFile,
  context: ProvenanceContext,
): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      dynamicImportTargetContainsApp(
        node.arguments[0]!.text,
        sourceFile.fileName,
        context,
        new Set(),
      )
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function dynamicImportTargetContainsApp(
  specifier: string,
  importer: string,
  context: ProvenanceContext,
  seen: Set<string>,
): boolean {
  const resolved = resolveModule(specifier, importer, context.options);
  if (!resolved) return false;
  const normalized = normalizeFileName(resolved.resolvedFileName);
  if (seen.has(normalized)) return false;
  seen.add(normalized);
  const target =
    context.program.getSourceFile(resolved.resolvedFileName) ??
    context.program
      .getSourceFiles()
      .find((candidate) => normalizeFileName(candidate.fileName) === normalized);
  if (!target) return false;
  let direct = false;
  const visit = (node: ts.Node): void => {
    if (direct) return;
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      proveDirectDefineKovo(node, unwrapExpression(node.initializer), context)
    ) {
      direct = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(target);
  if (direct) return true;
  for (const statement of target.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      continue;
    }
    if (
      dynamicImportTargetContainsApp(
        statement.moduleSpecifier.text,
        target.fileName,
        context,
        seen,
      )
    ) {
      return true;
    }
  }
  return false;
}

function serverPackageRootForDefineKovo(
  expression: ts.Identifier,
  checker: ts.TypeChecker,
): string | undefined {
  let symbol = checker.getSymbolAtLocation(expression);
  const seen = new Set<ts.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(symbol)) {
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  if (!symbol || symbol.getName() !== 'defineKovo') return undefined;
  for (const declaration of symbol.declarations ?? []) {
    const root = tryRealServerPackageRoot(declaration.getSourceFile().fileName);
    if (root) return root;
  }
  return undefined;
}

function variableIsReassigned(
  declaration: ts.VariableDeclaration,
  checker: ts.TypeChecker,
  program: ts.Program,
): boolean {
  if (!ts.isIdentifier(declaration.name)) return true;
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol) return true;
  const roots = new Set(program.getRootFileNames().map(normalizeFileName));
  for (const sourceFile of program.getSourceFiles()) {
    if (!roots.has(normalizeFileName(sourceFile.fileName))) continue;
    let reassigned = false;
    const visit = (node: ts.Node): void => {
      if (reassigned) return;
      if (
        ts.isBinaryExpression(node) &&
        isAssignmentOperator(node.operatorToken.kind) &&
        ts.isIdentifier(unwrapExpression(node.left)) &&
        checker.getSymbolAtLocation(unwrapExpression(node.left)) === symbol
      ) {
        reassigned = true;
        return;
      }
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        ts.isIdentifier(node.operand) &&
        checker.getSymbolAtLocation(node.operand) === symbol
      ) {
        reassigned = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (reassigned) return true;
  }
  return false;
}

function reachableServerPackageRoots(entry: ts.SourceFile, context: ProvenanceContext): string[] {
  const roots: string[] = [];
  const visited = new Set<string>();
  const visit = (sourceFile: ts.SourceFile): void => {
    const normalized = normalizeFileName(sourceFile.fileName);
    if (visited.has(normalized)) return;
    visited.add(normalized);
    for (const statement of sourceFile.statements) {
      const moduleSpecifier =
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier
          : undefined;
      if (!moduleSpecifier) continue;
      const specifier = moduleSpecifier.text;
      const resolved = resolveModule(specifier, sourceFile.fileName, context.options);
      if (!resolved) continue;
      const root = tryRealServerPackageRoot(resolved.resolvedFileName);
      if (
        root &&
        (specifier === '@kovojs/server' ||
          specifier.startsWith('@kovojs/server/') ||
          resolved.packageId?.name === '@kovojs/server')
      ) {
        roots.push(root);
        continue;
      }
      const dependency =
        context.program.getSourceFile(resolved.resolvedFileName) ??
        context.program
          .getSourceFiles()
          .find(
            (candidate) =>
              normalizeFileName(candidate.fileName) ===
              normalizeFileName(resolved.resolvedFileName),
          );
      if (dependency) visit(dependency);
    }
  };
  visit(entry);
  return unique(roots);
}

function resolveModule(
  specifier: string,
  importer: string,
  options: ts.CompilerOptions,
): ts.ResolvedModuleFull | undefined {
  return ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule;
}

function tryRealServerPackageRoot(resolvedFileName: string): string | undefined {
  let cursor: string;
  try {
    cursor = dirname(realpathSync(resolvedFileName));
  } catch {
    return undefined;
  }
  for (let depth = 0; depth < 32; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(cursor, 'package.json'), 'utf8')) as {
        name?: unknown;
      };
      if (manifest.name === '@kovojs/server') return realpathSync(cursor);
    } catch {
      // Keep walking to the physical package root.
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return undefined;
}

function snapshotRootNames(raw: CreateCompilerOwnedAppContractProjectOptions): readonly string[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.rootNames)) {
    throw new TypeError('App-contract project options.rootNames must be an own array.');
  }
  const names = raw.rootNames.map((fileName, index) => {
    if (typeof fileName !== 'string' || fileName.length === 0) {
      throw new TypeError(`App-contract project rootNames[${index}] must be a non-empty string.`);
    }
    return fileName;
  });
  if (names.length === 0) throw new TypeError('App-contract project needs at least one root file.');
  return Object.freeze([...new Set(names)].sort());
}

function appContractCompilerOptions(): ts.CompilerOptions {
  return {
    allowImportingTsExtensions: true,
    exactOptionalPropertyTypes: true,
    jsx: ts.JsxEmit.ReactJSX,
    jsxImportSource: '@kovojs/server',
    lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    noUncheckedIndexedAccess: true,
    preserveSymlinks: false,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
  };
}

function expressionContainsDeclarationFactoryAccess(expression: ts.Expression): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isPropertyAccessExpression(node) && isDeclarationFamily(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        isDeclarationFamily(staticMemberName(node.argumentExpression)))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function firstTopLevelCall(sourceFile: ts.SourceFile): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== sourceFile && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function symbolDeclaration(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): ts.Declaration | undefined {
  let symbol = checker.getSymbolAtLocation(identifier);
  const seen = new Set<ts.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(symbol)) {
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function localSymbolDeclaration(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): ts.Declaration | undefined {
  const symbol = checker.getSymbolAtLocation(identifier);
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function functionLikeDeclaration(
  declaration: ts.Declaration,
): ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | undefined {
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer;
  }
  return undefined;
}

function enclosingVariableDeclaration(node: ts.Node): ts.VariableDeclaration | undefined {
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (ts.isVariableDeclaration(cursor)) return cursor;
    cursor = cursor.parent;
  }
  return undefined;
}

function bindingMemberName(binding: ts.BindingElement): string | undefined {
  const property = binding.propertyName ?? binding.name;
  return ts.isIdentifier(property) || ts.isStringLiteralLike(property) ? property.text : undefined;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText(object.getSourceFile()) === name &&
      ts.isStringLiteralLike(property.initializer)
    ) {
      return property.initializer.text;
    }
  }
  return undefined;
}

function staticMemberName(expression: ts.Expression): string | undefined {
  const unwrapped = unwrapExpression(expression);
  return ts.isStringLiteralLike(unwrapped) ? unwrapped.text : undefined;
}

function variableDeclarationIsConst(declaration: ts.VariableDeclaration): boolean {
  return (
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isJoiningBinaryExpression(expression: ts.Expression): expression is ts.BinaryExpression {
  return (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  );
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function diagnosticAt(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  code: CompilerOwnedAppContractDiagnostic['code'],
  message: string,
): CompilerOwnedAppContractDiagnostic {
  const start = node.getStart(sourceFile);
  return {
    code,
    fileName: normalizeFileName(sourceFile.fileName),
    length: Math.max(1, node.getEnd() - start),
    message,
    start,
  };
}

function dedupeDiagnostics(
  diagnostics: readonly CompilerOwnedAppContractDiagnostic[],
): CompilerOwnedAppContractDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.code}:${diagnostic.fileName}:${diagnostic.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDeclarationFamily(value: string | undefined): value is AppContractDeclarationFamily {
  return (
    typeof value === 'string' &&
    (appContractDeclarationFamilies as readonly string[]).includes(value)
  );
}

function normalizeFileName(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

function countHandlerRoots(value: unknown): number {
  return JSON.stringify(value).split('"kind":"server.handler.root"').length - 1;
}

function unique<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort();
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}
