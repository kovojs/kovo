export type {
  DiagnosticCode,
  ReadSite,
  TouchGraph,
  TouchGraphEntry,
  TouchSite,
  UnresolvedWriteSite,
} from '@jiso/core';
import {
  diagnosticDefinitionText,
  diagnosticDefinitions,
  type TouchGraph,
  type TouchGraphEntry,
} from '@jiso/core';
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type BindingElement,
  type CallExpression,
  type CompilerOptions,
  type ObjectLiteralExpression,
  type SourceFile,
  type Symbol as MorphSymbol,
} from 'ts-morph';
export type {
  DomainRegistryInput,
  ReadSummaryInput,
  TouchGraphDiagnostic,
  UnresolvedSummaryInput,
  WriteSummaryInput,
} from './graph.js';
export {
  createTouchGraphEntry,
  diagnosticsForTouchGraph,
  serializeDomainRegistry,
  serializeTouchGraph,
} from './graph.js';
import {
  createTouchGraphEntry,
  type ReadSummaryInput,
  type TouchGraphDiagnostic,
  type UnresolvedSummaryInput,
  type WriteSummaryInput,
} from './graph.js';
export type {
  JisoDomainTableAnnotation,
  JisoTableAnnotation,
  JisoTableExtraConfig,
} from './drizzle-surface.js';
export { jiso } from './drizzle-surface.js';
import {
  isDomainTableAnnotation,
  isDrizzleDatabaseTypeText,
  isDrizzleTableFactoryName,
  isExemptTableAnnotation,
  isJisoExtraConfigCallName,
  type JisoDomainTableAnnotation,
  type JisoTableAnnotation,
} from './drizzle-surface.js';
export type {
  InvalidationQueryInput,
  InvalidationRegistry,
  InvalidationRegistryEntry,
  MutationTouchInput,
} from './invalidation.js';
export { deriveInvalidationRegistry, serializeInvalidationRegistry } from './invalidation.js';

const SOURCE_EXTRACTION_FILE_NAME = '__jiso_source.ts';
const DEFAULT_DRIZZLE_RECEIVER_NAMES = new Set(['db', 'tx']);
const IGNORED_LOCAL_CALL_NAMES = new Set([
  'eq',
  'for',
  'function',
  'if',
  'jiso',
  'pgTable',
  'return',
  'switch',
  'while',
]);
const FW411_MESSAGE = 'Query read set includes an exempt table';
const UNRESOLVED_READ_SOURCE_EXPRESSION = '__jisoUnresolvedReadSource';
const BOOLEAN_COLUMN_BUILDERS = new Set(['boolean']);
const JSON_COLUMN_BUILDERS = new Set(['json', 'jsonb']);
const NUMBER_COLUMN_BUILDERS = new Set([
  'bigint',
  'doublePrecision',
  'integer',
  'numeric',
  'real',
  'smallint',
  'serial',
  'bigserial',
  'smallserial',
]);
const UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS = new Set([
  '$count',
  'execute',
  'refreshMaterializedView',
]);
const DRIZZLE_SELECT_QUERY_METHODS = new Set(['select', 'selectDistinct', 'selectDistinctOn']);

export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | QueryShapeWrapper
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    };

export interface QueryShapeWrapper {
  kind: 'nullable' | 'optional';
  shape: QueryShape;
}

export interface QueryFact {
  diagnostics?: readonly TouchGraphDiagnostic[];
  instanceKey?: {
    domain: string;
    key: string;
  };
  query: string;
  reads: readonly string[];
  shape: QueryShape;
  site: string;
}

export interface SourceFileInput {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  fileName: string;
  source: string;
}

export interface TouchGraphProjectOptions {
  compilerOptions?: CompilerOptions;
  files: readonly SourceFileInput[];
}

interface ExtractedTable {
  annotation: JisoTableAnnotation & { name: string };
  columns: Readonly<Record<string, QueryShape>>;
  exported: boolean;
}

export function diagnosticsForQueryFacts(facts: readonly QueryFact[]): TouchGraphDiagnostic[] {
  return facts.flatMap((fact) => [...(fact.diagnostics ?? [])]);
}

export function extractTouchGraphFromSource(files: readonly SourceFileInput[]): TouchGraph {
  return extractTouchGraphFromPreparedFiles(files, (file) => extractFunctions(file.source));
}

function extractTouchGraphFromPreparedFiles(
  files: readonly SourceFileInput[],
  functionsForFile: (file: SourceFileInput) => ExtractedFunction[],
): TouchGraph {
  const sourceContext = sourceModuleContext(files);
  const unresolvedIdentifiers = new Set<string>();
  const graph: Record<string, TouchGraphEntry> = {};

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
    for (const identifier of extractUnresolvedConditionalIdentifiers(file.source, fileTables)) {
      unresolvedIdentifiers.add(identifier);
    }
  }

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
    const functions = functionsForFile(file);
    const functionsByName = new Map(functions.map((fn) => [fn.name, fn]));
    const localFunctionNames = new Set(functionsByName.keys());
    const callsByName = new Map(
      functions.map((fn) => [
        fn.name,
        extractLocalFunctionCalls(fn.body).filter((call) => functionsByName.has(call)),
      ]),
    );
    const summaries = new Map(
      functions.map((fn) => [
        fn.name,
        directSummaryForFunction(fn, file, fileTables, unresolvedIdentifiers, localFunctionNames),
      ]),
    );

    let changed = true;
    while (changed) {
      changed = false;

      for (const fn of functions) {
        const summary = summaries.get(fn.name);
        if (!summary) continue;

        for (const call of callsByName.get(fn.name) ?? []) {
          const calleeSummary = summaries.get(call);
          if (!calleeSummary) continue;

          if (mergeSummary(summary, calleeSummary)) changed = true;
        }
      }
    }

    for (const fn of functions) {
      const { reads, unresolved, writes } = summaries.get(fn.name) ?? {
        reads: [],
        unresolved: [],
        writes: [],
      };
      if (reads.length > 0 || writes.length > 0 || unresolved.length > 0) {
        graph[fn.name] = createTouchGraphEntry({ reads, unresolved, writes });
      }
    }
  }

  return graph;
}

export function extractTouchGraphFromProject(options: TouchGraphProjectOptions): TouchGraph {
  const extraction = createProjectExtraction(options);
  try {
    const files = sourceFilesWithProjectExtractionResolvedFromProject(extraction);
    const projectFunctionExtractions = projectFunctionExtractionsByFileName(extraction);

    return extractTouchGraphFromPreparedFiles(files, (file) =>
      extractFunctions(file.source).map((fn) => {
        const projectFunction = projectFunctionExtractions.get(file.fileName)?.get(fn.name);
        return projectFunction ? { ...fn, ...projectFunction } : fn;
      }),
    );
  } finally {
    extraction.dispose();
  }
}

export function extractQueryFactsFromProject(options: TouchGraphProjectOptions): QueryFact[] {
  const files = sourceFilesWithProjectExtractionResolved(options);

  return extractQueryFactsFromSource(files);
}

function sourceFilesWithProjectExtractionResolved(
  options: TouchGraphProjectOptions,
): SourceFileInput[] {
  const extraction = createProjectExtraction(options);
  try {
    return sourceFilesWithProjectExtractionResolvedFromProject(extraction);
  } finally {
    extraction.dispose();
  }
}

interface ProjectExtraction {
  columnShapesByTable: ReadonlyMap<string, Readonly<Record<string, QueryShape>>>;
  dispose: () => void;
  files: readonly SourceFileInput[];
  sourceFiles: readonly SourceFile[];
  tableNamesBySymbol: ReadonlyMap<string, string>;
}

function createProjectExtraction(options: TouchGraphProjectOptions): ProjectExtraction {
  const project = new Project({
    compilerOptions: {
      allowJs: false,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      ...options.compilerOptions,
    },
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFiles = options.files.map((file) =>
    project.createSourceFile(file.fileName, file.source, { overwrite: true }),
  );
  const tableNamesBySymbol = projectTableNamesBySymbol(sourceFiles);
  const columnShapesByTable = projectColumnShapesByTable(sourceFiles, tableNamesBySymbol);

  return {
    columnShapesByTable,
    dispose: () => {
      for (const sourceFile of sourceFiles) sourceFile.forget();
    },
    files: options.files,
    sourceFiles,
    tableNamesBySymbol,
  };
}

function sourceFilesWithProjectExtractionResolvedFromProject(
  extraction: ProjectExtraction,
): SourceFileInput[] {
  return extraction.files.map((file, index) => {
    const sourceFile = extraction.sourceFiles[index];
    if (!sourceFile) throw new Error(`Missing source file for ${file.fileName}`);

    return {
      columnShapes: columnShapesForFile(
        sourceFile,
        extraction.tableNamesBySymbol,
        extraction.columnShapesByTable,
      ),
      fileName: file.fileName,
      source: sourceWithProjectExtractionResolved(
        file.source,
        sourceFile,
        extraction.tableNamesBySymbol,
      ),
    };
  });
}

function projectFunctionExtractionsByFileName(
  extraction: ProjectExtraction,
): Map<string, Map<string, ProjectFunctionExtraction>> {
  const extractionsByFile = new Map<string, Map<string, ProjectFunctionExtraction>>();

  extraction.sourceFiles.forEach((sourceFile, index) => {
    const file = extraction.files[index];
    if (!file) return;

    const extractionsByFunction = new Map<string, ProjectFunctionExtraction>();

    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      const body = fn.getBody();
      if (!name || !body) continue;

      const receivers = projectDrizzleReceivers(fn);
      extractionsByFunction.set(name, {
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        writeCalls: extractProjectDrizzleWriteCalls(
          body,
          file,
          extraction.tableNamesBySymbol,
          receivers,
        ),
      });
    }

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(name) || !initializer) continue;
      if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;

      const body = initializer.getBody();
      const receivers = projectDrizzleReceivers(initializer);
      extractionsByFunction.set(name.getText(), {
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        writeCalls: extractProjectDrizzleWriteCalls(
          body,
          file,
          extraction.tableNamesBySymbol,
          receivers,
        ),
      });
    }

    for (const [name, callback] of projectDomainWriteCallbacks(sourceFile)) {
      const receivers = projectDrizzleReceivers(callback.fn);
      extractionsByFunction.set(name, {
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        writeCalls: extractProjectDrizzleWriteCalls(
          callback.body,
          file,
          extraction.tableNamesBySymbol,
          receivers,
        ),
      });
    }

    const localFunctionNames = new Set(extractionsByFunction.keys());
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      const body = fn.getBody();
      const extraction = name ? extractionsByFunction.get(name) : undefined;
      if (!body || !extraction) continue;
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        body,
        projectDrizzleReceivers(fn),
        localFunctionNames,
      );
    }
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(name) || !initializer) continue;
      if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;
      const extraction = extractionsByFunction.get(name.getText());
      if (!extraction) continue;
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        initializer.getBody(),
        projectDrizzleReceivers(initializer),
        localFunctionNames,
      );
    }
    for (const [name, callback] of projectDomainWriteCallbacks(sourceFile)) {
      const extraction = extractionsByFunction.get(name);
      if (!extraction) continue;
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        callback.body,
        projectDrizzleReceivers(callback.fn),
        localFunctionNames,
      );
    }

    extractionsByFile.set(file.fileName, extractionsByFunction);
  });

  return extractionsByFile;
}

