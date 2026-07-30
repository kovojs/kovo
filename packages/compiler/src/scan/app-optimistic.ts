import {
  clientModuleHrefForSourceFile,
  clientModuleRepresentationDigest,
  parseVersionedClientModuleTarget,
} from '@kovojs/core/internal/client-module-url';
import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import { canonicalQueryInstanceKeyCodecFactorySource } from '@kovojs/core/internal/wire-input-grammar';
import type * as TS from 'typescript';
import { typescriptRuntime as ts } from '../ts-api.js';

import type { CompilerOwnedAppContractMemberResolution } from '../app-contract-resolver.js';
import { compilerIrHeader } from '../ir.js';
import { deriveMutationKey } from '../mutation-names.js';
import { deriveRegistryIdentity } from '../registry-identities.js';
import type {
  MutationInputFieldFact,
  OptimisticModuleFact,
  OptimisticMutationFact,
  OptimisticTransformStatus,
} from '../types.js';
import { propertyNameText } from './ast.js';
import type { ProjectMutationSourceFile } from './project-mutation-bindings.js';

const OPTIMISTIC_PLAN_SCHEMA = 'kovo.optimistic-plan/v2' as const;
const MAX_OPTIMISTIC_BINDINGS = 1_024;
const SCHEMA_IDENTITY = frameworkExport('@kovojs/server', 's');

/** Project facts added to the ordinary mutation registry census. */
export interface AppOptimisticProjectFacts {
  readonly mutationOptimism: Readonly<Record<string, OptimisticMutationFact>>;
  readonly optimisticModules: readonly OptimisticModuleFact[];
}

interface QueryDeclaration {
  readonly argsFields?: readonly string[];
  readonly fileName: string;
  readonly hasArgs: boolean;
  readonly hasCustomInstanceKey: boolean;
  readonly key: string;
  readonly ownerKey: string;
  readonly start: number;
  readonly symbol: TS.Symbol;
}

interface MutationDeclaration {
  readonly call: TS.CallExpression;
  readonly definition: TS.ObjectLiteralExpression;
  readonly fileName: string;
  readonly input: TS.Expression | null;
  readonly key: string;
  readonly localName: string;
  readonly ownerKey: string;
  readonly queue?: string;
}

interface OptimisticTransform {
  readonly apply?: string;
  readonly applyNode?: TS.Node;
  readonly keys?: string;
  readonly keyFields?: readonly string[];
  readonly keysNode?: TS.Node;
  readonly query: string;
  readonly status: OptimisticTransformStatus;
}

interface LoweredMutation {
  readonly declaration: MutationDeclaration;
  readonly inputFields: readonly MutationInputFieldFact[];
  readonly transforms: readonly OptimisticTransform[];
}

interface RuntimeDependency {
  readonly aliases: Set<string>;
  readonly declaration: TS.FunctionDeclaration | TS.VariableDeclaration;
  readonly symbol: TS.Symbol;
}

/**
 * Lower exact app-member facts from one compiler-owned TypeScript Program into immutable browser
 * plan modules. The caller must pass the member facts retained by that same Program; no source
 * spelling can mint app/query authority after this boundary (SPEC §5.2 rules 2, 9, and 10).
 */
