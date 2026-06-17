export type {
  AlgebraicField,
  AlgebraicQueryShape,
  DerivationResult,
  OrderByColumn,
  PuntReason,
  Rowset,
  RowsetFilter,
  RowWitness,
  SymbolicEffect,
  SymbolicMatch,
  SymbolicValue,
} from '@kovojs/core/internal/derivation';
export type { DiagnosticCode } from '@kovojs/core';
export type {
  ReadSite,
  TouchGraph,
  TouchGraphEntry,
  TouchSite,
  UnresolvedWriteSite,
} from '@kovojs/core/internal/graph';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnosticDefinitionText, diagnosticDefinitions, type JsonValue } from '@kovojs/core';
import type {
  AlgebraicField,
  AlgebraicQueryShape,
  ArithOp,
  OrderByColumn,
  Rowset,
  RowsetFilter,
  RowWitness,
  SymbolicEffect,
  SymbolicMatch,
  SymbolicValue,
} from '@kovojs/core/internal/derivation';
import type { TouchGraph, TouchGraphEntry } from '@kovojs/core/internal/graph';
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
  type PropertyAssignment,
  type SourceFile,
  type VariableDeclaration,
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
  KovoDomainTableAnnotation,
  KovoTableAnnotation,
  KovoTableExtraConfig,
} from './drizzle-surface.js';
export { kovo } from './drizzle-surface.js';
import {
  isDrizzleDatabaseTypeName,
  isDrizzleTableFactoryName,
  isKovoExtraConfigCallName,
  type KovoDomainTableAnnotation,
  type KovoTableAnnotation,
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
  'kovo',
  'pgTable',
  'return',
  'switch',
  'while',
]);
const KV411_MESSAGE = 'Query read set includes an exempt table';
const UNRESOLVED_READ_SOURCE_EXPRESSION = '__kovoUnresolvedReadSource';
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
const DRIZZLE_STATIC_PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

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

type ExtractedTableAnnotation =
  | (KovoTableAnnotation & { name: string })
  | {
      name: string;
      unmapped: true;
    };

interface ExtractedTable {
  annotation: ExtractedTableAnnotation;
  columns: Readonly<Record<string, QueryShape>>;
  exported: boolean;
}

export function diagnosticsForQueryFacts(facts: readonly QueryFact[]): TouchGraphDiagnostic[] {
  return facts.flatMap((fact) => [...(fact.diagnostics ?? [])]);
}

// SPEC.md §11.1 (v1 scope): touch-graph facts require project-mode ts-morph type proof.
// The source-mode entry points and their name/shape heuristics were removed in
// v1-cleanup item 4; callers must supply a project SourceModuleContext and
// project-derived ExtractedFunction[] so receivers/tables are proven by TypeScript
// symbols/types, never by parameter names or pgTable("...") string literals.
function extractTouchGraphFromPreparedFiles(
  files: readonly SourceFileInput[],
  functionsForFile: (file: SourceFileInput) => ExtractedFunction[],
  sourceContext: SourceModuleContext,
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
    project.createSourceFile(projectSourceFileName(file.fileName), file.source, {
      overwrite: true,
    }),
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

function projectSourceFileName(fileName: string): string {
  // SPEC §11.1: project-mode receiver proof depends on TypeScript resolving Drizzle package
  // symbols. Anchor virtual source files under this package so root-launched and package-launched
  // Vitest runs resolve the same peer/dev dependency graph.
  return isAbsolute(fileName) ? fileName : join(DRIZZLE_STATIC_PROJECT_ROOT, fileName);
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
          callbackParameterSymbolKeys(fn),
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
          callbackParameterSymbolKeys(callback),
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
          callbackParameterSymbolKeys(callback.fn),
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
          callbackParameterSymbolKeys(callback.fn),
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
  paramSymbolKeys: ReadonlySet<string>,
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
      predicateFacts: extractPredicateFactsFromWriteChain(
        chain,
        (node) => projectTableNameForNode(node, tableNamesBySymbol, namespaceTableNames),
        paramSymbolKeys,
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
  // read surface. Other typed receiver `find*` calls remain visible as KV406.
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
  // expressions become KV406 instead of silently disappearing.
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

// SPEC.md §11.1 (v1 scope): query-fact extraction requires project-mode ts-morph type
// proof. The source-mode entry point and its heuristic query/function/table producers
// were removed in v1-cleanup item 4; callers must supply project-derived queries,
// context files, SourceModuleContext, and ExtractedFunction[].
function extractQueryFactsFromPreparedFiles(
  files: readonly SourceFileInput[],
  queriesForFile: (file: SourceFileInput) => readonly ExtractedQueryDefinition[],
  contextFiles: readonly SourceFileInput[],
  sourceContext: SourceModuleContext,
  functionsForFile: (file: SourceFileInput) => ExtractedFunction[],
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
      code: 'KV406',
      message: `${diagnosticDefinitions.KV406.message} Query local helper touches Drizzle table via ${write.operation}().`,
      severity: diagnosticDefinitions.KV406.severity,
      site: write.site,
    });
  }

  for (const unresolved of summary.unresolved) {
    diagnostics.push({
      code: 'KV406',
      message: `${diagnosticDefinitions.KV406.message} Query local helper has unresolved Drizzle ${unresolved.operation}().`,
      severity: diagnosticDefinitions.KV406.severity,
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

  // SPEC §11.1 (v1 scope): project receiver proof is restricted to known
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
  return (
    drizzleDatabaseTypeNames(type, new Set()).some(isDrizzleDatabaseTypeName) &&
    drizzleDatabaseTypeDeclarations(type, new Set()).some((declaration) =>
      isDrizzleOrmDeclaration(declaration),
    )
  );
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
  if (aliasName) names.add(aliasName);
  if (symbolName) names.add(symbolName);
  if (apparentSymbolName) names.add(apparentSymbolName);

  for (const baseType of type.getBaseTypes()) {
    for (const name of drizzleDatabaseTypeNames(baseType, seen)) names.add(name);
  }

  return [...names];
}

function drizzleDatabaseTypeDeclarations(type: MorphType, seen: Set<string>): Node[] {
  const key =
    type.getAliasSymbol()?.getFullyQualifiedName() ??
    type.getSymbol()?.getFullyQualifiedName() ??
    type.getText();
  if (seen.has(key)) return [];
  seen.add(key);

  return [
    ...(type.getAliasSymbol()?.getDeclarations() ?? []),
    ...(type.getSymbol()?.getDeclarations() ?? []),
    ...(type.getApparentType().getSymbol()?.getDeclarations() ?? []),
    ...type.getBaseTypes().flatMap((baseType) => drizzleDatabaseTypeDeclarations(baseType, seen)),
  ];
}

function isDrizzleDatabaseTypeNode(typeNode: Node): boolean {
  if (typeNode.getKind() !== SyntaxKind.TypeReference) return false;
  if (isDrizzleDatabaseType(typeNode.getType())) return true;

  const typeReference = typeNode.asKind(SyntaxKind.TypeReference);
  const typeNameSymbol = typeReference?.getTypeName().getSymbol();
  const symbol = typeNameSymbol?.getAliasedSymbol() ?? typeNameSymbol;
  if (!symbol || !isDrizzleDatabaseTypeName(symbol.getName())) return false;

  return symbol.getDeclarations().some((declaration) => isDrizzleOrmDeclaration(declaration));
}

function projectTableNamesBySymbol(
  sourceFiles: readonly SourceFile[],
): ReadonlyMap<string, string> {
  const namesBySymbol = new Map<string, string>();
  let nextTable = 0;

  for (const sourceFile of sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || !isProjectTableInitializerNode(initializer)) continue;

      const symbolKey = resolvedSymbolKey(declaration.getNameNode().getSymbol());
      if (!symbolKey) continue;

      namesBySymbol.set(symbolKey, `__kovoProjectTable${nextTable}`);
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
  // exact ts-morph branch symbols and lets unresolved branches degrade separately to KV406.
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

        const syntheticName = `__kovoProjectConditional${nextConditional}`;
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
  if (importDeclaration?.getModuleSpecifierValue().startsWith('drizzle-orm')) return true;

  const moduleDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ModuleDeclaration);
  const moduleName = moduleDeclaration?.getNameNode();
  return Node.isStringLiteral(moduleName) && moduleName.getLiteralText().startsWith('drizzle-orm');
}

function projectColumnShapesByTable(
  sourceFiles: readonly SourceFile[],
  tableNamesBySymbol: ReadonlyMap<string, string>,
): ReadonlyMap<string, Readonly<Record<string, QueryShape>>> {
  const shapes = new Map<string, Record<string, QueryShape>>();

  for (const sourceFile of sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer || !isProjectTableInitializerNode(initializer)) continue;

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

function isTableInitializerNode(initializer: Node): boolean {
  if (!Node.isCallExpression(initializer)) return false;
  const expression = initializer.getExpression();
  if (!Node.isIdentifier(expression)) return false;
  if (!isDrizzleTableFactoryName(expression.getText())) return false;

  return true;
}

function isProjectTableInitializerNode(initializer: Node): boolean {
  if (!Node.isCallExpression(initializer)) return false;
  const expression = unwrappedStaticExpressionNode(initializer.getExpression());
  const isTableFactory = Node.isIdentifier(expression)
    ? isDrizzleTableFactoryName(projectPgCoreIdentifierExportName(expression) ?? '')
    : Node.isPropertyAccessExpression(expression) &&
      isDrizzleTableFactoryNamespaceMember(expression);
  return isTableFactory;
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

function isKovoAnnotationCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  return Node.isIdentifier(expression) && isKovoExtraConfigCallName(expression.getText());
}

function tableNameArgument(initializer: Node): string | undefined {
  if (!Node.isCallExpression(initializer)) return undefined;
  const name = initializer.getArguments()[0];
  if (!name || !Node.isStringLiteral(name)) return undefined;
  return name.getLiteralText();
}

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
  // SPEC §11.1 (v1 scope): local query-helper receiver requirements are supplied by the project
  // pipeline (functionReceiverParametersByKey); there is no source-mode fallback. When a caller
  // omits them (e.g. a query with no local helpers), an empty map is the correct project view.
  const localFunctionsByKey: ReadonlyMap<string, readonly ReceiverParameterRequirement[]> =
    options.localFunctionReceiverParameters ?? new Map();
  const localFunctionKeys = new Set(localFunctionsByKey.keys());

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
    // SPEC §11.1 (v1 scope): query facts require project-mode ts-morph type proof; the
    // source-mode receiver/table heuristics were removed in v1-cleanup item 4.
    const receiverMode = options.receiverMode ?? 'project';
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
    const receiverReferences = queryCallbackReceiverReferences(bodyObject, receiverMode);
    // SPEC §11.1 (v1 scope): a destructured loader receiver slot (e.g. `{ db: reader }`) is not
    // type proof. When project mode cannot prove the destructured receiver via TypeScript symbols
    // (it is absent from the proven receiverReferences), it remains a fail-closed KV406 surface
    // rather than feeding read/write extraction. Drop the names project mode already proved so a
    // genuinely-typed destructured receiver (resolved into receiverReferences) does not double-fire.
    const destructuredCandidates = sourceQueryDestructuredReceiverNames(bodyObject);
    const sourceDestructuredReceiverReferences = unprovenDestructuredReceiverReferences(
      destructuredCandidates,
      receiverReferences,
    );
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
      // SPEC §11.1 (v1 scope): fail-closed KV406 for a destructured loader receiver slot that
      // project mode could not type-prove. This DETECTOR never produces a positive read/write
      // fact; it flags an un-analyzable Drizzle receiver surface so manual touches are required.
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
          code: 'KV406',
          message: `${diagnosticDefinitions.KV406.message} Query uses ${selectCallDisplayName(selectCall)} without an explicit projection.`,
          severity: diagnosticDefinitions.KV406.severity,
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
      code: 'KV406',
      message: `${diagnosticDefinitions.KV406.message} Query uses Drizzle relational query API without static projection.`,
      severity: diagnosticDefinitions.KV406.severity,
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
        code: 'KV406' as const,
        message: `${diagnosticDefinitions.KV406.message} Query uses unclassified Drizzle receiver call ${surface.displayName ?? `${surface.receiver.getText()}.${surface.name}`}().`,
        severity: diagnosticDefinitions.KV406.severity,
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
        code: 'KV406' as const,
        message: `${diagnosticDefinitions.KV406.message} Query uses project Drizzle receiver container surface ${surface.receiver.getText()}.${surface.name}().`,
        severity: diagnosticDefinitions.KV406.severity,
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
  // SPEC §11.1: helpers that receive the query loader's Drizzle receiver are an explicit KV406
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
          code: 'KV406' as const,
          message: `${diagnosticDefinitions.KV406.message} Query passes Drizzle receiver ${receiverName} to helper ${name}().`,
          severity: diagnosticDefinitions.KV406.severity,
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
          code: 'KV406' as const,
          message: `${diagnosticDefinitions.KV406.message} Query passes Drizzle receiver ${receiverName} to local helper ${staticExpressionPath(expression) ?? expression.getText()}().`,
          severity: diagnosticDefinitions.KV406.severity,
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
      code: 'KV406' as const,
      message: `${diagnosticDefinitions.KV406.message} Query uses detached Drizzle receiver method ${call.name}().`,
      severity: diagnosticDefinitions.KV406.severity,
      site: '',
    })),
  );
}

