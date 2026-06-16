import { diagnosticDefinitions } from '@kovojs/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { componentQueryShapes, queryShapePaths } from '../analyze/query-shapes.js';
import { capturesUnserializableReferences } from '../lower/handlers.js';
import {
  callExpressions,
  componentFragmentTargetNames,
  componentOptionObjectKeys,
  componentRenderInputModels,
  componentStateReturnObjectModel,
  jsxExpressions,
  jsxElementChildBody,
  mutationHandlers,
  type ComponentModuleModel,
  type JsxElementChildBody,
  jsxElements,
} from '../scan/parse.js';
import { dedupeBy, generatedOffsetToOriginal, type SourceOffsetMap } from '../shared.js';
import type { QueryShape, QueryShapeFact, QueryUpdateCoverageFact } from '../types.js';

interface ComponentContractValidationOptions {
  fileName: string;
  queryShapeFacts?: readonly QueryShapeFact[];
  queryShapes?: Record<string, QueryShape>;
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
  sourceOffsetMap: SourceOffsetMap,
): CompilerDiagnostic[] {
  const stateObject = componentStateReturnObjectModel(model);
  const queryNames = componentOptionObjectKeys(model, 'queries');
  if (queryNames.length === 0 || !stateObject || stateObject.entries.length === 0) return [];

  const queryRoots = new Set(queryNames);
  const serverFactEntry = stateObject.entries.find((entry) =>
    entry.valuePropertyAccesses?.some((access) => queryRoots.has(queryRootFromPath(access.path))),
  );
  const access = serverFactEntry?.valuePropertyAccesses?.find((candidate) =>
    queryRoots.has(queryRootFromPath(candidate.path)),
  );
  if (!access) return [];

  const start = generatedOffsetToOriginal(sourceOffsetMap, access.start);
  return [diagnosticFor(fileName, 'KV301', source, start, access.path.length)];
}

export function validateReservedQueryNames(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  return componentOptionObjectKeys(model, 'queries').includes('state')
    ? [
        {
          ...diagnosticFor(fileName, 'KV304', source),
          message: `${diagnosticDefinitions.KV304.message} state`,
        },
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
    ...diagnosticFor(fileName, 'KV303', source, input.start, input.end - input.start),
    message: `${diagnosticDefinitions.KV303.message} ${input.name}`,
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
    fragmentTargetChildBodies(model, name)
      .filter((body) => fragmentTargetChildCapturesUnserializableValue(model, body))
      .map((body) => kv230Diagnostic(fileName, source, name, body)),
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
    ...diagnosticFor(options.fileName, 'KV320', source, payload.index, payload.length),
    message: `${diagnosticDefinitions.KV320.message} ${payload.path}`,
  }));
}

export function validateDirectDbAccess(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const handler of mutationHandlers(model)) {
    const params = handler.paramNames;
    const dbParamIndex = params.indexOf('db');
    const receivesDb = dbParamIndex !== -1;
    const requestParam = params.find(isRequestLikeParamName);
    const requestDb =
      requestParam === undefined
        ? undefined
        : handler.bodyPropertyAccesses.find(
            (access) =>
              access.path === `${requestParam}.db` || access.path.startsWith(`${requestParam}.db.`),
          );

    if (receivesDb) {
      const span = handler.paramSpans[dbParamIndex];
      diagnostics.push(
        diagnosticFor(
          fileName,
          'KV330',
          source,
          span?.start,
          span ? span.end - span.start : undefined,
        ),
      );
      continue;
    }

    if (requestParam && requestDb) {
      const requestDbPath = `${requestParam}.db`;
      diagnostics.push(
        diagnosticFor(fileName, 'KV330', source, requestDb.start, requestDbPath.length),
      );
    }
  }

  return diagnostics;
}

// SPEC §5.2 (KV330): explicit typed predicate over the parsed handler parameter NAME (a
// model-derived identifier, not a raw source slice). Decides whether a parameter is a
// request/context object that could own a `.db` handle. This replaces the inline `/request$/i`
// regex that previously made this decision, while preserving its exact match set: the literal
// names `ctx`/`context`, plus any name whose lower-cased spelling ends in "request".
const requestLikeContextParamNames = new Set(['context', 'ctx']);

