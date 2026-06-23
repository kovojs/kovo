import {
  Project,
  SyntaxKind,
  Node,
  ts,
  type ArrowFunction,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';

import {
  UNRESOLVED_READ_SOURCE_EXPRESSION,
  appendTableEntries,
  callSourceOrder,
  declaredRelationTableForInitializer,
  isProjectTableInitializerNode,
  isQueryCallOnReceiver,
  isQueryReadCallName,
  isTableInitializerNode,
  projectForeignKeysForTable,
  projectNamespaceAccessTableName,
  projectNamespaceTableNamesByLocal,
  projectTableNameForNode,
  propertyAccessCallName,
  resolvedSymbolKey,
  tableAnnotation,
  tableColumnShapes,
  tableNameArgument,
  touchBodyCallExpressions,
  unmodeledRelationFromExpression,
  type ExtractedTable,
  type ExtractedTableAnnotation,
  type ProjectExtraction,
  type ProjectNamespaceTableNames,
  type QueryReceiverReferences,
  type QueryShape,
  type SourceFileInput,
} from '../static.js';

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

/** @internal */ export function withParsedSourceFile<T>(
  file: SourceFileInput,
  visit: (sourceFile: SourceFile) => T,
): T {
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

/** @internal */ export interface SourceModuleContext {
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

/** @internal */ export function projectSourceModuleContext(
  extraction: ProjectExtraction,
): SourceModuleContext {
  // SPEC §10-§11: project-mode table facts come from resolved ts-morph symbols, not rewritten
  // source text that is reparsed through source-mode table extraction.
  const tablesBySyntheticName = projectTablesBySyntheticName(extraction);
  const declaredRelationTablesByExpression = projectDeclaredRelationTablesByExpression(extraction);
  const derivedRelationTablesByExpression = projectDerivedRelationTablesByExpression(
    extraction,
    tablesBySyntheticName,
  );
  const tablesByFileName = new Map<string, Map<string, ExtractedTable[]>>();

  extraction.sourceFiles.forEach((sourceFile, index) => {
    const file = extraction.files[index];
    if (!file) return;

    const tables = new Map<string, ExtractedTable[]>();
    appendProjectDeclaredTables(tables, sourceFile, extraction, tablesBySyntheticName);
    appendProjectReferencedTables(tables, sourceFile, extraction, tablesBySyntheticName);
    appendProjectDeclaredRelationTables(tables, declaredRelationTablesByExpression);
    appendProjectDerivedRelationTables(tables, derivedRelationTablesByExpression);
    appendProjectGlobalSyntheticTables(tables, tablesBySyntheticName, extraction);
    tablesByFileName.set(file.fileName, tables);
  });

  return {
    fileNames: new Set(extraction.files.map((file) => file.fileName)),
    filesByName: new Map(extraction.files.map((file) => [file.fileName, file])),
    tablesByFileName,
  };
}

/** @internal */ export function projectTablesBySyntheticName(
  extraction: ProjectExtraction,
): ReadonlyMap<string, ExtractedTable> {
  const tables = new Map<string, ExtractedTable>();

  for (const sourceFile of extraction.sourceFiles) {
    const namespaceTableNames = projectNamespaceTableNamesByLocal(
      sourceFile,
      extraction.tableNamesBySymbol,
    );
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
        foreignKeys: projectForeignKeysForTable(
          initializer,
          extraction.tableNamesBySymbol,
          namespaceTableNames,
        ),
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
      ...(firstTable.foreignKeys ? { foreignKeys: firstTable.foreignKeys } : {}),
    });
  }

  return tables;
}

function projectDeclaredRelationTablesByExpression(
  extraction: ProjectExtraction,
): ReadonlyMap<string, readonly ExtractedTable[]> {
  const relationTables = new Map<string, ExtractedTable[]>();

  for (const sourceFile of extraction.sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const expression = extraction.unmodeledRelationNamesBySymbol.get(
        resolvedSymbolKey(declaration.getNameNode().getSymbol()) ?? '',
      );
      if (!expression) continue;

      const relation = unmodeledRelationFromExpression(expression);
      if (!relation) continue;

      const table = declaredRelationTableForInitializer(declaration.getInitializer(), relation);
      if (table) relationTables.set(expression, [table]);
    }
  }

  return relationTables;
}

