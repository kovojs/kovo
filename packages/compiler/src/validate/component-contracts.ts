import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerFailClosed,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetHas,
  compilerStringIndexOf,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
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
  componentRenderHostElementFor,
  componentRenderInputModels,
  componentRenderSlots,
  componentStateReturnObjectModel,
  handlerWriteSinks,
  jsxExpressions,
  jsxElementChildBody,
  type ComponentModel,
  type ComponentModuleModel,
  type HandlerWriteSinkFact,
  type JsxElementChildBody,
  type JsxElementModel,
  jsxElements,
  type NamedImportModel,
  type PropertyAccessPathModel,
  type RenderInputModel,
  type SourceSpan,
  type WebhookRecordChangeFact,
  webhookHandlers,
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
  const queryNameLength = compilerArrayLength(queryNames, 'Local-state query names');
  if (queryNameLength === 0 || !stateObject) return [];
  const entryLength = compilerArrayLength(stateObject.entries, 'Local-state entries');
  if (entryLength === 0) return [];

  const queryRoots = compilerCreateSet<string>();
  for (let index = 0; index < queryNameLength; index += 1) {
    const query = compilerOwnDataValue(queryNames, index, 'Local-state query names');
    if (typeof query !== 'string') {
      compilerFailClosed(`Local-state query names[${index}] must be an own string.`);
    }
    compilerSetAdd(queryRoots, query);
  }
  for (let entryIndex = 0; entryIndex < entryLength; entryIndex += 1) {
    const entry = compilerOwnDataValue(stateObject.entries, entryIndex, 'Local-state entries');
    if (!entry || typeof entry !== 'object') {
      compilerFailClosed(`Local-state entries[${entryIndex}] must be own data.`);
    }
    const accesses = (entry as { valuePropertyAccesses?: readonly PropertyAccessPathModel[] })
      .valuePropertyAccesses;
    if (!accesses) continue;
    const accessLength = compilerArrayLength(accesses, `Local-state entry ${entryIndex} accesses`);
    for (let accessIndex = 0; accessIndex < accessLength; accessIndex += 1) {
      const access = compilerOwnDataValue(
        accesses,
        accessIndex,
        `Local-state entry ${entryIndex} accesses`,
      ) as PropertyAccessPathModel | undefined;
      if (!access) {
        compilerFailClosed(
          `Local-state entry ${entryIndex} accesses[${accessIndex}] must be own data.`,
        );
      }
      if (!compilerSetHas(queryRoots, queryRootFromPath(access.path))) continue;
      return [diagnostics.at('KV301', { start: access.start, length: access.path.length })];
    }
  }
  return [];
}

export function validateReservedQueryNames(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  return denseStringArrayIncludes(
    componentOptionObjectKeys(model, 'queries'),
    'state',
    'Reserved query names',
  )
    ? [diagnostics.at('KV304', undefined, 'state')]
    : [];
}

export function validateIsomorphicJustifications(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const componentLength = compilerArrayLength(model.components, 'Isomorphic components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = ownArrayEntry(model.components, componentIndex, 'Isomorphic components');
    const option = componentOption(component, 'isomorphic');
    if (option?.staticValue !== true) continue;
    if (
      option.justifiedDiagnostics &&
      denseStringArrayIncludes(
        option.justifiedDiagnostics,
        'KV318',
        'Isomorphic justified diagnostics',
      )
    ) {
      continue;
    }
    compilerArrayAppend(
      found,
      diagnostics.at('KV318', { start: option.start, length: option.end - option.start }),
      'Isomorphic justification diagnostics',
    );
  }
  return found;
}

export function validateRemovedFragmentTargetOption(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const componentLength = compilerArrayLength(model.components, 'Fragment-target components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = ownArrayEntry(model.components, componentIndex, 'Fragment-target components');
    const optionLength = compilerArrayLength(component.options, 'Fragment-target options');
    for (let optionIndex = 0; optionIndex < optionLength; optionIndex += 1) {
      const option = ownArrayEntry(component.options, optionIndex, 'Fragment-target options');
      if (option.key !== 'fragmentTarget') continue;
      compilerArrayAppend(
        found,
        {
          ...diagnostics.at('KV223', { start: option.start, length: option.end - option.start }),
          help: compilerArrayJoin(
            [
              'Would lower to: an inferred server-refresh target for a query-backed component.',
              'Blocked reason: fragmentTarget is no longer an author-facing component option; query dependencies now derive refresh targets.',
              'Fixes: remove fragmentTarget, declare queries for refreshable server data, or set disableServerRefresh: true to force the component off the enhanced server-refresh path.',
              'SPEC §4.8 keeps runtime stamps compiler-derived and SPEC §4.9 classifies inferred query-backed refresh coverage.',
              'Escape: emitted compiler artifacts may carry kovo-fragment-target hooks; app TSX should not force targets by option.',
            ],
            '\n',
          ),
          message:
            'Redundant removed component option; query-backed components infer server refresh targets. fragmentTarget',
        },
        'Removed fragment-target diagnostics',
      );
    }
  }
  return found;
}

