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
  type ArrowFunction,
  type FunctionExpression,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type SourceFile,
  type Symbol as MorphSymbol,
  type Type as MorphType,
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
  isDrizzleDatabaseTypeName,
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
  'with',
]);
const COMPUTED_DRIZZLE_RECEIVER_METHOD = '<computed>';
const UNRESOLVED_DOMAIN_WRITE_COMPUTED_MEMBER = '<computed>';
const UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER = '<spread>';

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
  extraUnresolvedIdentifiers: ReadonlySet<string> = new Set(),
): TouchGraph {
  const unresolvedIdentifiers = new Set<string>(extraUnresolvedIdentifiers);
  const graph: Record<string, TouchGraphEntry> = {};
  const graphSummaries = new Map<string, FunctionTouchSummary>();

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

    for (const unresolved of unresolvedDomainWriteCallbacks(file)) {
      const summary: FunctionTouchSummary = {
        reads: [],
        unresolved: [
          {
            operation: 'domain-write-callback',
            site: unresolved.site,
          },
        ],
        writes: [],
      };
      if (unresolved.mergeWithExact) {
        const graphSummary = graphSummaries.get(unresolved.name) ?? {
          reads: [],
          unresolved: [],
          writes: [],
        };
        mergeSummary(graphSummary, summary);
        graphSummaries.set(unresolved.name, graphSummary);
        graph[unresolved.name] = createTouchGraphEntry(graphSummary);
      } else {
        graph[unresolved.name] = createTouchGraphEntry(summary);
      }
    }

    for (const fn of functions) {
      if (fn.summaryOnly) continue;

      const { reads, unresolved, writes } = summaries.get(fn.key) ?? {
        reads: [],
        unresolved: [],
        writes: [],
      };
      if (reads.length > 0 || writes.length > 0 || unresolved.length > 0) {
        const graphSummary = graphSummaries.get(fn.name) ?? {
          reads: [],
          unresolved: [],
          writes: [],
        };
        mergeSummary(graphSummary, { reads, unresolved, writes });
        graphSummaries.set(fn.name, graphSummary);
        graph[fn.name] = createTouchGraphEntry(graphSummary);
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
      projectUnresolvedConditionalTableExpressions(extraction),
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
          localFunctionReceiverParameters: functionReceiverParametersByKey(
            (projectFunctionExtractions.get(file.fileName) ?? new Map()).values(),
          ),
          namespaceTableNames: projectNamespaceTableNamesByLocal(
            sourceFile,
            extraction.tableNamesBySymbol,
          ),
          relationalTableNames: projectRelationalTableNamesByProperty(
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
  conditionalTableTargetsBySyntheticName: ReadonlyMap<string, readonly string[]>;
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
  const tableNamesBySymbol = new Map(projectTableNamesBySymbol(sourceFiles));
  const conditionalTableTargetsBySyntheticName = appendProjectConditionalTableNames(
    sourceFiles,
    tableNamesBySymbol,
  );
  const columnShapesByTable = projectColumnShapesByTable(sourceFiles, tableNamesBySymbol);

  return {
    columnShapesByTable,
    conditionalTableTargetsBySyntheticName,
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
    const relationalTableNames = projectRelationalTableNamesByProperty(
      sourceFile,
      extraction.tableNamesBySymbol,
    );
    const objectCallbacks = projectObjectLiteralCallbacks(sourceFile);
    const classMemberCallbacks = projectClassStaticMemberCallbacks(sourceFile);

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
          ...extractProjectRelationalReadCalls(body, file, receivers, relationalTableNames),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        receiverParameters: projectReceiverParameterRequirements(fn),
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
      const callback = unwrappedFunctionExpression(initializer);
      if (!callback) continue;

      const body = callback.getBody();
      const receivers = projectDrizzleReceivers(callback);
      const functionName = name.getText();
      const key = extractedFunctionKey(functionName, callback, name);
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
          ...extractProjectRelationalReadCalls(body, file, receivers, relationalTableNames),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        receiverParameters: projectReceiverParameterRequirements(callback),
        writeCalls: extractProjectDrizzleWriteCalls(
          body,
          file,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
          receivers,
        ),
      });
    }

    for (const callback of [...objectCallbacks, ...classMemberCallbacks]) {
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
            relationalTableNames,
          ),
        ],
        receiverNames: [...receivers.names],
        receiverParameters: projectReceiverParameterRequirements(callback.fn),
        summaryOnly: true,
        unresolvedCalls: [],
        writeCalls: extractProjectDrizzleWriteCalls(
          callback.body,
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
            relationalTableNames,
          ),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        receiverParameters: projectReceiverParameterRequirements(callback.fn),
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
      const receivers = projectDrizzleReceivers(fn);
      const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(body, (node) =>
        isProjectDrizzleReceiverIdentifier(node, receivers),
      );
      extraction.localCalls = extractLocalFunctionCallsFromBody(
        body,
        localFunctionNames,
        extractionsByFunction,
        (argument) =>
          projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys) !==
            undefined || isDrizzleReceiver(argument),
      ).concat(
        extractTransactionCallbackLocalFunctionCallsFromBody(
          body,
          localFunctionNames,
          extractionsByFunction,
          (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
        ),
      );
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        body,
        receivers,
        localFunctionNames,
        extractionsByFunction,
      );
    }
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(name) || !initializer) continue;
      const callback = unwrappedFunctionExpression(initializer);
      if (!callback) continue;
      const extraction = extractionsByFunction.get(
        extractedFunctionKey(name.getText(), callback, name),
      );
      if (!extraction) continue;
      const receivers = projectDrizzleReceivers(callback);
      const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(callback.getBody(), (node) =>
        isProjectDrizzleReceiverIdentifier(node, receivers),
      );
      extraction.localCalls = extractLocalFunctionCallsFromBody(
        callback.getBody(),
        localFunctionNames,
        extractionsByFunction,
        (argument) =>
          projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys) !==
            undefined || isDrizzleReceiver(argument),
      ).concat(
        extractTransactionCallbackLocalFunctionCallsFromBody(
          callback.getBody(),
          localFunctionNames,
          extractionsByFunction,
          (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
        ),
      );
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        callback.getBody(),
        receivers,
        localFunctionNames,
        extractionsByFunction,
      );
    }
    for (const callback of projectDomainWriteCallbacks(sourceFile).values()) {
      const extraction = extractionsByFunction.get(callback.key);
      if (!extraction) continue;
      const receivers = projectDrizzleReceivers(callback.fn);
      const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(callback.body, (node) =>
        isProjectDrizzleReceiverIdentifier(node, receivers),
      );
      extraction.localCalls = extractLocalFunctionCallsFromBody(
        callback.body,
        localFunctionNames,
        extractionsByFunction,
        (argument) =>
          projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys) !==
            undefined || isDrizzleReceiver(argument),
      ).concat(
        extractTransactionCallbackLocalFunctionCallsFromBody(
          callback.body,
          localFunctionNames,
          extractionsByFunction,
          (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
        ),
      );
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        callback.body,
        receivers,
        localFunctionNames,
        extractionsByFunction,
      );
    }
    for (const callback of objectCallbacks) {
      const extraction = extractionsByFunction.get(callback.key);
      if (!extraction) continue;
      const receivers = projectDrizzleReceivers(callback.fn);
      const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(callback.body, (node) =>
        isProjectDrizzleReceiverIdentifier(node, receivers),
      );
      extraction.localCalls = extractLocalFunctionCallsFromBody(
        callback.body,
        localFunctionNames,
        extractionsByFunction,
        (argument) =>
          projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys) !==
            undefined || isDrizzleReceiver(argument),
      ).concat(
        extractTransactionCallbackLocalFunctionCallsFromBody(
          callback.body,
          localFunctionNames,
          extractionsByFunction,
          (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
        ),
      );
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        callback.body,
        receivers,
        localFunctionNames,
        extractionsByFunction,
      );
    }
    for (const callback of classMemberCallbacks) {
      const extraction = extractionsByFunction.get(callback.key);
      if (!extraction) continue;
      const receivers = projectDrizzleReceivers(callback.fn);
      const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(callback.body, (node) =>
        isProjectDrizzleReceiverIdentifier(node, receivers),
      );
      extraction.localCalls = extractLocalFunctionCallsFromBody(
        callback.body,
        localFunctionNames,
        extractionsByFunction,
        (argument) =>
          projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys) !==
            undefined || isDrizzleReceiver(argument),
      ).concat(
        extractTransactionCallbackLocalFunctionCallsFromBody(
          callback.body,
          localFunctionNames,
          extractionsByFunction,
          (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
        ),
      );
      extraction.unresolvedCalls = extractProjectUnresolvedCalls(
        callback.body,
        receivers,
        localFunctionNames,
        extractionsByFunction,
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
  projectContainers?: boolean;
  symbolKeys: ReadonlySet<string>;
}

interface DomainWriteProperty {
  initializer: Node | undefined;
  keyNode: Node;
  memberName: string;
}

function projectDomainWriteCallbacks(
  sourceFile: SourceFile,
): Map<string, { body: Node; fn: Node; key: string; name: string }> {
  const callbacks = new Map<string, { body: Node; fn: Node; key: string; name: string }>();

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const domainName = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(domainName) || !initializer) continue;
    const domainCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(domainCall)) continue;
    const expression = domainCall.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'domain') continue;

    const domainObject = domainWriteObject(domainCall.getArguments()[0]);
    if (!domainObject.body) continue;

    for (const property of domainWriteProperties(domainObject.body)) {
      const callback = writeActionCallbackFunction(property.initializer);
      if (!callback) continue;

      const name = `${domainName.getText()}.${property.memberName}`;
      callbacks.set(name, {
        body: functionBody(callback),
        fn: callback,
        key: extractedFunctionKey(name, callback, property.keyNode),
        name,
      });
    }
  }

  return callbacks;
}

function projectObjectLiteralCallbacks(
  sourceFile: SourceFile,
): { body: Node; fn: Node; key: string; name: string }[] {
  const callbacks: { body: Node; fn: Node; key: string; name: string }[] = [];

  for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const property of object.getProperties()) {
      if (Node.isMethodDeclaration(property)) {
        const name = propertyNameText(property.getNameNode());
        if (!name) continue;

        callbacks.push({
          body: functionBody(property),
          fn: property,
          key: extractedFunctionKey(name, property, property.getNameNode()),
          name,
        });
        continue;
      }

      if (!Node.isPropertyAssignment(property)) continue;
      const name = propertyNameText(property.getNameNode());
      const initializer = property.getInitializer();
      if (!name || !initializer) continue;

      const expression = unwrappedStaticExpressionNode(initializer);
      if (!Node.isArrowFunction(expression) && !Node.isFunctionExpression(expression)) continue;

      callbacks.push({
        body: functionBody(expression),
        fn: expression,
        key: extractedFunctionKey(name, expression, property.getNameNode()),
        name,
      });
    }
  }

  return callbacks;
}

function projectClassStaticMemberCallbacks(
  sourceFile: SourceFile,
): { body: Node; fn: Node; key: string; name: string }[] {
  // SPEC §10.2/§11.1: class static helper members are executable surfaces only when ts-morph
  // can resolve their symbol. They are summary-only facts for loader/action helper propagation,
  // not public mutation graph entries.
  const callbacks: { body: Node; fn: Node; key: string; name: string }[] = [];
  const classes = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ClassExpression),
  ];

  for (const classNode of classes) {
    for (const member of classNode.getMembers()) {
      if (Node.isMethodDeclaration(member)) {
        if (!member.isStatic()) continue;
        const name = propertyNameText(member.getNameNode());
        if (!name) continue;

        callbacks.push({
          body: functionBody(member),
          fn: member,
          key: extractedFunctionKey(name, member, member.getNameNode()),
          name,
        });
        continue;
      }

      if (!Node.isPropertyDeclaration(member) || !member.isStatic()) continue;
      const name = propertyNameText(member.getNameNode());
      const callback = callbackFunctionFromPropertyDeclaration(member, new Set());
      if (!name || !callback) continue;

      callbacks.push({
        body: functionBody(callback),
        fn: callback,
        key: extractedFunctionKey(name, callback, member.getNameNode()),
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
    !Node.isFunctionExpression(callback) &&
    !Node.isMethodDeclaration(callback)
  ) {
    return { names: new Set(), symbolKeys: new Set() };
  }

  const names = new Set<string>();
  const symbolKeys = new Set<string>();
  for (const param of callback.getParameters()) {
    appendProjectDrizzleReceiverParameterBinding(param, names, symbolKeys);
  }
  appendProjectDrizzleReceiverBindingsFromBody(functionBody(callback), { names, symbolKeys });
  appendProjectTransactionReceiverAliases(callback, { names, symbolKeys });
  return { names, symbolKeys };
}

function projectReceiverParameterRequirements(callback: Node): ReceiverParameterRequirement[] {
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback) &&
    !Node.isMethodDeclaration(callback)
  ) {
    return [];
  }

  return callback.getParameters().flatMap((parameter, index) => {
    const names = new Set<string>();
    const symbolKeys = new Set<string>();
    appendProjectDrizzleReceiverParameterBinding(parameter, names, symbolKeys);
    return names.size > 0 || symbolKeys.size > 0
      ? [{ index, names: [...names], symbolKeys: [...symbolKeys] }]
      : [];
  });
}

function appendProjectDrizzleReceiverParameterBinding(
  parameter: ParameterDeclaration,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  const name = parameter.getNameNode();
  appendProjectDrizzleReceiverBinding(name, names, symbolKeys);
  if (Node.isIdentifier(name)) return;

  appendProjectDrizzleReceiverBindingAliasForType(name, parameter, parameter.getType(), {
    names,
    symbolKeys,
  });
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

  if (Node.isArrayBindingPattern(name)) {
    for (const element of name.getElements()) {
      if (!Node.isBindingElement(element)) continue;
      if (isRestBindingElement(element)) continue;
      appendProjectDrizzleReceiverBinding(element.getNameNode(), names, symbolKeys);
    }
    return;
  }
  if (!Node.isObjectBindingPattern(name)) return;

  for (const element of name.getElements()) {
    if (isRestBindingElement(element)) continue;
    appendProjectDrizzleReceiverBinding(element.getNameNode(), names, symbolKeys);
  }
}

function appendProjectDrizzleReceiverBindingsFromBody(
  body: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §11.1: body-local receiver aliases are accepted only when their binding type resolves to
  // Drizzle or when project symbols prove a direct alias of an already-proven Drizzle receiver.
  let changed = true;

  while (changed) {
    const before = receivers.names.size + receivers.symbolKeys.size;

    for (const declaration of touchBodyVariableDeclarations(body)) {
      appendProjectDrizzleReceiverBinding(
        declaration.getNameNode(),
        receivers.names,
        receivers.symbolKeys,
      );
      appendProjectDrizzleReceiverInitializerAlias(declaration, receivers);
      appendProjectDrizzleReceiverBindingInitializerAliases(declaration, receivers);
    }

    appendProjectDrizzleReceiverAssignmentAliases(body, receivers);
    changed = receivers.names.size + receivers.symbolKeys.size !== before;
  }
}

function appendProjectDrizzleReceiverInitializerAlias(
  declaration: ReturnType<SourceFile['getVariableDeclarations']>[number],
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  const binding = declaration.getNameNode();
  if (!Node.isIdentifier(binding)) return;

  const initializer = declaration.getInitializer();
  if (!initializer) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!isProjectDrizzleReceiverIdentifier(expression, receivers)) return;

  appendProjectDrizzleReceiverAliasIdentifier(binding, receivers);
}

function appendProjectDrizzleReceiverBindingInitializerAliases(
  declaration: ReturnType<SourceFile['getVariableDeclarations']>[number],
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  const binding = declaration.getNameNode();
  const initializer = declaration.getInitializer();
  if (!initializer) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isObjectBindingPattern(binding)) {
    appendProjectDrizzleReceiverObjectBindingAliasesForType(
      binding,
      expression,
      expression.getType(),
      receivers,
    );
    return;
  }
  if (Node.isArrayBindingPattern(binding)) {
    appendProjectDrizzleReceiverArrayBindingAliasesForType(
      binding,
      expression,
      expression.getType(),
      receivers,
    );
  }
}

function appendProjectDrizzleReceiverAssignmentAliases(
  body: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  for (const expression of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (!isTouchBodyNode(expression, body)) continue;
    if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

    const left = unwrappedStaticExpressionNode(expression.getLeft());
    const right = unwrappedStaticExpressionNode(expression.getRight());
    if (Node.isObjectLiteralExpression(left)) {
      appendProjectDrizzleReceiverObjectAssignmentAliases(left, right, receivers);
      continue;
    }
    if (Node.isArrayLiteralExpression(left)) {
      appendProjectDrizzleReceiverArrayAssignmentAliases(left, right, receivers);
      continue;
    }

    if (!Node.isIdentifier(left)) continue;
    if (!isProjectDrizzleReceiverIdentifier(right, receivers)) continue;

    appendProjectDrizzleReceiverAliasIdentifier(left, receivers);
  }
}

function appendProjectDrizzleReceiverArrayBindingAliasesForType(
  binding: Node,
  location: Node,
  sourceType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (!Node.isArrayBindingPattern(binding)) return;

  binding.getElements().forEach((element, index) => {
    if (!Node.isBindingElement(element)) return;
    if (isRestBindingElement(element)) return;

    const elementType = projectArrayElementType(sourceType, index);
    if (!elementType) return;

    appendProjectDrizzleReceiverBindingAliasForType(
      element.getNameNode(),
      location,
      elementType,
      receivers,
    );
  });
}

function appendProjectDrizzleReceiverObjectBindingAliasesForType(
  binding: Node,
  location: Node,
  sourceType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (!Node.isObjectBindingPattern(binding)) return;

  for (const element of binding.getElements()) {
    if (isRestBindingElement(element)) continue;
    const propertyName = objectBindingElementPropertyName(element);
    if (!propertyName) continue;

    const propertyType = projectObjectPropertyType(sourceType, location, propertyName);
    if (!propertyType) continue;

    appendProjectDrizzleReceiverBindingAliasForType(
      element.getNameNode(),
      location,
      propertyType,
      receivers,
    );
  }
}

function appendProjectDrizzleReceiverBindingAliasForType(
  target: Node,
  location: Node,
  targetType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (Node.isIdentifier(target)) {
    if (!isDrizzleDatabaseType(targetType)) return;

    appendProjectDrizzleReceiverAliasIdentifier(target, receivers);
    return;
  }

  if (Node.isObjectBindingPattern(target)) {
    appendProjectDrizzleReceiverObjectBindingAliasesForType(
      target,
      location,
      targetType,
      receivers,
    );
    return;
  }

  if (Node.isArrayBindingPattern(target)) {
    appendProjectDrizzleReceiverArrayBindingAliasesForType(target, location, targetType, receivers);
  }
}

function appendProjectDrizzleReceiverObjectAssignmentAliases(
  assignment: ObjectLiteralExpression,
  source: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §10-§11: destructuring assignment from a typed context is project proof when the
  // assigned property type is a Postgres Drizzle database receiver.
  appendProjectDrizzleReceiverObjectAssignmentAliasesForType(
    assignment,
    source,
    source.getType(),
    receivers,
  );
}

function appendProjectDrizzleReceiverArrayAssignmentAliases(
  assignment: Node,
  source: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §10-§11: tuple destructuring assignment is exact only when ts-morph proves the element
  // type is a Postgres Drizzle database receiver.
  if (!Node.isArrayLiteralExpression(assignment)) return;
  appendProjectDrizzleReceiverArrayAssignmentAliasesForType(
    assignment,
    source,
    source.getType(),
    receivers,
  );
}

function appendProjectDrizzleReceiverArrayAssignmentAliasesForType(
  assignment: Node,
  location: Node,
  sourceType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (!Node.isArrayLiteralExpression(assignment)) return;

  assignment.getElements().forEach((element, index) => {
    const target = unwrappedStaticExpressionNode(element);
    const elementType = projectArrayElementType(sourceType, index);
    if (!elementType) return;

    if (Node.isIdentifier(target)) {
      if (!isDrizzleDatabaseType(elementType)) return;

      appendProjectDrizzleReceiverAliasIdentifier(target, receivers);
      return;
    }

    if (Node.isObjectLiteralExpression(target)) {
      appendProjectDrizzleReceiverObjectAssignmentAliasesForType(
        target,
        location,
        elementType,
        receivers,
      );
      return;
    }

    if (Node.isArrayLiteralExpression(target)) {
      appendProjectDrizzleReceiverArrayAssignmentAliasesForType(
        target,
        location,
        elementType,
        receivers,
      );
    }
  });
}

function appendProjectDrizzleReceiverObjectAssignmentAliasesForType(
  assignment: ObjectLiteralExpression,
  location: Node,
  sourceType: MorphType,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  for (const property of assignment.getProperties()) {
    const propertyName = objectAssignmentPropertyName(property);
    if (!propertyName) continue;

    const target = objectAssignmentTargetNode(property);
    if (!target) continue;

    const propertyType = projectObjectPropertyType(sourceType, location, propertyName);
    if (!propertyType) continue;

    if (Node.isIdentifier(target)) {
      if (!isDrizzleDatabaseType(propertyType)) continue;

      appendProjectDrizzleReceiverAliasIdentifier(target, receivers);
      continue;
    }

    if (Node.isObjectLiteralExpression(target)) {
      appendProjectDrizzleReceiverObjectAssignmentAliasesForType(
        target,
        location,
        propertyType,
        receivers,
      );
      continue;
    }

    if (Node.isArrayLiteralExpression(target)) {
      appendProjectDrizzleReceiverArrayAssignmentAliasesForType(
        target,
        location,
        propertyType,
        receivers,
      );
    }
  }
}

function projectObjectPropertyType(
  sourceType: MorphType,
  location: Node,
  propertyName: string,
): MorphType | undefined {
  return sourceType.getProperty(propertyName)?.getTypeAtLocation(location);
}

function projectArrayElementType(sourceType: MorphType, index: number): MorphType | undefined {
  return sourceType.getTupleElements()[index] ?? sourceType.getArrayElementType();
}

function objectBindingElementPropertyName(element: BindingElement): string | undefined {
  return propertyNameText(element.getPropertyNameNode() ?? element.getNameNode());
}

function isRestBindingElement(element: BindingElement): boolean {
  // SPEC §11.1: a rest binding is a receiver container, not the receiver itself. Project-mode
  // exact facts must come from typed member/element access off that container.
  return element.compilerNode.dotDotDotToken !== undefined;
}

function appendProjectDrizzleReceiverAliasIdentifier(
  identifier: Node,
  receivers: { names: Set<string>; symbolKeys: Set<string> },
): void {
  if (!Node.isIdentifier(identifier)) return;

  receivers.names.add(identifier.getText());
  const symbolKey = resolvedSymbolKey(identifier.getSymbol());
  if (symbolKey) receivers.symbolKeys.add(symbolKey);
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
    if (!isProjectDrizzleReceiverIdentifier(receiver, receivers)) continue;

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
  relationalTableNames: ReadonlyMap<string, string>,
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
        relationalTableNames.get(read.tableExpression) ?? UNRESOLVED_READ_SOURCE_EXPRESSION,
    });
  }

  return calls;
}