export function appOptimisticProjectFacts(options: {
  readonly checker: TS.TypeChecker;
  readonly files: readonly ProjectMutationSourceFile[];
  readonly members: readonly CompilerOwnedAppContractMemberResolution[];
  readonly mutationInputs: Readonly<Record<string, readonly MutationInputFieldFact[]>>;
  readonly program: TS.Program;
}): AppOptimisticProjectFacts {
  const sourceFileNames = new Set(
    options.files.map((file) => normalizeFileName(options.program, file.fileName)),
  );
  const queryBySymbol = new Map<TS.Symbol, QueryDeclaration>();
  const mutations: MutationDeclaration[] = [];
  const projectDependencies = appOptimisticProjectDependencies(
    options.checker,
    options.program,
    sourceFileNames,
  );

  for (const member of options.members) {
    const call = member.node.parent;
    if (!ts.isCallExpression(call) || call.expression !== member.node) continue;
    const variable = enclosingVariableDeclaration(call);
    if (!variable || !ts.isIdentifier(variable.name)) continue;
    const symbol = canonicalSymbol(options.checker, variable.name);
    if (!symbol) continue;

    if (member.memberName === 'query') {
      const key = declarationKey(member.sourceFile, variable.name.text, call, 'query');
      const definition = declarationDefinition(call);
      const argsExpression =
        definition === null ? null : objectPropertyExpression(definition, 'args');
      const argsFields =
        argsExpression === null ? undefined : queryArgsFieldNames(argsExpression, options.checker);
      queryBySymbol.set(symbol, {
        ...(argsFields === undefined ? {} : { argsFields }),
        fileName: normalizeSourceFileName(member.sourceFile.fileName),
        hasArgs: argsExpression !== null,
        hasCustomInstanceKey:
          definition !== null && objectPropertyExpression(definition, 'instanceKey') !== null,
        key,
        ownerKey: member.ownerKey,
        start: call.getStart(member.sourceFile),
        symbol,
      });
      continue;
    }
    if (member.memberName !== 'mutation') continue;
    const definition = declarationDefinition(call);
    if (!definition) continue;
    mutations.push({
      call,
      definition,
      fileName: member.sourceFile.fileName,
      input: objectPropertyExpression(definition, 'input'),
      key: declarationKey(member.sourceFile, variable.name.text, call, 'mutation'),
      localName: variable.name.text,
      ownerKey: member.ownerKey,
      ...queueFact(definition, options.checker),
    });
  }

  const lowered: LoweredMutation[] = [];
  for (const mutation of mutations) {
    const optimistic = unwrapExpression(
      objectPropertyExpression(mutation.definition, 'optimistic'),
    );
    if (optimistic === null) continue;
    if (!ts.isArrayLiteralExpression(optimistic)) {
      throw optimisticError(
        'KOVO_OPTIMISTIC_ARRAY',
        mutation,
        'app.mutation({ optimistic }) must be a bounded array of queryHandle.optimistic(...) bindings.',
      );
    }
    if (optimistic.elements.length > MAX_OPTIMISTIC_BINDINGS) {
      throw optimisticError(
        'KOVO_OPTIMISTIC_BOUNDS',
        mutation,
        `optimistic bindings exceed the ${MAX_OPTIMISTIC_BINDINGS}-entry compiler bound.`,
      );
    }

    const transforms: OptimisticTransform[] = [];
    const seenQueries = new Set<string>();
    for (let index = 0; index < optimistic.elements.length; index += 1) {
      const element = unwrapExpression(optimistic.elements[index]);
      if (!element || !ts.isCallExpression(element)) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_BINDING',
          mutation,
          `optimistic[${index}] must be a direct queryHandle.optimistic(...) call.`,
        );
      }
      const callee = unwrapExpression(element.expression);
      const queryHandle =
        callee && ts.isPropertyAccessExpression(callee)
          ? unwrapExpression(callee.expression)
          : null;
      if (
        !callee ||
        !ts.isPropertyAccessExpression(callee) ||
        callee.name.text !== 'optimistic' ||
        !queryHandle ||
        !ts.isIdentifier(queryHandle)
      ) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_BINDING',
          mutation,
          `optimistic[${index}] must use one direct imported or local query handle; copied and computed handles are refused.`,
        );
      }
      const querySymbol = canonicalSymbol(options.checker, queryHandle);
      const query = querySymbol ? queryBySymbol.get(querySymbol) : undefined;
      if (!query) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_QUERY_IDENTITY',
          mutation,
          `optimistic[${index}] does not resolve to an exact app.query() declaration.`,
        );
      }
      if (query.ownerKey !== mutation.ownerKey) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_FOREIGN_QUERY',
          mutation,
          `optimistic[${index}] binds foreign-app query ${query.key}.`,
        );
      }
      const mutationFileName = normalizeSourceFileName(mutation.fileName);
      if (
        (query.fileName === mutationFileName && query.start > mutation.call.getStart()) ||
        projectDependencyReaches(projectDependencies, query.fileName, mutationFileName)
      ) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_IMPORT_CYCLE',
          mutation,
          `${query.key} strongly depends back on its declaring mutation module. Extract the query and mutation into acyclic modules.`,
        );
      }
      if (seenQueries.has(query.key)) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_DUPLICATE',
          mutation,
          `query ${query.key} is declared more than once.`,
        );
      }
      seenQueries.add(query.key);

      const [first, second] = element.arguments;
      const firstValue = unwrapExpression(first);
      if (
        firstValue &&
        ts.isStringLiteralLike(firstValue) &&
        firstValue.text === 'await-fragment'
      ) {
        if (element.arguments.length !== 1) {
          throw optimisticError(
            'KOVO_OPTIMISTIC_BINDING',
            mutation,
            `${query.key}.optimistic('await-fragment') accepts no second argument.`,
          );
        }
        transforms.push({ query: query.key, status: 'await-fragment' });
        continue;
      }
      if (!first || !second || element.arguments.length !== 2) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_BINDING',
          mutation,
          `${query.key}.optimistic(...) requires the mutation input schema and one predictor.`,
        );
      }
      if (!sameExpressionIdentity(options.checker, mutation.input, first)) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_INPUT_IDENTITY',
          mutation,
          `${query.key} must bind the exact input schema passed to app.mutation().`,
        );
      }

      const predictor = unwrapExpression(second);
      if (!predictor) {
        throw optimisticError(
          'KOVO_OPTIMISTIC_BINDING',
          mutation,
          `${query.key} has no predictor.`,
        );
      }
      if (ts.isObjectLiteralExpression(predictor)) {
        const keysNode = objectMemberValueNode(findObjectMember(predictor, 'keys'));
        const applyNode = objectMemberValueNode(findObjectMember(predictor, 'apply'));
        if (!keysNode || !applyNode) {
          throw optimisticError(
            'KOVO_OPTIMISTIC_KEYED',
            mutation,
            `${query.key} keyed optimism requires both keys(input) and apply(value, input).`,
          );
        }
        if (!query.hasArgs) {
          throw optimisticError(
            'KOVO_OPTIMISTIC_KEYED_UNPARAMETERIZED',
            mutation,
            `${query.key} cannot declare keyed optimism because the query has no args schema.`,
          );
        }
        if (query.argsFields === undefined) {
          throw optimisticError(
            'KOVO_OPTIMISTIC_KEY_FIELDS',
            mutation,
            `${query.key} keyed optimism requires compiler-resolvable s.object(...) args so browser and server use one declared field order.`,
          );
        }
        if (query.hasCustomInstanceKey) {
          throw optimisticError(
            'KOVO_OPTIMISTIC_CUSTOM_INSTANCE_KEY',
            mutation,
            `${query.key} keyed optimism cannot mirror an authored instanceKey. Remove instanceKey to use Kovo's canonical args codec or use await-fragment.`,
          );
        }
        transforms.push({
          apply: executableFunctionExpression(applyNode, element.getSourceFile()),
          applyNode,
          keys: executableFunctionExpression(keysNode, element.getSourceFile()),
          keyFields: query.argsFields,
          keysNode,
          query: query.key,
          status: 'hand-written',
        });
      } else {
        transforms.push({
          apply: executableFunctionExpression(predictor, element.getSourceFile()),
          applyNode: predictor,
          query: query.key,
          status: 'hand-written',
        });
      }
    }

    lowered.push({
      declaration: mutation,
      inputFields: options.mutationInputs[mutation.key] ?? [],
      transforms,
    });
  }

  const byFile = new Map<string, LoweredMutation[]>();
  for (const mutation of lowered) {
    const existing = byFile.get(mutation.declaration.fileName);
    if (existing) existing.push(mutation);
    else byFile.set(mutation.declaration.fileName, [mutation]);
  }

  const mutationOptimism: Record<string, OptimisticMutationFact> = Object.create(null);
  const optimisticModules: OptimisticModuleFact[] = [];
  for (const [fileName, fileMutations] of [...byFile.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const source = emitOptimisticModule(fileName, fileMutations, options.checker, sourceFileNames);
    const href = clientModuleHrefForSourceFile(fileName, clientModuleRepresentationDigest(source));
    const target = parseVersionedClientModuleTarget(href);
    if (!target) throw new TypeError(`Compiler emitted a non-canonical optimism module ${href}.`);
    const mutationKeys = fileMutations.map((entry) => entry.declaration.key).sort();
    optimisticModules.push({
      fileName,
      href,
      mutationKeys,
      path: target.path,
      source,
    });
    for (const mutation of fileMutations) {
      const statuses: Record<string, OptimisticTransformStatus> = Object.create(null);
      for (const transform of mutation.transforms) statuses[transform.query] = transform.status;
      mutationOptimism[mutation.declaration.key] = {
        inputFields: mutation.inputFields,
        invalidations: mutation.transforms.map((transform) => transform.query),
        moduleHref: href,
        mutation: mutation.declaration.key,
        ...(mutation.declaration.queue === undefined ? {} : { queue: mutation.declaration.queue }),
        statuses,
      };
    }
  }

  return {
    mutationOptimism: Object.freeze(mutationOptimism),
    optimisticModules: Object.freeze(optimisticModules),
  };
}