export function validateHandAuthoredFragmentTargetStamp(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const componentLength = compilerArrayLength(model.components, 'Fragment-stamp components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = ownArrayEntry(model.components, componentIndex, 'Fragment-stamp components');
    if (!componentHasInferredFragmentTarget(component)) continue;

    const host = componentRenderHostElementFor(model, component);
    const attribute = host ? jsxAttributeNamed(host, 'kovo-fragment-target') : undefined;
    if (!attribute) continue;

    compilerArrayAppend(
      found,
      {
        ...diagnostics.at('KV223', {
          start: attribute.start,
          length: attribute.end - attribute.start,
        }),
        help: compilerArrayJoin(
          [
            'Would lower to: the same kovo-fragment-target hook the compiler derives for a query-backed component root.',
            'Blocked reason: the stamp is redundant in app-authored TSX because the compiler can derive the live server-refresh target from queries and component identity.',
            'Fixes: remove the hand-written kovo-fragment-target attribute, keep declared queries as the source of truth, or set disableServerRefresh: true if the component should not be live-refreshable.',
            'SPEC §4.8 permits residual stamps for emitted IR fixpoint validation, but app TSX should not hand-author derivable runtime hooks.',
            'Escape: emitted compiler artifacts may retain kovo-fragment-target for the runtime Kovo-Targets wire.',
          ],
          '\n',
        ),
        message:
          'Redundant hand-written fragment target stamp in sugar; the compiler derives it. kovo-fragment-target',
      },
      'Hand-authored fragment-stamp diagnostics',
    );
  }
  return found;
}

export function validateFragmentTargetInputs(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const validatesFragmentTarget =
    compilerArrayLength(componentFragmentTargetNames(model), 'Fragment target names') > 0;
  const validatesIsomorphicIsland = componentOptionStaticValue(model, 'isomorphic') === true;
  if (!validatesFragmentTarget && !validatesIsomorphicIsland) return [];

  const allowedInputs = declaredRenderInputRoots(model, validatesIsomorphicIsland);
  const renderInputs = componentRenderInputModels(model);
  const missing: RenderInputModel[] = [];
  appendMissingRenderInputs(missing, renderInputs, allowedInputs, 'Fragment render inputs');
  if (validatesIsomorphicIsland) {
    appendMissingRenderInputs(
      missing,
      isomorphicRenderReads(model),
      allowedInputs,
      'Isomorphic render reads',
    );
  }

  const unique = dedupeBy(missing, (input) => input.name);
  const found: CompilerDiagnostic[] = [];
  const uniqueLength = compilerArrayLength(unique, 'Missing fragment render inputs');
  for (let index = 0; index < uniqueLength; index += 1) {
    compilerArrayAppend(
      found,
      kv303RenderInputDiagnostic(
        diagnostics,
        allowedInputs,
        ownArrayEntry(unique, index, 'Missing fragment render inputs'),
      ),
      'Fragment input diagnostics',
    );
  }
  return found;
}

function declaredRenderInputRoots(model: ComponentModuleModel, includeState: boolean): Set<string> {
  const roots = compilerCreateSet<string>();
  addStringsToSet(roots, componentOptionObjectKeys(model, 'queries'), 'Component query names');
  addStringsToSet(roots, componentOptionObjectKeys(model, 'props'), 'Component prop names');
  const bindingLength = compilerArrayLength(model.moduleScopeBindings, 'Module-scope bindings');
  for (let index = 0; index < bindingLength; index += 1) {
    compilerSetAdd(
      roots,
      ownArrayEntry(model.moduleScopeBindings, index, 'Module-scope bindings').name,
    );
  }
  // SPEC §4.8/§4.9: `now` is the compiler-owned clock input; KV312 validates names.
  compilerSetAdd(roots, 'now');
  if (includeState) compilerSetAdd(roots, 'state');
  return roots;
}

function isomorphicRenderReads(model: ComponentModuleModel): RenderInputModel[] {
  const renderLocalNames = compilerCreateSet<string>();
  const componentLength = compilerArrayLength(model.components, 'Isomorphic components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    addStringsToSet(
      renderLocalNames,
      ownArrayEntry(model.components, componentIndex, 'Isomorphic components').renderLocalNames,
      'Isomorphic render local names',
    );
  }

  const found: RenderInputModel[] = [];
  const expressions = jsxExpressions(model);
  const expressionLength = compilerArrayLength(expressions, 'Isomorphic JSX expressions');
  for (let expressionIndex = 0; expressionIndex < expressionLength; expressionIndex += 1) {
    const expression = ownArrayEntry(expressions, expressionIndex, 'Isomorphic JSX expressions');
    if (isJsxEventAttributeExpression(expression, model)) continue;
    const expressionLocalNames = compilerCreateSet<string>();
    addStringsToSet(
      expressionLocalNames,
      expression.localNames,
      'Isomorphic expression local names',
    );
    const accessLength = compilerArrayLength(
      expression.propertyAccesses,
      'Isomorphic property accesses',
    );
    for (let accessIndex = 0; accessIndex < accessLength; accessIndex += 1) {
      const input = renderInputFromPropertyAccessRoot(
        ownArrayEntry(expression.propertyAccesses, accessIndex, 'Isomorphic property accesses'),
      );
      if (
        !compilerSetHas(expressionLocalNames, input.name) &&
        !compilerSetHas(renderLocalNames, input.name)
      ) {
        compilerArrayAppend(found, input, 'Isomorphic render reads');
      }
    }
  }
  return found;
}

