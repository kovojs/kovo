export type {
  DiagnosticCode,
  ReadSite,
  TouchGraph,
  TouchGraphEntry,
  TouchSite,
  UnresolvedWriteSite,
} from '@jiso/core';
import {
  diagnosticDefinitions,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type ReadSite,
  type TouchGraph,
  type TouchGraphEntry,
  type TouchSite,
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

export interface JisoTableAnnotation {
  domain: string;
  key?: string;
}

export type JisoTableExtraConfig = JisoTableAnnotation & ((self: unknown) => []);

export function jiso(annotation: JisoTableAnnotation): JisoTableExtraConfig {
  return Object.assign((() => []) as (self: unknown) => [], annotation) as JisoTableExtraConfig;
}

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

export interface DomainRegistryInput {
  table: JisoTableAnnotation & { name: string };
}

export interface WriteSummaryInput {
  branch?: string;
  operation: string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  table: JisoTableAnnotation & { name: string };
  writeKey?: string;
}

export interface ReadSummaryInput {
  branch?: string;
  operation: 'insert-select' | 'update-from' | (string & {});
  predicate?: 'eq' | 'non-eq';
  readKey?: string;
  site: string;
  table: JisoTableAnnotation & { name: string };
}

export interface UnresolvedSummaryInput {
  domain?: string;
  operation: string;
  site: string;
}

export interface TouchGraphDiagnostic {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
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

export function serializeDomainRegistry(tables: readonly DomainRegistryInput[]): string {
  const rows = [...tables].sort((left, right) => left.table.name.localeCompare(right.table.name));
  const domains = [...new Set(rows.map((row) => row.table.domain))].sort();
  const domainKey = domains.map((domain) => JSON.stringify(domain)).join(' | ') || 'never';
  const lines = [`export type DomainKey = ${domainKey};`, '', 'export const tableDomains = {'];

  for (const row of rows) {
    lines.push(`  ${JSON.stringify(row.table.name)}: ${JSON.stringify(row.table.domain)},`);
  }

  lines.push('} as const satisfies Record<string, DomainKey>;');
  return `${lines.join('\n')}\n`;
}

export function createTouchGraphEntry(input: {
  reads?: readonly ReadSummaryInput[];
  unresolved?: readonly UnresolvedSummaryInput[];
  writes?: readonly WriteSummaryInput[];
}): TouchGraphEntry {
  return {
    reads: [...(input.reads ?? [])]
      .map((read) => ({
        ...(read.branch === undefined ? {} : { branch: read.branch }),
        domain: read.table.domain,
        keys: read.readKey ?? null,
        ...(read.predicate === undefined ? {} : { predicate: read.predicate }),
        site: read.site,
        source: read.operation,
        via: read.table.name,
      }))
      .sort(compareReadSites),
    touches: [...(input.writes ?? [])]
      .map((write) => ({
        ...(write.branch === undefined ? {} : { branch: write.branch }),
        domain: write.table.domain,
        keys: write.writeKey ?? null,
        ...(write.predicate === undefined ? {} : { predicate: write.predicate }),
        site: write.site,
        via: write.table.name,
      }))
      .sort(compareTouchSites),
    unresolved: [...(input.unresolved ?? [])].map((site) => ({
      code: 'FW406',
      ...(site.domain === undefined ? {} : { domain: site.domain }),
      message: diagnosticDefinitions.FW406.message,
      site: site.site,
    })),
  };
}

export function serializeTouchGraph(graph: TouchGraph): string {
  const lines = ['export const touchGraph = {'];

  for (const [writeName, entry] of Object.entries(graph).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  ${JSON.stringify(writeName)}: {`);
    lines.push('    touches: [');
    for (const touch of entry.touches) {
      lines.push(
        `      { domain: ${JSON.stringify(touch.domain)}, via: ${JSON.stringify(touch.via)}, site: ${JSON.stringify(touch.site)}, keys: ${JSON.stringify(touch.keys)}${touch.branch === undefined ? '' : `, branch: ${JSON.stringify(touch.branch)}`}${touch.predicate === undefined ? '' : `, predicate: ${JSON.stringify(touch.predicate)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('    reads: [');
    for (const read of entry.reads ?? []) {
      lines.push(
        `      { domain: ${JSON.stringify(read.domain)}, via: ${JSON.stringify(read.via)}, site: ${JSON.stringify(read.site)}, keys: ${JSON.stringify(read.keys)}, source: ${JSON.stringify(read.source)}${read.branch === undefined ? '' : `, branch: ${JSON.stringify(read.branch)}`}${read.predicate === undefined ? '' : `, predicate: ${JSON.stringify(read.predicate)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('    unresolved: [');
    for (const unresolved of entry.unresolved) {
      lines.push(
        `      { code: 'FW406', site: ${JSON.stringify(unresolved.site)}, message: ${JSON.stringify(unresolved.message)}${unresolved.domain === undefined ? '' : `, domain: ${JSON.stringify(unresolved.domain)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('  },');
  }

  lines.push('} as const;');
  return `${lines.join('\n')}\n`;
}

export function diagnosticsForTouchGraph(graph: TouchGraph): TouchGraphDiagnostic[] {
  return Object.values(graph).flatMap((entry) => [
    ...entry.unresolved.map((unresolved) => ({
      code: unresolved.code,
      message: unresolved.message,
      severity: diagnosticDefinitions[unresolved.code].severity,
      site: unresolved.site,
    })),
    ...entry.touches
      .filter((touch) => touch.predicate === 'non-eq')
      .map((touch) => ({
        code: 'FW409' as const,
        message: diagnosticDefinitions.FW409.message,
        severity: diagnosticDefinitions.FW409.severity,
        site: touch.site,
      })),
    ...(entry.reads ?? [])
      .filter((read) => read.predicate === 'non-eq')
      .map((read) => ({
        code: 'FW409' as const,
        message: diagnosticDefinitions.FW409.message,
        severity: diagnosticDefinitions.FW409.severity,
        site: read.site,
      })),
  ]);
}

export function diagnosticsForQueryFacts(facts: readonly QueryFact[]): TouchGraphDiagnostic[] {
  return facts.flatMap((fact) => [...(fact.diagnostics ?? [])]);
}

export function extractTouchGraphFromSource(files: readonly SourceFileInput[]): TouchGraph {
  const tables = new Map<string, ExtractedTable[]>();
  const unresolvedIdentifiers = new Set<string>();
  const graph: Record<string, TouchGraphEntry> = {};

  for (const file of files) {
    for (const table of extractTables(file.source)) {
      appendTable(tables, table.identifier, {
        annotation: {
          domain: table.domain,
          ...(table.key ? { key: table.key } : {}),
          name: table.name,
        },
      });
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
    const functions = extractFunctions(file.source);
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
  const files = sourceFilesWithProjectExtractionResolved(options);

  return extractTouchGraphFromSource(files);
}

export function extractQueryFactsFromProject(options: TouchGraphProjectOptions): QueryFact[] {
  const files = sourceFilesWithProjectExtractionResolved(options);

  return extractQueryFactsFromSource(files);
}

function sourceFilesWithProjectExtractionResolved(
  options: TouchGraphProjectOptions,
): SourceFileInput[] {
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

  return options.files.map((file, index) => {
    const sourceFile = sourceFiles[index];
    if (!sourceFile) throw new Error(`Missing source file for ${file.fileName}`);

    return {
      columnShapes: columnShapesForFile(sourceFile, tableNamesBySymbol, columnShapesByTable),
      fileName: file.fileName,
      source: sourceWithProjectExtractionResolved(file.source, sourceFile, tableNamesBySymbol),
    };
  });
}

export function extractQueryFactsFromSource(files: readonly SourceFileInput[]): QueryFact[] {
  const tables = new Map<string, ExtractedTable[]>();
  const facts: QueryFact[] = [];

  for (const file of files) {
    for (const table of extractTables(file.source)) {
      appendTable(tables, table.identifier, {
        annotation: {
          domain: table.domain,
          ...(table.key ? { key: table.key } : {}),
          name: table.name,
        },
      });
    }
  }
  for (const file of files) {
    for (const alias of importExportTableAliases(file.source)) {
      appendTableEntries(tables, alias.local, tables.get(alias.imported) ?? []);
    }
  }

  for (const file of files) {
    for (const query of extractQueryDefinitions(file.source, file.columnShapes ?? {})) {
      const reads = queryReadDomains(query.body, tables);
      const site = `${file.fileName}:${lineForIndex(file.source, query.index)}`;
      const diagnostics = opaqueProjectionDiagnostics(
        query.query,
        query.opaquePaths,
        site,
        hasDeclaredQueryOutputSchema(query.body),
      ).concat(query.diagnostics?.map((diagnostic) => ({ ...diagnostic, site })) ?? []);
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
  if (
    /\b(?:PgDatabase|NodePgDatabase|PostgresJsDatabase|PgliteDatabase|Neon.*Database|BaseSQLiteDatabase|MySql2Database|MySqlDatabase)\b/.test(
      typeText,
    )
  ) {
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
      if (!initializer || !isAnnotatedTableInitializer(initializer.getText())) continue;

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
      if (!initializer || !isAnnotatedTableInitializer(initializer.getText())) continue;

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

function isAnnotatedTableInitializer(source: string): boolean {
  return /\b(?:pgTable|sqliteTable|mysqlTable)\s*\(/.test(source) && /\bjiso\s*\(/.test(source);
}

interface ExtractedTableDeclaration {
  domain: string;
  identifier: string;
  key?: string;
  name: string;
}

interface ExtractedFunction {
  body: string;
  bodyStart: number;
  name: string;
  params: string;
}

interface ExtractedQueryDefinition {
  body: string;
  diagnostics?: readonly TouchGraphDiagnostic[];
  index: number;
  opaquePaths: readonly string[];
  query: string;
  shape: QueryShape;
}

interface ExtractedWriteCall {
  index: number;
  operation: string;
  readSources: ExtractedReadSource[];
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
  const pattern =
    /(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*query\s*\(\s*["'](?<query>[^"']+)["']\s*,/g;

  for (const match of source.matchAll(pattern)) {
    const query = match.groups?.query;
    if (!query) continue;

    const objectStart = source.indexOf('{', match.index + match[0].length);
    if (objectStart === -1) continue;

    const objectEnd = findMatchingBrace(source, objectStart);
    if (objectEnd === -1) continue;

    const body = source.slice(objectStart, objectEnd + 1);
    const selection = selectShapeFromQueryBody(body, columnShapes);
    if (!selection) continue;

    definitions.push({
      body,
      ...(selection.diagnostics ? { diagnostics: selection.diagnostics } : {}),
      index: match.index,
      opaquePaths: selection.opaquePaths,
      query,
      shape: selection.shape,
    });
  }

  return definitions;
}

interface QueryShapeSelection {
  diagnostics?: readonly TouchGraphDiagnostic[];
  opaquePaths: readonly string[];
  shape: QueryShape;
}

function selectShapeFromQueryBody(
  body: string,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
): QueryShapeSelection | null {
  const selectCall = /\.select\s*\(/.exec(body);
  if (!selectCall) return null;

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
      opaquePaths: [],
      shape: {},
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

function queryShapeFromObjectLiteral(
  source: string,
  prefix = '',
  columnShapes: Readonly<Record<string, QueryShape>> = {},
  nullableTables: ReadonlySet<string> = new Set(),
): QueryShapeSelection {
  const shape: Record<string, QueryShape> = {};
  const opaquePaths: string[] = [];

  for (const entry of splitTopLevelArgs(source)) {
    const separator = entry.indexOf(':');
    if (separator === -1) continue;

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
      shape[key] = nested.shape;
      opaquePaths.push(...nested.opaquePaths);
    } else {
      shape[key] = scalarQueryShape(key, value, columnShapes, nullableTables);
      if (isOpaqueProjection(value)) opaquePaths.push(path);
    }
  }

  return { opaquePaths, shape };
}

function scalarQueryShape(
  key: string,
  expression: string,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
  nullableTables: ReadonlySet<string> = new Set(),
): QueryShape {
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
  if (/(count|qty|quantity|total|price|stock|amount)$/i.test(key)) return 'number';
  return 'string';
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
  const joins = /\.leftJoin\s*\(\s*(?<table>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g;

  for (const match of body.matchAll(joins)) {
    const table = match.groups?.table;
    if (table) tables.add(table);
  }

  return tables;
}

function tableExpressionBase(expression: string): string {
  const match = /^(?<table>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\.[A-Za-z_$][\w$]*$/.exec(
    expression,
  );
  return match?.groups?.table ?? '';
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

  return opaquePaths.map((path) => ({
    code: 'FW410',
    message: `${diagnosticDefinitions.FW410.message} ${query}.${path} requires a declared output schema for opaque sql/raw projection.`,
    severity: diagnosticDefinitions.FW410.severity,
    site: line,
  }));
}

function queryReadDomains(
  body: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string[] {
  const domains = new Set<string>();

  for (const tableExpression of queryTableExpressions(body)) {
    for (const table of tables.get(tableExpression) ?? []) {
      domains.add(table.annotation.domain);
    }
  }

  return [...domains].sort();
}

function queryTableExpressions(body: string): string[] {
  return [
    ...body.matchAll(
      /\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin)\s*\(\s*(?<table>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g,
    ),
  ].flatMap((match) => (match.groups?.table ? [match.groups.table] : []));
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
    if (table.annotation.key === key) {
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

  for (const call of extractDrizzleWriteCalls(fn.body, receiverNames)) {
    const site = `${file.fileName}:${lineForIndex(file.source, fn.bodyStart + call.index)}`;
    const resolvedTables = tables.get(call.tableExpression) ?? [];

    if (resolvedTables.length > 0) {
      for (const table of resolvedTables) {
        const writePredicate = extractPredicateSummary(
          call.statement,
          call.tableExpression,
          table.annotation,
          tables,
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
            const readPredicate = extractPredicateSummary(
              call.statement,
              readSource.tableExpression,
              readTable.annotation,
              tables,
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
  const declarations =
    /(?:export\s+)?const\s+(?<identifier>[A-Za-z_$][\w$]*)\s*=\s*(?<initializer>[\s\S]*?);/g;

  const matches = [...source.matchAll(declarations)];

  for (const match of matches) {
    const declaration = tableDeclarationFromMatch(match);
    if (!declaration) continue;

    const { identifier, initializer } = declaration;
    if (!isAnnotatedTableInitializer(initializer)) continue;

    const domain = stringProperty(initializer, 'domain');
    if (!domain) continue;

    const key = stringProperty(initializer, 'key');

    const table = {
      domain,
      identifier,
      ...(key ? { key } : {}),
      name: stringArgument(initializer) ?? identifier,
    };
    tables.push(table);
    appendTable(byIdentifier, identifier, table);
  }

  for (const match of matches) {
    const declaration = tableDeclarationFromMatch(match);
    if (!declaration || (byIdentifier.get(declaration.identifier)?.length ?? 0) > 0) continue;

    for (const target of aliasTargets(declaration.initializer)) {
      for (const table of byIdentifier.get(target) ?? []) {
        const alias = {
          domain: table.domain,
          identifier: declaration.identifier,
          ...(table.key ? { key: table.key } : {}),
          name: table.name,
        };
        tables.push(alias);
        appendTable(byIdentifier, alias.identifier, alias);
      }
    }
  }

  return tables;
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
  const pattern = /import\s+\*\s+as\s+(?<alias>[A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/g;

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

  for (const match of source.matchAll(pattern)) {
    const specifiers = match.groups?.specifiers;
    if (!specifiers) continue;

    for (const specifier of specifiers.split(',')) {
      const parts = /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/.exec(
        specifier.trim(),
      )?.groups;
      const imported = parts?.imported;
      const local = parts?.local;
      if (imported && local && imported !== local) aliases.push({ imported, local });
    }
  }

  return aliases;
}

function tableDeclarationFromMatch(
  match: RegExpMatchArray,
): { identifier: string; initializer: string } | undefined {
  const groups = match.groups;
  if (!groups) return undefined;

  const identifier = groups.identifier;
  const initializer = groups.initializer;
  return identifier && initializer ? { identifier, initializer } : undefined;
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
  const declarations =
    /(?:export\s+)?const\s+(?<identifier>[A-Za-z_$][\w$]*)\s*=\s*(?<initializer>[\s\S]*?);/g;

  for (const match of source.matchAll(declarations)) {
    const declaration = tableDeclarationFromMatch(match);
    if (!declaration) continue;

    const targets = conditionalBranches(declaration.initializer);
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
  const declarations =
    /(?:export\s+)?(?:async\s+)?function\s+(?<name>[A-Za-z_$][\w$]*)\s*\((?<params>[^)]*)\)\s*\{/g;

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
  const declarations =
    /(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*/g;

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
  const functionExpression =
    /^(?:async\s*)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\((?<params>[^)]*)\)\s*\{/.exec(initializer);

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

  const arrowExpression = /^(?:async\s*)?(?<params>\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/.exec(
    initializer,
  );
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
  const declarations = /(?:export\s+)?const\s+(?<domain>[A-Za-z_$][\w$]*)\s*=\s*domain\s*\(/g;

  for (const match of source.matchAll(declarations)) {
    const domainName = match.groups?.domain;
    if (!domainName || match.index === undefined) continue;

    const objectStart = source.indexOf('{', match.index + match[0].length);
    if (objectStart === -1) continue;

    const objectEnd = findMatchingBrace(source, objectStart);
    if (objectEnd === -1) continue;

    callbacks.push(
      ...extractDomainObjectWriteCallbacks(
        domainName,
        source.slice(objectStart + 1, objectEnd),
        objectStart + 1,
        source,
      ),
    );
  }

  return callbacks;
}

function extractDomainObjectWriteCallbacks(
  domainName: string,
  objectSource: string,
  objectOffset: number,
  fullSource: string,
): ExtractedFunction[] {
  const callbacks: ExtractedFunction[] = [];
  const properties = /\b(?<member>[A-Za-z_$][\w$]*)\s*:\s*write\s*\(/g;

  for (const match of objectSource.matchAll(properties)) {
    const memberName = match.groups?.member;
    if (!memberName || match.index === undefined) continue;

    const openParen = objectSource.indexOf('(', match.index + match[0].lastIndexOf('write'));
    if (openParen === -1) continue;

    const absoluteOpenParen = objectOffset + openParen;
    const closeParen = findMatchingParen(fullSource, absoluteOpenParen);
    if (closeParen === -1) continue;

    const callback = arrowCallbackFromWriteArgs(fullSource, absoluteOpenParen + 1, closeParen);
    if (!callback) continue;

    callbacks.push({
      body: fullSource.slice(callback.bodyStart, callback.bodyEnd),
      bodyStart: callback.bodyStart,
      name: `${domainName}.${memberName}`,
      params: callback.params,
    });
  }

  return callbacks;
}

function arrowCallbackFromWriteArgs(
  source: string,
  argsStart: number,
  argsEnd: number,
): { bodyEnd: number; bodyStart: number; params: string } | null {
  const args = source.slice(argsStart, argsEnd);
  const arrowCallbacks = [...args.matchAll(/(?:async\s*)?\((?<params>[^)]*)\)\s*=>\s*\{/g)];
  const callback = arrowCallbacks.at(-1);
  const params = callback?.groups?.params;
  if (!callback || params === undefined || callback.index === undefined) return null;

  const bodyOpen = argsStart + callback.index + callback[0].length - 1;
  const bodyClose = findMatchingBrace(source, bodyOpen);
  if (bodyClose === -1) return null;

  return {
    bodyEnd: bodyClose,
    bodyStart: bodyOpen + 1,
    params,
  };
}

function extractLocalFunctionCalls(source: string): string[] {
  const calls: string[] = [];
  const callPattern = /\b(?<name>[A-Za-z_$][\w$]*)\s*\(/g;
  const ignored = new Set([
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

  for (const match of source.matchAll(callPattern)) {
    const name = match.groups?.name;
    if (!name || ignored.has(name)) continue;

    const previous = source.slice(0, match.index).trimEnd().at(-1);
    if (previous === '.') continue;

    calls.push(name);
  }

  return [...new Set(calls)];
}

function extractDrizzleWriteCalls(
  source: string,
  receiverNames: ReadonlySet<string> = new Set(['db', 'tx']),
): ExtractedWriteCall[] {
  const calls: ExtractedWriteCall[] = [];
  const callPattern =
    /(?<receiver>[A-Za-z_$][\w$]*)\s*\.\s*(?<operation>insert|update|delete)\s*\(\s*(?<tableExpression>[^)]+?)\s*\)/g;

  for (const match of source.matchAll(callPattern)) {
    const groups = match.groups;
    if (!groups || match.index === undefined) continue;

    const receiver = groups.receiver;
    const operation = groups.operation;
    const tableExpression = groups.tableExpression;
    if (!receiver || !receiverNames.has(receiver) || !operation || !tableExpression) continue;
    const statement = source.slice(match.index, statementEnd(source, match.index));

    calls.push({
      index: match.index,
      operation,
      readSources: extractReadSources(statement, operation),
      statement,
      tableExpression: tableExpression.trim(),
    });
  }

  return calls;
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
  const ignored = new Set([
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
  const pattern = /\b(?<name>[A-Za-z_$][\w$]*)\s*\((?<args>[^)]*)\)/g;

  for (const match of source.matchAll(pattern)) {
    const name = match.groups?.name;
    const args = match.groups?.args;
    if (!name || !args || match.index === undefined) continue;
    if (ignored.has(name) || localFunctionNames.has(name)) continue;

    const previous = source.slice(0, match.index).trimEnd().at(-1);
    if (previous === '.') continue;

    const passedReceivers = splitTopLevelArgs(args).some((arg) => receiverNames.has(arg.trim()));
    if (passedReceivers) calls.push({ index: match.index, name });
  }

  return calls;
}

function drizzleReceiverNames(params: string, body = ''): Set<string> {
  const names = new Set(['db', 'tx']);

  for (const param of splitTopLevelArgs(params)) {
    const trimmed = param.trim();
    const identifier = /^(?<name>[A-Za-z_$][\w$]*)\b/.exec(trimmed)?.groups?.name;
    if (identifier && isLikelyDrizzleReceiver(identifier)) names.add(identifier);

    for (const match of trimmed.matchAll(/\b(?<name>db|tx)\b/g)) {
      const name = match.groups?.name;
      if (name) names.add(name);
    }
  }
  for (const match of body.matchAll(
    /\b(?:const|let)\s*\{\s*(?:db|tx)\s*:\s*(?<alias>[A-Za-z_$][\w$]*)\s*\}/g,
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
  const sourceOperation =
    operation === 'insert' && /\.select\s*\(/.test(source)
      ? 'insert-select'
      : operation === 'update' && /\.from\s*\(/.test(source)
        ? 'update-from'
        : null;
  if (!sourceOperation) return [];

  const sources: ExtractedReadSource[] = [];
  const sourcePattern =
    /\.(?:from|join|innerJoin|leftJoin|rightJoin|fullJoin)\s*\(\s*(?<tableExpression>[A-Za-z_$][\w$]*|[^,)]+)\s*(?:,|\))/g;

  for (const match of source.matchAll(sourcePattern)) {
    const tableExpression = match.groups?.tableExpression?.trim();
    if (!tableExpression) continue;

    sources.push({
      operation: sourceOperation,
      tableExpression,
    });
  }

  return sources;
}

function statementEnd(source: string, start: number): number {
  const end = source.indexOf(';', start);
  return end === -1 ? source.length : end;
}

function extractPredicateSummary(
  statement: string,
  tableIdentifier: string,
  table: JisoTableAnnotation,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): ExtractedPredicateSummary {
  const predicate = wherePredicate(statement);
  const key = predicate
    ? extractParameterizedKey(predicate, tableIdentifier, table, tables)
    : undefined;
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
  table: JisoTableAnnotation,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | undefined {
  if (!table.key) return undefined;

  const match = /^eq\s*\(\s*(?<left>[^,]+?)\s*,\s*(?<right>[^)]+?)\s*\)$/.exec(predicate);
  const left = match?.groups?.left?.trim();
  const right = match?.groups?.right?.trim();
  if (!left || !right) return undefined;

  if (left === `${tableIdentifier}.${table.key}`) return argumentKey(right, tables);
  if (right === `${tableIdentifier}.${table.key}`) return argumentKey(left, tables);
  return undefined;
}

function hasNonEqPredicate(
  predicate: string | undefined,
  tableIdentifier: string,
  table: JisoTableAnnotation,
): boolean {
  if (!table.key) return false;

  if (!predicate || !predicate.includes(`${tableIdentifier}.${table.key}`)) return false;
  if (/^eq\s*\(/.test(predicate)) return false;
  return true;
}

function argumentKey(
  expression: string,
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): string | undefined {
  const member = /^(?<base>[A-Za-z_$][\w$]*)\.(?<property>[A-Za-z_$][\w$]*)$/.exec(expression);
  if (member?.groups) {
    if ((tables.get(member.groups.base ?? '')?.length ?? 0) > 0) return undefined;
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

function stringArgument(source: string): string | undefined {
  return /\(\s*["'](?<value>[^"']+)["']/.exec(source)?.groups?.value;
}

function stringProperty(source: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*:\\s*["'](?<value>[^"']+)["']`);
  return pattern.exec(source)?.groups?.value;
}

function compareTouchSites(left: TouchSite, right: TouchSite): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.via.localeCompare(right.via) ||
    (left.branch ?? '').localeCompare(right.branch ?? '') ||
    (left.predicate ?? '').localeCompare(right.predicate ?? '') ||
    left.site.localeCompare(right.site)
  );
}

function compareReadSites(left: ReadSite, right: ReadSite): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.via.localeCompare(right.via) ||
    left.source.localeCompare(right.source) ||
    (left.branch ?? '').localeCompare(right.branch ?? '') ||
    (left.predicate ?? '').localeCompare(right.predicate ?? '') ||
    left.site.localeCompare(right.site)
  );
}
