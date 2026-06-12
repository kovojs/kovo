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
  type CallExpression,
  type CompilerOptions,
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

const IDENTIFIER_SOURCE = String.raw`[A-Za-z_$][\w$]*`;
const SOURCE_EXTRACTION_FILE_NAME = '__jiso_source.ts';
const DEFAULT_DRIZZLE_RECEIVER_NAMES = new Set(['db', 'tx']);
const IGNORED_LOCAL_CALL_NAMES = new Set([
  'delete',
  'eq',
  'for',
  'function',
  'if',
  'insert',
  'jiso',
  'pgTable',
  'return',
  'select',
  'switch',
  'update',
  'while',
]);
const EXPORTED_CONST_DECLARATION_SOURCE = String.raw`(?:export\s+)?const\s+`;
const FW411_MESSAGE = 'Query read set includes an exempt table';
const UNRESOLVED_READ_SOURCE_EXPRESSION = '__jisoUnresolvedReadSource';

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
  const tables = new Map<string, ExtractedTable[]>();
  const unresolvedIdentifiers = new Set<string>();
  const graph: Record<string, TouchGraphEntry> = {};

  for (const file of files) {
    for (const table of extractTables(file.source)) {
      appendTable(tables, table.identifier, { annotation: table });
    }
  }
  for (const file of files) {
    for (const alias of importExportTableAliases(file.source)) {
      appendTableEntries(tables, alias.local, tables.get(alias.imported) ?? []);
    }
  }
  for (const file of files) {
    for (const identifier of extractUnresolvedConditionalIdentifiers(file.source, tables)) {
      unresolvedIdentifiers.add(identifier);
    }
  }

  for (const file of files) {
    const fileTables = tablesForFile(file.source, tables);
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

      extractionsByFunction.set(name, {
        receiverNames: projectDrizzleReceiverNames(fn),
        writeCalls: extractProjectDrizzleWriteCalls(body, file, extraction.tableNamesBySymbol),
      });
    }

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(name) || !initializer) continue;
      if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;

      const body = initializer.getBody();
      extractionsByFunction.set(name.getText(), {
        receiverNames: projectDrizzleReceiverNames(initializer),
        writeCalls: extractProjectDrizzleWriteCalls(body, file, extraction.tableNamesBySymbol),
      });
    }

    for (const [name, callback] of projectDomainWriteCallbacks(sourceFile)) {
      extractionsByFunction.set(name, {
        receiverNames: projectDrizzleReceiverNames(callback.fn),
        writeCalls: extractProjectDrizzleWriteCalls(
          callback.body,
          file,
          extraction.tableNamesBySymbol,
        ),
      });
    }

    extractionsByFile.set(file.fileName, extractionsByFunction);
  });

  return extractionsByFile;
}

interface ProjectFunctionExtraction {
  receiverNames: readonly string[];
  writeCalls: readonly ExtractedWriteCall[];
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

function projectDrizzleReceiverNames(callback: Node): string[] {
  if (
    !Node.isArrowFunction(callback) &&
    !Node.isFunctionDeclaration(callback) &&
    !Node.isFunctionExpression(callback)
  ) {
    return [];
  }

  const names: string[] = [];
  for (const param of callback.getParameters()) {
    const name = param.getNameNode();
    if (Node.isIdentifier(name) && isDrizzleReceiver(name)) names.push(name.getText());
  }
  return names;
}

function extractProjectDrizzleWriteCalls(
  body: Node,
  file: SourceFileInput,
  tableNamesBySymbol: ReadonlyMap<string, string>,
): ExtractedWriteCall[] {
  const calls: ExtractedWriteCall[] = [];

  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDrizzleWriteCall(call)) continue;

