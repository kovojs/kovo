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
import { createCompilerSourceFileSystem } from '../source-filesystem.js';
import { typescriptRuntime as ts } from '../ts-api.js';
import {
  allComponentOptionObjectEntries,
  parseComponentModule,
  parseDiagnosticsForSourceFile,
  type CallExpressionModel,
  type ObjectLiteralEntry,
} from './parse.js';

const KOVO_QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');
let completeQueryIdentityProgramConstructions = 0;
let queryIdentityDependencyAnalyses = 0;

/** @internal Test-only observation of conservative full-Program fallbacks. */
export function completeQueryIdentityProgramConstructionsForTesting(): number {
  return completeQueryIdentityProgramConstructions;
}

/** @internal Test-only observation of dependency-sensitive query analysis. */
export function queryIdentityDependencyAnalysesForTesting(): number {
  return queryIdentityDependencyAnalyses;
}

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

  const model = parseComponentModule(fileName, source);
  const entries = allComponentOptionObjectEntries(model, 'queries');
  const sourceParseClean = parseDiagnosticsForSourceFile(model.sourceFile, source).length === 0;
  // Most component modules do not declare a query plan. Resolve metadata-owned names and
  // dependency-free aliases before reading tsconfig, constructing a confined filesystem, or
  // opening either TypeScript project. The parse-diagnostic check preserves the conservative
  // Program path for malformed source; a successful early return therefore removes work only
  // when no dependency can affect the result (SPEC §4.1, §5.2, §11.4).
  if (sourceParseClean) {
    const independent = dependencyIndependentQueryRuntimeNames(entries, options.knownNames);
    if (independent.complete) return Object.freeze(independent.names);
  }

  queryIdentityDependencyAnalyses += 1;
  const compilerOptions = queryIdentityCompilerOptions(options.rootDirectory, fileName);
  const direct = resolveFreshDirectQueryRuntimeNames({
    compilerOptions,
    entries,
    fileName,
    ...(options.knownNames === undefined ? {} : { knownNames: options.knownNames }),
    model,
    rootDirectory: options.rootDirectory,
    sourceParseClean,
  });
  if (direct !== undefined) return direct;

  const host = exactEntryCompilerHost(compilerOptions, fileName, source);
  completeQueryIdentityProgramConstructions += 1;
  const program = ts.createProgram({ host, options: compilerOptions, rootNames: [fileName] });
  const sourceFile = exactProgramSourceFile(program, fileName);
  if (sourceFile.text !== source) {
    throw new TypeError(
      `Kovo query identity project refused a stale source snapshot for ${fileName}.`,
    );
  }

  const checker = program.getTypeChecker();
  const result = initialQueryRuntimeNames(options.knownNames);
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

interface FreshDirectQueryRuntimeNameOptions {
  readonly compilerOptions: TS.CompilerOptions;
  readonly entries: readonly ObjectLiteralEntry[];
  readonly fileName: string;
  readonly knownNames?: Readonly<Record<string, string>>;
  readonly model: ReturnType<typeof parseComponentModule>;
  readonly rootDirectory: string;
  readonly sourceParseClean: boolean;
}

interface DependencyIndependentQueryRuntimeNames {
  readonly complete: boolean;
  readonly names: Record<string, string>;
}

function dependencyIndependentQueryRuntimeNames(
  entries: readonly ObjectLiteralEntry[],
  knownNames: Readonly<Record<string, string>> | undefined,
): DependencyIndependentQueryRuntimeNames {
  const names = initialQueryRuntimeNames(knownNames);
  let complete = true;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (Object.getOwnPropertyDescriptor(names, entry.key) !== undefined) continue;
    if (entry.queryBinding?.queryKeyExpression !== undefined) {
      complete = false;
      continue;
    }
    defineQueryRuntimeName(names, entry.key, entry.key);
  }
  return { complete, names };
}

/**
 * Resolve the common direct-import/app.query shape without constructing a second whole-project
 * Program. This is fresh analysis, not a query-result cache: every call reparses the component,
 * reruns TypeScript module resolution under the current tsconfig, descriptor-reads the resolved
 * provider, and asks the byte-revalidated compiler-owned app-contract project for the exact query
 * declaration fact. A barrel, alias chain, outside-root module, or ambiguous declaration returns
 * undefined and executes the complete Program resolver below (SPEC §4.1, §5.2, §11.4).
 */
