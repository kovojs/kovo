import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type * as TS from 'typescript';

import {
  callExpressionAtSpan,
  frameworkExport,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

import { createCompilerOwnedAppContractProject } from '../app-contract-project.js';
import { compilerOwnedAppContractFactoryEquals } from '../app-contract-resolver.js';
import { canonicalJson } from '../canonical-json.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFreeze,
  compilerMapGet,
  compilerMapSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerPinnedStableMethod,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import { deriveRegistryIdentity } from '../registry-identities.js';
import { typescriptRuntime as ts } from '../ts-api.js';
import {
  allComponentOptionObjectEntries,
  parseComponentModule,
  parseDiagnosticsForSourceFile,
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
 * Build the exact same-file source preimage that can affect query-identity resolution.
 *
 * A component's parser-proven `render` initializer is a lexical child scope and cannot declare a
 * binding visible to its sibling `queries` option. Its body is therefore omitted so ordinary JSX
 * output edits can reuse a prior full Program proof. Everything else stays byte-exact: imports,
 * query objects, module-scope/local aliases, declaration spelling, and component structure. Static
 * module specifiers outside that scope remain byte-exact. Module-affecting syntax inside an
 * omitted render scope refuses reuse: the parser's ordinary module-specifier inventory is not a
 * complete proof of every TypeScript Program dependency (for example, ImportTypeNode). Any
 * ambiguity therefore falls back to a fresh Program rather than widening reuse.
 */
export function componentQueryRuntimeIdentityPreimage(
  options: Pick<QueryRuntimeIdentityProjectOptions, 'fileName' | 'knownNames' | 'source'>,
): string | undefined {
  const model = parseComponentModule(options.fileName, options.source);
  if (parseDiagnosticsForSourceFile(model.sourceFile, options.source).length > 0) return undefined;
  // Reuse is deliberately narrower than the resolver. Every identity the compiler did not
  // already provide must be a bare identifier backed by one unambiguous direct named import.
  // Namespace/member chains and local aliases keep using a fresh Program: proving their semantic
  // dependency closure cheaply would otherwise risk turning spelling into authority (SPEC §4.1).
  const queryEntries = allComponentOptionObjectEntries(model, 'queries');
  const queryEntryLength = compilerArrayLength(queryEntries, 'Query identity preimage entries');
  for (let entryIndex = 0; entryIndex < queryEntryLength; entryIndex += 1) {
    const entry = compilerOwnDataValue(
      queryEntries,
      entryIndex,
      'Query identity preimage entries',
    ) as ObjectLiteralEntry | undefined;
    if (!entry) throw new TypeError(`Query identity preimage entries[${entryIndex}] missing.`);
    if (
      options.knownNames !== undefined &&
      compilerOwnDataValue(options.knownNames, entry.key, 'Known query runtime names') !== undefined
    ) {
      continue;
    }
    const binding = entry.queryBinding;
    if (binding?.queryKeyExpression === undefined) continue;
    const span = binding.queryKeySpan;
    const node =
      span === undefined ? undefined : exactNodeAtSpan(model.sourceFile, span.start, span.end);
    if (node === undefined || !ts.isIdentifier(unwrapExpression(node))) return undefined;
    let matchingImports = 0;
    const namedImportLength = compilerArrayLength(
      model.namedImports,
      'Query identity preimage named imports',
    );
    for (let importIndex = 0; importIndex < namedImportLength; importIndex += 1) {
      const imported = compilerOwnDataValue(
        model.namedImports,
        importIndex,
        'Query identity preimage named imports',
      ) as (typeof model.namedImports)[number] | undefined;
      if (!imported) {
        throw new TypeError(`Query identity preimage named imports[${importIndex}] missing.`);
      }
      if (imported.localName === binding.queryKeyExpression) matchingImports += 1;
    }
    if (matchingImports !== 1) return undefined;
  }

  const renderOptionSpans = compilerCreateSet<string>();
  const componentLength = compilerArrayLength(model.components, 'Query preimage components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = compilerOwnDataValue(
      model.components,
      componentIndex,
      'Query preimage components',
    ) as (typeof model.components)[number] | undefined;
    if (!component) throw new TypeError(`Query preimage components[${componentIndex}] missing.`);
    const optionLength = compilerArrayLength(component.options, 'Query preimage component options');
    for (let optionIndex = 0; optionIndex < optionLength; optionIndex += 1) {
      const option = compilerOwnDataValue(
        component.options,
        optionIndex,
        'Query preimage component options',
      ) as (typeof component.options)[number] | undefined;
      if (!option) throw new TypeError(`Query preimage component options[${optionIndex}] missing.`);
      if (option.key === 'render') {
        compilerSetAdd(renderOptionSpans, `${option.start}:${option.end}`);
      }
    }
  }

  const omitted: Array<{ end: number; kind: number; start: number }> = [];
  let moduleAffectingSyntaxInOmittedRender = false;
  let nestedQueriesInOmittedRender = false;
  const visit = (node: TS.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const nameStart = node.name.getStart(model.sourceFile);
      const nameEnd = node.name.getEnd();
      if (compilerSetHas(renderOptionSpans, `${nameStart}:${nameEnd}`)) {
        const inspectOmittedInitializer = (candidate: TS.Node): void => {
          if (
            ts.isJSDocImportTag(candidate) ||
            ts.isImportTypeNode(candidate) ||
            ts.isImportEqualsDeclaration(candidate) ||
            ts.isExternalModuleReference(candidate) ||
            ts.isModuleDeclaration(candidate) ||
            (ts.isCallExpression(candidate) &&
              (candidate.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(candidate.expression) && candidate.expression.text === 'require')))
          ) {
            moduleAffectingSyntaxInOmittedRender = true;
            return;
          }
          if (
            (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate)) &&
            ((ts.isIdentifier(candidate.name) && candidate.name.text === 'queries') ||
              (ts.isStringLiteralLike(candidate.name) && candidate.name.text === 'queries'))
          ) {
            nestedQueriesInOmittedRender = true;
            return;
          }
          const jsDoc = compilerOwnDataValue(
            candidate,
            'jsDoc',
            'Query identity omitted render JSDoc',
          );
          if (jsDoc !== undefined) {
            const jsDocLength = compilerArrayLength(
              jsDoc as readonly TS.JSDoc[],
              'Query identity omitted render JSDoc',
            );
            for (let jsDocIndex = 0; jsDocIndex < jsDocLength; jsDocIndex += 1) {
              const document = compilerOwnDataValue(
                jsDoc as readonly TS.JSDoc[],
                jsDocIndex,
                'Query identity omitted render JSDoc',
              ) as TS.JSDoc | undefined;
              if (!document) {
                throw new TypeError(`Query identity omitted render JSDoc[${jsDocIndex}] missing.`);
              }
              inspectOmittedInitializer(document);
            }
          }
          if (!nestedQueriesInOmittedRender && !moduleAffectingSyntaxInOmittedRender) {
            ts.forEachChild(candidate, inspectOmittedInitializer);
          }
        };
        inspectOmittedInitializer(node.initializer);
        compilerArrayAppend(
          omitted,
          {
            end: node.initializer.getEnd(),
            kind: node.initializer.kind,
            start: node.initializer.getStart(model.sourceFile),
          },
          'Query identity omitted render initializers',
        );
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(model.sourceFile);
  if (nestedQueriesInOmittedRender || moduleAffectingSyntaxInOmittedRender) return undefined;

  // A nested component/query declaration inside an omitted outer render scope would make that
  // scope semantically relevant. Refuse reuse rather than hiding any nested query alias bytes.
  const omittedLength = compilerArrayLength(omitted, 'Query identity omitted render initializers');
  for (let spanIndex = 0; spanIndex < omittedLength; spanIndex += 1) {
    const span = compilerOwnDataValue(
      omitted,
      spanIndex,
      'Query identity omitted render initializers',
    ) as (typeof omitted)[number] | undefined;
    if (!span)
      throw new TypeError(`Query identity omitted render initializers[${spanIndex}] missing.`);
    for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
      const component = compilerOwnDataValue(
        model.components,
        componentIndex,
        'Query preimage components',
      ) as (typeof model.components)[number] | undefined;
      if (!component) throw new TypeError(`Query preimage components[${componentIndex}] missing.`);
      const optionLength = compilerArrayLength(
        component.options,
        'Query preimage component options',
      );
      for (let optionIndex = 0; optionIndex < optionLength; optionIndex += 1) {
        const option = compilerOwnDataValue(
          component.options,
          optionIndex,
          'Query preimage component options',
        ) as (typeof component.options)[number] | undefined;
        if (!option) {
          throw new TypeError(`Query preimage component options[${optionIndex}] missing.`);
        }
        if (option.key === 'queries' && option.start >= span.start && option.end <= span.end) {
          return undefined;
        }
      }
    }
  }

  const retainedSourceSegments: string[] = [];
  const renderInitializerKinds: number[] = [];
  let cursor = 0;
  for (let spanIndex = 0; spanIndex < omittedLength; spanIndex += 1) {
    const span = compilerOwnDataValue(
      omitted,
      spanIndex,
      'Query identity omitted render initializers',
    ) as (typeof omitted)[number] | undefined;
    if (!span)
      throw new TypeError(`Query identity omitted render initializers[${spanIndex}] missing.`);
    if (span.start < cursor || span.end < span.start || span.end > options.source.length) {
      throw new TypeError(
        `Kovo query identity preimage refused overlapping render spans in ${options.fileName}.`,
      );
    }
    compilerArrayAppend(
      retainedSourceSegments,
      compilerStringSlice(options.source, cursor, span.start),
      'Query identity retained source segments',
    );
    compilerArrayAppend(
      renderInitializerKinds,
      span.kind,
      'Query identity render initializer kinds',
    );
    cursor = span.end;
  }
  compilerArrayAppend(
    retainedSourceSegments,
    compilerStringSlice(options.source, cursor),
    'Query identity retained source segments',
  );

  const moduleSpecifiers: string[] = [];
  const moduleSpecifierLength = compilerArrayLength(
    model.moduleSpecifiers,
    'Query identity module specifiers',
  );
  for (let index = 0; index < moduleSpecifierLength; index += 1) {
    const specifier = compilerOwnDataValue(
      model.moduleSpecifiers,
      index,
      'Query identity module specifiers',
    ) as (typeof model.moduleSpecifiers)[number] | undefined;
    if (!specifier) throw new TypeError(`Query identity module specifiers[${index}] missing.`);
    compilerArrayAppend(moduleSpecifiers, specifier.specifier, 'Query identity module specifiers');
  }

  return canonicalJson({
    moduleSpecifiers,
    renderInitializerKinds,
    retainedSourceSegments,
  });
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
  if (source.length === 0) return compilerFreeze(compilerCreateNullRecord<string>());

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
  const result = compilerCreateNullRecord<string>();
  const knownNames = options.knownNames;
  if (knownNames !== undefined) {
    const knownAliases = compilerObjectKeys(knownNames);
    const knownAliasLength = compilerArrayLength(knownAliases, 'Known query runtime aliases');
    for (let index = 0; index < knownAliasLength; index += 1) {
      const alias = compilerOwnDataValue(knownAliases, index, 'Known query runtime aliases');
      if (typeof alias !== 'string') {
        throw new TypeError(`Known query runtime aliases[${index}] must be a string.`);
      }
      const runtimeName = compilerOwnDataValue(knownNames, alias, 'Known query runtime names');
      if (typeof runtimeName !== 'string') {
        throw new TypeError(`Known query runtime name ${alias} must be a string.`);
      }
      compilerDefineOwnDataProperty(result, alias, runtimeName);
    }
  }
  const models = compilerCreateMap<string, ReturnType<typeof parseComponentModule>>();
  compilerMapSet(models, fileName, model);
  const context: QueryRuntimeIdentityResolutionContext = {
    appContractProjects: compilerCreateMap(),
    checker,
    models,
    rootDirectory: options.rootDirectory,
  };

  const entryLength = compilerArrayLength(entries, 'Query runtime identity entries');
  for (let index = 0; index < entryLength; index += 1) {
    const entry = compilerOwnDataValue(entries, index, 'Query runtime identity entries') as
      | ObjectLiteralEntry
      | undefined;
    if (!entry) throw new TypeError(`Query runtime identity entries[${index}] missing.`);
    const known = compilerOwnDataValue(result, entry.key, 'Resolved query runtime names');
    if (known !== undefined) continue;
    const runtimeName = runtimeNameForQueryEntry(entry, sourceFile, context);
    const existing = compilerOwnDataValue(result, entry.key, 'Resolved query runtime names');
    if (existing !== undefined && existing !== runtimeName) {
      throw new TypeError(
        `Kovo query identity project resolved conflicting identities for component alias "${entry.key}".`,
      );
    }
    if (existing === undefined) compilerDefineOwnDataProperty(result, entry.key, runtimeName);
  }
  return compilerFreeze(result);
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
    ? runtimeNameForExpression(node, context, compilerCreateSet<TS.Node>(), 0)
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
  if (depth > 32 || compilerSetHas(seen, rawNode)) return undefined;
  compilerSetAdd(seen, rawNode);
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
  if (!declaration || compilerSetHas(seen, declaration)) return undefined;
  compilerSetAdd(seen, declaration);
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
  const explicitKey = compilerOwnDataValue(
    call.argumentStaticValues,
    0,
    'Query declaration static arguments',
  );
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
  let project = compilerMapGet(context.appContractProjects, fileName);
  if (project === undefined) {
    project = createCompilerOwnedAppContractProject({
      rootDirectory: context.rootDirectory,
      rootNames: [fileName],
    });
    compilerMapSet(context.appContractProjects, fileName, project);
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
  let model = compilerMapGet(models, sourceFile.fileName);
  if (model === undefined) {
    model = parseComponentModule(sourceFile.fileName, sourceFile.text);
    compilerMapSet(models, sourceFile.fileName, model);
  }
  const initializer = unwrapExpression(declaration.initializer!);
  if (!ts.isCallExpression(initializer)) return undefined;
  const start = initializer.getStart(sourceFile);
  const callLength = compilerArrayLength(model.calls, 'Query declaration calls');
  for (let index = 0; index < callLength; index += 1) {
    const call = compilerOwnDataValue(model.calls, index, 'Query declaration calls') as
      | CallExpressionModel
      | undefined;
    if (!call) throw new TypeError(`Query declaration calls[${index}] missing.`);
    if (call.start !== start || call.end !== initializer.end) continue;
    if (call.frameworkFactory === 'query') return call;
    const astCall = callExpressionAtSpan(ts as FrameworkIdentityTypeScript, model.sourceFile, call);
    const matches = astCall
      ? compilerOwnedAppContractFactoryEquals(
          ts as FrameworkIdentityTypeScript,
          model.sourceFile,
          astCall.expression,
          KOVO_QUERY_IDENTITY,
        )
      : false;
    if (matches) return call;
  }
  return undefined;
}

function resolvedDeclaration(checker: TS.TypeChecker, node: TS.Node): TS.Declaration | undefined {
  return resolvedSymbolDeclaration(checker, checker.getSymbolAtLocation(node));
}

function resolvedSymbolDeclaration(
  checker: TS.TypeChecker,
  initial: TS.Symbol | undefined,
): TS.Declaration | undefined {
  let symbol = initial;
  const seen = compilerCreateSet<TS.Symbol>();
  while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0 && !compilerSetHas(seen, symbol)) {
    compilerSetAdd(seen, symbol);
    symbol = checker.getAliasedSymbol(symbol);
  }
  if (symbol === undefined) return undefined;
  const valueDeclaration = compilerOwnDataValue(
    symbol,
    'valueDeclaration',
    'Resolved query symbol',
  ) as TS.Declaration | undefined;
  if (valueDeclaration !== undefined) return valueDeclaration;
  const declarations = compilerOwnDataValue(symbol, 'declarations', 'Resolved query symbol') as
    | readonly TS.Declaration[]
    | undefined;
  if (declarations === undefined) return undefined;
  const declarationLength = compilerArrayLength(declarations, 'Resolved query declarations');
  if (declarationLength === 0) return undefined;
  return compilerOwnDataValue(declarations, 0, 'Resolved query declarations') as
    | TS.Declaration
    | undefined;
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
  const getSourceFile = compilerPinnedStableMethod(
    host,
    'getSourceFile',
    'Query identity compiler host.getSourceFile',
  ) as TS.CompilerHost['getSourceFile'];
  const readFile = compilerPinnedStableMethod(
    host,
    'readFile',
    'Query identity compiler host.readFile',
  ) as NonNullable<TS.CompilerHost['readFile']>;
  const fileExists = compilerPinnedStableMethod(
    host,
    'fileExists',
    'Query identity compiler host.fileExists',
  ) as NonNullable<TS.CompilerHost['fileExists']>;
  // Delegate through a distinct carrier. The pinned methods recheck their original host owner, so
  // replacing that owner's properties would correctly look like tampering rather than wrapping.
  return {
    ...host,
    fileExists: (candidate) => sameFile(candidate, fileName) || fileExists(candidate),
    getSourceFile: (candidate, languageVersion, onError, shouldCreateNewSourceFile) =>
      sameFile(candidate, fileName)
        ? ts.createSourceFile(
            candidate,
            source,
            languageVersion,
            true,
            scriptKindForFileName(candidate),
          )
        : getSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile),
    readFile: (candidate) => (sameFile(candidate, fileName) ? source : readFile(candidate)),
  };
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
  return path === '' || (!compilerStringStartsWith(path, '..') && !isAbsolute(path));
}

