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

let sourceExtractionFileId = 0;

const IDENTIFIER_SOURCE = String.raw`[A-Za-z_$][\w$]*`;
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
const VARIABLE_DECLARATION_SOURCE = String.raw`(?:export\s+)?(?:const|let|var)\s+`;
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
  const files = sourceFilesWithProjectExtractionResolvedFromProject(extraction);
  const projectWriteCalls = projectWriteCallsByFileName(extraction);

  return extractTouchGraphFromPreparedFiles(files, (file) =>
    extractFunctions(file.source).map((fn) => {
      const writeCalls = projectWriteCalls.get(file.fileName)?.get(fn.name);
      return writeCalls ? { ...fn, writeCalls } : fn;
    }),
  );
}

export function extractQueryFactsFromProject(options: TouchGraphProjectOptions): QueryFact[] {
  const files = sourceFilesWithProjectExtractionResolved(options);

  return extractQueryFactsFromSource(files);
}

function sourceFilesWithProjectExtractionResolved(
  options: TouchGraphProjectOptions,
): SourceFileInput[] {
  return sourceFilesWithProjectExtractionResolvedFromProject(createProjectExtraction(options));
}

interface ProjectExtraction {
  columnShapesByTable: ReadonlyMap<string, Readonly<Record<string, QueryShape>>>;
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

function projectWriteCallsByFileName(
  extraction: ProjectExtraction,
): Map<string, Map<string, readonly ExtractedWriteCall[]>> {
  const callsByFile = new Map<string, Map<string, readonly ExtractedWriteCall[]>>();

  extraction.sourceFiles.forEach((sourceFile, index) => {
    const file = extraction.files[index];
    if (!file) return;

    const callsByFunction = new Map<string, readonly ExtractedWriteCall[]>();

    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      const body = fn.getBody();
      if (!name || !body) continue;

      callsByFunction.set(
        name,
        extractProjectDrizzleWriteCalls(body, file, extraction.tableNamesBySymbol),
      );
    }

    for (const declaration of sourceFile.getVariableDeclarations()) {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isIdentifier(name) || !initializer) continue;
      if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;

      const body = initializer.getBody();
      callsByFunction.set(
        name.getText(),
        extractProjectDrizzleWriteCalls(body, file, extraction.tableNamesBySymbol),
      );
    }

    for (const [name, callback] of projectDomainWriteCallbacks(sourceFile)) {
      callsByFunction.set(
        name,
        extractProjectDrizzleWriteCalls(callback.body, file, extraction.tableNamesBySymbol),
      );
    }

    callsByFile.set(file.fileName, callsByFunction);
  });

  return callsByFile;
}

