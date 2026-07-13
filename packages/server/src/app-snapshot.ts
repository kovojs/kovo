import {
  type CustomWebhookVerifier,
  type WebhookVerificationRequest,
  type WebhookVerifier,
} from '@kovojs/core';
import { isFrameworkHmacSignatureVerifier } from '@kovojs/core/internal/verifier';
import { accessDecisionFor, pinAccessDecision, type AccessDecision } from './access.js';
import {
  snapshotAuditJustification,
  snapshotAuditReason,
  snapshotAuditText,
} from './audit-justification.js';
import { isKovoApp, markClosedKovoApp } from './app-guards.js';
import type {
  AppMutationDeclaration,
  AppQueryDeclaration,
  AppRouteDeclaration,
  KovoApp,
} from './app-types.js';
import { inheritAppLiveTargetIdentity } from './live-target-app-identity.js';
import {
  copyEndpointAuthSnapshot,
  type EndpointAuthDeclaration,
  type EndpointDeclaration,
  type EndpointMethod,
  type EndpointMount,
} from './endpoint.js';
import type { LiveTargetRenderer } from './mutation-wire.js';
import { validateMutationCsrfPosture } from './mutation/csrf-posture.js';
import type { RegisteredQueryDefinition } from './query.js';
import { snapshotMutationReplayStore } from './replay.js';
import { layout, route, type LayoutDeclaration } from './route.js';
import { snapshotSchemaForRuntime, type Schema } from './schema.js';
import type { AppDiagnostic, AppErrorShellOptions, AppTaskDeclaration } from './app-types.js';
import type { CsrfAnonymousCookieOptions, CsrfOptions } from './csrf.js';
import { snapshotStylesheetAsset, type StylesheetAsset } from './hints.js';
import { signingKeyRingFromSecret } from './keyring.js';
import { securityJsonStringify } from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  createWitnessWeakSet,
  createWitnessSet,
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessObjectKeys,
  witnessOwnKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakSetAdd,
  witnessWeakSetDelete,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';
import { runWebhook, type WebhookDeclaration } from './webhook.js';

const MAX_APP_REGISTRY_LENGTH = 100_000;
const nativeArrayIsArray = Array.isArray;
const nativeNumberIsFinite = Number.isFinite;
const nativeNumberIsSafeInteger = Number.isSafeInteger;
if (!nativeArrayIsArray([]) || nativeArrayIsArray({})) {
  throw new TypeError('Kovo app array controls were modified before framework initialization.');
}
const EMPTY_OMITTED_PROPERTIES = createWitnessSet<PropertyKey>();

/** One assembly-local identity map keeps nested layout/mutation query references canonical. */
export interface AppDeclarationSnapshotContext {
  readonly endpoints: WeakMap<object, EndpointDeclaration<string, EndpointMethod, EndpointMount>>;
  readonly layouts: WeakMap<object, LayoutDeclaration<any, any, any, any>>;
  readonly layoutsInProgress: WeakSet<object>;
  readonly mutations: WeakMap<object, AppMutationDeclaration>;
  readonly queries: WeakMap<object, AppQueryDeclaration>;
  readonly routes: WeakMap<object, AppRouteDeclaration>;
}

export function createAppDeclarationSnapshotContext(): AppDeclarationSnapshotContext {
  return {
    endpoints: createWitnessWeakMap(),
    layouts: createWitnessWeakMap(),
    layoutsInProgress: createWitnessWeakSet(),
    mutations: createWitnessWeakMap(),
    queries: createWitnessWeakMap(),
    routes: createWitnessWeakMap(),
  };
}

/** Snapshot an app-owned registry through dense own data descriptors, never Proxy indexed gets. */
export function snapshotAppRegistry<Value, Result>(
  values: readonly Value[],
  label: string,
  snapshot: (value: Value, index: number) => Result,
): readonly Result[] {
  const source = denseArrayValues(values, label);
  const result: Result[] = [];
  for (let index = 0; index < source.length; index += 1) {
    witnessArrayAppend(result, snapshot(source[index]!, index), `App ${label} snapshot`);
  }
  return witnessFreeze(result);
}

export function snapshotAppQuery(
  source: AppQueryDeclaration,
  context: AppDeclarationSnapshotContext,
): AppQueryDeclaration {
  const object = requireDeclarationObject(source, 'query');
  const existing = witnessWeakMapGet(context.queries, object);
  if (existing !== undefined) return existing;

  const access = accessDecisionFor(object as AppQueryDeclaration & { access?: AccessDecision });
  const record = snapshotOwnDataRecord(object, 'query declaration', omittedProperties('access'));
  snapshotSchemaProperty(record, 'args', 'query.args');
  snapshotSchemaProperty(record, 'output', 'query.output');
  snapshotDomainArrayProperty(record, 'reads', 'query.reads');
  snapshotQueryDeltaArrayProperty(record, 'delta', 'query.delta');

  const declaration = pinAccessDecision(record, access) as AppQueryDeclaration;
  witnessFreeze(declaration);
  witnessWeakMapSet(context.queries, object, declaration);
  witnessWeakMapSet(context.queries, declaration, declaration);
  return declaration;
}