function extractProjectUnresolvedCalls(
  body: Node,
  receivers: ProjectDrizzleReceivers,
  localFunctionNames: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
): ExternalDbArgumentCall[] {
  // SPEC §10-§11: project-mode unresolved surfaces must be tied to typed Drizzle receivers.
  const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(body, (node) =>
    isProjectDrizzleReceiverIdentifier(node, receivers),
  );
  return [
    ...extractProjectExternalDbArgumentCalls(
      body,
      receivers,
      localFunctionNames,
      carrierSymbolKeys,
    ),
    ...extractOpaqueLocalHelperReceiverCallsFromBody(
      body,
      localFunctionNames,
      localFunctionsByKey,
      (argument) =>
        projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys) !== undefined ||
        isDrizzleReceiver(argument),
      (argument) => projectReceiverReferenceInArgument(argument, receivers, carrierSymbolKeys),
    ),
    ...extractReceiverMethodAliasCallsFromBody(body, (node) =>
      isProjectDrizzleReceiverIdentifier(node, receivers),
    ),
    ...extractUnresolvedTransactionCallbackCallsFromBody(
      body,
      localFunctionNames,
      localFunctionsByKey,
      (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
    ),
    ...extractProjectUnclassifiedDrizzleReceiverCalls(body, receivers),
    ...extractProjectDrizzleReceiverContainerCalls(body),
  ];
}

function extractProjectExternalDbArgumentCalls(
  body: Node,
  receivers: ProjectDrizzleReceivers,
  localFunctionNames: ReadonlySet<string>,
  carrierSymbolKeys: ReadonlySet<string> = receiverCarrierSymbolKeysForBody(body, (node) =>
    isProjectDrizzleReceiverIdentifier(node, receivers),
  ),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const bodyStart = bodySourceStart(body);

  for (const call of touchBodyCallExpressions(body)) {
    if (
      boundReceiverMethodAccessName(call, (node) =>
        isProjectDrizzleReceiverIdentifier(node, receivers),
      )
    ) {
      continue;
    }

    const surface = externalHelperCallSurface(call);
    if (!surface) continue;

    const { name } = surface;
    if (IGNORED_LOCAL_CALL_NAMES.has(name) || localFunctionNames.has(name)) continue;
    if (localFunctionKeyForReference(surface.reference, localFunctionNames)) {
      continue;
    }
    if (
      !call
        .getArguments()
        .some((arg) => projectReceiverReferenceInArgument(arg, receivers, carrierSymbolKeys))
    ) {
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
    const surface = projectUnclassifiedCallSurface(call);
    if (!surface || !isProjectDrizzleReceiverIdentifier(surface.receiver, receivers)) continue;

    calls.push({ index: call.getStart() - bodyStart, name: surface.name });
  }

  return calls;
}

function extractProjectDrizzleReceiverContainerCalls(body: Node): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const bodyStart = bodySourceStart(body);

  for (const call of touchBodyCallExpressions(body)) {
    const surface = directDrizzleReceiverCallSurface(call);
    if (!surface) continue;
    if (!isProjectDrizzleReceiverContainerCallReceiver(surface.receiver)) continue;

    calls.push({ index: call.getStart() - bodyStart, name: surface.name });
  }

  return calls;
}

function isProjectDrizzleReceiverContainerCallReceiver(node: Node): boolean {
  // SPEC §11.1: project-mode containers that merely contain a Drizzle receiver are opaque
  // surfaces. Exact facts require a proven receiver member such as `context.db`.
  if (isProjectDrizzleReceiverMemberExpression(node)) return false;
  if (isDrizzleReceiver(node)) return false;
  return isProjectDrizzleReceiverContainerExpression(node);
}

function projectUnclassifiedCallSurface(
  call: CallExpression,
): { name: string; receiver: Node } | undefined {
  // SPEC §10-§11: only the relational query API (`db.query.<table>.find*`) is classified as a
  // read surface. Other typed receiver `find*` calls remain visible as FW406.
  const surface = directDrizzleReceiverCallSurface(call);
  if (!surface) return undefined;
  const { name } = surface;
  if ((name === 'findMany' || name === 'findFirst') && relationalReadCall(call)) {
    return undefined;
  }

  if (!isUnclassifiedDirectDrizzleReceiverMethod(name)) return undefined;
  return surface;
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

function singleReturnExpression(declaration: Node): Node | undefined {
  if (!Node.isGetAccessorDeclaration(declaration)) return undefined;

  const body = declaration.getBody();
  if (!body || !Node.isBlock(body)) return undefined;

  const statements = body.getStatements();
  if (statements.length !== 1) return undefined;

  const statement = statements[0];
  if (!statement || !Node.isReturnStatement(statement)) return undefined;

  return statement.getExpression();
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
  if (!node) return false;
  if (!Node.isIdentifier(node)) {
    // SPEC §11.1: project-mode member receivers such as `ctx.db` are exact facts when
    // ts-morph proves the member type is the pinned Postgres Drizzle database type.
    return isProjectDrizzleReceiverMemberExpression(node);
  }

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
  if (symbolKey) return receivers.symbolKeys.has(symbolKey);

  return receivers.names.has(node.getText());
}

function isProjectDrizzleReceiverMemberExpression(node: Node | undefined): boolean {
  if (!node || (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node))) {
    return false;
  }

  return isDrizzleReceiver(node);
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

function projectRelationalTableNamesByProperty(
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  const ambiguous = new Set<string>();

  const append = (name: string, node: Node) => {
    const tableName = tableNamesBySymbol.get(resolvedSymbolKey(node.getSymbol()) ?? '');
    if (!tableName) return;

    const existing = names.get(name);
    if (existing && existing !== tableName) {
      ambiguous.add(name);
      return;
    }

    names.set(name, tableName);
  };

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    if (Node.isIdentifier(name)) append(name.getText(), name);
  }

  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const specifier of declaration.getNamedImports()) {
      const local = specifier.getAliasNode() ?? specifier.getNameNode();
      append(local.getText(), local);
    }

    const moduleSourceFile = declaration.getModuleSpecifierSourceFile();
    if (!declaration.getNamespaceImport() || !moduleSourceFile) continue;
    for (const [name, tableName] of projectExportedTableNamesByName(
      moduleSourceFile,
      tableNamesBySymbol,
    )) {
      const existing = names.get(name);
      if (existing && existing !== tableName) {
        ambiguous.add(name);
        continue;
      }
      names.set(name, tableName);
    }
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
  if (isDrizzleDatabaseType(type)) {
    return true;
  }
  if (isDrizzleDatabaseTypeAnnotation(receiver)) {
    return true;
  }

  // SPEC §11.1 and IMPLEMENT_v1 v1 scope: project receiver proof is restricted to known
  // Postgres Drizzle database types. SQLite/MySQL conformance is deferred to late hardening.
  return false;
}

function isDrizzleDatabaseTypeAnnotation(receiver: Node): boolean {
  const parameter = receiverParameterDeclaration(receiver);
  const typeNode = parameter?.getTypeNode();
  return typeNode ? isDrizzleDatabaseTypeNode(typeNode) : false;
}

function isDrizzleDatabaseType(type: MorphType): boolean {
  // SPEC §11.1: project receiver proof comes from ts-morph type identity. Avoid source-text
  // membership checks that can promote arbitrary aliases like `NotPgDatabase`.
  return drizzleDatabaseTypeNames(type, new Set()).some(isDrizzleDatabaseTypeName);
}

function drizzleDatabaseTypeNames(type: MorphType, seen: Set<string>): string[] {
  const key =
    type.getAliasSymbol()?.getFullyQualifiedName() ??
    type.getSymbol()?.getFullyQualifiedName() ??
    type.getText();
  if (seen.has(key)) return [];
  seen.add(key);

  const names = new Set<string>();
  const aliasName = type.getAliasSymbol()?.getName();
  const symbolName = type.getSymbol()?.getName();
  const apparentSymbolName = type.getApparentType().getSymbol()?.getName();
  const exactTextName = drizzleDatabaseTypeNameFromExactTypeText(type.getText());
  if (aliasName) names.add(aliasName);
  if (symbolName) names.add(symbolName);
  if (apparentSymbolName) names.add(apparentSymbolName);
  if (exactTextName) names.add(exactTextName);

  for (const baseType of type.getBaseTypes()) {
    for (const name of drizzleDatabaseTypeNames(baseType, seen)) names.add(name);
  }

  return [...names];
}

function drizzleDatabaseTypeNameFromExactTypeText(typeText: string): string | undefined {
  // SPEC §11.1: unresolved imported annotations can print as exact type references even when
  // ts-morph has no declaration symbol. Keep this anchored to the whole type reference so
  // similarly named structural fakes such as `PgDatabaseLike` are not promoted.
  const match = /^(?:import\("[^"]+"\)\.)?([A-Za-z_$][\w$]*)(?:<.*>)?$/.exec(typeText);
  return match?.[1];
}

function isDrizzleDatabaseTypeNode(typeNode: Node): boolean {
  if (typeNode.getKind() !== SyntaxKind.TypeReference) return false;
  const typeReference = typeNode.asKind(SyntaxKind.TypeReference);
  const typeName = typeReference?.getTypeName();
  const name = typeName
    ? Node.isIdentifier(typeName)
      ? typeName.getText()
      : staticAccessName(typeName)
    : undefined;
  return name ? isDrizzleDatabaseTypeName(name) : false;
}

function projectTableNamesBySymbol(
  sourceFiles: readonly SourceFile[],
): ReadonlyMap<string, string> {
  const namesBySymbol = new Map<string, string>();
  let nextTable = 0;

  for (const sourceFile of sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || !isProjectAnnotatedTableInitializerNode(initializer)) continue;

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

function appendProjectConditionalTableNames(
  sourceFiles: readonly SourceFile[],
  namesBySymbol: Map<string, string>,
): ReadonlyMap<string, readonly string[]> {
  // SPEC §11.1: conditional table initializers are safe over-approximations. Project mode keeps
  // exact ts-morph branch symbols and lets unresolved branches degrade separately to FW406.
  const targetsBySyntheticName = new Map<string, string[]>();
  let nextConditional = 0;

  let changed = true;
  while (changed) {
    changed = false;

    for (const sourceFile of sourceFiles) {
      for (const declaration of sourceFile.getVariableDeclarations()) {
        const aliasSymbolKey = resolvedSymbolKey(declaration.getNameNode().getSymbol());
        if (!aliasSymbolKey || namesBySymbol.has(aliasSymbolKey)) continue;

        const targets = projectConditionalTargetTableNames(
          declaration.getInitializer(),
          namesBySymbol,
        );
        if (targets.length === 0) continue;

        const syntheticName = `__jisoProjectConditional${nextConditional}`;
        nextConditional += 1;
        namesBySymbol.set(aliasSymbolKey, syntheticName);
        targetsBySyntheticName.set(syntheticName, targets);
        changed = true;
      }
    }
  }

  return targetsBySyntheticName;
}

function projectUnresolvedConditionalTableExpressions(extraction: ProjectExtraction): Set<string> {
  const unresolved = new Set<string>();

  for (const sourceFile of extraction.sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const syntheticName = extraction.tableNamesBySymbol.get(
        resolvedSymbolKey(declaration.getNameNode().getSymbol()) ?? '',
      );
      const initializer = declaration.getInitializer();
      if (!syntheticName || !initializer) continue;

      const expression = unwrappedStaticExpressionNode(initializer);
      if (!Node.isConditionalExpression(expression)) continue;

      const targets = [expression.getWhenTrue(), expression.getWhenFalse()].map((branch) =>
        projectTableNameForNode(branch, extraction.tableNamesBySymbol),
      );
      const resolvedCount = targets.filter((target) => target !== undefined).length;
      if (resolvedCount > 0 && resolvedCount < targets.length) unresolved.add(syntheticName);
    }
  }

  return unresolved;
}

function projectConditionalTargetTableNames(
  initializer: Node | undefined,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): string[] {
  if (!initializer) return [];

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isConditionalExpression(expression)) return [];

  return [expression.getWhenTrue(), expression.getWhenFalse()]
    .map((branch) => projectTableNameForNode(branch, tableNamesBySymbol))
    .filter((target): target is string => target !== undefined);
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
      if (!initializer || !isProjectAnnotatedTableInitializerNode(initializer)) continue;

      const tableName = tableNamesBySymbol.get(
        resolvedSymbolKey(declaration.getNameNode().getSymbol()) ?? '',
      );
      if (!tableName) continue;

      const columns = tableColumnShapes(initializer, 'project');
      if (Object.keys(columns).length > 0) shapes.set(tableName, columns);
    }
  }

  return shapes;
}

function tableColumnShapes(
  initializer: Node,
  mode: 'project' | 'source' = 'source',
): Record<string, QueryShape> {
  const call = Node.isCallExpression(initializer) ? initializer : undefined;
  const columns = call?.getArguments()[1];
  if (!columns || !Node.isObjectLiteralExpression(columns)) return {};

  const shapes: Record<string, QueryShape> = {};
  for (const property of columns.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;

    const name = propertyNameText(property.getNameNode());
    if (!name) continue;

    const shape =
      mode === 'project'
        ? projectColumnBuilderShape(property.getInitializer())
        : columnBuilderShape(property.getInitializer());
    if (shape) shapes[name] = shape;
  }

  return shapes;
}

function projectColumnBuilderShape(initializer: Node | undefined): QueryShape | undefined {
  const builder = projectColumnBuilderName(initializer);
  if (!builder) return undefined;

  const baseShape = columnBuilderBaseShape(builder);
  if (!baseShape) return undefined;
  return columnBuilderIsNonNull(initializer) ? baseShape : nullableShape(baseShape);
}

function propertyNameText(name: Node, resolveStaticComputed = false): string | undefined {
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
  if (!resolveStaticComputed) return undefined;
  const expression = computedPropertyNameExpression(name);
  const staticText = expression ? staticPropertyNameExpressionText(expression) : undefined;
  if (staticText) return staticText;
  return undefined;
}

function computedPropertyNameExpression(name: Node): Node | undefined {
  if (!ts.isComputedPropertyName(name.compilerNode)) return undefined;

  return name.getChildren().find((child) => {
    const kind = child.getKind();
    return kind !== SyntaxKind.OpenBracketToken && kind !== SyntaxKind.CloseBracketToken;
  });
}

