import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { componentQueryShapes, queryShapePaths } from '../analyze/query-shapes.js';
import { capturesUnserializableReferences } from '../lower/handlers.js';
import {
  callExpressions,
  componentDeclaresMutableLocalState,
  componentFragmentTargetNames,
  componentHasInferredFragmentTarget,
  componentOptionObjectKeys,
  componentOptionStaticValue,
  componentHasInferredServerRefreshTarget,
  componentRenderHostElement,
  componentRenderInputModels,
  componentRenderSlots,
  componentStateReturnObjectModel,
  jsxExpressions,
  jsxElementChildBody,
  mutationHandlers,
  type ComponentModel,
  type ComponentModuleModel,
  type JsxElementChildBody,
  type JsxElementModel,
  jsxElements,
  type PropertyAccessPathModel,
  type RenderInputModel,
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

export function validateRemovedFragmentTargetOption(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  return model.components.flatMap((component) =>
    component.options
      .filter((option) => option.key === 'fragmentTarget')
      .map((option) => ({
        ...diagnosticFor(fileName, 'KV223', source, option.start, option.end - option.start),
        help: [
          'Would lower to: an inferred server-refresh target for a query-backed component.',
          'Blocked reason: fragmentTarget is no longer an author-facing component option; query dependencies now derive refresh targets.',
          'Fixes: remove fragmentTarget, declare queries for refreshable server data, or set disableServerRefresh: true to force the component off the enhanced server-refresh path.',
          'SPEC §4.8 keeps runtime stamps compiler-derived and SPEC §4.9 classifies inferred query-backed refresh coverage.',
          'Escape: emitted compiler artifacts may carry kovo-fragment-target hooks; app TSX should not force targets by option.',
        ].join('\n'),
        message:
          'Redundant removed component option; query-backed components infer server refresh targets. fragmentTarget',
      })),
  );
}

export function validateHandAuthoredFragmentTargetStamp(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (!componentHasInferredServerRefreshTarget(model)) return [];

  const host = componentRenderHostElement(model);
  const attribute = host?.attributes.find((item) => item.name === 'kovo-fragment-target');
  if (!attribute) return [];

  return [
    {
      ...diagnosticFor(fileName, 'KV223', source, attribute.start, attribute.end - attribute.start),
      help: [
        'Would lower to: the same kovo-fragment-target hook the compiler derives for a query-backed component root.',
        'Blocked reason: the stamp is redundant in app-authored TSX because the compiler can derive the live server-refresh target from queries and component identity.',
        'Fixes: remove the hand-written kovo-fragment-target attribute, keep declared queries as the source of truth, or set disableServerRefresh: true if the component should not be live-refreshable.',
        'SPEC §4.8 permits residual stamps for emitted IR fixpoint validation, but app TSX should not hand-author derivable runtime hooks.',
        'Escape: emitted compiler artifacts may retain kovo-fragment-target for the runtime Kovo-Targets wire.',
      ].join('\n'),
      message:
        'Redundant hand-written fragment target stamp in sugar; the compiler derives it. kovo-fragment-target',
    },
  ];
}

export function validateFragmentTargetInputs(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const validatesFragmentTarget = componentFragmentTargetNames(model).length > 0;
  const validatesIsomorphicIsland = componentOptionStaticValue(model, 'isomorphic') === true;
  if (!validatesFragmentTarget && !validatesIsomorphicIsland) return [];

  const allowedInputs = declaredRenderInputRoots(model, validatesIsomorphicIsland);
  const renderInputs = componentRenderInputModels(model);
  const missingInputs = renderInputs.filter((input) => !allowedInputs.has(input.name));
  const missingIsomorphicReads = validatesIsomorphicIsland
    ? isomorphicRenderReads(model).filter((input) => !allowedInputs.has(input.name))
    : [];

  return dedupeBy([...missingInputs, ...missingIsomorphicReads], (input) => input.name).map(
    (input) => ({
      ...diagnosticFor(fileName, 'KV303', source, input.start, input.end - input.start),
      message: `${diagnosticDefinitions.KV303.message} ${input.name}`,
    }),
  );
}

function declaredRenderInputRoots(model: ComponentModuleModel, includeState: boolean): Set<string> {
  return new Set([
    ...componentOptionObjectKeys(model, 'queries'),
    ...componentOptionObjectKeys(model, 'props'),
    ...model.moduleScopeBindings.map((binding) => binding.name),
    // SPEC §4.8/§4.9: `now` is the compiler-owned clock input; KV312 validates names.
    'now',
    ...(includeState ? ['state'] : []),
  ]);
}

function isomorphicRenderReads(model: ComponentModuleModel): RenderInputModel[] {
  return jsxExpressions(model)
    .filter((expression) => !isJsxEventAttributeExpression(expression, model))
    .flatMap((expression) => expression.propertyAccesses.map(renderInputFromPropertyAccessRoot));
}

function renderInputFromPropertyAccessRoot(access: PropertyAccessPathModel): RenderInputModel {
  const [root = access.path] = access.path.split('.');
  return {
    end: access.start + root.length,
    name: root,
    start: access.start,
  };
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

// SPEC §4.5/§4.8 (KV316): a client self-render binds no slot/children arguments — projected
// children ship once in the initial HTML — so an `isomorphic: true` island that composes children
// or named slots would re-render those regions as fresh Html and drift from the server output.
// The partitioned self-morph that would preserve them is not modeled, so any children/slot-accepting
// isomorphic component is rejected (drop isomorphic: true, hoist the children per KV230, or move the
// dynamic part outside the slot).
export function validateIsomorphicSlotComposition(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  if (componentOptionStaticValue(model, 'isomorphic') !== true) return [];

  const slots = componentRenderSlots(model);
  if (!slots) return [];

  return [
    {
      ...diagnosticFor(fileName, 'KV316', source, slots.start, slots.end - slots.start),
      message:
        slots.names.length > 0
          ? `${diagnosticDefinitions.KV316.message} ${slots.names.join(', ')}`
          : diagnosticDefinitions.KV316.message,
    },
  ];
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

// SPEC §4.5/§4.9/§9.1 (KV420): a fragment morph carries no serialization of island-local
// `kovo-state`, so when a parent's inferred server-refreshable target re-renders its full subtree
// from (declared queries ∪ stamped props), any nested island that declares mutable local `state` is
// re-emitted at its render-time default and its live value is clobbered. The compiler therefore
// forbids the position: an island declaring local `state` may not render inside another component's
// server-refreshable fragment target.
//
// SCOPE (same-module): this validator resolves child component tags inside a refresh target only
// against sibling components declared in the SAME module — `RegistryFacts.components` carries no
// per-component "declares-local-state" fact, so a stateful child imported from another module cannot
// be classified here. The cross-module case is intentionally left for a registry-facts extension
// (see the F39/KV420 plan note); a precise same-module rule is preferred over a broad one that would
// false-positive on imported components whose state we cannot see.
export function validateNestedStatefulIslandInRefreshTarget(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const statefulSiblingsByName = new Map<string, ComponentModel>();
  for (const component of model.components) {
    if (component.localName === undefined) continue;
    if (componentDeclaresMutableLocalState(component, model)) {
      statefulSiblingsByName.set(component.localName, component);
    }
  }
  if (statefulSiblingsByName.size === 0) return [];

  const diagnostics: CompilerDiagnostic[] = [];
  for (const parent of model.components) {
    if (!componentHasInferredFragmentTarget(parent)) continue;

    for (const childTag of componentRefreshTargetChildComponentTags(model, parent)) {
      const childComponent = statefulSiblingsByName.get(childTag.tag);
      // A component never trips KV420 against its own recursive render-time reference.
      if (!childComponent || childComponent.localName === parent.localName) continue;

      diagnostics.push({
        ...diagnosticFor(
          fileName,
          'KV420',
          source,
          childTag.openingTagNameStart,
          childTag.openingTagNameEnd - childTag.openingTagNameStart,
        ),
        message: `${diagnosticDefinitions.KV420.message} ${childTag.tag} inside ${
          parent.localName ?? 'the enclosing'
        }.`,
      });
    }
  }

  return diagnostics;
}

// Capitalized child component references nested strictly inside a parent's render subtree — the
// subtree the inferred server-refresh target morphs. Scoped by the parent's declaration source span;
// the parent's own render host root tag is excluded (only descendants are server-refreshed
// positions), as is any tag that is not a component reference (`/^[A-Z]/`, SPEC §4.5 lowering).
function componentRefreshTargetChildComponentTags(
  model: ComponentModuleModel,
  parent: ComponentModel,
): JsxElementModel[] {
  // Precise span attribution requires the component's declaration bounds; without a localNameSpan we
  // cannot tell this parent's render JSX from a sibling's, so we skip rather than over-attribute.
  if (parent.localNameSpan === undefined) return [];

  const spanStart = parent.localNameSpan.start;
  const spanEnd = parent.declarationEnd;
  const hostStart = parent.renderHost?.start;

  return jsxElements(model).filter(
    (element) =>
      element.start >= spanStart &&
      element.end <= spanEnd &&
      element.start !== hostStart &&
      isComponentReferenceTag(element.tag),
  );
}

function isComponentReferenceTag(tag: string): boolean {
  return /^[A-Z]/.test(tag);
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
      [
        'Would lower to: a data-bind/update plan, inferred query-backed fragment target, isomorphic component, or renderOnce marker for the rendered position.',
        'Blocked reason: the query/state expression is outside the current §4.8 update-plan grammar and is not inside an inferred server-refresh target.',
        'Fixes: add a data-bind/query update plan, extract a derive/stamp, keep the component query-backed for inferred fragment refresh, mark it isomorphic, declare renderOnce, or set disableServerRefresh: true only when no enhanced refresh is intended.',
        'SPEC §4.9 requires every query/state-dependent rendered position to have plan, fragment, isomorphic, or renderOnce coverage.',
      ].join('\n'),
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