function renderInputFromPropertyAccessRoot(access: PropertyAccessPathModel): RenderInputModel {
  const dot = compilerStringIndexOf(access.path, '.');
  const root = dot < 0 ? access.path : compilerStringSlice(access.path, 0, dot);
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
    compilerSetHas(allowedInputs, input.sourceKey)
  ) {
    return {
      ...diagnostics.at('KV303', span, input.name),
      help: compilerArrayJoin(
        [
          'Would lower to: a fragment target that can be re-rendered from declared query data plus stamped props.',
          'Blocked reason: render destructuring renamed a declared query/prop key, but fragment refresh and binding coverage use the declared key as the reconstructible channel.',
          `Fixes: destructure the declared key as "${input.sourceKey}" in render, stamp "${input.name}" as a serializable prop, or move the aliasing into a render-local const after destructuring the declared key.`,
          'SPEC §4.5 requires fragment targets to be reconstructible from declared server inputs.',
        ],
        '\n',
      ),
      message: `${diagnostics.at('KV303').message} ${input.name} (render destructuring aliases declared key ${input.sourceKey}; use the declared key name in the render parameter)`,
    };
  }

  return diagnostics.at('KV303', span, input.name);
}

function isJsxEventAttributeExpression(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Component-contract JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = ownArrayEntry(elements, elementIndex, 'Component-contract JSX elements');
    const attributeLength = compilerArrayLength(
      element.attributes,
      'Component-contract JSX attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = ownArrayEntry(
        element.attributes,
        attributeIndex,
        'Component-contract JSX attributes',
      );
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
      slots.names.length > 0 ? compilerArrayJoin(slots.names, ', ') : undefined,
    ),
  ];
}

export function validateFragmentTargetChildren(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const targetNames = fragmentTargetUsageNames(model);
  if (targetNames.length === 0) return [];

  const found: CompilerDiagnostic[] = [];
  const targetLength = compilerArrayLength(targetNames, 'Fragment target usage names');
  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const name = ownArrayEntry(targetNames, targetIndex, 'Fragment target usage names');
    const bodies = fragmentTargetChildBodies(model, name);
    const bodyLength = compilerArrayLength(bodies, 'Fragment target child bodies');
    for (let bodyIndex = 0; bodyIndex < bodyLength; bodyIndex += 1) {
      const body = ownArrayEntry(bodies, bodyIndex, 'Fragment target child bodies');
      if (!fragmentTargetChildCapturesUnserializableValue(model, body)) continue;
      compilerArrayAppend(
        found,
        kv230Diagnostic(diagnostics, name, body),
        'Fragment target child diagnostics',
      );
    }
  }
  return found;
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
  const statefulSiblingsByName = compilerCreateMap<string, ComponentModel>();
  const componentLength = compilerArrayLength(model.components, 'Nested island components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = ownArrayEntry(model.components, componentIndex, 'Nested island components');
    if (component.localName === undefined) continue;
    if (componentDeclaresMutableLocalState(component, model)) {
      compilerMapSet(statefulSiblingsByName, component.localName, component);
    }
  }
  const statefulImportsByName = importedStatefulComponentsByLocalName(model, options);

  const found: CompilerDiagnostic[] = [];
  for (let parentIndex = 0; parentIndex < componentLength; parentIndex += 1) {
    const parent = ownArrayEntry(model.components, parentIndex, 'Nested island components');
    if (!componentHasInferredFragmentTarget(parent)) continue;

    const childTags = componentRefreshTargetChildComponentTags(model, parent);
    const childLength = compilerArrayLength(childTags, 'Refresh-target child component tags');
    for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
      const childTag = ownArrayEntry(childTags, childIndex, 'Refresh-target child component tags');
      const childComponent = compilerMapGet(statefulSiblingsByName, childTag.tag);
      // A component never trips KV420 against its own recursive render-time reference.
      if (childComponent?.localName === parent.localName) continue;
      const childName = childComponent
        ? childTag.tag
        : (compilerMapGet(statefulImportsByName, childTag.tag) ?? null);
      if (!childName) continue;

      compilerArrayAppend(
        found,
        diagnostics.at(
          'KV420',
          {
            start: childTag.openingTagNameStart,
            length: childTag.openingTagNameEnd - childTag.openingTagNameStart,
          },
          `${childName} inside ${parent.localName ?? 'the enclosing'}.`,
        ),
        'Nested stateful-island diagnostics',
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

  const found: JsxElementModel[] = [];
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Refresh-target JSX elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = ownArrayEntry(elements, index, 'Refresh-target JSX elements');
    if (
      element.start >= spanStart &&
      element.end <= spanEnd &&
      element.start !== hostStart &&
      isComponentReferenceTag(element.tag)
    ) {
      compilerArrayAppend(found, element, 'Refresh-target child component tags');
    }
  }
  return found;
}

