import type * as TypeScript from 'typescript';

import {
  freezeSecurityValue,
  securityGetOwnPropertyDescriptor,
  securityHasOwn,
  securityIsArray,
  securityMap,
  securityMapGet,
  securityMapSet,
  securityNullRecord,
  securityObjectIs,
  securityObjectKeys,
  securitySet,
  securitySetAdd,
  securitySetHas,
} from '#security-witness-intrinsics';

import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  registerFrameworkIdentityProject,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';

type TypeScriptModule = typeof import('typescript');

/** @internal Compiler-compatible query shape used for KV302/KV435 validation. */
export type QueryShape =
  | 'array'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string'
  | readonly QueryShape[]
  | {
      readonly [key: string]: QueryShape;
    }
  | {
      kind: 'nullable' | 'optional' | 'secret' | 'volatile-time';
      shape: QueryShape;
    }
  | {
      kind: 'table-row';
      shape: QueryShape;
      table: string;
    }
  | {
      kind: 'revealed';
      reveal: unknown;
      shape: QueryShape;
    };

/** @internal Compiler-compatible query-shape fact. */
export interface QueryShapeFact {
  query: string;
  shape: QueryShape;
  source: string;
}

/** @internal Shared source input for identity-aware query-shape extraction. */
export interface QueryShapeSourceFile {
  fileName: string;
  source: string;
}

const QUERY_IDENTITY = frameworkExport('@kovojs/server', 'query');
const SCHEMA_IDENTITY = frameworkExport('@kovojs/server', 's');

/** @internal Extract declared non-Drizzle query output schemas from one source file. */
export function outputSchemaQueryShapeFactsFromSource(
  ts: TypeScriptModule,
  fileName: string,
  source: string,
): readonly QueryShapeFact[] {
  return outputSchemaQueryShapeFactsFromProject(ts, [{ fileName, source }]);
}