interface ProjectFunctionExtraction {
  unresolvedCalls: readonly ExternalDbArgumentCall[];
  receiverNames: readonly string[];
  writeCalls: readonly ExtractedWriteCall[];
}

interface ProjectDrizzleReceivers {
  names: ReadonlySet<string>;
  symbolKeys: ReadonlySet<string>;
}

function projectDomainWriteCallbacks(
  sourceFile: SourceFile,
): Map<string, { body: Node; fn: Node }> {
  const callbacks = new Map<string, { body: Node; fn: Node }>();

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const domainName = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(domainName) || !initializer) continue;
    if (!Node.isCallExpression(initializer)) continue;
    const expression = initializer.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'domain') continue;

    const domainObject = initializer.getArguments()[0];
    if (!domainObject || !Node.isObjectLiteralExpression(domainObject)) continue;

    for (const property of domainObject.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const memberName = propertyNameText(property.getNameNode());
      if (!memberName) continue;

      const callback = writeCallbackFunction(property.getInitializer());
      if (!callback) continue;

      callbacks.set(`${domainName.getText()}.${memberName}`, {
        body: functionBody(callback),
        fn: callback,
      });
    }
  }

  return callbacks;
}

function projectDrizzleReceivers(callback: Node): ProjectDrizzleReceivers {
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback)
  ) {
    return { names: new Set(), symbolKeys: new Set() };
  }

  const names = new Set<string>();
  const symbolKeys = new Set<string>();
  for (const param of callback.getParameters()) {
    const name = param.getNameNode();
    if (!Node.isIdentifier(name) || !isDrizzleReceiver(name)) continue;
    names.add(name.getText());
    const symbolKey = resolvedSymbolKey(name.getSymbol());
    if (symbolKey) symbolKeys.add(symbolKey);
  }
  appendProjectTransactionReceiverAliases(callback, { names, symbolKeys });
  return { names, symbolKeys };
}

function appendProjectTransactionReceiverAliases(
  callback: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §10-§11: transaction callback aliases are proven from typed receiver call sites.
  let changed = true;

  while (changed) {
    changed = false;

    for (const call of callback.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (staticAccessName(expression) !== 'transaction') continue;

      const receiver = staticAccessExpression(expression);
      if (!isProjectDrizzleReceiverIdentifier(receiver, receivers)) continue;

      const transactionCallback = call
        .getArguments()
        .find((argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument));
      if (
        !transactionCallback ||
        (!Node.isArrowFunction(transactionCallback) &&
          !Node.isFunctionExpression(transactionCallback))
      ) {
        continue;
      }

      const alias = transactionCallback.getParameters()[0]?.getNameNode();
      if (!Node.isIdentifier(alias)) continue;

      const symbolKey = resolvedSymbolKey(alias.getSymbol());
      if (symbolKey ? receivers.symbolKeys.has(symbolKey) : receivers.names.has(alias.getText())) {
        continue;
      }

      receivers.names.add(alias.getText());
      if (symbolKey) receivers.symbolKeys.add(symbolKey);
      changed = true;
    }
  }
}

function extractProjectDrizzleWriteCalls(
  body: Node,
  file: SourceFileInput,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  receivers: ProjectDrizzleReceivers,
): ExtractedWriteCall[] {
  const calls: ExtractedWriteCall[] = [];

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDrizzleWriteCall(call)) continue;

    const expression = call.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    const receiver = expression.getExpression();
    if (!isDrizzleReceiver(receiver) && !isProjectDrizzleReceiverIdentifier(receiver, receivers)) {
      continue;
    }

    const operation = expression.getName();
    const tableArgument = call.getArguments()[0];
    if (!tableArgument) continue;

    const chain = drizzleWriteChainRoot(call);
    const statement = sourceWithProjectTableIdentifiersResolved(
      chain,
      file.source,
      tableNamesBySymbol,
    );
    const tableExpression =
      projectTableNameForNode(tableArgument, tableNamesBySymbol) ??
      sourceWithProjectTableIdentifiersResolved(tableArgument, file.source, tableNamesBySymbol);

    calls.push({
      index: 0,
      operation,
      readSources: extractReadSources(statement, operation),
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      statement,
      tableExpression: tableExpression.trim(),
    });
  }

  return calls;
}

function extractProjectUnresolvedCalls(
  body: Node,
  receivers: ProjectDrizzleReceivers,
  localFunctionNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  // SPEC §10-§11: project-mode unresolved surfaces must be tied to typed Drizzle receivers.
  return [
    ...extractProjectExternalDbArgumentCalls(body, receivers, localFunctionNames),
    ...extractProjectUnclassifiedDrizzleReceiverCalls(body, receivers),
  ];
}

function extractProjectExternalDbArgumentCalls(
  body: Node,
  receivers: ProjectDrizzleReceivers,
  localFunctionNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const bodyStart = bodySourceStart(body);

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    if (!Node.isIdentifier(expression)) continue;

    const name = expression.getText();
    if (IGNORED_LOCAL_CALL_NAMES.has(name) || localFunctionNames.has(name)) continue;
    if (!call.getArguments().some((arg) => isProjectDrizzleReceiverIdentifier(arg, receivers))) {
      continue;
    }

    calls.push({ index: call.getStart() - bodyStart, name });
  }

  return calls;
}

function extractProjectUnclassifiedDrizzleReceiverCalls(
  body: Node,
  receivers: ProjectDrizzleReceivers,
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const bodyStart = bodySourceStart(body);

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    const name = staticAccessName(expression);
    if (!name) continue;

    const surface = projectUnclassifiedCallSurface(expression, name);
    if (!surface || !isProjectDrizzleReceiverIdentifier(surface.receiver, receivers)) continue;

    calls.push({ index: call.getStart() - bodyStart, name: surface.name });
  }

  return calls;
}

function projectUnclassifiedCallSurface(
  expression: Node,
  name: string,
): { name: string; receiver: Node } | undefined {
  if (UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS.has(name)) {
    const receiver = staticAccessExpression(expression);
    return receiver ? { name, receiver } : undefined;
  }
  if (name !== 'findMany' && name !== 'findFirst') return undefined;

  const tableAccess = staticAccessExpression(expression);
  if (!tableAccess || !staticAccessName(tableAccess)) return undefined;
  const queryAccess = staticAccessExpression(tableAccess);
  if (!queryAccess || staticAccessName(queryAccess) !== 'query') return undefined;
  const receiver = staticAccessExpression(queryAccess);
  return receiver ? { name: `query.${name}`, receiver } : undefined;
}

function bodySourceStart(body: Node): number {
  return Node.isBlock(body) ? body.getStart() + 1 : body.getStart();
}

function isProjectDrizzleReceiverIdentifier(
  node: Node | undefined,
  receivers: { names: ReadonlySet<string>; symbolKeys: ReadonlySet<string> },
): boolean {
  if (!node || !Node.isIdentifier(node)) return false;

  const symbolKey = resolvedSymbolKey(node.getSymbol());
  if (symbolKey) return receivers.symbolKeys.has(symbolKey);

  return receivers.names.has(node.getText());
}

function drizzleWriteChainRoot(call: CallExpression): Node {
  let chain: Node = call;

  while (true) {
    const parent = chain.getParent();

    if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === chain) {
      chain = parent;
      continue;
    }
    if (parent && Node.isCallExpression(parent) && parent.getExpression() === chain) {
      chain = parent;
      continue;
    }

    return chain;
  }
}

function sourceWithProjectTableIdentifiersResolved(
  node: Node,
  source: string,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): string {
  const start = node.getStart();
  const replacements = node.getDescendantsOfKind(SyntaxKind.Identifier).flatMap((identifier) => {
    const tableName = tableNamesBySymbol.get(resolvedSymbolKey(identifier.getSymbol()) ?? '');
    if (!tableName || identifier.getText() === tableName) return [];

    return [
      {
        end: identifier.getEnd() - start,
        start: identifier.getStart() - start,
        value: tableName,
      },
    ];
  });

  return applySourceReplacements(source.slice(start, node.getEnd()), replacements);
}

function projectTableNameForNode(
  node: Node,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): string | undefined {
  if (!Node.isIdentifier(node)) return undefined;
  return tableNamesBySymbol.get(resolvedSymbolKey(node.getSymbol()) ?? '');
}

export function extractQueryFactsFromSource(files: readonly SourceFileInput[]): QueryFact[] {
  const sourceContext = sourceModuleContext(files);
  const facts: QueryFact[] = [];

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
    const columnShapes = {
      ...sourceColumnShapesForTables(fileTables),
      ...file.columnShapes,
    };
    for (const query of extractQueryDefinitions(file.source, columnShapes)) {
      const reads = queryReadDomains(query.tableExpressions, fileTables);
      const site = `${file.fileName}:${lineForIndex(file.source, query.index)}`;
      const diagnostics = opaqueProjectionDiagnostics(
        query.query,
        query.opaquePaths,
        site,
        query.hasOutputSchema,
      )
        .concat(unresolvedProjectionDiagnostics(query.query, query.unresolvedPaths, site))
        .concat(query.diagnostics?.map((diagnostic) => ({ ...diagnostic, site })) ?? [])
        .concat(exemptQueryReadDiagnostics(query.tableExpressions, fileTables, site));
      facts.push({
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
        ...queryInstanceKey(query.instanceKeyComparisons, fileTables),
        query: query.query,
        reads,
        shape: query.shape,
        site,
      });
    }
  }

  return facts.sort((left, right) => left.query.localeCompare(right.query));
}

function sourceColumnShapesForTables(
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Readonly<Record<string, QueryShape>> {
  const scoped: Record<string, QueryShape> = {};

  for (const [identifier, entries] of tables) {
    for (const table of entries) {
      for (const [column, shape] of Object.entries(table.columns)) {
        scoped[`${identifier}.${column}`] = shape;
        scoped[`${table.annotation.name}.${column}`] = shape;
      }
    }
  }

  return scoped;
}

function sourceWithProjectExtractionResolved(
  source: string,
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): string {
  const replacements: { end: number; start: number; value: string }[] = [];
  const tableNamesByIdentifier = projectTableNamesByIdentifier(sourceFile, tableNamesBySymbol);

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDrizzleWriteCall(call)) continue;
    const expression = call.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    if (isDrizzleReceiver(expression.getExpression())) continue;

    const name = expression.getNameNode();
    replacements.push({
      end: name.getEnd(),
      start: name.getStart(),
      value: '__jisoIgnoredWrite',
    });
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const argument = access.getArgumentExpression();
    if (!Node.isStringLiteral(argument)) continue;

    const tableName = tableNamesByIdentifier.get(argument.getLiteralText());
    if (!tableName) continue;

    replacements.push({
      end: argument.getEnd(),
      start: argument.getStart(),
      value: JSON.stringify(tableName),
    });
  }

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const tableName = tableNamesBySymbol.get(resolvedSymbolKey(identifier.getSymbol()) ?? '');
    if (!tableName || identifier.getText() === tableName) continue;

    replacements.push({
      end: identifier.getEnd(),
      start: identifier.getStart(),
      value: tableName,
    });
  }

  return applySourceReplacements(source, replacements);
}