function isComponentReferenceTag(tag: string): boolean {
  return compilerRegExpTest(/^[A-Z]/u, tag);
}

function importedStatefulComponentsByLocalName(
  model: ComponentModuleModel,
  options: Pick<CompileComponentOptions, 'fileName' | 'registryFacts'>,
): Map<string, string> {
  const statefulComponents = compilerCreateSet<string>();
  addStringsToSet(
    statefulComponents,
    registryStatefulComponents(options),
    'Registry stateful component names',
  );

  const found = compilerCreateMap<string, string>();
  const importLength = compilerArrayLength(model.namedImports, 'Named component imports');
  for (let importIndex = 0; importIndex < importLength; importIndex += 1) {
    const namedImport = ownArrayEntry(model.namedImports, importIndex, 'Named component imports');
    const registryName = importedComponentRegistryName(options.fileName, namedImport);
    if (!registryName || !compilerSetHas(statefulComponents, registryName)) continue;
    compilerMapSet(found, namedImport.localName, namedImport.localName);
  }
  return found;
}

function importedComponentRegistryName(
  fileName: string,
  namedImport: NamedImportModel,
): string | null {
  if (!compilerStringStartsWith(namedImport.moduleSpecifier, '.')) return null;
  const modulePath = resolveRelativeModulePath(fileName, namedImport.moduleSpecifier);
  if (!modulePath) return null;

  const namespace = componentRegistryNamespace(modulePath);
  const domName = kebabCase(namedImport.importedName);
  return namespace ? `${namespace}/${domName}` : domName;
}

function resolveRelativeModulePath(fileName: string, specifier: string): string | null {
  const baseParts = compilerStringSplit(compilerStringReplaceAll(fileName, '\\', '/'), '/');
  const specifierParts = compilerStringSplit(compilerStringReplaceAll(specifier, '\\', '/'), '/');
  const parts: string[] = [];
  const baseLength = compilerArrayLength(baseParts, 'Importing module path parts');
  for (let index = 0; index < baseLength - 1; index += 1) {
    compilerArrayAppend(
      parts,
      ownArrayEntry(baseParts, index, 'Importing module path parts'),
      'Relative import path parts',
    );
  }
  appendArray(parts, specifierParts, 'Relative import path parts');
  const out: string[] = [];
  const partLength = compilerArrayLength(parts, 'Relative import path parts');
  for (let index = 0; index < partLength; index += 1) {
    const part = ownArrayEntry(parts, index, 'Relative import path parts');
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.length -= 1;
      continue;
    }
    compilerArrayAppend(out, part, 'Resolved relative import path parts');
  }
  return compilerArrayJoin(out, '/');
}

export function validateEventPayloads(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: ComponentContractValidationOptions,
): CompilerDiagnostic[] {
  const queryShapes = componentQueryShapes(options);
  if (!queryShapes) return [];

  const queryPaths = compilerCreateSet<string>();
  const queryShapePathValues = queryShapePaths(queryShapes);
  const queryPathLength = compilerArrayLength(queryShapePathValues, 'Query shape paths');
  for (let index = 0; index < queryPathLength; index += 1) {
    const path = compilerOwnDataValue(queryShapePathValues, index, 'Query shape paths');
    if (typeof path !== 'string') compilerFailClosed(`Query shape paths[${index}] must be own.`);
    compilerSetAdd(queryPaths, path);
  }

  const seen = compilerCreateSet<string>();
  const result: CompilerDiagnostic[] = [];
  const payloads = eventPayloads(model);
  const payloadLength = compilerArrayLength(payloads, 'Event payload paths');
  for (let index = 0; index < payloadLength; index += 1) {
    const payload = compilerOwnDataValue(payloads, index, 'Event payload paths') as
      | EventPayloadPath
      | undefined;
    if (!payload) compilerFailClosed(`Event payload paths[${index}] must be own data.`);
    if (!compilerSetHas(queryPaths, payload.path) || compilerSetHas(seen, payload.path)) continue;
    compilerSetAdd(seen, payload.path);
    compilerArrayAppend(
      result,
      diagnostics.at('KV320', { start: payload.index, length: payload.length }, payload.path),
      'Event payload diagnostics',
    );
  }
  return result;
}

