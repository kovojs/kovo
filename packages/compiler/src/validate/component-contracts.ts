import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { capturesUnserializableValue } from '../lower/handlers.js';
import {
  callExpressions,
  componentFragmentTargetNames,
  componentOptionObjectKeys,
  componentOptionSource,
  componentRenderInputModels,
  componentStateReturnObjectModel,
  componentStateReturnObjectKeys,
  mutationHandlers,
  objectLiteralPropertyPaths,
  type ComponentModuleModel,
  jsxElements,
} from '../scan/parse.js';
import { dedupeBy } from '../shared.js';
import type {
  QueryShape,
  QueryShapeFact,
  QueryShapeWrapper,
  QueryUpdateCoverageFact,
} from '../types.js';
import { queryUpdateCoverageSpan } from './bindings.js';

interface ComponentContractValidationOptions {
  fileName: string;
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
}

interface TemplateBody {
  offset: number;
  source: string;
}

interface EventPayloadPath {
  index: number;
  length: number;
  path: string;
}

// SPEC 5.2: query data is shared/server-owned; island-local state is private/client-owned.
export function validateServerFactsInLocalState(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const queryObject = componentOptionSource(model, 'queries');
  const stateObject = componentStateReturnObjectModel(model);
  if (!queryObject || !stateObject) return [];

  const queryNames = componentOptionObjectKeys(model, 'queries');
  const stateKeys = componentStateReturnObjectKeys(model);
  if (queryNames.length === 0 || stateKeys.length === 0) return [];

  const storesServerFact = stateKeys.some((stateKey) =>
    queryNames.some((queryName) => stateKeyHasQueryPrefix(stateKey, queryName)),
  );

  return storesServerFact
    ? [
        diagnosticFor(
          fileName,
          'FW301',
          source,
          stateObject.start,
          stateObject.end - stateObject.start,
        ),
      ]
    : [];
}

export function validateFragmentTargetInputs(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (componentFragmentTargetNames(model).length === 0) return [];

  const allowedInputs = new Set([
    ...componentOptionObjectKeys(model, 'queries'),
    ...componentOptionObjectKeys(model, 'props'),
  ]);
  const renderInputs = componentRenderInputModels(model);
  if (renderInputs.length === 0) return [];

  const missing = renderInputs.filter((input) => !allowedInputs.has(input.name));
  return missing.map((input) => ({
    ...diagnosticFor(fileName, 'FW303', source, input.start, input.end - input.start),
    message: `${diagnosticDefinitions.FW303.message} ${input.name}`,
  }));
}

export function validateFragmentTargetChildren(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const targetNames = fragmentTargetUsageNames(model);
  if (targetNames.length === 0) return [];

  return targetNames.flatMap((name) =>
    fragmentTargetChildBodies(source, model, name)
      .filter((body) => capturesUnserializableValue(body.source))
      .map((body) => fw230Diagnostic(fileName, source, name, body)),
  );
}

export function validateEventPayloads(
  source: string,
  model: ComponentModuleModel,
  options: ComponentContractValidationOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const queryPaths = new Set(queryShapePaths(queryShapes));
  const overlapping = eventPayloads(model).filter((payload) => queryPaths.has(payload.path));
  if (overlapping.length === 0) return [];

  return dedupeBy(overlapping, (payload) => payload.path).map((payload) => ({
    ...diagnosticFor(options.fileName, 'FW320', source, payload.index, payload.length),
    message: `${diagnosticDefinitions.FW320.message} ${payload.path}`,
  }));
}