    const expression = call.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) continue;
    if (!isDrizzleReceiver(expression.getExpression())) continue;

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
  const tables = new Map<string, ExtractedTable[]>();
  const sourceColumnShapes = sourceColumnShapesForFiles(files);
  const facts: QueryFact[] = [];

  for (const file of files) {
    for (const table of extractTables(file.source)) {
      appendTable(tables, table.identifier, { annotation: table });
    }
  }
  for (const file of files) {
    for (const alias of importExportTableAliases(file.source)) {
      appendTableEntries(tables, alias.local, tables.get(alias.imported) ?? []);
    }
  }

  for (const file of files) {
    const columnShapes = {
      ...sourceColumnShapesForFile(file.source, sourceColumnShapes),
      ...file.columnShapes,
    };
    for (const query of extractQueryDefinitions(file.source, columnShapes)) {
      const reads = queryReadDomains(query.body, tables);
      const site = `${file.fileName}:${lineForIndex(file.source, query.index)}`;
      const diagnostics = opaqueProjectionDiagnostics(
        query.query,
        query.opaquePaths,
        site,
        hasDeclaredQueryOutputSchema(query.body),
      )
        .concat(unresolvedProjectionDiagnostics(query.query, query.unresolvedPaths, site))
        .concat(query.diagnostics?.map((diagnostic) => ({ ...diagnostic, site })) ?? [])
        .concat(exemptQueryReadDiagnostics(query.body, tables, site));
      facts.push({
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
        ...queryInstanceKey(query.body, tables),
        query: query.query,
        reads,
        shape: query.shape,
        site,
      });
    }
  }

  return facts.sort((left, right) => left.query.localeCompare(right.query));
}

function sourceColumnShapesForFiles(
  files: readonly SourceFileInput[],
): ReadonlyMap<string, Readonly<Record<string, QueryShape>>> {
  const shapes = new Map<string, Record<string, QueryShape>>();

  for (const file of files) {
    const declarations = variableDeclarationsFromSource(file.source);
    const localShapes = new Map<string, Record<string, QueryShape>>();

    for (const { identifier, table } of declarations) {
      if (!table) continue;

      const columns = table.columns;
      if (Object.keys(columns).length === 0) continue;

      const tableName = table.name;
      localShapes.set(identifier, columns);
      shapes.set(identifier, columns);
      shapes.set(tableName, columns);
    }

    for (const declaration of declarations) {
      if (localShapes.has(declaration.identifier)) continue;

      for (const target of aliasTargets(declaration.initializerText)) {
        const columns = localShapes.get(target);
        if (!columns) continue;

        localShapes.set(declaration.identifier, columns);
        shapes.set(declaration.identifier, columns);
      }
    }
  }

  for (const file of files) {
    for (const alias of importExportTableAliases(file.source)) {
      const columns = shapes.get(alias.imported);
      if (columns) shapes.set(alias.local, columns);
    }
  }

  return shapes;
}