function emitOptimisticModule(
  fileName: string,
  mutations: readonly LoweredMutation[],
  checker: TS.TypeChecker,
  sourceFileNames: ReadonlySet<string>,
): string {
  const dependencies = collectRuntimeDependencies(mutations, checker, sourceFileNames);
  const dependencySource = dependencies.map((entry) => emitRuntimeDependency(entry)).join('\n');
  const queryKeyCodecSource = mutations.some((mutation) =>
    mutation.transforms.some((transform) => transform.keys !== undefined),
  )
    ? `const __kovoQueryInstanceKeyCodec = (${canonicalQueryInstanceKeyCodecFactorySource()})();\n`
    : '';
  const planEntries = mutations
    .slice()
    .sort((left, right) => left.declaration.key.localeCompare(right.declaration.key))
    .map((mutation) => emitMutationPlanEntry(mutation))
    .join(',\n');
  const typescriptSource = `${compilerIrHeader}
${dependencySource}
${queryKeyCodecSource}
export const kovoOptimisticMutationPlans = Object.freeze({
${planEntries}
});
`;
  const transpiled = ts.transpileModule(typescriptSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
    reportDiagnostics: true,
  });
  const errors = transpiled.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors && errors.length > 0) {
    throw new TypeError(
      `KOVO_OPTIMISTIC_EMIT: ${errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('\n')}`,
    );
  }
  return transpiled.outputText;
}