export function snapshotAppMutation(
  source: AppMutationDeclaration,
  context: AppDeclarationSnapshotContext,
): AppMutationDeclaration {
  const object = requireDeclarationObject(source, 'mutation');
  const existing = witnessWeakMapGet(context.mutations, object);
  if (existing !== undefined) return existing;

  const access = accessDecisionFor(object as AppMutationDeclaration & { access?: AccessDecision });
  const record = snapshotOwnDataRecord(object, 'mutation declaration', omittedProperties('access'));
  snapshotSchemaProperty(record, 'input', 'mutation.input');
  snapshotSchemaRecordProperty(record, 'errors', 'mutation.errors');
  if (record.csrf !== undefined && record.csrf !== false) {
    record.csrf = snapshotAppCsrfOptions(record.csrf as CsrfOptions<unknown>);
  }
  validateMutationCsrfPosture(record);
  snapshotArrayProperty(record, 'fileFields', 'mutation.fileFields');
  if (record.registry !== undefined) {
    record.registry = snapshotMutationRegistry(record.registry, context);
  }
  if (record.optimistic !== undefined) {
    record.optimistic = witnessFreeze(
      snapshotOwnDataRecord(record.optimistic, 'mutation.optimistic'),
    );
  }

  const declaration = pinAccessDecision(record, access) as AppMutationDeclaration;
  witnessFreeze(declaration);
  witnessWeakMapSet(context.mutations, object, declaration);
  witnessWeakMapSet(context.mutations, declaration, declaration);
  return declaration;
}

export function snapshotAppEndpoint(
  source: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  context: AppDeclarationSnapshotContext,
): EndpointDeclaration<string, EndpointMethod, EndpointMount> {
  const object = requireDeclarationObject(source, 'endpoint');
  const existing = witnessWeakMapGet(context.endpoints, object);
  if (existing !== undefined) return existing;

  const access = accessDecisionFor(
    object as EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  );
  const record = snapshotOwnDataRecord(
    object,
    'endpoint declaration',
    omittedProperties('access', 'auth'),
  );
  record.reason = snapshotAuditReason(record.reason, 'app endpoint snapshot (SPEC §9.1)');
  if (record.mountJustification !== undefined) {
    record.mountJustification = snapshotAuditJustification(
      record.mountJustification,
      'app endpoint mountJustification snapshot (SPEC §9.1)',
    );
  }
  if (record.csrf !== undefined) {
    const csrf = snapshotOwnDataRecord(record.csrf, 'endpoint.csrf');
    csrf.justification = snapshotAuditJustification(
      csrf.justification,
      'app endpoint CSRF exemption snapshot (SPEC §6.6/§9.1)',
    );
    record.csrf = witnessFreeze(csrf);
  }
  if (record.response !== undefined) {
    const response = snapshotOwnDataRecord(record.response, 'endpoint.response');
    snapshotArrayProperty(response, 'body', 'endpoint.response.body');
    snapshotRedirectAllowlistProperty(
      response,
      'redirectAllowlist',
      'endpoint.response.redirectAllowlist',
    );
    snapshotArrayProperty(response, 'reservedHeaders', 'endpoint.response.reservedHeaders');
    record.response = witnessFreeze(response);
  }
  if (record.webhookDefinition !== undefined) {
    record.webhookDefinition = snapshotWebhookDefinition(record.webhookDefinition);
  }

  let declaration: EndpointDeclaration<string, EndpointMethod, EndpointMount>;
  if (record.webhook === true && record.webhookDefinition !== undefined) {
    // webhook()'s authored handler closes over its original declaration. Rebind the canonical
    // endpoint so direct runEndpoint(app.endpoints[i]) and app-shell special dispatch both consume
    // the frozen webhookDefinition stored on this aggregate, never that original mutable object.
    record.handler = async (request: Request): Promise<Response> =>
      (await runWebhook(declaration as WebhookDeclaration<string, string, any, any, any>, request))
        .response;
  }

  declaration = pinAccessDecision(record, access) as EndpointDeclaration<
    string,
    EndpointMethod,
    EndpointMount
  >;
  copyEndpointAuthSnapshot(object as object & { auth?: EndpointAuthDeclaration }, declaration);
  witnessFreeze(declaration);
  witnessWeakMapSet(context.endpoints, object, declaration);
  witnessWeakMapSet(context.endpoints, declaration, declaration);
  return declaration;
}

export function snapshotAppRoute(
  source: AppRouteDeclaration,
  context: AppDeclarationSnapshotContext,
): AppRouteDeclaration {
  const object = requireDeclarationObject(source, 'route');
  const existing = witnessWeakMapGet(context.routes, object);
  if (existing !== undefined) return existing;

  const access = accessDecisionFor(object as AppRouteDeclaration & { access?: AccessDecision });
  const path = stableOwnDataValue(object, 'path', 'route.path');
  if (typeof path !== 'string') {
    throw new TypeError('Kovo route declaration must expose path as a stable own string property.');
  }
  const sourceLayout = stableOwnDataValue(object, 'layout', `route(${path}).layout`);
  const record = snapshotOwnDataRecord(
    object,
    `route(${path}) declaration`,
    omittedProperties('access', 'layout', 'path'),
  );
  snapshotSchemaProperty(record, 'params', `route(${path}).params`);
  snapshotSchemaProperty(record, 'search', `route(${path}).search`);
  snapshotFunctionRecordProperty(record, 'boundaries', `route(${path}).boundaries`, [
    'error',
    'notFound',
    'unauthorized',
  ]);
  snapshotFunctionRecordProperty(record, 'regions', `route(${path}).regions`);
  snapshotRouteHintArrays(record, `route(${path})`);

  const declaration = route(path, {
    ...record,
    ...(access === undefined ? {} : { access }),
    ...(sourceLayout === undefined
      ? {}
      : {
          layout: snapshotAppLayout(sourceLayout as LayoutDeclaration<any, any, any, any>, context),
        }),
  } as any) as AppRouteDeclaration;
  witnessWeakMapSet(context.routes, object, declaration);
  witnessWeakMapSet(context.routes, declaration, declaration);
  return declaration;
}