function projectTableNamesByIdentifier(
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    const tableName = tableNamesBySymbol.get(resolvedSymbolKey(name.getSymbol()) ?? '');
    if (Node.isIdentifier(name) && tableName) names.set(name.getText(), tableName);
  }

  return names;
}

function isDrizzleWriteCall(call: CallExpression): boolean {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return false;

  return ['delete', 'insert', 'update'].includes(expression.getName());
}

function isDrizzleReceiver(receiver: Node): boolean {
  const type = receiver.getType();
  const typeText = type.getText(receiver);
  if (isDrizzleDatabaseTypeText(typeText)) {
    return true;
  }

  return (
    type
      .getSymbol()
      ?.getDeclarations()
      .some((declaration) => declaration.getSourceFile().getFilePath().includes('drizzle-orm')) ??
    false
  );
}

function projectTableNamesBySymbol(
  sourceFiles: readonly SourceFile[],
): ReadonlyMap<string, string> {
  const namesBySymbol = new Map<string, string>();
  let nextTable = 0;

  for (const sourceFile of sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || !isAnnotatedTableInitializerNode(initializer)) continue;

      const symbolKey = resolvedSymbolKey(declaration.getNameNode().getSymbol());
      if (!symbolKey) continue;

      namesBySymbol.set(symbolKey, `__jisoProjectTable${nextTable}`);
      nextTable += 1;
    }
  }

  return namesBySymbol;
}

function projectColumnShapesByTable(
  sourceFiles: readonly SourceFile[],
  tableNamesBySymbol: ReadonlyMap<string, string>,
): ReadonlyMap<string, Readonly<Record<string, QueryShape>>> {
  const shapes = new Map<string, Record<string, QueryShape>>();

  for (const sourceFile of sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || !isAnnotatedTableInitializerNode(initializer)) continue;

      const tableName = tableNamesBySymbol.get(
        resolvedSymbolKey(declaration.getNameNode().getSymbol()) ?? '',
      );
      if (!tableName) continue;

      const columns = tableColumnShapes(initializer);
      if (Object.keys(columns).length > 0) shapes.set(tableName, columns);
    }
  }

  return shapes;
}

function tableColumnShapes(initializer: Node): Record<string, QueryShape> {
  const call = Node.isCallExpression(initializer) ? initializer : undefined;
  const columns = call?.getArguments()[1];
  if (!columns || !Node.isObjectLiteralExpression(columns)) return {};

  const shapes: Record<string, QueryShape> = {};
  for (const property of columns.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;

    const name = propertyNameText(property.getNameNode());
    if (!name) continue;

    const shape = columnBuilderShape(property.getInitializer());
    if (shape) shapes[name] = shape;
  }

  return shapes;
}

function propertyNameText(name: Node): string | undefined {
  if (Node.isIdentifier(name) || Node.isStringLiteral(name) || Node.isNumericLiteral(name)) {
    return name.getText().replace(/^["']|["']$/g, '');
  }
  const compilerNode = name.compilerNode;
  if (ts.isComputedPropertyName(compilerNode)) {
    const expression = compilerNode.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
    if (ts.isNumericLiteral(expression)) return expression.text;
  }
  return undefined;
}

function objectHasProperty(object: Node, name: string): boolean {
  if (!Node.isObjectLiteralExpression(object)) return false;

  return object.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property)) return false;
    return propertyNameText(property.getNameNode()) === name;
  });
}

function columnBuilderShape(initializer: Node | undefined): QueryShape | undefined {
  // SPEC §10-§11: column nullability is a parsed call-chain fact, not string contents.
  const builder = columnBuilderName(initializer);
  if (!builder) return undefined;

  const baseShape = columnBuilderBaseShape(builder);
  if (!baseShape) return undefined;
  return columnBuilderIsNonNull(initializer) ? baseShape : nullableShape(baseShape);
}

function columnBuilderBaseShape(builder: string): QueryShape | undefined {
  if (BOOLEAN_COLUMN_BUILDERS.has(builder)) return 'boolean';
  if (NUMBER_COLUMN_BUILDERS.has(builder)) return 'number';
  if (JSON_COLUMN_BUILDERS.has(builder)) return 'object';
  if (
    builder === 'text' ||
    builder === 'varchar' ||
    builder === 'uuid' ||
    builder === 'timestamp'
  ) {
    return 'string';
  }
  return undefined;
}

function columnBuilderName(initializer: Node | undefined): string | undefined {
  if (!initializer) return undefined;
  return columnBuilderNameFromExpression(
    unwrappedTsExpression(initializer.compilerNode as ts.Expression),
  );
}

function columnBuilderNameFromExpression(expression: ts.Expression): string | undefined {
  const target = unwrappedTsExpression(expression);
  if (!ts.isCallExpression(target)) return undefined;

  const callee = unwrappedTsExpression(target.expression as ts.Expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;

  const base = unwrappedTsExpression(callee.expression);
  return ts.isCallExpression(base) ? columnBuilderNameFromExpression(base) : undefined;
}

function columnBuilderIsNonNull(initializer: Node | undefined): boolean {
  if (!initializer) return false;

  for (const method of columnBuilderChainMethods(
    unwrappedTsExpression(initializer.compilerNode as ts.Expression),
  )) {
    if (method === 'notNull' || method === 'primaryKey') return true;
  }

  return false;
}

function columnBuilderChainMethods(expression: ts.Expression): string[] {
  const target = unwrappedTsExpression(expression);
  if (!ts.isCallExpression(target)) return [];

  const callee = unwrappedTsExpression(target.expression as ts.Expression);
  if (!ts.isPropertyAccessExpression(callee)) return [];

  const base = unwrappedTsExpression(callee.expression);
  const methods = ts.isCallExpression(base) ? columnBuilderChainMethods(base) : [];
  return [...methods, callee.name.text];
}

function columnShapesForFile(
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  columnShapesByTable: ReadonlyMap<string, Readonly<Record<string, QueryShape>>>,
): Readonly<Record<string, QueryShape>> {
  const shapes: Record<string, QueryShape> = {};

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const symbolKey = resolvedSymbolKey(identifier.getSymbol());
    const tableName = tableNamesBySymbol.get(symbolKey ?? '');
    const tableShapes = tableName ? columnShapesByTable.get(tableName) : undefined;
    if (!tableShapes) continue;

    for (const [column, shape] of Object.entries(tableShapes)) {
      shapes[`${identifier.getText()}.${column}`] = shape;
      shapes[`${tableName}.${column}`] = shape;
    }
  }

  return shapes;
}

function applySourceReplacements(
  source: string,
  replacements: readonly { end: number; start: number; value: string }[],
): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (next, range) => `${next.slice(0, range.start)}${range.value}${next.slice(range.end)}`,
      source,
    );
}

function resolvedSymbolKey(symbol: MorphSymbol | undefined): string | undefined {
  const target = symbol?.getAliasedSymbol() ?? symbol;
  const declaration = target?.getDeclarations()[0];
  if (!declaration) return undefined;

  return `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`;
}

function isAnnotatedTableInitializerNode(initializer: Node): boolean {
  if (!Node.isCallExpression(initializer)) return false;
  const expression = initializer.getExpression();
  if (!Node.isIdentifier(expression)) return false;
  if (!isDrizzleTableFactoryName(expression.getText())) return false;

  return initializer.getArguments().some(isJisoAnnotationCall);
}

function isJisoAnnotationCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  return Node.isIdentifier(expression) && isJisoExtraConfigCallName(expression.getText());
}

function tableNameArgument(initializer: Node): string | undefined {
  if (!Node.isCallExpression(initializer)) return undefined;
  const name = initializer.getArguments()[0];
  if (!name || !Node.isStringLiteral(name)) return undefined;
  return name.getLiteralText();
}

type ExtractedTableDeclaration = JisoTableAnnotation & {
  columns: Readonly<Record<string, QueryShape>>;
  exported: boolean;
  identifier: string;
  name: string;
};

interface ExtractedFunction {
  body: string;
  bodyStart: number;
  name: string;
  receiverNames?: readonly string[];
  unresolvedCalls?: readonly ExternalDbArgumentCall[];
  writeCalls?: readonly ExtractedWriteCall[];
}

interface ExtractedQueryDefinition {
  diagnostics?: readonly TouchGraphDiagnostic[];
  hasOutputSchema: boolean;
  index: number;
  instanceKeyComparisons: readonly QueryInstanceKeyComparison[];
  opaquePaths: readonly string[];
  query: string;
  shape: QueryShape;
  tableExpressions: readonly string[];
  unresolvedPaths: readonly string[];
}

interface QueryInstanceKeyComparison {
  left: string;
  right: string;
}

interface ExtractedWriteCall {
  index: number;
  operation: string;
  readSources: ExtractedReadSource[];
  site?: string;
  statement: string;
  tableExpression: string;
}

interface ExtractedReadSource {
  operation: 'insert-select' | 'update-from';
  tableExpression: string;
}

interface ExtractedPredicateSummary {
  key?: string;
  predicate?: 'non-eq';
}

interface FunctionTouchSummary {
  reads: ReadSummaryInput[];
  unresolved: UnresolvedSummaryInput[];
  writes: WriteSummaryInput[];
}

function extractQueryDefinitions(
  source: string,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
): ExtractedQueryDefinition[] {
  return withParsedSourceFile(source, (sourceFile) => {
    const definitions: ExtractedQueryDefinition[] = [];

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const statement = declaration.getVariableStatement();
      if (!statement || statement.getDeclarationKind() !== 'const') continue;

      const initializer = declaration.getInitializer();
      if (!initializer || !Node.isCallExpression(initializer)) continue;

      const expression = initializer.getExpression();
      if (!Node.isIdentifier(expression) || expression.getText() !== 'query') continue;

      const [queryArgument, bodyArgument] = initializer.getArguments();
      if (!Node.isStringLiteral(queryArgument) || !Node.isObjectLiteralExpression(bodyArgument)) {
        continue;
      }

      const query = queryArgument.getLiteralText();
      const receiverNames = queryCallbackReceiverNames(bodyArgument);
      const selection = selectShapeFromQueryBody(bodyArgument, receiverNames, columnShapes);
      const diagnostics = relationalQueryDiagnostics(bodyArgument, receiverNames);
      if (!selection && diagnostics.length === 0) continue;

      definitions.push({
        ...(selection?.diagnostics || diagnostics.length > 0
          ? { diagnostics: [...(selection?.diagnostics ?? []), ...diagnostics] }
          : {}),
        hasOutputSchema: objectHasProperty(bodyArgument, 'output'),
        index: declaration.getStart(),
        instanceKeyComparisons: queryInstanceKeyComparisons(bodyArgument, receiverNames),
        opaquePaths: selection?.opaquePaths ?? [],
        query,
        shape: selection?.shape ?? {},
        tableExpressions: queryTableExpressions(bodyArgument, receiverNames),
        unresolvedPaths: selection?.unresolvedPaths ?? [],
      });
    }

    return definitions;
  });
}

