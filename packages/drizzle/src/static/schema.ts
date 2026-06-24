import {
  Node,
  SyntaxKind,
  ts,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
  type Symbol as MorphSymbol,
  type Type as MorphType,
} from 'ts-morph';
import {
  isDrizzleDatabaseTypeName,
  isDrizzleTableFactoryName,
  isKovoExtraConfigCallName,
  type KovoDomainTableAnnotation,
  type KovoFanAnnotation,
  type KovoSecretColumnAnnotation,
  type KovoTableAnnotation,
  type KovoViewAnnotation,
} from '../drizzle-surface.js';
import {
  type ExtractedForeignKey,
  type ExtractedTable,
  type ExtractedTableAnnotation,
  type ProjectExtraction,
  type ProjectNamespaceTableNames,
  type QueryShape,
  type QueryShapeWrapper,
  type SourceFileInput,
  DRIZZLE_CORE_MODULE_SPECIFIERS,
  DRIZZLE_UNMODELED_RELATION_FACTORY_NAMES,
  JSON_COLUMN_BUILDERS,
  NUMBER_COLUMN_BUILDERS,
  BOOLEAN_COLUMN_BUILDERS,
  UNMODELED_RELATION_EXPRESSION_PREFIX,
  appendTableEntries,
  projectExportedTableNamesByName,
  projectNamespaceTableNamesByLocal,
  projectTableNameForNode,
  projectTableNameForSymbol,
  propertyAccessCallName,
  staticExpressionPath,
  staticLiteralContainerInitializer,
  staticLiteralReferenceFromExpression,
  stringPropertyFromObject,
  symbolForCallbackReference,
  nullableShape,
  projectContextFiles,
  projectNamespaceAccessTableName,
  projectSourceFileName,
  staticAccessExpression,
  staticAccessName,
  tableAnnotation,
  unwrappedStaticExpressionNode,
  unwrappedTsExpression,
} from '../static.js';
import { projectSourceModuleContext, type SourceModuleContext } from './tables.js';
import { receiverParameterDeclaration } from './receiver-surface.js';

/** @internal */ export function sourceColumnShapesForTables(
  tables: ReadonlyMap<string, readonly ExtractedTable[]>,
): Readonly<Record<string, QueryShape>> {
  const scoped: Record<string, QueryShape> = {};

  for (const [identifier, entries] of tables) {
    for (const table of entries) {
      for (const [column, shape] of Object.entries(table.columns)) {
        const columnShape = secretAnnotatedShape(shape, table.annotation, column);
        scoped[`${identifier}.${column}`] = columnShape;
        scoped[`${table.annotation.name}.${column}`] = columnShape;
      }
    }
  }

  return scoped;
}

function secretAnnotatedShape(
  shape: QueryShape,
  annotation: ExtractedTableAnnotation,
  column: string,
): QueryShape {
  if (!('secret' in annotation) || annotation.secret === undefined) return shape;
  if (!annotationSecretIncludesColumn(annotation.secret, column)) return shape;
  return secretQueryShape(shape);
}

function annotationSecretIncludesColumn(
  secret: KovoSecretColumnAnnotation,
  column: string,
): boolean {
  if (secret === true) return true;
  const references = Array.isArray(secret) ? secret : [secret];
  return references.some((reference) => reference === column);
}

function secretQueryShape(shape: QueryShape): QueryShape {
  if (isQueryShapeWrapper(shape)) {
    if (shape.kind === 'secret') return shape;
    return { ...shape, shape: secretQueryShape(shape.shape) };
  }
  return { kind: 'secret', shape };
}

function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return false;
  return (
    'kind' in shape &&
    'shape' in shape &&
    (shape.kind === 'nullable' ||
      shape.kind === 'optional' ||
      shape.kind === 'secret' ||
      shape.kind === 'volatile-time' ||
      (shape.kind === 'revealed' && 'reveal' in shape))
  );
}