export function snapshotAppLayout(
  source: LayoutDeclaration<any, any, any, any>,
  context: AppDeclarationSnapshotContext,
): LayoutDeclaration<any, any, any, any> {
  const object = requireDeclarationObject(source, 'layout');
  const existing = witnessWeakMapGet(context.layouts, object);
  if (existing !== undefined) return existing;
  if (witnessWeakSetHas(context.layoutsInProgress, object)) {
    throw new TypeError('Kovo route layout topology must be acyclic and stable.');
  }

  witnessWeakSetAdd(context.layoutsInProgress, object);
  try {
    const access = accessDecisionFor(
      object as LayoutDeclaration<any, any, any, any> & { access?: AccessDecision },
    );
    const sourceParent = stableOwnDataValue(object, 'parent', 'layout.parent');
    const sourceQueries = stableOwnDataValue(object, 'queries', 'layout.queries');
    const record = snapshotOwnDataRecord(
      object,
      'layout declaration',
      omittedProperties('access', 'parent', 'queries'),
    );
    snapshotFunctionRecordProperty(record, 'boundaries', 'layout.boundaries', [
      'error',
      'notFound',
      'unauthorized',
    ]);
    snapshotRouteHintArrays(record, 'layout');

    const declaration = layout({
      ...record,
      ...(access === undefined ? {} : { access }),
      ...(sourceParent === undefined
        ? {}
        : {
            parent: snapshotAppLayout(
              sourceParent as LayoutDeclaration<any, any, any, any>,
              context,
            ),
          }),
      ...(sourceQueries === undefined
        ? {}
        : { queries: snapshotLayoutQueries(sourceQueries, context) }),
    } as any);
    witnessWeakMapSet(context.layouts, object, declaration);
    witnessWeakMapSet(context.layouts, declaration, declaration);
    return declaration;
  } finally {
    witnessWeakSetDelete(context.layoutsInProgress, object);
  }
}

export function snapshotLiveTargetRenderers(
  renderers: readonly LiveTargetRenderer<any>[],
  context: AppDeclarationSnapshotContext,
): readonly LiveTargetRenderer<any>[] {
  const componentIds = createWitnessSet<string>();
  return snapshotAppRegistry(renderers, 'app.liveTargetRenderers', (source, index) => {
    const label = `liveTargetRenderer[${index}]`;
    const object = requireDeclarationObject(source, label);
    const queryBindings = stableOwnDataValue(object, 'queryBindings', `${label}.queryBindings`);
    const errorBoundary = stableOwnDataValue(object, 'errorBoundary', `${label}.errorBoundary`);
    const record = snapshotOwnDataRecord(
      object,
      label,
      omittedProperties('errorBoundary', 'queryBindings'),
    );
    if (typeof record.component !== 'string' || record.component.length === 0) {
      throw new TypeError(`${label}.component must be a stable non-empty string.`);
    }
    if (witnessSetHas(componentIds, record.component)) {
      throw new TypeError(
        `Duplicate live-target renderer component ${securityJsonStringify(record.component)} is not allowed in one app.`,
      );
    }
    witnessSetAdd(componentIds, record.component);
    if (record.queries !== undefined) {
      const values = denseArrayValues(record.queries, 'liveTargetRenderer.queries');
      for (let queryIndex = 0; queryIndex < values.length; queryIndex += 1) {
        if (typeof values[queryIndex] !== 'string') {
          throw new TypeError('liveTargetRenderer.queries must contain stable strings.');
        }
      }
      record.queries = witnessFreeze(values);
    }
    const mutationKeys = denseArrayValues(record.mutationKeys, 'liveTargetRenderer.mutationKeys');
    for (let mutationIndex = 0; mutationIndex < mutationKeys.length; mutationIndex += 1) {
      if (typeof mutationKeys[mutationIndex] !== 'string') {
        throw new TypeError('liveTargetRenderer.mutationKeys must contain stable strings.');
      }
    }
    record.mutationKeys = witnessFreeze(mutationKeys);
    if (record.queryDefinitions !== undefined) {
      record.queryDefinitions = snapshotAppRegistry(
        record.queryDefinitions,
        'liveTargetRenderer.queryDefinitions',
        (queryDefinition) =>
          snapshotAppQuery(
            queryDefinition as AppQueryDeclaration,
            context,
          ) as RegisteredQueryDefinition,
      );
    }
    if (queryBindings !== undefined) {
      record.queryBindings = snapshotLiveTargetQueryBindings(queryBindings, context);
    }
    if (errorBoundary !== undefined) {
      record.errorBoundary = snapshotLiveTargetErrorBoundary(errorBoundary);
    }
    snapshotStylesheetArrayProperty(record, 'stylesheets', 'liveTargetRenderer.stylesheets');
    return witnessFreeze(record) as unknown as LiveTargetRenderer<any>;
  });
}