interface QueryShapeSelection {
  diagnostics?: readonly TouchGraphDiagnostic[];
  hasTablelessScalar: boolean;
  opaquePaths: readonly string[];
  shape: QueryShape;
  scalarTables: ReadonlySet<string>;
  unresolvedPaths: readonly string[];
}

function selectShapeFromQueryBody(
  body: ObjectLiteralExpression,
  receiverNames: ReadonlySet<string>,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
): QueryShapeSelection | null {
  const selectCall = selectCallFromQueryBody(body, receiverNames);
  if (!selectCall) return null;

  const projection = selectProjectionArgument(selectCall);
  if (!projection) {
    return {
      diagnostics: [
        {
          code: 'FW406',
          message: `${diagnosticDefinitions.FW406.message} Query uses ${selectCallDisplayName(selectCall)} without an explicit projection.`,
          severity: diagnosticDefinitions.FW406.severity,
          site: '',
        },
      ],
      hasTablelessScalar: false,
      opaquePaths: [],
      shape: {},
      scalarTables: new Set(),
      unresolvedPaths: [],
    };
  }

  if (!Node.isObjectLiteralExpression(projection)) return null;

  return queryShapeFromObjectLiteralNode(projection.compilerNode, {
    columnShapes,
    nullableTables: nullableJoinTables(body, receiverNames),
  });
}

function selectProjectionArgument(call: CallExpression): Node | undefined {
  const args = call.getArguments();
  return staticAccessName(call.getExpression()) === 'selectDistinctOn' ? args[1] : args[0];
}

function selectCallDisplayName(call: CallExpression): string {
  return `db.${staticAccessName(call.getExpression()) ?? 'select'}()`;
}

function selectCallFromQueryBody(
  body: ObjectLiteralExpression,
  receiverNames: ReadonlySet<string>,
): CallExpression | undefined {
  const selectCalls = body
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(
      (call) =>
        isSelectQueryCallName(staticAccessName(call.getExpression())) &&
        isQueryCallOnReceiver(call, receiverNames),
    )
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right));

  return (
    selectCalls.find((call) => call.getFirstAncestorByKind(SyntaxKind.ReturnStatement)) ??
    selectCalls[0]
  );
}

function isSelectQueryCallName(name: string | undefined): boolean {
  return name !== undefined && DRIZZLE_SELECT_QUERY_METHODS.has(name);
}

function queryCallbackReceiverNames(body: ObjectLiteralExpression): ReadonlySet<string> {
  const names = new Set(DEFAULT_DRIZZLE_RECEIVER_NAMES);

  for (const property of body.getProperties()) {
    const parameters = queryCallbackParameters(property.compilerNode);
    const receiver = bindingIdentifierText(parameters?.[1]?.name);
    if (receiver) names.add(receiver);
  }

  return names;
}

function queryCallbackParameters(
  property: ts.ObjectLiteralElementLike,
): ts.NodeArray<ts.ParameterDeclaration> | undefined {
  if (ts.isMethodDeclaration(property)) return property.parameters;
  if (!ts.isPropertyAssignment(property)) return undefined;

  const initializer = unwrappedTsExpression(property.initializer);
  return ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)
    ? initializer.parameters
    : undefined;
}

function bindingIdentifierText(name: ts.BindingName | undefined): string | undefined {
  return name && ts.isIdentifier(name) ? name.text : undefined;
}

function relationalQueryDiagnostics(
  body: ObjectLiteralExpression,
  receiverNames: ReadonlySet<string>,
): TouchGraphDiagnostic[] {
  if (queryRelationalTableExpressions(body, receiverNames).length === 0) return [];

  return [
    {
      code: 'FW406',
      message: `${diagnosticDefinitions.FW406.message} Query uses Drizzle relational query API without static projection.`,
      severity: diagnosticDefinitions.FW406.severity,
      site: '',
    },
  ];
}

interface QueryShapeContext {
  columnShapes: Readonly<Record<string, QueryShape>>;
  nullableTables: ReadonlySet<string>;
  prefix?: string;
}

function queryShapeFromObjectLiteralNode(
  object: ts.ObjectLiteralExpression,
  context: QueryShapeContext,
): QueryShapeSelection {
  const shape: Record<string, QueryShape> = {};
  let hasTablelessScalar = false;
  const opaquePaths: string[] = [];
  const scalarTables = new Set<string>();
  const unresolvedPaths: string[] = [];
  const prefix = context.prefix ?? '';

  for (const property of object.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      // SPEC §10-§11: unsupported projection syntax stays visible instead of disappearing.
      const shorthand = property.name.text;
      unresolvedPaths.push(prefix ? `${prefix}.${shorthand}` : shorthand);
      continue;
    }

    if (!ts.isPropertyAssignment(property)) continue;

    const key = projectionPropertyName(property.name);
    if (!key) continue;

    const valueNode = unwrappedExpression(property.initializer);
    const path = prefix ? `${prefix}.${key}` : key;
    if (ts.isObjectLiteralExpression(valueNode)) {
      const nested = queryShapeFromObjectLiteralNode(valueNode, {
        ...context,
        prefix: path,
      });
      shape[key] = nullableNestedShape(nested, context.nullableTables) ?? nested.shape;
      opaquePaths.push(...nested.opaquePaths);
      unresolvedPaths.push(...nested.unresolvedPaths);
    } else {
      const scalarShape = scalarQueryShape(valueNode, context.columnShapes, context.nullableTables);
      const opaqueProjection = isOpaqueProjection(valueNode);
      if (scalarShape) {
        shape[key] = scalarShape;
      } else if (!opaqueProjection) {
        unresolvedPaths.push(path);
      }
      if (opaqueProjection) opaquePaths.push(path);
      const table = scalarProjectionTable(valueNode);
      if (table) {
        scalarTables.add(table);
      } else if (scalarShape) {
        hasTablelessScalar = true;
      }
    }
  }

  return { hasTablelessScalar, opaquePaths, shape, scalarTables, unresolvedPaths };
}

function projectionPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function nullableNestedShape(
  nested: QueryShapeSelection,
  nullableTables: ReadonlySet<string>,
): QueryShape | undefined {
  if (nested.hasTablelessScalar) return undefined;
  if (nested.scalarTables.size !== 1) return undefined;

  const [table] = nested.scalarTables;
  return table && nullableTables.has(table) ? nullableShape(nested.shape) : undefined;
}

function scalarQueryShape(
  expression: ts.Expression,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
  nullableTables: ReadonlySet<string> = new Set(),
): QueryShape | null {
  const sqlShape = typedSqlProjectionShape(expression);
  if (sqlShape) return sqlShape;
  const columnPath = staticTsExpressionPath(expression);
  const columnShape = columnPath ? columnShapes[columnPath] : undefined;
  if (columnShape) {
    return nullableTables.has(tableExpressionBase(expression))
      ? nullableShape(columnShape)
      : columnShape;
  }
  return null;
}

function nullableShape(shape: QueryShape): QueryShape {
  if (
    typeof shape === 'object' &&
    shape !== null &&
    !Array.isArray(shape) &&
    'kind' in shape &&
    shape.kind === 'nullable'
  ) {
    return shape;
  }
  return { kind: 'nullable', shape };
}

function nullableJoinTables(
  body: ObjectLiteralExpression,
  receiverNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const tables = new Set<string>();
  const relationTables: string[] = [];

  for (const { operation, table } of queryBodyCallExpressions(body, (call) => {
    const operation = propertyAccessCallName(call);
    if (!operation || !isJoinReadCallName(operation)) return [];
    if (!isQueryCallOnReceiver(call, receiverNames)) return [];

    const table = staticExpressionPath(call.getArguments()[0]);
    if (!table) return [];

    return [{ operation, table }];
  })) {
    if (operation === 'leftJoin') {
      tables.add(table);
      relationTables.push(table);
      continue;
    }

    if (operation === 'rightJoin') {
      for (const relationTable of relationTables) {
        tables.add(relationTable);
      }
      relationTables.push(table);
      continue;
    }

    if (operation === 'fullJoin') {
      for (const relationTable of relationTables) {
        tables.add(relationTable);
      }
      tables.add(table);
      relationTables.push(table);
      continue;
    }

    relationTables.push(table);
  }

  return tables;
}

function tableExpressionBase(expression: ts.Expression): string {
  const columnPath = staticTsExpressionPath(expression);
  if (!columnPath) return '';

  const columnStart = columnPath.lastIndexOf('.');
  return columnStart > 0 ? columnPath.slice(0, columnStart) : '';
}

function scalarProjectionTable(expression: ts.Expression): string | undefined {
  const table = tableExpressionBase(expression);
  return table || undefined;
}

function isOpaqueProjection(expression: ts.Expression): boolean {
  const node = unwrappedExpression(expression);
  if (ts.isTaggedTemplateExpression(node)) return staticTsExpressionPath(node.tag) === 'sql';
  if (!ts.isCallExpression(node)) return false;

  const callee = staticTsExpressionPath(node.expression);
  return callee === 'sql' || callee === 'raw' || callee?.startsWith('sql.') === true;
}

function typedSqlProjectionShape(expression: ts.Expression): QueryShape | null {
  const node = unwrappedExpression(expression);
  const typeArguments = ts.isTaggedTemplateExpression(node)
    ? node.typeArguments
    : ts.isCallExpression(node)
      ? node.typeArguments
      : undefined;
  const callee = ts.isTaggedTemplateExpression(node)
    ? staticTsExpressionPath(node.tag)
    : ts.isCallExpression(node)
      ? staticTsExpressionPath(node.expression)
      : undefined;
  if (callee !== 'sql' || typeArguments?.length !== 1) return null;

  const typeText = typeArguments[0]?.getText(node.getSourceFile()).trim();
  if (typeText === 'number') return 'number';
  if (typeText === 'boolean') return 'boolean';
  if (typeText === 'string') return 'string';
  return null;
}

function unwrappedExpression(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression)
    ? unwrappedExpression(expression.expression)
    : expression;
}