function staticPropertyNameExpressionText(
  expression: Node,
  seen: Set<string> = new Set(),
): string | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (Node.isStringLiteral(node) || Node.isNumericLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();

  const staticReference = staticLiteralReferenceFromExpression(node);
  if (staticReference && staticReference !== node) {
    return staticPropertyNameExpressionText(staticReference, seen);
  }

  const key = `${node.getSourceFile().getFilePath()}:${node.getStart()}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  for (const declaration of symbolForCallbackReference(node)?.getDeclarations() ?? []) {
    const initializer = staticLiteralContainerInitializer(declaration);
    if (!initializer) continue;
    const text = staticPropertyNameExpressionText(initializer, seen);
    if (text) return text;
  }

  return undefined;
}

function objectAssignmentTargetNode(
  property: ReturnType<ObjectLiteralExpression['getProperties']>[number],
): Node | undefined {
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  if (!Node.isPropertyAssignment(property)) return undefined;
  const initializer = property.getInitializer();
  return initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
}

function objectAssignmentPropertyName(
  property: ReturnType<ObjectLiteralExpression['getProperties']>[number],
): string | undefined {
  if (!Node.isShorthandPropertyAssignment(property) && !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  return propertyNameText(property.getNameNode());
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

function projectColumnBuilderName(initializer: Node | undefined): string | undefined {
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isCallExpression(expression)) return undefined;

  const callee = unwrappedStaticExpressionNode(expression.getExpression());
  if (Node.isIdentifier(callee)) return projectPgCoreIdentifierExportName(callee);
  if (!Node.isPropertyAccessExpression(callee)) return undefined;

  const base = unwrappedStaticExpressionNode(callee.getExpression());
  if (Node.isCallExpression(base)) return projectColumnBuilderName(base);

  // SPEC §10-§11: project-mode namespace column factories require ts-morph import proof instead
  // of accepting arbitrary `schema.text()` source names.
  return isDrizzlePgCoreNamespaceMember(callee) ? callee.getName() : undefined;
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

function isProjectAnnotatedTableInitializerNode(initializer: Node): boolean {
  if (!Node.isCallExpression(initializer)) return false;
  const expression = unwrappedStaticExpressionNode(initializer.getExpression());
  const isTableFactory = Node.isIdentifier(expression)
    ? isDrizzleTableFactoryName(projectPgCoreIdentifierExportName(expression) ?? '')
    : Node.isPropertyAccessExpression(expression) &&
      isDrizzleTableFactoryNamespaceMember(expression);
  if (!isTableFactory) return false;

  return initializer.getArguments().some(isJisoAnnotationCall);
}

function isDrizzleTableFactoryNamespaceMember(access: Node): boolean {
  if (!Node.isPropertyAccessExpression(access)) return false;
  if (!isDrizzleTableFactoryName(access.getName())) return false;
  return isDrizzlePgCoreNamespaceMember(access);
}

function isDrizzlePgCoreNamespaceMember(access: Node): boolean {
  if (!Node.isPropertyAccessExpression(access)) return false;

  const expression = unwrappedStaticExpressionNode(access.getExpression());
  if (!Node.isIdentifier(expression)) return false;

  const namespaceImport = access
    .getSourceFile()
    .getImportDeclarations()
    .some(
      (declaration) =>
        declaration.getNamespaceImport()?.getText() === expression.getText() &&
        declaration.getModuleSpecifierValue() === 'drizzle-orm/pg-core',
    );
  if (namespaceImport) return true;

  const symbol = expression.getSymbol()?.getAliasedSymbol() ?? expression.getSymbol();
  return (
    symbol?.getDeclarations().some((declaration) => {
      if (declaration.getKind() !== SyntaxKind.NamespaceImport) return false;
      const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
      return importDeclaration?.getModuleSpecifierValue() === 'drizzle-orm/pg-core';
    }) ?? false
  );
}

function projectPgCoreIdentifierExportName(identifier: Node): string | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;

  const symbol = identifier.getSymbol();
  const declarations = symbol?.getDeclarations() ?? [];
  if (declarations.length === 0) return identifier.getText();

  const directName = pgCoreExportNameFromDeclarations(declarations);
  if (directName) return directName;

  const aliased = symbol?.getAliasedSymbol();
  const aliasName = pgCoreExportNameFromDeclarations(aliased?.getDeclarations() ?? []);
  if (aliasName) return aliasName;

  return undefined;
}

function pgCoreExportNameFromDeclarations(declarations: readonly Node[]): string | undefined {
  for (const declaration of declarations) {
    const name = pgCoreImportSpecifierExportName(declaration);
    if (name) return name;
  }
  for (const declaration of declarations) {
    const name = pgCoreExportSpecifierExportName(declaration);
    if (name) return name;
  }
  for (const declaration of declarations) {
    if (declaration.getSourceFile().getFilePath().includes('drizzle-orm/pg-core')) {
      const name = Node.isIdentifier(declaration)
        ? declaration.getText()
        : declaration.getSymbol()?.getName();
      if (name) return name;
    }
  }

  return undefined;
}

function pgCoreImportSpecifierExportName(declaration: Node): string | undefined {
  if (!Node.isImportSpecifier(declaration)) return undefined;
  const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
  if (importDeclaration?.getModuleSpecifierValue() !== 'drizzle-orm/pg-core') return undefined;

  return declaration.getNameNode().getText();
}

function pgCoreExportSpecifierExportName(declaration: Node): string | undefined {
  if (!Node.isExportSpecifier(declaration)) return undefined;
  const exportDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
  if (exportDeclaration?.getModuleSpecifierValue() !== 'drizzle-orm/pg-core') return undefined;

  return declaration.getNameNode().getText();
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
  receiverParameters: readonly ReceiverParameterRequirement[];
  summaryOnly?: boolean;
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

interface ReceiverParameterRequirement {
  index: number;
  names: readonly string[];
  symbolKeys: readonly string[];
}

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
  operation: 'delete-predicate' | 'insert-select' | 'update-from' | 'update-predicate';
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
  localFunctionReceiverParameters?: ReadonlyMap<string, readonly ReceiverParameterRequirement[]>;
  namespaceTableNames: ProjectNamespaceTableNames;
  relationalTableNames: ReadonlyMap<string, string>;
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
    ...(options.localFunctionReceiverParameters
      ? { localFunctionReceiverParameters: options.localFunctionReceiverParameters }
      : {}),
    readTableIdentifier: resolveTableIdentifier,
    receiverMode: 'project',
    relationalTableName: (name) => options.relationalTableNames.get(name),
  });
}

interface QueryDefinitionOptions {
  columnShapes?: Readonly<Record<string, QueryShape>>;
  localFunctionReceiverParameters?: ReadonlyMap<string, readonly ReceiverParameterRequirement[]>;
  readTableIdentifier?: (node: Node) => string | undefined;
  receiverMode?: 'project' | 'source';
  relationalTableName?: (name: string) => string | undefined;
}

function extractQueryDefinitionsFromSourceFile(
  sourceFile: SourceFile,
  options: QueryDefinitionOptions = {},
): ExtractedQueryDefinition[] {
  const definitions: ExtractedQueryDefinition[] = [];
  const sourceLocalFunctionKeys = localFunctionKeysFromSourceFile(sourceFile);

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const statement = declaration.getVariableStatement();
    if (!statement || statement.getDeclarationKind() !== 'const') continue;

    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const queryCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(queryCall)) continue;

    const expression = queryCall.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'query') continue;

    const [queryArgument, bodyArgument] = queryCall.getArguments();
    if (!Node.isStringLiteral(queryArgument)) {
      continue;
    }

    const query = queryArgument.getLiteralText();
    const receiverMode = options.receiverMode ?? 'source';
    const bodyResolution = queryBodyObjectLiteral(bodyArgument, receiverMode);
    if (!bodyResolution.body) {
      if (bodyResolution.unresolved) {
        definitions.push({
          diagnostics: [unresolvedQueryLoadCallbackDiagnostic()],
          hasOutputSchema: false,
          hasSelection: false,
          index: declaration.getStart(),
          instanceKeyComparisons: [],
          localHelperCalls: [],
          opaquePaths: [],
          query,
          shape: {},
          tableExpressions: [],
          unresolvedPaths: [],
        });
      }
      continue;
    }

    const bodyObject = bodyResolution.body;
    const sourceDestructuredReceiverReferences =
      (options.receiverMode ?? 'source') === 'source'
        ? sourceQueryDestructuredReceiverNames(bodyObject)
        : { names: new Set<string>(), projectContainers: false, symbolKeys: new Set<string>() };
    const receiverReferences = queryCallbackReceiverReferences(bodyObject, receiverMode);
    const localFunctionsByKey =
      options.localFunctionReceiverParameters ??
      localFunctionReceiverParametersFromSourceFile(sourceFile);
    const localFunctionKeys =
      options.receiverMode === 'project' && options.localFunctionReceiverParameters
        ? new Set(options.localFunctionReceiverParameters.keys())
        : sourceLocalFunctionKeys;
    const selection = selectShapeFromQueryBody(
      bodyObject,
      receiverReferences,
      options.columnShapes,
      receiverMode,
    );
    const readResolutionOptions: QueryReadResolutionOptions = {
      ...(options.readTableIdentifier ? { readTableIdentifier: options.readTableIdentifier } : {}),
      ...(options.relationalTableName ? { relationalTableName: options.relationalTableName } : {}),
    };
    const diagnostics = [
      ...(bodyResolution.unresolved ? [unresolvedQueryLoadCallbackDiagnostic()] : []),
      ...unresolvedQueryCallbackDiagnostics(bodyObject, receiverMode),
      ...relationalQueryDiagnostics(bodyObject, receiverReferences),
      ...unclassifiedQueryReceiverDiagnostics(bodyObject, receiverReferences),
      ...projectQueryReceiverContainerDiagnostics(bodyObject, receiverReferences),
      ...receiverMethodAliasQueryDiagnostics(bodyObject, receiverReferences),
      ...externalQueryHelperDiagnostics(bodyObject, receiverReferences, localFunctionKeys),
      ...opaqueLocalQueryHelperDiagnostics(bodyObject, receiverReferences, localFunctionsByKey),
      ...unresolvedQueryReadDiagnostics(bodyObject, receiverReferences, readResolutionOptions),
      ...(receiverMode === 'source'
        ? ambientSourceQueryReceiverDiagnostics(bodyObject, localFunctionKeys)
        : []),
      ...(receiverMode === 'source'
        ? sourceQueryReceiverAliasDiagnostics(bodyObject, receiverReferences, localFunctionKeys)
        : []),
      ...(receiverMode === 'source'
        ? sourceQueryReceiverMemberDiagnostics(bodyObject, receiverReferences, localFunctionKeys)
        : []),
      ...sourceDestructuredQueryReceiverDiagnostics(
        bodyObject,
        localFunctionKeys,
        sourceDestructuredReceiverReferences,
      ),
    ];
    const localHelperCalls = queryLocalHelperCalls(
      bodyObject,
      receiverReferences,
      localFunctionsByKey,
    );
    if (!selection && diagnostics.length === 0 && localHelperCalls.length === 0) continue;

    definitions.push({
      ...(selection?.diagnostics || diagnostics.length > 0
        ? { diagnostics: [...(selection?.diagnostics ?? []), ...diagnostics] }
        : {}),
      hasOutputSchema: objectHasProperty(bodyObject, 'output'),
      hasSelection: selection !== null,
      index: declaration.getStart(),
      instanceKeyComparisons: queryInstanceKeyComparisons(
        bodyObject,
        receiverReferences,
        options.readTableIdentifier,
      ),
      localHelperCalls,
      opaquePaths: selection?.opaquePaths ?? [],
      query,
      shape: selection?.shape ?? {},
      tableExpressions: queryTableExpressions(
        bodyObject,
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
  mode: 'project' | 'source' = 'source',
): QueryShapeSelection | null {
  const selectCall = selectCallFromQueryBody(body, receiverReferences, mode);
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
    nullableTables: nullableJoinTables(body, receiverReferences, mode),
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
  mode: 'project' | 'source' = 'source',
): CallExpression | undefined {
  const selectCalls = queryBodyCallExpressions(body, mode, (call) =>
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
  const names = new Set<string>();
  const symbolKeys = new Set<string>();

  for (const callback of queryLoadCallbackFunctions(body, mode)) {
    const receiverParameter = queryCallbackParameterNodes(callback)[1];
    const receiver = receiverParameter?.getNameNode();
    if (!receiverParameter || !receiver) continue;
    appendQueryReceiverParameterReferences(receiverParameter, receiver, mode, names, symbolKeys);

    if (mode === 'project') {
      appendProjectDrizzleReceiverBindingsFromBody(functionBody(callback), { names, symbolKeys });
    }
  }

  const references = { names, projectContainers: mode === 'project', symbolKeys };
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
    appendProjectDrizzleReceiverParameterBinding(parameter, names, symbolKeys);
    return;
  }

  appendUntypedQueryReceiverBinding(name, names, symbolKeys);
}

function queryCallbackParameterNodes(callback: Node): ParameterDeclaration[] {
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionDeclaration(callback) ||
    Node.isFunctionExpression(callback) ||
    Node.isMethodDeclaration(callback)
  ) {
    return callback.getParameters();
  }

  return [];
}

function appendQueryTransactionReceiverAliases(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences & { names: Set<string>; symbolKeys: Set<string> },
): void {
  // SPEC §10-§11: callback-local transaction aliases remain visible query-loader surfaces when
  // they originate from a proven Drizzle receiver.
  let changed = true;

  while (changed) {
    changed = false;

    for (const call of queryExecutableCallExpressions(
      body,
      queryReceiverMode(receiverReferences),
    )) {
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
  if (!node) return false;
  if (!Node.isIdentifier(node)) {
    return (
      receiverReferences.projectContainers === true &&
      isProjectDrizzleReceiverMemberExpression(node)
    );
  }

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
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
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    if (
      boundReceiverMethodAccessName(call, (node) =>
        isQueryReceiverIdentifier(node, receiverReferences),
      )
    ) {
      return [];
    }

    const surface = directDrizzleReceiverCallSurface(call);
    if (!surface || isSelectQueryCallName(surface.name) || surface.name === 'with') return [];

    if (!isQueryReceiverIdentifier(surface.receiver, receiverReferences)) return [];

    return [
      {
        code: 'FW406' as const,
        message: `${diagnosticDefinitions.FW406.message} Query uses unclassified Drizzle receiver call ${surface.displayName ?? `${surface.receiver.getText()}.${surface.name}`}().`,
        severity: diagnosticDefinitions.FW406.severity,
        site: '',
      },
    ];
  });
}

function projectQueryReceiverContainerDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): TouchGraphDiagnostic[] {
  if (receiverReferences.projectContainers !== true) return [];

  return queryBodyCallExpressions(body, 'project', (call) => {
    if (
      boundReceiverMethodAccessName(call, (node) =>
        isQueryReceiverIdentifier(node, receiverReferences),
      )
    ) {
      return [];
    }

    const surface = directDrizzleReceiverCallSurface(call);
    if (!surface) return [];
    if (!isProjectDrizzleReceiverContainerCallReceiver(surface.receiver)) return [];

    return [
      {
        code: 'FW406' as const,
        message: `${diagnosticDefinitions.FW406.message} Query uses project Drizzle receiver container surface ${surface.receiver.getText()}.${surface.name}().`,
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
  const carrierSymbolKeys = queryReceiverCarrierSymbolKeys(body, receiverReferences);
  return queryExecutableCallExpressions(body, queryReceiverMode(receiverReferences)).flatMap(
    (call) => {
      if (
        boundReceiverMethodAccessName(call, (node) =>
          isQueryReceiverIdentifier(node, receiverReferences),
        )
      ) {
        return [];
      }

      const surface = externalHelperCallSurface(call);
      if (!surface) return [];

      const { name } = surface;
      if (IGNORED_LOCAL_CALL_NAMES.has(name)) return [];
      if (localFunctionKeyForReference(surface.reference, localFunctionKeys)) {
        return [];
      }

      const receiverName = queryHelperReceiverArgumentName(
        call,
        receiverReferences,
        carrierSymbolKeys,
        queryReceiverAliasReferencesForCall(body, call, receiverReferences),
      );
      if (!receiverName) return [];

      return [
        {
          code: 'FW406' as const,
          message: `${diagnosticDefinitions.FW406.message} Query passes Drizzle receiver ${receiverName} to helper ${name}().`,
          severity: diagnosticDefinitions.FW406.severity,
          site: '',
        },
      ];
    },
  );
}

function queryLocalHelperCalls(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  localFunctionsByKey: ReadonlyMap<string, readonly ReceiverParameterRequirement[]>,
): string[] {
  const calls: string[] = [];
  const localFunctionKeys = new Set(localFunctionsByKey.keys());
  const carrierSymbolKeys = queryReceiverCarrierSymbolKeys(body, receiverReferences);

  for (const call of queryExecutableCallExpressions(body, queryReceiverMode(receiverReferences))) {
    const expression = call.getExpression();

    const key = localFunctionKeyForReference(expression, localFunctionKeys);
    if (!key) continue;
    const requirements = localFunctionsByKey.get(key) ?? [];
    if (requirements.length === 0) continue;
    if (
      !localFunctionCallSatisfiesReceiverRequirements(
        call,
        requirements,
        (argument) =>
          queryReceiverReferenceInArgument(
            argument,
            receiverReferences,
            carrierSymbolKeys,
            queryReceiverAliasReferencesForCall(body, call, receiverReferences),
          ) !== undefined,
      )
    ) {
      continue;
    }
    if (key) calls.push(key);
  }

  return [...new Set(calls)];
}

function opaqueLocalQueryHelperDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  localFunctionsByKey: ReadonlyMap<string, readonly ReceiverParameterRequirement[]>,
): TouchGraphDiagnostic[] {
  const localFunctionKeys = new Set(localFunctionsByKey.keys());
  const carrierSymbolKeys = queryReceiverCarrierSymbolKeys(body, receiverReferences);

  return queryExecutableCallExpressions(body, queryReceiverMode(receiverReferences)).flatMap(
    (call) => {
      const expression = call.getExpression();

      const key = localFunctionKeyForReference(expression, localFunctionKeys);
      if (!key) return [];

      const receiverName = queryHelperReceiverArgumentName(
        call,
        receiverReferences,
        carrierSymbolKeys,
        queryReceiverAliasReferencesForCall(body, call, receiverReferences),
      );
      if (!receiverName) return [];
      const requirements = localFunctionsByKey.get(key) ?? [];
      if (
        requirements.length > 0 &&
        localFunctionCallSatisfiesReceiverRequirements(
          call,
          requirements,
          (argument) =>
            queryReceiverReferenceInArgument(
              argument,
              receiverReferences,
              carrierSymbolKeys,
              queryReceiverAliasReferencesForCall(body, call, receiverReferences),
            ) !== undefined,
        )
      ) {
        return [];
      }

      return [
        {
          code: 'FW406' as const,
          message: `${diagnosticDefinitions.FW406.message} Query passes Drizzle receiver ${receiverName} to local helper ${staticExpressionPath(expression) ?? expression.getText()}().`,
          severity: diagnosticDefinitions.FW406.severity,
          site: '',
        },
      ];
    },
  );
}

function receiverMethodAliasQueryDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): TouchGraphDiagnostic[] {
  const isReceiverIdentifier = (node: Node) => isQueryReceiverIdentifier(node, receiverReferences);

  return queryCallbackBodies(body, queryReceiverMode(receiverReferences)).flatMap((callbackBody) =>
    extractReceiverMethodAliasCallsFromBody(callbackBody, isReceiverIdentifier).map((call) => ({
      code: 'FW406' as const,
      message: `${diagnosticDefinitions.FW406.message} Query uses detached Drizzle receiver method ${call.name}().`,
      severity: diagnosticDefinitions.FW406.severity,
      site: '',
    })),
  );
}

function ambientSourceQueryReceiverDiagnostics(
  body: ObjectLiteralExpression,
  localFunctionKeys: ReadonlySet<string>,
): TouchGraphDiagnostic[] {
  return queryCallbackBodies(body).flatMap((callbackBody) =>
    extractAmbientSourceReceiverCallsFromBody(callbackBody, localFunctionKeys).map((call) => ({
      code: 'FW406' as const,
      message: `${diagnosticDefinitions.FW406.message} Query uses source-mode ambient Drizzle receiver surface ${call.name}() without a declared loader receiver.`,
      severity: diagnosticDefinitions.FW406.severity,
      site: '',
    })),
  );
}

function sourceQueryReceiverAliasDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  localFunctionKeys: ReadonlySet<string>,
): TouchGraphDiagnostic[] {
  return queryCallbackBodies(body).flatMap((callbackBody) =>
    extractSourceReceiverAliasSurfaceCallsFromBody(callbackBody, localFunctionKeys, (node) =>
      isQueryReceiverIdentifier(node, receiverReferences),
    ).map((call) => ({
      code: 'FW406' as const,
      message: `${diagnosticDefinitions.FW406.message} Query uses source-mode Drizzle receiver alias surface ${call.name}() without project type proof.`,
      severity: diagnosticDefinitions.FW406.severity,
      site: '',
    })),
  );
}

function sourceQueryReceiverMemberDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  localFunctionKeys: ReadonlySet<string>,
): TouchGraphDiagnostic[] {
  if (receiverReferences.names.size === 0 && receiverReferences.symbolKeys.size === 0) return [];

  return queryCallbackBodies(body).flatMap((callbackBody) =>
    extractSourceReceiverSurfaceCallsFromBody(
      callbackBody,
      localFunctionKeys,
      (node) => isSourceQueryReceiverMemberExpression(node, receiverReferences),
      undefined,
      true,
      (node) => isSourceQueryReceiverMemberExpression(node, receiverReferences),
    ).map((call) => ({
      code: 'FW406' as const,
      message: `${diagnosticDefinitions.FW406.message} Query uses source-mode Drizzle receiver member surface ${call.name}() without project type proof.`,
      severity: diagnosticDefinitions.FW406.severity,
      site: '',
    })),
  );
}

function sourceDestructuredQueryReceiverDiagnostics(
  body: ObjectLiteralExpression,
  localFunctionKeys: ReadonlySet<string>,
  receiverReferences: QueryReceiverReferences,
): TouchGraphDiagnostic[] {
  if (receiverReferences.names.size === 0 && receiverReferences.symbolKeys.size === 0) return [];

  return queryCallbackBodies(body).flatMap((callbackBody) =>
    extractSourceReceiverSurfaceCallsFromBody(callbackBody, localFunctionKeys, (node) =>
      isSourceDestructuredReceiverIdentifier(node, receiverReferences),
    ).map((call) => ({
      code: 'FW406' as const,
      message: `${diagnosticDefinitions.FW406.message} Query uses source-mode destructured Drizzle receiver surface ${call.name}() without project type proof.`,
      severity: diagnosticDefinitions.FW406.severity,
      site: '',
    })),
  );
}

function queryExecutableCallExpressions(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source' = 'source',
): CallExpression[] {
  return queryCallbackBodies(body, mode)
    .flatMap((callbackBody) => touchBodyCallExpressions(callbackBody))
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right));
}

function queryCallbackBodies(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source' = 'source',
): Node[] {
  return queryLoadCallbackFunctions(body, mode).map(functionBody);
}

function queryLoadCallbackFunctions(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source' = 'source',
): Node[] {
  return queryLoadCallbackResolution(body, mode).callbacks;
}

interface QueryLoadCallbackResolution {
  callbacks: Node[];
  unresolvedNodes: Node[];
}

interface QueryBodyObjectResolution {
  body?: ObjectLiteralExpression;
  unresolved: boolean;
}

function queryBodyObjectLiteral(
  argument: Node | undefined,
  mode: 'project' | 'source',
): QueryBodyObjectResolution {
  if (!argument) return { unresolved: true };
  return queryBodyObjectLiteralFromNode(argument, new Set(), mode) ?? { unresolved: true };
}

function queryBodyObjectLiteralFromNode(
  node: Node,
  seen: Set<string>,
  mode: 'project' | 'source',
): QueryBodyObjectResolution | undefined {
  // SPEC §10.2/§11.1: query option objects are executable loader surfaces; unresolved external
  // configs stay visible as FW406 rather than disappearing from query facts.
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isObjectLiteralExpression(expression)) return { body: expression, unresolved: false };
  if (mode === 'source') {
    return { unresolved: true };
  }

  if (Node.isConditionalExpression(expression)) {
    // SPEC §10.2/§11.1: whole query option conditionals are executable loader surfaces.
    // Keep the statically visible branch exact, but retain FW406 for opaque sibling branches.
    const branches = [expression.getWhenTrue(), expression.getWhenFalse()]
      .map((branch) =>
        queryBodyObjectLiteralFromNode(unwrappedStaticExpressionNode(branch), new Set(seen), mode),
      )
      .filter((branch): branch is QueryBodyObjectResolution => branch !== undefined);
    const bodies = branches.flatMap((branch) => (branch.body ? [branch.body] : []));
    const unresolved = branches.length < 2 || branches.some((branch) => branch.unresolved);

    if (bodies.length === 0) return unresolved ? { unresolved: true } : undefined;

    const uniqueBodies = new Map(
      bodies.map((body) => [`${body.getSourceFile().getFilePath()}:${body.getStart()}`, body]),
    );
    if (uniqueBodies.size === 1) {
      const [body] = bodies;
      return body ? { body, unresolved } : { unresolved: true };
    }

    return { unresolved: true };
  }

  const factoryReturn = staticObjectFactoryReturnExpression(expression, seen);
  if (factoryReturn) {
    const body = queryBodyObjectLiteralFromNode(factoryReturn, seen, mode);
    if (body) return body;
  }

  const literalReference = staticLiteralReferenceFromExpression(expression, seen);
  if (literalReference && literalReference !== expression) {
    const body = queryBodyObjectLiteralFromNode(literalReference, seen, mode);
    if (body) return body;
  }

  const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
  if (seen.has(key)) return { unresolved: true };
  seen.add(key);

  for (const declaration of symbolForCallbackReference(expression)?.getDeclarations() ?? []) {
    const body = queryBodyObjectLiteralFromDeclaration(declaration, seen, mode);
    if (body) return body;
  }

  // SPEC §10.4: non-literal query option factories can hide executable Postgres loader work.
  // When ts-morph cannot resolve the object to a static declaration, keep the surface visible as
  // FW406 instead of accepting a typed-but-invisible query body.
  return { unresolved: true };
}

function queryBodyObjectLiteralFromDeclaration(
  declaration: Node,
  seen: Set<string>,
  mode: 'project' | 'source',
): QueryBodyObjectResolution | undefined {
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? queryBodyObjectLiteralFromNode(initializer, seen, mode) : undefined;
  }

  if (Node.isPropertyDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? queryBodyObjectLiteralFromNode(initializer, seen, mode) : undefined;
  }

  if (Node.isGetAccessorDeclaration(declaration)) {
    const expression = singleReturnExpression(declaration);
    return expression ? queryBodyObjectLiteralFromNode(expression, seen, mode) : undefined;
  }

  if (Node.isPropertyAssignment(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? queryBodyObjectLiteralFromNode(initializer, seen, mode) : undefined;
  }

  if (Node.isShorthandPropertyAssignment(declaration)) {
    return queryBodyObjectLiteralFromNode(declaration.getNameNode(), seen, mode);
  }

  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isVariableDeclaration(parent) && parent.getNameNode() === declaration) {
      const initializer = parent.getInitializer();
      return initializer ? queryBodyObjectLiteralFromNode(initializer, seen, mode) : undefined;
    }
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === declaration) {
      const initializer = parent.getInitializer();
      return initializer ? queryBodyObjectLiteralFromNode(initializer, seen, mode) : undefined;
    }
    if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === declaration) {
      return queryBodyObjectLiteralFromNode(parent.getNameNode(), seen, mode);
    }
  }

  return undefined;
}

type QueryLoadSpreadResolution =
  | { kind: 'found'; callbacks: Node[]; unresolved: boolean }
  | { kind: 'none' }
  | { kind: 'unresolved' };

function queryLoadCallbackResolution(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source' = 'source',
): QueryLoadCallbackResolution {
  let callbacks: Node[] = [];
  let unresolvedNode: Node | undefined;

  for (const property of body.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const resolution = queryLoadCallbackFromSpread(property, mode);
      if (resolution.kind === 'found') {
        callbacks = resolution.callbacks;
        unresolvedNode = resolution.unresolved ? property : undefined;
      } else if (resolution.kind === 'unresolved') {
        callbacks = [];
        unresolvedNode = property;
      }
      continue;
    }

    if (!queryCallbackPropertyIsLoad(property)) {
      if (queryCallbackPropertyMayHideLoad(property, mode)) {
        callbacks = [];
        unresolvedNode = property;
      }
      continue;
    }
    const propertyResolution = queryCallbackPropertyResolution(property, mode);
    if (propertyResolution.kind === 'found') {
      callbacks = propertyResolution.callbacks;
      unresolvedNode = propertyResolution.unresolved ? property : undefined;
    } else if (propertyResolution.kind === 'unresolved') {
      callbacks = [];
      unresolvedNode = property;
    } else {
      callbacks = [];
      unresolvedNode = undefined;
    }
  }

  return {
    callbacks,
    unresolvedNodes: unresolvedNode ? [unresolvedNode] : [],
  };
}

function queryLoadCallbackFromSpread(
  property: Node,
  mode: 'project' | 'source',
): QueryLoadSpreadResolution {
  if (!Node.isSpreadAssignment(property)) return { kind: 'none' };
  if (mode === 'source') return { kind: 'unresolved' };

  return queryLoadCallbackFromSpreadExpression(
    unwrappedStaticExpressionNode(property.getExpression()),
    property,
    mode,
  );
}

function queryLoadCallbackFromSpreadExpression(
  expression: Node,
  location: Node,
  mode: 'project' | 'source',
): QueryLoadSpreadResolution {
  if (Node.isConditionalExpression(expression)) {
    // SPEC §10.2/§11.1: conditional option spreads are executable loader surfaces. Static
    // branches contribute exact callbacks; opaque branches remain FW406 instead of disappearing.
    const branches = [expression.getWhenTrue(), expression.getWhenFalse()].map((branch) =>
      queryLoadCallbackFromSpreadExpression(unwrappedStaticExpressionNode(branch), location, mode),
    );
    const callbacks = branches.flatMap((branch) =>
      branch.kind === 'found' ? branch.callbacks : [],
    );
    const unresolved = branches.some((branch) => branch.kind === 'unresolved');
    if (callbacks.length > 0) return { kind: 'found', callbacks, unresolved };
    return unresolved ? { kind: 'unresolved' } : { kind: 'none' };
  }

  if (Node.isObjectLiteralExpression(expression)) {
    const resolution = queryLoadCallbackResolution(expression, mode);
    if (resolution.callbacks.length > 0) {
      return {
        kind: 'found',
        callbacks: resolution.callbacks,
        unresolved: resolution.unresolvedNodes.length > 0,
      };
    }
    return resolution.unresolvedNodes.length > 0 ? { kind: 'unresolved' } : { kind: 'none' };
  }

  const literalReference = staticLiteralReferenceFromExpression(expression);
  if (literalReference && literalReference !== expression) {
    return queryLoadCallbackFromSpreadExpression(
      unwrappedStaticExpressionNode(literalReference),
      location,
      mode,
    );
  }

  const loadSymbol = symbolForStaticTypePath(expression, ['load'], location);
  if (!loadSymbol) {
    const type = expression.getType();
    return type.isAny() || type.isUnknown() || typeHasOpaqueStringMembers(type)
      ? { kind: 'unresolved' }
      : { kind: 'none' };
  }

  for (const declaration of loadSymbol.getDeclarations()) {
    const callback = callbackFunctionFromDeclaration(declaration);
    if (callback) return { kind: 'found', callbacks: [callback], unresolved: false };
  }

  return { kind: 'unresolved' };
}

function queryCallbackPropertyIsLoad(node: Node): boolean {
  if (
    !Node.isGetAccessorDeclaration(node) &&
    !Node.isMethodDeclaration(node) &&
    !Node.isPropertyAssignment(node) &&
    !Node.isShorthandPropertyAssignment(node)
  ) {
    return false;
  }
  return propertyNameText(node.getNameNode(), true) === 'load';
}

function queryCallbackPropertyMayHideLoad(node: Node, mode: 'project' | 'source'): boolean {
  if (
    !Node.isGetAccessorDeclaration(node) &&
    !Node.isMethodDeclaration(node) &&
    !Node.isPropertyAssignment(node) &&
    !Node.isShorthandPropertyAssignment(node)
  ) {
    return false;
  }
  const name = node.getNameNode();
  if (!computedPropertyNameExpression(name) || propertyNameText(name, true)) return false;

  if (Node.isMethodDeclaration(node)) return true;
  if (Node.isGetAccessorDeclaration(node)) return true;
  if (Node.isShorthandPropertyAssignment(node)) return true;

  const initializer = node.getInitializer();
  if (!initializer) return false;
  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return true;
  if (mode === 'source') return true;

  return referencedQueryCallbackFunction(expression) !== undefined;
}

function queryCallbackPropertyResolution(
  node: Node,
  mode: 'project' | 'source',
): QueryLoadSpreadResolution {
  if (!queryCallbackPropertyIsLoad(node)) return { kind: 'none' };

  if (Node.isMethodDeclaration(node)) {
    return { kind: 'found', callbacks: [node], unresolved: false };
  }

  if (Node.isGetAccessorDeclaration(node)) {
    if (mode === 'source') return { kind: 'unresolved' };
    // SPEC §10.2/§11.1: accessor query options are executable loader surfaces; project
    // extraction must prove the returned callback instead of dropping the member.
    const callback = callbackFunctionFromGetAccessorDeclaration(node, new Set());
    return callback
      ? { kind: 'found', callbacks: [callback], unresolved: false }
      : { kind: 'unresolved' };
  }

  if (Node.isShorthandPropertyAssignment(node)) {
    if (mode === 'source') return { kind: 'unresolved' };
    const callback = referencedQueryCallbackFunction(node.getNameNode());
    return callback
      ? { kind: 'found', callbacks: [callback], unresolved: false }
      : { kind: 'unresolved' };
  }

  if (!Node.isPropertyAssignment(node)) return { kind: 'none' };

  const initializer = node.getInitializer();
  if (!initializer) return { kind: 'unresolved' };
  return queryCallbackExpressionResolution(unwrappedStaticExpressionNode(initializer), mode);
}

function queryCallbackExpressionResolution(
  expression: Node,
  mode: 'project' | 'source',
): QueryLoadSpreadResolution {
  if (Node.isConditionalExpression(expression)) {
    // SPEC §10.2/§11.1: direct conditional loader members are executable surfaces. Static
    // branches contribute exact callbacks; opaque branches stay visible as FW406.
    const branches = [expression.getWhenTrue(), expression.getWhenFalse()].map((branch) =>
      queryCallbackExpressionResolution(unwrappedStaticExpressionNode(branch), mode),
    );
    const callbacks = branches.flatMap((branch) =>
      branch.kind === 'found' ? branch.callbacks : [],
    );
    const unresolved = branches.some((branch) => branch.kind === 'unresolved');
    if (callbacks.length > 0) return { kind: 'found', callbacks, unresolved };
    return unresolved ? { kind: 'unresolved' } : { kind: 'none' };
  }

  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) {
    return { kind: 'found', callbacks: [expression], unresolved: false };
  }

  if (mode === 'source') return { kind: 'unresolved' };

  const literalReference = staticLiteralReferenceFromExpression(expression);
  if (literalReference && literalReference !== expression) {
    return queryCallbackExpressionResolution(unwrappedStaticExpressionNode(literalReference), mode);
  }

  const callback = referencedQueryCallbackFunction(expression);
  return callback
    ? { kind: 'found', callbacks: [callback], unresolved: false }
    : { kind: 'unresolved' };
}

function unresolvedQueryCallbackDiagnostics(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source',
): TouchGraphDiagnostic[] {
  const diagnostics: TouchGraphDiagnostic[] = [];
  const unresolvedNodes = queryLoadCallbackResolution(body, mode).unresolvedNodes;

  for (let index = 0; index < unresolvedNodes.length; index++) {
    diagnostics.push(unresolvedQueryLoadCallbackDiagnostic());
  }

  return diagnostics;
}

function unresolvedQueryLoadCallbackDiagnostic(): TouchGraphDiagnostic {
  return {
    code: 'FW406',
    message: `${diagnosticDefinitions.FW406.message} Query load callback could not be statically resolved.`,
    severity: diagnosticDefinitions.FW406.severity,
    site: '',
  };
}

function referencedQueryCallbackFunction(identifier: Node): Node | undefined {
  return callbackFunctionFromReference(identifier, new Set());
}

function callbackFunctionFromDeclaration(
  declaration: Node,
  seen: Set<string> = new Set(),
): Node | undefined {
  const key = `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  if (Node.isFunctionDeclaration(declaration) && declaration.getNameNode()) return declaration;
  if (Node.isMethodDeclaration(declaration)) return declaration;
  if (Node.isVariableDeclaration(declaration))
    return callbackFunctionFromVariable(declaration, seen);
  if (Node.isPropertyDeclaration(declaration))
    return callbackFunctionFromPropertyDeclaration(declaration, seen);
  if (Node.isGetAccessorDeclaration(declaration))
    return callbackFunctionFromGetAccessorDeclaration(declaration, seen);
  if (Node.isBindingElement(declaration))
    return callbackFunctionFromBindingElement(declaration, seen);
  if (Node.isPropertyAssignment(declaration))
    return callbackFunctionFromProperty(declaration, seen);
  if (Node.isShorthandPropertyAssignment(declaration)) {
    return callbackFunctionFromReference(declaration.getNameNode(), seen);
  }

  if (!Node.isIdentifier(declaration)) return undefined;

  const parent = declaration.getParent();
  if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === declaration) return parent;
  if (Node.isMethodDeclaration(parent) && parent.getNameNode() === declaration) return parent;
  if (Node.isBindingElement(parent) && parent.getNameNode() === declaration) {
    return callbackFunctionFromBindingElement(parent, seen);
  }
  if (Node.isVariableDeclaration(parent) && parent.getNameNode() === declaration) {
    return callbackFunctionFromVariable(parent, seen);
  }
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === declaration) {
    return callbackFunctionFromProperty(parent, seen);
  }
  if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === declaration) {
    return callbackFunctionFromReference(parent.getNameNode(), seen);
  }

  return undefined;
}

