import { componentQueryShapes } from '../analyze/query-shapes.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayLength,
  compilerCreateSet,
  compilerFailClosed,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerStringIncludes,
  compilerStringSplit,
} from '../compiler-security-intrinsics.js';
import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
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
  const calls = callExpressions(model);
  const callLength = compilerArrayLength(calls, 'Temporal call expressions');
  for (let callIndex = 0; callIndex < callLength; callIndex += 1) {
    const call = ownArrayEntry(calls, callIndex, 'Temporal call expressions');
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const reads = compilerOwnDataValue(
      call.argumentTemporalReads,
      1,
      'Derive argument temporal reads',
    ) as (typeof call.argumentTemporalReads)[number] | undefined;
    if (!reads) continue;
    const readLength = compilerArrayLength(reads, 'Derive temporal reads');
    for (let readIndex = 0; readIndex < readLength; readIndex += 1) {
      const read = ownArrayEntry(reads, readIndex, 'Derive temporal reads');
      compilerArrayAppend(
        found,
        diagnostics.at(
          'KV315',
          { start: read.start, length: read.end - read.start },
          `${read.kind} in ${call.exportedConstName}`,
        ),
        'Temporal diagnostics',
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

interface SourceSpan {
  end: number;
  start: number;
}

export function validateDeclaredClockReadsInRender(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: Pick<CompileComponentOptions, 'queryShapeFacts' | 'queryShapes' | 'registryFacts'> = {},
): CompilerDiagnostic[] {
  const declaredClocks = compilerCreateSet<string>();
  const clockNames = componentOptionObjectKeys(model, 'clocks');
  const clockNameLength = compilerArrayLength(clockNames, 'Declared clock names');
  for (let index = 0; index < clockNameLength; index += 1) {
    compilerSetAdd(declaredClocks, ownArrayEntry(clockNames, index, 'Declared clock names'));
  }

  const clockSpecs = componentOptionStaticValue(model, 'clocks');
  const renderOnceSpans: SourceSpan[] = [];
  const calls = callExpressions(model);
  const callLength = compilerArrayLength(calls, 'Temporal call expressions');
  for (let index = 0; index < callLength; index += 1) {
    const call = ownArrayEntry(calls, index, 'Temporal call expressions');
    if (call.name === 'renderOnce') {
      compilerArrayAppend(
        renderOnceSpans,
        { end: call.end, start: call.start },
        'renderOnce spans',
      );
    }
  }

  const found: CompilerDiagnostic[] = [];
  const clockReads = renderedClockReads(model);
  const clockReadLength = compilerArrayLength(clockReads, 'Rendered clock reads');
  for (let index = 0; index < clockReadLength; index += 1) {
    const read = ownArrayEntry(clockReads, index, 'Rendered clock reads');
    if (spanContainsRead(renderOnceSpans, read)) continue;
    if (compilerSetHas(declaredClocks, read.clock)) {
      if (clockSpecIsTickDriven(clockSpecs, read.clock)) continue;

      compilerArrayAppend(
        found,
        diagnostics.at(
          'KV312',
          { start: read.start, length: read.end - read.start },
          `now.${read.clock} unsupported cadence`,
        ),
        'Temporal diagnostics',
      );
      continue;
    }

    compilerArrayAppend(
      found,
      diagnostics.at(
        'KV312',
        { start: read.start, length: read.end - read.start },
        `now.${read.clock}`,
      ),
      'Temporal diagnostics',
    );
  }

  const refreshedQueries = refreshedComponentQueryNames(model);
  const volatileReads = renderedVolatileQueryReads(model, options);
  const volatileReadLength = compilerArrayLength(volatileReads, 'Rendered volatile query reads');
  for (let index = 0; index < volatileReadLength; index += 1) {
    const read = ownArrayEntry(volatileReads, index, 'Rendered volatile query reads');
    if (compilerSetHas(refreshedQueries, read.query)) continue;
    if (spanContainsRead(renderOnceSpans, read)) continue;

    compilerArrayAppend(
      found,
      diagnostics.at('KV312', { start: read.start, length: read.end - read.start }, read.path),
      'Temporal diagnostics',
    );
  }

  return found;
}

function spanContainsRead(spans: readonly SourceSpan[], read: SourceSpan): boolean {
  const spanLength = compilerArrayLength(spans, 'renderOnce spans');
  for (let index = 0; index < spanLength; index += 1) {
    const span = ownArrayEntry(spans, index, 'renderOnce spans');
    if (read.start >= span.start && read.end <= span.end) return true;
  }
  return false;
}

function clockSpecIsTickDriven(clockSpecs: unknown, clockName: string): boolean {
  if (!clockSpecs || typeof clockSpecs !== 'object' || compilerArrayIsArray(clockSpecs))
    return false;
  const spec = compilerOwnDataValue(clockSpecs, clockName, 'Clock specifications');
  if (!spec || typeof spec !== 'object' || compilerArrayIsArray(spec)) return false;
  const every = compilerOwnDataValue(spec, 'every', `Clock specification ${clockName}`);
  const renderOnce = compilerOwnDataValue(spec, 'renderOnce', `Clock specification ${clockName}`);
  return typeof every === 'string' || renderOnce === true;
}

function renderedClockReads(model: ComponentModuleModel): ClockRead[] {
  const reads: ClockRead[] = [];
  const expressions = jsxExpressions(model);
  const expressionLength = compilerArrayLength(expressions, 'Temporal JSX expressions');
  for (let expressionIndex = 0; expressionIndex < expressionLength; expressionIndex += 1) {
    const expression = ownArrayEntry(expressions, expressionIndex, 'Temporal JSX expressions');
    if (isJsxEventAttributeExpression(expression, model)) continue;
    const accesses = expression.propertyAccesses;
    const accessLength = compilerArrayLength(accesses, 'Temporal JSX property accesses');
    for (let accessIndex = 0; accessIndex < accessLength; accessIndex += 1) {
      const read = clockReadFromPropertyAccess(
        ownArrayEntry(accesses, accessIndex, 'Temporal JSX property accesses'),
      );
      if (read) compilerArrayAppend(reads, read, 'Rendered clock reads');
    }
  }

  return dedupeBy(reads, clockReadKey, 'Rendered clock reads');
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

  const reads: VolatileQueryRead[] = [];
  const expressions = jsxExpressions(model);
  const expressionLength = compilerArrayLength(expressions, 'Volatile-query JSX expressions');
  for (let expressionIndex = 0; expressionIndex < expressionLength; expressionIndex += 1) {
    const expression = ownArrayEntry(
      expressions,
      expressionIndex,
      'Volatile-query JSX expressions',
    );
    if (isJsxEventAttributeExpression(expression, model)) continue;
    const accesses = expression.propertyAccesses;
    const accessLength = compilerArrayLength(accesses, 'Volatile-query property accesses');
    for (let accessIndex = 0; accessIndex < accessLength; accessIndex += 1) {
      const read = volatileQueryReadFromPropertyAccess(
        ownArrayEntry(accesses, accessIndex, 'Volatile-query property accesses'),
        queryShapes,
      );
      if (read) compilerArrayAppend(reads, read, 'Rendered volatile query reads');
    }
  }

  return dedupeBy(reads, volatileQueryReadKey, 'Rendered volatile query reads');
}

function volatileQueryReadFromPropertyAccess(
  access: PropertyAccessPathModel,
  queryShapes: Record<string, QueryShape>,
): VolatileQueryRead | undefined {
  const segments = normalizedPathSegments(access.path);
  const query = arrayEntryOrUndefined(segments, 0, 'Volatile-query path segments');
  if (!query) return undefined;
  const queryShape = compilerOwnDataValue(queryShapes, query, 'Compiler query shapes') as
    | QueryShape
    | undefined;
  if (queryShape === undefined || segments.length < 2) return undefined;
  if (!shapeHasVolatileTimeAtSegments(queryShape, segments, 1)) return undefined;

  let path = query;
  for (let index = 1; index < segments.length; index += 1) {
    path += `.${ownArrayEntry(segments, index, 'Volatile-query path segments')}`;
  }
  return { end: access.end, path, query, start: access.start };
}

function refreshedComponentQueryNames(model: ComponentModuleModel): Set<string> {
  const refreshed = compilerCreateSet<string>();
  const entries = componentOptionObjectEntries(model, 'queries');
  const entryLength = compilerArrayLength(entries, 'Component query entries');
  for (let index = 0; index < entryLength; index += 1) {
    const entry = ownArrayEntry(entries, index, 'Component query entries');
    if (entry.value && compilerStringIncludes(entry.value, '.refresh(')) {
      compilerSetAdd(refreshed, entry.key);
    }
  }
  return refreshed;
}

function shapeHasVolatileTimeAtSegments(
  shape: QueryShape | undefined,
  segments: readonly string[],
  segmentIndex: number,
): boolean {
  if (shape === undefined) return false;
  if (shapeHasVolatileTime(shape)) return true;
  if (segmentIndex >= segments.length) return false;
  const current = unwrapQueryShape(shape);
  if (compilerArrayIsArray(current)) {
    return shapeHasVolatileTimeAtSegments(
      compilerOwnDataValue(current, 0, 'Volatile-time array query shape') as QueryShape | undefined,
      segments,
      segmentIndex,
    );
  }
  if (!isQueryShapeObject(current)) return false;

  const head = ownArrayEntry(segments, segmentIndex, 'Volatile-query path segments');
  return shapeHasVolatileTimeAtSegments(
    compilerOwnDataValue(current, head, 'Volatile-time object query shape') as
      | QueryShape
      | undefined,
    segments,
    segmentIndex + 1,
  );
}

function shapeHasVolatileTime(shape: QueryShape | undefined): boolean {
  if (shape === undefined || !isQueryShapeWrapper(shape)) return false;
  const kind = compilerOwnDataValue(shape, 'kind', 'Volatile-time query-shape wrapper');
  if (kind === 'volatile-time') return true;
  return shapeHasVolatileTime(
    compilerOwnDataValue(shape, 'shape', 'Volatile-time query-shape wrapper') as QueryShape,
  );
}

function clockReadFromPropertyAccess(access: PropertyAccessPathModel): ClockRead | undefined {
  const segments = normalizedPathSegments(access.path);
  if (arrayEntryOrUndefined(segments, 0, 'Clock-read path segments') !== 'now') return undefined;

  const clock = arrayEntryOrUndefined(segments, 1, 'Clock-read path segments');
  if (!clock) return undefined;
  return { clock, end: access.end, path: `now.${clock}`, start: access.start };
}

function normalizedPathSegments(path: string): string[] {
  const rawSegments = compilerStringSplit(path, '.');
  const segments: string[] = [];
  const rawLength = compilerArrayLength(rawSegments, 'Property-access path segments');
  for (let index = 0; index < rawLength; index += 1) {
    const segment = ownArrayEntry(rawSegments, index, 'Property-access path segments');
    compilerArrayAppend(
      segments,
      compilerRegExpReplace(/\?$/u, segment, ''),
      'Normalized property-access path segments',
    );
  }
  return segments;
}

function clockReadKey(read: ClockRead): string {
  return `${read.path}\0${read.start}\0${read.end}`;
}

function volatileQueryReadKey(read: VolatileQueryRead): string {
  return `${read.path}\0${read.start}\0${read.end}`;
}

function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string, label: string): T[] {
  const seen = compilerCreateSet<string>();
  const result: T[] = [];
  const itemLength = compilerArrayLength(items, label);
  for (let index = 0; index < itemLength; index += 1) {
    const item = ownArrayEntry(items, index, label);
    const key = keyOf(item);
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(result, item, label);
  }
  return result;
}

function isJsxEventAttributeExpression(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Temporal JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = ownArrayEntry(elements, elementIndex, 'Temporal JSX elements');
    const attributes = element.attributes;
    const attributeLength = compilerArrayLength(attributes, 'Temporal JSX attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = ownArrayEntry(attributes, attributeIndex, 'Temporal JSX attributes');
      if (
        (attribute.domEventName !== undefined || attribute.executionTriggerName !== undefined) &&
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd
      ) {
        return true;
      }
    }
  }
  return false;
}

function arrayEntryOrUndefined<T>(
  items: readonly T[],
  index: number,
  label: string,
): T | undefined {
  return compilerOwnDataValue(items, index, label) as T | undefined;
}

function ownArrayEntry<T>(items: readonly T[], index: number, label: string): T {
  const value = arrayEntryOrUndefined(items, index, label);
  if (value === undefined) compilerFailClosed(`${label}[${index}] must be own data.`);
  return value;
}