function resolveFreshDirectQueryRuntimeNames(
  options: FreshDirectQueryRuntimeNameOptions,
): Readonly<Record<string, string>> | undefined {
  if (!options.sourceParseClean) return undefined;
  const fileSystem = createCompilerSourceFileSystem(options.rootDirectory);
  if (fileSystem === null) return undefined;
  const result = initialQueryRuntimeNames(options.knownNames);
  const projects = new Map<string, ReturnType<typeof createCompilerOwnedAppContractProject>>();
  for (let index = 0; index < options.entries.length; index += 1) {
    const entry = options.entries[index]!;
    if (Object.getOwnPropertyDescriptor(result, entry.key) !== undefined) continue;
    if (entry.queryBinding?.queryKeyExpression === undefined) {
      defineQueryRuntimeName(result, entry.key, entry.key);
      continue;
    }
    const runtimeName = freshDirectImportedQueryRuntimeName(entry, options, fileSystem, projects);
    if (runtimeName === undefined) return undefined;
    defineQueryRuntimeName(result, entry.key, runtimeName);
  }
  return Object.freeze(result);
}

function freshDirectImportedQueryRuntimeName(
  entry: ObjectLiteralEntry,
  options: FreshDirectQueryRuntimeNameOptions,
  fileSystem: NonNullable<ReturnType<typeof createCompilerSourceFileSystem>>,
  projects: Map<string, ReturnType<typeof createCompilerOwnedAppContractProject>>,
): string | undefined {
  const binding = entry.queryBinding;
  const span = binding?.queryKeySpan;
  const queryExpression = binding?.queryKeyExpression;
  if (span === undefined || queryExpression === undefined) return undefined;
  const node = exactNodeAtSpan(options.model.sourceFile, span.start, span.end);
  if (node === undefined || !ts.isIdentifier(unwrapExpression(node))) return undefined;
  const imported = options.model.namedImports.filter(
    (candidate) => candidate.localName === queryExpression,
  );
  if (imported.length !== 1) return undefined;
  const resolvedModule = modeInvariantResolvedModule(
    imported[0]!.moduleSpecifier,
    options.fileName,
    options.compilerOptions,
  );
  if (resolvedModule === undefined) return undefined;
  const providerFileName = resolve(resolvedModule.resolvedFileName);
  if (!withinDirectory(resolve(options.rootDirectory), providerFileName)) return undefined;
  if (!/\.[cm]?[jt]sx?$/iu.test(providerFileName) || /\.d\.[cm]?ts$/iu.test(providerFileName)) {
    return undefined;
  }
  const providerSource = fileSystem.readFile(providerFileName);
  if (providerSource === null) return undefined;
  const providerModel = parseComponentModule(providerFileName, providerSource);
  if (parseDiagnosticsForSourceFile(providerModel.sourceFile, providerSource).length > 0) {
    return undefined;
  }
  const providerCalls = providerModel.calls.filter(
    (call) => call.exportedConstName === imported[0]!.importedName,
  );
  if (providerCalls.length !== 1) return undefined;
  const providerCall = providerCalls[0]!;
  const providerCallNode = callExpressionAtSpan(
    ts as FrameworkIdentityTypeScript,
    providerModel.sourceFile,
    providerCall,
  );
  // Free `query(...)`, wrappers, and every non-direct declaration keep the complete Program path.
  // Only the exact syntactic app-member candidate opens the narrower compiler-owned proof project.
  if (providerCallNode === undefined || !isDirectQueryMemberCall(providerCallNode))
    return undefined;

  let project = projects.get(providerFileName);
  if (project === undefined) {
    try {
      project = createCompilerOwnedAppContractProject({
        rootDirectory: options.rootDirectory,
        rootNames: [providerFileName],
      });
    } catch {
      return undefined;
    }
    projects.set(providerFileName, project);
  }
  let facts: ReturnType<typeof project.staticFacts>;
  try {
    facts = project.staticFacts([{ fileName: providerFileName, source: providerSource }]);
  } catch {
    return undefined;
  }
  const expectedName = deriveRegistryIdentity(providerFileName, imported[0]!.importedName).key;
  const declarations = facts.filter(
    (fact) =>
      fact.memberName === 'query' &&
      fact.declaration?.kind === 'query' &&
      fact.declaration.name === expectedName,
  );
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0]!.declaration!;
  return providerCall.start === declaration.start && providerCall.end === declaration.end
    ? expectedName
    : undefined;
}

/**
 * A standalone parser does not own the Program's import-site resolution mode. Prove that mode is
 * irrelevant instead: resolve from fresh filesystem state under the current/default, explicit
 * import, and explicit require postures, and admit the narrow path only when every complete
 * module-resolution identity is byte-for-byte equal (including TypeScript's runtime-only path,
 * package-peer, and alternate-result fields). Conditional exports, package-format changes, and
 * any missing/ambiguous branch therefore execute the full Program resolver (SPEC §5.2 / §11.4).
 */