/** @internal Extract declared non-Drizzle query output schemas with project identity resolution. */
export function outputSchemaQueryShapeFactsFromProject(
  ts: TypeScriptModule,
  files: readonly QueryShapeSourceFile[],
  scanFiles: readonly QueryShapeSourceFile[] = files,
): readonly QueryShapeFact[] {
  const fileInputs = snapshotQueryShapeArray(files, 'query-shape project files');
  const scanInputs =
    scanFiles === files ? fileInputs : snapshotQueryShapeArray(scanFiles, 'query-shape scan files');
  const sourceFiles: TypeScript.SourceFile[] = [];
  for (let index = 0; index < fileInputs.length; index += 1) {
    const file = snapshotQueryShapeSourceFile(
      fileInputs[index]!,
      `query-shape project file[${index}]`,
    );
    sourceFiles[sourceFiles.length] = ts.createSourceFile(
      file.fileName,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  }
  for (let index = 0; index < sourceFiles.length; index += 1) {
    registerFrameworkIdentityProject(sourceFiles[index]!, sourceFiles);
  }

  const scanFileNames = securitySet<string>();
  for (let index = 0; index < scanInputs.length; index += 1) {
    const file = snapshotQueryShapeSourceFile(
      scanInputs[index]!,
      `query-shape scan file[${index}]`,
    );
    securitySetAdd(scanFileNames, file.fileName);
  }
  const facts: QueryShapeFact[] = [];
  for (let index = 0; index < sourceFiles.length; index += 1) {
    const sourceFile = sourceFiles[index]!;
    if (!securitySetHas(scanFileNames, sourceFile.fileName)) continue;
    appendQueryShapeFacts(
      facts,
      outputSchemaQueryShapeFactsFromSourceFile(ts, sourceFile),
      `query-shape facts for ${sourceFile.fileName}`,
    );
  }
  return facts;
}

/** @internal Merge projected query-shape facts from multiple analyzers. */
export function mergeQueryShapeFactSets(
  primary: readonly QueryShapeFact[],
  secondary: readonly QueryShapeFact[],
): QueryShapeFact[] {
  const primaryFacts = snapshotQueryShapeArray(primary, 'primary query-shape facts');
  const secondaryFacts = snapshotQueryShapeArray(secondary, 'secondary query-shape facts');
  const secondaryByQuery = securityMap<string, QueryShapeFact>();
  for (let index = 0; index < secondaryFacts.length; index += 1) {
    const fact = snapshotQueryShapeFact(
      secondaryFacts[index]!,
      `secondary query-shape fact[${index}]`,
    );
    securityMapSet(secondaryByQuery, fact.query, fact);
  }
  const primaryQueries = securitySet<string>();
  const result: QueryShapeFact[] = [];
  for (let index = 0; index < primaryFacts.length; index += 1) {
    const fact = snapshotQueryShapeFact(primaryFacts[index]!, `primary query-shape fact[${index}]`);
    securitySetAdd(primaryQueries, fact.query);
    insertQueryShapeFact(
      result,
      mergeQueryShapeFact(fact, securityMapGet(secondaryByQuery, fact.query)),
    );
  }
  for (let index = 0; index < secondaryFacts.length; index += 1) {
    const fact = snapshotQueryShapeFact(
      secondaryFacts[index]!,
      `secondary query-shape fact[${index}]`,
    );
    if (!securitySetHas(primaryQueries, fact.query)) insertQueryShapeFact(result, fact);
  }
  return result;
}

function outputSchemaQueryShapeFactsFromSourceFile(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
): readonly QueryShapeFact[] {
  const facts: QueryShapeFact[] = [];
  const visit = (node: TypeScript.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const fact = outputSchemaQueryShapeFactFromVariable(ts, sourceFile, node);
      if (fact) facts[facts.length] = fact;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return facts;
}

function outputSchemaQueryShapeFactFromVariable(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.VariableDeclaration,
): QueryShapeFact | null {
  const initializer = unwrapTsExpression(ts, node.initializer);
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!isQueryCallee(ts, sourceFile, initializer.expression)) return null;

  const declaration = staticQueryDeclaration(ts, node, initializer);
  if (!declaration) return null;
  const output = objectPropertyExpression(ts, declaration.definition, 'output');
  if (!output) return null;
  const shape = compilerQueryShapeFromSchemaExpression(ts, sourceFile, output);
  if (!shape || !isSubstantiveQueryShape(shape)) return null;

  const line = sourceFile.getLineAndCharacterOfPosition(output.getStart(sourceFile)).line + 1;
  return { query: declaration.query, shape, source: `${sourceFile.fileName}:${line}` };
}

function staticQueryDeclaration(
  ts: TypeScriptModule,
  node: TypeScript.VariableDeclaration,
  call: TypeScript.CallExpression,
): { definition: TypeScript.ObjectLiteralExpression; query: string } | null {
  const firstArgument = call.arguments[0];
  const secondArgument = call.arguments[1];
  if (
    firstArgument &&
    (ts.isStringLiteralLike(firstArgument) || ts.isNoSubstitutionTemplateLiteral(firstArgument))
  ) {
    const definition = unwrapTsExpression(ts, secondArgument);
    return definition && ts.isObjectLiteralExpression(definition)
      ? { definition, query: firstArgument.text }
      : null;
  }

  const definition = unwrapTsExpression(ts, firstArgument);
  if (!definition || !ts.isObjectLiteralExpression(definition)) return null;
  if (!ts.isIdentifier(node.name) || !isExportedVariableDeclaration(ts, node)) return null;
  return { definition, query: node.name.text };
}

function compilerQueryShapeFromSchemaExpression(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
): QueryShape | null {
  const current = unwrapTsExpression(ts, expression);
  if (!current) return null;
  if (ts.isCallExpression(current))
    return compilerQueryShapeFromSchemaCall(ts, sourceFile, current);
  if (ts.isPropertyAccessExpression(current)) {
    const receiverShape = compilerQueryShapeFromSchemaExpression(
      ts,
      sourceFile,
      current.expression,
    );
    if (!receiverShape) return null;
    if (current.name.text === 'optional') return { kind: 'optional', shape: receiverShape };
    if (current.name.text === 'nullable' || current.name.text === 'nullish') {
      return { kind: 'nullable', shape: receiverShape };
    }
    return receiverShape;
  }
  return null;
}

function compilerQueryShapeFromSchemaCall(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  call: TypeScript.CallExpression,
): QueryShape | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;

  const receiver = callee.expression;
  const method = callee.name.text;
  const receiverShape = compilerQueryShapeFromSchemaExpression(ts, sourceFile, receiver);
  if (receiverShape) {
    if (method === 'optional') return { kind: 'optional', shape: receiverShape };
    if (method === 'nullable' || method === 'nullish')
      return { kind: 'nullable', shape: receiverShape };
    return receiverShape;
  }

  if (!isKovoSchemaReceiver(ts, sourceFile, receiver)) return null;
  switch (method) {
    case 'array': {
      const item = call.arguments[0];
      const itemShape = item ? compilerQueryShapeFromSchemaExpression(ts, sourceFile, item) : null;
      return [itemShape ?? 'object'];
    }
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'object': {
      const shapeArg = call.arguments[0];
      if (!shapeArg) return {};
      const object = unwrapTsExpression(ts, shapeArg);
      if (!object || !ts.isObjectLiteralExpression(object)) return 'object';
      return compilerQueryShapeFromSchemaObject(ts, sourceFile, object);
    }
    case 'string':
    case 'enum':
      return 'string';
    default:
      return null;
  }
}

