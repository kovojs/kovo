import { diagnosticDefinitionText, diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import {
  Node,
  SyntaxKind,
  ts,
  type BindingElement,
  type CallExpression,
  type FunctionExpression,
  type ObjectLiteralExpression,
  type ParameterDeclaration,
  type SourceFile,
  type Symbol as MorphSymbol,
  type VariableDeclaration,
} from 'ts-morph';
import {
  appendSourceDestructuredReceiverBinding,
  boundReceiverMethodAccessName,
  directDrizzleReceiverCallSurface,
  externalHelperCallSurface,
  extractReceiverMethodAliasCallsFromBody,
  extractSourceReceiverSurfaceCallsFromBody,
  isProjectDrizzleReceiverContainerExpression,
  isSourceDestructuredReceiverIdentifier,
  localFunctionCallSatisfiesReceiverRequirements,
  localFunctionKeyForReference,
  queryReceiverCarrierSymbolKeys,
  queryReceiverReferenceInArgument,
  sourceReceiverAliasReferencesForBody,
  symbolForIdentifierReference,
  type SourceReceiverAliasReferences,
} from './receiver-surface.js';
import {
  type QueryReceiverReferences,
  type QueryShapeReveal,
  type QueryShape,
  type QueryShapeWrapper,
  type ReceiverParameterRequirement,
  type TouchGraphDiagnostic,
  DRIZZLE_SELECT_QUERY_METHODS,
  IGNORED_LOCAL_CALL_NAMES,
  appendProjectDrizzleReceiverBindingsFromBody,
  appendProjectDrizzleReceiverParameterBinding,
  bodySourceStart,
  callSourceOrder,
  computedPropertyNameExpression,
  functionBody,
  isJoinReadCallName,
  isRestBindingElement,
  isQueryCallOnReceiver,
  isProjectDrizzleReceiverContainerCallReceiver,
  isProjectDrizzleReceiverMemberExpression,
  propertyAccessCallName,
  propertyNameText,
  queryBodyCallExpressions,
  queryReceiverMode,
  queryRelationalTableExpressions,
  resolvedSymbolKey,
  singleReturnExpression,
  staticAccessExpression,
  staticAccessName,
  staticExpressionPath,
  touchBodyCallExpressions,
  typeHasOpaqueStringMembers,
  unwrappedStaticExpressionNode,
  unwrappedTsExpression,
  DRIZZLE_STATIC_PROJECT_ROOT,
} from '../static.js';

/** @internal */ export interface QueryShapeSelection {
  diagnostics?: readonly TouchGraphDiagnostic[];
  hasTablelessScalar: boolean;
  opaquePaths: readonly string[];
  shape: QueryShape;
  scalarTables: ReadonlySet<string>;
  unresolvedPaths: readonly string[];
}

/** @internal */ export function selectShapeFromQueryBody(
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

  const selection = queryShapeFromObjectLiteralNode(projection.compilerNode, {
    columnShapes,
    nullableTables: nullableJoinTables(body, receiverReferences, mode),
  });
  return queryBodyHasTimeVolatileWhere(body, receiverReferences, mode)
    ? { ...selection, shape: volatileTimeShape(selection.shape) }
    : selection;
}

/** @internal */ export function relationalShapeFromQueryBody(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
  relationTargetTableName: (relation: string) => string | undefined = () => undefined,
): QueryShapeSelection | null {
  const call = relationalQueryCallFromQueryBody(body, receiverReferences);
  if (!call) return null;

  const table = relationalQueryTableName(call);
  const projection = relationalQueryProjection(call);
  if (!table || !projection || !relationalProjectionIsFullyStatic(projection)) return null;

  const shape: Record<string, QueryShape> = {};
  const unresolvedPaths: string[] = [];
  const opaquePaths: string[] = [];
  appendRelationalProjectionShape(
    shape,
    unresolvedPaths,
    opaquePaths,
    table,
    projection,
    columnShapes,
    relationTargetTableName,
  );

  return {
    hasTablelessScalar: false,
    opaquePaths,
    shape,
    scalarTables: new Set([table]),
    unresolvedPaths,
  };
}

interface RelationalProjection {
  columns: readonly string[];
  // SPEC §10.2/§11.3 (bugz-3 M4): the RQB `extras` keys (computed/raw-SQL fields that ARE returned
  // on the wire). They carry no resolvable Drizzle column, so they are treated as opaque projection
  // paths — see {@link appendRelationalProjectionShape}.
  extras: readonly string[];
  relations: Readonly<Record<string, RelationalProjection | null>>;
}

function appendRelationalProjectionShape(
  shape: Record<string, QueryShape>,
  unresolvedPaths: string[],
  opaquePaths: string[],
  table: string,
  projection: RelationalProjection,
  columnShapes: Readonly<Record<string, QueryShape>>,
  relationTargetTableName: (relation: string) => string | undefined,
): void {
  for (const column of projection.columns) {
    const columnShape = columnShapes[`${table}.${column}`];
    if (columnShape) {
      shape[column] = columnShape;
    } else {
      unresolvedPaths.push(column);
    }
  }

  // SPEC §10.2/§11.3 (bugz-3 M4): every `extras` field is a raw-SQL projection — invisible to the
  // column walk and capable of returning a secret/whole-row value. Over-approximate each to an opaque
  // projection path so the KV435 secret backstop fires when the read table is secret (and KV410 fires
  // otherwise, unless the author takes the audited output+reads escape), mirroring db.select({...sql}).
  for (const extra of projection.extras) opaquePaths.push(extra);

  for (const [relation, relationProjection] of Object.entries(projection.relations)) {
    if (!relationProjection) continue;

    const relationShape: Record<string, QueryShape> = {};
    const relationUnresolvedPaths: string[] = [];
    const relationOpaquePaths: string[] = [];
    const relationTable = relationTargetTableName(relation) ?? relation;
    appendRelationalProjectionShape(
      relationShape,
      relationUnresolvedPaths,
      relationOpaquePaths,
      relationTable,
      relationProjection,
      columnShapes,
      relationTargetTableName,
    );
    shape[relation] = relationShape;
    unresolvedPaths.push(...relationUnresolvedPaths.map((path) => `${relation}.${path}`));
    opaquePaths.push(...relationOpaquePaths.map((path) => `${relation}.${path}`));
  }
}

/** @internal */ export function queryBodyHasTimeVolatileWhere(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
  mode: 'project' | 'source',
): boolean {
  return queryBodyCallExpressions(body, mode, (call) => {
    if (propertyAccessCallName(call) !== 'where') return [];
    if (!isQueryCallOnReceiver(call, receiverReferences)) return [];

    const predicate = call.getArguments()[0];
    return predicate && isTimeVolatileExpression(predicate) ? [true] : [];
  }).some(Boolean);
}

/** @internal */ export function volatileTimeShape(shape: QueryShape): QueryShape {
  if (
    typeof shape === 'object' &&
    shape !== null &&
    !Array.isArray(shape) &&
    'kind' in shape &&
    shape.kind === 'volatile-time'
  ) {
    return shape;
  }
  return { kind: 'volatile-time', shape };
}

/** @internal */ export function selectProjectionArgument(call: CallExpression): Node | undefined {
  const args = call.getArguments();
  return staticAccessName(call.getExpression()) === 'selectDistinctOn' ? args[1] : args[0];
}

/** @internal */ export function selectCallDisplayName(call: CallExpression): string {
  return `db.${staticAccessName(call.getExpression()) ?? 'select'}()`;
}

/** @internal */ export function selectCallFromQueryBody(
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

/** @internal */ export function isSelectQueryCallName(name: string | undefined): boolean {
  return name !== undefined && DRIZZLE_SELECT_QUERY_METHODS.has(name);
}

/** @internal */ export function queryCallbackReceiverReferences(
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

/** @internal */ export function appendQueryReceiverParameterReferences(
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

/** @internal */ export function queryCallbackParameterNodes(
  callback: Node,
): ParameterDeclaration[] {
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

/** @internal */ export function appendQueryTransactionReceiverAliases(
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

/** @internal */ export function isQueryReceiverIdentifier(
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

/** @internal */ export function relationalQueryDiagnostics(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): TouchGraphDiagnostic[] {
  if (relationalQueryCallsWithoutStaticProjection(body, receiverReferences).length === 0) {
    return [];
  }

  return [
    {
      code: 'KV406',
      message: `${diagnosticDefinitions.KV406.message} Query uses Drizzle relational query API without static projection.`,
      severity: diagnosticDefinitions.KV406.severity,
      site: '',
    },
  ];
}

function relationalQueryCallFromQueryBody(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): CallExpression | undefined {
  const calls = relationalQueryCalls(body, receiverReferences);
  return calls.find((call) => call.getFirstAncestorByKind(SyntaxKind.ReturnStatement)) ?? calls[0];
}

function relationalQueryCallsWithoutStaticProjection(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): CallExpression[] {
  return relationalQueryCalls(body, receiverReferences).filter((call) => {
    const projection = relationalQueryProjection(call);
    return !projection || !relationalProjectionIsFullyStatic(projection);
  });
}

function relationalQueryCalls(
  body: ObjectLiteralExpression,
  receiverReferences: QueryReceiverReferences,
): CallExpression[] {
  return queryBodyCallExpressions(body, queryReceiverMode(receiverReferences), (call) => {
    const expression = call.getExpression();
    const method = staticAccessName(expression);
    if (method !== 'findMany' && method !== 'findFirst') return [];

    const tableAccess = staticAccessExpression(expression);
    const queryAccess = tableAccess ? staticAccessExpression(tableAccess) : undefined;
    if (!queryAccess || staticAccessName(queryAccess) !== 'query') return [];
    if (!isQueryReceiverIdentifier(staticAccessExpression(queryAccess), receiverReferences)) {
      return [];
    }

    return [call];
  });
}

function relationalQueryTableName(call: CallExpression): string | undefined {
  const tableAccess = staticAccessExpression(call.getExpression());
  return tableAccess ? staticAccessName(tableAccess) : undefined;
}

function relationalQueryProjection(call: CallExpression): RelationalProjection | null {
  const config = call.getArguments()[0];
  if (!config || !Node.isObjectLiteralExpression(config)) return null;

  const columns = relationalQueryColumns(config);
  const relations = relationalQueryRelations(config);
  const extras = relationalQueryExtras(config);
  if (columns.length === 0 && Object.keys(relations).length === 0 && extras.length === 0)
    return null;

  return { columns, extras, relations };
}

/**
 * SPEC §10.2/§11.3 (bugz-3 M4): enumerate the `extras` field names of a `db.query.<t>.findMany({...})`
 * projection. `extras` is `{ name: sql`...`.as('name') }` or a `(fields, ops) => ({ ... })` callback;
 * each field is a returned raw-SQL value. We never resolve the SQL — every field is over-approximated
 * to an opaque projection path (KV435/KV410), so a secret column raw-projected via `extras` cannot
 * escape the confidentiality backstops. When `extras` is present but its fields cannot be statically
 * enumerated, fail closed with a single synthetic `extras` path.
 */
function relationalQueryExtras(config: ObjectLiteralExpression): string[] {
  const extrasProperty = config.getProperty('extras');
  if (!extrasProperty) return [];
  if (!Node.isPropertyAssignment(extrasProperty)) return ['extras'];

  const object = relationalExtrasObjectLiteral(extrasProperty.getInitializer());
  if (!object) return ['extras'];

  const names = object
    .getProperties()
    .map((property) =>
      Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)
        ? (propertyNameText(property.getNameNode()) ?? 'extras')
        : 'extras',
    );
  return names.length > 0 ? names : ['extras'];
}

function relationalExtrasObjectLiteral(
  initializer: Node | undefined,
): ObjectLiteralExpression | undefined {
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isObjectLiteralExpression(expression)) return expression;

  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) {
    const body = unwrappedStaticExpressionNode(expression.getBody());
    if (Node.isObjectLiteralExpression(body)) return body;
    if (Node.isBlock(body)) {
      const statements = body.getStatements();
      const statement = statements.length === 1 ? statements[0] : undefined;
      if (statement && Node.isReturnStatement(statement)) {
        const returned = statement.getExpression();
        const returnedExpression = returned ? unwrappedStaticExpressionNode(returned) : undefined;
        if (returnedExpression && Node.isObjectLiteralExpression(returnedExpression)) {
          return returnedExpression;
        }
      }
    }
  }

  return undefined;
}

function relationalQueryColumns(config: ObjectLiteralExpression): string[] {
  const columnsProperty = config.getProperty('columns');
  if (!columnsProperty || !Node.isPropertyAssignment(columnsProperty)) return [];

  const columns = columnsProperty.getInitializer();
  if (!columns || !Node.isObjectLiteralExpression(columns)) return [];

  return columns.getProperties().flatMap((property) => {
    if (!Node.isPropertyAssignment(property)) return [];
    const value = property.getInitializer();
    if (!value || value.getKind() !== SyntaxKind.TrueKeyword) return [];
    return propertyNameText(property.getNameNode()) ?? [];
  });
}

function relationalQueryRelations(
  config: ObjectLiteralExpression,
): Record<string, RelationalProjection | null> {
  const withProperty = config.getProperty('with');
  if (!withProperty || !Node.isPropertyAssignment(withProperty)) return {};

  const withObject = withProperty.getInitializer();
  if (!withObject || !Node.isObjectLiteralExpression(withObject)) return {};

  const relations: Record<string, RelationalProjection | null> = {};
  for (const property of withObject.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;

    const relation = propertyNameText(property.getNameNode());
    if (!relation) continue;

    const initializer = property.getInitializer();
    relations[relation] =
      initializer && Node.isObjectLiteralExpression(initializer)
        ? {
            columns: relationalQueryColumns(initializer),
            extras: relationalQueryExtras(initializer),
            relations: relationalQueryRelations(initializer),
          }
        : null;
  }

  return relations;
}

function relationalProjectionIsFullyStatic(projection: RelationalProjection): boolean {
  if (projection.columns.length === 0) return false;

  return Object.values(projection.relations).every(
    (relation) => relation !== null && relationalProjectionIsFullyStatic(relation),
  );
}

/** @internal */ export function unclassifiedQueryReceiverDiagnostics(
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

/** @internal */ export function projectQueryReceiverContainerDiagnostics(
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

/** @internal */ export function externalQueryHelperDiagnostics(
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

/** @internal */ export function queryLocalHelperCalls(
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

/** @internal */ export function opaqueLocalQueryHelperDiagnostics(
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

/** @internal */ export function receiverMethodAliasQueryDiagnostics(
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
/** @internal */ export function sourceDestructuredQueryReceiverDiagnostics(
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

/** @internal */ export function queryExecutableCallExpressions(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source' = 'source',
): CallExpression[] {
  return queryCallbackBodies(body, mode)
    .flatMap((callbackBody) => touchBodyCallExpressions(callbackBody))
    .sort((left, right) => callSourceOrder(left) - callSourceOrder(right));
}

/** @internal */ export function queryCallbackBodies(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source' = 'source',
): Node[] {
  return queryLoadCallbackFunctions(body, mode).map(functionBody);
}

/** @internal */ export function queryLoadCallbackFunctions(
  body: ObjectLiteralExpression,
  mode: 'project' | 'source' = 'source',
): Node[] {
  return queryLoadCallbackResolution(body, mode).callbacks;
}

/** @internal */ export interface QueryLoadCallbackResolution {
  callbacks: Node[];
  unresolvedNodes: Node[];
}

/** @internal */ export interface QueryBodyObjectResolution {
  body?: ObjectLiteralExpression;
  unresolved: boolean;
}

/** @internal */ export function queryBodyObjectLiteral(
  argument: Node | undefined,
  mode: 'project' | 'source',
): QueryBodyObjectResolution {
  if (!argument) return { unresolved: true };
  return queryBodyObjectLiteralFromNode(argument, new Set(), mode) ?? { unresolved: true };
}

/** @internal */ export function queryBodyObjectLiteralFromNode(
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

/** @internal */ export function queryBodyObjectLiteralFromDeclaration(
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

/** @internal */ export type QueryLoadSpreadResolution =
  | { kind: 'found'; callbacks: Node[]; unresolved: boolean }
  | { kind: 'none' }
  | { kind: 'unresolved' };

/** @internal */ export function queryLoadCallbackResolution(
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

/** @internal */ export function queryLoadCallbackFromSpread(
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

/** @internal */ export function queryLoadCallbackFromSpreadExpression(
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

/** @internal */ export function queryCallbackPropertyIsLoad(node: Node): boolean {
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

/** @internal */ export function queryCallbackPropertyMayHideLoad(
  node: Node,
  mode: 'project' | 'source',
): boolean {
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

/** @internal */ export function queryCallbackPropertyResolution(
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

/** @internal */ export function queryCallbackExpressionResolution(
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

/** @internal */ export function unresolvedQueryCallbackDiagnostics(
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

/** @internal */ export function unresolvedQueryLoadCallbackDiagnostic(): TouchGraphDiagnostic {
  return {
    code: 'KV406',
    message: `${diagnosticDefinitions.KV406.message} Query load callback could not be statically resolved.`,
    severity: diagnosticDefinitions.KV406.severity,
    site: '',
  };
}

/** @internal */ export function referencedQueryCallbackFunction(
  identifier: Node,
): Node | undefined {
  return callbackFunctionFromReference(identifier, new Set());
}

/** @internal */ export function callbackFunctionFromDeclaration(
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

/** @internal */ export function callbackFunctionFromVariable(
  declaration: ReturnType<SourceFile['getVariableDeclarations']>[number],
  seen: Set<string>,
): Node | undefined {
  const initializer = declaration.getInitializer();
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return expression;
  return callbackFunctionFromReference(expression, seen);
}

/** @internal */ export function callbackFunctionFromPropertyDeclaration(
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

/** @internal */ export function callbackFunctionFromGetAccessorDeclaration(
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

/** @internal */ export function callbackFunctionFromBindingElement(
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

/** @internal */ export function staticBindingElementReference(
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

/** @internal */ export function bindingElementStaticPath(declaration: BindingElement): string[] {
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

/** @internal */ export function callbackReferenceFromStaticLiteralPath(
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

/** @internal */ export function staticLiteralContainerExpression(
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

/** @internal */ export function staticLiteralReferenceFromExpression(
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

/** @internal */ export function staticAccessSegments(
  node: Node,
): { path: string[]; root: Node } | undefined {
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

/** @internal */ export function staticLiteralContainerInitializer(
  declaration: Node,
): Node | undefined {
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

/** @internal */ export function staticObjectFactoryReturnExpression(
  node: Node,
  seen: Set<string>,
): Node | undefined {
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

/** @internal */ export function factoryHasNoParameters(callback: Node): boolean {
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

/** @internal */ export function functionLikeStaticReturnExpression(
  callback: Node,
): Node | undefined {
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

/** @internal */ export function staticFactoryBlockReturnExpression(body: Node): Node | undefined {
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

/** @internal */ export function objectLiteralStaticPropertyReference(
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

/** @internal */ export function symbolForStaticTypePath(
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

/** @internal */ export function callbackFunctionFromProperty(
  declaration: Node,
  seen: Set<string>,
): Node | undefined {
  if (!Node.isPropertyAssignment(declaration)) return undefined;

  const initializer = declaration.getInitializer();
  if (!initializer) return undefined;

  const expression = unwrappedStaticExpressionNode(initializer);
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return expression;
  return callbackFunctionFromReference(expression, seen);
}

/** @internal */ export function callbackFunctionFromReference(
  identifier: Node,
  seen: Set<string>,
): Node | undefined {
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

/** @internal */ export function symbolForCallbackReference(node: Node): MorphSymbol | undefined {
  if (Node.isIdentifier(node)) return aliasedSymbol(symbolForIdentifierReference(node));
  if (Node.isPropertyAccessExpression(node)) {
    return aliasedSymbol(symbolForStaticMemberReference(node) ?? node.getNameNode().getSymbol());
  }
  if (Node.isElementAccessExpression(node)) {
    return aliasedSymbol(symbolForStaticMemberReference(node) ?? node.getSymbol());
  }
  return undefined;
}

/** @internal */ export function boundCallbackTarget(node: Node): Node | undefined {
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

/** @internal */ export function symbolForStaticMemberReference(
  node: Node,
): MorphSymbol | undefined {
  // SPEC §10.2/§11.1: static callback containers are resolved from ts-morph member facts before
  // local object compatibility walking, so namespace imports and re-export barrels remain exact.
  const member = staticAccessName(node);
  const receiver = staticAccessExpression(node);
  if (!member || !receiver) return undefined;

  return receiver.getType().getProperty(member);
}

/** @internal */ export function aliasedSymbol(
  symbol: MorphSymbol | undefined,
): MorphSymbol | undefined {
  return symbol?.getAliasedSymbol() ?? symbol;
}

/** @internal */ export function queryHelperReceiverArgumentName(
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

/** @internal */ export function queryHelperArgumentReceiverName(
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

/** @internal */ export function queryReceiverAliasReferencesForCall(
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

/** @internal */ export function queryCallbackBodyForNode(
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

/** @internal */ export function appendUntypedQueryReceiverBinding(
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
/** @internal */ export function sourceQueryDestructuredReceiverNames(
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
/** @internal */ export function unprovenDestructuredReceiverReferences(
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

/** @internal */ export function appendQueryReceiverIdentifierBinding(
  name: Node,
  names: Set<string>,
  symbolKeys: Set<string>,
): void {
  if (!Node.isIdentifier(name)) return;
  names.add(name.getText());
  const symbolKey = resolvedSymbolKey(name.getSymbol());
  if (symbolKey) symbolKeys.add(symbolKey);
}

/** @internal */ export interface QueryShapeContext {
  columnShapes: Readonly<Record<string, QueryShape>>;
  nullableTables: ReadonlySet<string>;
  prefix?: string;
}

/** @internal */ export function queryShapeFromObjectLiteralNode(
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
    if (ts.isSpreadAssignment(property)) {
      // SPEC §11.1 / §11.3 KV435: spread projections are not inspectable enough to
      // prove they exclude secret columns, so keep them visible to the confidentiality backstop.
      const expression = unwrappedTsExpression(property.expression);
      const spread = `spread:${expression.getText(object.getSourceFile())}`;
      unresolvedPaths.push(prefix ? `${prefix}.${spread}` : spread);
      continue;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      // SPEC §10-§11: unsupported projection syntax stays visible instead of disappearing.
      const shorthand = property.name.text;
      unresolvedPaths.push(prefix ? `${prefix}.${shorthand}` : shorthand);
      continue;
    }

    if (!ts.isPropertyAssignment(property)) continue;

    const key = projectionPropertyName(property.name);
    if (!key) {
      // SPEC §11.1 / §11.3 KV435: a dynamic projection key can rename or hide a
      // secret-bearing expression; preserve it as an unresolved projection fact.
      const computed = `computed:${property.name.getText(object.getSourceFile())}`;
      unresolvedPaths.push(prefix ? `${prefix}.${computed}` : computed);
      continue;
    }

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

/** @internal */ export function projectionPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** @internal */ export function nullableNestedShape(
  nested: QueryShapeSelection,
  nullableTables: ReadonlySet<string>,
): QueryShape | undefined {
  if (nested.hasTablelessScalar) return undefined;
  if (nested.scalarTables.size !== 1) return undefined;

  const [table] = nested.scalarTables;
  return table && nullableTables.has(table) ? nullableShape(nested.shape) : undefined;
}

/** @internal */ export function scalarQueryShape(
  expression: ts.Expression,
  columnShapes: Readonly<Record<string, QueryShape>> = {},
  nullableTables: ReadonlySet<string> = new Set(),
): QueryShape | null {
  const revealShape = trustedRevealQueryShape(expression, columnShapes, nullableTables);
  if (revealShape) return revealShape;
  const sqlShape = typedSqlProjectionShape(expression);
  if (sqlShape) return sqlShape;
  const columnPath = staticTsExpressionPath(expression);
  const columnShape = columnPath ? columnShapes[columnPath] : undefined;
  if (columnShape) {
    return nullableTables.has(tableExpressionBase(expression))
      ? nullableShape(columnShape)
      : columnShape;
  }
  const tableRow = tableRowQueryShape(expression, columnShapes);
  if (tableRow) return nullableTables.has(tableRow.table) ? nullableShape(tableRow) : tableRow;
  return null;
}

function tableRowQueryShape(
  expression: ts.Expression,
  columnShapes: Readonly<Record<string, QueryShape>>,
): Extract<QueryShapeWrapper, { kind: 'table-row' }> | null {
  const table = staticTsExpressionPath(expression);
  if (!table) return null;

  const prefix = `${table}.`;
  const shape = Object.fromEntries(
    Object.entries(columnShapes)
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('.'))
      .map(([path, columnShape]) => [path.slice(prefix.length), columnShape]),
  );
  return Object.keys(shape).length > 0 ? { kind: 'table-row', shape, table } : null;
}

function trustedRevealQueryShape(
  expression: ts.Expression,
  columnShapes: Readonly<Record<string, QueryShape>>,
  nullableTables: ReadonlySet<string>,
): QueryShape | null {
  const node = unwrappedTsExpression(expression);
  if (!ts.isCallExpression(node) || !isTrustedRevealCall(node)) return null;

  const value = node.arguments[0];
  if (!value) return null;

  const inner = scalarQueryShape(unwrappedTsExpression(value), columnShapes, nullableTables);
  if (!inner) return null;

  const reveal = trustedRevealMetadata(node, value, inner);
  return reveal ? revealedShape(inner, reveal) : inner;
}

function isTrustedRevealCall(call: ts.CallExpression): boolean {
  const imports = trustedRevealImports(call.getSourceFile());
  const callee = unwrappedTsExpression(call.expression);

  if (ts.isIdentifier(callee)) return imports.named.has(callee.text);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'trustedReveal') return false;

  const receiver = unwrappedTsExpression(callee.expression);
  return ts.isIdentifier(receiver) && imports.namespaces.has(receiver.text);
}

function trustedRevealImports(sourceFile: ts.SourceFile): {
  named: ReadonlySet<string>;
  namespaces: ReadonlySet<string>;
} {
  const named = new Set<string>();
  const namespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier) || moduleSpecifier.text !== '@kovojs/core') continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }

    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === 'trustedReveal') named.add(specifier.name.text);
    }
  }

  return { named, namespaces };
}

function trustedRevealMetadata(
  call: ts.CallExpression,
  value: ts.Expression,
  shape: QueryShape,
): QueryShapeReveal | undefined {
  const options = call.arguments[1];
  const object = options ? unwrappedTsExpression(options) : undefined;
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;

  const justification = staticStringProperty(object, 'justification')?.trim();
  if (!justification) return undefined;

  const requestedMethod = staticStringProperty(object, 'method');
  const method = requestedMethod === 'server-projection' ? 'server-projection' : 'arbitrary-fn';
  const selectedSecret = queryShapeContainsSecret(shape);
  const opaque = isOpaqueProjection(value);
  const source = staticStringProperty(object, 'source') ?? staticTsExpressionPath(value);

  return {
    grade: method === 'server-projection' && !selectedSecret && !opaque ? 'proof' : 'audit',
    justification,
    method,
    selectedSecret,
    site: sourcePosition(call),
    ...(source === undefined ? {} : { source }),
  };
}

function staticStringProperty(object: ts.ObjectLiteralExpression, key: string): string | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (projectionPropertyName(property.name) !== key) continue;

    const value = unwrappedTsExpression(property.initializer);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  }
  return undefined;
}

function revealedShape(shape: QueryShape, reveal: QueryShapeReveal): QueryShape {
  if (isQueryShapeWrapper(shape) && shape.kind === 'revealed') return shape;
  return { kind: 'revealed', reveal, shape };
}

function queryShapeContainsSecret(shape: QueryShape): boolean {
  if (typeof shape !== 'object' || shape === null) return false;
  if (Array.isArray(shape)) return shape.some(queryShapeContainsSecret);
  if (isQueryShapeWrapper(shape)) {
    if (shape.kind === 'secret') return true;
    return queryShapeContainsSecret(shape.shape);
  }
  return Object.values(shape).some(queryShapeContainsSecret);
}

function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  return (
    typeof shape === 'object' &&
    shape !== null &&
    !Array.isArray(shape) &&
    'kind' in shape &&
    'shape' in shape &&
    (shape.kind === 'nullable' ||
      shape.kind === 'optional' ||
      shape.kind === 'secret' ||
      shape.kind === 'table-row' ||
      shape.kind === 'volatile-time' ||
      (shape.kind === 'revealed' && 'reveal' in shape))
  );
}

/** @internal */ export function nullableShape(shape: QueryShape): QueryShape {
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

/** @internal */ export function nullableJoinTables(
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

/** @internal */ export function tableExpressionBase(expression: ts.Expression): string {
  const columnPath = staticTsExpressionPath(expression);
  if (!columnPath) return '';

  const columnStart = columnPath.lastIndexOf('.');
  return columnStart > 0 ? columnPath.slice(0, columnStart) : '';
}

/** @internal */ export function scalarProjectionTable(
  expression: ts.Expression,
): string | undefined {
  const revealValue = trustedRevealValueExpression(expression);
  if (revealValue) return scalarProjectionTable(revealValue);
  const table = tableExpressionBase(expression);
  return table || undefined;
}

function trustedRevealValueExpression(expression: ts.Expression): ts.Expression | undefined {
  const node = unwrappedTsExpression(expression);
  if (!ts.isCallExpression(node) || !isTrustedRevealCall(node)) return undefined;
  return node.arguments[0];
}

/** @internal */ export function isOpaqueProjection(expression: ts.Expression): boolean {
  const revealValue = trustedRevealValueExpression(expression);
  if (revealValue) return isOpaqueProjection(revealValue);
  const node = unwrappedTsExpression(expression);
  if (ts.isTaggedTemplateExpression(node)) return staticTsExpressionPath(node.tag) === 'sql';
  if (!ts.isCallExpression(node)) return false;

  const callee = staticTsExpressionPath(node.expression);
  return (
    callee === 'sql' ||
    callee === 'raw' ||
    callee?.startsWith('sql.') === true ||
    isDrizzleAggregateHelperProjection(node)
  );
}

function isDrizzleAggregateHelperProjection(call: ts.CallExpression): boolean {
  const imports = drizzleAggregateImports(call.getSourceFile());
  const callee = unwrappedTsExpression(call.expression);

  if (ts.isIdentifier(callee)) return imports.named.has(callee.text);
  if (!ts.isPropertyAccessExpression(callee) || !isAggregateHelperName(callee.name.text)) {
    return false;
  }

  const receiver = unwrappedTsExpression(callee.expression);
  return ts.isIdentifier(receiver) && imports.namespaces.has(receiver.text);
}

function drizzleAggregateImports(sourceFile: ts.SourceFile): {
  named: ReadonlySet<string>;
  namespaces: ReadonlySet<string>;
} {
  const named = new Set<string>();
  const namespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier) || moduleSpecifier.text !== 'drizzle-orm') continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }

    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (isAggregateHelperName(imported)) named.add(specifier.name.text);
    }
  }

  return { named, namespaces };
}

function isAggregateHelperName(name: string): boolean {
  return name === 'avg' || name === 'count' || name === 'sum';
}

/** @internal */ export function typedSqlProjectionShape(
  expression: ts.Expression,
): QueryShape | null {
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
  const shape =
    typeText === 'number'
      ? 'number'
      : typeText === 'boolean'
        ? 'boolean'
        : typeText === 'string'
          ? 'string'
          : null;
  if (!shape) return null;
  if (isTimeVolatileSqlProjection(expression)) return { kind: 'volatile-time', shape };
  return shape;
}

function sourcePosition(node: ts.Node): string {
  const sourceFile = node.getSourceFile();
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const prefix = `${DRIZZLE_STATIC_PROJECT_ROOT}/`;
  const fileName = sourceFile.fileName.startsWith(prefix)
    ? sourceFile.fileName.slice(prefix.length)
    : sourceFile.fileName;
  return `${fileName}:${position.line + 1}`;
}

/** @internal */ export function isTimeVolatileSqlProjection(expression: ts.Expression): boolean {
  return isTimeVolatileSource(unwrappedTsExpression(expression).getText());
}

/** @internal */ export function isTimeVolatileExpression(expression: Node): boolean {
  return isTimeVolatileSource(unwrappedStaticExpressionNode(expression).getText());
}

/** @internal */ export function isTimeVolatileSource(sourceText: string): boolean {
  const source = sourceText.toLowerCase();
  return (
    /\bnow\s*\(/.test(source) ||
    /\bclock_timestamp\s*\(/.test(source) ||
    /\bcurrent_timestamp\b/.test(source)
  );
}

/** @internal */ export function staticTsExpressionPath(
  expression: ts.Expression,
): string | undefined {
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

/** @internal */ export function staticTsElementAccessName(
  expression: ts.Expression | undefined,
): string | undefined {
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

/** @internal */ export function opaqueProjectionDiagnostics(
  query: string,
  opaquePaths: readonly string[],
  line: string,
  hasOutput: boolean,
  hasDeclaredReads: boolean,
): TouchGraphDiagnostic[] {
  // SPEC §10.2: an opaque `sql<T>`/raw query projection MUST declare BOTH an `output` schema AND a
  // `reads:` table set — "a KV410 projection with no `reads:` declaration is itself a KV410 error".
  // The secret/exempt table referenced by a raw projection can live only in raw SQL text (invisible
  // to static table extraction, hard-rule #9), so the author-declared `reads:` set is the only thing
  // that lets the confidentiality/freshness backstops see it. Suppress KV410 only when both are present.
  if (hasOutput && hasDeclaredReads) return [];

  const definition = diagnosticDefinitions.KV410;
  const message = diagnosticDefinitionText('KV410', { preferHelp: true });
  const reason = hasOutput
    ? 'without a reads: table set (an opaque projection must declare the tables it reads)'
    : 'without output';
  return opaquePaths.map((path) => ({
    code: 'KV410',
    message: `${message} ${query}.${path} uses sql/raw projection ${reason}.`,
    severity: definition.severity,
    site: line,
  }));
}

/** @internal */ export function unresolvedProjectionDiagnostics(
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