export function validateDirectDbAccess(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const sinks = handlerWriteSinks(model);
  const result: CompilerDiagnostic[] = [];
  const sinkLength = compilerArrayLength(sinks, 'Handler write sinks');
  for (let index = 0; index < sinkLength; index += 1) {
    const sink = compilerOwnDataValue(sinks, index, 'Handler write sinks') as
      | HandlerWriteSinkFact
      | undefined;
    if (!sink) compilerFailClosed(`Handler write sinks[${index}] must be own data.`);
    compilerArrayAppend(
      result,
      handlerWriteSinkDiagnostic(diagnostics, sink),
      'Direct-db diagnostics',
    );
  }
  return result;
}

export function validateWebhookRecordChanges(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const handlers = webhookHandlers(model);
  const result: CompilerDiagnostic[] = [];
  const handlerLength = compilerArrayLength(handlers, 'Webhook handlers');
  for (let handlerIndex = 0; handlerIndex < handlerLength; handlerIndex += 1) {
    const handler = compilerOwnDataValue(handlers, handlerIndex, 'Webhook handlers');
    if (!handler || typeof handler !== 'object') {
      compilerFailClosed(`Webhook handlers[${handlerIndex}] must be own data.`);
    }
    const facts = (handler as { webhookRecordChanges?: readonly WebhookRecordChangeFact[] })
      .webhookRecordChanges;
    if (!facts) continue;
    const factLength = compilerArrayLength(facts, `Webhook handler ${handlerIndex} record changes`);
    for (let factIndex = 0; factIndex < factLength; factIndex += 1) {
      const fact = compilerOwnDataValue(
        facts,
        factIndex,
        `Webhook handler ${handlerIndex} record changes`,
      ) as WebhookRecordChangeFact | undefined;
      if (!fact) {
        compilerFailClosed(
          `Webhook handler ${handlerIndex} record changes[${factIndex}] must be own data.`,
        );
      }
      appendCompilerDiagnostics(
        result,
        webhookRecordChangeDiagnostic(diagnostics, fact),
        'Webhook record-change diagnostics',
      );
    }
  }
  return result;
}

function webhookRecordChangeDiagnostic(
  diagnostics: DiagnosticFactory,
  fact: WebhookRecordChangeFact,
): CompilerDiagnostic[] {
  const rawLength = fact.span.end - fact.span.start;
  const length = rawLength > 1 ? rawLength : 1;
  const declared: string[] = [];
  let hasUnresolved = false;
  const declaredLength = compilerArrayLength(fact.declaredWriteKeys, 'Webhook declared writes');
  for (let index = 0; index < declaredLength; index += 1) {
    const key = compilerOwnDataValue(fact.declaredWriteKeys, index, 'Webhook declared writes');
    if (typeof key !== 'string') {
      compilerFailClosed(`Webhook declared writes[${index}] must be an own string.`);
    }
    if (key === 'UNRESOLVED') {
      hasUnresolved = true;
    } else {
      compilerArrayAppend(declared, key, 'Resolved webhook declared writes');
    }
  }
  if (fact.domainKey === 'UNRESOLVED' || hasUnresolved) {
    return [
      {
        ...diagnostics.at('KV406', { start: fact.span.start, length }),
        help: compilerArrayJoin(
          [
            'Would lower to: a webhook endpoint whose emitted change records are covered by declared writes.',
            'Blocked reason: the compiler could not statically resolve the recordChange domain or every writes[] entry, so the webhook write surface could be under-reported.',
            'Fixes: pass a module-level domain("...") binding to context.recordChange(...) and include that same binding in webhook writes[].',
            'SPEC §9.1 requires webhook changes to be declared so machine-ingress writes stay explainable and verifiable.',
          ],
          '\n',
        ),
        message:
          'Unresolved webhook recordChange domain; declare a statically named domain in writes[].',
      },
    ];
  }

  if (denseStringArrayIncludes(declared, fact.domainKey, 'Resolved webhook declared writes')) {
    return [];
  }

  const declaredLabel = declared.length === 0 ? 'none' : joinDenseStrings(declared, ', ');
  return [
    {
      ...diagnostics.at(
        'KV402',
        { start: fact.span.start, length },
        `webhook ${fact.owner.value} recordChange("${fact.domainKey}") is outside declared writes (${declaredLabel}).`,
      ),
      help: compilerArrayJoin(
        [
          'Would lower to: a webhook endpoint whose emitted change records are covered by declared writes.',
          'Blocked reason: context.recordChange(...) targets a domain absent from webhook writes[], so kovo explain/check could under-report machine-ingress writes.',
          'Fixes: add the domain binding to writes[] or remove the recordChange call.',
          'SPEC §9.1 requires webhook changes to be declared so machine-ingress writes stay explainable and verifiable.',
        ],
        '\n',
      ),
    },
  ];
}