function emitMutationPlanEntry(mutation: LoweredMutation): string {
  const transforms = mutation.transforms
    .map(
      (transform) =>
        `${JSON.stringify(transform.query)}: ${
          transform.status === 'await-fragment' ? JSON.stringify('await-fragment') : transform.apply
        }`,
    )
    .join(',\n');
  const keyed = mutation.transforms.filter((transform) => transform.keys !== undefined);
  const keys =
    keyed.length === 0
      ? ''
      : `,\nkeys: Object.freeze({${keyed
          .map(
            (transform) =>
              `${JSON.stringify(
                transform.query,
              )}: (input) => __kovoQueryInstanceKeyCodec.identities(${JSON.stringify(
                transform.query,
              )}, Object.freeze(${JSON.stringify(transform.keyFields)}), (${
                transform.keys
              })(input))`,
          )
          .join(',\n')}})`;
  const statuses = Object.fromEntries(
    mutation.transforms.map((transform) => [transform.query, transform.status]),
  );
  return `${JSON.stringify(mutation.declaration.key)}: Object.freeze({
schema: ${JSON.stringify(OPTIMISTIC_PLAN_SCHEMA)},
mutation: ${JSON.stringify(mutation.declaration.key)},
invalidations: Object.freeze(${JSON.stringify(
    mutation.transforms.map((transform) => transform.query),
  )}),
statuses: Object.freeze(${JSON.stringify(statuses)}),
inputFields: Object.freeze(${JSON.stringify(
    mutation.inputFields.map(({ coercion, defaulted, name, optional, required }) => ({
      coercion,
      defaulted,
      name,
      optional,
      required,
    })),
  )}),
transforms: Object.freeze({${transforms}})${keys}${
    mutation.declaration.queue === undefined
      ? ''
      : `,\nqueue: ${JSON.stringify(mutation.declaration.queue)}`
  }
})`;
}