function snapshotLiveTargetQueryBindings(
  source: unknown,
  context: AppDeclarationSnapshotContext,
): readonly Readonly<Record<string, unknown>>[] {
  return snapshotAppRegistry(
    source as readonly unknown[],
    'liveTargetRenderer.queryBindings',
    (binding, index) => {
      const label = `liveTargetRenderer.queryBindings[${index}]`;
      const object = requireDeclarationObject(binding, label);
      const query = stableOwnDataValue(object, 'query', `${label}.query`);
      const args = stableOwnDataValue(object, 'args', `${label}.args`);
      const name = stableOwnDataValue(object, 'name', `${label}.name`);
      if (query === undefined || (args !== undefined && typeof args !== 'function')) {
        throw new TypeError(`${label} must expose stable query and optional args data.`);
      }
      if (name !== undefined && typeof name !== 'string') {
        throw new TypeError(`${label}.name must be a stable string when present.`);
      }
      return witnessFreeze({
        ...(args === undefined ? {} : { args }),
        ...(name === undefined ? {} : { name }),
        query: snapshotAppQuery(query as AppQueryDeclaration, context),
      });
    },
  );
}

function snapshotLiveTargetErrorBoundary(source: unknown): Readonly<Record<string, unknown>> {
  const object = requireDeclarationObject(source, 'liveTargetRenderer.errorBoundary');
  const render = stableOwnDataValue(object, 'render', 'liveTargetRenderer.errorBoundary.render');
  const target = stableOwnDataValue(object, 'target', 'liveTargetRenderer.errorBoundary.target');
  if (typeof render !== 'function') {
    throw new TypeError('liveTargetRenderer.errorBoundary.render must be a stable function.');
  }
  if (target !== undefined && typeof target !== 'string') {
    throw new TypeError('liveTargetRenderer.errorBoundary.target must be a stable string.');
  }
  return witnessFreeze({
    render,
    ...(target === undefined ? {} : { target }),
  });
}

/** Snapshot the complete app-wide CSRF posture before evaluated app state can mutate it. */
export function snapshotAppCsrfOptions<Request>(
  source: CsrfOptions<Request>,
): CsrfOptions<Request> {
  const object = requireDeclarationObject(source, 'app.csrf');
  const secret = stableOwnDataValue(object, 'secret', 'app.csrf.secret');
  const sessionId = stableOwnDataValue(object, 'sessionId', 'app.csrf.sessionId');
  if (secret === undefined || typeof sessionId !== 'function') {
    throw new TypeError('app.csrf must expose stable secret and sessionId data properties.');
  }

  const field = stableOwnDataValue(object, 'field', 'app.csrf.field');
  if (field !== undefined && typeof field !== 'string') {
    throw new TypeError('app.csrf.field must be a stable string data property.');
  }
  const trustedOriginsSource = stableOwnDataValue(
    object,
    'trustedOrigins',
    'app.csrf.trustedOrigins',
  );
  let trustedOrigins: readonly string[] | undefined;
  if (trustedOriginsSource !== undefined) {
    const values = denseArrayValues(
      trustedOriginsSource as readonly unknown[],
      'app.csrf.trustedOrigins',
    );
    const origins: string[] = [];
    for (let index = 0; index < values.length; index += 1) {
      const origin = values[index];
      if (typeof origin !== 'string') {
        throw new TypeError('app.csrf.trustedOrigins must contain only stable strings.');
      }
      witnessArrayAppend(origins, origin, 'App CSRF trusted origin snapshot');
    }
    trustedOrigins = witnessFreeze(origins);
  }
  const anonymousCookieSource = stableOwnDataValue(
    object,
    'anonymousCookie',
    'app.csrf.anonymousCookie',
  );
  const anonymousCookie = snapshotAnonymousCookie(anonymousCookieSource);

  // Resolve byte arrays and declarative key rings now. The resulting key-ring identity is pinned
  // in the frozen aggregate, so later mutation of authoring objects cannot swap signing material.
  const pinnedSecret =
    typeof secret === 'string'
      ? secret
      : signingKeyRingFromSecret(secret as CsrfOptions<Request>['secret']);
  return witnessFreeze({
    ...(anonymousCookie === undefined ? {} : { anonymousCookie }),
    ...(field === undefined ? {} : { field }),
    secret: pinnedSecret,
    sessionId: sessionId as CsrfOptions<Request>['sessionId'],
    ...(trustedOrigins === undefined ? {} : { trustedOrigins }),
  });
}

/** Snapshot the error-shell callback identities used by the framework request shell. */
export function snapshotAppErrorShells(source: AppErrorShellOptions): AppErrorShellOptions {
  const object = requireDeclarationObject(source, 'app.errorShells');
  const snapshot = witnessCreateNullRecord<unknown>() as AppErrorShellOptions;
  const fields = ['forbidden', 'notFound', 'serverError'] as const;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    const renderer = stableOwnDataValue(object, field, `app.errorShells.${field}`);
    if (renderer !== undefined && typeof renderer !== 'function') {
      throw new TypeError(`app.errorShells.${field} must be a stable function data property.`);
    }
    if (renderer !== undefined) (snapshot as Record<string, unknown>)[field] = renderer;
  }
  return witnessFreeze(snapshot);
}

/** Snapshot a task registry entry, including immutable retry and recurring argument topology. */
export function snapshotAppTask(source: AppTaskDeclaration, index = 0): AppTaskDeclaration {
  const record = snapshotOwnDataRecord(source, `app.tasks[${index}]`);
  snapshotSchemaProperty(record, 'input', `app.tasks[${index}].input`);
  if (record.retry !== undefined) {
    record.retry = witnessFreeze(snapshotOwnDataRecord(record.retry, `app.tasks[${index}].retry`));
  }
  if (record.cronArgs !== undefined) {
    record.cronArgs = snapshotImmutableTaskData(
      record.cronArgs,
      `app.tasks[${index}].cronArgs`,
      createWitnessWeakSet(),
    );
  }
  return witnessFreeze(record) as AppTaskDeclaration;
}