function handlerWriteSinkDiagnostic(
  diagnostics: DiagnosticFactory,
  sink: HandlerWriteSinkFact,
): CompilerDiagnostic {
  const rawLength = sink.span.end - sink.span.start;
  const length = rawLength > 1 ? rawLength : 1;
  if (handlerWriteSinkIsUnresolved(sink)) {
    return {
      ...diagnostics.at('KV406', { start: sink.span.start, length }),
      help: compilerArrayJoin(
        [
          'Would lower to: a typed handler write-sink fact that records the audited mutation/domain write surface.',
          'Blocked reason: the handler contains a write-shaped call whose target or owner could not be statically resolved, so treating the handler as write-safe would be a fail-open verifier result.',
          'Fixes: route the write through a statically named mutation/domain write, or rewrite the handler so the compiler can see the write target and audited touch surface.',
          'SPEC §11 requires statically un-analyzable write sites to fail closed; SPEC §10.3 makes mutation/domain writes the audited write surface.',
        ],
        '\n',
      ),
      message:
        sink.surface === 'task'
          ? 'Unresolved write sink in a task run body; route through ctx.runMutation.'
          : sink.surface === 'mutation'
            ? 'Unresolved write sink in a mutation handler; route through domain.'
            : sink.surface === 'endpoint'
              ? 'Unresolved write sink in an endpoint handler; route writes through an audited mutation/domain write.'
              : 'Unresolved write sink in a webhook handler; route writes through an audited mutation/domain write.',
    };
  }

  if (sink.surface === 'mutation') {
    return diagnostics.at('KV330', { start: sink.span.start, length });
  }

  if (sink.surface === 'task') {
    return {
      ...diagnostics.at('KV330', { start: sink.span.start, length }),
      help: compilerArrayJoin(
        [
          'Would lower to: a durable task graph node whose database effects compose through audited mutations.',
          'Blocked reason: direct DB writes in task.run bypass ctx.runMutation, so KV414/KV438/KV407 write audits cannot see the effect.',
          'Fixes: move the write into a mutation/domain write and call ctx.runMutation(...) from the task, or expose a statically audited mutation that owns the touch set.',
          'SPEC §9.6 requires task DB writes to go through ctx.runMutation; SPEC §10.3 makes mutation/domain writes the audited write surface.',
        ],
        '\n',
      ),
      message: 'Direct db access in a task run body; route through ctx.runMutation.',
    };
  }

  if (sink.surface === 'endpoint') {
    return {
      ...diagnostics.at('KV330', { start: sink.span.start, length }),
      help: compilerArrayJoin(
        [
          'Would lower to: an endpoint whose database reads use a read-only app handle.',
          'Blocked reason: direct DB writes in endpoint handlers bypass the mutation/domain write-surface audit and can turn an ordinary endpoint into an untracked state change.',
          'Fixes: use readonlyAppDb for endpoint reads, or move writes into a mutation/domain write with declared touch metadata.',
          'SPEC §10.3 makes mutation/domain writes the audited write surface; SPEC §6.6 requires fail-closed sinks rather than importable write handles.',
        ],
        '\n',
      ),
      message:
        'Direct db access in an endpoint handler; use readonlyAppDb for reads and route writes through an audited mutation/domain write.',
    };
  }

  return {
    ...diagnostics.at('KV330', { start: sink.span.start, length }),
    help: compilerArrayJoin(
      [
        'Would lower to: a machine-authenticated webhook whose database effects compose through an audited mutation/domain write.',
        'Blocked reason: direct DB writes in a webhook handler bypass the mutation/domain write-surface audit.',
        'Fixes: move the write into a mutation/domain write with declared touch metadata, or keep the webhook handler to verification plus mutation dispatch.',
        'SPEC §10.3 makes mutation/domain writes the audited write surface; SPEC §6.6 requires fail-closed sinks rather than importable write handles.',
      ],
      '\n',
    ),
    message:
      'Direct db access in a webhook handler; route writes through an audited mutation/domain write.',
  };
}

function handlerWriteSinkIsUnresolved(sink: HandlerWriteSinkFact): boolean {
  return (
    sink.operationKind === 'UNRESOLVED' ||
    sink.path === 'UNRESOLVED' ||
    sink.owner.value === 'UNRESOLVED' ||
    sink.canonicalTarget.identity === 'UNRESOLVED'
  );
}

export function unhandledUpdateCoverageDiagnostics(
  diagnostics: DiagnosticFactory,
  updateCoverage: readonly QueryUpdateCoverageFact[],
): CompilerDiagnostic[] {
  const result: CompilerDiagnostic[] = [];
  const factLength = compilerArrayLength(updateCoverage, 'Query update coverage facts');
  for (let index = 0; index < factLength; index += 1) {
    const fact = compilerOwnDataValue(updateCoverage, index, 'Query update coverage facts') as
      | QueryUpdateCoverageFact
      | undefined;
    if (!fact) compilerFailClosed(`Query update coverage facts[${index}] must be own data.`);
    if (fact.status !== 'UNHANDLED') continue;
    compilerArrayAppend(
      result,
      kv311Diagnostic(diagnostics, fact),
      'Unhandled coverage diagnostics',
    );
  }
  return result;
}

