import { isAbsolute, join } from 'node:path';
import { Node, Project, SyntaxKind, ts, type CompilerOptions, type SourceFile } from 'ts-morph';
import { registerFrameworkIdentityProject } from '@kovojs/core/internal/framework-identity';
import { extractedFunctionKey, functionReceiverParametersByKey } from './domain-writes.js';
import {
  extractLocalFunctionCallsFromBody,
  extractTransactionCallbackLocalFunctionCallsFromBody,
  projectReceiverReferenceInArgument,
  receiverCarrierSymbolKeysForBody,
} from './receiver-surface.js';
import {
  appendProjectConditionalTableNames,
  columnShapesForFile,
  projectColumnShapesByTable,
  projectRelationTargetTableNamesByProperty,
  projectRelationalTableNamesByProperty,
  projectTableNamesBySymbol,
  isDrizzleReceiver,
  projectUnmodeledRelationNamesBySymbol,
} from './schema.js';
import {
  type ExtractedFunction,
  type ProjectDrizzleReceivers,
  type QueryShape,
  type SourceFileInput,
  type TouchGraphProjectOptions,
  DRIZZLE_STATIC_PROJECT_ROOT,
  bodySourceStart,
  callbackFunctionFromPropertyDeclaration,
  callbackParameterSymbolKeys,
  extractProjectDrizzleWriteCalls,
  extractProjectRelationalReadCalls,
  extractProjectSelectReadCalls,
  extractProjectUnresolvedCalls,
  functionBody,
  isProjectDrizzleReceiverIdentifier,
  projectClassStaticMemberCallbacks,
  projectDomainWriteCallbacks,
  projectDrizzleReceivers,
  projectMutationHandlerCallbacks,
  projectObjectLiteralCallbacks,
  projectNamespaceTableNamesByLocal,
  projectReceiverParameterRequirements,
  type ProjectNamespaceTableNames,
  propertyNameText,
  unwrappedFunctionExpression,
} from '../static.js';
import type { SourceModuleContext } from './tables.js';

/**
 * Per-run memo of pure derivations of a single {@link ProjectExtraction}.
 *
 * SPEC §11.1: `extractStaticBuildAnalysisFactsFromProject` runs every project-mode pass
 * against ONE extraction, but several passes (touch-graph, write-scope, query-fact,
 * owner-audit, …) each independently recomputed the same pure-from-extraction derivations.
 * A cold-build profile measured `funcExtractions n=3 = 2642ms` (~1.8s redundant) plus
 * repeated `contextFiles` / `sourceModuleContext` work. This memo computes each derivation
 * once per extraction and reuses it across passes.
 *
 * INVARIANTS:
 * - Per-run scope ONLY. It lives on the extraction and is dropped in `dispose()`; it MUST
 *   NOT be promoted to a process-global / module-level cache. A prior process-global memo
 *   leaked ts-morph `Project`s and OOM'd the suite, so this stays GC'd with the extraction.
 * - Cached `ExtractedFunction` objects are read-only after construction. Every field
 *   mutation happens inside `projectFunctionExtractionsByFileName` while it builds the map;
 *   no later pass mutates them (consumers read via `projectFunctionsForFile`, whose array
 *   fields are typed `readonly`), so sharing the same objects across passes is safe.
 */
interface ProjectExtractionMemo {
  contextFiles?: SourceFileInput[] | undefined;
  functionExtractionsByFileName?: Map<string, Map<string, ExtractedFunction>> | undefined;
  relationTargetTableNamesByProperty?:
    | ReturnType<typeof projectRelationTargetTableNamesByProperty>
    | undefined;
  sourceModuleContext?: SourceModuleContext | undefined;
}