// SPEC §11.1 (v1 scope): fail-closed KV406 DETECTOR for destructured loader receiver slots that
// project mode could not type-prove. `receiverReferences` here are the unproven destructured
// bindings (see unprovenDestructuredReceiverReferences); this never produces a positive
// read/write fact, it only flags an un-analyzable Drizzle receiver surface.
function sourceDestructuredQueryReceiverDiagnostics(
  body: ObjectLiteralExpression,
  localFunctionKeys: ReadonlySet<string>,
  receiverReferences: QueryReceiverReferences,
): TouchGraphDiagnostic[] {
  if (receiverReferences.names.size === 0 && receiverReferences.symbolKeys.size === 0) return [];

  return queryCallbackBodies(body, 'project').flatMap((callbackBody) =>
    extractSourceReceiverSurfaceCallsFromBody(callbackBody, localFunctionKeys, (node) =>
      isSourceDestructuredReceiverIdentifier(node, receiverReferences),
    ).map((call) => ({
      code: 'KV406' as const,
      message: `${diagnosticDefinitions.KV406.message} Query uses an un-provable destructured Drizzle receiver surface ${call.name}() without project type proof.`,
      severity: diagnosticDefinitions.KV406.severity,
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
  // configs stay visible as KV406 rather than disappearing from query facts.
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isObjectLiteralExpression(expression)) return { body: expression, unresolved: false };
  if (mode === 'source') {
    return { unresolved: true };
  }

  if (Node.isConditionalExpression(expression)) {
    // SPEC §10.2/§11.1: whole query option conditionals are executable loader surfaces.
    // Keep the statically visible branch exact, but retain KV406 for opaque sibling branches.
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
  // KV406 instead of accepting a typed-but-invisible query body.
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
    // branches contribute exact callbacks; opaque branches remain KV406 instead of disappearing.
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
    // branches contribute exact callbacks; opaque branches stay visible as KV406.
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
    code: 'KV406',
    message: `${diagnosticDefinitions.KV406.message} Query load callback could not be statically resolved.`,
    severity: diagnosticDefinitions.KV406.severity,
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
  // shift loader/write parameters and must remain KV406 instead of fabricating Drizzle facts.
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
  // as KV406 surfaces via sourceDestructuredQueryReceiverDiagnostics instead of fabricating reads.
}

// SPEC §11.1 (v1 scope): collect destructured loader receiver bindings (e.g. `{ db: reader }`).
// These are name/property heuristics that never prove a receiver; they only seed the fail-closed
// KV406 detector below for receivers project mode could not prove via TypeScript symbols.
function sourceQueryDestructuredReceiverNames(
  body: ObjectLiteralExpression,
): QueryReceiverReferences {
  const names = new Set<string>();
  const symbolKeys = new Set<string>();

  for (const callback of queryLoadCallbackFunctions(body, 'project')) {
    const receiverParameter = queryCallbackParameterNodes(callback)[1];
    const receiver = receiverParameter?.getNameNode();
    if (receiver) appendSourceDestructuredReceiverBinding(receiver, names, symbolKeys);
  }

  return { names, symbolKeys };
}

// SPEC §11.1 (v1 scope): keep only the destructured receiver bindings that project mode did NOT
// type-prove. A genuinely-typed destructured receiver (e.g. `{ db }: Context` where Context.db is
// a Drizzle database) is already in the proven receiverReferences and must not also fail closed.
function unprovenDestructuredReceiverReferences(
  candidates: QueryReceiverReferences,
  proven: QueryReceiverReferences,
): QueryReceiverReferences {
  const names = new Set<string>();
  const symbolKeys = new Set<string>();

  for (const symbolKey of candidates.symbolKeys) {
    if (!proven.symbolKeys.has(symbolKey)) symbolKeys.add(symbolKey);
  }
  for (const name of candidates.names) {
    if (proven.names.has(name)) continue;
    names.add(name);
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

  const definition = diagnosticDefinitions.KV410;
  const message = diagnosticDefinitionText('KV410', { preferHelp: true });
  return opaquePaths.map((path) => ({
    code: 'KV410',
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
    code: 'KV406',
    message: `${diagnosticDefinitions.KV406.message} Query projection ${query}.${path} could not be resolved to a Drizzle column or typed sql<T> expression.`,
    severity: diagnosticDefinitions.KV406.severity,
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
      if (!isDomainExtractedTableAnnotation(table.annotation)) continue;
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
      if (isExemptExtractedTableAnnotation(table.annotation))
        exemptTables.add(table.annotation.name);
    }
  }

  if (exemptTables.size === 0) return [];

  return [
    {
      code: 'KV411',
      message: `${KV411_MESSAGE}. Tables: ${[...exemptTables].sort().join(', ')}.`,
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
    // SPEC §10-§11: non-DB objects must not fabricate relational read/KV406 facts.
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
          code: 'KV406' as const,
          message: `${diagnosticDefinitions.KV406.message} Query read source for db.${name}() could not be resolved to a Drizzle table.`,
          severity: diagnosticDefinitions.KV406.severity,
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
        code: 'KV406' as const,
        message: `${diagnosticDefinitions.KV406.message} Query relational read source could not be resolved to a Drizzle table.`,
        severity: diagnosticDefinitions.KV406.severity,
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
    if (isDomainExtractedTableAnnotation(table.annotation) && table.annotation.key === key.key) {
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

  // SPEC §11.1: visible Drizzle read surfaces belong in the touch graph, not KV406.
  for (const call of fn.readCalls) {
    const site =
      call.site ?? `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        if (isExemptExtractedTableAnnotation(table.annotation)) continue;
        if (isUnmappedTableAnnotation(table.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: call.operation,
            site,
          });
          continue;
        }
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
        if (isExemptExtractedTableAnnotation(table.annotation)) continue;
        if (isUnmappedTableAnnotation(table.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: call.operation,
            site,
          });
          continue;
        }
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
  // target itself is opaque and must degrade to KV406.
  for (const readSource of call.readSources) {
    const readTables = tables.get(readSource.tableExpression) ?? [];
    if (readTables.length > 0) {
      for (const readTable of readTables) {
        if (isExemptExtractedTableAnnotation(readTable.annotation)) continue;
        if (isUnmappedTableAnnotation(readTable.annotation)) {
          unresolved.push({
            code: 'KV404',
            operation: readSource.operation,
            site,
          });
          continue;
        }
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
  return [
    unresolved.code ?? '',
    unresolved.operation,
    unresolved.site,
    unresolved.domain ?? '',
  ].join('\0');
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

function tableAnnotation(initializer: Node): ExtractedTableAnnotation | null {
  if (!Node.isCallExpression(initializer)) return null;
  const annotationCall = initializer.getArguments().find(isKovoAnnotationCall);
  if (!annotationCall) {
    const tableName = tableNameArgument(initializer);
    return tableName
      ? { domain: defaultDomainForTableName(tableName), name: tableName }
      : { name: UNRESOLVED_READ_SOURCE_EXPRESSION, unmapped: true };
  }
  if (!Node.isCallExpression(annotationCall)) return null;
  const annotationObject = annotationCall.getArguments()[0];
  if (!annotationObject || !Node.isObjectLiteralExpression(annotationObject)) return null;

  const tableName = tableNameArgument(initializer) ?? UNRESOLVED_READ_SOURCE_EXPRESSION;
  if (booleanPropertyFromObject(annotationObject, 'exempt') === true) {
    return { exempt: true, name: tableName };
  }
  const domain = stringPropertyFromObject(annotationObject, 'domain');
  if (!domain) return null;
  const key = stringPropertyFromObject(annotationObject, 'key');
  return { domain, ...(key ? { key } : {}), name: tableName };
}

function defaultDomainForTableName(tableName: string): string {
  // SPEC §10.1: tables default to their same-name domain. Existing fixtures and plan ledger use
  // singular domain names for simple plural table names such as `carts` -> `cart`.
  return tableName.length > 1 && tableName.endsWith('s') ? tableName.slice(0, -1) : tableName;
}

function isDomainExtractedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is KovoDomainTableAnnotation & { name: string } {
  return 'domain' in annotation;
}

function isExemptExtractedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is { exempt: true; name: string } {
  return 'exempt' in annotation && annotation.exempt === true;
}

function isUnmappedTableAnnotation(
  annotation: ExtractedTableAnnotation,
): annotation is { name: string; unmapped: true } {
  return 'unmapped' in annotation && annotation.unmapped === true;
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
    annotation: ExtractedTableAnnotation;
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

      const annotation = isTableInitializerNode(initializer) ? tableAnnotation(initializer) : null;
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
      if (!initializer || !isProjectTableInitializerNode(initializer)) continue;

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

function functionReceiverParametersByKey(
  functions: Iterable<Pick<ExtractedFunction, 'key' | 'receiverParameters'>>,
): ReadonlyMap<string, readonly ReceiverParameterRequirement[]> {
  return new Map([...functions].map((fn) => [fn.key, fn.receiverParameters]));
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
  // followed through ts-morph symbols, while opaque aliases stay visible as KV406.
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
  // extraction. Unresolved non-literal action objects must therefore degrade to KV406.
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
    // must stay visible as KV406 instead of disappearing from the mutation graph.
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
  // concrete property declarations, keep that surface visible as KV406 instead of assuming empty.
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
    // write branches contribute touches, while opaque branches remain named KV406 entries.
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

interface ExternalDbArgumentCall {
  index: number;
  name: string;
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
    // so it must degrade to KV406 instead of disappearing from the static surface.
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
  // destructured receiver methods, so they degrade through the same KV406 alias path.
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
  // SPEC §10-§11: direct receiver calls not statically classified are explicit KV406 surfaces.
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

function receiverReferenceInArgument(
  argument: Node,
  isReceiverIdentifier: (node: Node) => boolean,
  carrierSymbolKeys: ReadonlySet<string> = new Set(),
  isReceiverMemberExpression?: (node: Node) => boolean,
  isReceiverContainerExpression?: (node: Node) => boolean,
): Node | undefined {
  // SPEC §10-§11: opaque helper handoffs may hide Drizzle work, so receiver values passed inside
  // containers degrade to KV406 while classified receiver call chains remain separately analyzed.
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
  // SPEC §11.1: project-mode helper handoffs through typed containers stay visible as KV406 when
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

function symbolForIdentifierReference(node: Node): MorphSymbol | undefined {
  if (Node.isIdentifier(node)) {
    const parent = node.getParent();
    if (Node.isShorthandPropertyAssignment(parent) && parent.getNameNode() === node) {
      return aliasedSymbol(parent.getValueSymbol() ?? node.getSymbol());
    }
  }

  return aliasedSymbol(node.getSymbol());
}

function receiverParameterDeclaration(declaration: Node): ParameterDeclaration | null {
  if (Node.isParameterDeclaration(declaration)) return declaration;
  if (Node.isIdentifier(declaration)) {
    const parent = declaration.getParent();
    if (Node.isParameterDeclaration(parent)) return parent;
  }

  return null;
}

// SPEC §11.1 (v1 scope): collect destructured receiver bindings for the FAIL-CLOSED KV406
// detector only. The db/tx name/property heuristic here never proves a receiver or produces a
// read/write fact; unprovenDestructuredReceiverReferences later drops any binding project mode
// already type-proved, so only un-analyzable destructured receivers reach the KV406 surface.
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
  // SPEC §11.1 (v1 scope): this canonical db/tx name heuristic is NOT receiver proof and never
  // produces a read/write fact. It only seeds the fail-closed KV406 detector for destructured
  // loader receiver slots that project-mode ts-morph could not type-prove.
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

  // SPEC §10-§11: an opaque write read source is visible as KV406, not guessed.
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
  table: KovoDomainTableAnnotation,
): ExtractedPredicateSummary {
  if (!table.key) return {};

  const keyColumns = tableKeyColumns(table.key);
  const keyFacts = keyColumns.map((key) =>
    facts.find((fact) => fact.tableIdentifier === tableIdentifier && fact.key === key),
  );
  const argumentKeys = keyFacts.map((fact) => fact?.argumentKey);
  if (
    argumentKeys.length === keyColumns.length &&
    argumentKeys.every((argumentKey): argumentKey is string => argumentKey !== undefined)
  ) {
    return { key: argumentKeys.join(',') };
  }

  return keyFacts.some((fact) => fact?.predicate === 'non-eq') ? { predicate: 'non-eq' } : {};
}

function tableKeyColumns(key: string): string[] {
  return key
    .split(',')
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
}

function extractPredicateFactsFromWriteChain(
  chain: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string> = new Set(),
): ExtractedPredicateFact[] {
  const facts: ExtractedPredicateFact[] = [];
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const whereCall = calls.find((call) => propertyAccessCallName(call) === 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return facts;

  const parameterizedKeys = extractParameterizedKeys(predicate, resolveIdentifier, paramSymbolKeys);
  facts.push(...parameterizedKeys);

  if (!eqPredicateConjuncts(predicate)) {
    for (const reference of tableKeyReferences(predicate, resolveIdentifier)) {
      facts.push({ ...reference, predicate: 'non-eq' });
    }
  }

  return dedupePredicateFacts(facts);
}

function extractParameterizedKeys(
  predicate: Node,
  resolveIdentifier?: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string> = new Set(),
): ExtractedPredicateFact[] {
  const conjuncts = eqPredicateConjuncts(predicate);
  if (!conjuncts) return [];

  const facts: ExtractedPredicateFact[] = [];
  for (const { left, right } of conjuncts) {
    const leftKey = tableKeyReference(left, resolveIdentifier);
    const rightArgument = argumentKey(right, paramSymbolKeys);
    if (leftKey) {
      facts.push(
        rightArgument
          ? { ...leftKey, argumentKey: rightArgument }
          : { ...leftKey, predicate: 'non-eq' },
      );
      continue;
    }

    const rightKey = tableKeyReference(right, resolveIdentifier);
    const leftArgument = argumentKey(left, paramSymbolKeys);
    if (rightKey) {
      facts.push(
        leftArgument
          ? { ...rightKey, argumentKey: leftArgument }
          : { ...rightKey, predicate: 'non-eq' },
      );
    }
  }

  return facts;
}

interface EqPredicateConjunct {
  left: Node;
  right: Node;
}

function eqPredicateConjuncts(node: Node): EqPredicateConjunct[] | null {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isCallExpression(expression)) return null;

  const callee = expression.getExpression();
  if (!Node.isIdentifier(callee)) return null;
  const name = callee.getText();

  if (name === 'and') {
    const conjuncts: EqPredicateConjunct[] = [];
    for (const argument of expression.getArguments()) {
      const nested = eqPredicateConjuncts(argument);
      if (!nested) return null;
      conjuncts.push(...nested);
    }
    return conjuncts;
  }

  if (name !== 'eq') return null;
  const [left, right] = expression.getArguments();
  return left && right ? [{ left, right }] : null;
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

function argumentKey(expression: Node, paramSymbolKeys: ReadonlySet<string>): string | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (Node.isIdentifier(node)) {
    const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(node));
    return symbolKey && paramSymbolKeys.has(symbolKey) ? `arg:${node.getText()}` : undefined;
  }
  if (!Node.isPropertyAccessExpression(node)) return undefined;

  const base = unwrappedStaticExpressionNode(node.getExpression());
  if (!Node.isIdentifier(base)) return undefined;
  const symbolKey = resolvedSymbolKey(symbolForIdentifierReference(base));
  if (!symbolKey || !paramSymbolKeys.has(symbolKey)) return undefined;

  return `arg:${node.getName()}`;
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

// ───────────────────────────────────────────────────────────────────────────
// SPEC.md §10.5 derivation extraction (Stage 1 write→effect, Stage 2 query→shape).
//
// These project-mode extractors lower real Drizzle write/query source into the
// shared `SymbolicEffect` / `AlgebraicQueryShape` IR (`@kovojs/core/derivation`)
// that the source-agnostic Stage-3 deriver (`@kovojs/drizzle/derive`) consumes.
// They REUSE the same ts-morph project, table-symbol resolution, write-chain
// predicate extraction, and select-shape classification used by the touch-graph
// and query-fact extractors above — never name/string heuristics (project mode
// only, v1-cleanup item 4). Per §10.5 these are conservative: anything that
// cannot be PROVEN traceable lowers to `Opaque`/punt so the deriver degrades
// rather than emitting an unsound prediction.
// ───────────────────────────────────────────────────────────────────────────

/** One extracted Stage-1 effect with its source site and resolvable write key (domain.action). */
export interface SymbolicEffectFact {
  effect: SymbolicEffect;
  site: string;
  /** The `domain.action` / function key when the write site is a resolvable handler. */
  writeKey?: string;
}

interface DeriveExtraction extends ProjectExtraction {
  realTableNameBySynthetic: ReadonlyMap<string, string>;
  tablesBySyntheticName: ReadonlyMap<string, ExtractedTable>;
}

/** A discovered write/query callback: its body node plus an optional resolvable key. */
interface DeriveCallback {
  body: Node;
  fn: Node;
  key?: string;
}

/** The instance/primary-key column from a table annotation (null for exempt tables). */
function tableAnnotationKey(annotation: ExtractedTableAnnotation): string | null {
  return 'key' in annotation && annotation.key ? annotation.key : null;
}

function createDeriveExtraction(options: TouchGraphProjectOptions): DeriveExtraction {
  const base = createProjectExtraction(options);
  const tablesBySyntheticName = projectTablesBySyntheticName(base);
  const realTableNameBySynthetic = new Map<string, string>();
  for (const [synthetic, table] of tablesBySyntheticName) {
    realTableNameBySynthetic.set(synthetic, table.annotation.name);
  }
  return { ...base, realTableNameBySynthetic, tablesBySyntheticName };
}

/**
 * SPEC.md §10.5 Stage 1 — lower every project-mode Drizzle write call into the
 * symbolic `effect` grammar (`INSERT{vals} | UPDATE{match,sets} | DELETE{match}
 * | UPSERT{…}`). The `.values()` / `.set()` payloads (which the touch-graph
 * write extractor discards) are parsed here into `SymbolicValue`s; an
 * unresolvable table emits the unresolved marker so the deriver's `unsupported`
 * punt fires (never a crash).
 */
export function extractSymbolicEffectsFromProject(
  options: TouchGraphProjectOptions,
): SymbolicEffectFact[] {
  const extraction = createDeriveExtraction(options);
  try {
    const facts: SymbolicEffectFact[] = [];
    extraction.sourceFiles.forEach((sourceFile, index) => {
      const file = extraction.files[index];
      if (!file) return;

      const namespaceTableNames = projectNamespaceTableNamesByLocal(
        sourceFile,
        extraction.tableNamesBySymbol,
      );
      const resolveTable = (node: Node): string | undefined => {
        const synthetic = projectTableNameForNode(
          node,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
        );
        if (!synthetic) return undefined;
        return extraction.realTableNameBySynthetic.get(synthetic) ?? synthetic;
      };

      for (const callback of deriveWriteCallbacks(sourceFile)) {
        const receivers = projectDrizzleReceivers(callback.fn);
        const paramSymbolKeys = callbackParameterSymbolKeys(callback.fn);
        for (const call of touchBodyCallExpressions(callback.body)) {
          const fact = symbolicEffectForWriteCall(call, {
            file,
            paramSymbolKeys,
            receivers,
            resolveTable,
            ...(callback.key ? { writeKey: callback.key } : {}),
          });
          if (fact) facts.push(fact);
        }
      }
    });
    return dedupeEffectFacts(facts);
  } finally {
    extraction.dispose();
  }
}

/** All callback bodies in a file that may carry a Drizzle write call, with resolvable keys. */
function deriveWriteCallbacks(sourceFile: SourceFile): DeriveCallback[] {
  const callbacks: DeriveCallback[] = [];
  const seen = new Set<number>();
  const push = (fn: Node | undefined, key?: string): void => {
    if (!fn) return;
    let body: Node;
    try {
      body = functionBody(fn);
    } catch {
      return;
    }
    if (seen.has(fn.getStart())) return;
    seen.add(fn.getStart());
    callbacks.push(key === undefined ? { body, fn } : { body, fn, key });
  };

  // domain({ action: write(async (db, ...) => { ... }) }) → key `domain.action`.
  for (const callback of projectDomainWriteCallbacks(sourceFile).values()) {
    push(callback.fn, callback.name);
  }
  // Top-level function declarations / variable-assigned callbacks.
  for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    push(fn, fn.getName());
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (!Node.isIdentifier(name) || !initializer) continue;
    push(unwrappedFunctionExpression(initializer), name.getText());
  }
  // Object-literal method/property callbacks and class static members (no domain key).
  for (const callback of [
    ...projectObjectLiteralCallbacks(sourceFile),
    ...projectClassStaticMemberCallbacks(sourceFile),
  ]) {
    push(callback.fn);
  }

  return callbacks;
}

interface WriteCallContext {
  file: SourceFileInput;
  paramSymbolKeys: ReadonlySet<string>;
  receivers: ProjectDrizzleReceivers;
  resolveTable: (node: Node) => string | undefined;
  writeKey?: string;
}

function symbolicEffectForWriteCall(
  call: CallExpression,
  context: WriteCallContext,
): SymbolicEffectFact | undefined {
  if (!isDrizzleWriteCall(call)) return undefined;

  const expression = call.getExpression();
  const operation = staticAccessName(expression);
  const receiver = staticAccessExpression(expression);
  if (!operation || !receiver) return undefined;
  if (!isProjectDrizzleReceiverIdentifier(receiver, context.receivers)) return undefined;

  const tableArgument = call.getArguments()[0];
  if (!tableArgument) return undefined;

  const table = context.resolveTable(tableArgument) ?? UNRESOLVED_READ_SOURCE_EXPRESSION;
  const chain = drizzleWriteChainRoot(call);
  const site = `${context.file.fileName}:${lineForIndex(context.file.source, call.getStart())}`;
  // INSERT `.values()` has no row to self-reference; UPDATE/UPSERT `.set()` may use
  // `t.col` of the WRITTEN table to mean the row's own column (e.g. `stock - quantity`).
  const selfColumn: SelfColumnResolver = (node) => {
    const column = writeColumnReference(node, context.resolveTable);
    if (!column) return undefined;
    const base = staticAccessExpression(unwrappedStaticExpressionNode(node));
    return base && context.resolveTable(base) === table ? column : undefined;
  };
  const toValue = (node: Node): SymbolicValue =>
    symbolicValueFromExpression(node, context.paramSymbolKeys);
  const toSetValue = (node: Node): SymbolicValue =>
    symbolicValueFromExpression(node, context.paramSymbolKeys, selfColumn);
  const writeKeyEntry = context.writeKey ? { writeKey: context.writeKey } : {};

  if (operation === 'insert') {
    const values = chainValuesObject(chain, 'values', toValue);
    const conflict = chainOnConflictSets(chain, toSetValue);
    if (conflict) {
      const match = chainMatch(chain, context.resolveTable, context.paramSymbolKeys);
      return {
        effect: { match, op: 'upsert', sets: conflict, table, values },
        site,
        ...writeKeyEntry,
      };
    }
    return { effect: { op: 'insert', table, values }, site, ...writeKeyEntry };
  }

  if (operation === 'update') {
    const sets = chainValuesObject(chain, 'set', toSetValue);
    const match = chainMatch(chain, context.resolveTable, context.paramSymbolKeys);
    return { effect: { match, op: 'update', sets, table }, site, ...writeKeyEntry };
  }

  if (operation === 'delete') {
    const match = chainMatch(chain, context.resolveTable, context.paramSymbolKeys);
    return { effect: { match, op: 'delete', table }, site, ...writeKeyEntry };
  }

  return undefined;
}

/** Parse the object literal of a chained `.values({…})` / `.set({…})` into SymbolicValues. */
function chainValuesObject(
  chain: Node,
  method: 'set' | 'values',
  toValue: (node: Node) => SymbolicValue,
): Record<string, SymbolicValue> {
  const sets: Record<string, SymbolicValue> = {};
  const call = chainCallByName(chain, method);
  const argument = call?.getArguments()[0];
  if (!argument) return sets;
  const object = unwrappedStaticExpressionNode(argument);
  if (!Node.isObjectLiteralExpression(object)) return sets;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const column = propertyNameText(property.getNameNode());
    if (!column) continue;
    const valueNode = Node.isShorthandPropertyAssignment(property)
      ? property.getNameNode()
      : property.getInitializer();
    sets[column] = valueNode ? toValue(valueNode) : { kind: 'opaque', expr: column };
  }

  return sets;
}

/** `onConflictDoUpdate({ set: {…} })` → upsert sets (else undefined ⇒ plain INSERT). */
function chainOnConflictSets(
  chain: Node,
  toValue: (node: Node) => SymbolicValue,
): Record<string, SymbolicValue> | undefined {
  const call = chainCallByName(chain, 'onConflictDoUpdate');
  if (!call) return undefined;
  const config = call.getArguments()[0];
  if (!config) return {};
  const object = unwrappedStaticExpressionNode(config);
  if (!Node.isObjectLiteralExpression(object)) return {};

  const setProperty = object
    .getProperties()
    .find(
      (property): property is PropertyAssignment =>
        Node.isPropertyAssignment(property) && propertyNameText(property.getNameNode()) === 'set',
    );
  const setObject = setProperty ? setProperty.getInitializer() : undefined;
  if (!setObject || !Node.isObjectLiteralExpression(setObject)) return {};

  const sets: Record<string, SymbolicValue> = {};
  for (const property of setObject.getProperties()) {
    if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
      continue;
    }
    const column = propertyNameText(property.getNameNode());
    if (!column) continue;
    const valueNode = Node.isShorthandPropertyAssignment(property)
      ? property.getNameNode()
      : property.getInitializer();
    sets[column] = valueNode ? toValue(valueNode) : { kind: 'opaque', expr: column };
  }
  return sets;
}

/** A write `match` from `.where(eq(t.key, expr))`; ranges/IN/non-key/sql ⇒ opaque ⇒ punt. */
function chainMatch(
  chain: Node,
  resolveTable: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string>,
): SymbolicMatch {
  const whereCall = chainCallByName(chain, 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return { eq: [], kind: 'keys' };

  const eqMatches = keyEqMatchesFromPredicate(predicate, resolveTable, paramSymbolKeys);
  if (eqMatches) return { eq: eqMatches, kind: 'keys' };
  return { expr: predicate.getText(), kind: 'opaque' };
}

/**
 * AND-of-`eq(t.col, value)` predicates → key matches, or `null` when ANY conjunct
 * is a non-eq predicate (range / IN / sql / function) ⇒ opaque match ⇒ punt.
 */
function keyEqMatchesFromPredicate(
  predicate: Node,
  resolveTable: (node: Node) => string | undefined,
  paramSymbolKeys: ReadonlySet<string>,
): { column: string; value: SymbolicValue }[] | null {
  const conjuncts = eqPredicateConjuncts(predicate);
  if (!conjuncts) return null;

  const matches: { column: string; value: SymbolicValue }[] = [];
  for (const { left, right } of conjuncts) {
    const leftColumn = writeColumnReference(left, resolveTable);
    const rightColumn = writeColumnReference(right, resolveTable);
    const column = leftColumn ?? rightColumn;
    const valueNode = leftColumn ? right : left;
    if (!column || !valueNode) return null;

    const value = symbolicValueFromExpression(valueNode, paramSymbolKeys);
    if (value.kind === 'opaque') return null;
    matches.push({ column, value });
  }

  return matches;
}

/** Resolve a `t.col` / `t['col']` reference whose base resolves to a known table → its column. */
function writeColumnReference(
  node: Node,
  resolveTable: (node: Node) => string | undefined,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isPropertyAccessExpression(expression) && !Node.isElementAccessExpression(expression)) {
    return undefined;
  }
  const base = expression.getExpression();
  if (!resolveTable(base)) return undefined;
  return staticAccessName(expression);
}

/** Optional self-reference resolver: `t.col` of the written table → its column name. */
type SelfColumnResolver = (node: Node) => string | undefined;

/**
 * SPEC.md §10.5 Stage-1 `value` grammar. Conservatively maps an expression node:
 * literal → Const; identifier/property-access traceable to a handler param/session
 * key → Param(path); `t.col` of the written table (in a SET) → ColRef; binary
 * `+ - * /` of mappable operands → Arith; everything else (calls, server
 * computation, untraceable identifiers) → Opaque (the deriver placeholders Opaque
 * INSERT cols and punts Opaque SET/match).
 */
function symbolicValueFromExpression(
  node: Node,
  paramSymbolKeys: ReadonlySet<string>,
  selfColumn?: SelfColumnResolver,
): SymbolicValue {
  const expression = unwrappedStaticExpressionNode(node);

  // Const literals.
  const literal = literalJsonValue(expression);
  if (literal !== undefined) return { kind: 'const', value: literal.value };

  // ColRef self-reference: `t.col` of the written table (e.g. `stock - quantity`).
  const selfRef = selfColumn?.(expression);
  if (selfRef) return { column: selfRef, kind: 'col' };

  // Arith of mappable operands.
  if (Node.isBinaryExpression(expression)) {
    const op = arithOperator(expression.getOperatorToken().getText());
    if (op) {
      const left = symbolicValueFromExpression(expression.getLeft(), paramSymbolKeys, selfColumn);
      const right = symbolicValueFromExpression(expression.getRight(), paramSymbolKeys, selfColumn);
      if (left.kind !== 'opaque' && right.kind !== 'opaque') {
        return { kind: 'arith', left, op, right };
      }
    }
    return { kind: 'opaque', expr: expression.getText() };
  }

  // Param(path): identifier or property-access whose root resolves to a handler param.
  const paramPath = paramPathForExpression(expression, paramSymbolKeys);
  if (paramPath) return { kind: 'param', path: paramPath };

  // Runtime-valid column arithmetic: `sql`${t.col} - ${quantity}`` (the way real
  // drizzle expresses a self-referential SET, since JS `-` on a column is invalid).
  const sqlArith = sqlTemplateArith(expression, paramSymbolKeys, selfColumn);
  if (sqlArith) return sqlArith;

  return { kind: 'opaque', expr: expression.getText() };
}

/** Parse `sql`${A} <op> ${B}`` (a two-interpolation binary template) into an Arith value. */
function sqlTemplateArith(
  node: Node,
  paramSymbolKeys: ReadonlySet<string>,
  selfColumn?: SelfColumnResolver,
): SymbolicValue | undefined {
  if (!Node.isTaggedTemplateExpression(node)) return undefined;
  const tag = node.getTag();
  if (!Node.isIdentifier(tag) || tag.getText() !== 'sql') return undefined;
  const template = node.getTemplate();
  if (!Node.isTemplateExpression(template)) return undefined;
  if (template.getHead().getLiteralText().trim() !== '') return undefined;

  const spans = template.getTemplateSpans();
  if (spans.length !== 2) return undefined;
  const [first, second] = spans;
  if (!first || !second) return undefined;
  if (second.getLiteral().getLiteralText().trim() !== '') return undefined;

  const op = arithOperator(first.getLiteral().getLiteralText().trim());
  if (!op) return undefined;
  const left = symbolicValueFromExpression(first.getExpression(), paramSymbolKeys, selfColumn);
  const right = symbolicValueFromExpression(second.getExpression(), paramSymbolKeys, selfColumn);
  if (left.kind === 'opaque' || right.kind === 'opaque') return undefined;
  return { kind: 'arith', left, op, right };
}

/** Trace an identifier/property-access to a handler param and return its dot-path, else undefined. */
function paramPathForExpression(
  node: Node,
  paramSymbolKeys: ReadonlySet<string>,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isIdentifier(expression)) {
    return symbolIsParameter(expression, paramSymbolKeys) ? expression.getText() : undefined;
  }
  if (Node.isPropertyAccessExpression(expression) || Node.isElementAccessExpression(expression)) {
    const name = staticAccessName(expression);
    if (!name) return undefined;
    const base = paramPathForExpression(expression.getExpression(), paramSymbolKeys);
    return base ? `${base}.${name}` : undefined;
  }
  return undefined;
}

function symbolIsParameter(node: Node, paramSymbolKeys: ReadonlySet<string>): boolean {
  // A shorthand `{ id }` name identifier resolves to the PROPERTY symbol, not the
  // referenced variable; use the shorthand's value symbol to reach the param.
  const parent = node.getParent();
  const symbol =
    parent && Node.isShorthandPropertyAssignment(parent)
      ? (parent.getValueSymbol() ?? node.getSymbol())
      : node.getSymbol();
  const symbolKey = resolvedSymbolKey(symbol);
  return symbolKey !== undefined && paramSymbolKeys.has(symbolKey);
}

/** Symbol keys of the leading non-receiver parameters of a write/handler callback. */
function callbackParameterSymbolKeys(fn: Node): Set<string> {
  const keys = new Set<string>();
  for (const parameter of queryCallbackParameterNodes(fn)) {
    if (isDrizzleDatabaseTypeAnnotation(parameter)) continue;
    const nameNode = parameter.getNameNode();
    // Destructured input — `handler({ productId, quantity }, request)` — binds each
    // field as a top-level $input param (path = the binding name, the $input field).
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const key = resolvedSymbolKey(element.getNameNode().getSymbol());
        if (key) keys.add(key);
      }
      continue;
    }
    const symbolKey = resolvedSymbolKey(nameNode.getSymbol());
    if (symbolKey) keys.add(symbolKey);
  }
  return keys;
}

function arithOperator(token: string): ArithOp | undefined {
  if (token === '+' || token === '-' || token === '*' || token === '/') return token;
  return undefined;
}

function literalJsonValue(node: Node): { value: JsonValue } | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    return { value: expression.getLiteralText() };
  }
  if (Node.isNumericLiteral(expression)) return { value: Number(expression.getLiteralText()) };
  if (expression.getKind() === SyntaxKind.TrueKeyword) return { value: true };
  if (expression.getKind() === SyntaxKind.FalseKeyword) return { value: false };
  if (expression.getKind() === SyntaxKind.NullKeyword) return { value: null };
  if (
    Node.isPrefixUnaryExpression(expression) &&
    expression.getOperatorToken() === SyntaxKind.MinusToken
  ) {
    const operand = expression.getOperand();
    if (Node.isNumericLiteral(operand)) return { value: -Number(operand.getLiteralText()) };
  }
  return undefined;
}

/** Find the chained call by method name within a write chain (`.values`, `.where`, …). */
function chainCallByName(chain: Node, method: string): CallExpression | undefined {
  const calls = [
    ...(Node.isCallExpression(chain) ? [chain] : []),
    ...chain.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  return calls.find((call) => propertyAccessCallName(call) === method);
}

function dedupeEffectFacts(facts: readonly SymbolicEffectFact[]): SymbolicEffectFact[] {
  const seen = new Set<string>();
  const deduped: SymbolicEffectFact[] = [];
  for (const fact of facts) {
    const key = `${fact.site}\0${fact.writeKey ?? ''}\0${JSON.stringify(fact.effect)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fact);
  }
  return deduped;
}

// ── Stage 2 (query → AlgebraicQueryShape) ────────────────────────────────────

interface QueryShapeContextForTable {
  columnsByTable: (table: string) => Readonly<Record<string, QueryShape>> | undefined;
  keyByTable: (table: string) => string | null;
  paramSymbolKeys: ReadonlySet<string>;
  resolveTable: (node: Node) => string | undefined;
}

/**
 * SPEC.md §10.5 Stage 2 — classify each invalidated query's result into the
 * `field ::= Scalar | COUNT(R[,pred]) | SUM(R,arith) | AGG(R,projection)`
 * algebra (`R = rowset(filter chain, key, orderBy)`), layered OVER the existing
 * `extractQueryFactsFromProject` (which keeps the raw inferred shape the binding
 * validators depend on). Out-of-grammar shapes (window / GROUP BY+HAVING /
 * DISTINCT / raw `sql<T>` projection / interprocedural KV406) classify as
 * `opaque` carrying the matching §10.5 `PuntReason`.
 */
export function extractAlgebraicShapesFromProject(
  options: TouchGraphProjectOptions,
): AlgebraicQueryShape[] {
  const extraction = createDeriveExtraction(options);
  try {
    const keyByRealTable = new Map<string, string | null>();
    const columnsByRealTable = new Map<string, Readonly<Record<string, QueryShape>>>();
    for (const table of extraction.tablesBySyntheticName.values()) {
      keyByRealTable.set(table.annotation.name, tableAnnotationKey(table.annotation));
      columnsByRealTable.set(table.annotation.name, table.columns);
    }

    const shapes: AlgebraicQueryShape[] = [];
    extraction.sourceFiles.forEach((sourceFile, index) => {
      const file = extraction.files[index];
      if (!file) return;

      const namespaceTableNames = projectNamespaceTableNamesByLocal(
        sourceFile,
        extraction.tableNamesBySymbol,
      );
      const resolveTable = (node: Node): string | undefined => {
        const synthetic = projectTableNameForNode(
          node,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
        );
        if (!synthetic) return undefined;
        return extraction.realTableNameBySynthetic.get(synthetic) ?? synthetic;
      };
      const context: QueryShapeContextForTable = {
        columnsByTable: (table) => columnsByRealTable.get(table),
        keyByTable: (table) => keyByRealTable.get(table) ?? null,
        paramSymbolKeys: new Set(),
        resolveTable,
      };

      for (const { name, body, fn } of deriveQueryLoaders(sourceFile)) {
        const shape = algebraicShapeForLoader(name, body, fn, context);
        if (shape) shapes.push(shape);
      }
    });
    return shapes;
  } finally {
    extraction.dispose();
  }
}

/** Discover `query('name', { load(...) {...} })` definitions and their load callbacks. */
function deriveQueryLoaders(
  sourceFile: SourceFile,
): { body: ObjectLiteralExpression; fn: Node; name: string }[] {
  const loaders: { body: ObjectLiteralExpression; fn: Node; name: string }[] = [];
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const queryCall = unwrappedStaticExpressionNode(initializer);
    if (!Node.isCallExpression(queryCall)) continue;
    const expression = queryCall.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'query') continue;

    const [queryArgument, bodyArgument] = queryCall.getArguments();
    if (!queryArgument || !Node.isStringLiteral(queryArgument)) continue;
    const body = queryBodyObjectLiteral(bodyArgument, 'project').body;
    if (!body) continue;

    const callbacks = queryLoadCallbackFunctions(body, 'project');
    const fn = callbacks[0];
    if (!fn) continue;
    loaders.push({ body: body, fn, name: queryArgument.getLiteralText() });
  }
  return loaders;
}

function algebraicShapeForLoader(
  query: string,
  body: ObjectLiteralExpression,
  fn: Node,
  context: QueryShapeContextForTable,
): AlgebraicQueryShape | undefined {
  const loaderContext: QueryShapeContextForTable = {
    ...context,
    paramSymbolKeys: callbackParameterSymbolKeys(fn),
  };
  const returned = loaderReturnExpression(fn);
  if (!returned) return undefined;

  const fields: Record<string, AlgebraicField> = {};
  const rowsByTable: Record<string, RowWitness> = {};

  // Object-returning loader: classify each property as its own algebraic field.
  const object = unwrappedStaticExpressionNode(returned);
  if (Node.isObjectLiteralExpression(object)) {
    for (const property of object.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const path = propertyNameText(property.getNameNode());
      const valueNode = property.getInitializer();
      if (!path || !valueNode) continue;

      const classified = classifyField(path, valueNode, object, loaderContext);
      if (!classified) continue;
      fields[path] = classified.field;
      if (classified.rowWitness) {
        rowsByTable[classified.rowWitness.table] = {
          columns: classified.rowWitness.columns,
          rowsPath: classified.rowWitness.rowsPath,
        };
      }
    }
  } else {
    // Single-select loader: the whole result is the rows array of one AGG field.
    const classified = classifyField('', object, undefined, loaderContext);
    if (classified) {
      fields[''] = classified.field;
      if (classified.rowWitness) {
        rowsByTable[classified.rowWitness.table] = {
          columns: classified.rowWitness.columns,
          rowsPath: classified.rowWitness.rowsPath,
        };
      }
    }
  }

  if (Object.keys(fields).length === 0) return undefined;
  return {
    fields,
    query,
    ...(Object.keys(rowsByTable).length > 0 ? { rowsByTable } : {}),
  };
}

interface ClassifiedField {
  field: AlgebraicField;
  rowWitness?: RowWitness & { table: string };
}

/** Classify one result-object property into an AlgebraicField (+ optional rows witness). */
function classifyField(
  path: string,
  valueNode: Node,
  object: ObjectLiteralExpression | undefined,
  context: QueryShapeContextForTable,
): ClassifiedField | undefined {
  // Cursor: a property derived from the last row of a paginated rows sibling.
  const cursorRowset = object ? cursorRowsetForExpression(valueNode, object, context) : undefined;
  if (cursorRowset) return { field: { kind: 'cursor', rowset: cursorRowset } };

  // Real-loader scalar: a single-row scalar projection of an aggregate select,
  // e.g. `Number(rows[0]?.value ?? 0)` / `(await db.select({ value: sum(t.c) }))[0].value`,
  // where the runtime loader awaits + projects the [{ value }] aggregate result.
  const scalar = scalarProjectionField(valueNode, context);
  if (scalar) return scalar;

  const select = selectChainForExpression(valueNode);
  if (!select) return undefined;

  // DISTINCT shape ⇒ out-of-grammar punt.
  const selectName = staticAccessName(select.selectCall.getExpression());
  if (selectName === 'selectDistinct' || selectName === 'selectDistinctOn') {
    return { field: { kind: 'opaque', reason: { code: 'opaque-shape', shape: 'distinct' } } };
  }
  // GROUP BY (+HAVING) ⇒ out-of-grammar punt.
  if (chainCallByName(select.chain, 'groupBy')) {
    return {
      field: { kind: 'opaque', reason: { code: 'opaque-shape', shape: 'group-by-having' } },
    };
  }

  const table = tableForSelect(select, context.resolveTable);
  if (!table) {
    return {
      field: {
        kind: 'opaque',
        reason: { code: 'interprocedural', site: select.selectCall.getText() },
      },
    };
  }
  const rowset = rowsetForSelect(select, table, context);

  const projection = selectProjectionArgument(select.selectCall);
  if (!projection || !Node.isObjectLiteralExpression(projection)) {
    // `db.select()` without explicit projection ⇒ interprocedural / un-analyzable.
    return {
      field: {
        kind: 'opaque',
        reason: { code: 'interprocedural', site: select.selectCall.getText() },
      },
    };
  }

  // Aggregate / scalar single-field projections.
  const single = projection.getProperties();
  if (single.length === 1) {
    const property = single[0];
    if (property && Node.isPropertyAssignment(property)) {
      const initializer = property.getInitializer();
      const aggregate = initializer
        ? aggregateField(initializer, rowset, table, context)
        : undefined;
      if (aggregate) return { field: aggregate };
    }
  }

  // Raw `sql<T>` projection anywhere ⇒ opaque-projection punt.
  for (const property of projection.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const initializer = property.getInitializer();
    if (initializer && isOpaqueProjection(initializer.compilerNode as ts.Expression)) {
      return {
        field: {
          kind: 'opaque',
          reason: { code: 'opaque-projection', expr: initializer.getText() },
        },
      };
    }
  }

  // Otherwise the property ships a full row array of `table` ⇒ AGG.
  const columns = projectionColumns(projection, table, context.resolveTable);
  if (!columns) {
    return {
      field: {
        kind: 'opaque',
        reason: { code: 'interprocedural', site: select.selectCall.getText() },
      },
    };
  }
  const columnTypes = projectionColumnTypes(columns.columns, table, context);
  const field: AlgebraicField = {
    kind: 'agg',
    projection: columns.columns,
    ...(rowset.key ? { rowKey: rowset.key } : {}),
    rowset,
    ...(Object.keys(columnTypes).length > 0 ? { columnTypes } : {}),
  };
  return {
    field,
    rowWitness: { columns: columns.columns, rowsPath: path, table },
  };
}

interface SelectChain {
  chain: Node;
  selectCall: CallExpression;
}

/** Resolve a `db.select(…).from(T)…` chain that produces a value (await-unwrapped). */
function selectChainForExpression(node: Node): SelectChain | undefined {
  const expression = resolveValueExpression(node);
  if (!Node.isCallExpression(expression)) return undefined;

  const selectCall = expression
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .concat([expression])
    .find((call) => isSelectQueryCallName(staticAccessName(call.getExpression())));
  if (!selectCall) return undefined;
  return { chain: expression, selectCall };
}

/** Unwrap await/parens and resolve a same-scope `const x = <expr>` identifier to its initializer. */
function resolveValueExpression(node: Node, depth = 0): Node {
  let expression = unwrappedStaticExpressionNode(node);
  if (Node.isAwaitExpression(expression)) {
    return resolveValueExpression(expression.getExpression(), depth);
  }
  if (Node.isIdentifier(expression) && depth < 4) {
    const declaration = expression
      .getSymbol()
      ?.getDeclarations()
      .find((candidate): candidate is VariableDeclaration => Node.isVariableDeclaration(candidate));
    const initializer = declaration?.getInitializer();
    if (initializer) return resolveValueExpression(initializer, depth + 1);
  }
  return expression;
}

function tableForSelect(
  select: SelectChain,
  resolveTable: (node: Node) => string | undefined,
): string | undefined {
  const fromCall = chainCallByName(select.chain, 'from');
  const tableArgument = fromCall?.getArguments()[0];
  return tableArgument ? resolveTable(tableArgument) : undefined;
}

function rowsetForSelect(
  select: SelectChain,
  table: string,
  context: QueryShapeContextForTable,
): Rowset {
  return {
    filters: selectFilters(select, table, context),
    key: context.keyByTable(table),
    orderBy: selectOrderBy(select, table, context),
    table,
  };
}

/** WHERE chain → rowset filters (eq with value, else non-eq/opaque). */
function selectFilters(
  select: SelectChain,
  table: string,
  context: QueryShapeContextForTable,
): RowsetFilter[] {
  const whereCall = chainCallByName(select.chain, 'where');
  const predicate = whereCall?.getArguments()[0];
  if (!predicate) return [];
  return filtersFromPredicate(predicate, table, context);
}

function filtersFromPredicate(
  predicate: Node,
  table: string,
  context: QueryShapeContextForTable,
): RowsetFilter[] {
  const node = unwrappedStaticExpressionNode(predicate);
  if (!Node.isCallExpression(node)) return [{ column: predicate.getText(), op: 'opaque' }];
  const callee = node.getExpression();
  const name = Node.isIdentifier(callee) ? callee.getText() : undefined;

  if (name === 'and') {
    return node
      .getArguments()
      .flatMap((argument) => filtersFromPredicate(argument, table, context));
  }

  const [left, right] = node.getArguments();
  const column =
    selectColumnReference(left, table, context.resolveTable) ??
    selectColumnReference(right, table, context.resolveTable);
  if (!column) return [{ column: node.getText(), op: 'opaque' }];

  if (name === 'eq') {
    const valueNode = selectColumnReference(left, table, context.resolveTable) ? right : left;
    const value = valueNode
      ? symbolicValueFromExpression(valueNode, context.paramSymbolKeys)
      : undefined;
    return value && value.kind !== 'opaque'
      ? [{ column, op: 'eq', value }]
      : [{ column, op: 'non-eq' }];
  }
  return [{ column, op: 'non-eq' }];
}

/** ORDER BY chain → ordered columns with per-column opacity (sql/expr orderBy ⇒ opaque). */
function selectOrderBy(
  select: SelectChain,
  table: string,
  context: QueryShapeContextForTable,
): OrderByColumn[] {
  const orderByCall = chainCallByName(select.chain, 'orderBy');
  if (!orderByCall) return [];

  const columns: OrderByColumn[] = [];
  for (const argument of orderByCall.getArguments()) {
    columns.push(orderByColumn(argument, table, context.resolveTable));
  }
  return columns;
}

function orderByColumn(
  argument: Node,
  table: string,
  resolveTable: (node: Node) => string | undefined,
): OrderByColumn {
  const node = unwrappedStaticExpressionNode(argument);
  // `desc(t.col)` / `asc(t.col)` direction wrappers.
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    const name = Node.isIdentifier(callee) ? callee.getText() : undefined;
    if (name === 'asc' || name === 'desc') {
      const inner = node.getArguments()[0];
      const column = inner ? selectColumnReference(inner, table, resolveTable) : undefined;
      if (column) return { column, direction: name };
    }
    return { column: node.getText(), direction: 'asc', opaque: true };
  }
  const column = selectColumnReference(node, table, resolveTable);
  if (column) return { column, direction: 'asc' };
  return { column: node.getText(), direction: 'asc', opaque: true };
}

/** Resolve a `t.col` reference whose base resolves to `table` → its column name. */
function selectColumnReference(
  node: Node | undefined,
  table: string,
  resolveTable: (node: Node) => string | undefined,
): string | undefined {
  if (!node) return undefined;
  const expression = unwrappedStaticExpressionNode(node);
  if (!Node.isPropertyAccessExpression(expression) && !Node.isElementAccessExpression(expression)) {
    return undefined;
  }
  if (resolveTable(expression.getExpression()) !== table) return undefined;
  return staticAccessName(expression);
}

/** Classify `count()` / `sum(t.col)` aggregate (or scalar single keyed-row column). */
function aggregateField(
  initializer: Node,
  rowset: Rowset,
  table: string,
  context: QueryShapeContextForTable,
): AlgebraicField | undefined {
  const expression = unwrappedStaticExpressionNode(initializer);

  // Window functions: `<agg>(…).over(…)` ⇒ out-of-grammar punt.
  if (Node.isCallExpression(expression) && propertyAccessCallName(expression) === 'over') {
    return { kind: 'opaque', reason: { code: 'opaque-shape', shape: 'window' } };
  }

  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression();
    const name = Node.isIdentifier(callee) ? callee.getText() : undefined;
    if (name === 'count') {
      const pred = rowset.filters.find((filter) => filter.op === 'eq');
      return { kind: 'count', ...(pred ? { pred } : {}), rowset };
    }
    if (name === 'sum' || name === 'sumDistinct') {
      const argument = expression.getArguments()[0];
      const column = argument
        ? selectColumnReference(argument, table, context.resolveTable)
        : undefined;
      if (!column) {
        return {
          kind: 'opaque',
          reason: { code: 'opaque-projection', expr: expression.getText() },
        };
      }
      return { arith: { column, kind: 'col' }, kind: 'sum', rowset };
    }
    if (name === 'avg' || name === 'max' || name === 'min') {
      return { kind: 'opaque', reason: { code: 'opaque-projection', expr: expression.getText() } };
    }
  }

  // A single `t.col` projection is a Scalar ONLY when the rowset is pinned to one
  // keyed row (`eq(key, …)`); otherwise it ships an array of rows ⇒ AGG (handled by
  // the caller's projection path). Returning undefined defers to that AGG path.
  const scalarColumn = selectColumnReference(expression, table, context.resolveTable);
  if (scalarColumn && rowsetPinsKey(rowset)) {
    return { column: scalarColumn, kind: 'scalar', rowset };
  }

  return undefined;
}

/**
 * Classify a real-loader scalar field: a single-row scalar projection of an
 * aggregate `db.select({ <col>: sum/count(…) })` result. Handles the runtime
 * shapes `(await select)[0].col`, `rows[0].col`, `rows[0]?.col`, optionally
 * wrapped in `Number(...)` / `... ?? default` / `!`. Returns the SUM/COUNT (or
 * keyed-row Scalar) field the projected column computes.
 */
function scalarProjectionField(
  valueNode: Node,
  context: QueryShapeContextForTable,
): ClassifiedField | undefined {
  const access = scalarProjectionAccess(valueNode);
  if (!access) return undefined;

  const select = selectChainForExpression(access.base);
  if (!select) return undefined;
  const table = tableForSelect(select, context.resolveTable);
  if (!table) return undefined;
  const projection = selectProjectionArgument(select.selectCall);
  if (!projection || !Node.isObjectLiteralExpression(projection)) return undefined;

  const rowset = rowsetForSelect(select, table, context);
  for (const property of projection.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== access.column) continue;
    const initializer = property.getInitializer();
    const field = initializer ? aggregateField(initializer, rowset, table, context) : undefined;
    if (field) return { field };
  }
  return undefined;
}

/** Match a `<base>[0](?.|.)<col>` first-row scalar projection (await/Number/?? wrappers stripped). */
function scalarProjectionAccess(node: Node): { base: Node; column: string } | undefined {
  const expression = unwrapScalarProjection(node);
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  const column = expression.getName();
  const element = unwrappedStaticExpressionNode(expression.getExpression());
  if (!Node.isElementAccessExpression(element)) return undefined;
  const index = unwrappedStaticExpressionNode(element.getArgumentExpression() ?? element);
  if (!Node.isNumericLiteral(index) || index.getLiteralText() !== '0') return undefined;
  return { base: element.getExpression(), column };
}

/** Strip `Number(...)` / `String(...)` / `x ?? default` / `x!` / parens around a scalar projection. */
function unwrapScalarProjection(node: Node): Node {
  const expression = unwrappedStaticExpressionNode(node);
  if (Node.isNonNullExpression(expression))
    return unwrapScalarProjection(expression.getExpression());
  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression();
    const name = Node.isIdentifier(callee) ? callee.getText() : undefined;
    const argument = expression.getArguments()[0];
    if (argument && (name === 'Number' || name === 'String' || name === 'Boolean')) {
      return unwrapScalarProjection(argument);
    }
  }
  if (
    Node.isBinaryExpression(expression) &&
    expression.getOperatorToken().getKind() === SyntaxKind.QuestionQuestionToken
  ) {
    return unwrapScalarProjection(expression.getLeft());
  }
  return expression;
}

/** True when the rowset's filter chain pins its instance key to one row (`eq(key, …)`). */
function rowsetPinsKey(rowset: Rowset): boolean {
  if (!rowset.key) return false;
  return rowset.filters.some((filter) => filter.op === 'eq' && filter.column === rowset.key);
}

interface ProjectionColumns {
  columns: string[];
}

/** All projected columns of `table` in an AGG row projection (null ⇒ un-analyzable column). */
function projectionColumns(
  projection: ObjectLiteralExpression,
  table: string,
  resolveTable: (node: Node) => string | undefined,
): ProjectionColumns | undefined {
  const columns: string[] = [];
  for (const property of projection.getProperties()) {
    if (!Node.isPropertyAssignment(property)) return undefined;
    const initializer = property.getInitializer();
    const column = initializer
      ? selectColumnReference(initializer, table, resolveTable)
      : undefined;
    const alias = propertyNameText(property.getNameNode());
    if (!column || !alias) return undefined;
    columns.push(alias);
  }
  return columns.length > 0 ? { columns } : undefined;
}

/** Per-column JSON types for AGG placeholders, from the table's column builders. */
function projectionColumnTypes(
  columns: readonly string[],
  table: string,
  context: QueryShapeContextForTable,
): Record<string, 'boolean' | 'number' | 'string'> {
  const tableColumns = context.columnsByTable(table) ?? {};
  const types: Record<string, 'boolean' | 'number' | 'string'> = {};
  for (const column of columns) {
    const jsonType = jsonScalarType(tableColumns[column]);
    if (jsonType) types[column] = jsonType;
  }
  return types;
}

function jsonScalarType(
  shape: QueryShape | undefined,
): 'boolean' | 'number' | 'string' | undefined {
  const unwrapped =
    shape && typeof shape === 'object' && !Array.isArray(shape) && 'kind' in shape
      ? (shape as QueryShapeWrapper).shape
      : shape;
  if (unwrapped === 'number') return 'number';
  if (unwrapped === 'boolean') return 'boolean';
  if (unwrapped === 'string') return 'string';
  if (unwrapped === 'object') return 'string';
  return undefined;
}

/**
 * Cursor detection: a property whose value reads from the last row of a paginated
 * (`.limit()`) rows array (e.g. `rows.at(-1)?.id`) — the §10.5 pagination cursor
 * field. Only classifies when the referenced rows array provably resolves to a
 * limited select over a known table; otherwise the field falls through.
 */
function cursorRowsetForExpression(
  valueNode: Node,
  _object: ObjectLiteralExpression,
  context: QueryShapeContextForTable,
): Rowset | undefined {
  const expression = unwrappedStaticExpressionNode(valueNode);
  // A cursor reads INTO a rows array (`rows.at(-1)?.col`), so a bare select chain
  // is NOT a cursor — require a member/call access whose root is the rows array.
  if (selectChainForExpression(expression)) return undefined;

  const rootIdentifier = staticExpressionRootIdentifier(expression);
  if (!rootIdentifier || !Node.isIdentifier(rootIdentifier)) return undefined;

  const select = selectChainForExpression(rootIdentifier);
  if (!select || !chainCallByName(select.chain, 'limit')) return undefined;
  const table = tableForSelect(select, context.resolveTable);
  if (!table) return undefined;
  return rowsetForSelect(select, table, context);
}

/** The single `return <expr>` expression of a loader callback body, if any. */
function loaderReturnExpression(fn: Node): Node | undefined {
  let body: Node;
  try {
    body = functionBody(fn);
  } catch {
    return undefined;
  }
  // Concise arrow body: `() => (<expr>)`.
  if (!Node.isBlock(body)) return body;

  // Direct `return <expr>` statements of THIS callback (not a nested closure).
  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter((statement) => {
    const enclosing = statement.getFirstAncestor(
      (ancestor) => isFunctionLikeNode(ancestor) || Node.isMethodDeclaration(ancestor),
    );
    return enclosing === fn;
  });
  const target = returns[returns.length - 1];
  return target?.getExpression();
}