function appendCompilerDiagnostics(
  target: CompilerDiagnostic[],
  values: readonly CompilerDiagnostic[],
  label: string,
): void {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label) as CompilerDiagnostic | undefined;
    if (!value) compilerFailClosed(`${label}[${index}] must be own data.`);
    compilerArrayAppend(target, value, label);
  }
}

function denseStringArrayIncludes(
  values: readonly string[],
  search: string,
  label: string,
): boolean {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (typeof value !== 'string') compilerFailClosed(`${label}[${index}] must be an own string.`);
    if (value === search) return true;
  }
  return false;
}

function joinDenseStrings(values: readonly string[], separator: string): string {
  let result = '';
  const length = compilerArrayLength(values, 'Dense string values');
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Dense string values');
    if (typeof value !== 'string') {
      compilerFailClosed(`Dense string values[${index}] must be an own string.`);
    }
    if (index > 0) result += separator;
    result += value;
  }
  return result;
}

function fragmentTargetUsageNames(model: ComponentModuleModel): string[] {
  const unique = compilerCreateSet<string>();
  const result: string[] = [];
  const names = componentFragmentTargetNames(model);
  const nameLength = compilerArrayLength(names, 'Fragment target names');
  for (let index = 0; index < nameLength; index += 1) {
    const name = ownArrayEntry(names, index, 'Fragment target names');
    if (compilerSetHas(unique, name)) continue;
    compilerSetAdd(unique, name);
    compilerArrayAppend(result, name, 'Fragment target usage names');
  }
  return result;
}

function fragmentTargetChildBodies(
  model: ComponentModuleModel,
  name: string,
): JsxElementChildBody[] {
  const bodies: JsxElementChildBody[] = [];
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Fragment target JSX elements');
  for (let index = 0; index < elementLength; index += 1) {
    const element = ownArrayEntry(elements, index, 'Fragment target JSX elements');
    if (element.tag !== name) continue;
    const body = jsxElementChildBody(element);
    if (body) compilerArrayAppend(bodies, body, 'Fragment target child bodies');
  }
  return bodies;
}

function fragmentTargetChildCapturesUnserializableValue(
  model: ComponentModuleModel,
  body: JsxElementChildBody,
): boolean {
  const bodyEnd = body.offset + body.source.length;
  const references: string[] = [];
  const expressions = jsxExpressions(model);
  const expressionLength = compilerArrayLength(expressions, 'Fragment child JSX expressions');
  for (let index = 0; index < expressionLength; index += 1) {
    const expression = ownArrayEntry(expressions, index, 'Fragment child JSX expressions');
    if (expression.start < body.offset || expression.end > bodyEnd) continue;
    appendArray(references, expression.references, 'Fragment child references');
  }

  return capturesUnserializableReferences(references, {
    additionalAllowedReferences: moduleRenderInputNames(model),
    model,
  });
}

function moduleRenderInputNames(model: ComponentModuleModel): string[] {
  const seen = compilerCreateSet<string>();
  const names: string[] = [];
  const componentLength = compilerArrayLength(model.components, 'Module render components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = ownArrayEntry(model.components, componentIndex, 'Module render components');
    const inputLength = compilerArrayLength(component.renderInputs, 'Module render inputs');
    for (let inputIndex = 0; inputIndex < inputLength; inputIndex += 1) {
      const name = ownArrayEntry(component.renderInputs, inputIndex, 'Module render inputs').name;
      if (compilerSetHas(seen, name)) continue;
      compilerSetAdd(seen, name);
      compilerArrayAppend(names, name, 'Module render input names');
    }
  }
  return names;
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
    help: compilerArrayJoin(
      [
        `${labels.slotHoist} ${target}$slot_children`,
        `${labels.blockedChildren} ${body.source}`,
        definition.help ?? '',
      ],
      '\n',
    ),
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
    help: compilerArrayJoin(
      [
        `Coverage classification: ${fact.componentName} ${fact.position} ${fact.status}`,
        `Blocked update: ${fact.detail}`,
        compilerArrayJoin(
          [
            'Would lower to: a data-bind/update plan, inferred query-backed fragment target, isomorphic component, or renderOnce marker for the rendered position.',
            'Blocked reason: the query/state expression is outside the current §4.8 update-plan grammar and is not inside an inferred server-refresh target.',
            'Fixes: add a data-bind/query update plan, extract a derive/stamp, keep the component query-backed for inferred fragment refresh, mark it isomorphic, declare renderOnce, or set disableServerRefresh: true only when no enhanced refresh is intended.',
            'SPEC §4.9 requires every query/state-dependent rendered position to have plan, fragment, isomorphic, or renderOnce coverage.',
          ],
          '\n',
        ),
      ],
      '\n',
    ),
  };
}