function sourceColumnShapesForFile(
  source: string,
  shapes: ReadonlyMap<string, Readonly<Record<string, QueryShape>>>,
): Readonly<Record<string, QueryShape>> {
  const scoped: Record<string, QueryShape> = {};

  for (const [identifier, columns] of shapes) {
    for (const [column, shape] of Object.entries(columns)) {
      scoped[`${identifier}.${column}`] = shape;
    }
  }

  for (const namespace of namespaceImportAliases(source)) {
    for (const [identifier, columns] of shapes) {
      for (const [column, shape] of Object.entries(columns)) {
        scoped[`${namespace}.${identifier}.${column}`] = shape;
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

    shapes[name] = columnBuilderShape(property.getInitializer()?.getText() ?? '');
  }

  return shapes;
}

function propertyNameText(name: Node): string | undefined {
  if (Node.isIdentifier(name) || Node.isStringLiteral(name) || Node.isNumericLiteral(name)) {
    return name.getText().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

function columnBuilderShape(source: string): QueryShape {
  const builder = /^(?<name>[A-Za-z_$][\w$]*)\s*\(/.exec(source.trim())?.groups?.name;
  if (!builder) return 'string';

  const baseShape = columnBuilderBaseShape(builder);
  return columnBuilderIsNonNull(source) ? baseShape : nullableShape(baseShape);
}

function columnBuilderBaseShape(builder: string): QueryShape {
  if (/^(?:boolean)$/.test(builder)) return 'boolean';
  if (
    /^(?:bigint|doublePrecision|integer|numeric|real|smallint|serial|bigserial|smallserial)$/.test(
      builder,
    )
  ) {
    return 'number';
  }
  if (/^(?:json|jsonb)$/.test(builder)) return 'object';
  return 'string';
}

function columnBuilderIsNonNull(source: string): boolean {
  return /\.(?:notNull|primaryKey)\s*\(/.test(source);
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
  identifier: string;
  name: string;
};

interface ExtractedFunction {
  body: string;
  bodyStart: number;
  name: string;
  params: string;
  receiverNames?: readonly string[];
  writeCalls?: readonly ExtractedWriteCall[];
}

interface ExtractedQueryDefinition {
  body: string;
  diagnostics?: readonly TouchGraphDiagnostic[];
  index: number;
  opaquePaths: readonly string[];
  query: string;
  shape: QueryShape;
  unresolvedPaths: readonly string[];
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
  const definitions: ExtractedQueryDefinition[] = [];
  const pattern = new RegExp(
    `${EXPORTED_CONST_DECLARATION_SOURCE}${IDENTIFIER_SOURCE}\\s*=\\s*query\\s*\\(\\s*["'](?<query>[^"']+)["']\\s*,`,
    'g',
  );

  for (const match of source.matchAll(pattern)) {
    const query = match.groups?.query;
    if (!query) continue;

    const objectStart = source.indexOf('{', match.index + match[0].length);
    if (objectStart === -1) continue;

    const objectEnd = findMatchingBrace(source, objectStart);
    if (objectEnd === -1) continue;

    const body = source.slice(objectStart, objectEnd + 1);
    const selection = selectShapeFromQueryBody(body, columnShapes);
    const diagnostics = relationalQueryDiagnostics(body);
    if (!selection && diagnostics.length === 0) continue;

    definitions.push({
      body,
      ...(selection?.diagnostics || diagnostics.length > 0
        ? { diagnostics: [...(selection?.diagnostics ?? []), ...diagnostics] }
        : {}),
      index: match.index,
      opaquePaths: selection?.opaquePaths ?? [],
      query,
      shape: selection?.shape ?? {},
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
  body: string,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
): QueryShapeSelection | null {
  const selectCall = returnedSelectCall(body) ?? /\.select\s*\(/.exec(body);
  if (!selectCall || selectCall.index === undefined) return null;

  const openParen = selectCall.index + selectCall[0].length - 1;
  const closeParen = findMatchingParen(body, openParen);
  if (closeParen === -1) return null;

  const projection = body.slice(openParen + 1, closeParen).trim();
  if (projection.length === 0) {
    return {
      diagnostics: [
        {
          code: 'FW406',
          message: `${diagnosticDefinitions.FW406.message} Query uses db.select() without an explicit projection.`,
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

  if (!projection.startsWith('{')) return null;

  const objectEnd = findMatchingBrace(projection, 0);
  if (objectEnd === -1) return null;

  return queryShapeFromObjectLiteral(
    projection.slice(1, objectEnd),
    '',
    columnShapes,
    nullableJoinTables(body),
  );
}

function returnedSelectCall(body: string): RegExpExecArray | null {
  return /\breturn\s+(?:await\s+)?[\s\S]*?\.select\s*\(/.exec(body);
}

function relationalQueryDiagnostics(body: string): TouchGraphDiagnostic[] {
  if (queryRelationalTableExpressions(body).length === 0) return [];

  return [
    {
      code: 'FW406',
      message: `${diagnosticDefinitions.FW406.message} Query uses Drizzle relational query API without static projection.`,
      severity: diagnosticDefinitions.FW406.severity,
      site: '',
    },
  ];
}

function queryShapeFromObjectLiteral(
  source: string,
  prefix = '',
  columnShapes: Readonly<Record<string, QueryShape>> = {},
  nullableTables: ReadonlySet<string> = new Set(),
): QueryShapeSelection {
  const shape: Record<string, QueryShape> = {};
  let hasTablelessScalar = false;
  const opaquePaths: string[] = [];
  const scalarTables = new Set<string>();
  const unresolvedPaths: string[] = [];

  for (const entry of splitTopLevelArgs(source)) {
    const separator = entry.indexOf(':');
    if (separator === -1) {
      // SPEC §10-§11: unsupported projection syntax stays visible instead of disappearing.
      const shorthand = shorthandProjectionName(entry);
      if (shorthand) unresolvedPaths.push(prefix ? `${prefix}.${shorthand}` : shorthand);
      continue;
    }

    const key = entry
      .slice(0, separator)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!key) continue;

    const value = entry.slice(separator + 1).trim();
    const path = prefix ? `${prefix}.${key}` : key;
    if (value.startsWith('{')) {
      const nested = queryShapeFromObjectLiteral(
        value.slice(1, findMatchingBrace(value, 0)),
        path,
        columnShapes,
        nullableTables,
      );
      shape[key] = nullableNestedShape(nested, nullableTables) ?? nested.shape;
      opaquePaths.push(...nested.opaquePaths);
      unresolvedPaths.push(...nested.unresolvedPaths);
    } else {
      const scalarShape = scalarQueryShape(value, columnShapes, nullableTables);
      if (scalarShape) {
        shape[key] = scalarShape;
      } else if (!isOpaqueProjection(value)) {
        unresolvedPaths.push(path);
      }
      if (isOpaqueProjection(value)) opaquePaths.push(path);
      const table = scalarProjectionTable(value);
      if (table) {
        scalarTables.add(table);
      } else if (scalarShape) {
        hasTablelessScalar = true;
      }
    }
  }

  return { hasTablelessScalar, opaquePaths, shape, scalarTables, unresolvedPaths };
}

function shorthandProjectionName(entry: string): string | undefined {
  return /^(?<name>[A-Za-z_$][\w$]*)$/.exec(entry.trim())?.groups?.name;
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
  expression: string,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
  nullableTables: ReadonlySet<string> = new Set(),
): QueryShape | null {
  const sqlShape = typedSqlProjectionShape(expression);
  if (sqlShape) return sqlShape;
  const trimmed = expression.trim();
  const columnShape = columnShapes[trimmed];
  if (columnShape) {
    return nullableTables.has(tableExpressionBase(trimmed))
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

function nullableJoinTables(body: string): ReadonlySet<string> {
  const tables = new Set<string>();
  const relationTables: string[] = [];

  for (const { operation, table } of queryBodyCallExpressions(body, (call) => {
    const operation = propertyAccessCallName(call);
    if (!operation || !isJoinReadCallName(operation)) return [];

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

function tableExpressionBase(expression: string): string {
  const match = /^(?<table>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\.[A-Za-z_$][\w$]*$/.exec(
    expression,
  );
  return match?.groups?.table ?? '';
}

function scalarProjectionTable(expression: string): string | undefined {
  const table = tableExpressionBase(expression.trim());
  return table || undefined;
}

function isOpaqueProjection(expression: string): boolean {
  return (
    projectionExpressionFact(expression, (node) => {
      if (ts.isTaggedTemplateExpression(node)) return expressionPathText(node.tag) === 'sql';
      if (!ts.isCallExpression(node)) return false;

      const callee = expressionPathText(node.expression);
      return callee === 'sql' || callee === 'raw' || callee.startsWith('sql.');
    }) ?? false
  );
}

function typedSqlProjectionShape(expression: string): QueryShape | null {
  return projectionExpressionFact(expression, (node, sourceFile) => {
    const typeArguments = ts.isTaggedTemplateExpression(node)
      ? node.typeArguments
      : ts.isCallExpression(node)
        ? node.typeArguments
        : undefined;
    const callee = ts.isTaggedTemplateExpression(node)
      ? expressionPathText(node.tag)
      : ts.isCallExpression(node)
        ? expressionPathText(node.expression)
        : undefined;
    if (callee !== 'sql' || typeArguments?.length !== 1) return null;

    const typeText = typeArguments[0]?.getText(sourceFile.compilerNode).trim();
    if (typeText === 'number') return 'number';
    if (typeText === 'boolean') return 'boolean';
    if (typeText === 'string') return 'string';
    return null;
  });
}

function projectionExpressionFact<T>(
  expression: string,
  visit: (node: ts.Expression, sourceFile: SourceFile) => T,
): T | null {
  return withParsedSourceFile(`const __jisoProjection = (${expression});`, (sourceFile) => {
    const declaration = sourceFile.getVariableDeclarations()[0];
    const initializer = declaration?.getInitializer();
    if (!initializer) return null;

    return visit(unwrappedExpression(initializer.compilerNode), sourceFile);
  });
}

function unwrappedExpression(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression)
    ? unwrappedExpression(expression.expression)
    : expression;
}

function expressionPathText(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const base = expressionPathText(expression.expression);
    return base ? `${base}.${expression.name.text}` : expression.name.text;
  }
  return '';
}

function hasDeclaredQueryOutputSchema(body: string): boolean {
  const objectStart = body.indexOf('{');
  if (objectStart === -1) return false;

  const objectEnd = findMatchingBrace(body, objectStart);
  if (objectEnd === -1) return false;

  let index = objectStart + 1;
  while (index < objectEnd) {
    index = skipTrivia(body, index);
    if (index >= objectEnd) return false;

    const property = readObjectPropertyName(body, index);
    if (property) {
      const afterName = skipTrivia(body, property.end);
      if (body[afterName] === ':' && property.name === 'output') return true;
    }

    index = nextTopLevelEntry(body, index, objectEnd);
  }

  return false;
}

function readObjectPropertyName(
  source: string,
  start: number,
): { end: number; name: string } | null {
  const quote = source[start];
  if (quote === '"' || quote === "'") {
    const end = findStringEnd(source, start, quote);
    if (end === -1) return null;
    return { end: end + 1, name: source.slice(start + 1, end) };
  }

  const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(start));
  if (!identifier) return null;

  return { end: start + identifier[0].length, name: identifier[0] };
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
  body: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const domains = new Set<string>();

  for (const tableExpression of queryTableExpressions(body)) {
    for (const table of tables.get(tableExpression) ?? []) {
      if (!isDomainTableAnnotation(table.annotation)) continue;
      domains.add(table.annotation.domain);
    }
  }

  return [...domains].sort();
}

function exemptQueryReadDiagnostics(
  body: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
  site: string,
): TouchGraphDiagnostic[] {
  const exemptTables = new Set<string>();

  for (const tableExpression of queryTableExpressions(body)) {
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

function queryTableExpressions(body: string): string[] {
  return [...queryJoinTableExpressions(body), ...queryRelationalTableExpressions(body)];
}

function queryJoinTableExpressions(body: string): string[] {
  return queryBodyCallExpressions(body, (call) => {
    const name = propertyAccessCallName(call);
    if (!name || !isQueryReadCallName(name)) return [];

    const table = staticExpressionPath(call.getArguments()[0]);
    return table ? [table] : [];
  });
}

function queryRelationalTableExpressions(body: string): string[] {
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

    return [table];
  });
}

function queryBodyCallExpressions<T>(
  body: string,
  extract: (call: CallExpression) => readonly T[],
): T[] {
  return withParsedSourceFile(`const __jisoQueryDefinition = ${body};`, (sourceFile) =>
    sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .sort((left, right) => callSourceOrder(left) - callSourceOrder(right))
      .flatMap(extract),
  );
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
  if (!Node.isPropertyAccessExpression(node)) return undefined;

  const base = staticExpressionPath(node.getExpression());
  return base ? `${base}.${node.getName()}` : undefined;
}

function queryInstanceKey(
  body: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Pick<QueryFact, 'instanceKey'> | null {
  const where = /\.where\s*\(\s*eq\s*\(\s*(?<left>[^,]+?)\s*,\s*(?<right>[^)]+?)\s*\)/.exec(body);
  const left = where?.groups?.left;
  const right = where?.groups?.right;
  if (!left || !right) return null;

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
    fn.receiverNames === undefined
      ? drizzleReceiverNames(fn.params, fn.body)
      : new Set(fn.receiverNames);

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

  for (const call of extractExternalDbArgumentCalls(fn.body, receiverNames, localFunctionNames)) {
    unresolved.push({
      operation: call.name,
      site: `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`,
    });
  }
  for (const call of extractUnclassifiedDrizzleReceiverCalls(fn.body, receiverNames)) {
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

  for (const { identifier, table: extractedTable } of declarations) {
    if (!extractedTable) continue;
    const table = {
      identifier,
      name: extractedTable.name,
      ...extractedTable.annotation,
    };
    tables.push(table);
    appendTable(byIdentifier, identifier, table);
  }

  for (const declaration of declarations) {
    if ((byIdentifier.get(declaration.identifier)?.length ?? 0) > 0) continue;

    for (const target of aliasTargets(declaration.initializerText)) {
      for (const table of byIdentifier.get(target) ?? []) {
        const alias = {
          identifier: declaration.identifier,
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
  identifier: string;
  initializerText: string;
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
          identifier: name.getText(),
          initializerText: initializer.getText(),
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

function tablesForFile(
  source: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Map<string, ExtractedTable[]> {
  const scoped = new Map([...tables].map(([identifier, entries]) => [identifier, [...entries]]));

  for (const namespace of namespaceImportAliases(source)) {
    for (const [identifier, entries] of tables) {
      appendTableEntries(scoped, `${namespace}.${identifier}`, entries);
    }
  }
  for (const alias of importExportTableAliases(source)) {
    appendTableEntries(scoped, alias.local, tables.get(alias.imported) ?? []);
  }

  return scoped;
}

function namespaceImportAliases(source: string): string[] {
  const aliases: string[] = [];
  const pattern = new RegExp(
    `import\\s+\\*\\s+as\\s+(?<alias>${IDENTIFIER_SOURCE})\\s+from\\s+["'][^"']+["']`,
    'g',
  );

  for (const match of source.matchAll(pattern)) {
    const alias = match.groups?.alias;
    if (alias) aliases.push(alias);
  }

  return aliases;
}

function importExportTableAliases(source: string): { imported: string; local: string }[] {
  const aliases: { imported: string; local: string }[] = [];
  const pattern =
    /\b(?:import|export)\s*\{\s*(?<specifiers>[^}]+)\s*\}(?:\s*from\s*["'][^"']+["'])?/g;
  const specifierPattern = new RegExp(
    `^(?<imported>${IDENTIFIER_SOURCE})(?:\\s+as\\s+(?<local>${IDENTIFIER_SOURCE}))?$`,
  );

  for (const match of source.matchAll(pattern)) {
    const specifiers = match.groups?.specifiers;
    if (!specifiers) continue;

    for (const specifier of specifiers.split(',')) {
      const parts = specifierPattern.exec(specifier.trim())?.groups;
      const imported = parts?.imported;
      const local = parts?.local;
      if (imported && local && imported !== local) aliases.push({ imported, local });
    }
  }

  return aliases;
}

function aliasTargets(initializer: string): string[] {
  const trimmed = initializer.trim();
  const direct = /^(?<identifier>[A-Za-z_$][\w$]*)$/.exec(trimmed)?.groups?.identifier;
  if (direct) return [direct];

  const alias = /^alias\s*\(\s*(?<identifier>[A-Za-z_$][\w$]*)\s*,/.exec(trimmed)?.groups
    ?.identifier;
  if (alias) return [alias];

  return conditionalBranches(trimmed).filter(Boolean);
}

function extractUnresolvedConditionalIdentifiers(
  source: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const unresolved: string[] = [];

  for (const declaration of variableDeclarationsFromSource(source)) {
    const targets = conditionalBranches(declaration.initializerText);
    if (targets.length === 0) continue;

    const resolvedCount = targets.filter((target) => (tables.get(target)?.length ?? 0) > 0).length;
    if (resolvedCount > 0 && resolvedCount < targets.length)
      unresolved.push(declaration.identifier);
  }

  return unresolved;
}

function conditionalBranches(initializer: string): string[] {
  const groups = /^[\s\S]+?\?\s*(?<whenTrue>[^:]+?)\s*:\s*(?<whenFalse>[\s\S]+)$/.exec(
    initializer.trim(),
  )?.groups;
  if (!groups) return [];

  return [groups.whenTrue, groups.whenFalse]
    .map((branch) => branch?.trim())
    .flatMap((branch) => (/^[A-Za-z_$][\w$]*$/.test(branch ?? '') ? [branch as string] : ['']));
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
  const params =
    Node.isArrowFunction(callback) ||
    Node.isFunctionDeclaration(callback) ||
    Node.isFunctionExpression(callback)
      ? callback
          .getParameters()
          .map((param) => param.getText())
          .join(', ')
      : '';
  const body = functionBody(callback);
  const bodyStart = Node.isBlock(body) ? body.getStart() + 1 : body.getStart();
  const bodyEnd = Node.isBlock(body) ? body.getEnd() - 1 : body.getEnd();

  return {
    body: body.getSourceFile().getFullText().slice(bodyStart, bodyEnd),
    bodyStart,
    name,
    params,
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
      if (!Node.isIdentifier(receiver) || !receiverNames.has(receiver.getText())) continue;

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
        !call
          .getArguments()
          .some((arg) => Node.isIdentifier(arg) && receiverNames.has(arg.getText()))
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
    ...extractReceiverExecuteCalls(source, receiverNames),
    ...extractRelationalQueryCalls(source, receiverNames),
  ];
}

function extractReceiverExecuteCalls(
  source: string,
  receiverNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  // SPEC §10-§11: string/template text cannot fabricate unresolved touch-graph surfaces.
  return withParsedFunctionBodySource(source, ({ bodyOffset, sourceFile }) => {
    const calls: ExternalDbArgumentCall[] = [];

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expression = call.getExpression();
      if (staticAccessName(expression) !== 'execute') continue;

      const receiver = staticAccessExpression(expression);
      if (!Node.isIdentifier(receiver) || !receiverNames.has(receiver.getText())) continue;

      const index = call.getStart() - bodyOffset;
      if (index >= 0) calls.push({ index, name: 'execute' });
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
      if (!Node.isIdentifier(receiver) || !receiverNames.has(receiver.getText())) continue;

      const index = call.getStart() - bodyOffset;
      if (index >= 0) calls.push({ index, name: `query.${method}` });
    }

    return calls;
  });
}

function drizzleReceiverNames(params: string, body = ''): Set<string> {
  const names = new Set(DEFAULT_DRIZZLE_RECEIVER_NAMES);

  for (const param of splitTopLevelArgs(params)) {
    const trimmed = param.trim();
    const identifier = new RegExp(`^(?<name>${IDENTIFIER_SOURCE})\\b`).exec(trimmed)?.groups?.name;
    if (identifier && isLikelyDrizzleReceiver(identifier)) names.add(identifier);

    for (const match of trimmed.matchAll(/\b(?<name>db|tx)\b/g)) {
      const name = match.groups?.name;
      if (name) names.add(name);
    }
  }

  for (const alias of destructuredDrizzleReceiverAliases(body)) {
    names.add(alias);
  }

  return names;
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
  const predicate = wherePredicate(statement);
  const key = predicate ? extractParameterizedKey(predicate, tableIdentifier, table) : undefined;
  if (key) return { key };

  return hasNonEqPredicate(predicate, tableIdentifier, table) ? { predicate: 'non-eq' } : {};
}

function wherePredicate(statement: string): string | undefined {
  // SPEC §10-§11: predicate text inside strings/comments must not fabricate row-key facts.
  return withParsedSourceFile(`${statement};`, (sourceFile) => {
    const whereCall = sourceFile
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((call) => propertyAccessCallName(call) === 'where');

    return whereCall?.getArguments()[0]?.getText().trim();
  });
}

function extractParameterizedKey(
  predicate: string,
  tableIdentifier: string,
  table: JisoDomainTableAnnotation,
): string | undefined {
  if (!table.key) return undefined;

  const match = /^eq\s*\(\s*(?<left>[^,]+?)\s*,\s*(?<right>[^)]+?)\s*\)$/.exec(predicate);
  const left = match?.groups?.left?.trim();
  const right = match?.groups?.right?.trim();
  if (!left || !right) return undefined;

  if (left === `${tableIdentifier}.${table.key}`) return argumentKey(right);
  if (right === `${tableIdentifier}.${table.key}`) return argumentKey(left);
  return undefined;
}

function hasNonEqPredicate(
  predicate: string | undefined,
  tableIdentifier: string,
  table: JisoDomainTableAnnotation,
): boolean {
  if (!table.key) return false;

  if (!predicate || !predicate.includes(`${tableIdentifier}.${table.key}`)) return false;
  if (/^eq\s*\(/.test(predicate)) return false;
  return true;
}

function argumentKey(expression: string): string | undefined {
  const member = /^(?<base>[A-Za-z_$][\w$]*)\.(?<property>[A-Za-z_$][\w$]*)$/.exec(expression);
  if (member?.groups) {
    if (member.groups.base !== 'input') return undefined;
    return member.groups.property ? `arg:${member.groups.property}` : undefined;
  }

  return /^[A-Za-z_$][\w$]*$/.test(expression) ? `arg:${expression}` : undefined;
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

function splitTopLevelArgs(source: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (char !== ',' || depth !== 0) continue;

    args.push(source.slice(start, index));
    start = index + 1;
  }

  args.push(source.slice(start));
  return args.filter((arg) => arg.trim().length > 0);
}

function skipTrivia(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    if (/\s/.test(source[index] ?? '')) {
      index += 1;
      continue;
    }

    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }

    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }

    return index;
  }

  return index;
}

function nextTopLevelEntry(source: string, start: number, end: number): number {
  let depth = 0;

  for (let index = start; index < end; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const stringEnd = findStringEnd(source, index, char);
      index = stringEnd === -1 ? end : stringEnd;
      continue;
    }
    if (source.startsWith('//', index)) {
      const commentEnd = source.indexOf('\n', index + 2);
      index = commentEnd === -1 ? end : commentEnd;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? end : commentEnd + 1;
      continue;
    }

    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (char === ',' && depth === 0) return index + 1;
  }

  return end;
}

function findStringEnd(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index;
  }

  return -1;
}

function findMatchingBrace(source: string, openBrace: number): number {
  let depth = 0;

  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function findMatchingParen(source: string, openParen: number): number {
  let depth = 0;

  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}
