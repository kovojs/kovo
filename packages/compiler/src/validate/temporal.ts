import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { componentQueryShapes } from '../analyze/query-shapes.js';
import {
  callExpressions,
  componentOptionObjectEntries,
  componentOptionObjectKeys,
  jsxElements,
  jsxExpressions,
  type ComponentModuleModel,
  type PropertyAccessPathModel,
} from '../scan/parse.js';
import type { CompileComponentOptions, QueryShape } from '../types.js';
import { isQueryShapeObject, isQueryShapeWrapper, unwrapQueryShape } from '../types.js';

export function validateUntrackedClockReadsInDerives(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const call of callExpressions(model)) {
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const reads = call.argumentTemporalReads[1] ?? [];
    for (const read of reads) {
      diagnostics.push({
        ...diagnosticFor(fileName, 'KV315', source, read.start, read.end - read.start),
        message: `${diagnosticFor(fileName, 'KV315').message} ${read.kind} in ${call.exportedConstName}`,
      });
    }
  }

  return diagnostics;
}

interface ClockRead {
  clock: string;
  end: number;
  path: string;
  start: number;
}

export function validateDeclaredClockReadsInRender(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
  options: Pick<CompileComponentOptions, 'queryShapeFacts' | 'queryShapes' | 'registryFacts'> = {},
): CompilerDiagnostic[] {
  const declaredClocks = new Set(componentOptionObjectKeys(model, 'clocks'));
  const renderOnceSpans = callExpressions(model)
    .filter((call) => call.name === 'renderOnce')
    .map((call) => ({ end: call.end, start: call.start }));
  const diagnostics: CompilerDiagnostic[] = [];

  for (const read of renderedClockReads(model)) {
    if (declaredClocks.has(read.clock)) continue;
    if (renderOnceSpans.some((span) => read.start >= span.start && read.end <= span.end)) continue;

    diagnostics.push({
      ...diagnosticFor(fileName, 'KV312', source, read.start, read.end - read.start),
      message: `${diagnosticFor(fileName, 'KV312').message} now.${read.clock}`,
    });
  }

  const refreshedQueries = refreshedComponentQueryNames(model);
  for (const read of renderedVolatileQueryReads(model, options)) {
    if (refreshedQueries.has(read.query)) continue;
    if (renderOnceSpans.some((span) => read.start >= span.start && read.end <= span.end)) continue;

    diagnostics.push({
      ...diagnosticFor(fileName, 'KV312', source, read.start, read.end - read.start),
      message: `${diagnosticFor(fileName, 'KV312').message} ${read.path}`,
    });
  }

  return diagnostics;
}

function renderedClockReads(model: ComponentModuleModel): ClockRead[] {
  const reads = jsxExpressions(model)
    .filter((expression) => !isJsxEventAttributeExpression(expression, model))
    .flatMap((expression) => expression.propertyAccesses.flatMap(clockReadFromPropertyAccess));

  return dedupeClockReads(reads);
}

interface VolatileQueryRead {
  end: number;
  path: string;
  query: string;
  start: number;
}

function renderedVolatileQueryReads(
  model: ComponentModuleModel,
  options: Pick<CompileComponentOptions, 'queryShapeFacts' | 'queryShapes' | 'registryFacts'>,
): VolatileQueryRead[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const reads = jsxExpressions(model)
    .filter((expression) => !isJsxEventAttributeExpression(expression, model))
    .flatMap((expression) =>
      expression.propertyAccesses.flatMap((access) =>
        volatileQueryReadFromPropertyAccess(access, queryShapes),
      ),
    );

  return dedupeBy(reads, (read) => `${read.path}\0${read.start}\0${read.end}`);
}

function volatileQueryReadFromPropertyAccess(
  access: PropertyAccessPathModel,
  queryShapes: Record<string, QueryShape>,
): VolatileQueryRead[] {
  const segments = access.path.split('.').map((segment) => segment.replace(/\?$/, ''));
  const query = segments[0];
  if (!query || !queryShapes[query]) return [];

  const fieldSegments = segments.slice(1);
  if (fieldSegments.length === 0) return [];
  const shape = shapeAtSegments(queryShapes[query], fieldSegments);
  if (!shapeHasVolatileTime(shape)) return [];

  return [
    {
      end: access.end,
      path: `${query}.${fieldSegments.join('.')}`,
      query,
      start: access.start,
    },
  ];
}

function refreshedComponentQueryNames(model: ComponentModuleModel): Set<string> {
  return new Set(
    componentOptionObjectEntries(model, 'queries').flatMap((entry) =>
      entry.value?.includes('.refresh(') ? [entry.key] : [],
    ),
  );
}

function shapeAtSegments(
  shape: QueryShape | undefined,
  segments: readonly string[],
): QueryShape | undefined {
  if (shape === undefined || segments.length === 0) return shape;
  const current = unwrapQueryShape(shape);
  if (Array.isArray(current)) return shapeAtSegments(current[0], segments);
  if (!isQueryShapeObject(current)) return undefined;

  const [head, ...tail] = segments;
  if (!head) return current;
  return shapeAtSegments(current[head], tail);
}

function shapeHasVolatileTime(shape: QueryShape | undefined): boolean {
  if (shape === undefined) return false;
  if (isQueryShapeWrapper(shape)) {
    return shape.kind === 'volatile-time' || shapeHasVolatileTime(shape.shape);
  }
  return false;
}

function clockReadFromPropertyAccess(access: PropertyAccessPathModel): ClockRead[] {
  const segments = access.path.split('.').map((segment) => segment.replace(/\?$/, ''));
  if (segments[0] !== 'now') return [];

  const clock = segments[1];
  if (!clock) return [];

  return [
    {
      clock,
      end: access.end,
      path: `now.${clock}`,
      start: access.start,
    },
  ];
}

function dedupeClockReads(reads: readonly ClockRead[]): ClockRead[] {
  return dedupeBy(reads, (read) => `${read.path}\0${read.start}\0${read.end}`);
}

function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function isJsxEventAttributeExpression(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  return jsxElements(model).some((element) =>
    element.attributes.some(
      (attribute) =>
        (attribute.domEventName !== undefined || attribute.executionTriggerName !== undefined) &&
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd,
    ),
  );
}