function eventPayloads(model: ComponentModuleModel): EventPayloadPath[] {
  const payloads: EventPayloadPath[] = [];
  const calls = callExpressions(model);
  const callLength = compilerArrayLength(calls, 'Event call expressions');
  for (let callIndex = 0; callIndex < callLength; callIndex += 1) {
    const call = compilerOwnDataValue(calls, callIndex, 'Event call expressions');
    if (!call || typeof call !== 'object') {
      compilerFailClosed(`Event call expressions[${callIndex}] must be own data.`);
    }
    const typedCall = call as (typeof calls)[number];
    if (typedCall.name !== 'emit') continue;
    const span = compilerOwnDataValue(
      typedCall.argumentSpans,
      1,
      `Event call ${callIndex} argument spans`,
    ) as SourceSpan | undefined;
    const paths = compilerOwnDataValue(
      typedCall.argumentPropertyAccesses,
      1,
      `Event call ${callIndex} argument property accesses`,
    ) as readonly PropertyAccessPathModel[] | undefined;
    if (!paths || compilerArrayLength(paths, `Event call ${callIndex} payload paths`) === 0) {
      continue;
    }
    if (!span) continue;

    const pathLength = compilerArrayLength(paths, `Event call ${callIndex} payload paths`);
    for (let pathIndex = 0; pathIndex < pathLength; pathIndex += 1) {
      const access = compilerOwnDataValue(
        paths,
        pathIndex,
        `Event call ${callIndex} payload paths`,
      ) as PropertyAccessPathModel | undefined;
      if (!access) {
        compilerFailClosed(`Event call ${callIndex} payload paths[${pathIndex}] must be own data.`);
      }
      compilerArrayAppend(
        payloads,
        { index: span.start, length: span.end - span.start, path: access.path },
        'Event payload paths',
      );
    }
  }

  return payloads;
}

function componentOption(
  component: ComponentModel,
  key: string,
): ComponentModel['options'][number] | undefined {
  const optionLength = compilerArrayLength(component.options, 'Component contract options');
  for (let index = 0; index < optionLength; index += 1) {
    const option = ownArrayEntry(component.options, index, 'Component contract options');
    if (option.key === key) return option;
  }
  return undefined;
}

function jsxAttributeNamed(
  element: JsxElementModel,
  name: string,
): JsxElementModel['attributes'][number] | undefined {
  const attributeLength = compilerArrayLength(
    element.attributes,
    'Component contract JSX attributes',
  );
  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = ownArrayEntry(element.attributes, index, 'Component contract JSX attributes');
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function appendMissingRenderInputs(
  target: RenderInputModel[],
  values: readonly RenderInputModel[],
  allowedInputs: ReadonlySet<string>,
  label: string,
): void {
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    const value = ownArrayEntry(values, index, label);
    if (!compilerSetHas(allowedInputs, value.name)) {
      compilerArrayAppend(target, value, 'Missing fragment render inputs');
    }
  }
}

function addStringsToSet(target: Set<string>, values: readonly string[], label: string): void {
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (typeof value !== 'string') compilerFailClosed(`${label}[${index}] must be a string.`);
    compilerSetAdd(target, value);
  }
}

function appendArray<Value>(target: Value[], values: readonly Value[], label: string): void {
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    compilerArrayAppend(target, ownArrayEntry(values, index, label), label);
  }
}

function ownArrayEntry<Value>(values: readonly Value[], index: number, label: string): Value {
  const value = compilerOwnDataValue(values, index, label) as Value | undefined;
  if (value === undefined) compilerFailClosed(`${label}[${index}] must be own data.`);
  return value;
}

function registryStatefulComponents(
  options: Pick<CompileComponentOptions, 'registryFacts'>,
): string[] {
  const registryFacts = compilerOwnDataValue(
    options,
    'registryFacts',
    'Nested-island compile options',
  );
  if (registryFacts === undefined) return [];
  if (!registryFacts || typeof registryFacts !== 'object' || compilerArrayIsArray(registryFacts)) {
    compilerFailClosed(`Nested-island registry facts must be an object.`);
  }
  const values = compilerOwnDataValue(
    registryFacts,
    'statefulComponents',
    'Nested-island registry facts',
  );
  if (values === undefined) return [];
  if (!compilerArrayIsArray(values)) {
    compilerFailClosed(`Nested-island statefulComponents must be an array.`);
  }
  const result: string[] = [];
  const valueLength = compilerArrayLength(values, 'Nested-island stateful component names');
  for (let index = 0; index < valueLength; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Nested-island stateful component names');
    if (typeof value !== 'string') {
      compilerFailClosed(`Nested-island stateful component names[${index}] must be a string.`);
    }
    compilerArrayAppend(result, value, 'Nested-island stateful component names');
  }
  return result;
}

function queryRootFromPath(path: string): string {
  const dot = compilerStringIndexOf(path, '.');
  return dot === -1 ? path : compilerStringSlice(path, 0, dot);
}
