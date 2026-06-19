import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import {
  callExpressions,
  componentOptionObjectKeys,
  jsxElements,
  jsxExpressions,
  type ComponentModuleModel,
  type PropertyAccessPathModel,
} from '../scan/parse.js';

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

  return diagnostics;
}

function renderedClockReads(model: ComponentModuleModel): ClockRead[] {
  const reads = jsxExpressions(model)
    .filter((expression) => !isJsxEventAttributeExpression(expression, model))
    .flatMap((expression) => expression.propertyAccesses.flatMap(clockReadFromPropertyAccess));

  return dedupeClockReads(reads);
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
  const seen = new Set<string>();
  const result: ClockRead[] = [];

  for (const read of reads) {
    const key = `${read.path}\0${read.start}\0${read.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(read);
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