/** @internal */ export interface ProjectExtraction {
  columnShapesByTable: ReadonlyMap<string, Readonly<Record<string, QueryShape>>>;
  conditionalTableTargetsBySyntheticName: ReadonlyMap<string, readonly string[]>;
  dispose: () => void;
  files: readonly SourceFileInput[];
  /**
   * Per-run memo for pure derivations (see {@link ProjectExtractionMemo}). Cleared in
   * `dispose()`; never a process-global cache.
   */
  readonly memo: ProjectExtractionMemo;
  sourceFiles: readonly SourceFile[];
  tableNamesBySymbol: ReadonlyMap<string, string>;
  unmodeledRelationNamesBySymbol: ReadonlyMap<string, string>;
}

/** @internal */ export function createProjectExtraction(
  options: TouchGraphProjectOptions,
): ProjectExtraction {
  const project = new Project({
    compilerOptions: {
      allowJs: false,
      lib: ['lib.es2022.d.ts'],
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      baseUrl: join(DRIZZLE_STATIC_PROJECT_ROOT, '../../..'),
      paths: kovoWorkspacePackagePaths(),
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      types: [],
      ...options.compilerOptions,
    },
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFiles = options.files.map((file) =>
    project.createSourceFile(projectSourceFileName(file.fileName), file.source, {
      overwrite: true,
    }),
  );
  for (const sourceFile of sourceFiles) {
    registerFrameworkIdentityProject(
      sourceFile.compilerNode,
      sourceFiles.map((file) => file.compilerNode),
    );
  }
  const tableNamesBySymbol = new Map(projectTableNamesBySymbol(sourceFiles));
  const unmodeledRelationNamesBySymbol = new Map(
    projectUnmodeledRelationNamesBySymbol(sourceFiles),
  );
  const conditionalTableTargetsBySyntheticName = appendProjectConditionalTableNames(
    sourceFiles,
    tableNamesBySymbol,
  );
  const columnShapesByTable = projectColumnShapesByTable(sourceFiles, tableNamesBySymbol);

  // Per-run memo; cleared in dispose() below. Never a process-global cache (SPEC §11.1).
  const memo: ProjectExtractionMemo = {};

  return {
    columnShapesByTable,
    conditionalTableTargetsBySyntheticName,
    dispose: () => {
      for (const sourceFile of sourceFiles) sourceFile.forget();
      // Drop memoized derivations so the cached ExtractedFunction objects and table facts
      // are released with the forgotten ts-morph source files instead of outliving them.
      memo.contextFiles = undefined;
      memo.functionExtractionsByFileName = undefined;
      memo.relationTargetTableNamesByProperty = undefined;
      memo.sourceModuleContext = undefined;
    },
    files: options.files,
    memo,
    sourceFiles,
    tableNamesBySymbol,
    unmodeledRelationNamesBySymbol,
  };
}

function kovoWorkspacePackagePaths(): NonNullable<CompilerOptions['paths']> {
  return {
    '@kovojs/browser': ['packages/browser/src/index.ts'],
    '@kovojs/browser/*': ['packages/browser/src/*'],
    '@kovojs/core': ['packages/core/src/index.ts'],
    '@kovojs/core/*': ['packages/core/src/*'],
    '@kovojs/drizzle': ['packages/drizzle/src/runtime.ts'],
    '@kovojs/drizzle/*': ['packages/drizzle/src/*'],
    '@kovojs/server': ['packages/server/src/index.ts'],
    '@kovojs/server/*': ['packages/server/src/*'],
    '@kovojs/style': ['packages/style/src/index.ts'],
    '@kovojs/style/*': ['packages/style/src/*'],
  };
}

/** @internal */ export function projectSourceFileName(fileName: string): string {
  // SPEC §11.1: project-mode receiver proof depends on TypeScript resolving Drizzle package
  // symbols. Anchor virtual source files under this package so root-launched and package-launched
  // Vitest runs resolve the same peer/dev dependency graph.
  return isAbsolute(fileName) ? fileName : join(DRIZZLE_STATIC_PROJECT_ROOT, fileName);
}

/** @internal */ export function projectContextFiles(
  extraction: ProjectExtraction,
): SourceFileInput[] {
  // SPEC §11.1: memoize this pure derivation per extraction so build-facing passes that each
  // need the per-file column-shape context reuse one computation. Callers iterate read-only.
  const cached = extraction.memo.contextFiles;
  if (cached) return cached;

  const contextFiles = extraction.files.map((file, index) => {
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

  extraction.memo.contextFiles = contextFiles;
  return contextFiles;
}

/** @internal */ export function projectRelationTargetTableNamesForExtraction(
  extraction: ProjectExtraction,
): ReturnType<typeof projectRelationTargetTableNamesByProperty> {
  const cached = extraction.memo.relationTargetTableNamesByProperty;
  if (cached) return cached;
  const relationTargetTableNames = projectRelationTargetTableNamesByProperty(
    extraction.sourceFiles,
    extraction.tableNamesBySymbol,
  );
  extraction.memo.relationTargetTableNamesByProperty = relationTargetTableNames;
  return relationTargetTableNames;
}

/** @internal */ export function projectFunctionExtractionsByFileName(
  extraction: ProjectExtraction,
): Map<string, Map<string, ExtractedFunction>> {
  // SPEC §11.1: the per-function extraction map is pure given the extraction, but the cold
  // profile flagged it as the dominant redundant pass (`funcExtractions n=3 = 2642ms`).
  // Memoize per extraction so touch-graph / write-scope / query-fact passes share one build.
  // The cached ExtractedFunction objects are read-only after this function returns (see
  // ProjectExtractionMemo) — no consumer mutates them.
  const cached = extraction.memo.functionExtractionsByFileName;
  if (cached) return cached;

  const extractionsByFile = new Map<string, Map<string, ExtractedFunction>>();
  const relationTargetTableNames = projectRelationTargetTableNamesForExtraction(extraction);

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
    const mutationHandlerCallbacks = projectMutationHandlerCallbacks(sourceFile);

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
          ...extractProjectRelationalReadCalls(
            body,
            file,
            receivers,
            relationalTableNames,
            relationTargetTableNames,
          ),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        receiverParameters: projectReceiverParameterRequirements(fn),
        writeCalls: extractProjectDrizzleWriteCalls(
          body,
          file,
          extraction.tableNamesBySymbol,
          extraction.unmodeledRelationNamesBySymbol,
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
          ...extractProjectRelationalReadCalls(
            body,
            file,
            receivers,
            relationalTableNames,
            relationTargetTableNames,
          ),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        receiverParameters: projectReceiverParameterRequirements(callback),
        writeCalls: extractProjectDrizzleWriteCalls(
          body,
          file,
          extraction.tableNamesBySymbol,
          extraction.unmodeledRelationNamesBySymbol,
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
            relationTargetTableNames,
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
          extraction.unmodeledRelationNamesBySymbol,
          namespaceTableNames,
          receivers,
          callbackParameterSymbolKeys(callback.fn),
        ),
      });
    }

    for (const callback of mutationHandlerCallbacks) {
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
            relationTargetTableNames,
          ),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        receiverParameters: projectReceiverParameterRequirements(callback.fn),
        writeCalls: extractProjectDrizzleWriteCalls(
          callback.body,
          file,
          extraction.tableNamesBySymbol,
          extraction.unmodeledRelationNamesBySymbol,
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
            relationTargetTableNames,
          ),
        ],
        unresolvedCalls: [],
        receiverNames: [...receivers.names],
        receiverParameters: projectReceiverParameterRequirements(callback.fn),
        writeCalls: extractProjectDrizzleWriteCalls(
          callback.body,
          file,
          extraction.tableNamesBySymbol,
          extraction.unmodeledRelationNamesBySymbol,
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
    for (const callback of mutationHandlerCallbacks) {
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

  extraction.memo.functionExtractionsByFileName = extractionsByFile;
  return extractionsByFile;
}