function collectRuntimeDependencies(
  mutations: readonly LoweredMutation[],
  checker: TS.TypeChecker,
  sourceFileNames: ReadonlySet<string>,
): RuntimeDependency[] {
  const bySymbol = new Map<TS.Symbol, RuntimeDependency>();
  const ordered: RuntimeDependency[] = [];
  const visiting = new Set<TS.Symbol>();

  const collectNode = (node: TS.Node): void => {
    const visit = (child: TS.Node): void => {
      if (ts.isIdentifier(child) && identifierIsRuntimeReference(child)) {
        const symbol = canonicalSymbol(checker, child);
        const declaration = symbol ? topLevelRuntimeDeclaration(symbol) : undefined;
        if (
          symbol &&
          declaration &&
          sourceFileNames.has(normalizeSourceFileName(declaration.getSourceFile().fileName))
        ) {
          collectDeclaration(symbol, declaration, child.text);
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
  };

  const collectDeclaration = (
    symbol: TS.Symbol,
    declaration: TS.FunctionDeclaration | TS.VariableDeclaration,
    alias: string,
  ): void => {
    const existing = bySymbol.get(symbol);
    if (existing) {
      existing.aliases.add(alias);
      return;
    }
    const dependency: RuntimeDependency = { aliases: new Set([alias]), declaration, symbol };
    bySymbol.set(symbol, dependency);
    if (visiting.has(symbol)) return;
    visiting.add(symbol);
    if (ts.isFunctionDeclaration(declaration)) {
      if (declaration.body) collectNode(declaration.body);
    } else if (declaration.initializer) {
      collectNode(declaration.initializer);
    }
    visiting.delete(symbol);
    ordered.push(dependency);
  };

  for (const mutation of mutations) {
    for (const transform of mutation.transforms) {
      if (transform.applyNode) collectNode(transform.applyNode);
      if (transform.keysNode) collectNode(transform.keysNode);
    }
  }
  return ordered;
}

function appOptimisticProjectDependencies(
  checker: TS.TypeChecker,
  program: TS.Program,
  sourceFileNames: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const dependencies = new Map<string, ReadonlySet<string>>();
  for (const sourceFile of program.getSourceFiles()) {
    const fileName = normalizeSourceFileName(sourceFile.fileName);
    if (!sourceFileNames.has(fileName)) continue;
    const targets = new Set<string>();
    for (const statement of sourceFile.statements) {
      const moduleSpecifier = runtimeModuleSpecifier(statement);
      if (!moduleSpecifier) continue;
      const symbol = checker.getSymbolAtLocation(moduleSpecifier);
      const declarations = symbol?.declarations ?? [];
      for (const declaration of declarations) {
        const target = normalizeSourceFileName(declaration.getSourceFile().fileName);
        if (sourceFileNames.has(target) && target !== fileName) targets.add(target);
      }
    }
    dependencies.set(fileName, targets);
  }
  return dependencies;
}

function runtimeModuleSpecifier(statement: TS.Statement): TS.StringLiteralLike | undefined {
  if (ts.isImportDeclaration(statement)) {
    if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      return undefined;
    }
    const clause = statement.importClause;
    if (clause?.isTypeOnly) return undefined;
    if (
      clause?.name === undefined &&
      clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((element) => element.isTypeOnly)
    ) {
      return undefined;
    }
    return statement.moduleSpecifier;
  }
  if (
    !ts.isExportDeclaration(statement) ||
    statement.isTypeOnly ||
    !statement.moduleSpecifier ||
    !ts.isStringLiteralLike(statement.moduleSpecifier)
  ) {
    return undefined;
  }
  if (
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.length > 0 &&
    statement.exportClause.elements.every((element) => element.isTypeOnly)
  ) {
    return undefined;
  }
  return statement.moduleSpecifier;
}

function projectDependencyReaches(
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  from: string,
  target: string,
): boolean {
  if (from === target) return false;
  const visited = new Set<string>();
  const pending = [from];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const next = dependencies.get(current);
    if (!next) continue;
    for (const dependency of next) {
      if (dependency === target) return true;
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }
  return false;
}

function emitRuntimeDependency(dependency: RuntimeDependency): string {
  const declaration = dependency.declaration;
  const declarationName = declaration.name;
  const declaredName =
    declarationName !== undefined && ts.isIdentifier(declarationName)
      ? declarationName.text
      : undefined;
  if (!declaredName) {
    throw new TypeError('KOVO_OPTIMISTIC_CAPTURE: browser predictor dependency must be named.');
  }
  let source: string;
  if (ts.isFunctionDeclaration(declaration)) {
    if (!declaration.body) {
      throw new TypeError(`KOVO_OPTIMISTIC_CAPTURE: ${declaredName} has no executable body.`);
    }
    source = `const ${declaredName} = function ${declaredName}(${declaration.parameters
      .map((parameter) => parameter.getText(declaration.getSourceFile()))
      .join(', ')})${
      declaration.type ? `: ${declaration.type.getText(declaration.getSourceFile())}` : ''
    } ${declaration.body.getText(declaration.getSourceFile())};`;
  } else {
    if (!declaration.initializer) {
      throw new TypeError(`KOVO_OPTIMISTIC_CAPTURE: ${declaredName} has no initializer.`);
    }
    source = `const ${declaredName} = ${declaration.initializer.getText(
      declaration.getSourceFile(),
    )};`;
  }
  for (const alias of [...dependency.aliases].sort()) {
    if (alias !== declaredName) source += `\nconst ${alias} = ${declaredName};`;
  }
  return source;
}

function topLevelRuntimeDeclaration(
  symbol: TS.Symbol,
): TS.FunctionDeclaration | TS.VariableDeclaration | undefined {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (declaration && ts.isFunctionDeclaration(declaration) && declaration.name) return declaration;
  if (declaration && ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    let current: TS.Node | undefined = declaration.parent;
    while (current && !ts.isSourceFile(current)) {
      if (
        ts.isFunctionLike(current) ||
        ts.isClassLike(current) ||
        ts.isBlock(current) ||
        ts.isObjectLiteralExpression(current)
      ) {
        return undefined;
      }
      current = current.parent;
    }
    return current ? declaration : undefined;
  }
  return undefined;
}

function identifierIsRuntimeReference(identifier: TS.Identifier): boolean {
  const parent = identifier.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isMethodDeclaration(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isFunctionDeclaration(parent) && parent.name === identifier)
  ) {
    return false;
  }
  return !isInsideTypeNode(identifier);
}

function isInsideTypeNode(node: TS.Node): boolean {
  let current: TS.Node | undefined = node;
  while (current) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isExpression(current) || ts.isStatement(current) || ts.isSourceFile(current))
      return false;
    current = current.parent;
  }
  return false;
}

