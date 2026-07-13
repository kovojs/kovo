import { allComponentOptionObjectKeys, type ComponentModuleModel } from '../scan/parse.js';
import type { CompileComponentOptions, QueryShape, QueryShapeFact } from '../types.js';
import {
  compilerArrayAppend,
  compilerCreateSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringEndsWith,
  compilerStringIndexOf,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import {
  isArrayQueryShape,
  isNullableQueryShapeWrapper,
  isQueryShapeObject,
  queryShapesFromFacts,
  unwrapQueryShape,
} from '../types.js';

export interface QueryShapeOptions {
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
  registryFacts?: CompileComponentOptions['registryFacts'];
}

export interface BindingPathSegment {
  name: string;
  optional: boolean;
}

export interface NullableTraversal {
  segment: string;
}

export interface PathShapeValidation {
  exists: boolean;
  nullableTraversal?: NullableTraversal;
}

export function knownQueryNames(
  model: ComponentModuleModel,
  options: QueryShapeOptions,
): Set<string> {
  const names = compilerCreateSet<string>();
  addStringsToSet(names, componentQueryNames(model), 'Compiler component query names');
  const registryFacts = compilerOwnDataValue(
    options,
    'registryFacts',
    'Compiler query-shape options',
  );
  if (typeof registryFacts === 'object' && registryFacts !== null) {
    const registryQueries = compilerOwnDataValue(
      registryFacts,
      'queries',
      'Compiler query-shape registry facts',
    );
    if (typeof registryQueries === 'object' && registryQueries !== null) {
      addStringsToSet(names, compilerObjectKeys(registryQueries), 'Compiler registry query names');
    }
  }
  const shapes = componentQueryShapes(options);
  if (shapes !== null) {
    addStringsToSet(names, compilerObjectKeys(shapes), 'Compiler query-shape names');
  }
  return names;
}

export function componentQueryNames(model: ComponentModuleModel): string[] {
  return allComponentOptionObjectKeys(model, 'queries');
}

export function componentQueryShapes(
  options: QueryShapeOptions,
): Record<string, QueryShape> | null {
  const queryShapes = compilerOwnDataValue(options, 'queryShapes', 'Compiler query-shape options');
  if (queryShapes !== undefined) return queryShapes as Record<string, QueryShape>;
  const queryShapeFacts = compilerOwnDataValue(
    options,
    'queryShapeFacts',
    'Compiler query-shape options',
  );
  return queryShapeFacts === undefined
    ? null
    : queryShapesFromFacts(queryShapeFacts as readonly QueryShapeFact[]);
}

export function queryNameFromPath(path: string): string | null {
  const separator = compilerStringIndexOf(path, '.');
  return separator < 0 ? path : compilerStringSlice(path, 0, separator);
}

export function queryPathUsesKnownQuery(path: string, knownQueries: ReadonlySet<string>): boolean {
  const query = queryNameFromPath(path);
  return query !== null && compilerSetHas(knownQueries, query);
}

export function validatePathInQueryShapes(
  path: string,
  queryShapes: Record<string, QueryShape>,
): PathShapeValidation {
  const parsed = parseBindingPath(path);
  const querySegment = parsed[0];
  const segments = arrayTail(parsed, 'Compiler query binding path');
  const queryName = querySegment?.name;
  if (!queryName) return { exists: false };

  const shape = compilerOwnDataValue(queryShapes, queryName, 'Compiler query shapes') as
    | QueryShape
    | undefined;
  if (!shape || segments.length === 0) return { exists: Boolean(shape) };

  return validatePathInShape(shape, segments);
}

export function validatePathInShape(
  shape: QueryShape,
  segments: readonly BindingPathSegment[],
): PathShapeValidation {
  const current = unwrapQueryShape(shape);
  if (segments.length === 0) return { exists: true };

  if (isArrayQueryShape(current)) {
    const head = segments[0];
    const tail = arrayTail(segments, 'Compiler array query-shape path');
    if (head?.name === 'length') return { exists: tail.length === 0 };
    const itemShape = compilerOwnDataValue(current, 0, 'Compiler array query shape') as
      | QueryShape
      | undefined;
    if (itemShape === undefined) return { exists: false };
    return head && compilerRegExpTest(/^\d+$/u, head.name)
      ? validatePathInShape(itemShape, tail)
      : validatePathInShape(itemShape, segments);
  }

  if (!isQueryShapeObject(current)) return { exists: false };

  const head = segments[0];
  const tail = arrayTail(segments, 'Compiler object query-shape path');
  if (!head) return { exists: false };

  const child = compilerOwnDataValue(current, head.name, 'Compiler object query shape') as
    | QueryShape
    | undefined;
  if (child === undefined) return { exists: false };
  const nullableTraversal = tail.length > 0 && isNullableQueryShapeWrapper(child) && !head.optional;
  if (nullableTraversal) {
    const childValidation = validatePathInShape(child, tail);
    return childValidation.exists
      ? { exists: true, nullableTraversal: { segment: head.name } }
      : { exists: false };
  }

  return validatePathInShape(child, tail);
}

export function queryShapeAtPath(
  shape: QueryShape,
  segments: readonly BindingPathSegment[],
): QueryShape {
  const current = unwrapQueryShape(shape);
  if (segments.length === 0) return current;
  if (isArrayQueryShape(current)) {
    const head = segments[0];
    const tail = arrayTail(segments, 'Compiler array query-shape lookup path');
    if (head?.name === 'length') return tail.length === 0 ? 'number' : 'object';
    const itemShape = (compilerOwnDataValue(current, 0, 'Compiler array query shape') ??
      'object') as QueryShape;
    return head && compilerRegExpTest(/^\d+$/u, head.name)
      ? queryShapeAtPath(itemShape, tail)
      : queryShapeAtPath(itemShape, segments);
  }
  if (!isQueryShapeObject(current)) return 'object';

  const head = segments[0];
  const tail = arrayTail(segments, 'Compiler object query-shape lookup path');
  if (!head) return current;
  return queryShapeAtPath(
    (compilerOwnDataValue(current, head.name, 'Compiler object query shape') ??
      'object') as QueryShape,
    tail,
  );
}

export function queryShapeAtBindingPath(
  path: string,
  queryShapes: Record<string, QueryShape>,
): QueryShape | undefined {
  const parsed = parseBindingPath(path);
  const querySegment = parsed[0];
  const segments = arrayTail(parsed, 'Compiler query-shape lookup path');
  const queryName = querySegment?.name;
  const shape = queryName
    ? (compilerOwnDataValue(queryShapes, queryName, 'Compiler query shapes') as
        | QueryShape
        | undefined)
    : undefined;
  return shape === undefined ? undefined : queryShapeAtPath(shape, segments);
}

export function listItemShapeAtBindingPath(
  path: string,
  queryShapes: Record<string, QueryShape>,
): QueryShape | undefined {
  const shape = queryShapeAtBindingPath(path, queryShapes);
  return shape !== undefined && isArrayQueryShape(shape)
    ? (compilerOwnDataValue(shape, 0, 'Compiler list query shape') as QueryShape | undefined)
    : undefined;
}

export function validateListBindingInQueryShapes(
  listPath: string,
  keyPath: string,
  itemBindingPaths: readonly string[],
  queryShapes: Record<string, QueryShape>,
): PathShapeValidation {
  const parsed = parseBindingPath(listPath);
  const querySegment = parsed[0];
  const segments = arrayTail(parsed, 'Compiler list query binding path');
  const queryName = querySegment?.name;
  if (!queryName || segments.length === 0) return { exists: false };

  const listShape = compilerOwnDataValue(queryShapes, queryName, 'Compiler query shapes') as
    | QueryShape
    | undefined;
  if (!listShape) return { exists: false };

  const itemShape = listItemShapeAtBindingPath(listPath, queryShapes);
  if (itemShape === undefined) return { exists: false };
  if (!validatePathInShape(itemShape, [requiredPathSegment(keyPath)]).exists) {
    return { exists: false };
  }

  const listValidation = validatePathInShape(listShape, segments);
  if (!listValidation.exists) return { exists: false };
  if (listValidation.nullableTraversal) return listValidation;

  const paths = compilerSnapshotDenseArray(itemBindingPaths, 'Compiler list item binding paths');
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    if (!validatePathInShape(itemShape, parseBindingPath(relativeBindingPath(path))).exists) {
      return { exists: false };
    }
  }

  return { exists: true };
}