function callbackFunctionFromVariable(
  declaration: ReturnType<SourceFile['getVariableDeclarations']>[number],
  seen: Set<string>,
): Node | undefined {
  const initializer = declaration.getInitializer();
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return expression;
  return callbackFunctionFromReference(expression, seen);
}

function callbackFunctionFromPropertyDeclaration(
  declaration: Node,
  seen: Set<string>,
): Node | undefined {
  if (!Node.isPropertyDeclaration(declaration)) return undefined;

  const initializer = declaration.getInitializer();
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return expression;
  return callbackFunctionFromReference(expression, seen);
}

function callbackFunctionFromGetAccessorDeclaration(
  declaration: Node,
  seen: Set<string>,
): Node | undefined {
  if (!Node.isGetAccessorDeclaration(declaration)) return undefined;

  const expression = singleReturnExpression(declaration);
  if (!expression) return undefined;

  const returned = unwrappedStaticExpressionNode(expression);
  if (Node.isArrowFunction(returned) || Node.isFunctionExpression(returned)) return returned;
  return callbackFunctionFromReference(returned, seen);
}

function callbackFunctionFromBindingElement(
  declaration: BindingElement,
  seen: Set<string>,
): Node | undefined {
  const binding = staticBindingElementReference(declaration);
  if (!binding) return undefined;

  const { initializer, literalReference, path } = binding;
  if (literalReference) {
    if (Node.isArrowFunction(literalReference) || Node.isFunctionExpression(literalReference)) {
      return literalReference;
    }
    const callback = callbackFunctionFromReference(literalReference, seen);
    if (callback) return callback;
  }

  const symbol = symbolForStaticTypePath(
    unwrappedStaticExpressionNode(initializer),
    path,
    declaration,
  );
  for (const referencedDeclaration of symbol?.getDeclarations() ?? []) {
    const callback = callbackFunctionFromDeclaration(referencedDeclaration, seen);
    if (callback) return callback;
  }

  return undefined;
}

function staticBindingElementReference(
  declaration: BindingElement,
): { initializer: Node; literalReference?: Node; path: string[] } | undefined {
  if (isRestBindingElement(declaration)) return undefined;

  const initializer = declaration
    .getFirstAncestorByKind(SyntaxKind.VariableDeclaration)
    ?.getInitializer();
  if (!initializer) return undefined;

  const path = bindingElementStaticPath(declaration);
  if (path.length === 0) return undefined;

  const container = staticLiteralContainerExpression(unwrappedStaticExpressionNode(initializer));
  const literalReference = container
    ? callbackReferenceFromStaticLiteralPath(container, path)
    : undefined;
  return literalReference ? { initializer, literalReference, path } : { initializer, path };
}

function bindingElementStaticPath(declaration: BindingElement): string[] {
  const path: string[] = [];
  let current: Node | undefined = declaration;

  while (current && Node.isBindingElement(current)) {
    if (isRestBindingElement(current)) return [];

    const parent = current.getParent();
    if (Node.isObjectBindingPattern(parent)) {
      const property = current.getPropertyNameNode();
      const name = current.getNameNode();
      const segment = property
        ? propertyNameText(property)
        : Node.isIdentifier(name)
          ? name.getText()
          : undefined;
      if (!segment) return [];

      path.unshift(segment);
      const owner = parent.getParent();
      current = Node.isBindingElement(owner) ? owner : undefined;
      continue;
    }

    if (!Node.isArrayBindingPattern(parent)) return [];
    const index = parent.getElements().indexOf(current);
    if (index < 0) return [];

    // SPEC §10.2/§11.1: tuple-destructured callback aliases are resolved from ts-morph
    // property facts, not source-name compatibility guesses.
    path.unshift(String(index));
    const owner = parent.getParent();
    current = Node.isBindingElement(owner) ? owner : undefined;
  }

  return path;
}

function callbackReferenceFromStaticLiteralPath(
  root: Node,
  path: readonly string[],
): Node | undefined {
  let current: Node | undefined = root;

  for (const segment of path) {
    if (!current) return undefined;
    const expression = unwrappedStaticExpressionNode(current);

    if (Node.isArrayLiteralExpression(expression)) {
      current = expression.getElements()[Number(segment)];
      continue;
    }

    if (Node.isObjectLiteralExpression(expression)) {
      current = objectLiteralStaticPropertyReference(expression, segment);
      continue;
    }

    return undefined;
  }

  return current ? unwrappedStaticExpressionNode(current) : undefined;
}

function staticLiteralContainerExpression(
  node: Node,
  seen: Set<string> = new Set(),
): Node | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isArrayLiteralExpression(expression) || Node.isObjectLiteralExpression(expression)) {
    return expression;
  }

  const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  for (const declaration of symbolForCallbackReference(expression)?.getDeclarations() ?? []) {
    const initializer = staticLiteralContainerInitializer(declaration);
    if (!initializer) continue;

    const container = staticLiteralContainerExpression(initializer, seen);
    if (container) return container;
  }

  return undefined;
}

function staticLiteralReferenceFromExpression(
  node: Node,
  seen: Set<string> = new Set(),
): Node | undefined {
  const access = staticAccessSegments(node);
  if (!access || access.path.length === 0) return undefined;

  const container = staticLiteralContainerExpression(access.root, seen);
  const literalReference = container
    ? callbackReferenceFromStaticLiteralPath(container, access.path)
    : undefined;
  if (literalReference) return literalReference;

  const symbol = symbolForStaticTypePath(access.root, access.path, node);
  for (const declaration of symbol?.getDeclarations() ?? []) {
    const initializer = staticLiteralContainerInitializer(declaration);
    if (initializer) return initializer;
  }

  return undefined;
}

function staticAccessSegments(node: Node): { path: string[]; root: Node } | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isIdentifier(expression) || Node.isThisExpression(expression)) {
    return { path: [], root: expression };
  }
  if (!Node.isPropertyAccessExpression(expression) && !Node.isElementAccessExpression(expression)) {
    return undefined;
  }

  const owner = staticAccessSegments(expression.getExpression());
  const member = staticAccessName(expression);
  if (!owner || !member) return undefined;

  return { path: [...owner.path, member], root: owner.root };
}

function staticLiteralContainerInitializer(declaration: Node): Node | undefined {
  if (
    Node.isVariableDeclaration(declaration) ||
    Node.isPropertyAssignment(declaration) ||
    Node.isPropertyDeclaration(declaration)
  ) {
    return declaration.getInitializer();
  }
  if (Node.isGetAccessorDeclaration(declaration)) return singleReturnExpression(declaration);
  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (
      (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) &&
      parent.getNameNode() === declaration
    ) {
      return parent.getInitializer();
    }
  }
  return undefined;
}