function executableFunctionExpression(node: TS.Node, sourceFile: TS.SourceFile): string {
  const value = unwrapNode(node);
  if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value.getText(sourceFile);
  if (ts.isIdentifier(value)) return value.text;
  if (ts.isMethodDeclaration(value) && value.body) {
    return `function (${value.parameters
      .map((parameter) => parameter.getText(sourceFile))
      .join(', ')})${
      value.type ? `: ${value.type.getText(sourceFile)}` : ''
    } ${value.body.getText(sourceFile)}`;
  }
  throw new TypeError(
    'KOVO_OPTIMISTIC_PREDICTOR: predictor must be a direct function, method, or immutable function binding.',
  );
}

function declarationDefinition(call: TS.CallExpression): TS.ObjectLiteralExpression | null {
  const [first, second] = call.arguments;
  const candidate =
    first && ts.isStringLiteralLike(unwrapNode(first))
      ? unwrapExpression(second)
      : unwrapExpression(first);
  return candidate && ts.isObjectLiteralExpression(candidate) ? candidate : null;
}

function queryArgsFieldNames(
  expression: TS.Expression,
  checker: TS.TypeChecker,
): readonly string[] | undefined {
  const schema = resolveImmutableExpression(expression, checker);
  if (!schema || !ts.isCallExpression(schema)) return undefined;
  const callee = unwrapExpression(schema.expression);
  if (
    !callee ||
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== 'object' ||
    !expressionResolvesToFrameworkExport(
      ts as FrameworkIdentityTypeScript,
      schema.getSourceFile(),
      callee.expression,
      SCHEMA_IDENTITY,
      { legacyGlobals: [SCHEMA_IDENTITY] },
    )
  ) {
    return undefined;
  }
  const shape = resolveImmutableExpression(schema.arguments[0], checker);
  if (!shape || !ts.isObjectLiteralExpression(shape)) return undefined;
  const fields: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < shape.properties.length; index += 1) {
    const property = shape.properties[index]!;
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = propertyNameText(property.name);
    if (name === null || name === '' || name.length > 256 || seen.has(name)) {
      return undefined;
    }
    seen.add(name);
    fields.push(name);
  }
  return Object.freeze(fields);
}

