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
  type ParameterDeclaration,
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
const CLASSIFIED_DRIZZLE_RECEIVER_METHODS = new Set([
  ...DRIZZLE_SELECT_QUERY_METHODS,
  'delete',
  'insert',
  'transaction',
  'update',
]);

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
  return extractTouchGraphFromPreparedFiles(files, extractFunctions);
}

function extractTouchGraphFromPreparedFiles(
  files: readonly SourceFileInput[],
  functionsForFile: (file: SourceFileInput) => ExtractedFunction[],
  sourceContext: SourceModuleContext = sourceModuleContext(files),
): TouchGraph {
  const unresolvedIdentifiers = new Set<string>();
  const graph: Record<string, TouchGraphEntry> = {};

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
    for (const identifier of extractUnresolvedConditionalIdentifiers(file, fileTables)) {
      unresolvedIdentifiers.add(identifier);
    }
  }

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
    const functions = functionsForFile(file);
    const summaries = functionTouchSummariesForFile(
      file,
      functions,
      fileTables,
      unresolvedIdentifiers,
    );

    for (const fn of functions) {
      const { reads, unresolved, writes } = summaries.get(fn.key) ?? {
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
    const sourceContext = projectSourceModuleContext(extraction);
    const projectFunctionExtractions = projectFunctionExtractionsByFileName(extraction);

    return extractTouchGraphFromPreparedFiles(
      extraction.files,
      (file) => projectFunctionsForFile(file, projectFunctionExtractions),
      sourceContext,
    );
  } finally {
    extraction.dispose();
  }
}

export function extractQueryFactsFromProject(options: TouchGraphProjectOptions): QueryFact[] {
  const extraction = createProjectExtraction(options);
  try {
    const sourceContext = projectSourceModuleContext(extraction);
    const contextFiles = projectContextFiles(extraction);
    const projectFunctionExtractions = projectFunctionExtractionsByFileName(extraction);
    return extractQueryFactsFromPreparedFiles(
      extraction.files,
      (file) => {
        const index = extraction.files.findIndex(
          (candidate) => candidate.fileName === file.fileName,
        );
        const sourceFile = extraction.sourceFiles[index];
        if (!sourceFile) return [];

        return extractProjectQueryDefinitions(sourceFile, {
          ...(file.columnShapes ? { columnShapes: file.columnShapes } : {}),
          namespaceTableNames: projectNamespaceTableNamesByLocal(
            sourceFile,
            extraction.tableNamesBySymbol,
          ),
          tableNamesByIdentifier: projectTableNamesByIdentifierText(
            sourceFile,
            extraction.tableNamesBySymbol,
          ),
          tableNamesBySymbol: extraction.tableNamesBySymbol,
        });
      },
      contextFiles,
      sourceContext,
      (file) => projectFunctionsForFile(file, projectFunctionExtractions),
    );
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

function projectContextFiles(extraction: ProjectExtraction): SourceFileInput[] {
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
      source: file.source,
    };
  });
}