/** @internal */ export function projectRelationalTableNamesByProperty(
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

/** @internal */ export function isDrizzleWriteCall(call: CallExpression): boolean {
  const expression = call.getExpression();
  const name = staticAccessName(expression);
  return (
    name === 'delete' ||
    name === 'insert' ||
    name === 'refreshMaterializedView' ||
    name === 'update'
  );
}

/** @internal */ export function isDrizzleReceiver(receiver: Node): boolean {
  const type = receiver.getType();
  if (isDrizzleDatabaseType(type)) {
    return true;
  }
  if (isDrizzleDatabaseTypeAnnotation(receiver)) {
    return true;
  }

  // SPEC §11.1: project receiver proof is restricted to the blessed Drizzle
  // database type identities listed in drizzle-surface.ts, across supported dialects.
  return false;
}

/** @internal */ export function isDrizzleDatabaseTypeAnnotation(receiver: Node): boolean {
  const parameter = receiverParameterDeclaration(receiver);
  const typeNode = parameter?.getTypeNode();
  return typeNode ? isDrizzleDatabaseTypeNode(typeNode) : false;
}

/** @internal */ export function isDrizzleDatabaseType(type: MorphType): boolean {
  // SPEC §11.1: project receiver proof comes from ts-morph type identity. Avoid source-text
  // membership checks that can promote arbitrary aliases like `NotPgDatabase`.
  return (
    drizzleDatabaseTypeNames(type, new Set()).some(isDrizzleDatabaseTypeName) &&
    drizzleDatabaseTypeDeclarations(type, new Set()).some((declaration) =>
      isDrizzleOrmDeclaration(declaration),
    )
  );
}

/** @internal */ export function drizzleDatabaseTypeNames(
  type: MorphType,
  seen: Set<string>,
): string[] {
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

/** @internal */ export function drizzleDatabaseTypeDeclarations(
  type: MorphType,
  seen: Set<string>,
): Node[] {
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

/** @internal */ export function isDrizzleDatabaseTypeNode(typeNode: Node): boolean {
  if (typeNode.getKind() !== SyntaxKind.TypeReference) return false;
  if (isDrizzleDatabaseType(typeNode.getType())) return true;

  const typeReference = typeNode.asKind(SyntaxKind.TypeReference);
  const typeNameSymbol = typeReference?.getTypeName().getSymbol();
  const symbol = typeNameSymbol?.getAliasedSymbol() ?? typeNameSymbol;
  if (!symbol || !isDrizzleDatabaseTypeName(symbol.getName())) return false;

  return symbol.getDeclarations().some((declaration) => isDrizzleOrmDeclaration(declaration));
}

/** @internal */ export function projectTableNamesBySymbol(
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

/** @internal */ export interface UnmodeledRelationFact {
  expression: string;
  kind: 'materialized-view' | 'view';
  name: string;
}

/** @internal */ export function projectUnmodeledRelationNamesBySymbol(
  sourceFiles: readonly SourceFile[],
): ReadonlyMap<string, string> {
  const namesBySymbol = new Map<string, string>();

  for (const sourceFile of sourceFiles) {
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer();
      const relation = unmodeledRelationForInitializer(initializer);
      if (!relation) continue;

      const symbolKey = resolvedSymbolKey(declaration.getNameNode().getSymbol());
      if (!symbolKey) continue;

      namesBySymbol.set(symbolKey, unmodeledRelationExpression(relation.kind, relation.name));
    }
  }

  return namesBySymbol;
}

/** @internal */ export function projectUnmodeledRelationNameForNode(
  node: Node,
  relationNamesBySymbol: ReadonlyMap<string, string>,
): string | undefined {
  const expression = unwrappedStaticExpressionNode(node);
  if (expression !== node) {
    return projectUnmodeledRelationNameForNode(expression, relationNamesBySymbol);
  }

  if (Node.isPropertyAccessExpression(node)) {
    return projectUnmodeledRelationNameForSymbol(node.getNameNode(), relationNamesBySymbol);
  }
  if (Node.isElementAccessExpression(node)) {
    return projectUnmodeledRelationNameForSymbol(node, relationNamesBySymbol);
  }

  return projectUnmodeledRelationNameForSymbol(node, relationNamesBySymbol);
}

/** @internal */ export function projectUnmodeledRelationNameForSymbol(
  node: Node,
  relationNamesBySymbol: ReadonlyMap<string, string>,
): string | undefined {
  const symbolKey = resolvedSymbolKey(node.getSymbol());
  if (!symbolKey) return undefined;
  return relationNamesBySymbol.get(symbolKey);
}

/** @internal */ export function unmodeledRelationForInitializer(
  initializer: Node | undefined,
): Pick<UnmodeledRelationFact, 'kind' | 'name'> | undefined {
  if (!initializer || !Node.isCallExpression(initializer)) return undefined;

  const rootCall = rootCallExpression(initializer);
  const expression = unwrappedStaticExpressionNode(rootCall.getExpression());
  const factoryName = Node.isIdentifier(expression)
    ? (projectDrizzleCoreIdentifierExportName(expression) ?? expression.getText())
    : Node.isPropertyAccessExpression(expression) && isDrizzleCoreNamespaceMember(expression)
      ? expression.getName()
      : undefined;
  if (!factoryName || !DRIZZLE_UNMODELED_RELATION_FACTORY_NAMES.has(factoryName)) {
    return undefined;
  }

  return {
    kind: factoryName === 'pgMaterializedView' ? 'materialized-view' : 'view',
    name: tableNameArgument(rootCall) ?? '<unknown>',
  };
}

/** @internal */ export function rootCallExpression(call: CallExpression): CallExpression {
  let current = call;

  while (true) {
    const receiver = staticAccessExpression(current.getExpression());
    if (!receiver || !Node.isCallExpression(receiver)) return current;
    current = receiver;
  }
}

/** @internal */ export function unmodeledRelationExpression(
  kind: UnmodeledRelationFact['kind'],
  name: string,
): string {
  return `${UNMODELED_RELATION_EXPRESSION_PREFIX}:${kind}:${name}`;
}

/** @internal */ export function unmodeledRelationFromExpression(
  expression: string,
): UnmodeledRelationFact | undefined {
  const [prefix, kind, ...nameParts] = expression.split(':');
  const name = nameParts.join(':');
  if (
    prefix !== UNMODELED_RELATION_EXPRESSION_PREFIX ||
    (kind !== 'materialized-view' && kind !== 'view') ||
    name.length === 0
  ) {
    return undefined;
  }

  return { expression, kind, name };
}

/** @internal */ export function appendProjectAliasTableNames(
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

/** @internal */ export function appendProjectConditionalTableNames(
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

/** @internal */ export function projectUnresolvedConditionalTableExpressions(
  extraction: ProjectExtraction,
): Set<string> {
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

/** @internal */ export function projectConditionalTargetTableNames(
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

/** @internal */ export function projectAliasTargetTableName(
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

/** @internal */ export function isProjectDrizzleAliasCall(call: CallExpression): boolean {
  const expression = call.getExpression();
  if (!Node.isIdentifier(expression) || expression.getText() !== 'alias') return false;

  const symbol = expression.getSymbol()?.getAliasedSymbol() ?? expression.getSymbol();
  return (
    symbol?.getDeclarations().some((declaration) => isDrizzleOrmDeclaration(declaration)) ?? false
  );
}

/** @internal */ export function isDrizzleOrmDeclaration(declaration: Node): boolean {
  if (declaration.getSourceFile().getFilePath().includes('drizzle-orm')) return true;

  const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
  if (importDeclaration?.getModuleSpecifierValue().startsWith('drizzle-orm')) return true;

  const moduleDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ModuleDeclaration);
  const moduleName = moduleDeclaration?.getNameNode();
  return Node.isStringLiteral(moduleName) && moduleName.getLiteralText().startsWith('drizzle-orm');
}

/** @internal */ export function projectColumnShapesByTable(
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
      const annotation = tableAnnotation(initializer);
      if (Object.keys(columns).length > 0) {
        shapes.set(
          tableName,
          annotation ? secretAnnotatedColumnShapes(columns, annotation) : columns,
        );
      }
    }
  }

  return shapes;
}

function secretAnnotatedColumnShapes(
  columns: Record<string, QueryShape>,
  annotation: ExtractedTableAnnotation,
): Record<string, QueryShape> {
  const shapes: Record<string, QueryShape> = {};
  for (const [column, shape] of Object.entries(columns)) {
    shapes[column] = secretAnnotatedShape(shape, annotation, column);
  }
  return shapes;
}

/** @internal */ export function tableColumnShapes(
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

/** @internal */ export function projectForeignKeysForTable(
  initializer: Node,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
): ExtractedForeignKey[] {
  const call = Node.isCallExpression(initializer) ? initializer : undefined;
  const columns = call?.getArguments()[1];
  if (!columns || !Node.isObjectLiteralExpression(columns)) return [];

  const foreignKeys: ExtractedForeignKey[] = [];
  for (const property of columns.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;

    const column = propertyNameText(property.getNameNode());
    const columnInitializer = property.getInitializer();
    if (!column || !columnInitializer) continue;

    const foreignKey = projectForeignKeyForColumn(
      column,
      columnInitializer,
      tableNamesBySymbol,
      namespaceTableNames,
    );
    if (foreignKey) foreignKeys.push(foreignKey);
  }

  return foreignKeys;
}

/** @internal */ export function projectForeignKeyForColumn(
  column: string,
  initializer: Node,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
): ExtractedForeignKey | null {
  const calls = [
    ...(Node.isCallExpression(initializer) ? [initializer] : []),
    ...initializer.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  const referencesCall = calls.find((call) => propertyAccessCallName(call) === 'references');
  if (!referencesCall) return null;

  const target = foreignKeyTargetTableExpression(
    referencesCall.getArguments()[0],
    tableNamesBySymbol,
    namespaceTableNames,
  );
  if (!target) return null;

  return {
    column,
    ...foreignKeyActions(referencesCall, calls),
    targetTableExpression: target,
  };
}

/** @internal */ export function foreignKeyTargetTableExpression(
  callback: Node | undefined,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
): string | undefined {
  const target = foreignKeyCallbackReturnExpression(callback);
  if (!target) return undefined;

  const tableExpression = Node.isPropertyAccessExpression(target)
    ? target.getExpression()
    : Node.isElementAccessExpression(target)
      ? target.getExpression()
      : target;
  return projectTableNameForNode(tableExpression, tableNamesBySymbol, namespaceTableNames);
}

/** @internal */ export function foreignKeyCallbackReturnExpression(
  callback: Node | undefined,
): Node | undefined {
  if (!callback) return undefined;

  const expression = unwrappedStaticExpressionNode(callback);
  if (Node.isArrowFunction(expression)) {
    const body = expression.getBody();
    return Node.isBlock(body) ? blockSingleReturnExpression(body) : body;
  }
  if (Node.isFunctionExpression(expression)) {
    const body = expression.getBody();
    return body ? blockSingleReturnExpression(body) : undefined;
  }

  return undefined;
}

/** @internal */ export function blockSingleReturnExpression(body: Node): Node | undefined {
  if (!Node.isBlock(body)) return undefined;

  const statements = body.getStatements();
  if (statements.length !== 1) return undefined;

  const statement = statements[0];
  if (!statement || !Node.isReturnStatement(statement)) return undefined;

  return statement.getExpression();
}

/** @internal */ export function foreignKeyActions(
  referencesCall: CallExpression,
  calls: readonly CallExpression[],
): Pick<ExtractedForeignKey, 'onDelete' | 'onUpdate'> {
  const optionObject = referencesCall.getArguments()[1];
  return {
    ...foreignKeyActionOptions(optionObject),
    ...foreignKeyActionMethods(calls),
  };
}

/** @internal */ export function foreignKeyActionOptions(
  options: Node | undefined,
): Pick<ExtractedForeignKey, 'onDelete' | 'onUpdate'> {
  if (!options || !Node.isObjectLiteralExpression(options)) return {};

  const onDelete = stringPropertyFromObject(options, 'onDelete');
  const onUpdate = stringPropertyFromObject(options, 'onUpdate');
  return {
    ...(onDelete ? { onDelete } : {}),
    ...(onUpdate ? { onUpdate } : {}),
  };
}

/** @internal */ export function foreignKeyActionMethods(
  calls: readonly CallExpression[],
): Pick<ExtractedForeignKey, 'onDelete' | 'onUpdate'> {
  const actions: Pick<ExtractedForeignKey, 'onDelete' | 'onUpdate'> = {};

  for (const call of calls) {
    const name = propertyAccessCallName(call);
    if (name !== 'onDelete' && name !== 'onUpdate') continue;

    const action = call.getArguments()[0];
    if (!action || !Node.isStringLiteral(action)) continue;
    actions[name] = action.getLiteralText();
  }

  return actions;
}

/** @internal */ export function projectColumnBuilderShape(
  initializer: Node | undefined,
): QueryShape | undefined {
  const builder = projectColumnBuilderName(initializer);
  if (!builder) return undefined;

  const baseShape = columnBuilderBaseShape(builder, columnBuilderMode(initializer));
  if (!baseShape) return undefined;
  return columnBuilderIsNonNull(initializer) ? baseShape : nullableShape(baseShape);
}

/** @internal */ export function propertyNameText(
  name: Node,
  resolveStaticComputed = false,
): string | undefined {
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

/** @internal */ export function computedPropertyNameExpression(name: Node): Node | undefined {
  if (!ts.isComputedPropertyName(name.compilerNode)) return undefined;

  return name.getChildren().find((child) => {
    const kind = child.getKind();
    return kind !== SyntaxKind.OpenBracketToken && kind !== SyntaxKind.CloseBracketToken;
  });
}

/** @internal */ export function staticPropertyNameExpressionText(
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

/** @internal */ export function objectAssignmentTargetNode(
  property: ReturnType<ObjectLiteralExpression['getProperties']>[number],
): Node | undefined {
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  if (!Node.isPropertyAssignment(property)) return undefined;
  const initializer = property.getInitializer();
  return initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
}

/** @internal */ export function objectAssignmentPropertyName(
  property: ReturnType<ObjectLiteralExpression['getProperties']>[number],
): string | undefined {
  if (!Node.isShorthandPropertyAssignment(property) && !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  return propertyNameText(property.getNameNode());
}

/** @internal */ export function objectHasProperty(object: Node, name: string): boolean {
  if (!Node.isObjectLiteralExpression(object)) return false;

  return object.getProperties().some((property) => {
    if (!Node.isPropertyAssignment(property)) return false;
    return propertyNameText(property.getNameNode()) === name;
  });
}

/** @internal */ export function objectPropertyInitializer(
  object: Node,
  name: string,
): Node | undefined {
  if (!Node.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.getNameNode()) !== name) continue;
    const initializer = property.getInitializer();
    return initializer ? unwrappedStaticExpressionNode(initializer) : undefined;
  }

  return undefined;
}

/** @internal */ export function queryDeclaredReadExpressions(
  body: ObjectLiteralExpression,
  readTableIdentifier: ((node: Node) => string | undefined) | undefined,
): string[] {
  const reads = objectPropertyInitializer(body, 'reads');
  if (!reads || !Node.isArrayLiteralExpression(reads)) return [];

  return reads.getElements().flatMap((element) => {
    const expression = unwrappedStaticExpressionNode(element);
    if (Node.isIdentifier(expression) || Node.isPropertyAccessExpression(expression)) {
      return [readTableIdentifier?.(expression) ?? expression.getText()];
    }
    return [];
  });
}

/** @internal */ export function queryOutputShape(
  body: ObjectLiteralExpression,
): QueryShape | undefined {
  const output = objectPropertyInitializer(body, 'output');
  return output ? queryShapeFromSchemaExpression(output) : undefined;
}

/** @internal */ export function queryShapeFromSchemaExpression(
  expression: Node,
): QueryShape | undefined {
  const node = unwrappedStaticExpressionNode(expression);
  if (!Node.isCallExpression(node)) return undefined;

  const callee = node.getExpression();
  if (Node.isPropertyAccessExpression(callee)) {
    const method = callee.getName();
    if (method === 'optional') {
      const inner = queryShapeFromSchemaExpression(callee.getExpression());
      return inner ? { kind: 'optional', shape: inner } : undefined;
    }
    if (method === 'nullable') {
      const inner = queryShapeFromSchemaExpression(callee.getExpression());
      return inner ? { kind: 'nullable', shape: inner } : undefined;
    }
    if (['int', 'min', 'max', 'default'].includes(method)) {
      return queryShapeFromSchemaExpression(callee.getExpression());
    }
    if (Node.isIdentifier(callee.getExpression()) && callee.getExpression().getText() === 's') {
      if (method === 'string') return 'string';
      if (method === 'number') return 'number';
      if (method === 'boolean') return 'boolean';
      if (method === 'array') {
        const element = node.getArguments()[0];
        const shape = element ? queryShapeFromSchemaExpression(element) : undefined;
        return shape ? [shape] : 'array';
      }
      if (method === 'object') {
        const fields = node.getArguments()[0];
        if (!fields || !Node.isObjectLiteralExpression(fields)) return 'object';
        const shape: Record<string, QueryShape> = {};
        for (const property of fields.getProperties()) {
          if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property))
            continue;
          const name = propertyNameText(property.getNameNode());
          if (!name) continue;
          const initializer = Node.isPropertyAssignment(property)
            ? property.getInitializer()
            : property.getNameNode();
          const fieldShape = initializer ? queryShapeFromSchemaExpression(initializer) : undefined;
          if (fieldShape) shape[name] = fieldShape;
        }
        return shape;
      }
    }
  }

  return undefined;
}

/** @internal */ export function columnBuilderShape(
  initializer: Node | undefined,
): QueryShape | undefined {
  // SPEC §10-§11: column nullability is a parsed call-chain fact, not string contents.
  const builder = columnBuilderName(initializer);
  if (!builder) return undefined;

  const baseShape = columnBuilderBaseShape(builder, columnBuilderMode(initializer));
  if (!baseShape) return undefined;
  return columnBuilderIsNonNull(initializer) ? baseShape : nullableShape(baseShape);
}

/** @internal */ export function columnBuilderBaseShape(
  builder: string,
  mode?: string,
): QueryShape | undefined {
  if (builder === 'integer' && mode === 'boolean') return 'boolean';
  if (builder === 'text' && mode === 'json') return 'object';
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

/** @internal */ export function columnBuilderMode(
  initializer: Node | undefined,
): string | undefined {
  if (!initializer) return undefined;
  return columnBuilderModeFromExpression(
    unwrappedTsExpression(initializer.compilerNode as ts.Expression),
  );
}

/** @internal */ export function columnBuilderModeFromExpression(
  expression: ts.Expression,
): string | undefined {
  const rootCall = columnBuilderRootCallExpression(expression);
  if (!rootCall) return undefined;

  for (const argument of rootCall.arguments) {
    const value = staticStringPropertyValue(argument, 'mode');
    if (value) return value;
  }

  return undefined;
}

/** @internal */ export function columnBuilderRootCallExpression(
  expression: ts.Expression,
): ts.CallExpression | undefined {
  const target = unwrappedTsExpression(expression);
  if (!ts.isCallExpression(target)) return undefined;

  const callee = unwrappedTsExpression(target.expression as ts.Expression);
  if (ts.isPropertyAccessExpression(callee)) {
    const base = unwrappedTsExpression(callee.expression);
    if (ts.isCallExpression(base)) return columnBuilderRootCallExpression(base);
  }

  return target;
}

/** @internal */ export function staticStringPropertyValue(
  expression: ts.Expression,
  name: string,
): string | undefined {
  const target = unwrappedTsExpression(expression);
  if (!ts.isObjectLiteralExpression(target)) return undefined;

  for (const property of target.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = property.name;
    const matches =
      (ts.isIdentifier(propertyName) && propertyName.text === name) ||
      (ts.isStringLiteral(propertyName) && propertyName.text === name);
    if (!matches) continue;

    const initializer = unwrappedTsExpression(property.initializer);
    if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
      return initializer.text;
    }
  }

  return undefined;
}

/** @internal */ export function columnBuilderName(
  initializer: Node | undefined,
): string | undefined {
  if (!initializer) return undefined;
  return columnBuilderNameFromExpression(
    unwrappedTsExpression(initializer.compilerNode as ts.Expression),
  );
}

/** @internal */ export function projectColumnBuilderName(
  initializer: Node | undefined,
): string | undefined {
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (!Node.isCallExpression(expression)) return undefined;

  const callee = unwrappedStaticExpressionNode(expression.getExpression());
  if (Node.isIdentifier(callee)) return projectDrizzleCoreIdentifierExportName(callee);
  if (!Node.isPropertyAccessExpression(callee)) return undefined;

  const base = unwrappedStaticExpressionNode(callee.getExpression());
  if (Node.isCallExpression(base)) return projectColumnBuilderName(base);

  // SPEC §10-§11: project-mode namespace column factories require ts-morph import proof instead
  // of accepting arbitrary `schema.text()` source names.
  return isDrizzleCoreNamespaceMember(callee) ? callee.getName() : undefined;
}

/** @internal */ export function columnBuilderNameFromExpression(
  expression: ts.Expression,
): string | undefined {
  const target = unwrappedTsExpression(expression);
  if (!ts.isCallExpression(target)) return undefined;

  const callee = unwrappedTsExpression(target.expression as ts.Expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;

  const base = unwrappedTsExpression(callee.expression);
  return ts.isCallExpression(base) ? columnBuilderNameFromExpression(base) : undefined;
}

/** @internal */ export function columnBuilderIsNonNull(initializer: Node | undefined): boolean {
  if (!initializer) return false;

  for (const method of columnBuilderChainMethods(
    unwrappedTsExpression(initializer.compilerNode as ts.Expression),
  )) {
    if (method === 'notNull' || method === 'primaryKey') return true;
  }

  return false;
}

/** @internal */ export function columnBuilderChainMethods(expression: ts.Expression): string[] {
  const target = unwrappedTsExpression(expression);
  if (!ts.isCallExpression(target)) return [];

  const callee = unwrappedTsExpression(target.expression as ts.Expression);
  if (!ts.isPropertyAccessExpression(callee)) return [];

  const base = unwrappedTsExpression(callee.expression);
  const methods = ts.isCallExpression(base) ? columnBuilderChainMethods(base) : [];
  return [...methods, callee.name.text];
}

/** @internal */ export function columnShapesForFile(
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

  appendRelationColumnShapesForFile(shapes, sourceFile, tableNamesBySymbol, columnShapesByTable);

  return shapes;
}

function appendRelationColumnShapesForFile(
  shapes: Record<string, QueryShape>,
  sourceFile: SourceFile,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  columnShapesByTable: ReadonlyMap<string, Readonly<Record<string, QueryShape>>>,
): void {
  const namespaceTableNames = projectNamespaceTableNamesByLocal(sourceFile, tableNamesBySymbol);
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (relationCallName(call) !== 'relations') continue;

    const relationObject = relationDefinitionObject(call);
    if (!relationObject) continue;

    for (const property of relationObject.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;

      const relation = propertyNameText(property.getNameNode());
      const target = relationTargetTableName(
        property.getInitializer(),
        tableNamesBySymbol,
        namespaceTableNames,
      );
      const tableShapes = target ? columnShapesByTable.get(target) : undefined;
      if (!relation || !tableShapes) continue;

      appendColumnShapesForTablePath(shapes, relation, tableShapes);
    }
  }
}

function relationCallName(call: CallExpression): string | undefined {
  const expression = call.getExpression();
  return Node.isIdentifier(expression) ? expression.getText() : staticAccessName(expression);
}

function relationDefinitionObject(call: CallExpression): ObjectLiteralExpression | undefined {
  const callback = call.getArguments()[1];
  if (!callback || (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback))) {
    return undefined;
  }

  const body = unwrappedStaticExpressionNode(callback.getBody());
  if (Node.isObjectLiteralExpression(body)) return body;
  if (!Node.isBlock(body)) return undefined;

  const returned = body.getStatements().flatMap((statement) => {
    if (!Node.isReturnStatement(statement)) return [];
    const returnExpression = statement.getExpression();
    if (!returnExpression) return [];

    const expression = unwrappedStaticExpressionNode(returnExpression);
    return expression && Node.isObjectLiteralExpression(expression) ? [expression] : [];
  });
  return returned[0];
}

function relationTargetTableName(
  initializer: Node | undefined,
  tableNamesBySymbol: ReadonlyMap<string, string>,
  namespaceTableNames: ProjectNamespaceTableNames,
): string | undefined {
  const call = initializer && Node.isCallExpression(initializer) ? initializer : undefined;
  const target = call?.getArguments()[0];
  return target
    ? projectTableNameForNode(target, tableNamesBySymbol, namespaceTableNames)
    : undefined;
}

/** @internal */ export function projectTableNameForColumnShapeAccess(
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

/** @internal */ export function appendColumnShapesForTablePath(
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

/** @internal */ export function resolvedSymbolKey(
  symbol: MorphSymbol | undefined,
): string | undefined {
  const target = symbol?.getAliasedSymbol() ?? symbol;
  const declaration = target?.getDeclarations()[0];
  if (!declaration) return undefined;

  return `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`;
}

/** @internal */ export function isTableInitializerNode(initializer: Node): boolean {
  if (!Node.isCallExpression(initializer)) return false;
  const expression = initializer.getExpression();
  if (!Node.isIdentifier(expression)) return false;
  if (!isDrizzleTableFactoryName(expression.getText())) return false;

  return true;
}

/** @internal */ export function isProjectTableInitializerNode(initializer: Node): boolean {
  if (!Node.isCallExpression(initializer)) return false;
  const expression = unwrappedStaticExpressionNode(initializer.getExpression());
  const isTableFactory = Node.isIdentifier(expression)
    ? isDrizzleTableFactoryName(projectDrizzleCoreIdentifierExportName(expression) ?? '')
    : Node.isPropertyAccessExpression(expression) &&
      isDrizzleTableFactoryNamespaceMember(expression);
  return isTableFactory;
}

/** @internal */ export function isDrizzleTableFactoryNamespaceMember(access: Node): boolean {
  if (!Node.isPropertyAccessExpression(access)) return false;
  if (!isDrizzleTableFactoryName(access.getName())) return false;
  return isDrizzleCoreNamespaceMember(access);
}

/** @internal */ export function isDrizzleCoreNamespaceMember(access: Node): boolean {
  if (!Node.isPropertyAccessExpression(access)) return false;

  const expression = unwrappedStaticExpressionNode(access.getExpression());
  if (!Node.isIdentifier(expression)) return false;

  const namespaceImport = access
    .getSourceFile()
    .getImportDeclarations()
    .some(
      (declaration) =>
        declaration.getNamespaceImport()?.getText() === expression.getText() &&
        isDrizzleCoreModuleSpecifier(declaration.getModuleSpecifierValue()),
    );
  if (namespaceImport) return true;

  const symbol = expression.getSymbol()?.getAliasedSymbol() ?? expression.getSymbol();
  return (
    symbol?.getDeclarations().some((declaration) => {
      if (declaration.getKind() !== SyntaxKind.NamespaceImport) return false;
      const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
      return isDrizzleCoreModuleSpecifier(importDeclaration?.getModuleSpecifierValue());
    }) ?? false
  );
}

/** @internal */ export function projectDrizzleCoreIdentifierExportName(
  identifier: Node,
): string | undefined {
  if (!Node.isIdentifier(identifier)) return undefined;

  const symbol = identifier.getSymbol();
  const declarations = symbol?.getDeclarations() ?? [];
  if (declarations.length === 0) return identifier.getText();

  const directName = drizzleCoreExportNameFromDeclarations(declarations);
  if (directName) return directName;

  const aliased = symbol?.getAliasedSymbol();
  const aliasName = drizzleCoreExportNameFromDeclarations(aliased?.getDeclarations() ?? []);
  if (aliasName) return aliasName;

  return undefined;
}

/** @internal */ export function drizzleCoreExportNameFromDeclarations(
  declarations: readonly Node[],
): string | undefined {
  for (const declaration of declarations) {
    const name = drizzleCoreImportSpecifierExportName(declaration);
    if (name) return name;
  }
  for (const declaration of declarations) {
    const name = drizzleCoreExportSpecifierExportName(declaration);
    if (name) return name;
  }
  for (const declaration of declarations) {
    if (drizzleCoreModuleSpecifierForDeclaration(declaration)) {
      const name = Node.isIdentifier(declaration)
        ? declaration.getText()
        : declaration.getSymbol()?.getName();
      if (name) return name;
    }
  }

  return undefined;
}

/** @internal */ export function drizzleCoreImportSpecifierExportName(
  declaration: Node,
): string | undefined {
  if (!Node.isImportSpecifier(declaration)) return undefined;
  const importDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
  if (!isDrizzleCoreModuleSpecifier(importDeclaration?.getModuleSpecifierValue())) return undefined;

  return declaration.getNameNode().getText();
}

/** @internal */ export function drizzleCoreExportSpecifierExportName(
  declaration: Node,
): string | undefined {
  if (!Node.isExportSpecifier(declaration)) return undefined;
  const exportDeclaration = declaration.getFirstAncestorByKind(SyntaxKind.ExportDeclaration);
  if (!isDrizzleCoreModuleSpecifier(exportDeclaration?.getModuleSpecifierValue())) return undefined;

  return declaration.getNameNode().getText();
}

/** @internal */ export function drizzleCoreModuleSpecifierForDeclaration(
  declaration: Node,
): string | undefined {
  const filePath = declaration.getSourceFile().getFilePath();
  return [...DRIZZLE_CORE_MODULE_SPECIFIERS].find((specifier) => filePath.includes(specifier));
}

/** @internal */ export function isDrizzleCoreModuleSpecifier(
  specifier: string | undefined,
): boolean {
  return specifier !== undefined && DRIZZLE_CORE_MODULE_SPECIFIERS.has(specifier);
}

/** @internal */ export function isKovoAnnotationCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  return Node.isIdentifier(expression) && isKovoExtraConfigCallName(expression.getText());
}

/** @internal */ export function tableNameArgument(initializer: Node): string | undefined {
  if (!Node.isCallExpression(initializer)) return undefined;
  const name = initializer.getArguments()[0];
  if (!name || !Node.isStringLiteral(name)) return undefined;
  return name.getLiteralText();
}