/** Reconstruct one runtime-blocking diagnostic so app code cannot rewrite dispatch policy. */
function snapshotAppDiagnostic(source: AppDiagnostic, index: number): AppDiagnostic {
  const label = `app.diagnostics[${index}]`;
  const record = snapshotOwnDataRecord(source, label);
  if (
    typeof record.code !== 'string' ||
    typeof record.fileName !== 'string' ||
    typeof record.message !== 'string' ||
    (record.help !== undefined && typeof record.help !== 'string') ||
    (record.length !== undefined &&
      (!nativeNumberIsSafeInteger(record.length) || record.length < 0)) ||
    (record.severity !== undefined &&
      record.severity !== 'error' &&
      record.severity !== 'warn' &&
      record.severity !== 'lint' &&
      record.severity !== 'notice')
  ) {
    throw new TypeError(`${label} must contain stable diagnostic scalar fields.`);
  }
  if (record.start !== undefined) {
    const start = snapshotOwnDataRecord(record.start, `${label}.start`);
    if (
      !nativeNumberIsSafeInteger(start.column) ||
      start.column < 0 ||
      !nativeNumberIsSafeInteger(start.line) ||
      start.line < 0
    ) {
      throw new TypeError(`${label}.start must contain non-negative integer column and line.`);
    }
    record.start = witnessFreeze(start);
  }
  return witnessFreeze(record) as AppDiagnostic;
}

/**
 * Close and identity-mark a Kovo aggregate after all load-bearing declaration registries have been
 * rebuilt as dense frozen arrays of canonical declarations (SPEC §9.5/§10.2).
 */
export function closeKovoAppAggregate<App extends KovoApp>(
  source: App,
  context: AppDeclarationSnapshotContext = createAppDeclarationSnapshotContext(),
): App {
  // Snapshot top-level queries first so layout/mutation references converge on these identities.
  const queries = snapshotAppRegistry(source.queries, 'app.queries', (value) =>
    snapshotAppQuery(value, context),
  );
  const routes = snapshotAppRegistry(source.routes, 'app.routes', (value) =>
    snapshotAppRoute(value, context),
  );
  const mutations = snapshotAppRegistry(source.mutations, 'app.mutations', (value) =>
    snapshotAppMutation(value, context),
  );
  const endpoints = snapshotAppRegistry(source.endpoints, 'app.endpoints', (value) =>
    snapshotAppEndpoint(value, context),
  );
  const liveTargetRenderers = snapshotLiveTargetRenderers(source.liveTargetRenderers, context);
  const diagnostics = snapshotAppRegistry(
    source.diagnostics,
    'app.diagnostics',
    snapshotAppDiagnostic,
  );
  const stylesheets = snapshotStylesheetArray(source.stylesheets, 'app.stylesheets');
  const tasks = snapshotAppRegistry(source.tasks, 'app.tasks', snapshotAppTask);
  const errorShells = snapshotAppErrorShells(source.errorShells);
  const csrf = source.csrf === undefined ? undefined : snapshotAppCsrfOptions(source.csrf);
  const mutationReplayStore =
    source.mutationReplayStore === undefined
      ? undefined
      : snapshotMutationReplayStore(source.mutationReplayStore);

  const aggregate = witnessFreeze({
    ...source,
    ...(csrf === undefined ? {} : { csrf }),
    diagnostics,
    endpoints,
    errorShells,
    liveTargetRenderers,
    mutations,
    ...(mutationReplayStore === undefined ? {} : { mutationReplayStore }),
    queries,
    routes,
    stylesheets,
    tasks,
  }) as App;
  return markClosedKovoApp(aggregate);
}

/** @internal Derive a trusted dev/build app without reopening the public structural boundary. */
export function deriveClosedKovoApp<App extends KovoApp>(
  source: App,
  overrides: Partial<App>,
): App {
  if (!isKovoApp(source)) {
    throw new TypeError('Kovo app derivation requires a closed createApp() aggregate.');
  }
  const derived = closeKovoAppAggregate({ ...source, ...overrides } as App);
  inheritAppLiveTargetIdentity(source, derived);
  return derived;
}

function snapshotMutationRegistry(
  source: unknown,
  context: AppDeclarationSnapshotContext,
): Readonly<Record<string, unknown>> {
  const record = snapshotOwnDataRecord(source, 'mutation.registry', omittedProperties('queries'));
  const queries = stableOwnDataValue(
    requireDeclarationObject(source, 'mutation.registry'),
    'queries',
    'mutation.registry.queries',
  );
  if (queries !== undefined) {
    record.queries = snapshotAppRegistry(
      queries as readonly AppQueryDeclaration[],
      'mutation.registry.queries',
      (queryDefinition) => snapshotAppQuery(queryDefinition, context),
    );
  }
  snapshotMutationTouchArrayProperty(
    record,
    'inferredTouches',
    'mutation.registry.inferredTouches',
  );
  snapshotStringArrayProperty(record, 'tables', 'mutation.registry.tables');
  snapshotDomainArrayProperty(record, 'touches', 'mutation.registry.touches');
  return witnessFreeze(record);
}