function projectFunctionExtractionsByFileName(
  extraction: ProjectExtraction,
): Map<string, Map<string, ExtractedFunction>> {
  const extractionsByFile = new Map<string, Map<string, ExtractedFunction>>();

  extraction.sourceFiles.forEach((sourceFile, index) => {
    const file = extraction.files[index];
    if (!file) return;

    const extractionsByFunction = new Map<string, ExtractedFunction>();
    const namespaceTableNames = projectNamespaceTableNamesByLocal(
      sourceFile,
      extraction.tableNamesBySymbol,
    );
    const tableNamesByIdentifier = projectTableNamesByIdentifierText(
      sourceFile,
      extraction.tableNamesBySymbol,
    );

    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
      const name = fn.getName();
      const nameNode = fn.getNameNode();
      const body = fn.getBody();
      if (!name || !nameNode || !body) continue;

      const receivers = projectDrizzleReceivers(fn);
      const key = extractedFunctionKey(name, fn, nameNode);
      extractionsByFunction.set(key, {
        bodyStart: bodySourceStart(body),
        key,
        localCalls: [],
        name,
        readCalls: [
          ...extractProjectSelectReadCalls(
            body,
            file,
            receivers,
            extraction.tableNamesBySymbol,
            namespaceTableNames,
          ),
          ...extractProjectRelationalReadCalls(body, file, receivers, tableNamesByIdentifier),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        writeCalls: extractProjectDrizzleWriteCalls(
          body,
          file,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
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
      const functionName = name.getText();
      const key = extractedFunctionKey(functionName, initializer, name);
      extractionsByFunction.set(key, {
        bodyStart: bodySourceStart(body),
        key,
        localCalls: [],
        name: functionName,
        readCalls: [
          ...extractProjectSelectReadCalls(
            body,
            file,
            receivers,
            extraction.tableNamesBySymbol,
            namespaceTableNames,
          ),
          ...extractProjectRelationalReadCalls(body, file, receivers, tableNamesByIdentifier),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        writeCalls: extractProjectDrizzleWriteCalls(
          body,
          file,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
          receivers,
        ),
      });
    }

    for (const callback of projectDomainWriteCallbacks(sourceFile).values()) {
      const receivers = projectDrizzleReceivers(callback.fn);
      extractionsByFunction.set(callback.key, {
        bodyStart: bodySourceStart(callback.body),
        key: callback.key,
        localCalls: [],
        name: callback.name,
        readCalls: [
          ...extractProjectSelectReadCalls(
            callback.body,
            file,
            receivers,
            extraction.tableNamesBySymbol,
            namespaceTableNames,
          ),
          ...extractProjectRelationalReadCalls(
            callback.body,
            file,
            receivers,
            tableNamesByIdentifier,
          ),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        writeCalls: extractProjectDrizzleWriteCalls(
          callback.body,
          file,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
          receivers,
        ),
      });
    }

    const localFunctionNames = new Set(extractionsByFunction.keys());
    for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
      const name = fn.getName();
      const nameNode = fn.getNameNode();
      const body = fn.getBody();
      const extraction =
        name && nameNode
          ? extractionsByFunction.get(extractedFunctionKey(name, fn, nameNode))
          : undefined;
      if (!body || !extraction) continue;
      extraction.localCalls = extractLocalFunctionCallsFromBody(body, localFunctionNames);
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
      const extraction = extractionsByFunction.get(
        extractedFunctionKey(name.getText(), initializer, name),
      );
      if (!extraction) continue;
      extraction.localCalls = extractLocalFunctionCallsFromBody(
        initializer.getBody(),
        localFunctionNames,
      );
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        initializer.getBody(),
        projectDrizzleReceivers(initializer),
        localFunctionNames,
      );
    }
    for (const callback of projectDomainWriteCallbacks(sourceFile).values()) {
      const extraction = extractionsByFunction.get(callback.key);
      if (!extraction) continue;
      extraction.localCalls = extractLocalFunctionCallsFromBody(callback.body, localFunctionNames);
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

function projectFunctionsForFile(
  file: SourceFileInput,
  projectFunctionExtractions: ReadonlyMap<string, ReadonlyMap<string, ExtractedFunction>>,
): ExtractedFunction[] {
  // SPEC §10-§11: project-mode summaries are derived from ts-morph project symbols directly,
  // without falling back to source-mode receiver-name heuristics.
  return [...(projectFunctionExtractions.get(file.fileName)?.values() ?? [])];
}

interface ProjectDrizzleReceivers {
  names: ReadonlySet<string>;
  symbolKeys: ReadonlySet<string>;
}

interface QueryReceiverReferences {
  names: ReadonlySet<string>;
  symbolKeys: ReadonlySet<string>;
}

function projectDomainWriteCallbacks(
  sourceFile: SourceFile,
): Map<string, { body: Node; fn: Node; key: string; name: string }> {
  const callbacks = new Map<string, { body: Node; fn: Node; key: string; name: string }>();

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

      const name = `${domainName.getText()}.${memberName}`;
      callbacks.set(name, {
        body: functionBody(callback),
        fn: callback,
        key: extractedFunctionKey(name, callback, property.getNameNode()),
        name,
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
    appendProjectDrizzleReceiverBinding(param.getNameNode(), names, symbolKeys);
  }
  appendProjectDrizzleReceiverBindingsFromBody(functionBody(callback), { names, symbolKeys });
  appendProjectTransactionReceiverAliases(callback, { names, symbolKeys });
  return { names, symbolKeys };
}

function appendProjectDrizzleReceiverBinding(
  name: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (Node.isIdentifier(name)) {
    if (!isDrizzleReceiver(name)) return;

    names.add(name.getText());
    const symbolKey = resolvedSymbolKey(name.getSymbol());
    if (symbolKey) symbolKeys.add(symbolKey);
    return;
  }

  if (!Node.isObjectBindingPattern(name)) return;

  for (const element of name.getElements()) {
    appendProjectDrizzleReceiverBinding(element.getNameNode(), names, symbolKeys);
  }
}

function appendProjectDrizzleReceiverBindingsFromBody(
  body: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §11.1: body-local receiver aliases are accepted only when their binding type resolves to
  // Drizzle; untyped source-mode destructuring is not proof.
  for (const declaration of touchBodyVariableDeclarations(body)) {
    appendProjectDrizzleReceiverBinding(
      declaration.getNameNode(),
      receivers.names,
      receivers.symbolKeys,
    );
  }
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
  namespaceTableNames: ProjectNamespaceTableNames,
  receivers: ProjectDrizzleReceivers,
): ExtractedWriteCall[] {
  const calls: ExtractedWriteCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    if (!isDrizzleWriteCall(call)) continue;

    const expression = call.getExpression();
    const operation = staticAccessName(expression);
    const receiver = staticAccessExpression(expression);
    if (!operation || !receiver) continue;
    if (!isDrizzleReceiver(receiver) && !isProjectDrizzleReceiverIdentifier(receiver, receivers)) {
      continue;
    }

    const tableArgument = call.getArguments()[0];
    if (!tableArgument) continue;

    const chain = drizzleWriteChainRoot(call);
    const tableExpression =
      projectTableNameForNode(tableArgument, tableNamesBySymbol, namespaceTableNames) ??
      UNRESOLVED_READ_SOURCE_EXPRESSION;

    calls.push({
      index: 0,
      operation,
      predicateFacts: extractPredicateFactsFromWriteChain(chain, (node) =>
        projectTableNameForNode(node, tableNamesBySymbol, namespaceTableNames),
      ),
      readSources: extractReadSourcesFromWriteChain(
        chain,
        operation,
        (node) =>
          projectTableNameForNode(node, tableNamesBySymbol, namespaceTableNames) ??
          UNRESOLVED_READ_SOURCE_EXPRESSION,
      ),
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      tableExpression: tableExpression.trim(),
    });
  }

  return calls;
}

function extractProjectSelectReadCalls(
  body: Node,
  file: SourceFileInput,
  receivers: ProjectDrizzleReceivers,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
): ExtractedReadCall[] {
  const bodyStart = bodySourceStart(body);
  const calls: ExtractedReadCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const read = selectReadCall(call);
    if (!read || !isProjectDrizzleReceiverIdentifier(read.receiver, receivers)) continue;

    calls.push({
      index: Math.max(0, call.getStart() - bodyStart),
      operation: 'select',
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      tableExpression:
        projectTableNameForNode(read.table, tableNamesBySymbol, namespaceTableNames) ??
        UNRESOLVED_READ_SOURCE_EXPRESSION,
    });
  }

  return calls;
}

function extractProjectRelationalReadCalls(
  body: Node,
  file: SourceFileInput,
  receivers: ProjectDrizzleReceivers,
  tableNamesByIdentifier: ReadonlyMap<string, string>,
): ExtractedReadCall[] {
  const bodyStart = bodySourceStart(body);
  const calls: ExtractedReadCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const read = relationalReadCall(call);
    if (!read || !isProjectDrizzleReceiverIdentifier(read.receiver, receivers)) continue;

    calls.push({
      index: Math.max(0, call.getStart() - bodyStart),
      operation: 'relational-query',
      site: `${file.fileName}:${lineForIndex(file.source, call.getStart())}`,
      tableExpression:
        tableNamesByIdentifier.get(read.tableExpression) ?? UNRESOLVED_READ_SOURCE_EXPRESSION,
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

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();
    if (!Node.isIdentifier(expression)) continue;

    const name = expression.getText();
    if (IGNORED_LOCAL_CALL_NAMES.has(name) || localFunctionNames.has(name)) continue;
    if (localFunctionKeyForIdentifier(expression, localFunctionNames)) continue;
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

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();
    const name = staticAccessName(expression);
    if (!name) continue;

    const surface = projectUnclassifiedCallSurface(call, name);
    if (!surface || !isProjectDrizzleReceiverIdentifier(surface.receiver, receivers)) continue;

    calls.push({ index: call.getStart() - bodyStart, name: surface.name });
  }

  return calls;
}

function projectUnclassifiedCallSurface(
  call: CallExpression,
  name: string,
): { name: string; receiver: Node } | undefined {
  // SPEC §10-§11: only the relational query API (`db.query.<table>.find*`) is classified as a
  // read surface. Other typed receiver `find*` calls remain visible as FW406.
  if ((name === 'findMany' || name === 'findFirst') && relationalReadCall(call)) {
    return undefined;
  }

  if (!isUnclassifiedDirectDrizzleReceiverMethod(name)) return undefined;

  const expression = call.getExpression();
  const receiver = staticAccessExpression(expression);
  return receiver ? { name, receiver } : undefined;
}

function relationalReadCall(
  call: CallExpression,
): { receiver: Node; tableExpression: string } | undefined {
  const expression = call.getExpression();
  const method = staticAccessName(expression);
  if (method !== 'findMany' && method !== 'findFirst') return undefined;

  const tableAccess = staticAccessExpression(expression);
  if (!tableAccess) return undefined;

  const queryAccess = staticAccessExpression(tableAccess);
  if (!queryAccess || staticAccessName(queryAccess) !== 'query') return undefined;

  const receiver = staticAccessExpression(queryAccess);
  if (!receiver) return undefined;

  return {
    receiver,
    tableExpression: staticAccessName(tableAccess) ?? UNRESOLVED_READ_SOURCE_EXPRESSION,
  };
}

function selectReadCall(call: CallExpression): { receiver: Node; table: Node } | undefined {
  // SPEC §10-§11: standalone Drizzle select reads are touch-graph facts; unresolved table
  // expressions become FW406 instead of silently disappearing.
  if (!isReadSourceCall(call)) return undefined;
  if (!isSelectQueryCallName(queryBuilderRootCallName(call))) return undefined;
  if (isNestedInWriteReadSource(call)) return undefined;

  const receiver = queryCallChainReceiver(call);
  const table = call.getArguments()[0];
  if (!receiver || !table) return undefined;

  return { receiver, table };
}

function queryBuilderRootCallName(call: CallExpression): string | undefined {
  let current: CallExpression | undefined = call;
  let name: string | undefined;

  while (current) {
    name = staticAccessName(current.getExpression()) ?? name;
    const receiver = staticAccessExpression(current.getExpression());
    current = Node.isCallExpression(receiver) ? receiver : undefined;
  }

  return name;
}

function isNestedInWriteReadSource(call: CallExpression): boolean {
  for (const ancestor of call.getAncestors()) {
    if (!Node.isCallExpression(ancestor)) continue;
    if (ancestor === call) continue;
    if (ancestor.getDescendantsOfKind(SyntaxKind.CallExpression).some(isDrizzleWriteCall)) {
      return true;
    }
  }

  return false;
}

function bodySourceStart(body: Node): number {
  return Node.isBlock(body) ? body.getStart() + 1 : body.getStart();
}

function callExpressionsInNode(body: Node): CallExpression[] {
  return [
    ...(Node.isCallExpression(body) ? [body] : []),
    ...body.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
}

function touchBodyCallExpressions(body: Node): CallExpression[] {
  return callExpressionsInNode(body).filter((call) => isTouchBodyNode(call, body));
}

function touchBodyVariableDeclarations(
  body: Node,
): ReturnType<SourceFile['getVariableDeclarations']> {
  return body
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((declaration) => isTouchBodyNode(declaration, body));
}

function isTouchBodyNode(node: Node, body: Node): boolean {
  if (node === body) return true;

  for (const ancestor of node.getAncestors()) {
    if (ancestor === body) return true;
    if (!isFunctionLikeNode(ancestor)) continue;
    if (!isInlineTransactionCallback(ancestor)) return false;
  }

  return true;
}

function isFunctionLikeNode(node: Node): boolean {
  return (
    Node.isArrowFunction(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node)
  );
}

function isInlineTransactionCallback(callback: Node): boolean {
  const parent = callback.getParent();
  if (!Node.isCallExpression(parent)) return false;
  if (!parent.getArguments().includes(callback)) return false;

  return staticAccessName(parent.getExpression()) === 'transaction';
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

function projectTableNameForNode(
  node: Node,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames = new Map(),
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (expression !== node) {
    return projectTableNameForNode(expression, tableNamesBySymbol, namespaceTableNames);
  }

  if (Node.isPropertyAccessExpression(node)) {
    const tableName = projectTableNameForSymbol(node.getNameNode(), tableNamesBySymbol);
    if (tableName) {
      const basePath = staticExpressionPath(node.getExpression());
      return basePath ? `${basePath}.${tableName}` : tableName;
    }
    const namespaceTableName = projectNamespaceAccessTableName(node, namespaceTableNames);
    if (namespaceTableName) return namespaceTableName;
  }
  if (Node.isElementAccessExpression(node)) {
    const namespaceTableName = projectNamespaceAccessTableName(node, namespaceTableNames);
    if (namespaceTableName) return namespaceTableName;

    const tableName = projectTableNameForSymbol(node, tableNamesBySymbol);
    if (tableName) {
      const basePath = staticExpressionPath(node.getExpression());
      return basePath ? `${basePath}.${tableName}` : tableName;
    }
  }

  return projectTableNameForSymbol(node, tableNamesBySymbol);
}

function projectTableNameForSymbol(
  node: Node,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): string | undefined {
  const symbolKey = resolvedSymbolKey(node.getSymbol());
  if (!symbolKey) return undefined;
  return tableNamesBySymbol.get(symbolKey);
}

type ProjectNamespaceTableNames = ReadonlyMap<string, ReadonlyMap<string, string>>;

function projectNamespaceTableNamesByLocal(
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): ProjectNamespaceTableNames {
  const namespaces = new Map<string, Map<string, string>>();

  for (const declaration of sourceFile.getImportDeclarations()) {
    const local = declaration.getNamespaceImport()?.getText();
    const moduleSourceFile = declaration.getModuleSpecifierSourceFile();
    if (!local || !moduleSourceFile) continue;

    const exportedTables = projectExportedTableNamesByName(moduleSourceFile, tableNamesBySymbol);
    if (exportedTables.size > 0) namespaces.set(local, exportedTables);
  }

  return namespaces;
}

function projectExportedTableNamesByName(
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): Map<string, string> {
  const tables = new Map<string, string>();

  for (const symbol of sourceFile.getExportSymbols()) {
    const tableName = tableNamesBySymbol.get(resolvedSymbolKey(symbol) ?? '');
    if (tableName) tables.set(symbol.getName(), tableName);
  }

  return tables;
}

function projectNamespaceAccessTableName(
  access: Node,
  namespaceTableNames: ProjectNamespaceTableNames,
): string | undefined {
  if (!Node.isElementAccessExpression(access) && !Node.isPropertyAccessExpression(access)) {
    return undefined;
  }

  const base = access.getExpression();
  if (!Node.isIdentifier(base)) return undefined;

  const table = staticAccessName(access);
  if (!table) return undefined;

  const tableName = namespaceTableNames.get(base.getText())?.get(table);
  return tableName ? `${base.getText()}.${tableName}` : undefined;
}

export function extractQueryFactsFromSource(files: readonly SourceFileInput[]): QueryFact[] {
  return extractQueryFactsFromPreparedFiles(files, (file) =>
    extractQueryDefinitions(file, file.columnShapes),
  );
}

function extractQueryFactsFromPreparedFiles(
  files: readonly SourceFileInput[],
  queriesForFile: (file: SourceFileInput) => readonly ExtractedQueryDefinition[],
  contextFiles: readonly SourceFileInput[] = files,
  sourceContext: SourceModuleContext = sourceModuleContext(contextFiles),
  functionsForFile: (file: SourceFileInput) => ExtractedFunction[] = extractFunctions,
): QueryFact[] {
  const facts: QueryFact[] = [];
  const unresolvedIdentifiers = unresolvedConditionalIdentifiersForFiles(
    contextFiles,
    sourceContext,
  );

  for (const [index, file] of files.entries()) {
    const contextFile = contextFiles[index] ?? file;
    const fileTables = tablesForFile(contextFile, sourceContext);
    const helperSummaries = functionTouchSummariesForFile(
      file,
      functionsForFile(file),
      fileTables,
      unresolvedIdentifiers,
    );
    const columnShapes = {
      ...sourceColumnShapesForTables(fileTables),
      ...contextFile.columnShapes,
      ...file.columnShapes,
    };
    for (const query of queriesForFile({ ...file, columnShapes })) {
      const site = `${file.fileName}:${lineForIndex(file.source, query.index)}`;
      const localHelperSummary = localQueryHelperSummary(query.localHelperCalls, helperSummaries);
      const reads = queryReadDomains(query.tableExpressions, fileTables);
      const helperReads = localHelperSummary.reads.map((read) => read.table.domain);
      const diagnostics = opaqueProjectionDiagnostics(
        query.query,
        query.opaquePaths,
        site,
        query.hasOutputSchema,
      )
        .concat(unresolvedProjectionDiagnostics(query.query, query.unresolvedPaths, site))
        .concat(query.diagnostics?.map((diagnostic) => ({ ...diagnostic, site })) ?? [])
        .concat(exemptQueryReadDiagnostics(query.tableExpressions, fileTables, site))
        .concat(localQueryHelperDiagnostics(localHelperSummary));
      const allReads = [...new Set([...reads, ...helperReads])].sort();
      if (!query.hasSelection && allReads.length === 0 && diagnostics.length === 0) continue;

      facts.push({
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
        ...queryInstanceKey(query.instanceKeyComparisons, fileTables),
        query: query.query,
        reads: allReads,
        shape: query.shape,
        site,
      });
    }
  }

  return facts.sort((left, right) => left.query.localeCompare(right.query));
}

function unresolvedConditionalIdentifiersForFiles(
  files: readonly SourceFileInput[],
  sourceContext: SourceModuleContext,
): Set<string> {
  const unresolvedIdentifiers = new Set<string>();

  for (const file of files) {
    const fileTables = tablesForFile(file, sourceContext);
    for (const identifier of extractUnresolvedConditionalIdentifiers(file, fileTables)) {
      unresolvedIdentifiers.add(identifier);
    }
  }

  return unresolvedIdentifiers;
}

function localQueryHelperSummary(
  helperCalls: readonly string[],
  helperSummaries: ReadonlyMap<string, FunctionTouchSummary>,
): FunctionTouchSummary {
  const summary: FunctionTouchSummary = { reads: [], unresolved: [], writes: [] };

  for (const call of helperCalls) {
    const helperSummary = helperSummaries.get(call);
    if (helperSummary) mergeSummary(summary, helperSummary);
  }

  return summary;
}

function localQueryHelperDiagnostics(summary: FunctionTouchSummary): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = [];

  for (const write of summary.writes) {
    diagnostics.push({
      code: 'FW406',
      message: `${diagnosticDefinitions.FW406.message} Query local helper touches Drizzle table via ${write.operation}().`,
      severity: diagnosticDefinitions.FW406.severity,
      site: write.site,
    });
  }

  for (const unresolved of summary.unresolved) {
    diagnostics.push({
      code: 'FW406',
      message: `${diagnosticDefinitions.FW406.message} Query local helper has unresolved Drizzle ${unresolved.operation}().`,
      severity: diagnosticDefinitions.FW406.severity,
      site: unresolved.site,
    });
  }

  return diagnostics;
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

function projectTableNamesByIdentifierText(
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const tableName = tableNamesBySymbol.get(resolvedSymbolKey(identifier.getSymbol()) ?? '');
    if (!tableName) continue;

    const text = identifier.getText();
    const existing = names.get(text);
    if (existing && existing !== tableName) {
      ambiguous.add(text);
      continue;
    }

    names.set(text, tableName);
  }

  for (const text of ambiguous) names.delete(text);
  return names;
}

function isDrizzleWriteCall(call: CallExpression): boolean {
  const expression = call.getExpression();
  const name = staticAccessName(expression);
  return name === 'delete' || name === 'insert' || name === 'update';
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

  appendProjectAliasTableNames(sourceFiles, namesBySymbol);
  return namesBySymbol;
}

function appendProjectAliasTableNames(
  sourceFiles: readonly SourceFile[],
  namesBySymbol: Map<string, string>,
): void {
  // SPEC §10-§11: project-mode aliases preserve the resolved Drizzle table symbol instead of
  // reusing the source-mode alias-name compatibility path.
  let changed = true;
  while (changed) {
    changed = false;

    for (const sourceFile of sourceFiles) {
      for (const declaration of sourceFile.getVariableDeclarations()) {
        const aliasSymbolKey = resolvedSymbolKey(declaration.getNameNode().getSymbol());
        if (!aliasSymbolKey || namesBySymbol.has(aliasSymbolKey)) continue;

        const tableName = projectAliasTargetTableName(declaration.getInitializer(), namesBySymbol);
        if (!tableName) continue;

        namesBySymbol.set(aliasSymbolKey, tableName);
        changed = true;
      }
    }
  }
}

function projectAliasTargetTableName(
  initializer: Node | undefined,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): string | undefined {
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isCallExpression(expression)) return undefined;
  if (!isProjectDrizzleAliasCall(expression)) return undefined;

  const target = expression.getArguments()[0];
  return target ? projectTableNameForNode(target, tableNamesBySymbol) : undefined;
}

function isProjectDrizzleAliasCall(call: CallExpression): boolean {
  const expression = call.getExpression();
  if (!Node.isIdentifier(expression) || expression.getText() !== 'alias') return false;

  const symbol = expression.getSymbol()?.getAliasedSymbol() ?? expression.getSymbol();
  return (
    symbol?.getDeclarations().some((declaration) => isDrizzleOrmDeclaration(declaration)) ?? false
  );
}

function isDrizzleOrmDeclaration(declaration: Node): boolean {
  if (declaration.getSourceFile().getFilePath().includes('drizzle-orm')) return true;

  const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
  return importDeclaration?.getModuleSpecifierValue().startsWith('drizzle-orm') ?? false;
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
  const namespaceTableNames = projectNamespaceTableNamesByLocal(sourceFile, tableNamesBySymbol);

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const symbolKey = resolvedSymbolKey(identifier.getSymbol());
    const tableName = tableNamesBySymbol.get(symbolKey ?? '');
    const tableShapes = tableName ? columnShapesByTable.get(tableName) : undefined;
    if (!tableName || !tableShapes) continue;

    appendColumnShapesForTablePath(shapes, identifier.getText(), tableShapes);
    appendColumnShapesForTablePath(shapes, tableName, tableShapes);
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const tableName = projectTableNameForColumnShapeAccess(
      access,
      tableNamesBySymbol,
      namespaceTableNames,
    );
    const tableShapes = tableName ? columnShapesByTable.get(tableName) : undefined;
    const tablePath = staticExpressionPath(access);
    if (!tableShapes || !tablePath) continue;

    appendColumnShapesForTablePath(shapes, tablePath, tableShapes);
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const tableName = projectTableNameForColumnShapeAccess(
      access,
      tableNamesBySymbol,
      namespaceTableNames,
    );
    const tableShapes = tableName ? columnShapesByTable.get(tableName) : undefined;
    const tablePath = staticExpressionPath(access);
    if (!tableShapes || !tablePath) continue;

    appendColumnShapesForTablePath(shapes, tablePath, tableShapes);
  }

  return shapes;
}

function projectTableNameForColumnShapeAccess(
  node: Node,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
): string | undefined {
  const namespaceTableName = projectNamespaceAccessTableName(node, namespaceTableNames)
    ?.split('.')
    .at(-1);
  return (
    projectTableNameForSymbol(node, tableNamesBySymbol) ??
    namespaceTableName ??
    projectTableNameForNode(node, tableNamesBySymbol, namespaceTableNames)
  );
}

function appendColumnShapesForTablePath(
  shapes: Record<string, QueryShape>,
  tablePath: string,
  tableShapes: Readonly<Record<string, QueryShape>>,
): void {
  // SPEC §10-§11: project projection shapes follow the resolved Drizzle table symbol, including
  // namespace/static-element paths, instead of guessing from selected aliases.
  for (const [column, shape] of Object.entries(tableShapes)) {
    shapes[`${tablePath}.${column}`] = shape;
  }
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
  bodyStart: number;
  key: string;
  localCalls: readonly string[];
  name: string;
  readCalls: readonly ExtractedReadCall[];
  receiverNames: readonly string[];
  unresolvedCalls: readonly ExternalDbArgumentCall[];
  writeCalls: readonly ExtractedWriteCall[];
}

type ParsedExtractedFunction = Omit<
  ExtractedFunction,
  'localCalls' | 'readCalls' | 'unresolvedCalls' | 'writeCalls'
> & {
  bodyNode: Node;
  callback: Node;
};

interface ExtractedQueryDefinition {
  diagnostics?: readonly TouchGraphDiagnostic[];
  hasOutputSchema: boolean;
  hasSelection: boolean;
  index: number;
  instanceKeyComparisons: readonly QueryInstanceKeyComparison[];
  localHelperCalls: readonly string[];
  opaquePaths: readonly string[];
  query: string;
  shape: QueryShape;
  tableExpressions: readonly string[];
  unresolvedPaths: readonly string[];
}

interface QueryInstanceKeyComparison {
  left: QueryInstanceKeyOperand;
  right: QueryInstanceKeyOperand;
}

interface QueryInstanceKeyOperand {
  inputKey?: string;
  tableKey?: {
    key: string;
    tableIdentifier: string;
  };
}

interface ExtractedWriteCall {
  index: number;
  operation: string;
  predicateFacts: readonly ExtractedPredicateFact[];
  readSources: ExtractedReadSource[];
  site?: string;
  tableExpression: string;
}

interface ExtractedReadSource {
  operation: 'insert-select' | 'update-from';
  tableExpression: string;
}

interface ExtractedReadCall {
  index: number;
  operation: 'relational-query' | 'select';
  site?: string;
  tableExpression: string;
}

interface ExtractedPredicateSummary {
  key?: string;
  predicate?: 'non-eq';
}

interface ExtractedPredicateFact {
  argumentKey?: string;
  key: string;
  predicate?: 'non-eq';
  tableIdentifier: string;
}

interface FunctionTouchSummary {
  reads: ReadSummaryInput[];
  unresolved: UnresolvedSummaryInput[];
  writes: WriteSummaryInput[];
}

function extractQueryDefinitions(
  file: SourceFileInput,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
): ExtractedQueryDefinition[] {
  return withParsedSourceFile(file, (sourceFile) =>
    extractQueryDefinitionsFromSourceFile(sourceFile, { columnShapes }),
  );
}

interface ProjectQueryDefinitionOptions {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  namespaceTableNames: ProjectNamespaceTableNames;
  tableNamesByIdentifier: ReadonlyMap<string, string>;
  tableNamesBySymbol: ReadonlyMap<string, string>;
}

function extractProjectQueryDefinitions(
  sourceFile: SourceFile,
  options: ProjectQueryDefinitionOptions,
): ExtractedQueryDefinition[] {
  const resolveTableIdentifier = (node: Node) =>
    projectTableNameForNode(node, options.tableNamesBySymbol, options.namespaceTableNames);

  return extractQueryDefinitionsFromSourceFile(sourceFile, {
    ...(options.columnShapes ? { columnShapes: options.columnShapes } : {}),
    readTableIdentifier: resolveTableIdentifier,
    receiverMode: 'project',
    relationalTableName: (name) => options.tableNamesByIdentifier.get(name),
  });
}

interface QueryDefinitionOptions {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  readTableIdentifier?: (node: Node) => string | undefined;
  receiverMode?: 'project' | 'source';
  relationalTableName?: (name: string) => string | undefined;
}

function extractQueryDefinitionsFromSourceFile(
  sourceFile: SourceFile,
  options: QueryDefinitionOptions = {},
): ExtractedQueryDefinition[] {
  const definitions: ExtractedQueryDefinition[] = [];
  const localFunctionKeys = localFunctionKeysFromSourceFile(sourceFile);

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
    const receiverReferences = queryCallbackReceiverReferences(
      bodyArgument,
      options.receiverMode ?? 'source',
    );
    const selection = selectShapeFromQueryBody(
      bodyArgument,
      receiverReferences,
      options.columnShapes,
    );
    const readResolutionOptions: QueryReadResolutionOptions = {
      ...(options.readTableIdentifier ? { readTableIdentifier: options.readTableIdentifier } : {}),
      ...(options.relationalTableName ? { relationalTableName: options.relationalTableName } : {}),
    };
    const diagnostics = [
      ...relationalQueryDiagnostics(bodyArgument, receiverReferences),
      ...unclassifiedQueryReceiverDiagnostics(bodyArgument, receiverReferences),
      ...externalQueryHelperDiagnostics(bodyArgument, receiverReferences, localFunctionKeys),
      ...unresolvedQueryReadDiagnostics(bodyArgument, receiverReferences, readResolutionOptions),
    ];
    const localHelperCalls = queryLocalHelperCalls(
      bodyArgument,
      receiverReferences,
      localFunctionKeys,
    );
    if (!selection && diagnostics.length === 0 && localHelperCalls.length === 0) continue;

    definitions.push({
      ...(selection?.diagnostics || diagnostics.length > 0
        ? { diagnostics: [...(selection?.diagnostics ?? []), ...diagnostics] }
        : {}),
      hasOutputSchema: objectHasProperty(bodyArgument, 'output'),
      hasSelection: selection !== null,
      index: declaration.getStart(),
      instanceKeyComparisons: queryInstanceKeyComparisons(
        bodyArgument,
        receiverReferences,
        options.readTableIdentifier,
      ),
      localHelperCalls,
      opaquePaths: selection?.opaquePaths ?? [],
      query,
      shape: selection?.shape ?? {},
      tableExpressions: queryTableExpressions(
        bodyArgument,
        receiverReferences,
        readResolutionOptions,
      ),
      unresolvedPaths: selection?.unresolvedPaths ?? [],
    });
  }

  return definitions;
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
  receiverReferences: QueryReceiverReferences,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
): QueryShapeSelection | null {
  const selectCall = selectCallFromQueryBody(body, receiverReferences);
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
    nullableTables: nullableJoinTables(body, receiverReferences),
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
  receiverReferences: QueryReceiverReferences,
): CallExpression | undefined {
  const selectCalls = queryBodyCallExpressions(body, (call) =>
    isSelectQueryCallName(staticAccessName(call.getExpression())) &&
    isQueryCallOnReceiver(call, receiverReferences)
      ? [call]
      : [],
  );

  return (
    selectCalls.find((call) => call.getFirstAncestorByKind(SyntaxKind.ReturnStatement)) ??
    selectCalls[0]
  );
}

function isSelectQueryCallName(name: string | undefined): boolean {
  return name !== undefined && DRIZZLE_SELECT_QUERY_METHODS.has(name);
}

function queryCallbackReceiverReferences(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source',
): QueryReceiverReferences {
  const names = new Set(mode === 'source' ? DEFAULT_DRIZZLE_RECEIVER_NAMES : []);
  const symbolKeys = new Set<string>();

  for (const property of body.getProperties()) {
    const callback = queryCallbackFunction(property);
    if (!callback) continue;

    const receiverParameter = queryCallbackParameterNodes(callback)[1];
    const receiver = receiverParameter?.getNameNode();
    if (!receiverParameter || !receiver) continue;
    appendQueryReceiverParameterReferences(receiverParameter, receiver, mode, names, symbolKeys);

    if (mode === 'project') {
      appendProjectDrizzleReceiverBindingsFromBody(functionBody(callback), { names, symbolKeys });
    }
  }

  const references = { names, symbolKeys };
  appendQueryTransactionReceiverAliases(body, references);
  return references;
}

function appendQueryReceiverParameterReferences(
  parameter: ParameterDeclaration,
  name: Node,
  mode: 'project' | 'source',
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (mode === 'project') {
    // SPEC §11.1: project query facts require a proven Drizzle receiver. Untyped loader
    // parameters stay invisible instead of falling back to source-mode db/tx name guesses.
    appendProjectDrizzleReceiverBinding(name, names, symbolKeys);
    return;
  }

  appendUntypedQueryReceiverBinding(name, names, symbolKeys);
}

function queryCallbackParameterNodes(callback: Node): ParameterDeclaration[] {
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionExpression(callback) ||
    Node.isMethodDeclaration(callback)
  ) {
    return callback.getParameters();
  }

  return [];
}

function appendQueryTransactionReceiverAliases(
  body: ObjectLiteralExpression,
  receiverReferences: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §10-§11: callback-local transaction aliases remain visible query-loader surfaces when
  // they originate from a proven Drizzle receiver.
  let changed = true;

  while (changed) {
    changed = false;

    for (const call of queryExecutableCallExpressions(body)) {
      if (staticAccessName(call.getExpression()) !== 'transaction') continue;

      const receiver = staticAccessExpression(call.getExpression());
      if (!isQueryReceiverIdentifier(receiver, receiverReferences)) continue;

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
      if (!Node.isIdentifier(alias) || isQueryReceiverIdentifier(alias, receiverReferences)) {
        continue;
      }

      receiverReferences.names.add(alias.getText());
      const symbolKey = resolvedSymbolKey(alias.getSymbol());
      if (symbolKey) receiverReferences.symbolKeys.add(symbolKey);
      changed = true;
    }
  }
}

function isQueryReceiverIdentifier(
  node: Node | undefined,
  receiverReferences: QueryReceiverReferences,
): boolean {
  if (!node || !Node.isIdentifier(node)) return false;

  const symbolKey = resolvedSymbolKey(node.getSymbol());
  if (receiverReferences.symbolKeys.size > 0 && symbolKey) {
    return receiverReferences.symbolKeys.has(symbolKey);
  }

  return receiverReferences.names.has(node.getText());
}

function relationalQueryDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): TouchGraphDiagnostic[] {
  if (queryRelationalTableExpressions(body, receiverReferences).length === 0) return [];

  return [
    {
      code: 'FW406',
      message: `${diagnosticDefinitions.FW406.message} Query uses Drizzle relational query API without static projection.`,
      severity: diagnosticDefinitions.FW406.severity,
      site: '',
    },
  ];
}

function unclassifiedQueryReceiverDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): TouchGraphDiagnostic[] {
  // SPEC §10.2/§11.1: query loaders may not hide raw SQL, writes, transactions, or other
  // unclassified Drizzle receiver work under an empty fact set.
  return queryBodyCallExpressions(body, (call) => {
    const expression = call.getExpression();
    const name = staticAccessName(expression);
    if (!name || isSelectQueryCallName(name)) return [];

    const receiver = staticAccessExpression(expression);
    if (!isQueryReceiverIdentifier(receiver, receiverReferences)) return [];
    if (!Node.isIdentifier(receiver)) return [];

    return [
      {
        code: 'FW406' as const,
        message: `${diagnosticDefinitions.FW406.message} Query uses unclassified Drizzle receiver call ${receiver.getText()}.${name}().`,
        severity: diagnosticDefinitions.FW406.severity,
        site: '',
      },
    ];
  });
}

function externalQueryHelperDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  localFunctionKeys: ReadonlySet<string>,
): TouchGraphDiagnostic[] {
  // SPEC §11.1: helpers that receive the query loader's Drizzle receiver are an explicit FW406
  // boundary until their read/write summaries are proven interprocedurally.
  return queryExecutableCallExpressions(body).flatMap((call) => {
    const expression = call.getExpression();
    if (!Node.isIdentifier(expression)) return [];

    const name = expression.getText();
    if (IGNORED_LOCAL_CALL_NAMES.has(name)) return [];
    if (localFunctionKeyForIdentifier(expression, localFunctionKeys)) return [];

    const receiverName = queryHelperReceiverArgumentName(call, receiverReferences);
    if (!receiverName) return [];

    return [
      {
        code: 'FW406' as const,
        message: `${diagnosticDefinitions.FW406.message} Query passes Drizzle receiver ${receiverName} to helper ${name}().`,
        severity: diagnosticDefinitions.FW406.severity,
        site: '',
      },
    ];
  });
}

function queryLocalHelperCalls(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  localFunctionKeys: ReadonlySet<string>,
): string[] {
  const calls: string[] = [];

  for (const call of queryExecutableCallExpressions(body)) {
    const expression = call.getExpression();
    if (!Node.isIdentifier(expression)) continue;
    if (!queryHelperReceiverArgumentName(call, receiverReferences)) continue;

    const key = localFunctionKeyForIdentifier(expression, localFunctionKeys);
    if (key) calls.push(key);
  }

  return [...new Set(calls)];
}

function queryExecutableCallExpressions(body: ObjectLiteralExpression): CallExpression[] {
  return queryCallbackBodies(body)
    .flatMap((callbackBody) => touchBodyCallExpressions(callbackBody))
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right));
}