function isRequestLikeParamName(param: string | undefined): param is string {
  if (param === undefined) return false;
  if (requestLikeContextParamNames.has(param)) return true;

  return param.toLowerCase().endsWith('request');
}

export function unhandledUpdateCoverageDiagnostics(
  source: string,
  fileName: string,
  updateCoverage: readonly QueryUpdateCoverageFact[],
  sourceOffsetMap: SourceOffsetMap,
): CompilerDiagnostic[] {
  return updateCoverage
    .filter((fact) => fact.status === 'UNHANDLED')
    .map((fact) => kv311Diagnostic(fileName, source, fact, sourceOffsetMap));
}

function fragmentTargetUsageNames(model: ComponentModuleModel): string[] {
  return [...new Set(componentFragmentTargetNames(model))];
}

function fragmentTargetChildBodies(
  model: ComponentModuleModel,
  name: string,
): JsxElementChildBody[] {
  return jsxElements(model)
    .filter((item) => item.tag === name)
    .map((element) => jsxElementChildBody(element))
    .filter((body): body is JsxElementChildBody => body !== null);
}

function fragmentTargetChildCapturesUnserializableValue(
  model: ComponentModuleModel,
  body: JsxElementChildBody,
): boolean {
  const bodyEnd = body.offset + body.source.length;
  const references = jsxExpressions(model)
    .filter((expression) => expression.start >= body.offset && expression.end <= bodyEnd)
    .flatMap((expression) => expression.references);

  return capturesUnserializableReferences(references, {
    additionalAllowedReferences: moduleRenderInputNames(model),
    model,
  });
}

function moduleRenderInputNames(model: ComponentModuleModel): string[] {
  return [
    ...new Set(
      model.components.flatMap((component) => component.renderInputs.map((input) => input.name)),
    ),
  ];
}

function kv230Diagnostic(
  fileName: string,
  source: string,
  target: string,
  body: JsxElementChildBody,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV230;
  const labels = definition.detailLabels;
  return {
    ...diagnosticFor(fileName, 'KV230', source, body.offset, body.source.length),
    help: [
      `${labels.slotHoist} ${target}$slot_children`,
      `${labels.blockedChildren} ${body.source}`,
      definition.help ?? '',
    ].join('\n'),
    message: `${diagnosticDefinitions.KV230.message} ${target}`,
  };
}

function kv311Diagnostic(
  fileName: string,
  source: string,
  fact: QueryUpdateCoverageFact,
  sourceOffsetMap: SourceOffsetMap,
): CompilerDiagnostic {
  const span = fact.sourceSpan;
  const start = generatedOffsetToOriginal(sourceOffsetMap, span?.start);
  return {
    ...diagnosticFor(fileName, 'KV311', source, start, span?.length),
    help: [
      `Coverage classification: ${fact.componentName} ${fact.position} ${fact.status}`,
      `Blocked update: ${fact.detail}`,
      diagnosticDefinitions.KV311.help ?? '',
      'SPEC §4.9 requires every query/state-dependent rendered position to have plan, fragment, isomorphic, or renderOnce coverage.',
    ].join('\n'),
    message: `${diagnosticDefinitions.KV311.message} ${fact.componentName} ${fact.query} ${fact.position}`,
  };
}

function eventPayloads(model: ComponentModuleModel): EventPayloadPath[] {
  const payloads: EventPayloadPath[] = [];

  for (const call of callExpressions(model).filter((item) => item.name === 'emit')) {
    const span = call.argumentSpans[1];
    const paths = call.argumentPropertyAccesses[1]?.map((access) => access.path) ?? [];
    if (paths.length === 0) continue;
    if (!span) continue;

    payloads.push(
      ...paths.map((path) => ({
        index: span.start,
        length: span.end - span.start,
        path,
      })),
    );
  }

  return payloads;
}

function queryRootFromPath(path: string): string {
  return path.split('.', 1)[0] ?? path;
}