function exactProgramSourceFile(program: TS.Program, fileName: string): TS.SourceFile {
  let exact = program.getSourceFile(fileName);
  if (exact === undefined) {
    const sourceFiles = program.getSourceFiles();
    const sourceFileLength = compilerArrayLength(sourceFiles, 'Query identity Program sources');
    for (let index = 0; index < sourceFileLength; index += 1) {
      const sourceFile = compilerOwnDataValue(
        sourceFiles,
        index,
        'Query identity Program sources',
      ) as TS.SourceFile | undefined;
      if (!sourceFile) throw new TypeError(`Query identity Program sources[${index}] missing.`);
      if (!sameFile(sourceFile.fileName, fileName)) continue;
      exact = sourceFile;
      break;
    }
  }
  if (exact === undefined) {
    throw new TypeError(`Kovo query identity project does not contain ${fileName}.`);
  }
  return exact;
}

function scriptKindForFileName(fileName: string): TS.ScriptKind {
  if (compilerRegExpTest(/\.tsx$/iu, fileName)) return ts.ScriptKind.TSX;
  if (compilerRegExpTest(/\.jsx$/iu, fileName)) return ts.ScriptKind.JSX;
  if (compilerRegExpTest(/\.[cm]?js$/iu, fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function sameFile(left: string, right: string): boolean {
  return (
    compilerStringReplaceAll(resolve(left), '\\', '/') ===
    compilerStringReplaceAll(resolve(right), '\\', '/')
  );
}

function unresolvedQueryIdentity(alias: string, expression: string): TypeError {
  return new TypeError(
    `Kovo could not prove the exact runtime query identity for component alias "${alias}" ` +
      `from "${expression}". Export a source-derived query (or give it an explicit key) so ` +
      'SSR, the query store, and generated update plans share one identity.',
  );
}
