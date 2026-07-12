import { securityClassifier } from '@kovojs/core/internal/security-markers';
import {
  compilerArrayIsArray,
  compilerArrayLength,
  compilerObjectKeys,
  compilerOwnDataValue,
} from '../compiler-security-intrinsics.js';
import { componentOptionObjectKeys } from '../scan/parse.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import { componentQueryShapes } from '../analyze/query-shapes.js';
import type { CompileComponentOptions, QueryShape } from '../types.js';
import { isArrayQueryShape, isQueryShapeObject, isQueryShapeWrapper } from '../types.js';

/** Reject secret-classified query fields before they reach the client query wire (SPEC §6.2/§10.2). */
export const validateSecretQueryWire = securityClassifier(
  'compiler.confidentiality.validate-secret-query-wire',
  function (
    diagnostics: DiagnosticFactory,
    model: ComponentModuleModel,
    options: CompileComponentOptions,
  ): CompilerDiagnostic[] {
    const queryShapes = componentQueryShapes(options);
    const queryNames = componentOptionObjectKeys(model, 'queries');
    const queryNameLength = compilerArrayLength(queryNames, 'Component query names');
    const queryNameSnapshot: string[] = [];
    const missingShapeDiagnostics: CompilerDiagnostic[] = [];
    for (let index = 0; index < queryNameLength; index += 1) {
      const query = compilerOwnDataValue(queryNames, index, 'Component query names');
      if (typeof query !== 'string') {
        throw new TypeError(`Component query names[${index}] must be an own string.`);
      }
      queryNameSnapshot[queryNameSnapshot.length] = query;
      const shape = queryShapes
        ? (compilerOwnDataValue(queryShapes, query, 'Component query shapes') as
            | QueryShape
            | undefined)
        : undefined;
      if (requiresClosedQueryShapeFacts(options) && shape === undefined) {
        missingShapeDiagnostics[missingShapeDiagnostics.length] = diagnostics.at(
          'KV435',
          undefined,
          `query="${query}" missing query-shape fact for production query-wire validation`,
        );
      }
    }
    if (!queryShapes) return missingShapeDiagnostics;

    const result: CompilerDiagnostic[] = [];
    appendDiagnostics(result, missingShapeDiagnostics);
    for (let index = 0; index < queryNameSnapshot.length; index += 1) {
      const query = queryNameSnapshot[index]!;
      const shape = compilerOwnDataValue(queryShapes, query, 'Component query shapes') as
        | QueryShape
        | undefined;
      const secretPaths = secretQueryShapePaths(shape);
      for (let pathIndex = 0; pathIndex < secretPaths.length; pathIndex += 1) {
        result[result.length] = diagnostics.at(
          'KV435',
          undefined,
          `query="${query}" path="${pathForDiagnostic(query, secretPaths[pathIndex]!)}"`,
        );
      }
      const tablePaths = tableRowQueryShapePaths(shape);
      for (let pathIndex = 0; pathIndex < tablePaths.length; pathIndex += 1) {
        result[result.length] = diagnostics.at(
          'KV439',
          undefined,
          `query="${query}" path="${pathForDiagnostic(query, tablePaths[pathIndex]!)}"`,
        );
      }
    }
    return result;
  },
);

function requiresClosedQueryShapeFacts(options: CompileComponentOptions): boolean {
  return options.productionRenderPlanGate !== undefined;
}

const secretQueryShapePaths = securityClassifier(
  'compiler.confidentiality.secret-query-paths',
  function (shape: QueryShape | undefined, path: readonly string[] = []): string[] {
    if (shape === undefined) return [];

    const malformedRevealInner = malformedRevealInnerShape(shape);
    if (malformedRevealInner) {
      return secretQueryShapePaths(malformedRevealInner, path);
    }

    if (isQueryShapeWrapper(shape)) {
      // SPEC §1.1/§2: a reveal is an explicit audited escape hatch. The shape fact
      // records that decision for `kovo explain --revealed`; KV435 remains the
      // default for un-revealed secret fields.
      if (shape.kind === 'revealed') return [];
      if (shape.kind === 'secret') return [joinShapePath(path)];
      return secretQueryShapePaths(shape.shape, path);
    }

    if (isArrayQueryShape(shape)) {
      const item = compilerOwnDataValue(shape, 0, 'Secret query array shape');
      return secretQueryShapePaths((item ?? 'object') as QueryShape, path);
    }
    if (isQueryShapePrimitive(shape)) return [];
    if (!isQueryShapeObject(shape)) return [joinShapePath(path)];

    const result: string[] = [];
    const keys = compilerObjectKeys(shape);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const child = compilerOwnDataValue(shape, key, 'Secret query object shape') as QueryShape;
      appendStrings(result, secretQueryShapePaths(child, appendShapePath(path, key)));
    }
    return result;
  },
);

const tableRowQueryShapePaths = securityClassifier(
  'compiler.confidentiality.table-row-query-paths',
  function (shape: QueryShape | undefined, path: readonly string[] = []): string[] {
    if (shape === undefined) return [];

    if (isQueryShapeWrapper(shape)) {
      if (shape.kind === 'table-row') return [joinShapePath(path)];
      return tableRowQueryShapePaths(shape.shape, path);
    }

    if (isArrayQueryShape(shape)) {
      const item = compilerOwnDataValue(shape, 0, 'Table-row query array shape');
      return tableRowQueryShapePaths((item ?? 'object') as QueryShape, path);
    }
    if (isQueryShapePrimitive(shape)) return [];
    if (!isQueryShapeObject(shape)) return [joinShapePath(path)];

    const result: string[] = [];
    const keys = compilerObjectKeys(shape);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const child = compilerOwnDataValue(shape, key, 'Table-row query object shape') as QueryShape;
      appendStrings(result, tableRowQueryShapePaths(child, appendShapePath(path, key)));
    }
    return result;
  },
);

function isQueryShapePrimitive(shape: QueryShape): boolean {
  return (
    shape === 'array' ||
    shape === 'boolean' ||
    shape === 'number' ||
    shape === 'object' ||
    shape === 'string'
  );
}

function malformedRevealInnerShape(shape: QueryShape): QueryShape | undefined {
  if (typeof shape !== 'object' || shape === null || compilerArrayIsArray(shape)) return undefined;
  const record = shape as Record<string, unknown>;
  const kind = compilerOwnDataValue(record, 'kind', 'Reveal query shape');
  const inner = compilerOwnDataValue(record, 'shape', 'Reveal query shape');
  const reveal = compilerOwnDataValue(record, 'reveal', 'Reveal query shape');
  if (kind !== 'revealed' || inner === undefined || reveal !== undefined) return undefined;
  return inner as QueryShape;
}

function appendDiagnostics(
  target: CompilerDiagnostic[],
  values: readonly CompilerDiagnostic[],
): void {
  for (let index = 0; index < values.length; index += 1) target[target.length] = values[index]!;
}

function appendStrings(target: string[], values: readonly string[]): void {
  for (let index = 0; index < values.length; index += 1) target[target.length] = values[index]!;
}

function appendShapePath(path: readonly string[], key: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < path.length; index += 1) result[result.length] = path[index]!;
  result[result.length] = key;
  return result;
}

function joinShapePath(path: readonly string[]): string {
  let result = '';
  for (let index = 0; index < path.length; index += 1) {
    if (index > 0) result += '.';
    result += path[index]!;
  }
  return result;
}

function pathForDiagnostic(query: string, path: string): string {
  return path === '' ? query : `${query}.${path}`;
}