function staticTsExpressionPath(expression: ts.Expression): string | undefined {
  const node = unwrappedExpression(expression);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const base = staticTsExpressionPath(node.expression);
    return base ? `${base}.${node.name.text}` : undefined;
  }
  if (ts.isElementAccessExpression(node)) {
    const base = staticTsExpressionPath(node.expression);
    const name = staticTsElementAccessName(node.argumentExpression);
    return base && name ? `${base}.${name}` : undefined;
  }
  return undefined;
}

function staticTsElementAccessName(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;

  const node = unwrappedExpression(expression);
  if (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }
  return undefined;
}

function opaqueProjectionDiagnostics(
  query: string,
  opaquePaths: readonly string[],
  line: string,
  hasOutput: boolean,
): TouchGraphDiagnostic[] {
  if (hasOutput) return [];

  const definition = diagnosticDefinitions.FW410;
  const message = diagnosticDefinitionText('FW410', { preferHelp: true });
  return opaquePaths.map((path) => ({
    code: 'FW410',
    message: `${message} ${query}.${path} uses sql/raw projection without output.`,
    severity: definition.severity,
    site: line,
  }));
}

function unresolvedProjectionDiagnostics(
  query: string,
  unresolvedPaths: readonly string[],
  site: string,
): TouchGraphDiagnostic[] {
  // SPEC §10.2/§11.1: unresolved static facts stay visible instead of guessed.
  return unresolvedPaths.map((path) => ({
    code: 'FW406',
    message: `${diagnosticDefinitions.FW406.message} Query projection ${query}.${path} could not be resolved to a Drizzle column or typed sql<T> expression.`,
    severity: diagnosticDefinitions.FW406.severity,
    site,
  }));
}

function queryReadDomains(
  tableExpressions: readonly string[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const domains = new Set<string>();

  for (const tableExpression of tableExpressions) {
    for (const table of tables.get(tableExpression) ?? []) {
      if (!isDomainTableAnnotation(table.annotation)) continue;
      domains.add(table.annotation.domain);
    }
  }

  return [...domains].sort();
}

function exemptQueryReadDiagnostics(
  tableExpressions: readonly string[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  site: string,
): TouchGraphDiagnostic[] {
  const exemptTables = new Set<string>();

  for (const tableExpression of tableExpressions) {
    for (const table of tables.get(tableExpression) ?? []) {
      if (isExemptTableAnnotation(table.annotation)) exemptTables.add(table.annotation.name);
    }
  }

  if (exemptTables.size === 0) return [];

  return [
    {
      code: 'FW411',
      message: `${FW411_MESSAGE}. Tables: ${[...exemptTables].sort().join(', ')}.`,
      severity: 'error',
      site,
    },
  ];
}

function queryTableExpressions(
  body: ObjectLiteralExpression,
  receiverNames: ReadonlySet<string>,
): string[] {
  return [
    ...queryJoinTableExpressions(body, receiverNames),
    ...queryRelationalTableExpressions(body, receiverNames),
  ];
}

function queryJoinTableExpressions(
  body: ObjectLiteralExpression,
  receiverNames: ReadonlySet<string>,
): string[] {
  return queryBodyCallExpressions(body, (call) => {
    const name = propertyAccessCallName(call);
    if (!name || !isQueryReadCallName(name)) return [];
    if (!isQueryCallOnReceiver(call, receiverNames)) return [];

    const table = staticExpressionPath(call.getArguments()[0]);
    return table ? [table] : [];
  });
}

function queryRelationalTableExpressions(
  body: ObjectLiteralExpression,
  receiverNames: ReadonlySet<string>,
): string[] {
  return queryBodyCallExpressions(body, (call) => {
    const expression = call.getExpression();
    const method = staticAccessName(expression);
    if (method !== 'findMany' && method !== 'findFirst') return [];

    const tableAccess = staticAccessExpression(expression);
    if (!tableAccess) return [];
    const table = staticAccessName(tableAccess);
    if (!table) return [];

    const queryAccess = staticAccessExpression(tableAccess);
    if (!queryAccess || staticAccessName(queryAccess) !== 'query') return [];
    const receiver = staticAccessExpression(queryAccess);
    // SPEC §10-§11: non-DB objects must not fabricate relational read/FW406 facts.
    if (!Node.isIdentifier(receiver) || !receiverNames.has(receiver.getText())) return [];

    return [table];
  });
}

function queryBodyCallExpressions<T>(
  body: ObjectLiteralExpression,
  extract: (call: CallExpression) => readonly T[],
): T[] {
  return body
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right))
    .flatMap(extract);
}

function isQueryCallOnReceiver(call: CallExpression, receiverNames: ReadonlySet<string>): boolean {
  // SPEC §11.1: read facts must originate from the Drizzle receiver, not lookalike builders.
  const receiver = queryCallChainReceiver(call);
  return Node.isIdentifier(receiver) && receiverNames.has(receiver.getText());
}

function queryCallChainReceiver(call: CallExpression): Node | undefined {
  let receiver = staticAccessExpression(call.getExpression());

  while (receiver && Node.isCallExpression(receiver)) {
    receiver = staticAccessExpression(receiver.getExpression());
  }

  return receiver;
}

function callSourceOrder(call: CallExpression): number {
  const expression = call.getExpression();
  return Node.isPropertyAccessExpression(expression)
    ? expression.getNameNode().getStart()
    : call.getStart();
}

function isQueryReadCallName(name: string): boolean {
  return (
    name === 'from' ||
    name === 'innerJoin' ||
    name === 'leftJoin' ||
    name === 'rightJoin' ||
    name === 'fullJoin'
  );
}

function isJoinReadCallName(name: string): boolean {
  return name === 'join' || isQueryReadCallName(name);
}

function staticExpressionPath(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isPropertyAccessExpression(node)) {
    const base = staticExpressionPath(node.getExpression());
    return base ? `${base}.${node.getName()}` : undefined;
  }
  if (Node.isElementAccessExpression(node)) {
    const base = staticExpressionPath(node.getExpression());
    const name = staticAccessName(node);
    return base && name ? `${base}.${name}` : undefined;
  }
  return undefined;
}

function queryInstanceKey(
  comparisons: readonly QueryInstanceKeyComparison[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  // SPEC §10-§11: query keys must come from real predicates, not comment/string text.
  for (const comparison of comparisons) {
    const instanceKey = queryInstanceKeyFromEqArgs(comparison.left, comparison.right, tables);
    if (instanceKey) return instanceKey;
  }

  return null;
}

function queryInstanceKeyComparisons(
  body: ObjectLiteralExpression,
  receiverNames: ReadonlySet<string>,
): QueryInstanceKeyComparison[] {
  return queryBodyCallExpressions(body, (call) => {
    if (propertyAccessCallName(call) !== 'where') return [];
    if (!isQueryCallOnReceiver(call, receiverNames)) return [];

    const predicate = call.getArguments()[0];
    if (!predicate || !Node.isCallExpression(predicate)) return [];

    const expression = predicate.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'eq') return [];

    const [left, right] = predicate.getArguments();
    if (!left || !right) return [];

    const leftPath = staticExpressionPath(left);
    const rightPath = staticExpressionPath(right);
    return leftPath && rightPath ? [{ left: leftPath, right: rightPath }] : [];
  });
}

function queryInstanceKeyFromEqArgs(
  left: string,
  right: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  for (const side of [left, right]) {
    const tableKey = tableKeyExpression(side.trim(), tables);
    if (!tableKey) continue;

    const other = side === left ? right : left;
    const inputKey = inputKeyExpression(other.trim());
    if (!inputKey) continue;

    return {
      instanceKey: {
        domain: tableKey.domain,
        key: inputKey,
      },
    };
  }

  return null;
}

function tableKeyExpression(
  expression: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): { domain: string } | null {
  const match =
    /^(?<table>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\.(?<key>[A-Za-z_$][\w$]*)$/.exec(
      expression,
    );
  if (!match?.groups) return null;
  const tableName = match.groups.table;
  const key = match.groups.key;
  if (!tableName || !key) return null;

  for (const table of tables.get(tableName) ?? []) {
    if (isDomainTableAnnotation(table.annotation) && table.annotation.key === key) {
      return { domain: table.annotation.domain };
    }
  }

  return null;
}

function inputKeyExpression(expression: string): string | null {
  const match = /^input\.(?<key>[A-Za-z_$][\w$]*)$/.exec(expression);
  return match?.groups?.key ? `arg:${match.groups.key}` : null;
}

function directSummaryForFunction(
  fn: ExtractedFunction,
  file: SourceFileInput,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
  localFunctionNames: ReadonlySet<string>,
): FunctionTouchSummary {
  const reads: ReadSummaryInput[] = [];
  const writes: WriteSummaryInput[] = [];
  const unresolved: UnresolvedSummaryInput[] = [];
  const receiverNames =
    fn.receiverNames === undefined ? drizzleReceiverNames(fn.body) : new Set(fn.receiverNames);

  for (const call of fn.writeCalls ?? extractDrizzleWriteCalls(fn.body, receiverNames)) {
    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        if (isExemptTableAnnotation(table.annotation)) continue;
        const writePredicate = extractPredicateSummary(
          call.statement,
          call.tableExpression,
          table.annotation,
        );
        writes.push({
          operation: call.operation,
          site,
          table: table.annotation,
          ...(writePredicate.predicate ? { predicate: writePredicate.predicate } : {}),
          ...(writePredicate.key ? { writeKey: writePredicate.key } : {}),
        });
      }
      for (const readSource of call.readSources) {
        const readTables = tables.get(readSource.tableExpression) ?? [];
        if (readTables.length > 0) {
          for (const readTable of readTables) {
            if (isExemptTableAnnotation(readTable.annotation)) continue;
            const readPredicate = extractPredicateSummary(
              call.statement,
              readSource.tableExpression,
              readTable.annotation,
            );
            reads.push({
              operation: readSource.operation,
              ...(readPredicate.predicate ? { predicate: readPredicate.predicate } : {}),
              ...(readPredicate.key ? { readKey: readPredicate.key } : {}),
              site,
              table: readTable.annotation,
            });
          }
          if (unresolvedIdentifiers.has(readSource.tableExpression)) {
            unresolved.push({
              operation: readSource.operation,
              site,
            });
          }
          continue;
        }

        unresolved.push({
          operation: readSource.operation,
          site,
        });
      }
      if (unresolvedIdentifiers.has(call.tableExpression)) {
        unresolved.push({
          operation: call.operation,
          site,
        });
      }
      continue;
    }

    unresolved.push({
      operation: call.operation,
      site,
    });
  }

  const unresolvedCalls = fn.unresolvedCalls ?? [
    ...extractExternalDbArgumentCalls(fn.body, receiverNames, localFunctionNames),
    ...extractUnclassifiedDrizzleReceiverCalls(fn.body, receiverNames),
  ];
  for (const call of unresolvedCalls) {
    unresolved.push({
      operation: call.name,
      site: `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`,
    });
  }

  return { reads, unresolved, writes };
}