export function validateDirectDbAccess(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (!/\bmutation\s*\(/.test(source)) return [];

  const diagnostics: CompilerDiagnostic[] = [];

  for (const handler of mutationHandlers(model)) {
    const params = handler.params.map(readParameterName).filter(Boolean);
    const dbParamIndex = params.indexOf('db');
    const receivesDb = dbParamIndex !== -1;
    const requestParam = params.find(
      (param) =>
        param === 'request' || /request$/i.test(param) || param === 'ctx' || param === 'context',
    );
    const requestDb = requestParam
      ? new RegExp(`\\b${escapeRegExp(requestParam)}\\.db\\b`).exec(handler.body)
      : null;
    const readsRequestDb =
      requestParam !== undefined && requestDb !== null && requestDb.index !== undefined;

    if (receivesDb) {
      const span = handler.paramSpans[dbParamIndex];
      diagnostics.push(
        diagnosticFor(
          fileName,
          'FW330',
          source,
          span?.start,
          span ? span.end - span.start : undefined,
        ),
      );
      continue;
    }

    if (readsRequestDb) {
      const index = handler.bodyStart + (requestDb?.index ?? 0);
      diagnostics.push(diagnosticFor(fileName, 'FW330', source, index, requestDb?.[0].length));
    }
  }

  return diagnostics;
}

export function unhandledUpdateCoverageDiagnostics(
  source: string,
  fileName: string,
  updateCoverage: readonly QueryUpdateCoverageFact[],
): CompilerDiagnostic[] {
  return updateCoverage
    .filter((fact) => fact.status === 'UNHANDLED')
    .map((fact) => fw311Diagnostic(fileName, source, fact));
}

function fragmentTargetUsageNames(model: ComponentModuleModel): string[] {
  return [...new Set(componentFragmentTargetNames(model))];
}

function fragmentTargetChildBodies(
  source: string,
  model: ComponentModuleModel,
  name: string,
): TemplateBody[] {
  const bodies: TemplateBody[] = [];

  for (const element of jsxElements(model).filter((item) => item.tag === name)) {
    if (element.selfClosing) continue;

    const raw = source.slice(element.openingEnd, element.closingStart);
    const leadingWhitespace = /^\s*/.exec(raw)?.[0].length ?? 0;
    const body = raw.trim();
    if (body) {
      bodies.push({
        offset: element.openingEnd + leadingWhitespace,
        source: body,
      });
    }
  }

  return bodies;
}

function fw230Diagnostic(
  fileName: string,
  source: string,
  target: string,
  body: TemplateBody,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.FW230;
  const labels = definition.detailLabels;
  return {
    ...diagnosticFor(fileName, 'FW230', source, body.offset, body.source.length),
    help: [
      `${labels.slotHoist} ${target}$slot_children`,
      `${labels.blockedChildren} ${body.source}`,
      definition.help ?? '',
    ].join('\n'),
    message: `${diagnosticDefinitions.FW230.message} ${target}`,
  };
}

function componentQueryShapes(
  options: ComponentContractValidationOptions,
): Record<string, QueryShape> | null {
  return (
    options.queryShapes ??
    (options.queryShapeFacts ? queryShapesFromFacts(options.queryShapeFacts) : null)
  );
}

function queryShapesFromFacts(facts: readonly QueryShapeFact[]): Record<string, QueryShape> {
  return Object.fromEntries(facts.map((fact) => [fact.query, fact.shape]));
}

function fw311Diagnostic(
  fileName: string,
  source: string,
  fact: QueryUpdateCoverageFact,
): CompilerDiagnostic {
  const span = queryUpdateCoverageSpan(fact);
  return {
    ...diagnosticFor(fileName, 'FW311', source, span?.start, span?.length),
    message: `${diagnosticDefinitions.FW311.message} ${fact.componentName} ${fact.query} ${fact.position}`,
  };
}

function readParameterName(param: string): string {
  const withoutType = param.split(':')[0]?.trim() ?? '';
  return withoutType.replace(/^[.{\s]+|[}\s]+$/g, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function eventPayloads(model: ComponentModuleModel): EventPayloadPath[] {
  const payloads: EventPayloadPath[] = [];

  for (const call of callExpressions(model).filter((item) => item.name === 'emit')) {
    const payload = call.arguments[1]?.trim();
    if (!payload?.startsWith('{')) continue;
    const span = call.argumentSpans[1];
    if (!span) continue;

    payloads.push(
      ...objectLiteralPropertyPaths('payload.tsx', payload).map((path) => ({
        index: span.start,
        length: span.end - span.start,
        path,
      })),
    );
  }

  return payloads;
}

function queryShapePaths(queryShapes: Record<string, QueryShape>): string[] {
  return Object.entries(queryShapes).flatMap(([queryName, shape]) => [
    queryName,
    ...queryShapeChildPaths(shape).flatMap((path) => [`${queryName}.${path}`, path]),
  ]);
}

function queryShapeChildPaths(shape: QueryShape): string[] {
  const current = unwrapQueryShape(shape);
  if (isArrayShape(current)) {
    const itemShape = current[0];
    return itemShape === undefined ? [] : queryShapeChildPaths(itemShape);
  }

  if (!isQueryShapeObject(current)) return [];

  return Object.entries(current).flatMap(([key, child]) => [
    key,
    ...queryShapeChildPaths(child ?? 'object').map((path) => `${key}.${path}`),
  ]);
}

function stateKeyHasQueryPrefix(stateKey: string, queryName: string): boolean {
  if (stateKey === queryName) return true;
  if (!stateKey.startsWith(queryName)) return false;

  const nextChar = stateKey[queryName.length];
  return nextChar !== undefined && /[A-Z0-9_$]/.test(nextChar);
}

function isArrayShape(shape: QueryShape): shape is readonly QueryShape[] {
  return Array.isArray(shape);
}

function unwrapQueryShape(shape: QueryShape): QueryShape {
  let current = shape;
  while (isQueryShapeWrapper(current)) current = current.shape;
  return current;
}

function isQueryShapeWrapper(shape: QueryShape): shape is QueryShapeWrapper {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return false;
  const record = shape as Record<string, unknown>;
  return (record.kind === 'nullable' || record.kind === 'optional') && 'shape' in shape;
}

function isQueryShapeObject(shape: QueryShape): shape is { readonly [key: string]: QueryShape } {
  return (
    typeof shape === 'object' &&
    shape !== null &&
    !Array.isArray(shape) &&
    !isQueryShapeWrapper(shape)
  );
}
