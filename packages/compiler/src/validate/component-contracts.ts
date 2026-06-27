import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import { componentQueryShapes, queryShapePaths } from '../analyze/query-shapes.js';
import { componentRegistryNamespace } from '../component-names.js';
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
  type NamedImportModel,
  type PropertyAccessPathModel,
  type RenderInputModel,
} from '../scan/parse.js';
import { dedupeBy, kebabCase } from '../shared.js';
import type {
  CompileComponentOptions,
  QueryShape,
  QueryShapeFact,
  QueryUpdateCoverageFact,
} from '../types.js';

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
// The factory maps `access.start` (a generated/lowered offset) back onto the original source.
export function validateServerFactsInLocalState(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
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

  return [diagnostics.at('KV301', { start: access.start, length: access.path.length })];
}

export function validateReservedQueryNames(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  return componentOptionObjectKeys(model, 'queries').includes('state')
    ? [diagnostics.at('KV304', undefined, 'state')]
    : [];
}

export function validateRemovedFragmentTargetOption(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  return model.components.flatMap((component) =>
    component.options
      .filter((option) => option.key === 'fragmentTarget')
      .map((option) => ({
        ...diagnostics.at('KV223', { start: option.start, length: option.end - option.start }),
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
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  if (!componentHasInferredServerRefreshTarget(model)) return [];

  const host = componentRenderHostElement(model);
  const attribute = host?.attributes.find((item) => item.name === 'kovo-fragment-target');
  if (!attribute) return [];

  return [
    {
      ...diagnostics.at('KV223', {
        start: attribute.start,
        length: attribute.end - attribute.start,
      }),
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
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
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
    (input) => kv303RenderInputDiagnostic(diagnostics, allowedInputs, input),
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
  const renderLocalNames = new Set(
    model.components.flatMap((component) => component.renderLocalNames),
  );

  return jsxExpressions(model)
    .filter((expression) => !isJsxEventAttributeExpression(expression, model))
    .flatMap((expression) => {
      const expressionLocalNames = new Set(expression.localNames);
      return expression.propertyAccesses
        .map(renderInputFromPropertyAccessRoot)
        .filter(
          (input) => !expressionLocalNames.has(input.name) && !renderLocalNames.has(input.name),
        );
    });
}

function renderInputFromPropertyAccessRoot(access: PropertyAccessPathModel): RenderInputModel {
  const [root = access.path] = access.path.split('.');
  return {
    end: access.start + root.length,
    name: root,
    start: access.start,
  };
}

function kv303RenderInputDiagnostic(
  diagnostics: DiagnosticFactory,
  allowedInputs: ReadonlySet<string>,
  input: RenderInputModel,
): CompilerDiagnostic {
  const span = { start: input.start, length: input.end - input.start };
  if (
    input.sourceKey !== undefined &&
    input.sourceKey !== input.name &&
    allowedInputs.has(input.sourceKey)
  ) {
    return {
      ...diagnostics.at('KV303', span, input.name),
      help: [
        'Would lower to: a fragment target that can be re-rendered from declared query data plus stamped props.',
        'Blocked reason: render destructuring renamed a declared query/prop key, but fragment refresh and binding coverage use the declared key as the reconstructible channel.',
        `Fixes: destructure the declared key as "${input.sourceKey}" in render, stamp "${input.name}" as a serializable prop, or move the aliasing into a render-local const after destructuring the declared key.`,
        'SPEC §4.5 requires fragment targets to be reconstructible from declared server inputs.',
      ].join('\n'),
      message: `${diagnostics.at('KV303').message} ${input.name} (render destructuring aliases declared key ${input.sourceKey}; use the declared key name in the render parameter)`,
    };
  }

  return diagnostics.at('KV303', span, input.name);
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
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  if (componentOptionStaticValue(model, 'isomorphic') !== true) return [];

  const slots = componentRenderSlots(model);
  if (!slots) return [];

  return [
    diagnostics.at(
      'KV316',
      { start: slots.start, length: slots.end - slots.start },
      slots.names.length > 0 ? slots.names.join(', ') : undefined,
    ),
  ];
}

export function validateFragmentTargetChildren(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const targetNames = fragmentTargetUsageNames(model);
  if (targetNames.length === 0) return [];

  return targetNames.flatMap((name) =>
    fragmentTargetChildBodies(model, name)
      .filter((body) => fragmentTargetChildCapturesUnserializableValue(model, body))
      .map((body) => kv230Diagnostic(diagnostics, name, body)),
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
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: Pick<CompileComponentOptions, 'fileName' | 'registryFacts'>,
): CompilerDiagnostic[] {
  const statefulSiblingsByName = new Map<string, ComponentModel>();
  for (const component of model.components) {
    if (component.localName === undefined) continue;
    if (componentDeclaresMutableLocalState(component, model)) {
      statefulSiblingsByName.set(component.localName, component);
    }
  }
  const statefulImportsByName = importedStatefulComponentsByLocalName(model, options);
  if (statefulSiblingsByName.size === 0 && statefulImportsByName.size === 0) return [];

  const found: CompilerDiagnostic[] = [];
  for (const parent of model.components) {
    if (!componentHasInferredFragmentTarget(parent)) continue;

    for (const childTag of componentRefreshTargetChildComponentTags(model, parent)) {
      const childComponent = statefulSiblingsByName.get(childTag.tag);
      // A component never trips KV420 against its own recursive render-time reference.
      if (childComponent?.localName === parent.localName) continue;
      const childName = childComponent
        ? childTag.tag
        : (statefulImportsByName.get(childTag.tag) ?? null);
      if (!childName) continue;

      found.push(
        diagnostics.at(
          'KV420',
          {
            start: childTag.openingTagNameStart,
            length: childTag.openingTagNameEnd - childTag.openingTagNameStart,
          },
          `${childName} inside ${parent.localName ?? 'the enclosing'}.`,
        ),
      );
    }
  }

  return found;
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

function importedStatefulComponentsByLocalName(
  model: ComponentModuleModel,
  options: Pick<CompileComponentOptions, 'fileName' | 'registryFacts'>,
): Map<string, string> {
  const statefulComponents = new Set(options.registryFacts?.statefulComponents ?? []);
  if (statefulComponents.size === 0) return new Map();

  const found = new Map<string, string>();
  for (const namedImport of model.namedImports) {
    const registryName = importedComponentRegistryName(options.fileName, namedImport);
    if (!registryName || !statefulComponents.has(registryName)) continue;
    found.set(namedImport.localName, namedImport.localName);
  }
  return found;
}

function importedComponentRegistryName(
  fileName: string,
  namedImport: NamedImportModel,
): string | null {
  if (!namedImport.moduleSpecifier.startsWith('.')) return null;
  const modulePath = resolveRelativeModulePath(fileName, namedImport.moduleSpecifier);
  if (!modulePath) return null;

  const namespace = componentRegistryNamespace(modulePath);
  const domName = kebabCase(namedImport.importedName);
  return namespace ? `${namespace}/${domName}` : domName;
}

function resolveRelativeModulePath(fileName: string, specifier: string): string | null {
  const base = fileName.replaceAll('\\', '/').split('/').slice(0, -1);
  const parts = [...base, ...specifier.replaceAll('\\', '/').split('/')];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

export function validateEventPayloads(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: ComponentContractValidationOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const queryPaths = new Set(queryShapePaths(queryShapes));
  const overlapping = eventPayloads(model).filter((payload) => queryPaths.has(payload.path));
  if (overlapping.length === 0) return [];

  return dedupeBy(overlapping, (payload) => payload.path).map((payload) =>
    diagnostics.at('KV320', { start: payload.index, length: payload.length }, payload.path),
  );
}

export function validateDirectDbAccess(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];

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
      found.push(
        diagnostics.at('KV330', {
          start: span?.start,
          length: span ? span.end - span.start : undefined,
        }),
      );
      continue;
    }

    if (requestParam && requestDb) {
      const requestDbPath = `${requestParam}.db`;
      found.push(diagnostics.at('KV330', { start: requestDb.start, length: requestDbPath.length }));
    }
  }

  return found;
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
  diagnostics: DiagnosticFactory,
  updateCoverage: readonly QueryUpdateCoverageFact[],
): CompilerDiagnostic[] {
  return updateCoverage
    .filter((fact) => fact.status === 'UNHANDLED')
    .map((fact) => kv311Diagnostic(diagnostics, fact));
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
  diagnostics: DiagnosticFactory,
  target: string,
  body: JsxElementChildBody,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV230;
  const labels = definition.detailLabels;
  return {
    ...diagnostics.at('KV230', { start: body.offset, length: body.source.length }, target),
    help: [
      `${labels.slotHoist} ${target}$slot_children`,
      `${labels.blockedChildren} ${body.source}`,
      definition.help ?? '',
    ].join('\n'),
  };
}

function kv311Diagnostic(
  diagnostics: DiagnosticFactory,
  fact: QueryUpdateCoverageFact,
): CompilerDiagnostic {
  const span = fact.sourceSpan;
  return {
    ...diagnostics.at(
      'KV311',
      { start: span?.start, length: span?.length },
      `${fact.componentName} ${fact.query} ${fact.position}`,
    ),
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