function staticObjectFactoryReturnExpression(node: Node, seen: Set<string>): Node | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isCallExpression(expression)) return undefined;
  if (expression.getArguments().length > 0) return undefined;

  const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}:factory`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  for (const declaration of symbolForCallbackReference(
    expression.getExpression(),
  )?.getDeclarations() ?? []) {
    const callback = callbackFunctionFromDeclaration(declaration, seen);
    if (!callback || !factoryHasNoParameters(callback)) continue;

    const returned = functionLikeStaticReturnExpression(callback);
    if (returned) return returned;
  }

  return undefined;
}

function factoryHasNoParameters(callback: Node): boolean {
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback) &&
    !Node.isMethodDeclaration(callback)
  ) {
    return false;
  }

  return callback.getParameters().length === 0;
}

function functionLikeStaticReturnExpression(callback: Node): Node | undefined {
  if (Node.isArrowFunction(callback)) {
    if (callback.getParameters().length > 0) return undefined;
    const body = callback.getBody();
    return Node.isBlock(body) ? staticFactoryBlockReturnExpression(body) : body;
  }

  if (
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback) &&
    !Node.isMethodDeclaration(callback)
  ) {
    return undefined;
  }
  if (callback.getParameters().length > 0) return undefined;

  const body = callback.getBody();
  return body && Node.isBlock(body) ? staticFactoryBlockReturnExpression(body) : undefined;
}

function staticFactoryBlockReturnExpression(body: Node): Node | undefined {
  if (!Node.isBlock(body)) return undefined;

  const statements = body.getStatements();
  if (statements.length === 0) return undefined;

  for (const statement of statements.slice(0, -1)) {
    if (!Node.isVariableStatement(statement)) return undefined;
  }

  const statement = statements[statements.length - 1];
  if (!statement || !Node.isReturnStatement(statement)) return undefined;

  return statement.getExpression();
}

function objectLiteralStaticPropertyReference(
  object: ObjectLiteralExpression,
  name: string,
): Node | undefined {
  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      continue;
    }
    if (propertyNameText(property.getNameNode(), true) !== name) continue;
    if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
    return property.getInitializer();
  }

  return undefined;
}

function symbolForStaticTypePath(
  root: Node,
  path: readonly string[],
  location: Node,
): MorphSymbol | undefined {
  let type = root.getType();
  let symbol: MorphSymbol | undefined;

  for (const member of path) {
    symbol = type.getProperty(member);
    if (!symbol) return undefined;
    type = symbol.getTypeAtLocation(location);
  }

  return aliasedSymbol(symbol);
}

function callbackFunctionFromProperty(declaration: Node, seen: Set<string>): Node | undefined {
  if (!Node.isPropertyAssignment(declaration)) return undefined;

  const initializer = declaration.getInitializer();
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return expression;
  return callbackFunctionFromReference(expression, seen);
}

function callbackFunctionFromReference(identifier: Node, seen: Set<string>): Node | undefined {
  const boundTarget = boundCallbackTarget(identifier);
  if (boundTarget) {
    const target = unwrappedStaticExpressionNode(boundTarget);
    if (Node.isArrowFunction(target) || Node.isFunctionExpression(target)) return target;
    return callbackFunctionFromReference(target, seen);
  }

  const symbol = symbolForCallbackReference(identifier);
  for (const declaration of symbol?.getDeclarations() ?? []) {
    const callback = callbackFunctionFromDeclaration(declaration, seen);
    if (callback) return callback;
  }

  return undefined;
}

function symbolForCallbackReference(node: Node): MorphSymbol | undefined {
  if (Node.isIdentifier(node)) return aliasedSymbol(symbolForIdentifierReference(node));
  if (Node.isPropertyAccessExpression(node)) {
    return aliasedSymbol(symbolForStaticMemberReference(node) ?? node.getNameNode().getSymbol());
  }
  if (Node.isElementAccessExpression(node)) {
    return aliasedSymbol(symbolForStaticMemberReference(node) ?? node.getSymbol());
  }
  return undefined;
}

function boundCallbackTarget(node: Node): Node | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isCallExpression(expression)) return undefined;

  const callee = expression.getExpression();
  if (!Node.isPropertyAccessExpression(callee) && !Node.isElementAccessExpression(callee)) {
    return undefined;
  }
  if (staticAccessName(callee) !== 'bind') return undefined;

  // `fn.bind(thisArg)` preserves the callback parameter list, while additional bound arguments
  // shift loader/write parameters and must remain FW406 instead of fabricating Drizzle facts.
  if (expression.getArguments().length > 1) return undefined;
  return callee.getExpression();
}

function symbolForStaticMemberReference(node: Node): MorphSymbol | undefined {
  // SPEC §10.2/§11.1: static callback containers are resolved from ts-morph member facts before
  // local object compatibility walking, so namespace imports and re-export barrels remain exact.
  const member = staticAccessName(node);
  const receiver = staticAccessExpression(node);
  if (!member || !receiver) return undefined;

  return receiver.getType().getProperty(member);
}

function aliasedSymbol(symbol: MorphSymbol | undefined): MorphSymbol | undefined {
  return symbol?.getAliasedSymbol() ?? symbol;
}

function queryHelperReceiverArgumentName(
  call: CallExpression,
  receiverReferences: QueryReceiverReferences,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
  carrierReferences?: SourceReceiverAliasReferences,
): string | undefined {
  for (const argument of call.getArguments()) {
    const receiverName = queryHelperArgumentReceiverName(
      argument,
      receiverReferences,
      carrierSymbolKeys,
      carrierReferences,
    );
    if (receiverName) return receiverName;
  }

  return undefined;
}

function queryHelperArgumentReceiverName(
  argument: Node,
  receiverReferences: QueryReceiverReferences,
  carrierSymbolKeys: ReadonlySet<string>,
  carrierReferences?: SourceReceiverAliasReferences,
): string | undefined {
  const receiver = queryReceiverReferenceInArgument(
    argument,
    receiverReferences,
    carrierSymbolKeys,
    carrierReferences,
  );
  return receiver ? receiver.getText() : undefined;
}

function queryReceiverAliasReferencesForCall(
  body: ObjectLiteralExpression,
  call: CallExpression,
  receiverReferences: QueryReceiverReferences,
): SourceReceiverAliasReferences | undefined {
  const callbackBody = queryCallbackBodyForNode(body, call, queryReceiverMode(receiverReferences));
  return callbackBody
    ? sourceReceiverAliasReferencesForBody(callbackBody, (node) =>
        isQueryReceiverIdentifier(node, receiverReferences),
      )
    : undefined;
}

function queryCallbackBodyForNode(
  body: ObjectLiteralExpression,
  node: Node,
  mode: 'project' | 'source',
): Node | undefined {
  for (const callbackBody of queryCallbackBodies(body, mode)) {
    if (node === callbackBody || node.getAncestors().includes(callbackBody)) {
      return callbackBody;
    }
  }

  return undefined;
}

function appendUntypedQueryReceiverBinding(
  name: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (Node.isIdentifier(name)) {
    appendQueryReceiverIdentifierBinding(name, names, symbolKeys);
    return;
  }

  // SPEC §11.1: source-mode destructured `db`/`tx` slots are not type proof. They stay visible
  // as FW406 surfaces via sourceDestructuredQueryReceiverDiagnostics instead of fabricating reads.
}

function sourceQueryDestructuredReceiverNames(
  body: ObjectLiteralExpression,
): QueryReceiverReferences {
  const names = new Set<string>();
  const symbolKeys = new Set<string>();

  for (const callback of queryLoadCallbackFunctions(body)) {
    const receiverParameter = queryCallbackParameterNodes(callback)[1];
    const receiver = receiverParameter?.getNameNode();
    if (receiver) appendSourceDestructuredReceiverBinding(receiver, names, symbolKeys);
  }

  return { names, symbolKeys };
}

function appendQueryReceiverIdentifierBinding(
  name: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (!Node.isIdentifier(name)) return;
  names.add(name.getText());
  const symbolKey = resolvedSymbolKey(name.getSymbol());
  if (symbolKey) symbolKeys.add(symbolKey);
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

    const valueNode = unwrappedTsExpression(property.initializer);
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
  mode: 'project' | 'source' = 'source',
): ReadonlySet<string> {
  const tables = new Set<string>();
  const relationTables: string[] = [];

  for (const { operation, table } of queryBodyCallExpressions(body, mode, (call) => {
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
  const node = unwrappedTsExpression(expression);
  if (ts.isTaggedTemplateExpression(node)) return staticTsExpressionPath(node.tag) === 'sql';
  if (!ts.isCallExpression(node)) return false;

  const callee = staticTsExpressionPath(node.expression);
  return callee === 'sql' || callee === 'raw' || callee?.startsWith('sql.') === true;
}

function typedSqlProjectionShape(expression: ts.Expression): QueryShape | null {
  const node = unwrappedTsExpression(expression);
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

function staticTsExpressionPath(expression: ts.Expression): string | undefined {
  const node = unwrappedTsExpression(expression);
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

  const node = unwrappedTsExpression(expression);
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
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    const name = propertyAccessCallName(call);
    if (!name || !isQueryReadCallName(name)) return [];
    if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

    const tableArgument = call.getArguments()[0];
    const table = readTableIdentifier
      ? tableArgument
        ? readTableIdentifier(tableArgument)
        : undefined
      : staticExpressionPath(tableArgument);
    return table ? [table] : [];
  });
}

function queryRelationalTableExpressions(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  relationalTableName?: (name: string) => string | undefined,
): string[] {
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
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
  const diagnostics: TouchGraphDiagnostic[] = queryBodyCallExpressions(
    body,
    queryReceiverMode(receiverReferences),
    (call) => {
      const name = propertyAccessCallName(call);
      if (!name || !isQueryReadCallName(name)) return [];
      if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

      const tableArgument = call.getArguments()[0];
      const table = options.readTableIdentifier
        ? tableArgument
          ? options.readTableIdentifier(tableArgument)
          : undefined
        : staticExpressionPath(tableArgument);
      if (table) return [];

      return [
        {
          code: 'FW406' as const,
          message: `${diagnosticDefinitions.FW406.message} Query read source for db.${name}() could not be resolved to a Drizzle table.`,
          severity: diagnosticDefinitions.FW406.severity,
          site: '',
        },
      ];
    },
  );

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
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
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
  mode: 'project' | 'source',
  extract: (call: CallExpression) => readonly T[],
): T[] {
  // SPEC §10-§11: query facts come from executable query-loader callback surfaces; nested helper
  // bodies are summarized only when called instead of fabricating reads from declarations.
  return queryCallbackBodies(body, mode)
    .flatMap((callbackBody) => touchBodyCallExpressions(callbackBody))
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right))
    .flatMap(extract);
}

function queryReceiverMode(receiverReferences: QueryReceiverReferences): 'project' | 'source' {
  return receiverReferences.projectContainers ? 'project' : 'source';
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

function staticExpressionRootIdentifier(node: Node): Node | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isIdentifier(expression)) return expression;
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    return staticExpressionRootIdentifier(expression.getExpression());
  }
  if (Node.isCallExpression(expression)) {
    return staticExpressionRootIdentifier(expression.getExpression());
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

function unwrappedFunctionExpression(node: Node): ArrowFunction | FunctionExpression | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  return Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)
    ? expression
    : undefined;
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
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
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

    appendReadSourceSummaries(reads, unresolved, call, site, tables, unresolvedIdentifiers);

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

function appendReadSourceSummaries(
  reads: ReadSummaryInput[],
  unresolved: UnresolvedSummaryInput[],
  call: ExtractedWriteCall,
  site: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  unresolvedIdentifiers: ReadonlySet<string>,
): void {
  // SPEC §11.1: insert-select/update-from reads are independently visible even when the write
  // target itself is opaque and must degrade to FW406.
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
    appendProjectGlobalSyntheticTables(tables, tablesBySyntheticName, extraction);
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
      if (!initializer || !isProjectAnnotatedTableInitializerNode(initializer)) continue;

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
          extraction.columnShapesByTable.get(syntheticName) ??
          tableColumnShapes(initializer, 'project'),
        exported: variableDeclarationIsExported(declaration),
      });
    }
  }

  for (const [syntheticName, targets] of extraction.conditionalTableTargetsBySyntheticName) {
    const branchTables = targets.flatMap((target) => {
      const table = tables.get(target);
      return table ? [table] : [];
    });
    if (branchTables.length === 0) continue;

    const [firstTable] = branchTables;
    if (!firstTable) continue;
    tables.set(syntheticName, {
      annotation: firstTable.annotation,
      columns: firstTable.columns,
      exported: false,
    });
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

  for (const [syntheticName, targets] of extraction.conditionalTableTargetsBySyntheticName) {
    const branchTables = targets.flatMap((target) => {
      const table = tablesBySyntheticName.get(target);
      return table ? [table] : [];
    });
    if (branchTables.length > 0) appendTableEntries(tables, syntheticName, branchTables);
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

function appendProjectGlobalSyntheticTables(
  tables: Map<string, ExtractedTable[]>,
  tablesBySyntheticName: ReadonlyMap<string, ExtractedTable>,
  extraction: ProjectExtraction,
): void {
  // SPEC §10-§11: project-mode table expressions use ts-morph synthetic symbol names, which stay
  // valid when an imported query/domain callback is summarized from the importing module.
  for (const [syntheticName, table] of tablesBySyntheticName) {
    appendTableEntries(tables, syntheticName, [table]);
  }
  for (const [syntheticName, targets] of extraction.conditionalTableTargetsBySyntheticName) {
    const branchTables = targets.flatMap((target) => {
      const table = tablesBySyntheticName.get(target);
      return table ? [table] : [];
    });
    if (branchTables.length > 0) appendTableEntries(tables, syntheticName, branchTables);
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
  if (ts.isTypeAssertionExpression(expression)) return unwrappedTsExpression(expression.expression);
  if (ts.isNonNullExpression(expression)) return unwrappedTsExpression(expression.expression);
  return expression;
}

function extractFunctions(file: SourceFileInput): ExtractedFunction[] {
  return withParsedSourceFile(file, (sourceFile) => {
    const functions = [
      ...extractFunctionDeclarations(sourceFile),
      ...extractVariableAssignedFunctions(sourceFile),
      ...extractObjectLiteralCallbackFunctions(sourceFile),
      ...extractDomainWriteCallbacks(sourceFile),
    ];
    const localFunctionKeys = new Set(functions.map((fn) => fn.key));
    const functionsByKey = new Map(functions.map((fn) => [fn.key, fn]));

    return functions.map((fn): ExtractedFunction => {
      const receiverNames = new Set(fn.receiverNames ?? sourceDrizzleReceiverNames(fn.callback));
      const ambiguousReceiverReferences = sourceDestructuredReceiverReferences(fn.callback);
      const { bodyNode, callback: _callback, ...extracted } = fn;
      const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(bodyNode, (node) =>
        isSourceDrizzleReceiverIdentifier(node, receiverNames),
      );

      return {
        ...extracted,
        localCalls: extractLocalFunctionCallsFromBody(
          bodyNode,
          localFunctionKeys,
          functionsByKey,
          (argument) => isSourceDrizzleReceiverIdentifier(argument, receiverNames),
        ).concat(
          extractTransactionCallbackLocalFunctionCallsFromBody(
            bodyNode,
            localFunctionKeys,
            functionsByKey,
            (node) => isSourceDrizzleReceiverIdentifier(node, receiverNames),
          ),
        ),
        readCalls: [
          ...extractSelectReadCallsFromBody(bodyNode, receiverNames),
          ...extractRelationalReadCallsFromBody(bodyNode, receiverNames),
        ],
        receiverNames: [...receiverNames],
        unresolvedCalls: [
          ...extractExternalDbArgumentCallsFromBody(
            bodyNode,
            receiverNames,
            localFunctionKeys,
            carrierSymbolKeys,
          ),
          ...extractSourceParameterReceiverMemberSurfaceCallsFromBody(
            bodyNode,
            localFunctionKeys,
            fn.callback,
          ),
          ...extractOpaqueLocalHelperReceiverCallsFromBody(
            bodyNode,
            localFunctionKeys,
            functionsByKey,
            (argument) => isSourceDrizzleReceiverIdentifier(argument, receiverNames),
            (argument) =>
              sourceReceiverReferenceInArgument(argument, receiverNames, carrierSymbolKeys),
          ),
          ...extractReceiverMethodAliasCallsFromBody(bodyNode, (node) =>
            isSourceDrizzleReceiverIdentifier(node, receiverNames),
          ),
          ...extractUnresolvedTransactionCallbackCallsFromBody(
            bodyNode,
            localFunctionKeys,
            functionsByKey,
            (node) => isSourceDrizzleReceiverIdentifier(node, receiverNames),
          ),
          ...extractUnclassifiedDrizzleReceiverCallsFromBody(bodyNode, receiverNames),
          ...extractAmbientSourceReceiverCallsFromBody(bodyNode, localFunctionKeys),
          ...extractSourceReceiverAliasSurfaceCallsFromBody(bodyNode, localFunctionKeys, (node) =>
            isSourceDrizzleReceiverIdentifier(node, receiverNames),
          ),
          ...extractSourceReceiverSurfaceCallsFromBody(bodyNode, localFunctionKeys, (node) =>
            isSourceDestructuredReceiverIdentifier(node, ambiguousReceiverReferences),
          ),
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
    ...extractObjectLiteralCallbackFunctions(sourceFile),
  ];
  return new Set(functions.map((fn) => fn.key));
}

function localFunctionReceiverParametersFromSourceFile(
  sourceFile: SourceFile,
): ReadonlyMap<string, readonly ReceiverParameterRequirement[]> {
  return functionReceiverParametersByKey([
    ...extractFunctionDeclarations(sourceFile),
    ...extractVariableAssignedFunctions(sourceFile),
    ...extractObjectLiteralCallbackFunctions(sourceFile),
  ]);
}

function functionReceiverParametersByKey(
  functions: Iterable<Pick<ExtractedFunction, 'key' | 'receiverParameters'>>,
): ReadonlyMap<string, readonly ReceiverParameterRequirement[]> {
  return new Map([...functions].map((fn) => [fn.key, fn.receiverParameters]));
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
    const callback = unwrappedFunctionExpression(initializer);
    if (!callback) continue;

    functions.push(extractedFunctionFromCallback(name.getText(), callback, name));
  }

  return functions;
}

function extractObjectLiteralCallbackFunctions(sourceFile: SourceFile): ParsedExtractedFunction[] {
  const functions: ParsedExtractedFunction[] = [];

  for (const object of sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const property of object.getProperties()) {
      if (Node.isMethodDeclaration(property)) {
        const name = propertyNameText(property.getNameNode());
        if (!name) continue;

        functions.push(
          extractedFunctionFromCallback(name, property, property.getNameNode(), {
            summaryOnly: true,
          }),
        );
        continue;
      }

      if (!Node.isPropertyAssignment(property)) continue;
      const name = propertyNameText(property.getNameNode());
      const initializer = property.getInitializer();
      if (!name || !initializer) continue;

      const expression = unwrappedStaticExpressionNode(initializer);
      if (!Node.isArrowFunction(expression) && !Node.isFunctionExpression(expression)) continue;

      functions.push(
        extractedFunctionFromCallback(name, expression, property.getNameNode(), {
          summaryOnly: true,
        }),
      );
    }
  }

  return functions;
}

function extractDomainWriteCallbacks(sourceFile: SourceFile): ParsedExtractedFunction[] {
  const callbacks: ParsedExtractedFunction[] = [];

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const domainName = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(domainName) || !initializer) continue;
    const domainCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(domainCall)) continue;
    const expression = domainCall.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'domain') continue;

    const domainObject = domainWriteObject(domainCall.getArguments()[0]);
    if (!domainObject.body) continue;

    for (const property of domainWriteProperties(domainObject.body)) {
      const callbackResolution = writeActionCallbackResolution(property.initializer);
      if (callbackResolution.callbacks.length === 0) continue;

      for (const callback of callbackResolution.callbacks) {
        callbacks.push(
          extractedFunctionFromCallback(
            `${domainName.getText()}.${property.memberName}`,
            callback,
            property.keyNode,
          ),
        );
      }
    }
  }

  return callbacks;
}

function unresolvedDomainWriteCallbacks(
  file: SourceFileInput,
): { mergeWithExact: boolean; name: string; site: string }[] {
  return withParsedSourceFile(file, (sourceFile) => {
    const unresolved: { mergeWithExact: boolean; name: string; site: string }[] = [];

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const domainName = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(domainName) || !initializer) continue;
      const domainCall = unwrappedStaticExpressionNode(initializer);
      if (!Node.isCallExpression(domainCall)) continue;
      const expression = domainCall.getExpression();
      if (!Node.isIdentifier(expression) || expression.getText() !== 'domain') continue;

      const domainArgument = domainCall.getArguments()[0];
      const domainObject = domainWriteObject(domainArgument);
      if (domainObject.unresolved && domainArgument) {
        unresolved.push({
          mergeWithExact: false,
          name: `${domainName.getText()}.${UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER}`,
          site: `${file.fileName}:${lineForIndex(file.source, domainArgument.getStart())}`,
        });
      }
      if (!domainObject.body) continue;

      for (const computed of unresolvedComputedDomainWriteProperties(domainObject.body)) {
        unresolved.push({
          mergeWithExact: false,
          name: `${domainName.getText()}.${UNRESOLVED_DOMAIN_WRITE_COMPUTED_MEMBER}`,
          site: `${file.fileName}:${lineForIndex(file.source, computed.siteNode.getStart())}`,
        });
      }

      for (const spread of unresolvedDomainWriteSpreads(domainObject.body)) {
        unresolved.push({
          mergeWithExact: false,
          name: `${domainName.getText()}.${spread.memberName}`,
          site: `${file.fileName}:${lineForIndex(file.source, spread.siteNode.getStart())}`,
        });
      }

      for (const property of domainWriteProperties(domainObject.body)) {
        const callbackResolution = writeActionCallbackResolution(property.initializer);
        const initializer = property.initializer
          ? unwrappedStaticExpressionNode(property.initializer)
          : undefined;
        if (
          !callbackResolution.unresolved ||
          (callbackResolution.callbacks.length > 0 && !Node.isConditionalExpression(initializer))
        ) {
          continue;
        }

        const siteNode = property.initializer ?? property.keyNode;
        const mergeWithExact =
          callbackResolution.callbacks.length > 0 && Node.isConditionalExpression(initializer);

        unresolved.push({
          mergeWithExact,
          name: `${domainName.getText()}.${property.memberName}`,
          site: `${file.fileName}:${lineForIndex(file.source, siteNode.getStart())}`,
        });
      }
    }

    return unresolved;
  });
}

interface DomainWriteObjectResolution {
  body?: ObjectLiteralExpression;
  unresolved: boolean;
}

function domainWriteObject(argument: Node | undefined): DomainWriteObjectResolution {
  if (!argument) return { unresolved: true };
  return domainWriteObjectFromNode(argument, new Set()) ?? { unresolved: true };
}

function domainWriteObjectFromNode(
  node: Node,
  seen: Set<string>,
): DomainWriteObjectResolution | undefined {
  // SPEC §10-§11: domain action objects are executable mutation surfaces; static aliases are
  // followed through ts-morph symbols, while opaque aliases stay visible as FW406.
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isObjectLiteralExpression(expression)) return { body: expression, unresolved: false };

  const factoryReturn = staticObjectFactoryReturnExpression(expression, seen);
  if (factoryReturn) {
    const body = domainWriteObjectFromNode(factoryReturn, seen);
    if (body) return body;
  }

  const literalReference = staticLiteralReferenceFromExpression(expression, seen);
  if (literalReference && literalReference !== expression) {
    const body = domainWriteObjectFromNode(literalReference, seen);
    if (body) return body;
  }

  const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
  if (seen.has(key)) return { unresolved: true };
  seen.add(key);

  for (const declaration of symbolForCallbackReference(expression)?.getDeclarations() ?? []) {
    const body = domainWriteObjectFromDeclaration(declaration, seen);
    if (body) return body;
  }

  // SPEC §10.4: a typed domain-action factory can still hide mutation callbacks from static
  // extraction. Unresolved non-literal action objects must therefore degrade to FW406.
  return { unresolved: true };
}

function domainWriteObjectFromDeclaration(
  declaration: Node,
  seen: Set<string>,
): DomainWriteObjectResolution | undefined {
  if (Node.isVariableDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
  }

  if (Node.isPropertyDeclaration(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
  }

  if (Node.isGetAccessorDeclaration(declaration)) {
    const expression = singleReturnExpression(declaration);
    return expression ? domainWriteObjectFromNode(expression, seen) : undefined;
  }

  if (Node.isPropertyAssignment(declaration)) {
    const initializer = declaration.getInitializer();
    return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
  }

  if (Node.isShorthandPropertyAssignment(declaration)) {
    return domainWriteObjectFromNode(declaration.getNameNode(), seen);
  }

  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isVariableDeclaration(parent) && parent.getNameNode() === declaration) {
      const initializer = parent.getInitializer();
      return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
    }
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === declaration) {
      const initializer = parent.getInitializer();
      return initializer ? domainWriteObjectFromNode(initializer, seen) : undefined;
    }
    if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === declaration) {
      return domainWriteObjectFromNode(parent.getNameNode(), seen);
    }
  }

  return undefined;
}

function unresolvedComputedDomainWriteProperties(
  object: ObjectLiteralExpression,
): { siteNode: Node }[] {
  const unresolved: { siteNode: Node }[] = [];

  for (const property of object.getProperties()) {
    if (
      !Node.isMethodDeclaration(property) &&
      !Node.isPropertyAssignment(property) &&
      !Node.isShorthandPropertyAssignment(property)
    ) {
      continue;
    }
    const name = property.getNameNode();
    if (!computedPropertyNameExpression(name) || propertyNameText(name, true)) continue;

    unresolved.push({ siteNode: property });
  }

  return unresolved;
}

interface UnresolvedDomainWriteSpread {
  memberName: string;
  siteNode: Node;
}

function unresolvedDomainWriteSpreads(
  object: ObjectLiteralExpression,
): UnresolvedDomainWriteSpread[] {
  const unresolved: UnresolvedDomainWriteSpread[] = [];

  for (const property of object.getProperties()) {
    if (!Node.isSpreadAssignment(property)) continue;
    // SPEC §10-§11: an opaque domain action spread can contain hidden write(...) callbacks, so it
    // must stay visible as FW406 instead of disappearing from the mutation graph.
    const expression = unwrappedStaticExpressionNode(property.getExpression());
    const spreadProperties = domainWritePropertiesFromSpread(property, new Set());
    const resolvedMembers = new Set(
      spreadProperties.map((spreadProperty) => spreadProperty.memberName),
    );
    const type = expression.getType();
    const hasUnresolvedBranch = domainWriteSpreadHasUnresolvedBranch(expression);
    if (hasUnresolvedBranch || typeHasOpaqueStringMembers(type)) {
      unresolved.push({
        memberName: UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER,
        siteNode: property,
      });
    }
    if (
      !hasUnresolvedBranch &&
      !typeHasOpaqueStringMembers(type) &&
      spreadProperties.length === 0 &&
      (type.isAny() || type.isUnknown())
    ) {
      unresolved.push({
        memberName: UNRESOLVED_DOMAIN_WRITE_SPREAD_MEMBER,
        siteNode: property,
      });
      continue;
    }

    for (const symbol of type.getProperties()) {
      const memberName = symbol.getName();
      if (resolvedMembers.has(memberName)) continue;
      const declarations = symbol.getDeclarations();
      if (
        declarations.every(
          (declaration) => !domainWritePropertyFromDeclaration(memberName, declaration, new Set()),
        )
      ) {
        unresolved.push({ memberName, siteNode: declarations[0] ?? property });
      }
    }
  }

  return unresolved;
}

function domainWriteSpreadHasUnresolvedBranch(expression: Node): boolean {
  if (!Node.isConditionalExpression(expression)) {
    const type = expression.getType();
    return type.isAny() || type.isUnknown() || typeHasOpaqueStringMembers(type);
  }

  return [expression.getWhenTrue(), expression.getWhenFalse()].some((branch) =>
    domainWriteSpreadHasUnresolvedBranch(unwrappedStaticExpressionNode(branch)),
  );
}

function typeHasOpaqueStringMembers(type: MorphType): boolean {
  // SPEC §10.2/§11.1: string-indexed objects can hide arbitrary loader/action members. Without
  // concrete property declarations, keep that surface visible as FW406 instead of assuming empty.
  return type.getStringIndexType() !== undefined;
}

function domainWriteProperties(
  object: ObjectLiteralExpression,
  seen: Set<string> = new Set(),
): DomainWriteProperty[] {
  const properties = new Map<string, DomainWriteProperty>();

  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      for (const spreadProperty of domainWritePropertiesFromSpread(property, seen)) {
        properties.set(spreadProperty.memberName, spreadProperty);
      }
      continue;
    }

    if (Node.isMethodDeclaration(property)) {
      const memberName = propertyNameText(property.getNameNode(), true);
      if (!memberName) continue;

      properties.set(memberName, {
        initializer: undefined,
        keyNode: property.getNameNode(),
        memberName,
      });
      continue;
    }

    if (Node.isShorthandPropertyAssignment(property)) {
      const memberName = propertyNameText(property.getNameNode(), true);
      if (!memberName) continue;

      properties.set(
        memberName,
        domainWritePropertyFromShorthandAssignment(property, seen) ?? {
          initializer: property.getNameNode(),
          keyNode: property.getNameNode(),
          memberName,
        },
      );
      continue;
    }

    if (!Node.isPropertyAssignment(property)) continue;
    const memberName = propertyNameText(property.getNameNode(), true);
    if (!memberName) continue;

    properties.set(memberName, {
      initializer: property.getInitializer(),
      keyNode: property.getNameNode(),
      memberName,
    });
  }

  return [...properties.values()];
}

function domainWritePropertiesFromSpread(property: Node, seen: Set<string>): DomainWriteProperty[] {
  if (!Node.isSpreadAssignment(property)) return [];

  const expression = unwrappedStaticExpressionNode(property.getExpression());
  if (Node.isConditionalExpression(expression)) {
    // SPEC §10-§11: conditional action spreads are mutation surfaces. Each static branch is
    // resolved through ts-morph symbols; unresolved branches are reported by
    // `unresolvedDomainWriteSpreads` instead of fabricated here.
    return [
      ...domainWritePropertiesFromExpression(
        unwrappedStaticExpressionNode(expression.getWhenTrue()),
        seen,
      ),
      ...domainWritePropertiesFromExpression(
        unwrappedStaticExpressionNode(expression.getWhenFalse()),
        seen,
      ),
    ];
  }

  return domainWritePropertiesFromExpression(expression, seen);
}

function domainWritePropertiesFromExpression(
  expression: Node,
  seen: Set<string>,
): DomainWriteProperty[] {
  if (Node.isObjectLiteralExpression(expression)) {
    return domainWriteProperties(expression, seen);
  }

  const literalReference = staticLiteralReferenceFromExpression(expression, seen);
  if (literalReference && literalReference !== expression) {
    return domainWritePropertiesFromExpression(
      unwrappedStaticExpressionNode(literalReference),
      seen,
    );
  }

  const key = resolvedSymbolKey(expression.getSymbol()) ?? expression.getText();
  if (seen.has(key)) return [];
  seen.add(key);

  const properties: DomainWriteProperty[] = [];
  for (const symbol of expression.getType().getProperties()) {
    const memberName = symbol.getName();
    for (const declaration of symbol.getDeclarations()) {
      const domainProperty = domainWritePropertyFromDeclaration(memberName, declaration, seen);
      if (domainProperty) {
        properties.push(domainProperty);
        break;
      }
    }
  }

  seen.delete(key);
  return properties;
}

function domainWritePropertyFromDeclaration(
  memberName: string,
  declaration: Node,
  seen: Set<string>,
): DomainWriteProperty | undefined {
  if (Node.isBindingElement(declaration)) {
    const property = domainWritePropertyFromBindingElement(memberName, declaration, seen);
    if (property) return property;
  }

  if (Node.isVariableDeclaration(declaration)) {
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(name) || !initializer) return undefined;
    if (!writeActionCallbackFunction(initializer, seen)) return undefined;

    return {
      initializer,
      keyNode: name,
      memberName,
    };
  }

  if (Node.isPropertyDeclaration(declaration)) {
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!initializer) return undefined;
    if (!writeActionCallbackFunction(initializer, seen)) return undefined;

    return {
      initializer,
      keyNode: name,
      memberName,
    };
  }

  if (Node.isGetAccessorDeclaration(declaration)) {
    const name = declaration.getNameNode();
    const expression = singleReturnExpression(declaration);
    if (!expression) return undefined;
    if (!writeActionCallbackFunction(expression, seen)) return undefined;

    return {
      initializer: expression,
      keyNode: name,
      memberName,
    };
  }

  if (Node.isPropertyAssignment(declaration)) {
    return {
      initializer: declaration.getInitializer(),
      keyNode: declaration.getNameNode(),
      memberName,
    };
  }

  if (Node.isShorthandPropertyAssignment(declaration)) {
    return {
      initializer: declaration.getObjectAssignmentInitializer(),
      keyNode: declaration.getNameNode(),
      memberName,
    };
  }

  if (Node.isSpreadAssignment(declaration)) {
    return domainWritePropertiesFromSpread(declaration, seen).find(
      (property) => property.memberName === memberName,
    );
  }

  return undefined;
}

function domainWritePropertyFromBindingElement(
  memberName: string,
  declaration: BindingElement,
  seen: Set<string>,
): DomainWriteProperty | undefined {
  // SPEC §11.1: destructured action aliases are resolved from ts-morph static member facts, so
  // `domain({ add })` does not fall back to source-name compatibility extraction.
  const binding = staticBindingElementReference(declaration);
  if (!binding) return undefined;

  const keyNode = declaration.getNameNode();
  if (binding.literalReference && writeActionCallbackFunction(binding.literalReference, seen)) {
    return {
      initializer: binding.literalReference,
      keyNode,
      memberName,
    };
  }

  const symbol = symbolForStaticTypePath(
    unwrappedStaticExpressionNode(binding.initializer),
    binding.path,
    declaration,
  );
  for (const referencedDeclaration of symbol?.getDeclarations() ?? []) {
    const property = domainWritePropertyFromDeclaration(memberName, referencedDeclaration, seen);
    if (property) {
      return {
        ...property,
        keyNode,
        memberName,
      };
    }
  }

  return undefined;
}

function domainWritePropertyFromShorthandAssignment(
  declaration: Node,
  seen: Set<string>,
): DomainWriteProperty | undefined {
  if (!Node.isShorthandPropertyAssignment(declaration)) return undefined;

  const memberName = propertyNameText(declaration.getNameNode(), true);
  if (!memberName) return undefined;

  for (const referencedDeclaration of symbolForCallbackReference(
    declaration.getNameNode(),
  )?.getDeclarations() ?? []) {
    const property = domainWritePropertyFromDeclaration(memberName, referencedDeclaration, seen);
    if (property) return property;
  }

  return undefined;
}

function writeCallbackFunction(
  initializer: Node | undefined,
): ReturnType<CallExpression['getArguments']>[number] | null {
  if (!initializer) return null;
  const writeCall = unwrappedStaticExpressionNode(initializer);
  if (!Node.isCallExpression(writeCall)) return null;
  const expression = writeCall.getExpression();
  if (!Node.isIdentifier(expression) || expression.getText() !== 'write') return null;

  for (const argument of writeCall.getArguments().toReversed()) {
    const callback = writeCallbackArgumentFunction(argument);
    if (callback) return callback;
  }

  return null;
}

function writeActionCallbackFunction(
  initializer: Node | undefined,
  seen: Set<string> = new Set(),
): ReturnType<CallExpression['getArguments']>[number] | null {
  return writeActionCallbackResolution(initializer, seen).callbacks[0] ?? null;
}

interface WriteActionCallbackResolution {
  callbacks: Node[];
  unresolved: boolean;
}

function writeActionCallbackResolution(
  initializer: Node | undefined,
  seen: Set<string> = new Set(),
): WriteActionCallbackResolution {
  if (!initializer) return { callbacks: [], unresolved: true };

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isConditionalExpression(expression)) {
    // SPEC §10-§11: direct conditional domain action members are mutation surfaces. Exact static
    // write branches contribute touches, while opaque branches remain named FW406 entries.
    const branches = [expression.getWhenTrue(), expression.getWhenFalse()].map((branch) =>
      writeActionCallbackResolution(unwrappedStaticExpressionNode(branch), seen),
    );
    return {
      callbacks: branches.flatMap((branch) => branch.callbacks),
      unresolved: branches.some((branch) => branch.unresolved),
    };
  }

  const callback = writeCallbackFunction(expression);
  if (callback) return { callbacks: [callback], unresolved: false };

  const key = `${expression.getSourceFile().getFilePath()}:${expression.getStart()}`;
  if (seen.has(key)) return { callbacks: [], unresolved: true };
  seen.add(key);

  const literalReference = staticLiteralReferenceFromExpression(expression, seen);
  if (literalReference && literalReference !== expression) {
    return writeActionCallbackResolution(unwrappedStaticExpressionNode(literalReference), seen);
  }

  for (const declaration of symbolForCallbackReference(expression)?.getDeclarations() ?? []) {
    const referenced = writeActionCallbackFromDeclaration(declaration, seen);
    if (referenced) return { callbacks: [referenced], unresolved: false };
  }

  return { callbacks: [], unresolved: true };
}

function writeActionCallbackFromDeclaration(
  declaration: Node,
  seen: Set<string>,
): ReturnType<CallExpression['getArguments']>[number] | null {
  if (Node.isBindingElement(declaration)) {
    return writeActionCallbackFromBindingElement(declaration, seen);
  }

  if (Node.isVariableDeclaration(declaration) || Node.isPropertyAssignment(declaration)) {
    return writeActionCallbackFunction(declaration.getInitializer(), seen);
  }

  if (Node.isPropertyDeclaration(declaration)) {
    return writeActionCallbackFunction(declaration.getInitializer(), seen);
  }

  if (Node.isGetAccessorDeclaration(declaration)) {
    return writeActionCallbackFunction(singleReturnExpression(declaration), seen);
  }

  if (Node.isShorthandPropertyAssignment(declaration)) {
    return writeActionCallbackFunction(declaration.getNameNode(), seen);
  }

  if (!Node.isIdentifier(declaration)) return null;

  const parent = declaration.getParent();
  if (
    (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) &&
    parent.getNameNode() === declaration
  ) {
    return writeActionCallbackFunction(parent.getInitializer(), seen);
  }
  if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === declaration) {
    return writeActionCallbackFunction(parent.getNameNode(), seen);
  }

  return null;
}

function writeActionCallbackFromBindingElement(
  declaration: BindingElement,
  seen: Set<string>,
): ReturnType<CallExpression['getArguments']>[number] | null {
  const binding = staticBindingElementReference(declaration);
  if (!binding) return null;

  if (binding.literalReference) {
    const callback = writeActionCallbackFunction(binding.literalReference, seen);
    if (callback) return callback;
  }

  const symbol = symbolForStaticTypePath(
    unwrappedStaticExpressionNode(binding.initializer),
    binding.path,
    declaration,
  );
  for (const referencedDeclaration of symbol?.getDeclarations() ?? []) {
    const callback = writeActionCallbackFromDeclaration(referencedDeclaration, seen);
    if (callback) return callback;
  }

  return null;
}

function writeCallbackArgumentFunction(argument: Node): Node | null {
  const expression = unwrappedStaticExpressionNode(argument);
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return expression;
  const literalReference = staticLiteralReferenceFromExpression(expression);
  if (literalReference && literalReference !== expression) {
    return writeCallbackArgumentFunction(literalReference);
  }
  return referencedWriteCallbackFunction(expression) ?? null;
}

function referencedWriteCallbackFunction(identifier: Node): Node | undefined {
  // SPEC §10-§11: mutation touch facts must come from an executable local callback body; cross
  // module project references are followed through ts-morph aliases instead of by-name fallback.
  return callbackFunctionFromReference(identifier, new Set());
}

function extractedFunctionFromCallback(
  name: string,
  callback: Node,
  keyNode: Node = callback,
  options: { summaryOnly?: boolean } = {},
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
    receiverParameters: sourceReceiverParameterRequirements(callback),
    ...(options.summaryOnly ? { summaryOnly: true } : {}),
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
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
  isReceiverArgument: (argument: Node) => boolean,
): string[] {
  const calls: string[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();

    const name = staticExpressionPath(expression) ?? expression.getText();
    if (IGNORED_LOCAL_CALL_NAMES.has(name)) continue;

    const key = localFunctionKeyForReference(expression, localFunctionKeys);
    if (
      key &&
      !localFunctionCallSatisfiesReceiverRequirements(
        call,
        localFunctionsByKey.get(key)?.receiverParameters ?? [],
        isReceiverArgument,
      )
    ) {
      continue;
    }
    if (key && localFunctionKeys.has(key)) calls.push(key);
  }

  return [...new Set(calls)];
}

function localFunctionCallSatisfiesReceiverRequirements(
  call: CallExpression,
  requirements: readonly ReceiverParameterRequirement[],
  isReceiverArgument: (argument: Node) => boolean,
): boolean {
  if (requirements.length === 0) return true;

  const args = call.getArguments();
  return requirements.every((requirement) => {
    const argument = args[requirement.index];
    return argument ? isReceiverArgument(argument) : false;
  });
}

function extractTransactionCallbackLocalFunctionCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
): string[] {
  const calls: string[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const key = transactionCallbackLocalFunctionKey(call, localFunctionKeys, isReceiverIdentifier);
    if (!key) continue;
    if (
      !transactionCallbackSatisfiesReceiverRequirements(
        localFunctionsByKey.get(key)?.receiverParameters ?? [],
      )
    ) {
      continue;
    }

    calls.push(key);
  }

  return [...new Set(calls)];
}

function extractUnresolvedTransactionCallbackCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const surface = directDrizzleReceiverCallSurface(call);
    if (!surface || surface.name !== 'transaction' || !isReceiverIdentifier(surface.receiver)) {
      continue;
    }

    if (transactionCallHasInlineCallback(call)) continue;

    const key = transactionCallbackLocalFunctionKey(call, localFunctionKeys, isReceiverIdentifier);
    if (
      key &&
      transactionCallbackSatisfiesReceiverRequirements(
        localFunctionsByKey.get(key)?.receiverParameters ?? [],
      )
    ) {
      continue;
    }

    const index = call.getStart() - bodyOffset;
    if (index >= 0) calls.push({ index, name: 'transaction' });
  }

  return calls;
}

function transactionCallbackLocalFunctionKey(
  call: CallExpression,
  localFunctionKeys: ReadonlySet<string>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
): string | undefined {
  const surface = directDrizzleReceiverCallSurface(call);
  if (!surface || surface.name !== 'transaction' || !isReceiverIdentifier(surface.receiver)) {
    return undefined;
  }

  const callback = call.getArguments()[0];
  if (!callback || Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
    return undefined;
  }

  return localFunctionKeyForReference(callback, localFunctionKeys);
}

function transactionCallHasInlineCallback(call: CallExpression): boolean {
  return call
    .getArguments()
    .some((argument) => Node.isArrowFunction(argument) || Node.isFunctionExpression(argument));
}

function transactionCallbackSatisfiesReceiverRequirements(
  requirements: readonly ReceiverParameterRequirement[],
): boolean {
  // SPEC §11.1: `transaction(callback)` supplies the proven Drizzle transaction receiver as the
  // callback's first argument. Other required receiver slots are not statically satisfied.
  return requirements.length > 0 && requirements.every((requirement) => requirement.index === 0);
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
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const carrierReferences = sourceReceiverAliasReferencesForBody(body, (node) =>
    isSourceDrizzleReceiverIdentifier(node, receiverNames),
  );

  for (const call of touchBodyCallExpressions(body)) {
    if (
      boundReceiverMethodAccessName(call, (node) =>
        isSourceDrizzleReceiverIdentifier(node, receiverNames),
      )
    ) {
      continue;
    }

    const surface = externalHelperCallSurface(call);
    if (!surface) continue;

    const { name } = surface;
    if (IGNORED_LOCAL_CALL_NAMES.has(name)) continue;
    const key = localFunctionKeyForReference(surface.reference, localFunctionKeys);
    if (key && localFunctionKeys.has(key)) continue;

    if (
      !call
        .getArguments()
        .some((arg) =>
          sourceReceiverReferenceInArgument(
            arg,
            receiverNames,
            carrierSymbolKeys,
            carrierReferences,
          ),
        )
    ) {
      continue;
    }

    const index = call.getStart() - bodyOffset;
    if (index >= 0) calls.push({ index, name });
  }

  return calls;
}

function extractOpaqueLocalHelperReceiverCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  localFunctionsByKey: ReadonlyMap<string, Pick<ExtractedFunction, 'receiverParameters'>>,
  isDirectReceiverArgument: (argument: Node) => boolean,
  receiverArgumentReference: (argument: Node) => Node | undefined,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const expression = call.getExpression();

    const key = localFunctionKeyForReference(expression, localFunctionKeys);
    if (!key || !localFunctionKeys.has(key)) continue;
    if (!call.getArguments().some((argument) => receiverArgumentReference(argument))) continue;

    const requirements = localFunctionsByKey.get(key)?.receiverParameters ?? [];
    if (
      requirements.length > 0 &&
      localFunctionCallSatisfiesReceiverRequirements(call, requirements, isDirectReceiverArgument)
    ) {
      continue;
    }

    const index = call.getStart() - bodyOffset;
    if (index >= 0) {
      calls.push({ index, name: staticExpressionPath(expression) ?? expression.getText() });
    }
  }

  return calls;
}

interface ExternalHelperCallSurface {
  name: string;
  reference: Node;
}

function externalHelperCallSurface(call: CallExpression): ExternalHelperCallSurface | undefined {
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) {
    return { name: expression.getText(), reference: expression };
  }

  const name = staticExpressionPath(expression);
  return name ? { name, reference: expression } : undefined;
}

function localFunctionKeyForReference(
  reference: Node,
  localFunctionKeys: ReadonlySet<string>,
): string | undefined {
  if (Node.isIdentifier(reference)) {
    return localFunctionKeyForIdentifier(reference, localFunctionKeys);
  }

  // SPEC §10.2/§11.1: local helper summaries follow static member references through
  // ts-morph symbols, so query loaders and mutations cannot hide Drizzle work behind object
  // containers while avoiding source-name compatibility guesses.
  const symbol = symbolForCallbackReference(reference);
  for (const declaration of symbol?.getDeclarations() ?? []) {
    const directKey = localFunctionKeyForDeclaration(declaration);
    if (directKey && localFunctionKeys.has(directKey)) return directKey;

    const callback = callbackFunctionFromDeclaration(declaration);
    if (!callback) continue;

    const callbackKey = localFunctionKeyForCallback(callback);
    if (callbackKey && localFunctionKeys.has(callbackKey)) return callbackKey;
  }

  return undefined;
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

function localFunctionKeyForCallback(callback: Node): string | undefined {
  if (Node.isFunctionDeclaration(callback)) {
    const name = callback.getName();
    const nameNode = callback.getNameNode();
    return name && nameNode ? extractedFunctionKey(name, callback, nameNode) : undefined;
  }

  if (Node.isMethodDeclaration(callback)) {
    const name = propertyNameText(callback.getNameNode());
    return name ? extractedFunctionKey(name, callback, callback.getNameNode()) : undefined;
  }

  if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
    const parent = callback.getParent();
    if (Node.isVariableDeclaration(parent)) {
      const name = parent.getNameNode();
      return Node.isIdentifier(name)
        ? extractedFunctionKey(name.getText(), callback, name)
        : undefined;
    }
    if (Node.isPropertyAssignment(parent)) {
      const name = propertyNameText(parent.getNameNode());
      return name ? extractedFunctionKey(name, callback, parent.getNameNode()) : undefined;
    }
    if (Node.isPropertyDeclaration(parent)) {
      const name = propertyNameText(parent.getNameNode());
      return name ? extractedFunctionKey(name, callback, parent.getNameNode()) : undefined;
    }
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
    if (Node.isMethodDeclaration(parent) && parent.getNameNode() === declaration) {
      return extractedFunctionKey(declaration.getText(), parent, declaration);
    }
    if (Node.isPropertyAssignment(parent) && parent.getNameNode() === declaration) {
      const callback = callbackFunctionFromProperty(parent, new Set());
      return callback ? localFunctionKeyForCallback(callback) : undefined;
    }
    if (Node.isPropertyDeclaration(parent) && parent.getNameNode() === declaration) {
      const callback = callbackFunctionFromPropertyDeclaration(parent, new Set());
      return callback ? localFunctionKeyForCallback(callback) : undefined;
    }
  }
  if (Node.isBindingElement(declaration)) {
    const callback = callbackFunctionFromBindingElement(declaration, new Set());
    return callback ? localFunctionKeyForCallback(callback) : undefined;
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
    const surface = directDrizzleReceiverCallSurface(call);
    if (!surface || !isUnclassifiedDirectDrizzleReceiverMethod(surface.name)) continue;

    if (!isSourceDrizzleReceiverIdentifier(surface.receiver, receiverNames)) continue;

    const index = call.getStart() - bodyOffset;
    if (index >= 0) calls.push({ index, name: surface.name });
  }

  return calls;
}

function extractAmbientSourceReceiverCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  // SPEC §11.1: source-mode `db`/`tx` globals are ambiguous; keep the surface visible as FW406
  // instead of deriving table facts from an undeclared compatibility receiver.
  return extractSourceReceiverSurfaceCallsFromBody(
    body,
    localFunctionKeys,
    isUnboundSourceReceiverName,
    bodyOffset,
  );
}

function extractSourceReceiverAliasSurfaceCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  // SPEC §11.1: source-mode body-local aliases of db/tx are visible surfaces, but they are not
  // enough proof to derive exact read/write facts. Degrade those alias/carrying-member calls to
  // FW406 until project types prove the receiver.
  const references = sourceReceiverAliasReferencesForBody(body, isBaseReceiverIdentifier);
  if (
    references.names.size === 0 &&
    references.symbolKeys.size === 0 &&
    references.carrierProperties.size === 0
  ) {
    return [];
  }

  return extractSourceReceiverSurfaceCallsFromBody(
    body,
    localFunctionKeys,
    (node) =>
      isSourceReceiverAliasIdentifier(node, references) ||
      isSourceReceiverCarrierMemberExpression(node, references),
    bodyOffset,
    false,
  );
}

function extractSourceReceiverSurfaceCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
  bodyOffset = bodySourceStart(body),
  includeHelperCalls = true,
  isReceiverMemberExpression?: (node: Node) => boolean,
): ExternalDbArgumentCall[] {
  const carrierSymbolKeys = receiverCarrierSymbolKeysForBody(body, isReceiverIdentifier);
  const aliases = receiverMethodAliasesForBody(body, isReceiverIdentifier);
  const calls: ExternalDbArgumentCall[] = [];

  for (const call of touchBodyCallExpressions(body)) {
    const direct = sourceReceiverCallSurface(call, isReceiverIdentifier, bodyOffset);
    if (direct) calls.push(direct);

    const alias = receiverMethodAliasCallName(call, aliases);
    const aliasIndex = call.getStart() - bodyOffset;
    if (alias && aliasIndex >= 0) calls.push({ index: aliasIndex, name: alias });

    if (!includeHelperCalls) continue;
    const helper = sourceReceiverHelperCallSurface(
      call,
      localFunctionKeys,
      isReceiverIdentifier,
      carrierSymbolKeys,
      bodyOffset,
      isReceiverMemberExpression,
    );
    if (helper) calls.push(helper);
  }

  return dedupeExternalDbArgumentCalls(calls).sort(
    (left, right) => left.index - right.index || left.name.localeCompare(right.name),
  );
}

function sourceReceiverCallSurface(
  call: CallExpression,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
  bodyOffset: number,
): ExternalDbArgumentCall | null {
  const index = call.getStart() - bodyOffset;
  if (index < 0) return null;

  if (isDrizzleWriteCall(call)) {
    const operation = staticAccessName(call.getExpression());
    const receiver = staticAccessExpression(call.getExpression());
    return operation && isReceiverIdentifier(receiver) ? { index, name: operation } : null;
  }

  const selectRead = selectReadCall(call);
  if (selectRead && isReceiverIdentifier(selectRead.receiver)) {
    return { index, name: 'select' };
  }

  const relationalRead = relationalReadCall(call);
  if (relationalRead && isReceiverIdentifier(relationalRead.receiver)) {
    return { index, name: 'relational-query' };
  }

  const surface = directDrizzleReceiverCallSurface(call);
  if (
    surface &&
    isReceiverIdentifier(surface.receiver) &&
    (surface.name === 'transaction' || isUnclassifiedDirectDrizzleReceiverMethod(surface.name))
  ) {
    return { index, name: surface.displayName ?? surface.name };
  }

  return null;
}

function sourceReceiverHelperCallSurface(
  call: CallExpression,
  localFunctionKeys: ReadonlySet<string>,
  isReceiverIdentifier: (node: Node | undefined) => boolean,
  carrierSymbolKeys: ReadonlySet<string>,
  bodyOffset: number,
  isReceiverMemberExpression?: (node: Node) => boolean,
): ExternalDbArgumentCall | null {
  const surface = externalHelperCallSurface(call);
  if (!surface) return null;
  if (boundReceiverMethodAccessName(call, isReceiverIdentifier)) return null;

  const { name } = surface;
  if (IGNORED_LOCAL_CALL_NAMES.has(name)) return null;

  if (
    !call
      .getArguments()
      .some((arg) =>
        receiverReferenceInArgument(
          arg,
          isReceiverIdentifier,
          carrierSymbolKeys,
          isReceiverMemberExpression,
        ),
      )
  ) {
    return null;
  }

  const index = call.getStart() - bodyOffset;
  if (index < 0) return null;

  return { index, name };
}

function dedupeExternalDbArgumentCalls(
  calls: readonly ExternalDbArgumentCall[],
): ExternalDbArgumentCall[] {
  const seen = new Set<string>();
  const deduped: ExternalDbArgumentCall[] = [];

  for (const call of calls) {
    const key = `${call.index}\0${call.name}`;
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(call);
  }

  return deduped;
}

interface SourceReceiverAliasReferences extends QueryReceiverReferences {
  carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
}

function sourceReceiverAliasReferencesForBody(
  body: Node,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): SourceReceiverAliasReferences {
  const names = new Set<string>();
  const symbolKeys = new Set<string>();
  const carrierProperties = new Map<string, Set<string>>();
  let changed = true;

  while (changed) {
    const before = sourceReceiverReferenceSize(names, symbolKeys, carrierProperties);

    for (const declaration of touchBodyVariableDeclarations(body)) {
      const binding = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!initializer) continue;

      const references = { carrierProperties, names, symbolKeys };
      if (Node.isObjectBindingPattern(binding) || Node.isArrayBindingPattern(binding)) {
        appendSourceReceiverAliasesFromCarrierBinding(binding, initializer, references);
        continue;
      }

      if (!Node.isIdentifier(binding)) continue;
      if (isSourceReceiverAliasExpression(initializer, isBaseReceiverIdentifier, references)) {
        appendSourceDestructuredReceiverIdentifier(binding, names, symbolKeys);
      }

      appendSourceReceiverCarrierProperties(
        binding,
        initializer,
        references,
        isBaseReceiverIdentifier,
      );
    }

    for (const expression of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (!isTouchBodyNode(expression, body)) continue;
      if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

      const left = unwrappedStaticExpressionNode(expression.getLeft());
      const references = { carrierProperties, names, symbolKeys };
      if (Node.isObjectLiteralExpression(left)) {
        appendSourceReceiverAliasesFromCarrierAssignment(left, expression.getRight(), references);
        continue;
      }
      if (Node.isArrayLiteralExpression(left)) {
        appendSourceReceiverAliasesFromCarrierAssignment(left, expression.getRight(), references);
        continue;
      }

      if (!Node.isIdentifier(left)) continue;

      const right = expression.getRight();
      if (isSourceReceiverAliasExpression(right, isBaseReceiverIdentifier, references)) {
        appendSourceDestructuredReceiverIdentifier(left, names, symbolKeys);
      }

      appendSourceReceiverCarrierProperties(left, right, references, isBaseReceiverIdentifier);
    }

    changed = sourceReceiverReferenceSize(names, symbolKeys, carrierProperties) !== before;
  }

  return { carrierProperties, names, symbolKeys };
}

function appendSourceReceiverAliasesFromCarrierAssignment(
  assignment: Node,
  initializer: Node,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  // SPEC §11.1: source-mode destructuring assignment from a known carrier is still not exact
  // receiver proof, but later receiver work through the assigned aliases must stay visible.
  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isIdentifier(expression)) return;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(expression));
  const carrierProperties = symbolKey ? references.carrierProperties.get(symbolKey) : undefined;
  if (!carrierProperties) return;

  if (Node.isArrayLiteralExpression(assignment)) {
    appendSourceReceiverAliasesFromArrayCarrierAssignment(
      assignment,
      carrierProperties,
      references,
    );
    return;
  }

  if (!Node.isObjectLiteralExpression(assignment)) return;

  for (const property of assignment.getProperties()) {
    const propertyName = objectAssignmentPropertyName(property);
    if (!propertyName) continue;

    const target = objectAssignmentTargetNode(property);
    if (!target) continue;

    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(target, references.names, references.symbolKeys);
      continue;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) continue;

    if (Node.isObjectLiteralExpression(target) || Node.isArrayLiteralExpression(target)) {
      appendSourceReceiverAliasesFromNestedCarrierAssignment(target, nestedProperties, references);
      continue;
    }

    if (!Node.isIdentifier(target)) continue;
    appendSourceReceiverCarrierPropertiesForTarget(target, nestedProperties, references);
  }
}

function appendSourceReceiverAliasesFromArrayCarrierAssignment(
  assignment: Node,
  carrierProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  if (!Node.isArrayLiteralExpression(assignment)) return;

  assignment.getElements().forEach((element, index) => {
    const propertyName = String(index);
    const target = unwrappedStaticExpressionNode(element);

    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(target, references.names, references.symbolKeys);
      return;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) return;

    if (Node.isObjectLiteralExpression(target) || Node.isArrayLiteralExpression(target)) {
      appendSourceReceiverAliasesFromNestedCarrierAssignment(target, nestedProperties, references);
      return;
    }

    if (!Node.isIdentifier(target)) return;
    appendSourceReceiverCarrierPropertiesForTarget(target, nestedProperties, references);
  });
}

function appendSourceReceiverAliasesFromNestedCarrierAssignment(
  assignment: Node,
  carrierProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  if (Node.isArrayLiteralExpression(assignment)) {
    appendSourceReceiverAliasesFromArrayCarrierAssignment(
      assignment,
      carrierProperties,
      references,
    );
    return;
  }
  if (!Node.isObjectLiteralExpression(assignment)) return;

  for (const property of assignment.getProperties()) {
    const propertyName = objectAssignmentPropertyName(property);
    if (!propertyName) continue;

    const target = objectAssignmentTargetNode(property);
    if (!target) continue;

    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(target, references.names, references.symbolKeys);
      continue;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) continue;

    if (Node.isObjectLiteralExpression(target) || Node.isArrayLiteralExpression(target)) {
      appendSourceReceiverAliasesFromNestedCarrierAssignment(target, nestedProperties, references);
      continue;
    }

    if (!Node.isIdentifier(target)) continue;
    appendSourceReceiverCarrierPropertiesForTarget(target, nestedProperties, references);
  }
}

function appendSourceReceiverCarrierPropertiesForTarget(
  target: Node,
  nestedProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
  },
): void {
  if (!Node.isIdentifier(target)) return;

  const targetSymbolKey = resolvedSymbolKey(symbolForIdentifierReference(target));
  if (!targetSymbolKey) return;

  const properties = carrierPropertiesForSymbol(references.carrierProperties, targetSymbolKey);
  for (const nestedProperty of nestedProperties) {
    properties.add(nestedProperty);
  }
}

function appendSourceReceiverAliasesFromCarrierBinding(
  binding: Node,
  initializer: Node,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isIdentifier(expression)) return;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(expression));
  const carrierProperties = symbolKey ? references.carrierProperties.get(symbolKey) : undefined;
  if (!carrierProperties) return;

  if (Node.isArrayBindingPattern(binding)) {
    appendSourceReceiverAliasesFromArrayCarrierBinding(binding, carrierProperties, references);
    return;
  }

  if (!Node.isObjectBindingPattern(binding)) return;

  for (const element of binding.getElements()) {
    if (isRestBindingElement(element)) continue;
    const propertyName = propertyNameText(element.getPropertyNameNode() ?? element.getNameNode());
    if (!propertyName) continue;

    const name = element.getNameNode();
    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(name, references.names, references.symbolKeys);
      continue;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) continue;

    if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
      appendSourceReceiverAliasesFromNestedCarrierBinding(name, nestedProperties, references);
      continue;
    }

    if (!Node.isIdentifier(name)) continue;
    appendSourceReceiverCarrierPropertiesForTarget(name, nestedProperties, references);
  }
}

function appendSourceReceiverAliasesFromArrayCarrierBinding(
  binding: Node,
  carrierProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  if (!Node.isArrayBindingPattern(binding)) return;

  binding.getElements().forEach((element, index) => {
    if (!Node.isBindingElement(element)) return;
    if (isRestBindingElement(element)) {
      appendSourceReceiverCarrierPropertiesForRestTarget(
        element.getNameNode(),
        carrierProperties,
        index,
        references,
      );
      return;
    }

    const propertyName = String(index);
    const name = element.getNameNode();
    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(name, references.names, references.symbolKeys);
      return;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) return;

    if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
      appendSourceReceiverAliasesFromNestedCarrierBinding(name, nestedProperties, references);
      return;
    }

    if (!Node.isIdentifier(name)) return;
    appendSourceReceiverCarrierPropertiesForTarget(name, nestedProperties, references);
  });
}

function appendSourceReceiverCarrierPropertiesForRestTarget(
  target: Node,
  carrierProperties: ReadonlySet<string>,
  startIndex: number,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
  },
): void {
  if (!Node.isIdentifier(target)) return;

  const targetSymbolKey = resolvedSymbolKey(symbolForIdentifierReference(target));
  if (!targetSymbolKey) return;

  const remappedProperties = restCarrierProperties(carrierProperties, startIndex);
  if (remappedProperties.size === 0) return;

  const properties = carrierPropertiesForSymbol(references.carrierProperties, targetSymbolKey);
  for (const property of remappedProperties) properties.add(property);
}

function restCarrierProperties(
  carrierProperties: ReadonlySet<string>,
  startIndex: number,
): ReadonlySet<string> {
  const remapped = new Set<string>();

  for (const property of carrierProperties) {
    const [head, ...tail] = property.split('.');
    const index = Number(head);
    if (!Number.isInteger(index) || index < startIndex) continue;

    remapped.add([String(index - startIndex), ...tail].join('.'));
  }

  return remapped;
}

function appendSourceReceiverAliasesFromNestedCarrierBinding(
  binding: Node,
  carrierProperties: ReadonlySet<string>,
  references: {
    carrierProperties: ReadonlyMap<string, ReadonlySet<string>>;
    names: Set<string>;
    symbolKeys: Set<string>;
  },
): void {
  if (Node.isArrayBindingPattern(binding)) {
    appendSourceReceiverAliasesFromArrayCarrierBinding(binding, carrierProperties, references);
    return;
  }
  if (!Node.isObjectBindingPattern(binding)) return;

  for (const element of binding.getElements()) {
    if (isRestBindingElement(element)) continue;
    const propertyName = propertyNameText(element.getPropertyNameNode() ?? element.getNameNode());
    if (!propertyName) continue;

    const name = element.getNameNode();
    if (carrierProperties.has(propertyName)) {
      appendSourceDestructuredReceiverIdentifier(name, references.names, references.symbolKeys);
      continue;
    }

    const nestedProperties = receiverCarrierNestedProperties(carrierProperties, propertyName);
    if (nestedProperties.size === 0) continue;

    if (Node.isObjectBindingPattern(name) || Node.isArrayBindingPattern(name)) {
      appendSourceReceiverAliasesFromNestedCarrierBinding(name, nestedProperties, references);
      continue;
    }

    if (!Node.isIdentifier(name)) continue;
    appendSourceReceiverCarrierPropertiesForTarget(name, nestedProperties, references);
  }
}

function appendSourceReceiverCarrierPropertiesFromArrayLiteral(
  binding: Node,
  array: Node,
  references: SourceReceiverAliasReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): void {
  if (!Node.isIdentifier(binding) || !Node.isArrayLiteralExpression(array)) return;

  const bindingSymbolKey = resolvedSymbolKey(binding.getSymbol());
  if (!bindingSymbolKey) return;

  const receiverProperties = receiverCarrierPropertiesFromArrayLiteral(
    array,
    references,
    isBaseReceiverIdentifier,
  );
  if (receiverProperties.size === 0) return;

  const properties = carrierPropertiesForSymbol(references.carrierProperties, bindingSymbolKey);
  for (const property of receiverProperties) {
    properties.add(property);
  }
}

function sourceReceiverReferenceSize(
  names: ReadonlySet<string>,
  symbolKeys: ReadonlySet<string>,
  carrierProperties: ReadonlyMap<string, ReadonlySet<string>>,
): number {
  return (
    names.size +
    symbolKeys.size +
    [...carrierProperties.values()].reduce((sum, properties) => sum + properties.size, 0)
  );
}

function isSourceReceiverAliasExpression(
  node: Node,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
  references: QueryReceiverReferences,
): boolean {
  const expression = unwrappedStaticExpressionNode(node);
  return (
    isBaseReceiverIdentifier(expression) || isSourceReceiverAliasIdentifier(expression, references)
  );
}

function appendSourceReceiverCarrierProperties(
  binding: Node,
  initializer: Node,
  references: SourceReceiverAliasReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): void {
  if (!Node.isIdentifier(binding)) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isArrayLiteralExpression(expression)) {
    appendSourceReceiverCarrierPropertiesFromArrayLiteral(
      binding,
      expression,
      references,
      isBaseReceiverIdentifier,
    );
    return;
  }
  if (!Node.isObjectLiteralExpression(expression)) return;

  const bindingSymbolKey = resolvedSymbolKey(binding.getSymbol());
  if (!bindingSymbolKey) return;

  const receiverProperties = receiverCarrierPropertiesFromObjectLiteral(
    expression,
    references,
    isBaseReceiverIdentifier,
  );
  if (receiverProperties.size === 0) return;

  const properties = carrierPropertiesForSymbol(references.carrierProperties, bindingSymbolKey);
  for (const property of receiverProperties) {
    properties.add(property);
  }
}

function receiverCarrierPropertiesFromObjectLiteral(
  object: ObjectLiteralExpression,
  references: SourceReceiverAliasReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): ReadonlySet<string> {
  // SPEC §11.1: object-spread carrier copies preserve only properties still proven to contain a
  // Drizzle receiver after later object-literal overrides.
  const properties = new Set<string>();

  for (const property of object.getProperties()) {
    if (Node.isSpreadAssignment(property)) {
      const spreadProperties = receiverCarrierSpreadProperties(property, references);
      if (spreadProperties) {
        for (const spreadProperty of spreadProperties) properties.add(spreadProperty);
      } else {
        properties.clear();
      }
      continue;
    }

    const propertyName = propertyNameText(property.getNameNode());
    if (!propertyName) {
      properties.clear();
      continue;
    }

    removeReceiverCarrierPropertyPath(properties, propertyName);
    for (const path of receiverCarrierPropertyPaths(
      property,
      references,
      isBaseReceiverIdentifier,
    )) {
      properties.add(path);
    }
  }

  return properties;
}

function receiverCarrierPropertiesFromArrayLiteral(
  array: Node,
  references: SourceReceiverAliasReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): ReadonlySet<string> {
  if (!Node.isArrayLiteralExpression(array)) return new Set();

  const properties = new Set<string>();
  array.getElements().forEach((element, index) => {
    const propertyName = String(index);
    removeReceiverCarrierPropertyPath(properties, propertyName);
    for (const path of receiverCarrierPathsForValue(
      propertyName,
      element,
      references,
      isBaseReceiverIdentifier,
    )) {
      properties.add(path);
    }
  });

  return properties;
}

function receiverCarrierSpreadProperties(
  property: Node,
  references: SourceReceiverAliasReferences,
): ReadonlySet<string> | undefined {
  if (!Node.isSpreadAssignment(property)) return undefined;

  const expression = unwrappedStaticExpressionNode(property.getExpression());
  if (!Node.isIdentifier(expression)) return undefined;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(expression));
  return symbolKey ? references.carrierProperties.get(symbolKey) : undefined;
}

function receiverCarrierPropertyPaths(
  property: ReturnType<ObjectLiteralExpression['getProperties']>[number],
  references: QueryReceiverReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): ReadonlySet<string> {
  if (Node.isShorthandPropertyAssignment(property)) {
    const propertyName = propertyNameText(property.getNameNode());
    if (!propertyName) return new Set();

    const name = property.getNameNode();
    return receiverCarrierPathsForValue(propertyName, name, references, isBaseReceiverIdentifier);
  }

  if (!Node.isPropertyAssignment(property)) return new Set();

  const propertyName = propertyNameText(property.getNameNode());
  if (!propertyName) return new Set();

  const initializer = property.getInitializer();
  if (!initializer) return new Set();

  return receiverCarrierPathsForValue(
    propertyName,
    initializer,
    references,
    isBaseReceiverIdentifier,
  );
}

function receiverCarrierPathsForValue(
  propertyName: string,
  value: Node,
  references: QueryReceiverReferences,
  isBaseReceiverIdentifier: (node: Node | undefined) => boolean,
): ReadonlySet<string> {
  const expression = unwrappedStaticExpressionNode(value);
  const paths = new Set<string>();

  const nestedProperties = receiverCarrierPropertiesForExpression(expression, references);
  if (nestedProperties) {
    for (const path of prefixedReceiverCarrierProperties(propertyName, nestedProperties)) {
      paths.add(path);
    }
  }

  if (isSourceReceiverAliasExpression(expression, isBaseReceiverIdentifier, references)) {
    paths.add(propertyName);
  }

  if (Node.isObjectLiteralExpression(expression)) {
    for (const path of prefixedReceiverCarrierProperties(
      propertyName,
      receiverCarrierPropertiesFromObjectLiteral(
        expression,
        references as SourceReceiverAliasReferences,
        isBaseReceiverIdentifier,
      ),
    )) {
      paths.add(path);
    }
  }
  if (Node.isArrayLiteralExpression(expression)) {
    for (const path of prefixedReceiverCarrierProperties(
      propertyName,
      receiverCarrierPropertiesFromArrayLiteral(
        expression,
        references as SourceReceiverAliasReferences,
        isBaseReceiverIdentifier,
      ),
    )) {
      paths.add(path);
    }
  }

  return paths;
}

function receiverCarrierPropertiesForExpression(
  expression: Node,
  references: QueryReceiverReferences,
): ReadonlySet<string> | undefined {
  if (!Node.isIdentifier(expression)) return undefined;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(expression));
  return symbolKey
    ? (references as SourceReceiverAliasReferences).carrierProperties.get(symbolKey)
    : undefined;
}

function prefixedReceiverCarrierProperties(
  propertyName: string,
  properties: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...properties].map((property) => `${propertyName}.${property}`));
}

function receiverCarrierNestedProperties(
  properties: ReadonlySet<string>,
  propertyName: string,
): ReadonlySet<string> {
  const prefix = `${propertyName}.`;
  return new Set(
    [...properties]
      .filter((property) => property.startsWith(prefix))
      .map((property) => property.slice(prefix.length)),
  );
}

function removeReceiverCarrierPropertyPath(properties: Set<string>, propertyName: string): void {
  properties.delete(propertyName);

  const prefix = `${propertyName}.`;
  for (const property of properties) {
    if (property.startsWith(prefix)) properties.delete(property);
  }
}

function carrierPropertiesForSymbol(
  carrierProperties: ReadonlyMap<string, ReadonlySet<string>>,
  symbolKey: string,
): Set<string> {
  const mutable = carrierProperties as Map<string, Set<string>>;
  const properties = mutable.get(symbolKey);
  if (properties) return properties;

  const next = new Set<string>();
  mutable.set(symbolKey, next);
  return next;
}

function isSourceReceiverAliasIdentifier(
  node: Node | undefined,
  references: QueryReceiverReferences,
): boolean {
  if (!node || !Node.isIdentifier(node)) return false;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
  if (symbolKey) return references.symbolKeys.has(symbolKey);
  return references.names.has(node.getText());
}

function isSourceReceiverCarrierMemberExpression(
  node: Node | undefined,
  references: SourceReceiverAliasReferences,
): boolean {
  if (!node || (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node))) {
    return false;
  }

  const receiver = staticExpressionRootIdentifier(node);
  if (!receiver || !Node.isIdentifier(receiver)) return false;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(receiver));
  if (!symbolKey) return false;

  const carriedProperties = references.carrierProperties.get(symbolKey);
  if (!carriedProperties) return false;

  const rootPath = receiver.getText();
  const path = staticExpressionPath(node);
  if (!path || path === rootPath || !path.startsWith(`${rootPath}.`)) return false;

  return carriedProperties.has(path.slice(rootPath.length + 1));
}

function extractSourceParameterReceiverMemberSurfaceCallsFromBody(
  body: Node,
  localFunctionKeys: ReadonlySet<string>,
  callback: Node,
): ExternalDbArgumentCall[] {
  const receiverReferences = sourceCallbackParameterReferences(callback);
  if (receiverReferences.names.size === 0 && receiverReferences.symbolKeys.size === 0) return [];

  return extractSourceReceiverSurfaceCallsFromBody(
    body,
    localFunctionKeys,
    (node) => isSourceParameterReceiverMemberExpression(node, receiverReferences),
    undefined,
    true,
    (node) => isSourceParameterReceiverMemberExpression(node, receiverReferences),
  );
}

function sourceCallbackParameterReferences(callback: Node): QueryReceiverReferences {
  const names = new Set<string>();
  const symbolKeys = new Set<string>();
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback) &&
    !Node.isMethodDeclaration(callback)
  ) {
    return { names, symbolKeys };
  }

  for (const parameter of callback.getParameters()) {
    const name = parameter.getNameNode();
    if (!Node.isIdentifier(name)) continue;

    names.add(name.getText());
    const symbolKey = resolvedSymbolKey(name.getSymbol());
    if (symbolKey) symbolKeys.add(symbolKey);
  }

  return { names, symbolKeys };
}

function isSourceQueryReceiverMemberExpression(
  node: Node | undefined,
  receiverReferences: QueryReceiverReferences,
): boolean {
  return isSourceReceiverMemberExpression(node, (root) =>
    isQueryReceiverIdentifier(root, receiverReferences),
  );
}

function isSourceParameterReceiverMemberExpression(
  node: Node | undefined,
  receiverReferences: QueryReceiverReferences,
): boolean {
  return isSourceReceiverMemberExpression(node, (root) =>
    isSourceDestructuredReceiverIdentifier(root, receiverReferences),
  );
}

function isSourceReceiverMemberExpression(
  node: Node | undefined,
  isRootReceiver: (root: Node) => boolean,
): boolean {
  if (!node || (!Node.isPropertyAccessExpression(node) && !Node.isElementAccessExpression(node))) {
    return false;
  }

  const root = staticExpressionRootIdentifier(node);
  if (!root || !Node.isIdentifier(root) || !isRootReceiver(root)) return false;

  const path = staticExpressionPath(node);
  if (!path || path === root.getText()) return false;

  const firstMember = path.slice(root.getText().length + 1).split('.')[0];
  return firstMember === 'db' || firstMember === 'tx';
}

interface DirectDrizzleReceiverCallSurface {
  displayName?: string;
  name: string;
  receiver: Node;
}

function directDrizzleReceiverCallSurface(
  call: CallExpression,
): DirectDrizzleReceiverCallSurface | undefined {
  const expression = unwrappedStaticExpressionNode(call.getExpression());
  const receiver = staticAccessExpression(expression);
  if (!receiver) return undefined;

  const name = staticAccessName(expression);
  if (name) return { name, receiver };

  if (Node.isElementAccessExpression(expression)) {
    // SPEC §10.2/§11.1: a computed method on a proven Drizzle receiver can hide raw SQL or writes,
    // so it must degrade to FW406 instead of disappearing from the static surface.
    return {
      displayName: expression.getText(),
      name: COMPUTED_DRIZZLE_RECEIVER_METHOD,
      receiver,
    };
  }

  return undefined;
}

function extractReceiverMethodAliasCallsFromBody(
  body: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  bodyOffset = bodySourceStart(body),
): ExternalDbArgumentCall[] {
  const aliases = receiverMethodAliasesForBody(body, isReceiverIdentifier);
  if (aliases.symbols.size === 0) return [];

  const calls: ExternalDbArgumentCall[] = [];
  for (const call of touchBodyCallExpressions(body)) {
    const method = receiverMethodAliasCallName(call, aliases);
    if (!method) continue;

    const index = call.getStart() - bodyOffset;
    if (index >= 0) calls.push({ index, name: method });
  }

  return calls;
}

function receiverMethodAliasCallName(
  call: CallExpression,
  aliases: ReceiverMethodAliases,
): string | undefined {
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) {
    return receiverMethodAliasName(expression, aliases);
  }

  const root = staticExpressionRootIdentifier(expression);
  if (!root) return undefined;
  const alias = receiverMethodAliasName(root, aliases);
  if (alias !== 'query') return undefined;

  const method = staticAccessName(expression);
  return method === 'findFirst' || method === 'findMany' ? 'query' : undefined;
}

function receiverMethodAliasName(
  identifier: Node,
  aliases: ReceiverMethodAliases,
): string | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;

  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(identifier));
  // SPEC §11.1: detached receiver aliases are symbol facts when parser identity is available;
  // same-name shadow bindings must not fall back to source-name compatibility.
  return symbolKey ? aliases.symbols.get(symbolKey) : undefined;
}

interface ReceiverMethodAliases {
  symbols: ReadonlyMap<string, string>;
}

function receiverMethodAliasesForBody(
  body: Node,
  isReceiverIdentifier: (node: Node) => boolean,
): ReceiverMethodAliases {
  const symbols = new Map<string, string>();

  let changed = true;
  while (changed) {
    const before = symbols.size;

    for (const declaration of touchBodyVariableDeclarations(body)) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;

      const binding = declaration.getNameNode();
      if (Node.isObjectBindingPattern(binding) && isReceiverIdentifier(initializer)) {
        appendReceiverMethodAliasesFromObjectPattern(binding, symbols);
        continue;
      }
      if (Node.isArrayBindingPattern(binding)) {
        appendReceiverMethodAliasesFromArrayPattern(
          binding,
          initializer,
          symbols,
          isReceiverIdentifier,
          { symbols },
        );
        continue;
      }

      if (!Node.isIdentifier(binding)) continue;
      const method = receiverMethodAliasExpressionName(initializer, isReceiverIdentifier, {
        symbols,
      });
      if (!method) continue;
      appendReceiverMethodAlias(symbols, binding, method);
    }

    for (const expression of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (!isTouchBodyNode(expression, body)) continue;
      if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

      const left = unwrappedStaticExpressionNode(expression.getLeft());
      const right = unwrappedStaticExpressionNode(expression.getRight());
      if (Node.isObjectLiteralExpression(left) && isReceiverIdentifier(right)) {
        appendReceiverMethodAliasesFromObjectAssignment(left, symbols);
        continue;
      }
      if (Node.isArrayLiteralExpression(left)) {
        appendReceiverMethodAliasesFromArrayAssignment(left, right, symbols, isReceiverIdentifier, {
          symbols,
        });
        continue;
      }

      if (!Node.isIdentifier(left)) continue;
      const method = receiverMethodAliasExpressionName(right, isReceiverIdentifier, {
        symbols,
      });
      if (!method) continue;
      appendReceiverMethodAlias(symbols, left, method);
    }

    changed = symbols.size !== before;
  }

  return { symbols };
}

function appendReceiverMethodAliasesFromObjectPattern(
  binding: Node,
  symbols: Map<string, string>,
): void {
  if (!Node.isObjectBindingPattern(binding)) return;

  for (const element of binding.getElements()) {
    if (isRestBindingElement(element)) continue;
    const alias = element.getNameNode();
    if (!Node.isIdentifier(alias)) continue;

    const method = propertyNameText(element.getPropertyNameNode() ?? alias);
    if (!method) continue;
    appendReceiverMethodAlias(symbols, alias, method);
  }
}

function appendReceiverMethodAliasesFromArrayPattern(
  binding: Node,
  initializer: Node,
  symbols: Map<string, string>,
  isReceiverIdentifier: (node: Node) => boolean,
  aliases: ReceiverMethodAliases,
): void {
  if (!Node.isArrayBindingPattern(binding)) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isArrayLiteralExpression(expression)) return;

  const values = expression.getElements();
  binding.getElements().forEach((element, index) => {
    if (!Node.isBindingElement(element)) return;
    if (isRestBindingElement(element)) return;

    const alias = element.getNameNode();
    if (!Node.isIdentifier(alias)) return;

    const value = values[index];
    if (!value) return;

    const method = receiverMethodAliasExpressionName(value, isReceiverIdentifier, aliases);
    if (method) appendReceiverMethodAlias(symbols, alias, method);
  });
}

function appendReceiverMethodAliasesFromObjectAssignment(
  assignment: Node,
  symbols: Map<string, string>,
): void {
  if (!Node.isObjectLiteralExpression(assignment)) return;

  for (const property of assignment.getProperties()) {
    if (Node.isShorthandPropertyAssignment(property)) {
      const alias = property.getNameNode();
      appendReceiverMethodAlias(symbols, alias, alias.getText());
      continue;
    }

    if (!Node.isPropertyAssignment(property)) continue;
    const initializer = property.getInitializer();
    if (!initializer) continue;

    const alias = unwrappedStaticExpressionNode(initializer);
    if (!Node.isIdentifier(alias)) continue;

    const method = propertyNameText(property.getNameNode());
    if (!method) continue;
    appendReceiverMethodAlias(symbols, alias, method);
  }
}

function appendReceiverMethodAliasesFromArrayAssignment(
  assignment: Node,
  initializer: Node,
  symbols: Map<string, string>,
  isReceiverIdentifier: (node: Node) => boolean,
  aliases: ReceiverMethodAliases,
): void {
  if (!Node.isArrayLiteralExpression(assignment)) return;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isArrayLiteralExpression(expression)) return;

  const values = expression.getElements();
  assignment.getElements().forEach((element, index) => {
    const alias = unwrappedStaticExpressionNode(element);
    if (!Node.isIdentifier(alias)) return;

    const value = values[index];
    if (!value) return;

    const method = receiverMethodAliasExpressionName(value, isReceiverIdentifier, aliases);
    if (method) appendReceiverMethodAlias(symbols, alias, method);
  });
}

function receiverMethodAliasExpressionName(
  node: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  aliases: ReceiverMethodAliases,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  const boundMethod = boundReceiverMethodAccessName(expression, isReceiverIdentifier);
  if (boundMethod) return boundMethod;

  if (Node.isIdentifier(expression)) return receiverMethodAliasName(expression, aliases);

  const receiver = staticAccessExpression(expression);
  if (!receiver || !isReceiverIdentifier(receiver)) return undefined;
  if (Node.isElementAccessExpression(expression)) {
    return staticAccessName(expression) ?? COMPUTED_DRIZZLE_RECEIVER_METHOD;
  }
  return staticAccessName(expression);
}

function boundReceiverMethodAccessName(
  node: Node,
  isReceiverIdentifier: (node: Node) => boolean,
): string | undefined {
  if (!Node.isCallExpression(node)) return undefined;

  const bindAccess = unwrappedStaticExpressionNode(node.getExpression());
  if (staticAccessName(bindAccess) !== 'bind') return undefined;

  const methodAccess = staticAccessExpression(bindAccess);
  if (!methodAccess) return undefined;

  const receiver = staticAccessExpression(methodAccess);
  if (!receiver || !isReceiverIdentifier(receiver)) return undefined;

  // SPEC §10-§11: bound detached receiver methods can hide raw SQL or writes just like
  // destructured receiver methods, so they degrade through the same FW406 alias path.
  return staticAccessName(methodAccess) ?? COMPUTED_DRIZZLE_RECEIVER_METHOD;
}

function appendReceiverMethodAlias(
  symbols: Map<string, string>,
  alias: Node,
  method: string,
): void {
  if (!Node.isIdentifier(alias)) return;
  const symbolKey = resolvedSymbolKey(alias.getSymbol());
  if (symbolKey) symbols.set(symbolKey, method);
}

function isUnclassifiedDirectDrizzleReceiverMethod(name: string): boolean {
  // SPEC §10-§11: direct receiver calls not statically classified are explicit FW406 surfaces.
  return (
    UNCLASSIFIED_DRIZZLE_RECEIVER_MUTATION_METHODS.has(name) ||
    !CLASSIFIED_DRIZZLE_RECEIVER_METHODS.has(name)
  );
}

function projectReceiverReferenceInArgument(
  argument: Node,
  receivers: ProjectDrizzleReceivers,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
): Node | undefined {
  return receiverReferenceInArgument(
    argument,
    (node) => isProjectDrizzleReceiverIdentifier(node, receivers),
    carrierSymbolKeys,
    isProjectDrizzleReceiverMemberExpression,
    isProjectDrizzleReceiverContainerExpression,
  );
}

function queryReceiverReferenceInArgument(
  argument: Node,
  receiverReferences: QueryReceiverReferences,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
  carrierReferences?: SourceReceiverAliasReferences,
): Node | undefined {
  return receiverReferenceInArgument(
    argument,
    (node) => isQueryReceiverIdentifier(node, receiverReferences),
    carrierSymbolKeys,
    carrierReferences
      ? (node) => isSourceReceiverCarrierMemberExpression(node, carrierReferences)
      : undefined,
    receiverReferences.projectContainers ? isProjectDrizzleReceiverContainerExpression : undefined,
  );
}

function sourceReceiverReferenceInArgument(
  argument: Node,
  receiverNames: ReadonlySet<string>,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
  carrierReferences?: SourceReceiverAliasReferences,
): Node | undefined {
  return receiverReferenceInArgument(
    argument,
    (node) => isSourceDrizzleReceiverIdentifier(node, receiverNames),
    carrierSymbolKeys,
    carrierReferences
      ? (node) => isSourceReceiverCarrierMemberExpression(node, carrierReferences)
      : undefined,
  );
}

function receiverReferenceInArgument(
  argument: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
  isReceiverMemberExpression?: (node: Node) => boolean,
  isReceiverContainerExpression?: (node: Node) => boolean,
): Node | undefined {
  // SPEC §10-§11: opaque helper handoffs may hide Drizzle work, so receiver values passed inside
  // containers degrade to FW406 while classified receiver call chains remain separately analyzed.
  if (isFunctionLikeNode(argument)) return undefined;
  if (
    isReceiverArgumentReference(
      argument,
      argument,
      isReceiverIdentifier,
      carrierSymbolKeys,
      isReceiverMemberExpression,
      isReceiverContainerExpression,
    )
  ) {
    return argument;
  }

  for (const node of argument.getDescendants()) {
    if (isFunctionLikeNode(node)) continue;
    if (Node.isShorthandPropertyAssignment(node)) {
      const name = node.getNameNode();
      if (
        (isReceiverIdentifier(name) ||
          isReceiverCarrierIdentifier(name, carrierSymbolKeys) ||
          isReceiverContainerExpression?.(name) === true) &&
        !isIdentifierDeclarationPosition(name) &&
        !isInsideNestedFunction(name, argument)
      ) {
        return name;
      }
    }
    if (
      isReceiverArgumentReference(
        node,
        argument,
        isReceiverIdentifier,
        carrierSymbolKeys,
        isReceiverMemberExpression,
        isReceiverContainerExpression,
      )
    ) {
      return node;
    }
  }

  return undefined;
}

function isReceiverArgumentReference(
  node: Node,
  argument: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  carrierSymbolKeys: ReadonlySet<string>,
  isReceiverMemberExpression?: (node: Node) => boolean,
  isReceiverContainerExpression?: (node: Node) => boolean,
): boolean {
  const isIdentifierReference =
    Node.isIdentifier(node) &&
    (isReceiverIdentifier(node) ||
      isReceiverCarrierIdentifier(node, carrierSymbolKeys) ||
      isReceiverContainerExpression?.(node) === true);
  const isMemberReference = isReceiverMemberExpression?.(node) === true;
  const isContainerReference =
    !Node.isObjectLiteralExpression(node) &&
    !Node.isArrayLiteralExpression(node) &&
    isReceiverContainerExpression?.(node) === true;
  if (!isIdentifierReference && !isMemberReference && !isContainerReference) {
    return false;
  }
  if (Node.isIdentifier(node) && isIdentifierDeclarationPosition(node)) return false;
  if (Node.isIdentifier(node) && isPropertyNamePosition(node)) return false;
  if (isAccessExpressionReceiver(node)) return false;
  if (isInsideNestedFunction(node, argument)) return false;
  return true;
}

function isReceiverCarrierIdentifier(node: Node, carrierSymbolKeys: ReadonlySet<string>): boolean {
  if (!Node.isIdentifier(node) || carrierSymbolKeys.size === 0) return false;
  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
  return symbolKey ? carrierSymbolKeys.has(symbolKey) : false;
}

function isProjectDrizzleReceiverContainerExpression(node: Node | undefined): boolean {
  if (!node) return false;
  if (isFunctionLikeNode(node)) return false;
  if (isProjectDrizzleReceiverMemberExpression(node)) return false;

  // SPEC §11.1: opaque helper handoffs through factory-returned typed carriers are still visible
  // Drizzle surfaces when project facts prove the value contains a pinned Postgres receiver.
  return projectTypeContainsDrizzleReceiver(node.getType(), node, new Set(), 0);
}

function projectTypeContainsDrizzleReceiver(
  type: MorphType,
  location: Node,
  seen: Set<string>,
  depth: number,
): boolean {
  // SPEC §11.1: project-mode helper handoffs through typed containers stay visible as FW406 when
  // ts-morph proves a Postgres Drizzle database member, instead of relying on source carrier paths.
  if (depth > 4) return false;
  const typeText = type.getText(location);
  if (isDrizzleDatabaseType(type)) return true;
  if (seen.has(typeText)) return false;
  seen.add(typeText);

  for (const property of type.getProperties()) {
    const propertyType = property.getTypeAtLocation(location);
    if (isDrizzleDatabaseType(propertyType)) return true;
    if (projectTypeContainsDrizzleReceiver(propertyType, location, seen, depth + 1)) {
      return true;
    }
  }

  const arrayElementType = type.getArrayElementType();
  if (arrayElementType) {
    return projectTypeContainsDrizzleReceiver(arrayElementType, location, seen, depth + 1);
  }

  for (const elementType of type.getTupleElements()) {
    if (projectTypeContainsDrizzleReceiver(elementType, location, seen, depth + 1)) {
      return true;
    }
  }

  return false;
}

function receiverCarrierSymbolKeysForBody(
  body: Node,
  isReceiverIdentifier: (node: Node) => boolean,
): ReadonlySet<string> {
  const carrierSymbolKeys = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (isInsideNestedFunction(declaration, body)) continue;

      const name = declaration.getNameNode();
      if (!Node.isIdentifier(name)) continue;

      const symbolKey = resolvedSymbolKey(name.getSymbol());
      const initializer = declaration.getInitializer();
      if (!symbolKey || !initializer || carrierSymbolKeys.has(symbolKey)) continue;

      if (receiverReferenceInArgument(initializer, isReceiverIdentifier, carrierSymbolKeys)) {
        carrierSymbolKeys.add(symbolKey);
        changed = true;
      }
    }

    for (const expression of body.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (!isTouchBodyNode(expression, body)) continue;
      if (expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

      const left = unwrappedStaticExpressionNode(expression.getLeft());
      if (!Node.isIdentifier(left)) continue;

      const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(left));
      if (!symbolKey || carrierSymbolKeys.has(symbolKey)) continue;

      if (
        receiverReferenceInArgument(expression.getRight(), isReceiverIdentifier, carrierSymbolKeys)
      ) {
        carrierSymbolKeys.add(symbolKey);
        changed = true;
      }
    }
  }

  return carrierSymbolKeys;
}

function queryReceiverCarrierSymbolKeys(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): ReadonlySet<string> {
  const carrierSymbolKeys = new Set<string>();

  for (const callbackBody of queryCallbackBodies(body, queryReceiverMode(receiverReferences))) {
    for (const symbolKey of receiverCarrierSymbolKeysForBody(callbackBody, (node) =>
      isQueryReceiverIdentifier(node, receiverReferences),
    )) {
      carrierSymbolKeys.add(symbolKey);
    }
  }

  return carrierSymbolKeys;
}

function isIdentifierDeclarationPosition(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  if (Node.isParameterDeclaration(parent) && parent.getNameNode() === node) return true;
  if (Node.isVariableDeclaration(parent) && parent.getNameNode() === node) return true;
  if (Node.isBindingElement(parent) && parent.getNameNode() === node) return true;
  if (Node.isFunctionDeclaration(parent) && parent.getNameNode() === node) return true;

  return false;
}

function isPropertyNamePosition(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;

  if (Node.isPropertyAccessExpression(parent)) return true;
  if (
    (Node.isPropertyAssignment(parent) || Node.isMethodDeclaration(parent)) &&
    parent.getNameNode() === node
  ) {
    return true;
  }
  if (Node.isBindingElement(parent) && parent.getPropertyNameNode() === node) return true;

  return false;
}

function isAccessExpressionReceiver(node: Node): boolean {
  const parent = node.getParent();
  return (
    (Node.isPropertyAccessExpression(parent) || Node.isElementAccessExpression(parent)) &&
    parent.getExpression() === node
  );
}

function isInsideNestedFunction(node: Node, boundary: Node): boolean {
  if (node === boundary) return false;

  for (const ancestor of node.getAncestors()) {
    if (ancestor === boundary) return false;
    if (isFunctionLikeNode(ancestor)) return true;
  }

  return false;
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

  const symbol = symbolForIdentifierReference(node);
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

function isUnboundSourceReceiverName(node: Node | undefined): boolean {
  if (!node || !Node.isIdentifier(node)) return false;
  if (!isLikelyDrizzleReceiver(node.getText())) return false;
  const parent = node.getParent();
  if (
    Node.isShorthandPropertyAssignment(parent) &&
    parent.getNameNode() === node &&
    !parent.getValueSymbol()
  ) {
    return true;
  }
  const declarations = symbolForIdentifierReference(node)?.getDeclarations() ?? [];
  return declarations.every(isSelfShorthandPropertyDeclaration);
}

function isSelfShorthandPropertyDeclaration(declaration: Node): boolean {
  if (!Node.isIdentifier(declaration)) return false;
  const parent = declaration.getParent();
  return Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === declaration;
}

function symbolForIdentifierReference(node: Node): MorphSymbol | undefined {
  if (Node.isIdentifier(node)) {
    const parent = node.getParent();
    if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node) {
      return aliasedSymbol(parent.getValueSymbol() ?? node.getSymbol());
    }
  }

  return aliasedSymbol(node.getSymbol());
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
  if (isRestBindingElement(binding)) return false;

  const bindingName = binding.getNameNode();
  const propertyNameNode = binding.getPropertyNameNode();
  const propertyName = propertyNameNode ? propertyNameText(propertyNameNode) : undefined;
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
  const names = new Set<string>();
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionDeclaration(callback) ||
    Node.isFunctionExpression(callback) ||
    Node.isMethodDeclaration(callback)
  ) {
    for (const param of callback.getParameters()) {
      appendSourceReceiverBindingNames(param.getNameNode(), names);
    }
  }

  return [...names];
}

function sourceDestructuredReceiverReferences(callback: Node): QueryReceiverReferences {
  const names = new Set<string>();
  const symbolKeys = new Set<string>();
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionDeclaration(callback) ||
    Node.isFunctionExpression(callback) ||
    Node.isMethodDeclaration(callback)
  ) {
    for (const param of callback.getParameters()) {
      appendSourceDestructuredReceiverBinding(param.getNameNode(), names, symbolKeys);
    }
  }

  return { names, symbolKeys };
}

function sourceReceiverParameterRequirements(callback: Node): ReceiverParameterRequirement[] {
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback) &&
    !Node.isMethodDeclaration(callback)
  ) {
    return [];
  }

  return callback.getParameters().flatMap((parameter, index) => {
    const names = new Set<string>();
    appendSourceReceiverBindingNames(parameter.getNameNode(), names);
    return names.size > 0 ? [{ index, names: [...names], symbolKeys: [] }] : [];
  });
}

function appendSourceReceiverBindingNames(name: Node, names: Set<string>): void {
  if (Node.isIdentifier(name)) {
    if (isLikelyDrizzleReceiver(name.getText())) names.add(name.getText());
    return;
  }

  // SPEC §11.1: destructured source-mode receiver slots are not precise receiver proof. They are
  // tracked separately as FW406 surfaces instead of feeding read/write extraction.
}

function appendSourceDestructuredReceiverBinding(
  name: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (!Node.isObjectBindingPattern(name)) return;

  for (const element of name.getElements()) {
    if (isRestBindingElement(element)) continue;
    const binding = element.getNameNode();
    const propertyName = propertyNameText(element.getPropertyNameNode() ?? binding);

    if (!propertyName && Node.isIdentifier(binding) && isLikelyDrizzleReceiver(binding.getText())) {
      appendSourceDestructuredReceiverIdentifier(binding, names, symbolKeys);
      continue;
    }

    if (propertyName !== 'db' && propertyName !== 'tx') continue;
    if (Node.isIdentifier(binding)) {
      appendSourceDestructuredReceiverIdentifier(binding, names, symbolKeys);
    }
  }
}

function appendSourceDestructuredReceiverIdentifier(
  binding: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (!Node.isIdentifier(binding)) return;
  names.add(binding.getText());
  const symbolKey = resolvedSymbolKey(binding.getSymbol());
  if (symbolKey) symbolKeys.add(symbolKey);
}

function isSourceDestructuredReceiverIdentifier(
  node: Node | undefined,
  receiverReferences: QueryReceiverReferences,
): boolean {
  if (!node || !Node.isIdentifier(node)) return false;
  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
  if (symbolKey) return receiverReferences.symbolKeys.has(symbolKey);
  return receiverReferences.names.has(node.getText());
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
  const hasInsertSelect =
    operation === 'insert' && calls.some((call) => propertyAccessCallName(call) === 'select');
  const sources: ExtractedReadSource[] = [];

  for (const call of calls) {
    if (!isReadSourceCall(call)) continue;
    const sourceOperation = writeReadSourceOperation(call, chain, operation);
    if (!sourceOperation) continue;

    const tableArgument = call.getArguments()[0];
    const tableExpression = tableArgument ? tableExpressionText(tableArgument) : '';

    sources.push({
      operation: sourceOperation,
      tableExpression: tableExpression || UNRESOLVED_READ_SOURCE_EXPRESSION,
    });
  }

  // SPEC §10-§11: an opaque write read source is visible as FW406, not guessed.
  return sources.length > 0 || !hasInsertSelect
    ? sources
    : [{ operation: 'insert-select', tableExpression: UNRESOLVED_READ_SOURCE_EXPRESSION }];
}

function writeReadSourceOperation(
  call: CallExpression,
  chain: Node,
  operation: string,
): ExtractedReadSource['operation'] | undefined {
  if (operation === 'insert') {
    return callExpressionsInNode(chain).some(
      (candidate) => propertyAccessCallName(candidate) === 'select',
    )
      ? 'insert-select'
      : undefined;
  }

  // SPEC §11.1: drizzle Postgres `delete()` has no `.from()`/`.using()` chain method (PgDeleteBase
  // exposes only where/returning), so a `from(R)` descended from a delete chain is necessarily
  // inside a `.where()` predicate subquery and contributes R to the READ set as a `delete-predicate`
  // source instead of being silently dropped.
  if (operation === 'delete') {
    return callExpressionContinuesToChain(call, chain) ? undefined : 'delete-predicate';
  }

  if (operation !== 'update') return undefined;
  return callExpressionContinuesToChain(call, chain) ? 'update-from' : 'update-predicate';
}

function callExpressionContinuesToChain(call: CallExpression, chain: Node): boolean {
  let current: Node = call;

  while (current !== chain) {
    const parent = current.getParent();
    if (parent && Node.isPropertyAccessExpression(parent) && parent.getExpression() === current) {
      current = parent;
      continue;
    }
    if (parent && Node.isCallExpression(parent) && parent.getExpression() === current) {
      current = parent;
      continue;
    }
    return false;
  }

  return true;
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
  if (Node.isNumericLiteral(argument)) return argument.getText();
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