function projectDerivedRelationTablesByExpression(
  extraction: ProjectExtraction,
  tablesBySyntheticName: ReadonlyMap<string, ExtractedTable>,
): ReadonlyMap<string, readonly ExtractedTable[]> {
  const relationTables = new Map<string, ExtractedTable[]>();

  for (const sourceFile of extraction.sourceFiles) {
    const namespaceTableNames = projectNamespaceTableNamesByLocal(
      sourceFile,
      extraction.tableNamesBySymbol,
    );
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const expression = extraction.unmodeledRelationNamesBySymbol.get(
        resolvedSymbolKey(declaration.getNameNode().getSymbol()) ?? '',
      );
      if (!expression) continue;

      const relation = unmodeledRelationFromExpression(expression);
      if (relation?.kind !== 'view') continue;

      const tableExpressions = projectViewReadTableExpressions(
        declaration.getInitializer(),
        extraction.tableNamesBySymbol,
        namespaceTableNames,
      );
      const tables = tableExpressions.flatMap((tableExpression) => {
        const table =
          tablesBySyntheticName.get(tableExpression) ??
          tablesBySyntheticName.get(tableExpression.split('.').at(-1) ?? '');
        return table ? [table] : [];
      });
      if (tables.length > 0) {
        relationTables.set(expression, [
          ...new Map(tables.map((table) => [extractedTableKey(table), table])).values(),
        ]);
      }
    }
  }

  return relationTables;
}

function projectViewReadTableExpressions(
  initializer: Node | undefined,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
): string[] {
  const callback = viewAsCallback(initializer);
  if (!callback) return [];

  const parameter = callback.getParameters()[0]?.getNameNode();
  if (!parameter || !Node.isIdentifier(parameter)) return [];

  const receiverReferences: QueryReceiverReferences = {
    names: new Set([parameter.getText()]),
    projectContainers: true,
    symbolKeys: new Set(),
  };
  const body = callback.getBody();
  return queryReadTableExpressionsForBody(body, receiverReferences, (node) =>
    projectTableNameForNode(node, tableNamesBySymbol, namespaceTableNames),
  );
}

function viewAsCallback(initializer: Node | undefined): ArrowFunction | FunctionExpression | null {
  if (!initializer || !Node.isCallExpression(initializer)) return null;

  const calls = [
    ...(Node.isCallExpression(initializer) ? [initializer] : []),
    ...initializer.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const asCall = calls.find((call) => propertyAccessCallName(call) === 'as');
  const callback = asCall?.getArguments()[0];
  return callback && (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))
    ? callback
    : null;
}

function queryReadTableExpressionsForBody(
  body: Node,
  receiverReferences: QueryReceiverReferences,
  readTableIdentifier: (node: Node) => string | undefined,
): string[] {
  return touchBodyCallExpressions(body)
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right))
    .flatMap((call) => {
      const name = propertyAccessCallName(call);
      if (!name || !isQueryReadCallName(name)) return [];
      if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

      const tableArgument = call.getArguments()[0];
      const table = tableArgument ? readTableIdentifier(tableArgument) : undefined;
      return table ? [table] : [];
    });
}

function extractedTableKey(table: ExtractedTable): string {
  return `${table.annotation.name}\0${JSON.stringify(table.annotation)}`;
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

function appendProjectDerivedRelationTables(
  tables: Map<string, ExtractedTable[]>,
  derivedRelationTablesByExpression: ReadonlyMap<string, readonly ExtractedTable[]>,
): void {
  for (const [expression, entries] of derivedRelationTablesByExpression) {
    appendTableEntries(tables, expression, entries);
  }
}

function appendProjectDeclaredRelationTables(
  tables: Map<string, ExtractedTable[]>,
  declaredRelationTablesByExpression: ReadonlyMap<string, readonly ExtractedTable[]>,
): void {
  for (const [expression, entries] of declaredRelationTablesByExpression) {
    appendTableEntries(tables, expression, entries);
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

/** @internal */ export function tablesForFile(
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

/** @internal */ export function normalizeModulePath(path: string): string {
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

/** @internal */ export function extractUnresolvedConditionalIdentifiers(
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