export function queryShapePaths(queryShapes: Record<string, QueryShape>): string[] {
  const paths: string[] = [];
  const queryNames = compilerSnapshotDenseArray(
    compilerObjectKeys(queryShapes),
    'Compiler query-shape path names',
  );
  for (let index = 0; index < queryNames.length; index += 1) {
    const queryName = queryNames[index]!;
    compilerArrayAppend(paths, queryName, 'Compiler query-shape paths');
    const shape = compilerOwnDataValue(queryShapes, queryName, 'Compiler query shapes') as
      | QueryShape
      | undefined;
    if (shape === undefined) continue;
    const children = queryShapeChildPaths(shape);
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      compilerArrayAppend(
        paths,
        `${queryName}.${children[childIndex]!}`,
        'Compiler query-shape paths',
      );
    }
  }
  return paths;
}

export function parseBindingPath(path: string): BindingPathSegment[] {
  const rawSegments = compilerStringSplit(path, '.');
  const segments: BindingPathSegment[] = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = rawSegments[index]!;
    if (segment === '') continue;
    const optional = compilerStringEndsWith(segment, '?');
    compilerArrayAppend(
      segments,
      {
        name: optional ? compilerStringSlice(segment, 0, -1) : segment,
        optional,
      },
      'Compiler binding path segments',
    );
  }
  return segments;
}

