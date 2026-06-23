import { isAbsolute, join } from 'node:path';
import {
  Node,
  Project,
  SyntaxKind,
  ts,
  type CompilerOptions,
  type SourceFile,
} from 'ts-morph';
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
  projectObjectLiteralCallbacks,
  projectNamespaceTableNamesByLocal,
  projectReceiverParameterRequirements,
  type ProjectNamespaceTableNames,
  propertyNameText,
  unwrappedFunctionExpression,
} from '../static.js';

/** @internal */ export interface ProjectExtraction {
  columnShapesByTable: ReadonlyMap<string, Readonly<Record<string, QueryShape>>>;
  conditionalTableTargetsBySyntheticName: ReadonlyMap<string, readonly string[]>;
  dispose: () => void;
  files: readonly SourceFileInput[];
  sourceFiles: readonly SourceFile[];
  tableNamesBySymbol: ReadonlyMap<string, string>;
  unmodeledRelationNamesBySymbol: ReadonlyMap<string, string>;
}

/** @internal */ export function createProjectExtraction(options: TouchGraphProjectOptions): ProjectExtraction {
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
  const unmodeledRelationNamesBySymbol = new Map(
    projectUnmodeledRelationNamesBySymbol(sourceFiles),
  );
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
    unmodeledRelationNamesBySymbol,
  };
}

/** @internal */ export function projectSourceFileName(fileName: string): string {
  // SPEC §11.1: project-mode receiver proof depends on TypeScript resolving Drizzle package
  // symbols. Anchor virtual source files under this package so root-launched and package-launched
  // Vitest runs resolve the same peer/dev dependency graph.
  return isAbsolute(fileName) ? fileName : join(DRIZZLE_STATIC_PROJECT_ROOT, fileName);
}

/** @internal */ export function projectContextFiles(extraction: ProjectExtraction): SourceFileInput[] {
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

/** @internal */ export function projectFunctionExtractionsByFileName(
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
          ...extractProjectRelationalReadCalls(body, file, receivers, relationalTableNames),
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