function modeInvariantResolvedModule(
  moduleSpecifier: string,
  containingFile: string,
  compilerOptions: TS.CompilerOptions,
): TS.ResolvedModuleFull | undefined {
  const current = ts.resolveModuleName(moduleSpecifier, containingFile, compilerOptions, ts.sys);
  const imported = ts.resolveModuleName(
    moduleSpecifier,
    containingFile,
    compilerOptions,
    ts.sys,
    undefined,
    undefined,
    ts.ModuleKind.ESNext,
  );
  const required = ts.resolveModuleName(
    moduleSpecifier,
    containingFile,
    compilerOptions,
    ts.sys,
    undefined,
    undefined,
    ts.ModuleKind.CommonJS,
  );
  if (
    current.resolvedModule === undefined ||
    imported.resolvedModule === undefined ||
    required.resolvedModule === undefined
  ) {
    return undefined;
  }
  return sameResolvedModuleResolution(current, imported) &&
    sameResolvedModuleResolution(current, required)
    ? current.resolvedModule
    : undefined;
}

function sameResolvedModuleResolution(
  left: TS.ResolvedModuleWithFailedLookupLocations,
  right: TS.ResolvedModuleWithFailedLookupLocations,
): boolean {
  if (left.resolvedModule === undefined || right.resolvedModule === undefined) return false;
  const leftAlternate = optionalOwnString(left, 'alternateResult');
  const rightAlternate = optionalOwnString(right, 'alternateResult');
  return (
    leftAlternate.valid &&
    rightAlternate.valid &&
    leftAlternate.value === rightAlternate.value &&
    sameResolvedModuleIdentity(left.resolvedModule, right.resolvedModule)
  );
}

function sameResolvedModuleIdentity(
  left: TS.ResolvedModuleFull,
  right: TS.ResolvedModuleFull,
): boolean {
  const leftOriginalPath = optionalOwnString(left, 'originalPath');
  const rightOriginalPath = optionalOwnString(right, 'originalPath');
  return (
    leftOriginalPath.valid &&
    rightOriginalPath.valid &&
    leftOriginalPath.value === rightOriginalPath.value &&
    left.resolvedFileName === right.resolvedFileName &&
    left.extension === right.extension &&
    left.isExternalLibraryImport === right.isExternalLibraryImport &&
    left.resolvedUsingTsExtension === right.resolvedUsingTsExtension &&
    samePackageIdentity(left.packageId, right.packageId)
  );
}

function samePackageIdentity(
  left: TS.PackageId | undefined,
  right: TS.PackageId | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftPeerDependencies = optionalOwnString(left, 'peerDependencies');
  const rightPeerDependencies = optionalOwnString(right, 'peerDependencies');
  return (
    leftPeerDependencies.valid &&
    rightPeerDependencies.valid &&
    leftPeerDependencies.value === rightPeerDependencies.value &&
    left.name === right.name &&
    left.subModuleName === right.subModuleName &&
    left.version === right.version
  );
}

type OptionalOwnString =
  | { readonly valid: false }
  | { readonly valid: true; readonly value: string | undefined };

function optionalOwnString(value: object, property: string): OptionalOwnString {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) {
    return property in value ? { valid: false } : { valid: true, value: undefined };
  }
  if (!Object.hasOwn(descriptor, 'value')) return { valid: false };
  const ownValue: unknown = descriptor.value;
  return ownValue === undefined || typeof ownValue === 'string'
    ? { valid: true, value: ownValue }
    : { valid: false };
}

function initialQueryRuntimeNames(
  knownNames: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const result = Object.create(null) as Record<string, string>;
  if (knownNames === undefined) return result;
  if (typeof knownNames !== 'object' || knownNames === null || Array.isArray(knownNames)) {
    throw new TypeError('Kovo query identity known names must be an own string record.');
  }
  for (const alias of Object.keys(knownNames)) {
    const descriptor = Object.getOwnPropertyDescriptor(knownNames, alias);
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(
        `Kovo query identity known name "${alias}" must be an own string data property.`,
      );
    }
    const runtimeName = descriptor.value;
    defineQueryRuntimeName(result, alias, runtimeName);
  }
  return result;
}

function defineQueryRuntimeName(
  result: Record<string, string>,
  alias: string,
  runtimeName: string,
): void {
  Object.defineProperty(result, alias, {
    configurable: false,
    enumerable: true,
    value: runtimeName,
    writable: false,
  });
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
  if (ts.isShorthandPropertyAssignment(node)) {
    // SPEC §4.1: `{ queries: { status } }` still carries the declaration's source-derived
    // identity. Follow TypeScript's exact shorthand-value symbol; spelling alone proves nothing.
    const symbol = context.checker.getShorthandAssignmentValueSymbol(node);
    return runtimeNameForDeclaration(
      resolvedSymbolDeclaration(context.checker, symbol),
      context,
      seen,
      depth + 1,
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
      resolvedSymbolDeclaration(context.checker, symbol),
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
  return resolvedSymbolDeclaration(checker, checker.getSymbolAtLocation(node));
}

function resolvedSymbolDeclaration(
  checker: TS.TypeChecker,
  initial: TS.Symbol | undefined,
): TS.Declaration | undefined {
  let symbol = initial;
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
    const read = ts.readConfigFile(configFile, (configFileName) => ts.sys.readFile(configFileName));
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