function projectDomainWriteCallbacks(sourceFile: SourceFile): Map<string, { body: Node }> {
  const callbacks = new Map<string, { body: Node }>();

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

      callbacks.set(`${domainName.getText()}.${memberName}`, { body: functionBody(callback) });
    }
  }

  return callbacks;
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

    for (const { identifier, initializer } of declarations) {
      if (!isAnnotatedTableInitializerNode(initializer)) continue;

      const columns = tableColumnShapes(initializer);
      if (Object.keys(columns).length === 0) continue;

      const tableName = tableNameArgument(initializer) ?? identifier;
      localShapes.set(identifier, columns);
      shapes.set(identifier, columns);
      shapes.set(tableName, columns);
    }

    for (const declaration of declarations) {
      if (localShapes.has(declaration.identifier)) continue;

      for (const target of aliasTargets(declaration.initializer.getText())) {
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
  if (!relationalQueryCallPattern().test(body)) return [];

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
  if (/sql\s*<\s*number\s*>/.test(expression)) return 'number';
  if (/sql\s*<\s*boolean\s*>/.test(expression)) return 'boolean';
  if (/sql\s*<\s*string\s*>/.test(expression)) return 'string';
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
  const tableExpression = `${IDENTIFIER_SOURCE}(?:\\.${IDENTIFIER_SOURCE})?`;
  const calls = new RegExp(
    `\\.(?<operation>from|join|innerJoin|leftJoin|rightJoin|fullJoin)\\s*\\(\\s*(?<table>${tableExpression})`,
    'g',
  );

  for (const match of body.matchAll(calls)) {
    const operation = match.groups?.operation;
    const table = match.groups?.table;
    if (!operation || !table) continue;

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
  return /\bsql\s*(?:<|`|\(|\.)|\braw\s*\(/.test(expression);
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
  return [
    ...body.matchAll(
      /\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin)\s*\(\s*(?<table>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g,
    ),
    ...body.matchAll(relationalQueryCallPattern()),
  ].flatMap((match) => (match.groups?.table ? [match.groups.table] : []));
}

function relationalQueryCallPattern(): RegExp {
  return new RegExp(
    `\\b${IDENTIFIER_SOURCE}\\s*\\.\\s*query\\s*\\.\\s*(?<table>${IDENTIFIER_SOURCE})\\s*\\.\\s*(?:findMany|findFirst)\\s*\\(`,
    'g',
  );
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
  const receiverNames = drizzleReceiverNames(fn.params, fn.body);

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

  for (const { identifier, initializer } of declarations) {
    if (!isAnnotatedTableInitializerNode(initializer)) continue;

    const annotation = tableAnnotation(initializer);
    if (!annotation) continue;

    const table = {
      identifier,
      name: tableNameArgument(initializer) ?? identifier,
      ...annotation,
    };
    tables.push(table);
    appendTable(byIdentifier, identifier, table);
  }

  for (const declaration of declarations) {
    if ((byIdentifier.get(declaration.identifier)?.length ?? 0) > 0) continue;

    for (const target of aliasTargets(declaration.initializer.getText())) {
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

function variableDeclarationsFromSource(
  source: string,
): { identifier: string; initializer: Node }[] {
  return parseSourceFile(source)
    .getVariableDeclarations()
    .flatMap((declaration) => {
      const name = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!initializer || !Node.isIdentifier(name)) return [];

      return [{ identifier: name.getText(), initializer }];
    });
}

function parseSourceFile(source: string): SourceFile {
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

  sourceExtractionFileId += 1;
  return project.createSourceFile(`__jiso_source_${sourceExtractionFileId}.ts`, source);
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
    const targets = conditionalBranches(declaration.initializer.getText());
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
  const functions: ExtractedFunction[] = [];
  const declarations = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+(?<name>${IDENTIFIER_SOURCE})\\s*\\((?<params>[^)]*)\\)\\s*\\{`,
    'g',
  );

  for (const match of source.matchAll(declarations)) {
    const groups = match.groups;
    if (!groups || match.index === undefined) continue;

    const name = groups.name;
    if (!name) continue;

    const openBrace = match.index + match[0].length - 1;
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace === -1) continue;

    functions.push({
      body: source.slice(openBrace + 1, closeBrace),
      bodyStart: openBrace + 1,
      name,
      params: groups.params ?? '',
    });
  }

  return [
    ...functions,
    ...extractVariableAssignedFunctions(source),
    ...extractDomainWriteCallbacks(source),
  ];
}

function extractVariableAssignedFunctions(source: string): ExtractedFunction[] {
  const functions: ExtractedFunction[] = [];
  const declarations = new RegExp(
    `${VARIABLE_DECLARATION_SOURCE}(?<name>${IDENTIFIER_SOURCE})\\s*(?::[^=]+)?=\\s*`,
    'g',
  );

  for (const match of source.matchAll(declarations)) {
    const groups = match.groups;
    if (!groups || match.index === undefined) continue;

    const name = groups.name;
    if (!name) continue;

    const initializerStart = match.index + match[0].length;
    const assigned = variableAssignedFunction(source, initializerStart);
    if (assigned) functions.push({ name, ...assigned });
  }

  return functions;
}

function variableAssignedFunction(
  source: string,
  initializerStart: number,
): Pick<ExtractedFunction, 'body' | 'bodyStart' | 'params'> | null {
  const initializer = source.slice(initializerStart);
  const functionExpression = new RegExp(
    `^(?:async\\s*)?function(?:\\s+${IDENTIFIER_SOURCE})?\\s*\\((?<params>[^)]*)\\)\\s*\\{`,
  ).exec(initializer);

  if (functionExpression?.groups) {
    const openBrace = initializerStart + functionExpression[0].length - 1;
    const closeBrace = findMatchingBrace(source, openBrace);
    if (closeBrace === -1) return null;

    return {
      body: source.slice(openBrace + 1, closeBrace),
      bodyStart: openBrace + 1,
      params: functionExpression.groups.params ?? '',
    };
  }

  const arrowExpression = new RegExp(
    `^(?:async\\s*)?(?<params>\\([^)]*\\)|${IDENTIFIER_SOURCE})\\s*=>\\s*`,
  ).exec(initializer);
  const params = arrowExpression?.groups?.params;
  if (!arrowExpression || !params) return null;

  const bodyStart = initializerStart + arrowExpression[0].length;
  const openBrace = source[bodyStart] === '{' ? bodyStart : -1;
  const bodyEnd =
    openBrace === -1 ? statementEnd(source, bodyStart) : findMatchingBrace(source, openBrace);
  if (bodyEnd === -1) return null;

  return {
    body: source.slice(openBrace === -1 ? bodyStart : openBrace + 1, bodyEnd),
    bodyStart: openBrace === -1 ? bodyStart : openBrace + 1,
    params: params.replace(/^\(|\)$/g, ''),
  };
}

function extractDomainWriteCallbacks(source: string): ExtractedFunction[] {
  const callbacks: ExtractedFunction[] = [];
  const sourceFile = parseSourceFile(source);

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
    Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)
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
  if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
    return callback.getBody();
  }

  throw new Error('Expected a write callback function');
}

function extractLocalFunctionCalls(source: string): string[] {
  const calls: string[] = [];
  const callPattern = new RegExp(`\\b(?<name>${IDENTIFIER_SOURCE})\\s*\\(`, 'g');

  for (const match of source.matchAll(callPattern)) {
    const name = match.groups?.name;
    if (!name || IGNORED_LOCAL_CALL_NAMES.has(name)) continue;

    const previous = source.slice(0, match.index).trimEnd().at(-1);
    if (previous === '.') continue;

    calls.push(name);
  }

  return [...new Set(calls)];
}