function mergeSummary(target: FunctionTouchSummary, source: FunctionTouchSummary): boolean {
  let changed = false;

  changed = pushUnique(target.reads, source.reads, readSummaryKey) || changed;
  changed = pushUnique(target.unresolved, source.unresolved, unresolvedSummaryKey) || changed;
  changed = pushUnique(target.writes, source.writes, writeSummaryKey) || changed;

  return changed;
}

function pushUnique<T>(target: T[], source: readonly T[], keyFor: (item: T) => string): boolean {
  const keys = new Set(target.map(keyFor));
  let changed = false;

  for (const item of source) {
    const key = keyFor(item);
    if (keys.has(key)) continue;

    keys.add(key);
    target.push(item);
    changed = true;
  }

  return changed;
}

function readSummaryKey(read: ReadSummaryInput): string {
  return [
    read.operation,
    read.table.name,
    read.site,
    read.readKey ?? '',
    read.predicate ?? '',
    read.branch ?? '',
  ].join('\0');
}

function unresolvedSummaryKey(unresolved: UnresolvedSummaryInput): string {
  return [unresolved.operation, unresolved.site, unresolved.domain ?? ''].join('\0');
}

function writeSummaryKey(write: WriteSummaryInput): string {
  return [
    write.operation,
    write.table.name,
    write.site,
    write.writeKey ?? '',
    write.predicate ?? '',
    write.branch ?? '',
  ].join('\0');
}

function extractTables(source: string): ExtractedTableDeclaration[] {
  const tables: ExtractedTableDeclaration[] = [];
  const byIdentifier = new Map<string, ExtractedTableDeclaration[]>();
  const declarations = variableDeclarationsFromSource(source);

  for (const { exported, identifier, table: extractedTable } of declarations) {
    if (!extractedTable) continue;
    const table = {
      identifier,
      columns: extractedTable.columns,
      exported,
      name: extractedTable.name,
      ...extractedTable.annotation,
    };
    tables.push(table);
    appendTable(byIdentifier, identifier, table);
  }

  for (const declaration of declarations) {
    if ((byIdentifier.get(declaration.identifier)?.length ?? 0) > 0) continue;

    for (const target of declaration.aliasTargets) {
      for (const table of byIdentifier.get(target) ?? []) {
        const alias = {
          identifier: declaration.identifier,
          columns: table.columns,
          exported: declaration.exported,
          name: table.name,
          ...copyTableAnnotation(table),
        };
        tables.push(alias);
        appendTable(byIdentifier, alias.identifier, alias);
      }
    }
  }

  return tables;
}

function tableAnnotation(initializer: Node): JisoTableAnnotation | null {
  if (!Node.isCallExpression(initializer)) return null;
  const annotationCall = initializer.getArguments().find(isJisoAnnotationCall);
  if (!annotationCall || !Node.isCallExpression(annotationCall)) return null;
  const annotationObject = annotationCall.getArguments()[0];
  if (!annotationObject || !Node.isObjectLiteralExpression(annotationObject)) return null;

  if (booleanPropertyFromObject(annotationObject, 'exempt') === true) return { exempt: true };
  const domain = stringPropertyFromObject(annotationObject, 'domain');
  if (!domain) return null;
  const key = stringPropertyFromObject(annotationObject, 'key');
  return { domain, ...(key ? { key } : {}) };
}

function copyTableAnnotation(table: ExtractedTableDeclaration): JisoTableAnnotation {
  if (isExemptTableAnnotation(table)) return { exempt: true };
  return { domain: table.domain, ...(table.key ? { key: table.key } : {}) };
}

function stringPropertyFromObject(object: Node, name: string): string | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (initializer && Node.isStringLiteral(initializer)) return initializer.getLiteralText();
  }

  return undefined;
}

function booleanPropertyFromObject(object: Node, name: string): boolean | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;

    const initializer = property.getInitializer();
    if (!initializer) return undefined;
    if (initializer.getKind() === SyntaxKind.TrueKeyword) return true;
    if (initializer.getKind() === SyntaxKind.FalseKeyword) return false;
  }

  return undefined;
}

interface SourceVariableDeclaration {
  aliasTargets: readonly string[];
  conditionalTargets: readonly (string | undefined)[];
  exported: boolean;
  identifier: string;
  table?: {
    annotation: JisoTableAnnotation;
    columns: Record<string, QueryShape>;
    name: string;
  };
}

function variableDeclarationsFromSource(source: string): SourceVariableDeclaration[] {
  return withParsedSourceFile(source, (sourceFile) =>
    sourceFile.getVariableDeclarations().flatMap((declaration) => {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!initializer || !Node.isIdentifier(name)) return [];

      const annotation = isAnnotatedTableInitializerNode(initializer)
        ? tableAnnotation(initializer)
        : null;
      return [
        {
          aliasTargets: aliasTargetsFromInitializer(initializer),
          conditionalTargets: conditionalTargetsFromInitializer(initializer),
          exported: variableDeclarationIsExported(declaration),
          identifier: name.getText(),
          ...(annotation
            ? {
                table: {
                  annotation,
                  columns: tableColumnShapes(initializer),
                  name: tableNameArgument(initializer) ?? name.getText(),
                },
              }
            : {}),
        },
      ];
    }),
  );
}

function variableDeclarationIsExported(
  declaration: ReturnType<SourceFile['getVariableDeclarations']>[number],
): boolean {
  return (
    declaration
      .getVariableStatement()
      ?.getModifiers()
      .some((modifier) => modifier.getKind() === SyntaxKind.ExportKeyword) ?? false
  );
}

function withParsedSourceFile<T>(source: string, visit: (sourceFile: SourceFile) => T): T {
  const project = new Project({
    compilerOptions: {
      allowJs: false,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    },
    skipAddingFilesFromTsConfig: true,
  });
  const sourceFile = project.createSourceFile(SOURCE_EXTRACTION_FILE_NAME, source);

  try {
    return visit(sourceFile);
  } finally {
    sourceFile.forget();
  }
}

interface SourceModuleContext {
  fileNames: ReadonlySet<string>;
  filesByName: ReadonlyMap<string, SourceFileInput>;
  tablesByFileName: ReadonlyMap<string, ReadonlyMap<string, readonly ExtractedTable[]>>;
}

interface TableAlias {
  imported: string;
  local: string;
  moduleSpecifier: string;
}

interface NamespaceImportAlias {
  local: string;
  moduleSpecifier: string;
}

function sourceModuleContext(files: readonly SourceFileInput[]): SourceModuleContext {
  const tablesByFileName = new Map<string, Map<string, ExtractedTable[]>>();

  for (const file of files) {
    const tables = new Map<string, ExtractedTable[]>();
    for (const table of extractTables(file.source)) {
      appendTable(tables, table.identifier, {
        annotation: table,
        columns: table.columns,
        exported: table.exported,
      });
    }
    tablesByFileName.set(file.fileName, tables);
  }

  return {
    fileNames: new Set(files.map((file) => file.fileName)),
    filesByName: new Map(files.map((file) => [file.fileName, file])),
    tablesByFileName,
  };
}

function tablesForFile(
  file: SourceFileInput,
  context: SourceModuleContext,
): Map<string, ExtractedTable[]> {
  // SPEC §10-§11: imported table facts are proven from the referenced source module.
  const scoped = cloneTableMap(context.tablesByFileName.get(file.fileName) ?? new Map());

  for (const namespace of namespaceImportAliases(file.source)) {
    const moduleFileName = resolveRelativeModuleFileName(
      file.fileName,
      namespace.moduleSpecifier,
      context.fileNames,
    );
    if (!moduleFileName) continue;

    for (const [identifier, entries] of exportedTablesForFile(moduleFileName, context)) {
      appendTableEntries(scoped, `${namespace.local}.${identifier}`, entries);
    }
  }
  for (const alias of importTableAliasesForSource(file.source)) {
    const moduleFileName = resolveRelativeModuleFileName(
      file.fileName,
      alias.moduleSpecifier,
      context.fileNames,
    );
    if (!moduleFileName) continue;

    appendTableEntries(
      scoped,
      alias.local,
      tableEntriesForExport(moduleFileName, alias.imported, context),
    );
  }

  return scoped;
}

function cloneTableMap(
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Map<string, ExtractedTable[]> {
  return new Map([...tables].map(([identifier, entries]) => [identifier, [...entries]]));
}

function exportedTableMap(
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Map<string, ExtractedTable[]> {
  const exported = new Map<string, ExtractedTable[]>();

  for (const [identifier, entries] of tables) {
    const tableExports = entries.filter((entry) => entry.exported);
    if (tableExports.length > 0) exported.set(identifier, tableExports);
  }

  return exported;
}

function exportedTablesForFile(
  fileName: string,
  context: SourceModuleContext,
  seen = new Set<string>(),
): Map<string, ExtractedTable[]> {
  if (seen.has(fileName)) return new Map();
  seen.add(fileName);

  const exported = exportedTableMap(context.tablesByFileName.get(fileName) ?? new Map());
  const file = context.filesByName.get(fileName);
  if (!file) return exported;

  for (const alias of exportTableAliasesForSource(file.source)) {
    const moduleFileName = resolveRelativeModuleFileName(
      fileName,
      alias.moduleSpecifier,
      context.fileNames,
    );
    if (!moduleFileName) continue;

    appendTableEntries(
      exported,
      alias.local,
      tableEntriesForExport(moduleFileName, alias.imported, context, seen),
    );
  }

  return exported;
}

function tableEntriesForExport(
  fileName: string,
  exportedName: string,
  context: SourceModuleContext,
  seen = new Set<string>(),
): readonly ExtractedTable[] {
  const local = context.tablesByFileName.get(fileName)?.get(exportedName);
  const localExports = local?.filter((entry) => entry.exported) ?? [];
  if (localExports.length > 0) return localExports;

  const file = context.filesByName.get(fileName);
  if (!file || seen.has(fileName)) return [];
  seen.add(fileName);

  for (const alias of exportTableAliasesForSource(file.source)) {
    if (alias.local !== exportedName) continue;

    const moduleFileName = resolveRelativeModuleFileName(
      fileName,
      alias.moduleSpecifier,
      context.fileNames,
    );
    if (!moduleFileName) continue;

    const entries = tableEntriesForExport(moduleFileName, alias.imported, context, seen);
    if (entries.length > 0) return entries;
  }

  return [];
}

function resolveRelativeModuleFileName(
  fromFileName: string,
  moduleSpecifier: string,
  fileNames: ReadonlySet<string>,
): string | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined;

  const directory = fromFileName.includes('/')
    ? fromFileName.slice(0, fromFileName.lastIndexOf('/'))
    : '';
  const base = normalizeModulePath(directory ? `${directory}/${moduleSpecifier}` : moduleSpecifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
  ];

  return candidates.find((candidate) => fileNames.has(candidate));
}

function normalizeModulePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join('/');
}