function resolveImmutableExpression(
  expression: TS.Expression | undefined,
  checker: TS.TypeChecker,
): TS.Expression | null {
  let current = unwrapExpression(expression);
  const seen = new Set<TS.Symbol>();
  for (let depth = 0; current && depth < 16; depth += 1) {
    if (!ts.isIdentifier(current)) return current;
    const symbol = canonicalSymbol(checker, current);
    if (!symbol || seen.has(symbol)) return null;
    seen.add(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !declaration.initializer ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return null;
    }
    current = unwrapExpression(declaration.initializer);
  }
  return null;
}

function declarationKey(
  sourceFile: TS.SourceFile,
  localName: string,
  call: TS.CallExpression,
  kind: 'mutation' | 'query',
): string {
  const first = unwrapExpression(call.arguments[0]);
  if (first && ts.isStringLiteralLike(first)) return first.text;
  return kind === 'mutation'
    ? deriveMutationKey(sourceFile.fileName, localName)
    : deriveRegistryIdentity(sourceFile.fileName, localName).key;
}

function queueFact(
  definition: TS.ObjectLiteralExpression,
  checker: TS.TypeChecker,
): { queue?: string } {
  const queue = unwrapExpression(objectPropertyExpression(definition, 'queue'));
  if (!queue) return {};
  if (queue.kind === ts.SyntaxKind.TrueKeyword) return {};
  if (ts.isStringLiteralLike(queue)) return { queue: queue.text };
  if (!ts.isIdentifier(queue)) return {};
  const symbol = canonicalSymbol(checker, queue);
  const declaration = symbol?.valueDeclaration;
  if (!declaration || !ts.isVariableDeclaration(declaration)) return {};
  const initializer = unwrapExpression(declaration.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) return {};
  const [name] = initializer.arguments;
  const nameValue = name === undefined ? undefined : unwrapNode(name);
  return nameValue && ts.isStringLiteralLike(nameValue) ? { queue: nameValue.text } : {};
}

function sameExpressionIdentity(
  checker: TS.TypeChecker,
  left: TS.Expression | null,
  right: TS.Expression,
): boolean {
  const leftValue = unwrapExpression(left);
  const rightValue = unwrapExpression(right);
  if (!leftValue || !rightValue) return false;
  if (leftValue === rightValue) return true;
  const leftSymbol = canonicalSymbol(checker, leftValue);
  const rightSymbol = canonicalSymbol(checker, rightValue);
  return leftSymbol !== undefined && leftSymbol === rightSymbol;
}

function canonicalSymbol(checker: TS.TypeChecker, node: TS.Node): TS.Symbol | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      return undefined;
    }
  }
  return symbol;
}

function enclosingVariableDeclaration(node: TS.Node): TS.VariableDeclaration | null {
  let current: TS.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current)) return current;
    if (
      ts.isFunctionLike(current) ||
      ts.isClassLike(current) ||
      ts.isObjectLiteralExpression(current)
    ) {
      return null;
    }
    current = current.parent;
  }
  return null;
}

function objectPropertyExpression(
  object: TS.ObjectLiteralExpression,
  name: string,
): TS.Expression | null {
  const member = findObjectMember(object, name);
  return member && ts.isPropertyAssignment(member) ? member.initializer : null;
}

function findObjectMember(
  object: TS.ObjectLiteralExpression,
  name: string,
): TS.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => propertyNameText(property.name) === name);
}

function objectMemberValueNode(
  member: TS.ObjectLiteralElementLike | undefined,
): TS.Node | undefined {
  if (!member) return undefined;
  if (ts.isPropertyAssignment(member)) return member.initializer;
  if (ts.isMethodDeclaration(member)) return member;
  return undefined;
}

function unwrapExpression(node: TS.Expression | undefined | null): TS.Expression | null {
  return node ? (unwrapNode(node) as TS.Expression) : null;
}

function unwrapNode<Node extends TS.Node>(node: Node): Node {
  let current: TS.Node = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current as Node;
}

function optimisticError(code: string, mutation: MutationDeclaration, detail: string): TypeError {
  return new TypeError(
    `${code}: ${mutation.fileName} app.mutation ${mutation.key}: ${detail} ` +
      'Keep query handles direct and break query↔mutation import cycles before building.',
  );
}

function normalizeFileName(program: TS.Program, fileName: string): string {
  const sourceFile = program.getSourceFile(fileName);
  return normalizeSourceFileName(sourceFile?.fileName ?? fileName);
}

function normalizeSourceFileName(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}