function snapshotWebhookDefinition(source: unknown): Readonly<Record<string, unknown>> {
  const object = requireDeclarationObject(source, 'webhookDefinition');
  // Verification is security topology just like route.layout. Reject a Proxy get/descriptor split
  // and then preserve only the stable descriptor value in the canonical definition.
  const verify = stableOwnDataValue(object, 'verify', 'webhookDefinition.verify');
  const record = snapshotOwnDataRecord(object, 'webhookDefinition', omittedProperties('verify'));
  record.verify = verify === 'none' ? verify : snapshotWebhookVerifier(verify);
  if (verify === 'none') {
    record.verifyJustification = snapshotAuditJustification(
      record.verifyJustification,
      'app webhook verify:none snapshot (SPEC §9.1)',
    );
  }
  snapshotArrayProperty(record, 'writes', 'webhookDefinition.writes');
  return witnessFreeze(record);
}

function snapshotWebhookVerifier(source: unknown): WebhookVerifier {
  const object = requireDeclarationObject(source, 'webhookDefinition.verify');
  const kind = stableOwnDataValue(object, 'kind', 'webhookDefinition.verify.kind');

  if (kind === 'hmac') {
    if (!isFrameworkHmacSignatureVerifier(object)) {
      throw new TypeError(
        'webhookDefinition.verify kind "hmac" must come from hmacSignature() or a framework preset.',
      );
    }
    // Preserve the exact branded identity. hmacSignature() already freezes its public metadata
    // and closes its executable method over a private semantic snapshot, so reconstructing from
    // byte-shaped audit config would be both weaker and unnecessary.
    return object;
  }
  if (kind !== 'custom') {
    throw new TypeError('webhookDefinition.verify.kind must be "custom" or "hmac".');
  }

  const name = stableOwnDataValue(object, 'name', 'webhookDefinition.verify.name');
  const scheme = stableOwnDataValue(object, 'scheme', 'webhookDefinition.verify.scheme');
  const verify = stableOwnDataValue(object, 'verify', 'webhookDefinition.verify.verify');
  if (typeof verify !== 'function') {
    throw new TypeError('webhookDefinition.verify must expose stable custom verifier metadata.');
  }
  const closedName = snapshotAuditText(name, 'app webhook custom verifier name (SPEC §9.1)');
  const closedScheme = snapshotAuditText(scheme, 'app webhook custom verifier scheme (SPEC §9.1)');

  let canonical: CustomWebhookVerifier;
  canonical = witnessFreeze({
    kind: 'custom',
    name: closedName,
    scheme: closedScheme,
    async verify(request: WebhookVerificationRequest): Promise<boolean> {
      return (await witnessReflectApply(verify, canonical, [request])) === true;
    },
  });
  return canonical;
}

function snapshotLayoutQueries(
  source: unknown,
  context: AppDeclarationSnapshotContext,
): Readonly<Record<string, AppQueryDeclaration>> {
  const record = snapshotOwnDataRecord(source, 'layout.queries');
  const keys = witnessObjectKeys(record);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    record[key] = snapshotAppQuery(record[key] as AppQueryDeclaration, context);
  }
  return witnessFreeze(record) as Readonly<Record<string, AppQueryDeclaration>>;
}

function snapshotRouteHintArrays(record: Record<PropertyKey, any>, label: string): void {
  const fields = [
    'i18n',
    'meta',
    'modulepreloads',
    'prerenderUrls',
    'staticPaths',
    'stylesheets',
  ] as const;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field === 'stylesheets') {
      snapshotStylesheetArrayProperty(record, field, `${label}.${field}`);
    } else {
      snapshotArrayProperty(record, field, `${label}.${field}`);
    }
  }
}

function snapshotAnonymousCookie(source: unknown): CsrfAnonymousCookieOptions | false | undefined {
  if (source === undefined || source === false) return source;
  const object = requireDeclarationObject(source, 'app.csrf.anonymousCookie');
  const snapshot = witnessCreateNullRecord<unknown>() as CsrfAnonymousCookieOptions;
  const fields = ['maxAge', 'name', 'path', 'sameSite', 'secure'] as const;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    const value = stableOwnDataValue(object, field, `app.csrf.anonymousCookie.${field}`);
    if (value === undefined) continue;
    if (field === 'maxAge' && (typeof value !== 'number' || !nativeNumberIsFinite(value))) {
      throw new TypeError('app.csrf.anonymousCookie.maxAge must be a finite number.');
    }
    if ((field === 'name' || field === 'path') && typeof value !== 'string') {
      throw new TypeError(`app.csrf.anonymousCookie.${field} must be a string.`);
    }
    if (field === 'sameSite' && value !== 'lax' && value !== 'none' && value !== 'strict') {
      throw new TypeError('app.csrf.anonymousCookie.sameSite must be lax, none, or strict.');
    }
    if (field === 'secure' && typeof value !== 'boolean') {
      throw new TypeError('app.csrf.anonymousCookie.secure must be a boolean.');
    }
    (snapshot as Record<string, unknown>)[field] = value;
  }
  return witnessFreeze(snapshot);
}

function snapshotImmutableTaskData(
  value: unknown,
  label: string,
  ancestors: WeakSet<object>,
): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (typeof value === 'function') {
    throw new TypeError(`${label} must contain serializable data, not functions.`);
  }
  if (witnessWeakSetHas(ancestors, value)) {
    throw new TypeError(`${label} must not contain cyclic data.`);
  }
  witnessWeakSetAdd(ancestors, value);
  try {
    if (nativeArrayIsArray(value)) {
      const values = denseArrayValues(value, label);
      const snapshot: unknown[] = [];
      for (let index = 0; index < values.length; index += 1) {
        witnessArrayAppend(
          snapshot,
          snapshotImmutableTaskData(values[index], `${label}[${index}]`, ancestors),
          `${label} immutable task data snapshot`,
        );
      }
      return witnessFreeze(snapshot);
    }

    const snapshot = witnessCreateNullRecord<unknown>();
    const keys = witnessOwnKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key === 'symbol') {
        throw new TypeError(`${label} must not contain symbol-keyed data.`);
      }
      const descriptor = witnessGetOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError(`${label}.${key} must be a stable own data property.`);
      }
      snapshot[key] = snapshotImmutableTaskData(descriptor.value, `${label}.${key}`, ancestors);
    }
    return witnessFreeze(snapshot);
  } finally {
    witnessWeakSetDelete(ancestors, value);
  }
}