function extractDrizzleWriteCalls(
  source: string,
  receiverNames: ReadonlySet<string> = DEFAULT_DRIZZLE_RECEIVER_NAMES,
): ExtractedWriteCall[] {
  const calls: ExtractedWriteCall[] = [];
  // SPEC §10-§11: source text in comments/strings must not fabricate touch-graph facts.
  const { bodyOffset, sourceFile } = parseFunctionBodySource(source);

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
}

function parseFunctionBodySource(source: string): { bodyOffset: number; sourceFile: SourceFile } {
  const prefix = 'async function __jisoExtractedBody() {\n';
  return {
    bodyOffset: prefix.length,
    sourceFile: parseSourceFile(`${prefix}${source}\n}`),
  };
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
  const calls: ExternalDbArgumentCall[] = [];
  const pattern = new RegExp(`\\b(?<name>${IDENTIFIER_SOURCE})\\s*\\((?<args>[^)]*)\\)`, 'g');

  for (const match of source.matchAll(pattern)) {
    const name = match.groups?.name;
    const args = match.groups?.args;
    if (!name || !args || match.index === undefined) continue;
    if (IGNORED_LOCAL_CALL_NAMES.has(name) || localFunctionNames.has(name)) continue;

    const previous = source.slice(0, match.index).trimEnd().at(-1);
    if (previous === '.') continue;

    const passedReceivers = splitTopLevelArgs(args).some((arg) => receiverNames.has(arg.trim()));
    if (passedReceivers) calls.push({ index: match.index, name });
  }

  return calls;
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
  const calls: ExternalDbArgumentCall[] = [];
  const pattern = new RegExp(
    `\\b(?<receiver>${IDENTIFIER_SOURCE})\\s*\\.\\s*(?<name>execute)\\s*\\(`,
    'g',
  );

  for (const match of source.matchAll(pattern)) {
    const receiver = match.groups?.receiver;
    const name = match.groups?.name;
    if (!receiver || !receiverNames.has(receiver) || !name || match.index === undefined) continue;

    calls.push({ index: match.index, name });
  }

  return calls;
}

function extractRelationalQueryCalls(
  source: string,
  receiverNames: ReadonlySet<string>,
): ExternalDbArgumentCall[] {
  const calls: ExternalDbArgumentCall[] = [];
  const pattern = new RegExp(
    `\\b(?<receiver>${IDENTIFIER_SOURCE})\\s*\\.\\s*query\\s*\\.\\s*${IDENTIFIER_SOURCE}\\s*\\.\\s*(?<method>findMany|findFirst)\\s*\\(`,
    'g',
  );

  for (const match of source.matchAll(pattern)) {
    const receiver = match.groups?.receiver;
    const method = match.groups?.method;
    if (!receiver || !receiverNames.has(receiver) || !method || match.index === undefined) continue;

    calls.push({ index: match.index, name: `query.${method}` });
  }

  return calls;
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
  for (const match of body.matchAll(
    new RegExp(
      `\\b(?:const|let)\\s*\\{\\s*(?:db|tx)\\s*:\\s*(?<alias>${IDENTIFIER_SOURCE})\\s*\\}`,
      'g',
    ),
  )) {
    const alias = match.groups?.alias;
    if (alias) names.add(alias);
  }

  return names;
}

function isLikelyDrizzleReceiver(name: string): boolean {
  return /^(db|tx|trx|database|client|conn|connection|writer|transaction)$/.test(name);
}

function extractReadSources(source: string, operation: string): ExtractedReadSource[] {
  const sourceFile = parseSourceFile(source);
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
  return Node.isPropertyAccessExpression(expression) ? expression.getName() : undefined;
}

function statementEnd(source: string, start: number): number {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (char === '"' || char === "'" || char === '`') {
      const stringEnd = findStringEnd(source, index, char);
      index = stringEnd === -1 ? source.length : stringEnd;
      continue;
    }
    if (source.startsWith('//', index)) {
      const commentEnd = source.indexOf('\n', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }

    if (char === '(' || char === '{' || char === '[') depth += 1;
    if (char === ')' || char === '}' || char === ']') depth -= 1;
    if (depth !== 0) continue;

    if (char === ';') return index;
    if (char === '\n' && isStatementBoundary(source, index + 1)) return index;
  }

  return source.length;
}

function isStatementBoundary(source: string, start: number): boolean {
  const next = source.slice(skipTrivia(source, start));
  return next.length === 0 || !next.startsWith('.');
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
  const where = /\.where\s*\(/.exec(statement);
  if (!where || where.index === undefined) return undefined;

  const openParen = where.index + where[0].length - 1;
  const closeParen = findMatchingParen(statement, openParen);
  if (closeParen === -1) return undefined;

  return statement.slice(openParen + 1, closeParen).trim();
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
