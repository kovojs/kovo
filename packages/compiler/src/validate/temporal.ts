import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import { componentQueryShapes } from '../analyze/query-shapes.js';
import {
  callExpressions,
  componentOptionObjectEntries,
  componentOptionObjectKeys,
  componentOptionStaticValue,
  jsxElements,
  jsxExpressions,
  type ComponentModuleModel,
  type PropertyAccessPathModel,
} from '../scan/parse.js';
import type { CompileComponentOptions, QueryShape } from '../types.js';
import { isQueryShapeObject, isQueryShapeWrapper, unwrapQueryShape } from '../types.js';

export function validateUntrackedClockReadsInDerives(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

  for (const call of callExpressions(model)) {
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const reads = call.argumentTemporalReads[1] ?? [];
    for (const read of reads) {
      found.push(
        diagnostics.at(
          'KV315',
          { start: read.start, length: read.end - read.start },
          `${read.kind} in ${call.exportedConstName}`,
        ),
      );
    }
  }

  return found;
}

interface ClockRead {
  clock: string;
  end: number;
  path: string;
  start: number;
}

export function validateDeclaredClockReadsInRender(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: Pick<CompileComponentOptions, 'queryShapeFacts' | 'queryShapes' | 'registryFacts'> = {},
): CompilerDiagnostic[] {
  const declaredClocks = new Set(componentOptionObjectKeys(model, 'clocks'));
  const clockSpecs = componentOptionStaticValue(model, 'clocks');
  const renderOnceSpans = callExpressions(model)
    .filter((call) => call.name === 'renderOnce')
    .map((call) => ({ end: call.end, start: call.start }));
  const found: CompilerDiagnostic[] = [];

  for (const read of renderedClockReads(model)) {
    if (renderOnceSpans.some((span) => read.start >= span.start && read.end <= span.end)) continue;
    if (declaredClocks.has(read.clock)) {
      if (clockSpecIsTickDriven(clockSpecs, read.clock)) continue;

      found.push(
        diagnostics.at(
          'KV312',
          { start: read.start, length: read.end - read.start },
          `now.${read.clock} unsupported cadence`,
        ),
      );
      continue;
    }

    found.push(
      diagnostics.at(
        'KV312',
        { start: read.start, length: read.end - read.start },
        `now.${read.clock}`,
      ),
    );
  }

  const refreshedQueries = refreshedComponentQueryNames(model);
  for (const read of renderedVolatileQueryReads(model, options)) {
    if (refreshedQueries.has(read.query)) continue;
    if (renderOnceSpans.some((span) => read.start >= span.start && read.end <= span.end)) continue;

    found.push(
      diagnostics.at('KV312', { start: read.start, length: read.end - read.start }, read.path),
    );
  }

  return found;
}

function clockSpecIsTickDriven(clockSpecs: unknown, clockName: string): boolean {
  if (!clockSpecs || typeof clockSpecs !== 'object' || Array.isArray(clockSpecs)) return false;
  const spec = (clockSpecs as Record<string, unknown>)[clockName];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return false;
  const fields = spec as Record<string, unknown>;
  return typeof fields.every === 'string' || fields.renderOnce === true;
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
  if (!shapeHasVolatileTimeAtSegments(queryShapes[query], fieldSegments)) return [];

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

function shapeHasVolatileTimeAtSegments(
  shape: QueryShape | undefined,
  segments: readonly string[],
): boolean {
  if (shape === undefined) return false;
  if (shapeHasVolatileTime(shape)) return true;
  if (segments.length === 0) return false;
  const current = unwrapQueryShape(shape);
  if (Array.isArray(current)) return shapeHasVolatileTimeAtSegments(current[0], segments);
  if (!isQueryShapeObject(current)) return false;

  const [head, ...tail] = segments;
  if (!head) return false;
  return shapeHasVolatileTimeAtSegments(current[head], tail);
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