function namespaceImportAliases(source: string): NamespaceImportAlias[] {
  return withParsedSourceFile(source, (sourceFile) =>
    sourceFile.getImportDeclarations().flatMap((declaration) => {
      const local = declaration.getNamespaceImport()?.getText();
      const moduleSpecifier = declaration.getModuleSpecifierValue();
      return local ? [{ local, moduleSpecifier }] : [];
    }),
  );
}

function importTableAliasesForSource(source: string): TableAlias[] {
  return withParsedSourceFile(source, importTableAliases);
}

function exportTableAliasesForSource(source: string): TableAlias[] {
  return withParsedSourceFile(source, exportTableAliases);
}

function importTableAliases(sourceFile: SourceFile): TableAlias[] {
  const aliases: TableAlias[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = declaration.getModuleSpecifierValue();
    for (const specifier of declaration.getNamedImports()) {
      const alias = specifier.getAliasNode()?.getText();
      const imported = specifier.getNameNode().getText();
      aliases.push({
        imported,
        local: alias && alias !== imported ? alias : imported,
        moduleSpecifier,
      });
    }
  }

  return aliases;
}

function exportTableAliases(sourceFile: SourceFile): TableAlias[] {
  const aliases: TableAlias[] = [];

  for (const declaration of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = declaration.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;

    for (const specifier of declaration.getNamedExports()) {
      const alias = specifier.getAliasNode()?.getText();
      const imported = specifier.getNameNode().getText();
      aliases.push({
        imported,
        local: alias && alias !== imported ? alias : imported,
        moduleSpecifier,
      });
    }
  }

  return aliases;
}

function extractUnresolvedConditionalIdentifiers(
  source: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const unresolved: string[] = [];

  for (const declaration of variableDeclarationsFromSource(source)) {
    const targets = declaration.conditionalTargets;
    if (targets.length === 0) continue;

    const resolvedCount = targets.filter(
      (target) => target && (tables.get(target)?.length ?? 0) > 0,
    ).length;
    if (resolvedCount > 0 && resolvedCount < targets.length)
      unresolved.push(declaration.identifier);
  }

  return unresolved;
}

function aliasTargetsFromInitializer(initializer: Node): string[] {
  // SPEC §10-§11: alias facts must come from parsed initializer expressions, not string splits.
  const sourceFile = initializer.getSourceFile();
  const expression = unwrappedTsExpression(initializer.compilerNode as ts.Expression);

  if (ts.isIdentifier(expression)) return [expression.text];

  if (ts.isCallExpression(expression)) {
    const callee = unwrappedTsExpression(expression.expression);
    const target = expression.arguments[0];
    if (ts.isIdentifier(callee) && callee.text === 'alias' && target) {
      const targetExpression = unwrappedTsExpression(target as ts.Expression);
      return ts.isIdentifier(targetExpression) ? [targetExpression.text] : [];
    }
  }

  if (ts.isConditionalExpression(expression)) {
    return conditionalTargetsFromExpression(expression, sourceFile).filter(
      (target): target is string => target !== undefined,
    );
  }

  return [];
}

function conditionalTargetsFromInitializer(initializer: Node): readonly (string | undefined)[] {
  const expression = unwrappedTsExpression(initializer.compilerNode as ts.Expression);
  if (!ts.isConditionalExpression(expression)) return [];

  return conditionalTargetsFromExpression(expression, initializer.getSourceFile());
}

function conditionalTargetsFromExpression(
  expression: ts.ConditionalExpression,
  sourceFile: SourceFile,
): readonly (string | undefined)[] {
  return [
    staticIdentifierExpression(expression.whenTrue, sourceFile),
    staticIdentifierExpression(expression.whenFalse, sourceFile),
  ];
}

function staticIdentifierExpression(
  expression: ts.Expression,
  sourceFile: SourceFile,
): string | undefined {
  const target = unwrappedTsExpression(expression);
  return ts.isIdentifier(target) ? target.getText(sourceFile.compilerNode) : undefined;
}

function unwrappedTsExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) return unwrappedTsExpression(expression.expression);
  if (ts.isAsExpression(expression)) return unwrappedTsExpression(expression.expression);
  if (ts.isSatisfiesExpression(expression)) return unwrappedTsExpression(expression.expression);
  return expression;
}

function extractFunctions(source: string): ExtractedFunction[] {
  return withParsedSourceFile(source, (sourceFile) => [
    ...extractFunctionDeclarations(sourceFile),
    ...extractVariableAssignedFunctions(sourceFile),
    ...extractDomainWriteCallbacks(sourceFile),
  ]);
}

function extractFunctionDeclarations(sourceFile: SourceFile): ExtractedFunction[] {
  const functions: ExtractedFunction[] = [];

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const name = declaration.getName();
    if (!name) continue;

    functions.push(extractedFunctionFromCallback(name, declaration));
  }

  return functions;
}

function extractVariableAssignedFunctions(sourceFile: SourceFile): ExtractedFunction[] {
  const functions: ExtractedFunction[] = [];

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) continue;

    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;

    functions.push(extractedFunctionFromCallback(name.getText(), initializer));
  }

  return functions;
}

function extractDomainWriteCallbacks(sourceFile: SourceFile): ExtractedFunction[] {
  const callbacks: ExtractedFunction[] = [];

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const domainName = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(domainName) || !initializer) continue;
    if (!Node.isCallExpression(initializer)) continue;
    const expression = initializer.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'domain') continue;

    const domainObject = initializer.getArguments()[0];
    if (!domainObject || !Node.isObjectLiteralExpression(domainObject)) continue;

    for (const property of domainObject.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const memberName = propertyNameText(property.getNameNode());
      if (!memberName) continue;

      const callback = writeCallbackFunction(property.getInitializer());
      if (!callback) continue;

      callbacks.push(
        extractedFunctionFromCallback(`${domainName.getText()}.${memberName}`, callback),
      );
    }
  }

  return callbacks;
}

function writeCallbackFunction(
  initializer: Node | undefined,
): ReturnType<CallExpression['getArguments']>[number] | null {
  if (!initializer || !Node.isCallExpression(initializer)) return null;
  const expression = initializer.getExpression();
  if (!Node.isIdentifier(expression) || expression.getText() !== 'write') return null;

  return (
    initializer
      .getArguments()
      .findLast(
        (argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument),
      ) ?? null
  );
}

function extractedFunctionFromCallback(name: string, callback: Node): ExtractedFunction {
  const body = functionBody(callback);
  const bodyStart = Node.isBlock(body) ? body.getStart() + 1 : body.getStart();
  const bodyEnd = Node.isBlock(body) ? body.getEnd() - 1 : body.getEnd();
  const bodyText = body.getSourceFile().getFullText().slice(bodyStart, bodyEnd);

  return {
    body: bodyText,
    bodyStart,
    name,
    receiverNames: sourceDrizzleReceiverNames(callback, bodyText),
  };
}

function functionBody(callback: Node): Node {
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionDeclaration(callback) ||
    Node.isFunctionExpression(callback)
  ) {
    const body = callback.getBody();
    if (body) return body;
  }

  throw new Error('Expected a write callback function');
}

function extractLocalFunctionCalls(source: string): string[] {
  // SPEC §10-§11: helper names in comments/strings must not fold unrelated touch facts.
  return withParsedFunctionBodySource(source, ({ sourceFile }) => {
    const calls: string[] = [];

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!Node.isIdentifier(expression)) continue;

      const name = expression.getText();
      if (IGNORED_LOCAL_CALL_NAMES.has(name)) continue;

      calls.push(name);
    }

    return [...new Set(calls)];
  });
}

function extractDrizzleWriteCalls(
  source: string,
  receiverNames: ReadonlySet<string> = DEFAULT_DRIZZLE_RECEIVER_NAMES,
): ExtractedWriteCall[] {
  // SPEC §10-§11: source text in comments/strings must not fabricate touch-graph facts.
  return withParsedFunctionBodySource(source, ({ bodyOffset, sourceFile }) => {
    const calls: ExtractedWriteCall[] = [];

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!isDrizzleWriteCall(call)) continue;

      const expression = call.getExpression();
      if (!Node.isPropertyAccessExpression(expression)) continue;
      const receiver = expression.getExpression();
      if (!isSourceDrizzleReceiverIdentifier(receiver, receiverNames)) continue;

      const chain = drizzleWriteChainRoot(call);
      const operation = expression.getName();
      const start = call.getStart() - bodyOffset;
      const tableExpression = call.getArguments()[0]?.getText().trim();
      if (start < 0 || !tableExpression) continue;

      const statement = source.slice(chain.getStart() - bodyOffset, chain.getEnd() - bodyOffset);
      calls.push({
        index: start,
        operation,
        readSources: extractReadSources(statement, operation),
        statement,
        tableExpression,
      });
    }

    return calls;
  });
}

function withParsedFunctionBodySource<T>(
  source: string,
  visit: (parsed: { bodyOffset: number; sourceFile: SourceFile }) => T,
): T {
  const prefix = 'async function __jisoExtractedBody() {\n';
  return withParsedSourceFile(`${prefix}${source}\n}`, (sourceFile) =>
    visit({ bodyOffset: prefix.length, sourceFile }),
  );
}

interface ExternalDbArgumentCall {
  index: number;
  name: string;
}

function extractExternalDbArgumentCalls(
  source: string,
  receiverNames: ReadonlySet<string>,
  localFunctionNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  // SPEC §10-§11: helper-call text in comments/strings/templates must not fabricate FW406 facts.
  return withParsedFunctionBodySource(source, ({ bodyOffset, sourceFile }) => {
    const calls: ExternalDbArgumentCall[] = [];

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (!Node.isIdentifier(expression)) continue;

      const name = expression.getText();
      if (IGNORED_LOCAL_CALL_NAMES.has(name) || localFunctionNames.has(name)) continue;

      if (
        !call.getArguments().some((arg) => isSourceDrizzleReceiverIdentifier(arg, receiverNames))
      ) {
        continue;
      }

      const index = call.getStart() - bodyOffset;
      if (index >= 0) calls.push({ index, name });
    }

    return calls;
  });
}

function extractUnclassifiedDrizzleReceiverCalls(
  source: string,
  receiverNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  return [
    ...extractReceiverMutationCalls(source, receiverNames),
    ...extractRelationalQueryCalls(source, receiverNames),
  ];
}

function extractReceiverMutationCalls(
  source: string,
  receiverNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  // SPEC §10-§11: string/template text cannot fabricate unresolved touch-graph surfaces.
  return withParsedFunctionBodySource(source, ({ bodyOffset, sourceFile }) => {
    const calls: ExternalDbArgumentCall[] = [];

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const name = staticAccessName(expression);
      if (!name || !UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS.has(name)) continue;

      const receiver = staticAccessExpression(expression);
      if (!isSourceDrizzleReceiverIdentifier(receiver, receiverNames)) continue;

      const index = call.getStart() - bodyOffset;
      if (index >= 0) calls.push({ index, name });
    }

    return calls;
  });
}