function queryCallbackBodies(body: ObjectLiteralExpression): Node[] {
  const bodies: Node[] = [];

  for (const property of body.getProperties()) {
    const callback = queryCallbackFunction(property);
    if (callback) bodies.push(functionBody(callback));
  }

  return bodies;
}

function queryCallbackFunction(node: Node): Node | undefined {
  // SPEC §10.2/§11.1: query facts come from the query loader, not arbitrary callback-shaped
  // config/helper properties that happen to accept a db-like parameter.
  if (!queryCallbackPropertyIsLoad(node)) return undefined;

  if (Node.isMethodDeclaration(node)) return node;
  if (!Node.isPropertyAssignment(node)) return undefined;

  const initializer = node.getInitializer();
  if (!initializer) return undefined;
  const expression = unwrappedStaticExpressionNode(initializer);
  return Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)
    ? expression
    : undefined;
}

function queryCallbackPropertyIsLoad(node: Node): boolean {
  if (!Node.isMethodDeclaration(node) && !Node.isPropertyAssignment(node)) return false;
  return propertyNameText(node.getNameNode()) === 'load';
}

function queryHelperReceiverArgumentName(
  call: CallExpression,
  receiverReferences: QueryReceiverReferences,
): string | undefined {
  for (const argument of call.getArguments()) {
    const receiverName = queryHelperArgumentReceiverName(argument, receiverReferences);
    if (receiverName) return receiverName;
  }

  return undefined;
}