function snapshotStylesheetArray(
  source: readonly (string | StylesheetAsset)[],
  label: string,
): readonly (string | StylesheetAsset)[] {
  const values = denseArrayValues(source, label);
  const snapshot: (string | StylesheetAsset)[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (typeof value === 'string') witnessArrayAppend(snapshot, value, `${label} string snapshot`);
    else witnessArrayAppend(snapshot, snapshotStylesheetAsset(value), `${label} asset snapshot`);
  }
  return witnessFreeze(snapshot);
}

function snapshotStylesheetArrayProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined) return;
  record[property] = snapshotStylesheetArray(value, label);
}

function snapshotArrayProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined || !nativeArrayIsArray(value)) return;
  record[property] = witnessFreeze(denseArrayValues(value, label));
}

function snapshotStringArrayProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined) return;
  const values = denseArrayValues(value, label);
  for (let index = 0; index < values.length; index += 1) {
    if (typeof values[index] !== 'string') {
      throw new TypeError(`${label}[${index}] must be a stable string.`);
    }
  }
  record[property] = witnessFreeze(values);
}

function snapshotDomainArrayProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined) return;
  const values = denseArrayValues(value, label);
  const snapshot: { key: string }[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const source = requireDeclarationObject(values[index], `${label}[${index}]`);
    const key = stableOwnDataValue(source, 'key', `${label}[${index}].key`);
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`${label}[${index}].key must be a non-empty stable string.`);
    }
    witnessArrayAppend(snapshot, witnessFreeze({ key }), `${label} domain snapshot`);
  }
  record[property] = witnessFreeze(snapshot);
}

function snapshotQueryDeltaArrayProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined) return;
  const values = denseArrayValues(value, label);
  const snapshot: { domain: string; key: string; path: string }[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const entryLabel = `${label}[${index}]`;
    const source = requireDeclarationObject(values[index], entryLabel);
    const domain = stableOwnDataValue(source, 'domain', `${entryLabel}.domain`);
    const key = stableOwnDataValue(source, 'key', `${entryLabel}.key`);
    const path = stableOwnDataValue(source, 'path', `${entryLabel}.path`);
    if (typeof domain !== 'string' || typeof key !== 'string' || typeof path !== 'string') {
      throw new TypeError(`${entryLabel} must contain stable string domain, key, and path data.`);
    }
    witnessArrayAppend(snapshot, witnessFreeze({ domain, key, path }), `${label} entry snapshot`);
  }
  record[property] = witnessFreeze(snapshot);
}

function snapshotMutationTouchArrayProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined) return;
  const values = denseArrayValues(value, label);
  const snapshot: { crossTable?: true; domain: string; keys: null | string; via?: string }[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const entryLabel = `${label}[${index}]`;
    const source = requireDeclarationObject(values[index], entryLabel);
    const crossTable = stableOwnDataValue(source, 'crossTable', `${entryLabel}.crossTable`);
    const domain = stableOwnDataValue(source, 'domain', `${entryLabel}.domain`);
    const keys = stableOwnDataValue(source, 'keys', `${entryLabel}.keys`);
    const via = stableOwnDataValue(source, 'via', `${entryLabel}.via`);
    if (
      (crossTable !== undefined && crossTable !== true) ||
      typeof domain !== 'string' ||
      (keys !== null && typeof keys !== 'string') ||
      (via !== undefined && typeof via !== 'string')
    ) {
      throw new TypeError(
        `${entryLabel} must contain stable domain/keys and optional crossTable/via data.`,
      );
    }
    witnessArrayAppend(
      snapshot,
      witnessFreeze({
        ...(crossTable === true ? { crossTable: true as const } : {}),
        domain,
        keys,
        ...(via === undefined ? {} : { via }),
      }),
      `${label} entry snapshot`,
    );
  }
  record[property] = witnessFreeze(snapshot);
}

function snapshotRedirectAllowlistProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined) return;
  const values = denseArrayValues(value, label);
  const snapshot: { origin: string; reason: string }[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const entryLabel = `${label}[${index}]`;
    const source = requireDeclarationObject(values[index], entryLabel);
    const origin = stableOwnDataValue(source, 'origin', `${entryLabel}.origin`);
    const reason = stableOwnDataValue(source, 'reason', `${entryLabel}.reason`);
    if (typeof origin !== 'string') {
      throw new TypeError(`${entryLabel} requires stable origin and non-empty reason strings.`);
    }
    witnessArrayAppend(
      snapshot,
      witnessFreeze({ origin, reason: snapshotAuditReason(reason, entryLabel) }),
      `${label} entry snapshot`,
    );
  }
  record[property] = witnessFreeze(snapshot);
}

function snapshotSchemaProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined) return;
  record[property] = snapshotSchemaForRuntime(value as Schema<unknown>, label);
}

function snapshotSchemaRecordProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
): void {
  const value = record[property];
  if (value === undefined) return;
  const source = requireDeclarationObject(value, label);
  const snapshot: Record<PropertyKey, Schema<unknown>> = {};
  const keys = witnessOwnKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(source, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label}.${String(key)} must be a stable own data property.`);
    }
    witnessDefineProperty(snapshot, key, {
      configurable: false,
      enumerable: descriptor.enumerable === true,
      value: snapshotSchemaForRuntime(
        descriptor.value as Schema<unknown>,
        `${label}.${String(key)}`,
      ),
      writable: false,
    });
  }
  record[property] = witnessFreeze(snapshot);
}

/**
 * Rebuild nested executable declaration maps before request dispatch (SPEC §6.6/§9.5 C9).
 * Freezing only the route/layout shell would otherwise retain a mutable `regions`/`boundaries`
 * object whose function slots can be replaced after createApp() has closed the aggregate.
 */
function snapshotFunctionRecordProperty(
  record: Record<PropertyKey, any>,
  property: PropertyKey,
  label: string,
  allowedKeys?: readonly string[],
): void {
  const value = record[property];
  if (value === undefined) return;
  const source = requireDeclarationObject(value, label);
  const snapshot = witnessCreateNullRecord<Function>();
  const keys = witnessOwnKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string' || !functionRecordKeyAllowed(key, allowedKeys)) {
      throw new TypeError(`${label}.${String(key)} is not a supported renderer property.`);
    }
    const descriptor = witnessGetOwnPropertyDescriptor(source, key);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`${label}.${key} must be a stable own function data property.`);
    }
    witnessDefineProperty(snapshot, key, {
      configurable: false,
      enumerable: descriptor.enumerable === true,
      value: descriptor.value,
      writable: false,
    });
  }
  record[property] = witnessFreeze(snapshot);
}

function functionRecordKeyAllowed(
  key: string,
  allowedKeys: readonly string[] | undefined,
): boolean {
  if (allowedKeys === undefined) return true;
  for (let index = 0; index < allowedKeys.length; index += 1) {
    if (allowedKeys[index] === key) return true;
  }
  return false;
}

function denseArrayValues<Value>(source: readonly Value[], label: string): Value[] {
  let array = false;
  try {
    array = nativeArrayIsArray(source);
  } catch {
    throw new TypeError(`${label} must be a stable dense array.`);
  }
  if (!array) throw new TypeError(`${label} must be a stable dense array.`);

  try {
    const length = witnessGetOwnPropertyDescriptor(source, 'length');
    if (
      length === undefined ||
      !('value' in length) ||
      !nativeNumberIsSafeInteger(length.value) ||
      length.value < 0 ||
      length.value > MAX_APP_REGISTRY_LENGTH
    ) {
      throw new TypeError(`${label} must have a bounded stable length.`);
    }

    const values: Value[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const descriptor = witnessGetOwnPropertyDescriptor(source, index);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError(`${label}[${index}] must be a stable own data property.`);
      }
      witnessArrayAppend(values, descriptor.value as Value, `${label} dense value snapshot`);
    }
    return values;
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(label)) throw error;
    throw new TypeError(`${label} must expose stable own data properties.`);
  }
}

function omittedProperties(...properties: PropertyKey[]): ReadonlySet<PropertyKey> {
  const omitted = createWitnessSet<PropertyKey>();
  for (let index = 0; index < properties.length; index += 1) {
    witnessSetAdd(omitted, properties[index]!);
  }
  return omitted;
}

function snapshotOwnDataRecord(
  source: unknown,
  label: string,
  omitted: ReadonlySet<PropertyKey> = EMPTY_OMITTED_PROPERTIES,
): Record<PropertyKey, any> {
  const object = requireDeclarationObject(source, label);
  const record: Record<PropertyKey, any> = {};
  try {
    const keys = witnessOwnKeys(object);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (witnessSetHas(omitted as Set<PropertyKey>, key)) continue;
      const descriptor = witnessGetOwnPropertyDescriptor(object, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new TypeError(`${label}.${String(key)} must be a stable own data property.`);
      }
      witnessDefineProperty(record, key, {
        configurable: true,
        enumerable: descriptor.enumerable === true,
        value: descriptor.value,
        writable: true,
      });
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(label)) throw error;
    throw new TypeError(`${label} must expose stable own data properties.`);
  }
  return record;
}

function stableOwnDataValue(source: object, property: PropertyKey, label: string): unknown {
  try {
    const before = witnessGetOwnPropertyDescriptor(source, property);
    if (before !== undefined && !('value' in before)) {
      throw new TypeError(`${label} must be a stable own data property.`);
    }
    const observed = witnessReflectGet(source, property, source);
    const after = witnessGetOwnPropertyDescriptor(source, property);
    if (!sameDataDescriptor(before, after)) {
      throw new TypeError(`${label} changed while the app aggregate was assembled.`);
    }
    const descriptorValue = before === undefined ? undefined : before.value;
    if (!witnessObjectIs(observed, descriptorValue)) {
      throw new TypeError(`${label} must not disagree between descriptor and property access.`);
    }
    return descriptorValue;
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(label)) throw error;
    throw new TypeError(`${label} must expose a stable own data property.`);
  }
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function requireDeclarationObject(
  value: unknown,
  label: string,
): object & Record<PropertyKey, any> {
  if (typeof value !== 'object' || value === null || nativeArrayIsArray(value)) {
    throw new TypeError(`${label} must be an object declaration.`);
  }
  return value as object & Record<PropertyKey, any>;
}