function extractRelationalQueryCalls(
  source: string,
  receiverNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  // SPEC §10-§11: string/template text cannot fabricate unresolved touch-graph surfaces.
  return withParsedFunctionBodySource(source, ({ bodyOffset, sourceFile }) => {
    const calls: ExternalDbArgumentCall[] = [];

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      const method = staticAccessName(expression);
      if (method !== 'findMany' && method !== 'findFirst') continue;

      const tableAccess = staticAccessExpression(expression);
      if (!tableAccess || !staticAccessName(tableAccess)) continue;
      const queryAccess = staticAccessExpression(tableAccess);
      if (!queryAccess || staticAccessName(queryAccess) !== 'query') continue;
      const receiver = staticAccessExpression(queryAccess);
      if (!isSourceDrizzleReceiverIdentifier(receiver, receiverNames)) continue;

      const index = call.getStart() - bodyOffset;
      if (index >= 0) calls.push({ index, name: `query.${method}` });
    }

    return calls;
  });
}

function drizzleReceiverNames(body = ''): Set<string> {
  const names = new Set(DEFAULT_DRIZZLE_RECEIVER_NAMES);
  appendBodyReceiverAliases(body, names);

  return names;
}

function appendBodyReceiverAliases(body: string, names: Set<string>): void {
  for (const alias of destructuredDrizzleReceiverAliases(body)) {
    names.add(alias);
  }
}

function isSourceDrizzleReceiverIdentifier(
  node: Node | undefined,
  receiverNames: ReadonlySet<string>,
  seen: Set<Node> = new Set(),
): boolean {
  if (!node || !Node.isIdentifier(node)) return false;

  const symbol = node.getSymbol();
  const declarations = symbol?.getDeclarations() ?? [];
  if (declarations.length === 0) return receiverNames.has(node.getText());

  if (declarations.some((declaration) => isSourceReceiverBindingDeclaration(declaration))) {
    return receiverNames.has(node.getText());
  }

  for (const declaration of declarations) {
    const parameter = receiverParameterDeclaration(declaration);
    if (!parameter || seen.has(parameter)) continue;
    seen.add(parameter);

    const callback = parameter.getParent();
    if (
      !Node.isArrowFunction(callback) &&
      !Node.isFunctionExpression(callback) &&
      !Node.isFunctionDeclaration(callback)
    ) {
      continue;
    }
    if (callback.getParameters()[0] !== parameter) continue;

    const call = callback.getParent();
    if (!Node.isCallExpression(call)) continue;

    const expression = call.getExpression();
    if (staticAccessName(expression) !== 'transaction') continue;

    if (
      isSourceDrizzleReceiverIdentifier(staticAccessExpression(expression), receiverNames, seen)
    ) {
      return true;
    }
  }

  return false;
}

function isSourceReceiverBindingDeclaration(declaration: Node): boolean {
  let binding: BindingElement | null = null;
  if (Node.isBindingElement(declaration)) {
    binding = declaration;
  } else if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isBindingElement(parent)) binding = parent;
  }
  if (!binding) return false;

  const bindingName = binding.getNameNode();
  const propertyName = binding.getPropertyNameNode()?.getText();
  if (!propertyName && Node.isIdentifier(bindingName)) {
    return isLikelyDrizzleReceiver(bindingName.getText());
  }

  return propertyName === 'db' || propertyName === 'tx';
}

function receiverParameterDeclaration(declaration: Node) {
  if (Node.isParameterDeclaration(declaration)) return declaration;
  if (Node.isIdentifier(declaration) && Node.isParameterDeclaration(declaration.getParent())) {
    return declaration.getParent();
  }

  return null;
}

function sourceDrizzleReceiverNames(callback: Node, body: string): string[] {
  const names = new Set(DEFAULT_DRIZZLE_RECEIVER_NAMES);
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionDeclaration(callback) ||
    Node.isFunctionExpression(callback)
  ) {
    for (const param of callback.getParameters()) {
      appendSourceReceiverBindingNames(param.getNameNode(), names);
    }
  }

  appendBodyReceiverAliases(body, names);

  return [...names];
}

function appendSourceReceiverBindingNames(name: Node, names: Set<string>): void {
  if (Node.isIdentifier(name)) {
    if (isLikelyDrizzleReceiver(name.getText())) names.add(name.getText());
    return;
  }

  if (!Node.isObjectBindingPattern(name)) return;

  for (const element of name.getElements()) {
    const binding = element.getNameNode();
    const propertyName = element.getPropertyNameNode()?.getText();

    if (!propertyName && Node.isIdentifier(binding) && isLikelyDrizzleReceiver(binding.getText())) {
      names.add(binding.getText());
      continue;
    }

    if (propertyName !== 'db' && propertyName !== 'tx') continue;
    if (Node.isIdentifier(binding)) names.add(binding.getText());
  }
}

function destructuredDrizzleReceiverAliases(body: string): string[] {
  // SPEC §10-§11: receiver aliases in comments/strings must not fabricate FW406 surfaces.
  return withParsedFunctionBodySource(body, ({ sourceFile }) => {
    const aliases: string[] = [];

    for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = declaration.getNameNode();
      if (!Node.isObjectBindingPattern(nameNode)) continue;

      for (const element of nameNode.getElements()) {
        const propertyName = element.getPropertyNameNode()?.getText();
        if (propertyName !== 'db' && propertyName !== 'tx') continue;

        const alias = element.getNameNode();
        if (Node.isIdentifier(alias)) aliases.push(alias.getText());
      }
    }

    return aliases;
  });
}

function isLikelyDrizzleReceiver(name: string): boolean {
  // SPEC §10-§11: source-mode names beyond the canonical db/tx surface are not proof.
  return /^(db|tx)$/.test(name);
}

function extractReadSources(source: string, operation: string): ExtractedReadSource[] {
  return withParsedSourceFile(source, (sourceFile) => {
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    const sourceOperation =
      operation === 'insert' && calls.some((call) => propertyAccessCallName(call) === 'select')
        ? 'insert-select'
        : operation === 'update' && calls.some((call) => propertyAccessCallName(call) === 'from')
          ? 'update-from'
          : null;
    if (!sourceOperation) return [];

    const sources: ExtractedReadSource[] = [];

    for (const call of calls) {
      if (!isReadSourceCall(call)) continue;

      const tableExpression = call.getArguments()[0]?.getText().trim();

      sources.push({
        operation: sourceOperation,
        tableExpression: tableExpression || UNRESOLVED_READ_SOURCE_EXPRESSION,
      });
    }

    // SPEC §10-§11: an opaque insert-select/update-from source is visible as FW406, not guessed.
    return sources.length > 0
      ? sources
      : [{ operation: sourceOperation, tableExpression: UNRESOLVED_READ_SOURCE_EXPRESSION }];
  });
}

function isReadSourceCall(call: CallExpression): boolean {
  const name = propertyAccessCallName(call);
  return (
    name === 'from' ||
    name === 'join' ||
    name === 'innerJoin' ||
    name === 'leftJoin' ||
    name === 'rightJoin' ||
    name === 'fullJoin'
  );
}

function propertyAccessCallName(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  return staticAccessName(expression);
}

function staticAccessName(node: Node): string | undefined {
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (!Node.isElementAccessExpression(node)) return undefined;

  const argument = node.getArgumentExpression();
  return Node.isStringLiteral(argument) ? argument.getLiteralText() : undefined;
}

function staticAccessExpression(node: Node): Node | undefined {
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return node.getExpression();
  }
  return undefined;
}

function extractPredicateSummary(
  statement: string,
  tableIdentifier: string,
  table: JisoDomainTableAnnotation,
): ExtractedPredicateSummary {
  // SPEC §10-§11: predicate text inside strings/comments must not fabricate row-key facts.
  return withParsedSourceFile(`${statement};`, (sourceFile) => {
    const whereCall = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => propertyAccessCallName(call) === 'where');
    const predicate = whereCall?.getArguments()[0];
    if (!predicate) return {};

    const key = extractParameterizedKey(predicate, tableIdentifier, table);
    if (key) return { key };

    return hasNonEqPredicate(predicate, tableIdentifier, table) ? { predicate: 'non-eq' } : {};
  });
}

function extractParameterizedKey(
  predicate: Node,
  tableIdentifier: string,
  table: JisoDomainTableAnnotation,
): string | undefined {
  if (!table.key) return undefined;
  if (!Node.isCallExpression(predicate)) return undefined;

  const expression = predicate.getExpression();
  if (!Node.isIdentifier(expression) || expression.getText() !== 'eq') return undefined;

  const [left, right] = predicate.getArguments();
  if (!left || !right) return undefined;

  if (isTableKeyReference(left, tableIdentifier, table)) return argumentKey(right);
  if (isTableKeyReference(right, tableIdentifier, table)) return argumentKey(left);
  return undefined;
}

function hasNonEqPredicate(
  predicate: Node,
  tableIdentifier: string,
  table: JisoDomainTableAnnotation,
): boolean {
  if (!table.key) return false;

  return !isEqCall(predicate) && hasTableKeyReference(predicate, tableIdentifier, table);
}

function isEqCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;

  const expression = node.getExpression();
  return Node.isIdentifier(expression) && expression.getText() === 'eq';
}

function hasTableKeyReference(
  node: Node,
  tableIdentifier: string,
  table: JisoDomainTableAnnotation,
): boolean {
  if (isTableKeyReference(node, tableIdentifier, table)) return true;

  return node
    .getDescendants()
    .some((descendant) => isTableKeyReference(descendant, tableIdentifier, table));
}

function isTableKeyReference(
  node: Node,
  tableIdentifier: string,
  table: JisoDomainTableAnnotation,
): boolean {
  return staticExpressionPath(node) === `${tableIdentifier}.${table.key}`;
}

function argumentKey(expression: Node): string | undefined {
  if (Node.isIdentifier(expression)) return `arg:${expression.getText()}`;
  if (!Node.isPropertyAccessExpression(expression)) return undefined;

  const base = expression.getExpression();
  if (!Node.isIdentifier(base) || base.getText() !== 'input') return undefined;

  return `arg:${expression.getName()}`;
}

function appendTable<Table>(tables: Map<string, Table[]>, identifier: string, table: Table): void {
  tables.set(identifier, [...(tables.get(identifier) ?? []), table]);
}

function appendTableEntries<Table>(
  tables: Map<string, Table[]>,
  identifier: string,
  entries: readonly Table[],
): void {
  const current = tables.get(identifier) ?? [];
  const next = [...current];
  const keys = new Set(current.map((entry) => JSON.stringify(entry)));

  for (const entry of entries) {
    const key = JSON.stringify(entry);
    if (keys.has(key)) continue;

    keys.add(key);
    next.push(entry);
  }

  tables.set(identifier, next);
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}