function queryHelperArgumentReceiverName(
  argument: Node,
  receiverReferences: QueryReceiverReferences,
): string | undefined {
  return isQueryReceiverIdentifier(argument, receiverReferences) && Node.isIdentifier(argument)
    ? argument.getText()
    : undefined;
}

function appendUntypedQueryReceiverBinding(
  name: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (Node.isIdentifier(name)) {
    names.add(name.getText());
    const symbolKey = resolvedSymbolKey(name.getSymbol());
    if (symbolKey) symbolKeys.add(symbolKey);
    return;
  }

  if (!Node.isObjectBindingPattern(name)) return;

  for (const element of name.getElements()) {
    appendUntypedQueryReceiverBinding(element.getNameNode(), names, symbolKeys);
  }
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
  receiverReferences: QueryReceiverReferences,
): ReadonlySet<string> {
  const tables = new Set<string>();
  const relationTables: string[] = [];

  for (const { operation, table } of queryBodyCallExpressions(body, (call) => {
    const operation = propertyAccessCallName(call);
    if (!operation || !isJoinReadCallName(operation)) return [];
    if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

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
  receiverReferences: QueryReceiverReferences,
  options: QueryReadResolutionOptions = {},
): string[] {
  return [
    ...queryJoinTableExpressions(body, receiverReferences, options.readTableIdentifier),
    ...queryRelationalTableExpressions(body, receiverReferences, options.relationalTableName),
  ];
}

interface QueryReadResolutionOptions {
  readTableIdentifier?: (node: Node) => string | undefined;
  relationalTableName?: (name: string) => string | undefined;
}

function queryJoinTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  readTableIdentifier?: (node: Node) => string | undefined,
): string[] {
  return queryBodyCallExpressions(body, (call) => {
    const name = propertyAccessCallName(call);
    if (!name || !isQueryReadCallName(name)) return [];
    if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

    const table = staticExpressionPath(call.getArguments()[0], readTableIdentifier);
    return table ? [table] : [];
  });
}

function queryRelationalTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  relationalTableName?: (name: string) => string | undefined,
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
    if (!isQueryReceiverIdentifier(receiver, receiverReferences)) return [];

    const resolvedTable = relationalTableName ? relationalTableName(table) : table;
    return resolvedTable ? [resolvedTable] : [];
  });
}

function unresolvedQueryReadDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  options: QueryReadResolutionOptions = {},
): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = queryBodyCallExpressions(body, (call) => {
    const name = propertyAccessCallName(call);
    if (!name || !isQueryReadCallName(name)) return [];
    if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

    const tableArgument = call.getArguments()[0];
    if (staticExpressionPath(tableArgument, options.readTableIdentifier)) return [];

    return [
      {
        code: 'FW406' as const,
        message: `${diagnosticDefinitions.FW406.message} Query read source for db.${name}() could not be resolved to a Drizzle table.`,
        severity: diagnosticDefinitions.FW406.severity,
        site: '',
      },
    ];
  });

  diagnostics.push(
    ...unresolvedRelationalQueryReadDiagnostics(
      body,
      receiverReferences,
      options.relationalTableName,
    ),
  );
  return diagnostics;
}

function unresolvedRelationalQueryReadDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  relationalTableName?: (name: string) => string | undefined,
): TouchGraphDiagnostic[] {
  return queryBodyCallExpressions(body, (call) => {
    const expression = call.getExpression();
    const method = staticAccessName(expression);
    if (method !== 'findMany' && method !== 'findFirst') return [];

    const tableAccess = staticAccessExpression(expression);
    const table = tableAccess ? staticAccessName(tableAccess) : undefined;
    if (!tableAccess || (table && (!relationalTableName || relationalTableName(table)))) {
      return [];
    }
    const queryAccess = staticAccessExpression(tableAccess);
    if (!queryAccess || staticAccessName(queryAccess) !== 'query') return [];
    const receiver = staticAccessExpression(queryAccess);
    if (!isQueryReceiverIdentifier(receiver, receiverReferences)) return [];

    return [
      {
        code: 'FW406' as const,
        message: `${diagnosticDefinitions.FW406.message} Query relational read source could not be resolved to a Drizzle table.`,
        severity: diagnosticDefinitions.FW406.severity,
        site: '',
      },
    ];
  });
}

function queryBodyCallExpressions<T>(
  body: ObjectLiteralExpression,
  extract: (call: CallExpression) => readonly T[],
): T[] {
  // SPEC §10-§11: query facts come from executable query-loader callback surfaces; nested helper
  // bodies are summarized only when called instead of fabricating reads from declarations.
  return queryCallbackBodies(body)
    .flatMap((callbackBody) => touchBodyCallExpressions(callbackBody))
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right))
    .flatMap(extract);
}

