import { componentOptionObjectKeys, type ComponentModuleModel } from '../scan/parse.js';
import type { CompileComponentOptions, QueryShape, QueryShapeFact } from '../types.js';
import {
  isArrayQueryShape,
  isQueryShapeObject,
  isQueryShapeWrapper,
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
  return new Set([
    ...componentQueryNames(model),
    ...Object.keys(options.registryFacts?.queries ?? {}),
    ...Object.keys(componentQueryShapes(options) ?? {}),
  ]);
}

export function componentQueryNames(model: ComponentModuleModel): string[] {
  return componentOptionObjectKeys(model, 'queries');
}

export function componentQueryShapes(
  options: QueryShapeOptions,
): Record<string, QueryShape> | null {
  return (
    options.queryShapes ??
    (options.queryShapeFacts ? queryShapesFromFacts(options.queryShapeFacts) : null)
  );
}

export function queryNameFromPath(path: string): string | null {
  return path.split('.', 1)[0] ?? null;
}

export function queryPathUsesKnownQuery(path: string, knownQueries: ReadonlySet<string>): boolean {
  const query = queryNameFromPath(path);
  return query !== null && knownQueries.has(query);
}

export function validatePathInQueryShapes(
  path: string,
  queryShapes: Record<string, QueryShape>,
): PathShapeValidation {
  const [querySegment, ...segments] = parseBindingPath(path);
  const queryName = querySegment?.name;
  if (!queryName) return { exists: false };

  const shape = queryShapes[queryName];
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
    const itemShape = current[0];
    return itemShape === undefined ? { exists: false } : validatePathInShape(itemShape, segments);
  }

  if (!isQueryShapeObject(current)) return { exists: false };

  const [head, ...tail] = segments;
  if (!head || !(head.name in current)) return { exists: false };

  const child = current[head.name] ?? 'object';
  const nullableTraversal = tail.length > 0 && isQueryShapeWrapper(child) && !head.optional;
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
  if (isArrayQueryShape(current)) return queryShapeAtPath(current[0] ?? 'object', segments);
  if (!isQueryShapeObject(current)) return 'object';

  const [head, ...tail] = segments;
  if (!head) return current;
  return queryShapeAtPath(current[head.name] ?? 'object', tail);
}

export function queryShapeAtBindingPath(
  path: string,
  queryShapes: Record<string, QueryShape>,
): QueryShape | undefined {
  const [querySegment, ...segments] = parseBindingPath(path);
  const queryName = querySegment?.name;
  const shape = queryName ? queryShapes[queryName] : undefined;
  return shape === undefined ? undefined : queryShapeAtPath(shape, segments);
}

export function listItemShapeAtBindingPath(
  path: string,
  queryShapes: Record<string, QueryShape>,
): QueryShape | undefined {
  const shape = queryShapeAtBindingPath(path, queryShapes);
  return shape !== undefined && isArrayQueryShape(shape) ? shape[0] : undefined;
}

export function validateListBindingInQueryShapes(
  listPath: string,
  keyPath: string,
  itemBindingPaths: readonly string[],
  queryShapes: Record<string, QueryShape>,
): PathShapeValidation {
  const [querySegment, ...segments] = parseBindingPath(listPath);
  const queryName = querySegment?.name;
  if (!queryName || segments.length === 0) return { exists: false };

  const listShape = queryShapes[queryName];
  if (!listShape) return { exists: false };

  const itemShape = listItemShapeAtBindingPath(listPath, queryShapes);
  if (itemShape === undefined) return { exists: false };
  if (!validatePathInShape(itemShape, [requiredPathSegment(keyPath)]).exists) {
    return { exists: false };
  }

  const listValidation = validatePathInShape(listShape, segments);
  if (!listValidation.exists) return { exists: false };
  if (listValidation.nullableTraversal) return listValidation;

  for (const path of itemBindingPaths) {
    if (!validatePathInShape(itemShape, parseBindingPath(relativeBindingPath(path))).exists) {
      return { exists: false };
    }
  }

  return { exists: true };
}

export function queryShapePaths(queryShapes: Record<string, QueryShape>): string[] {
  return Object.entries(queryShapes).flatMap(([queryName, shape]) => [
    queryName,
    ...queryShapeChildPaths(shape).map((path) => `${queryName}.${path}`),
  ]);
}

export function parseBindingPath(path: string): BindingPathSegment[] {
  return path
    .split('.')
    .filter((segment) => segment !== '')
    .map((segment) => ({
      name: segment.endsWith('?') ? segment.slice(0, -1) : segment,
      optional: segment.endsWith('?'),
    }));
}

export function requiredPathSegment(name: string): BindingPathSegment {
  return { name, optional: false };
}

export function relativeBindingPath(path: string): string {
  return isRelativeBindingPath(path) ? path.slice(1) : path;
}

export function isRelativeBindingPath(path: string): boolean {
  return path.startsWith('.');
}

function queryShapeChildPaths(shape: QueryShape): string[] {
  const current = unwrapQueryShape(shape);
  if (isArrayQueryShape(current)) {
    const itemShape = current[0];
    return itemShape === undefined ? [] : queryShapeChildPaths(itemShape);
  }

  if (!isQueryShapeObject(current)) return [];

  return Object.entries(current).flatMap(([key, child]) => [
    key,
    ...queryShapeChildPaths(child ?? 'object').map((path) => `${key}.${path}`),
  ]);
}
