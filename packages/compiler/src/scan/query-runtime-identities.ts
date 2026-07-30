import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type * as TS from 'typescript';

import {
  callExpressionAtSpan,
  frameworkExport,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import { createCompilerOwnedAppContractProject } from '../app-contract-project.js';
import { compilerOwnedAppContractFactoryEquals } from '../app-contract-resolver.js';
import { deriveRegistryIdentity } from '../registry-identities.js';
import { typescriptRuntime as ts } from '../ts-api.js';
import {
  allComponentOptionObjectEntries,
  parseComponentModule,
  type CallExpressionModel,
  type ObjectLiteralEntry,
} from './parse.js';

const KOVO_QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');

export interface QueryRuntimeIdentityProjectOptions {
  readonly fileName: string;
  readonly knownNames?: Readonly<Record<string, string>>;
  readonly rootDirectory: string;
  readonly source: string;
}

interface QueryRuntimeIdentityResolutionContext {
  readonly appContractProjects: Map<
    string,
    ReturnType<typeof createCompilerOwnedAppContractProject>
  >;
  readonly checker: TS.TypeChecker;
  readonly models: Map<string, ReturnType<typeof parseComponentModule>>;
  readonly rootDirectory: string;
}

/**
 * Resolve component-local query aliases through one exact compiler-owned TypeScript Program.
 * This is the Vite/build counterpart to SSR's runtime `.key` read: aliases, namespace members,
 * barrels, and tsconfig path mappings all resolve to the declaration that owns the wire identity.
 */
export function resolveComponentQueryRuntimeNames(
  options: QueryRuntimeIdentityProjectOptions,
): Readonly<Record<string, string>> {
  const fileName = resolve(options.fileName);
  const source = options.source;
  if (source.length === 0) return Object.freeze(Object.create(null) as Record<string, string>);

  const compilerOptions = queryIdentityCompilerOptions(options.rootDirectory, fileName);
  const host = exactEntryCompilerHost(compilerOptions, fileName, source);
  const program = ts.createProgram({ host, options: compilerOptions, rootNames: [fileName] });
  const sourceFile = exactProgramSourceFile(program, fileName);
  if (sourceFile.text !== source) {
    throw new TypeError(
      `Kovo query identity project refused a stale source snapshot for ${fileName}.`,
    );
  }

  const checker = program.getTypeChecker();
  const model = parseComponentModule(fileName, source);
  const entries = allComponentOptionObjectEntries(model, 'queries');
  const result = Object.create(null) as Record<string, string>;
  for (const [alias, runtimeName] of Object.entries(options.knownNames ?? {})) {
    Object.defineProperty(result, alias, {
      configurable: false,
      enumerable: true,
      value: runtimeName,
      writable: false,
    });
  }
  const models = new Map<string, ReturnType<typeof parseComponentModule>>([[fileName, model]]);
  const context: QueryRuntimeIdentityResolutionContext = {
    appContractProjects: new Map(),
    checker,
    models,
    rootDirectory: options.rootDirectory,
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const known = Object.getOwnPropertyDescriptor(result, entry.key);
    if (known !== undefined) continue;
    const runtimeName = runtimeNameForQueryEntry(entry, sourceFile, context);
    const descriptor = Object.getOwnPropertyDescriptor(result, entry.key);
    if (descriptor && descriptor.value !== runtimeName) {
      throw new TypeError(
        `Kovo query identity project resolved conflicting identities for component alias "${entry.key}".`,
      );
    }
    Object.defineProperty(result, entry.key, {
      configurable: false,
      enumerable: true,
      value: runtimeName,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function runtimeNameForQueryEntry(
  entry: ObjectLiteralEntry,
  sourceFile: TS.SourceFile,
  context: QueryRuntimeIdentityResolutionContext,
): string {
  const binding = entry.queryBinding;
  if (binding?.queryKeyExpression === undefined) return entry.key;
  const span = binding.queryKeySpan;
  if (span === undefined) {
    throw unresolvedQueryIdentity(entry.key, binding.queryKeyExpression);
  }
  const node = exactNodeAtSpan(sourceFile, span.start, span.end);
  const identity = node
    ? runtimeNameForExpression(node, context, new Set<TS.Node>(), 0)
    : undefined;
  if (identity === undefined) {
    throw unresolvedQueryIdentity(entry.key, binding.queryKeyExpression);
  }
  return identity;
}

function runtimeNameForExpression(
  rawNode: TS.Node,
  context: QueryRuntimeIdentityResolutionContext,
  seen: Set<TS.Node>,
  depth: number,
): string | undefined {
  if (depth > 32 || seen.has(rawNode)) return undefined;
  seen.add(rawNode);
  const node = unwrapExpression(rawNode);
  if (ts.isIdentifier(node)) {
    return runtimeNameForDeclaration(
      resolvedDeclaration(context.checker, node),
      context,
      seen,
      depth,
    );
  }
  if (ts.isPropertyAccessExpression(node)) {
    return runtimeNameForDeclaration(
      resolvedDeclaration(context.checker, node.name),
      context,
      seen,
      depth,
    );
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    (ts.isStringLiteralLike(node.argumentExpression) ||
      ts.isNumericLiteral(node.argumentExpression))
  ) {
    return runtimeNameForDeclaration(
      resolvedDeclaration(context.checker, node.argumentExpression),
      context,
      seen,
      depth,
    );
  }
  return undefined;
}

function runtimeNameForDeclaration(
  declaration: TS.Declaration | undefined,
  context: QueryRuntimeIdentityResolutionContext,
  seen: Set<TS.Node>,
  depth: number,
): string | undefined {
  if (!declaration || seen.has(declaration)) return undefined;
  seen.add(declaration);
  if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    const direct = directQueryDeclarationIdentity(declaration, context);
    if (direct !== undefined) return direct;
    return declaration.initializer
      ? runtimeNameForExpression(declaration.initializer, context, seen, depth + 1)
      : undefined;
  }
  if (ts.isPropertyAssignment(declaration)) {
    return runtimeNameForExpression(declaration.initializer, context, seen, depth + 1);
  }
  if (ts.isShorthandPropertyAssignment(declaration)) {
    const symbol = context.checker.getShorthandAssignmentValueSymbol(declaration);
    return runtimeNameForDeclaration(
      symbol?.valueDeclaration ?? symbol?.declarations?.[0],
      context,
      seen,
      depth + 1,
    );
  }
  return undefined;
}

function directQueryDeclarationIdentity(
  declaration: TS.VariableDeclaration,
  context: QueryRuntimeIdentityResolutionContext,
): string | undefined {
  if (!declaration.initializer || !ts.isIdentifier(declaration.name)) return undefined;
  let call = queryDeclarationCall(declaration, context.models);
  // Ordinary framework query imports resolve without another Program. Only an unresolved, typed
  // direct `.query()` candidate opens the finite declaration-file project below; that project must
  // still prove the exact defineKovo receiver, so structural member lookalikes gain no authority.
  if (call === undefined && isDirectQueryMemberCall(declaration.initializer)) {
    call = queryDeclarationCallWithAppContractResolution(declaration, context);
  }
  if (call === undefined) return undefined;
  const explicitKey = call.argumentStaticValues[0];
  if (typeof explicitKey === 'string') return explicitKey;
  if (call.exportedConstName !== declaration.name.text) return undefined;
  return deriveRegistryIdentity(declaration.getSourceFile().fileName, declaration.name.text).key;
}

function queryDeclarationCallWithAppContractResolution(
  declaration: TS.VariableDeclaration,
  context: QueryRuntimeIdentityResolutionContext,
): CallExpressionModel | undefined {
  const sourceFile = declaration.getSourceFile();
  const fileName = resolve(sourceFile.fileName);
  let project = context.appContractProjects.get(fileName);
  if (project === undefined) {
    project = createCompilerOwnedAppContractProject({
      rootDirectory: context.rootDirectory,
      rootNames: [fileName],
    });
    context.appContractProjects.set(fileName, project);
  }
  return project.withEntryResolutions(fileName, (projectSource) => {
    if (projectSource !== sourceFile.text) {
      throw new TypeError(
        `Kovo query identity project refused a stale app-contract source snapshot for ${fileName}.`,
      );
    }
    return queryDeclarationCall(declaration, context.models);
  });
}

function isDirectQueryMemberCall(node: TS.Expression): boolean {
  const expression = unwrapExpression(node);
  if (!ts.isCallExpression(expression)) return false;
  const callee = unwrapExpression(expression.expression);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'query';
}

function queryDeclarationCall(
  declaration: TS.VariableDeclaration,
  models: Map<string, ReturnType<typeof parseComponentModule>>,
): CallExpressionModel | undefined {
  const sourceFile = declaration.getSourceFile();
  let model = models.get(sourceFile.fileName);
  if (model === undefined) {
    model = parseComponentModule(sourceFile.fileName, sourceFile.text);
    models.set(sourceFile.fileName, model);
  }
  const initializer = unwrapExpression(declaration.initializer!);
  if (!ts.isCallExpression(initializer)) return undefined;
  const start = initializer.getStart(sourceFile);
  return model.calls.find((call) => {
    if (call.start !== start || call.end !== initializer.end) return false;
    if (call.frameworkFactory === 'query') return true;
    const astCall = callExpressionAtSpan(ts as FrameworkIdentityTypeScript, model.sourceFile, call);
    return astCall
      ? compilerOwnedAppContractFactoryEquals(
          ts as FrameworkIdentityTypeScript,
          model.sourceFile,
          astCall.expression,
          KOVO_QUERY_IDENTITY,
        )
      : false;
  });
}

function resolvedDeclaration(checker: TS.TypeChecker, node: TS.Node): TS.Declaration | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  const seen = new Set<TS.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(symbol)) {
    seen.add(symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
}

function exactNodeAtSpan(
  sourceFile: TS.SourceFile,
  start: number,
  end: number,
): TS.Node | undefined {
  let found: TS.Node | undefined;
  const visit = (node: TS.Node): void => {
    if (found || node.end < end || node.getStart(sourceFile) > start) return;
    if (node.getStart(sourceFile) === start && node.end === end) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function unwrapExpression(node: TS.Node): TS.Node {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isPartiallyEmittedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function exactEntryCompilerHost(
  options: TS.CompilerOptions,
  fileName: string,
  source: string,
): TS.CompilerHost {
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (candidate) => sameFile(candidate, fileName) || fileExists(candidate);
  host.readFile = (candidate) => (sameFile(candidate, fileName) ? source : readFile(candidate));
  host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) =>
    sameFile(candidate, fileName)
      ? ts.createSourceFile(
          candidate,
          source,
          languageVersion,
          true,
          scriptKindForFileName(candidate),
        )
      : getSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile);
  return host;
}

function queryIdentityCompilerOptions(rootDirectory: string, fileName: string): TS.CompilerOptions {
  const configFile = boundedTsConfig(rootDirectory, dirname(fileName));
  let configured: TS.CompilerOptions = {};
  if (configFile !== undefined) {
    const read = ts.readConfigFile(configFile, ts.sys.readFile);
    if (read.error) {
      throw new TypeError(`Kovo query identity project could not read ${configFile}.`);
    }
    configured = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configFile)).options;
  }
  return {
    ...configured,
    allowJs: true,
    allowImportingTsExtensions: true,
    jsx: configured.jsx ?? ts.JsxEmit.ReactJSX,
    jsxImportSource: configured.jsxImportSource ?? '@kovojs/server',
    module: configured.module ?? ts.ModuleKind.NodeNext,
    moduleResolution: configured.moduleResolution ?? ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    preserveSymlinks: false,
    skipLibCheck: true,
    target: configured.target ?? ts.ScriptTarget.ES2024,
  };
}

function boundedTsConfig(rootDirectory: string, startDirectory: string): string | undefined {
  const boundary = resolve(rootDirectory);
  let current = resolve(startDirectory);
  if (!withinDirectory(boundary, current)) return undefined;
  for (;;) {
    const candidate = join(current, 'tsconfig.json');
    if (ts.sys.fileExists(candidate)) return candidate;
    if (sameFile(current, boundary)) return undefined;
    current = dirname(current);
  }
}

function withinDirectory(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function exactProgramSourceFile(program: TS.Program, fileName: string): TS.SourceFile {
  const exact =
    program.getSourceFile(fileName) ??
    program.getSourceFiles().find((sourceFile) => sameFile(sourceFile.fileName, fileName));
  if (exact === undefined) {
    throw new TypeError(`Kovo query identity project does not contain ${fileName}.`);
  }
  return exact;
}

function scriptKindForFileName(fileName: string): TS.ScriptKind {
  if (/\.tsx$/iu.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/iu.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/iu.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function sameFile(left: string, right: string): boolean {
  return resolve(left).replaceAll('\\', '/') === resolve(right).replaceAll('\\', '/');
}

function unresolvedQueryIdentity(alias: string, expression: string): TypeError {
  return new TypeError(
    `Kovo could not prove the exact runtime query identity for component alias "${alias}" ` +
      `from "${expression}". Export a source-derived query (or give it an explicit key) so ` +
      'SSR, the query store, and generated update plans share one identity.',
  );
}