function isQueryCallOnReceiver(
  call: CallExpression,
  receiverReferences: QueryReceiverReferences,
): boolean {
  // SPEC §11.1: read facts must originate from the Drizzle receiver, not lookalike builders.
  const receiver = queryCallChainReceiver(call);
  return isQueryReceiverIdentifier(receiver, receiverReferences);
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

function staticExpressionPath(
  node: Node | undefined,
  resolveIdentifier?: (node: Node) => string | undefined,
): string | undefined {
  if (!node) return undefined;
  const expression = unwrappedStaticExpressionNode(node);
  if (expression !== node) return staticExpressionPath(expression, resolveIdentifier);

  const resolved = resolveIdentifier?.(node);
  if (resolved) return resolved;
  if (Node.isIdentifier(node)) return resolveIdentifier?.(node) ?? node.getText();
  if (Node.isPropertyAccessExpression(node)) {
    const base = staticExpressionPath(node.getExpression(), resolveIdentifier);
    return base ? `${base}.${node.getName()}` : undefined;
  }
  if (Node.isElementAccessExpression(node)) {
    const base = staticExpressionPath(node.getExpression(), resolveIdentifier);
    const name = staticAccessName(node);
    return base && name ? `${base}.${name}` : undefined;
  }
  return undefined;
}

function staticTableExpressionPath(
  node: Node | undefined,
  resolveIdentifier?: (node: Node) => string | undefined,
): string | undefined {
  if (!node) return undefined;
  // SPEC §10-§11: syntactic wrappers around a table are not new facts; unwrap them before
  // deciding whether the read/write source is resolved or must degrade to FW406.
  return staticExpressionPath(node, resolveIdentifier);
}

function unwrappedStaticExpressionNode(node: Node): Node {
  let current = node;

  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression();
  }

  return current;
}

function queryInstanceKey(
  comparisons: readonly QueryInstanceKeyComparison[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  // SPEC §10-§11: query keys must come from real predicates, not comment/string text.
  for (const comparison of comparisons) {
    const instanceKey = queryInstanceKeyFromEqOperands(comparison.left, comparison.right, tables);
    if (instanceKey) return instanceKey;
  }

  return null;
}

function queryInstanceKeyComparisons(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  readTableIdentifier?: (node: Node) => string | undefined,
): QueryInstanceKeyComparison[] {
  return queryBodyCallExpressions(body, (call) => {
    if (propertyAccessCallName(call) !== 'where') return [];
    if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

    const predicate = call.getArguments()[0];
    if (!predicate || !Node.isCallExpression(predicate)) return [];

    const expression = predicate.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'eq') return [];

    const [left, right] = predicate.getArguments();
    if (!left || !right) return [];

    return [
      {
        left: queryInstanceKeyOperand(left, readTableIdentifier),
        right: queryInstanceKeyOperand(right, readTableIdentifier),
      },
    ];
  });
}

function queryInstanceKeyOperand(
  expression: Node,
  readTableIdentifier?: (node: Node) => string | undefined,
): QueryInstanceKeyOperand {
  return {
    ...queryTableKeyOperand(expression, readTableIdentifier),
    ...queryInputKeyOperand(expression),
  };
}

function queryTableKeyOperand(
  expression: Node,
  readTableIdentifier?: (node: Node) => string | undefined,
): Pick<QueryInstanceKeyOperand, 'tableKey'> {
  const key = staticAccessName(expression);
  const tableIdentifier = staticExpressionPath(
    staticAccessExpression(expression),
    readTableIdentifier,
  );
  if (!tableIdentifier || !key) return {};

  return {
    tableKey: {
      key,
      tableIdentifier,
    },
  };
}

function queryInputKeyOperand(expression: Node): Pick<QueryInstanceKeyOperand, 'inputKey'> {
  const node = staticAccessExpression(expression);
  if (!Node.isIdentifier(node) || node.getText() !== 'input') return {};

  const key = staticAccessName(expression);
  return key ? { inputKey: `arg:${key}` } : {};
}

function queryInstanceKeyFromEqOperands(
  left: QueryInstanceKeyOperand,
  right: QueryInstanceKeyOperand,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  const candidates = [
    { inputKey: right.inputKey, tableKey: left.tableKey },
    { inputKey: left.inputKey, tableKey: right.tableKey },
  ];

  for (const candidate of candidates) {
    if (!candidate.inputKey || !candidate.tableKey) continue;
    const tableKey = resolvedQueryTableKey(candidate.tableKey, tables);
    if (!tableKey) continue;

    return { instanceKey: { domain: tableKey.domain, key: candidate.inputKey } };
  }

  return null;
}

function resolvedQueryTableKey(
  key: { key: string; tableIdentifier: string },
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): { domain: string } | null {
  for (const table of tables.get(key.tableIdentifier) ?? []) {
    if (isDomainTableAnnotation(table.annotation) && table.annotation.key === key.key) {
      return { domain: table.annotation.domain };
    }
  }

  return null;
}

