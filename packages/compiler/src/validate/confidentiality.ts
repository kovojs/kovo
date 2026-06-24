import { componentOptionObjectKeys } from '../scan/parse.js';
import type { ComponentModuleModel } from '../scan/parse.js';
import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import { componentQueryShapes } from '../analyze/query-shapes.js';
import type { CompileComponentOptions, QueryShape } from '../types.js';
import { isArrayQueryShape, isQueryShapeObject, isQueryShapeWrapper } from '../types.js';

/** Reject secret-classified query fields before they reach the client query wire (SPEC §6.2/§10.2). */
export function validateSecretQueryWire(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const queryNames = componentOptionObjectKeys(model, 'queries');
  return queryNames.flatMap((query) =>
    secretQueryShapePaths(queryShapes[query]).map((path) =>
      diagnostics.at(
        'KV435',
        undefined,
        `query="${query}" path="${pathForDiagnostic(query, path)}"`,
      ),
    ),
  );
}

function secretQueryShapePaths(
  shape: QueryShape | undefined,
  path: readonly string[] = [],
): string[] {
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
    if (shape.kind === 'secret') return [path.join('.')];
    return secretQueryShapePaths(shape.shape, path);
  }

  if (isArrayQueryShape(shape)) return secretQueryShapePaths(shape[0] ?? 'object', path);
  if (!isQueryShapeObject(shape)) return [];

  return Object.entries(shape).flatMap(([key, child]) =>
    secretQueryShapePaths(child, [...path, key]),
  );
}

function malformedRevealInnerShape(shape: QueryShape): QueryShape | undefined {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return undefined;
  const record = shape as Record<string, unknown>;
  if (record.kind !== 'revealed' || !('shape' in record) || 'reveal' in record) return undefined;
  return record.shape as QueryShape;
}

function pathForDiagnostic(query: string, path: string): string {
  return path === '' ? query : `${query}.${path}`;
}