export function requiredPathSegment(name: string): BindingPathSegment {
  return { name, optional: false };
}

export function relativeBindingPath(path: string): string {
  return isRelativeBindingPath(path) ? compilerStringSlice(path, 1) : path;
}

export function isRelativeBindingPath(path: string): boolean {
  return compilerStringStartsWith(path, '.');
}

function queryShapeChildPaths(shape: QueryShape): string[] {
  const current = unwrapQueryShape(shape);
  if (isArrayQueryShape(current)) {
    const paths = ['length'];
    const itemShape = compilerOwnDataValue(current, 0, 'Compiler array query shape') as
      | QueryShape
      | undefined;
    if (itemShape !== undefined) {
      const children = queryShapeChildPaths(itemShape);
      for (let index = 0; index < children.length; index += 1) {
        compilerArrayAppend(paths, children[index]!, 'Compiler query-shape child paths');
      }
    }
    return paths;
  }

  if (!isQueryShapeObject(current)) return [];

  const paths: string[] = [];
  const keys = compilerSnapshotDenseArray(
    compilerObjectKeys(current),
    'Compiler object query-shape keys',
  );
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    compilerArrayAppend(paths, key, 'Compiler query-shape child paths');
    const child = (compilerOwnDataValue(current, key, 'Compiler object query shape') ??
      'object') as QueryShape;
    const children = queryShapeChildPaths(child);
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      compilerArrayAppend(
        paths,
        `${key}.${children[childIndex]!}`,
        'Compiler query-shape child paths',
      );
    }
  }
  return paths;
}

function arrayTail<Value>(values: readonly Value[], label: string): Value[] {
  const source = compilerSnapshotDenseArray(values, label);
  const tail: Value[] = [];
  for (let index = 1; index < source.length; index += 1) {
    compilerArrayAppend(tail, source[index]!, `${label} tail`);
  }
  return tail;
}

function addStringsToSet(target: Set<string>, values: readonly string[], label: string): void {
  const snapshot = compilerSnapshotDenseArray(values, label);
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerSetAdd(target, snapshot[index]!);
  }
}