function directSummaryForFunction(
  fn: ExtractedFunction,
  file: SourceFileInput,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): FunctionTouchSummary {
  const reads: ReadSummaryInput[] = [];
  const writes: WriteSummaryInput[] = [];
  const unresolved: UnresolvedSummaryInput[] = [];

  // SPEC §11.1: visible Drizzle read surfaces belong in the touch graph, not FW406.
  for (const call of fn.readCalls) {
    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        if (isExemptTableAnnotation(table.annotation)) continue;
        reads.push({
          operation: call.operation,
          site,
          table: table.annotation,
        });
      }
      continue;
    }

    unresolved.push({
      operation: call.operation,
      site,
    });
  }

  for (const call of fn.writeCalls) {
    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        if (isExemptTableAnnotation(table.annotation)) continue;
        const writePredicate = predicateSummaryFromFacts(
          call.predicateFacts,
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
            const readPredicate = predicateSummaryFromFacts(
              call.predicateFacts,
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

  for (const call of fn.unresolvedCalls) {
    unresolved.push({
      operation: call.name,
      site: `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`,
    });
  }

  return { reads, unresolved, writes };
}

function functionTouchSummariesForFile(
  file: SourceFileInput,
  functions: readonly ExtractedFunction[],
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): Map<string, FunctionTouchSummary> {
  const functionsByKey = new Map(functions.map((fn) => [fn.key, fn]));
  const callsByKey = new Map(
    functions.map((fn) => [fn.key, fn.localCalls.filter((call) => functionsByKey.has(call))]),
  );
  const summaries = new Map(
    functions.map((fn) => [
      fn.key,
      directSummaryForFunction(fn, file, tables, unresolvedIdentifiers),
    ]),
  );

  let changed = true;
  while (changed) {
    changed = false;

    for (const fn of functions) {
      const summary = summaries.get(fn.key);
      if (!summary) continue;

      for (const call of callsByKey.get(fn.key) ?? []) {
        const calleeSummary = summaries.get(call);
        if (!calleeSummary) continue;

        if (mergeSummary(summary, calleeSummary)) changed = true;
      }
    }
  }

  return summaries;
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

function extractTables(file: SourceFileInput): ExtractedTableDeclaration[] {
  const tables: ExtractedTableDeclaration[] = [];
  const byIdentifier = new Map<string, ExtractedTableDeclaration[]>();
  const declarations = variableDeclarationsFromSource(file);

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

function variableDeclarationsFromSource(file: SourceFileInput): SourceVariableDeclaration[] {
  return withParsedSourceFile(file, (sourceFile) =>
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

function withParsedSourceFile<T>(file: SourceFileInput, visit: (sourceFile: SourceFile) => T): T {
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
  const sourceFile = project.createSourceFile(file.fileName, file.source);

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

interface ExportStarAlias {
  moduleSpecifier: string;
}

function projectSourceModuleContext(extraction: ProjectExtraction): SourceModuleContext {
  // SPEC §10-§11: project-mode table facts come from resolved ts-morph symbols, not rewritten
  // source text that is reparsed through source-mode table extraction.
  const tablesBySyntheticName = projectTablesBySyntheticName(extraction);
  const tablesByFileName = new Map<string, Map<string, ExtractedTable[]>>();

  extraction.sourceFiles.forEach((sourceFile, index) => {
    const file = extraction.files[index];
    if (!file) return;

    const tables = new Map<string, ExtractedTable[]>();
    appendProjectDeclaredTables(tables, sourceFile, extraction, tablesBySyntheticName);
    appendProjectReferencedTables(tables, sourceFile, extraction, tablesBySyntheticName);
    tablesByFileName.set(file.fileName, tables);
  });

  return {
    fileNames: new Set(extraction.files.map((file) => file.fileName)),
    filesByName: new Map(extraction.files.map((file) => [file.fileName, file])),
    tablesByFileName,
  };
}

function projectTablesBySyntheticName(
  extraction: ProjectExtraction,
): ReadonlyMap<string, ExtractedTable> {
  const tables = new Map<string, ExtractedTable>();

  for (const sourceFile of extraction.sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!initializer || !isAnnotatedTableInitializerNode(initializer)) continue;

      const syntheticName = extraction.tableNamesBySymbol.get(
        resolvedSymbolKey(name.getSymbol()) ?? '',
      );
      if (!syntheticName) continue;

      const annotation = tableAnnotation(initializer);
      if (!annotation) continue;

      tables.set(syntheticName, {
        annotation: {
          ...annotation,
          name: tableNameArgument(initializer) ?? syntheticName,
        },
        columns:
          extraction.columnShapesByTable.get(syntheticName) ?? tableColumnShapes(initializer),
        exported: variableDeclarationIsExported(declaration),
      });
    }
  }

  return tables;
}

function appendProjectDeclaredTables(
  tables: Map<string, ExtractedTable[]>,
  sourceFile: SourceFile,
  extraction: ProjectExtraction,
  tablesBySyntheticName: ReadonlyMap<string, ExtractedTable>,
): void {
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const syntheticName = extraction.tableNamesBySymbol.get(
      resolvedSymbolKey(declaration.getNameNode().getSymbol()) ?? '',
    );
    const table = syntheticName ? tablesBySyntheticName.get(syntheticName) : undefined;
    if (syntheticName && table) appendTableEntries(tables, syntheticName, [table]);
  }
}

function appendProjectReferencedTables(
  tables: Map<string, ExtractedTable[]>,
  sourceFile: SourceFile,
  extraction: ProjectExtraction,
  tablesBySyntheticName: ReadonlyMap<string, ExtractedTable>,
): void {
  const namespaceTableNames = projectNamespaceTableNamesByLocal(
    sourceFile,
    extraction.tableNamesBySymbol,
  );

  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const syntheticName = extraction.tableNamesBySymbol.get(
      resolvedSymbolKey(identifier.getSymbol()) ?? '',
    );
    const table = syntheticName ? tablesBySyntheticName.get(syntheticName) : undefined;
    if (syntheticName && table) appendTableEntries(tables, syntheticName, [table]);
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    appendProjectNamespaceTableAccess(tables, access, namespaceTableNames, tablesBySyntheticName);
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    appendProjectNamespaceTableAccess(tables, access, namespaceTableNames, tablesBySyntheticName);
  }
}

function appendProjectNamespaceTableAccess(
  tables: Map<string, ExtractedTable[]>,
  access: Node,
  namespaceTableNames: ProjectNamespaceTableNames,
  tablesBySyntheticName: ReadonlyMap<string, ExtractedTable>,
): void {
  const tablePath = projectNamespaceAccessTableName(access, namespaceTableNames);
  const syntheticName = tablePath?.split('.').at(-1);
  const table = syntheticName ? tablesBySyntheticName.get(syntheticName) : undefined;
  if (tablePath && table) appendTableEntries(tables, tablePath, [table]);
}

function sourceModuleContext(files: readonly SourceFileInput[]): SourceModuleContext {
  const tablesByFileName = new Map<string, Map<string, ExtractedTable[]>>();

  for (const file of files) {
    const tables = new Map<string, ExtractedTable[]>();
    for (const table of extractTables(file)) {
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

  for (const namespace of namespaceImportAliases(file)) {
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
  for (const alias of importTableAliasesForSource(file)) {
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

  for (const alias of exportTableAliasesForSource(file)) {
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
  for (const alias of exportStarAliasesForSource(file)) {
    const moduleFileName = resolveRelativeModuleFileName(
      fileName,
      alias.moduleSpecifier,
      context.fileNames,
    );
    if (!moduleFileName) continue;

    for (const [identifier, entries] of exportedTablesForFile(moduleFileName, context, seen)) {
      appendTableEntries(exported, identifier, entries);
    }
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

  for (const alias of exportTableAliasesForSource(file)) {
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
  for (const alias of exportStarAliasesForSource(file)) {
    const moduleFileName = resolveRelativeModuleFileName(
      fileName,
      alias.moduleSpecifier,
      context.fileNames,
    );
    if (!moduleFileName) continue;

    const entries = tableEntriesForExport(moduleFileName, exportedName, context, seen);
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

function namespaceImportAliases(file: SourceFileInput): NamespaceImportAlias[] {
  return withParsedSourceFile(file, (sourceFile) =>
    sourceFile.getImportDeclarations().flatMap((declaration) => {
      const local = declaration.getNamespaceImport()?.getText();
      const moduleSpecifier = declaration.getModuleSpecifierValue();
      return local ? [{ local, moduleSpecifier }] : [];
    }),
  );
}

function importTableAliasesForSource(file: SourceFileInput): TableAlias[] {
  return withParsedSourceFile(file, importTableAliases);
}

function exportTableAliasesForSource(file: SourceFileInput): TableAlias[] {
  return withParsedSourceFile(file, exportTableAliases);
}

function exportStarAliasesForSource(file: SourceFileInput): ExportStarAlias[] {
  return withParsedSourceFile(file, exportStarAliases);
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

function exportStarAliases(sourceFile: SourceFile): ExportStarAlias[] {
  const aliases: ExportStarAlias[] = [];

  for (const declaration of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = declaration.getModuleSpecifierValue();
    if (!moduleSpecifier || declaration.getNamedExports().length > 0) continue;

    aliases.push({ moduleSpecifier });
  }

  return aliases;
}

function extractUnresolvedConditionalIdentifiers(
  file: SourceFileInput,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const unresolved: string[] = [];

  for (const declaration of variableDeclarationsFromSource(file)) {
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

function extractFunctions(file: SourceFileInput): ExtractedFunction[] {
  return withParsedSourceFile(file, (sourceFile) => {
    const functions = [
      ...extractFunctionDeclarations(sourceFile),
      ...extractVariableAssignedFunctions(sourceFile),
      ...extractDomainWriteCallbacks(sourceFile),
    ];
    const localFunctionKeys = new Set(functions.map((fn) => fn.key));

    return functions.map((fn): ExtractedFunction => {
      const receiverNames = new Set(fn.receiverNames ?? sourceDrizzleReceiverNames(fn.callback));
      const { bodyNode, callback: _callback, ...extracted } = fn;

      return {
        ...extracted,
        localCalls: extractLocalFunctionCallsFromBody(bodyNode, localFunctionKeys),
        readCalls: [
          ...extractSelectReadCallsFromBody(bodyNode, receiverNames),
          ...extractRelationalReadCallsFromBody(bodyNode, receiverNames),
        ],
        receiverNames: [...receiverNames],
        unresolvedCalls: [
          ...extractExternalDbArgumentCallsFromBody(bodyNode, receiverNames, localFunctionKeys),
          ...extractUnclassifiedDrizzleReceiverCallsFromBody(bodyNode, receiverNames),
        ],
        writeCalls: extractDrizzleWriteCallsFromBody(bodyNode, receiverNames),
      };
    });
  });
}

function localFunctionKeysFromSourceFile(sourceFile: SourceFile): ReadonlySet<string> {
  const functions = [
    ...extractFunctionDeclarations(sourceFile),
    ...extractVariableAssignedFunctions(sourceFile),
  ];
  return new Set(functions.map((fn) => fn.key));
}

function extractFunctionDeclarations(sourceFile: SourceFile): ParsedExtractedFunction[] {
  const functions: ParsedExtractedFunction[] = [];

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const name = declaration.getName();
    if (!name || !declaration.getBody()) continue;

    functions.push(extractedFunctionFromCallback(name, declaration, declaration.getNameNode()));
  }

  return functions;
}

function extractVariableAssignedFunctions(sourceFile: SourceFile): ParsedExtractedFunction[] {
  const functions: ParsedExtractedFunction[] = [];

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    if (!Node.isIdentifier(name)) continue;

    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;

    functions.push(extractedFunctionFromCallback(name.getText(), initializer, name));
  }

  return functions;
}

function extractDomainWriteCallbacks(sourceFile: SourceFile): ParsedExtractedFunction[] {
  const callbacks: ParsedExtractedFunction[] = [];

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
        extractedFunctionFromCallback(
          `${domainName.getText()}.${memberName}`,
          callback,
          property.getNameNode(),
        ),
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

function extractedFunctionFromCallback(
  name: string,
  callback: Node,
  keyNode: Node = callback,
): ParsedExtractedFunction {
  const body = functionBody(callback);
  const bodyStart = Node.isBlock(body) ? body.getStart() + 1 : body.getStart();
  const key = extractedFunctionKey(name, callback, keyNode);

  return {
    bodyNode: body,
    bodyStart,
    callback,
    key,
    name,
    receiverNames: sourceDrizzleReceiverNames(callback),
  };
}

function extractedFunctionKey(name: string, callback: Node, keyNode: Node = callback): string {
  return (
    resolvedSymbolKey(keyNode.getSymbol()) ??
    `${callback.getSourceFile().getFilePath()}:${callback.getStart()}:${name}`
  );
}

function functionBody(callback: Node): Node {
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionDeclaration(callback) ||
    Node.isFunctionExpression(callback) ||
    Node.isMethodDeclaration(callback)
  ) {
    const body = callback.getBody();
    if (body) return body;
  }

  throw new Error('Expected a write callback function');
}

function extractLocalFunctionCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
): string[] {
  const calls: string[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();
    if (!Node.isIdentifier(expression)) continue;

    const name = expression.getText();
    if (IGNORED_LOCAL_CALL_NAMES.has(name)) continue;

    const key = localFunctionKeyForIdentifier(expression, localFunctionKeys);
    if (key && localFunctionKeys.has(key)) calls.push(key);
  }

  return [...new Set(calls)];
}

function extractDrizzleWriteCallsFromBody(
  body: Node,
  receiverNames: ReadonlySet<string>,
  bodyOffset = bodySourceStart(body),
): ExtractedWriteCall[] {
  const calls: ExtractedWriteCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    if (!isDrizzleWriteCall(call)) continue;

    const expression = call.getExpression();
    const operation = staticAccessName(expression);
    const receiver = staticAccessExpression(expression);
    if (!operation || !receiver) continue;
    if (!isSourceDrizzleReceiverIdentifier(receiver, receiverNames)) continue;

    const chain = drizzleWriteChainRoot(call);
    const start = call.getStart() - bodyOffset;
    const tableArgument = call.getArguments()[0];
    if (start < 0 || !tableArgument) continue;
    const tableExpression =
      staticTableExpressionPath(tableArgument) ?? UNRESOLVED_READ_SOURCE_EXPRESSION;

    calls.push({
      index: start,
      operation,
      predicateFacts: extractPredicateFactsFromWriteChain(chain),
      readSources: extractReadSourcesFromWriteChain(
        chain,
        operation,
        (node) => staticTableExpressionPath(node) ?? UNRESOLVED_READ_SOURCE_EXPRESSION,
      ),
      tableExpression,
    });
  }

  return calls;
}

interface ExternalDbArgumentCall {
  index: number;
  name: string;
}

function extractExternalDbArgumentCallsFromBody(
  body: Node,
  receiverNames: ReadonlySet<string>,
  localFunctionKeys: ReadonlySet<string>,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();
    if (!Node.isIdentifier(expression)) continue;

    const name = expression.getText();
    if (IGNORED_LOCAL_CALL_NAMES.has(name)) continue;
    const key = localFunctionKeyForIdentifier(expression, localFunctionKeys);
    if (key && localFunctionKeys.has(key)) continue;

    if (!call.getArguments().some((arg) => isSourceDrizzleReceiverIdentifier(arg, receiverNames))) {
      continue;
    }

    const index = call.getStart() - bodyOffset;
    if (index >= 0) calls.push({ index, name });
  }

  return calls;
}

function localFunctionKeyForIdentifier(
  identifier: Node,
  localFunctionKeys: ReadonlySet<string>,
): string | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;

  const symbolKey = resolvedSymbolKey(identifier.getSymbol());
  if (symbolKey && localFunctionKeys.has(symbolKey)) return symbolKey;

  const symbol = identifier.getSymbol()?.getAliasedSymbol() ?? identifier.getSymbol();
  for (const declaration of symbol?.getDeclarations() ?? []) {
    const key = localFunctionKeyForDeclaration(declaration);
    if (key && localFunctionKeys.has(key)) return key;
  }

  return undefined;
}

function localFunctionKeyForDeclaration(declaration: Node): string | undefined {
  if (Node.isFunctionDeclaration(declaration)) {
    const name = declaration.getName();
    const nameNode = declaration.getNameNode();
    return name && nameNode ? extractedFunctionKey(name, declaration, nameNode) : undefined;
  }

  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isFunctionDeclaration(parent)) {
      const name = parent.getName();
      return name ? extractedFunctionKey(name, parent, declaration) : undefined;
    }
    if (Node.isVariableDeclaration(parent)) {
      const initializer = parent.getInitializer();
      if (
        initializer &&
        (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
      ) {
        return extractedFunctionKey(declaration.getText(), initializer, declaration);
      }
    }
  }

  return undefined;
}

function extractReceiverMutationCallsFromBody(
  body: Node,
  receiverNames: ReadonlySet<string>,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();
    const name = staticAccessName(expression);
    if (!name || !isUnclassifiedDirectDrizzleReceiverMethod(name)) continue;

    const receiver = staticAccessExpression(expression);
    if (!isSourceDrizzleReceiverIdentifier(receiver, receiverNames)) continue;

    const index = call.getStart() - bodyOffset;
    if (index >= 0) calls.push({ index, name });
  }

  return calls;
}

function isUnclassifiedDirectDrizzleReceiverMethod(name: string): boolean {
  // SPEC §10-§11: direct receiver calls not statically classified are explicit FW406 surfaces.
  return (
    UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS.has(name) ||
    !CLASSIFIED_DRIZZLE_RECEIVER_METHODS.has(name)
  );
}

function extractUnclassifiedDrizzleReceiverCallsFromBody(
  body: Node,
  receiverNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  return extractReceiverMutationCallsFromBody(body, receiverNames);
}

function extractSelectReadCallsFromBody(
  body: Node,
  receiverNames: ReadonlySet<string>,
  bodyOffset = bodySourceStart(body),
): ExtractedReadCall[] {
  const calls: ExtractedReadCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const read = selectReadCall(call);
    if (!read || !isSourceDrizzleReceiverIdentifier(read.receiver, receiverNames)) continue;

    const index = call.getStart() - bodyOffset;
    if (index >= 0) {
      calls.push({
        index,
        operation: 'select',
        tableExpression: staticTableExpressionPath(read.table) ?? UNRESOLVED_READ_SOURCE_EXPRESSION,
      });
    }
  }

  return calls;
}

function extractRelationalReadCallsFromBody(
  body: Node,
  receiverNames: ReadonlySet<string>,
  bodyOffset = bodySourceStart(body),
): ExtractedReadCall[] {
  const calls: ExtractedReadCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const read = relationalReadCall(call);
    if (!read || !isSourceDrizzleReceiverIdentifier(read.receiver, receiverNames)) continue;

    const index = call.getStart() - bodyOffset;
    if (index >= 0) {
      calls.push({
        index,
        operation: 'relational-query',
        tableExpression: read.tableExpression,
      });
    }
  }

  return calls;
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

  if (declarations.some((declaration) => isSourceReceiverParameterDeclaration(declaration))) {
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

function isSourceReceiverParameterDeclaration(declaration: Node): boolean {
  const parameter = receiverParameterDeclaration(declaration);
  if (!parameter) return false;

  const name = parameter.getNameNode();
  return Node.isIdentifier(name) && isLikelyDrizzleReceiver(name.getText());
}

function receiverParameterDeclaration(declaration: Node): ParameterDeclaration | null {
  if (Node.isParameterDeclaration(declaration)) return declaration;
  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isParameterDeclaration(parent)) return parent;
  }

  return null;
}

function sourceDrizzleReceiverNames(callback: Node): string[] {
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

function isLikelyDrizzleReceiver(name: string): boolean {
  // SPEC §10-§11: source-mode names beyond the canonical db/tx surface are not proof.
  return /^(db|tx)$/.test(name);
}

function extractReadSourcesFromWriteChain(
  chain: Node,
  operation: string,
  tableExpressionText: (node: Node) => string,
): ExtractedReadSource[] {
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
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

    const tableArgument = call.getArguments()[0];
    const tableExpression = tableArgument ? tableExpressionText(tableArgument) : '';

    sources.push({
      operation: sourceOperation,
      tableExpression: tableExpression || UNRESOLVED_READ_SOURCE_EXPRESSION,
    });
  }

  // SPEC §10-§11: an opaque insert-select/update-from source is visible as FW406, not guessed.
  return sources.length > 0
    ? sources
    : [{ operation: sourceOperation, tableExpression: UNRESOLVED_READ_SOURCE_EXPRESSION }];
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
  if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
    return argument.getLiteralText();
  }
  return undefined;
}

function staticAccessExpression(node: Node): Node | undefined {
  if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
    return node.getExpression();
  }
  return undefined;
}

function predicateSummaryFromFacts(
  facts: readonly ExtractedPredicateFact[],
  tableIdentifier: string,
  table: JisoDomainTableAnnotation,
): ExtractedPredicateSummary {
  if (!table.key) return {};

  const tableFacts = facts.filter(
    (fact) => fact.tableIdentifier === tableIdentifier && fact.key === table.key,
  );
  const keyFact = tableFacts.find((fact) => fact.argumentKey);
  if (keyFact?.argumentKey) return { key: keyFact.argumentKey };

  return tableFacts.some((fact) => fact.predicate === 'non-eq') ? { predicate: 'non-eq' } : {};
}

function extractPredicateFactsFromWriteChain(
  chain: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
): ExtractedPredicateFact[] {
  const facts: ExtractedPredicateFact[] = [];
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const whereCall = calls.find((call) => propertyAccessCallName(call) === 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return facts;

  const parameterizedKey = extractParameterizedKey(predicate, resolveIdentifier);
  if (parameterizedKey) facts.push(parameterizedKey);

  if (!isEqCall(predicate)) {
    for (const reference of tableKeyReferences(predicate, resolveIdentifier)) {
      facts.push({ ...reference, predicate: 'non-eq' });
    }
  }

  return dedupePredicateFacts(facts);
}

function extractParameterizedKey(
  predicate: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
): ExtractedPredicateFact | undefined {
  if (!Node.isCallExpression(predicate)) return undefined;

  const expression = predicate.getExpression();
  if (!Node.isIdentifier(expression) || expression.getText() !== 'eq') return undefined;

  const [left, right] = predicate.getArguments();
  if (!left || !right) return undefined;

  const leftKey = tableKeyReference(left, resolveIdentifier);
  const rightArgument = argumentKey(right);
  if (leftKey && rightArgument) return { ...leftKey, argumentKey: rightArgument };

  const rightKey = tableKeyReference(right, resolveIdentifier);
  const leftArgument = argumentKey(left);
  if (rightKey && leftArgument) return { ...rightKey, argumentKey: leftArgument };

  return undefined;
}

function isEqCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;

  const expression = node.getExpression();
  return Node.isIdentifier(expression) && expression.getText() === 'eq';
}

function tableKeyReferences(
  node: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
): ExtractedPredicateFact[] {
  const references: ExtractedPredicateFact[] = [];
  const ownReference = tableKeyReference(node, resolveIdentifier);
  if (ownReference) references.push(ownReference);

  for (const descendant of node.getDescendants()) {
    const reference = tableKeyReference(descendant, resolveIdentifier);
    if (reference) references.push(reference);
  }

  return dedupePredicateFacts(references);
}

function tableKeyReference(
  node: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
): ExtractedPredicateFact | undefined {
  const path = staticExpressionPath(node, resolveIdentifier);
  if (!path) return undefined;

  const keyStart = path.lastIndexOf('.');
  if (keyStart <= 0 || keyStart === path.length - 1) return undefined;

  return {
    key: path.slice(keyStart + 1),
    tableIdentifier: path.slice(0, keyStart),
  };
}

function dedupePredicateFacts(facts: readonly ExtractedPredicateFact[]): ExtractedPredicateFact[] {
  const seen = new Set<string>();
  const deduped: ExtractedPredicateFact[] = [];

  for (const fact of facts) {
    const key = [fact.tableIdentifier, fact.key, fact.argumentKey ?? '', fact.predicate ?? ''].join(
      '\0',
    );
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fact);
  }

  return deduped;
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