function isKovoSchemaReceiver(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    SCHEMA_IDENTITY,
    { legacyGlobals: [SCHEMA_IDENTITY] },
  );
}

function compilerQueryShapeFromSchemaObject(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  object: TypeScript.ObjectLiteralExpression,
): QueryShape {
  const shape = securityNullRecord<QueryShape>();
  for (let index = 0; index < object.properties.length; index += 1) {
    const property = object.properties[index]!;
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(ts, property.name);
    if (!name) continue;
    const child = compilerQueryShapeFromSchemaExpression(ts, sourceFile, property.initializer);
    if (child) shape[name] = child;
  }
  return shape;
}

function objectPropertyExpression(
  ts: TypeScriptModule,
  object: TypeScript.ObjectLiteralExpression,
  propertyName: string,
): TypeScript.Expression | null {
  for (let index = 0; index < object.properties.length; index += 1) {
    const property = object.properties[index]!;
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(ts, property.name) === propertyName) return property.initializer;
  }
  return null;
}

function propertyNameText(ts: TypeScriptModule, name: TypeScript.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isQueryCallee(
  ts: TypeScriptModule,
  sourceFile: TypeScript.SourceFile,
  expression: TypeScript.Expression,
): boolean {
  return expressionResolvesToFrameworkExport(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    expression,
    QUERY_IDENTITY,
    { legacyGlobals: [QUERY_IDENTITY] },
  );
}

function isExportedVariableDeclaration(
  ts: TypeScriptModule,
  declaration: TypeScript.VariableDeclaration,
): boolean {
  let current: TypeScript.Node = declaration;
  while (current.parent) {
    current = current.parent;
    if (ts.isVariableStatement(current)) {
      const modifiers = current.modifiers;
      if (modifiers === undefined) return false;
      for (let index = 0; index < modifiers.length; index += 1) {
        if (modifiers[index]!.kind === ts.SyntaxKind.ExportKeyword) return true;
      }
      return false;
    }
  }
  return false;
}

function unwrapTsExpression(
  ts: TypeScriptModule,
  expression: TypeScript.Expression | undefined,
): TypeScript.Expression | null {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current ?? null;
}

function isSubstantiveQueryShape(shape: QueryShape): boolean {
  if (typeof shape === 'string') return shape !== 'object';
  if (securityIsArray(shape)) {
    const entries = snapshotQueryShapeArray(shape, 'query-shape array');
    for (let index = 0; index < entries.length; index += 1) {
      if (isSubstantiveQueryShape(entries[index] as QueryShape)) return true;
    }
    return false;
  }
  if (securityHasOwn(shape, 'kind')) {
    return isSubstantiveQueryShape(
      queryShapeOwnDataValue(shape, 'shape', 'wrapped query shape') as QueryShape,
    );
  }
  return securityObjectKeys(shape).length > 0;
}

function mergeQueryShapeFact(
  primary: QueryShapeFact,
  secondary: QueryShapeFact | undefined,
): QueryShapeFact {
  if (!secondary) return primary;
  return freezeSecurityValue({
    query: primary.query,
    shape: mergeQueryShapes(primary.shape, secondary.shape),
    source: `${primary.source}; output ${secondary.source}`,
  });
}

function mergeQueryShapes(primary: QueryShape, secondary: QueryShape): QueryShape {
  if (securityIsArray(primary) && securityIsArray(secondary)) {
    const primaryItems = snapshotQueryShapeArray(primary, 'primary query-shape array');
    const secondaryItems = snapshotQueryShapeArray(secondary, 'secondary query-shape array');
    const primaryItem = primaryItems[0] as QueryShape | undefined;
    const secondaryItem = secondaryItems[0] as QueryShape | undefined;
    return primaryItem && secondaryItem ? [mergeQueryShapes(primaryItem, secondaryItem)] : primary;
  }

  if (isPlainQueryShapeObject(primary) && isPlainQueryShapeObject(secondary)) {
    const merged = securityNullRecord<QueryShape>();
    const secondaryKeys = securityObjectKeys(secondary);
    for (let index = 0; index < secondaryKeys.length; index += 1) {
      const key = secondaryKeys[index]!;
      merged[key] = queryShapeOwnDataValue(
        secondary,
        key,
        'secondary query-shape object',
      ) as QueryShape;
    }
    const primaryKeys = securityObjectKeys(primary);
    for (let index = 0; index < primaryKeys.length; index += 1) {
      const key = primaryKeys[index]!;
      const value = queryShapeOwnDataValue(
        primary,
        key,
        'primary query-shape object',
      ) as QueryShape;
      const secondaryValue = securityHasOwn(secondary, key)
        ? (queryShapeOwnDataValue(secondary, key, 'secondary query-shape object') as QueryShape)
        : undefined;
      merged[key] = secondaryValue ? mergeQueryShapes(value, secondaryValue) : value;
    }
    return freezeSecurityValue(merged);
  }

  return primary;
}

function isPlainQueryShapeObject(shape: QueryShape): shape is Record<string, QueryShape> {
  return (
    typeof shape === 'object' &&
    shape !== null &&
    !securityIsArray(shape) &&
    !securityHasOwn(shape, 'kind')
  );
}

function snapshotQueryShapeSourceFile(
  value: QueryShapeSourceFile,
  label: string,
): QueryShapeSourceFile {
  const fileName = queryShapeOwnDataValue(value, 'fileName', label);
  const source = queryShapeOwnDataValue(value, 'source', label);
  if (typeof fileName !== 'string' || typeof source !== 'string') {
    throw new TypeError(`${label} must expose own string fileName/source properties.`);
  }
  return freezeSecurityValue({ fileName, source });
}

function snapshotQueryShapeFact(value: QueryShapeFact, label: string): QueryShapeFact {
  const query = queryShapeOwnDataValue(value, 'query', label);
  const shape = queryShapeOwnDataValue(value, 'shape', label);
  const source = queryShapeOwnDataValue(value, 'source', label);
  if (typeof query !== 'string' || typeof source !== 'string') {
    throw new TypeError(`${label} must expose own string query/source properties.`);
  }
  return freezeSecurityValue({
    query,
    shape: snapshotQueryShape(shape, `${label}.shape`),
    source,
  });
}

function snapshotQueryShape(value: unknown, label: string): QueryShape {
  if (
    value === 'array' ||
    value === 'boolean' ||
    value === 'number' ||
    value === 'object' ||
    value === 'string'
  ) {
    return value;
  }
  if (securityIsArray(value)) {
    const source = snapshotQueryShapeArray(value, label);
    const output: QueryShape[] = [];
    for (let index = 0; index < source.length; index += 1) {
      output[output.length] = snapshotQueryShape(source[index], `${label}[${index}]`);
    }
    return freezeSecurityValue(output);
  }
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${label} must be a compiler query shape.`);
  }
  if (securityHasOwn(value, 'kind')) {
    const kind = queryShapeOwnDataValue(value, 'kind', label);
    const shape = snapshotQueryShape(
      queryShapeOwnDataValue(value, 'shape', label),
      `${label}.shape`,
    );
    if (kind === 'table-row') {
      const table = queryShapeOwnDataValue(value, 'table', label);
      if (typeof table !== 'string') throw new TypeError(`${label}.table must be a string.`);
      return freezeSecurityValue({ kind: 'table-row' as const, shape, table });
    }
    if (kind === 'revealed') {
      return freezeSecurityValue({
        kind: 'revealed' as const,
        reveal: queryShapeOwnDataValue(value, 'reveal', label),
        shape,
      });
    }
    if (
      kind === 'nullable' ||
      kind === 'optional' ||
      kind === 'secret' ||
      kind === 'volatile-time'
    ) {
      return freezeSecurityValue({ kind, shape } as const);
    }
    throw new TypeError(`${label}.kind is not a compiler query-shape wrapper.`);
  }
  const output = securityNullRecord<QueryShape>();
  const keys = securityObjectKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    output[key] = snapshotQueryShape(queryShapeOwnDataValue(value, key, label), `${label}.${key}`);
  }
  return freezeSecurityValue(output);
}

function snapshotQueryShapeArray<Value>(value: readonly Value[], label: string): readonly Value[] {
  if (!securityIsArray(value)) throw new TypeError(`${label} must be an array.`);
  const rawLength = queryShapeOwnDataValue(value, 'length', label);
  if (
    typeof rawLength !== 'number' ||
    rawLength < 0 ||
    rawLength > 100_000 ||
    rawLength % 1 !== 0
  ) {
    throw new TypeError(`${label} must expose a bounded dense length.`);
  }
  const snapshot: Value[] = [];
  for (let index = 0; index < rawLength; index += 1) {
    snapshot[index] = queryShapeOwnDataValue(value, index, label) as Value;
  }
  return freezeSecurityValue(snapshot);
}

function queryShapeOwnDataValue(value: object, property: PropertyKey, label: string): unknown {
  const before = securityGetOwnPropertyDescriptor(value, property);
  const after = securityGetOwnPropertyDescriptor(value, property);
  if (
    !sameQueryShapeDataDescriptor(before, after) ||
    before === undefined ||
    !('value' in before)
  ) {
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return before.value;
}

function sameQueryShapeDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    securityObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function appendQueryShapeFacts(
  target: QueryShapeFact[],
  source: readonly QueryShapeFact[],
  label: string,
): void {
  const facts = snapshotQueryShapeArray(source, label);
  for (let index = 0; index < facts.length; index += 1) {
    target[target.length] = snapshotQueryShapeFact(facts[index]!, `${label}[${index}]`);
  }
}

function insertQueryShapeFact(result: QueryShapeFact[], fact: QueryShapeFact): void {
  let index = result.length;
  while (index > 0 && compareQueryShapeFact(fact, result[index - 1]!) < 0) {
    result[index] = result[index - 1]!;
    index -= 1;
  }
  result[index] = fact;
}

function compareQueryShapeFact(left: QueryShapeFact, right: QueryShapeFact): number {
  if (left.query !== right.query) return left.query < right.query ? -1 : 1;
  if (left.source === right.source) return 0;
  return left.source < right.source ? -1 : 1;
}
