import type { JsonValue } from '@kovojs/core';
import type { RouteSearchValue } from '@kovojs/core';
import { publicAccess, verifiedAccess, type AccessDecision } from './access.js';
import {
  appDeclarationMetadata,
  appDeclarationOwner,
  registerAppDeclarationMetadata,
  registerAppDeclarationOwner,
  type AppDeclarationKind,
} from './app-declaration-owner.js';
import type {
  AppDocumentOptions,
  AppEgressOptions,
  AppErrorShellOptions,
  AppLifecycleRequest,
  AppMutationDeclaration,
  AppQueryDeclaration,
  AppReadRequest,
  AppRequestLimitOptions,
  AppRouteDeclaration,
  AppRouteRenderContext,
  AppTaskDeclaration,
  CreateAppOptions,
  KovoApp as RuntimeKovoApp,
} from './app-types.js';
import { createApp } from './app.js';
import { createKovoAppToken, type KovoApp } from './app-token.js';
import type {
  VersionedClientModuleRegistry,
  VersionedClientModuleStore,
} from './client-modules.js';
import type { CsrfOptions } from './csrf.js';
import type { ServerErrorHandler } from './diagnostics.js';
import type { DocumentDeclaration } from './document-structured.js';
import {
  endpoint,
  type EndpointDeclaration,
  type EndpointDefinition,
  type EndpointMethod,
  type EndpointMount,
} from './endpoint.js';
import {
  guards,
  type DbProvider,
  type FrameworkPostgresOwnerKeyColumn,
  type Guard,
  type GuardResult,
  type RateLimitOptions,
  type SessionProvider,
} from './guards.js';
import type { StylesheetAsset } from './hints.js';
import {
  mutation,
  type MutationCsrfDeclaration,
  type MutationDefinition,
  type MutationFail,
  type MutationFormDefinition,
  type MutationHandlerRequest,
} from './mutation.js';
import type { MutationReplayStore } from './replay.js';
import type { PrincipalEpochStore } from './principal-epoch.js';
import {
  query,
  type QueryDefinition,
  type QueryInstanceKey,
  type QueryLoadContext,
  type QueryReadConfig,
} from './query.js';
import type { Domain } from './domain.js';
import {
  layout,
  route,
  type LayoutDeclaration,
  type LayoutDefinition,
  type LayoutRegionResults,
  type LayoutRenderResult,
  type RouteDeclaration,
  type RouteDefinition,
  type RoutePageResult,
  type RouteRegionDefinitions,
} from './route.js';
import {
  task,
  type TaskDefinition,
  type TaskSchedulingRequest,
} from './task.js';
import type { InferSchema, Schema } from './schema.js';
import type { AppResponseHeaders } from './response.js';
import {
  createWitnessSet,
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessOwnKeys,
  witnessSetAdd,
  witnessSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

declare const appDeclarationHandleBrand: unique symbol;
declare const appOptimisticBindingBrand: unique symbol;
declare const kovoContractBrand: unique symbol;

type AppId = string | undefined;
type MaybeSchema<Value> = Schema<Value> | undefined;
type LayoutQueryMap<Request> = Readonly<
  Record<string, QueryDefinition<string, unknown, unknown, Request>>
>;
type OptimisticFunction = (...args: unknown[]) => unknown;

/** Private-witness-bearing base shared by named app-scoped declaration handles. */
export interface AppDeclarationHandle<
  Kind extends AppDeclarationKind,
  Owner extends AppId = AppId,
> {
  readonly [appDeclarationHandleBrand]: {
    readonly kind: Kind;
    readonly owner: Owner;
  };
}

/** Named app-scoped route handle. */
export interface RouteHandle<
  Path extends string = string,
  Request = unknown,
  Owner extends AppId = AppId,
> extends AppDeclarationHandle<'route', Owner> {
  readonly path: Path;
  readonly __kovoRouteRequest?: (request: Request) => Request;
}

/** Named app-scoped layout handle. */
export interface LayoutHandle<
  Request = unknown,
  Owner extends AppId = AppId,
> extends AppDeclarationHandle<'layout', Owner> {
  readonly __kovoLayoutRequest?: (request: Request) => Request;
}

/** Named app-scoped endpoint handle. */
export interface EndpointHandle<
  Path extends string = string,
  Owner extends AppId = AppId,
> extends AppDeclarationHandle<'endpoint', Owner> {
  readonly path: Path;
}

/** Named app-scoped durable-task handle. */
export interface TaskHandle<
  Input = unknown,
  Value = unknown,
  Owner extends AppId = AppId,
> extends AppDeclarationHandle<'task', Owner> {
  readonly __kovoTaskTypes?: (input: Input) => Value;
}

/** Query-handle optimistic status authored without a registry key. */
export type QueryOptimisticStatus = 'await-fragment';

/** Pure optimistic result function (SPEC §10.4). */
export type QueryOptimisticApply<Value, MutationInput> = (
  value: Readonly<Value>,
  input: MutationInput,
) => Value;

/** Key selector required by parameterized query handles. */
export interface KeyedQueryOptimisticOptions<QueryInput, Value, MutationInput> {
  apply: QueryOptimisticApply<Value, MutationInput>;
  keys: (input: MutationInput) => readonly QueryInput[];
}

/** Opaque query-bound optimistic declaration consumed by `app.mutation`. */
export interface QueryOptimisticBinding<
  MutationInput = unknown,
  Value = unknown,
  Owner extends AppId = AppId,
> {
  readonly [appOptimisticBindingBrand]: {
    readonly input: MutationInput;
    readonly owner: Owner;
    readonly value: Value;
  };
}

type QueryOptimisticMethod<QueryInput, Value, Owner extends AppId> =
  [QueryInput] extends [undefined]
    ? {
        optimistic<MutationInput>(
          apply: QueryOptimisticApply<Value, MutationInput> | QueryOptimisticStatus,
        ): QueryOptimisticBinding<MutationInput, Value, Owner>;
      }
    : {
        optimistic<MutationInput>(
          options:
            | KeyedQueryOptimisticOptions<QueryInput, Value, MutationInput>
            | QueryOptimisticStatus,
        ): QueryOptimisticBinding<MutationInput, Value, Owner>;
      };

/** Named app-scoped query handle with inferred input/result and handle-bound optimism. */
export type QueryHandle<
  QueryInput = undefined,
  Value = JsonValue,
  Owner extends AppId = AppId,
  Request = unknown,
> = QueryDefinition<string, Value, QueryInput, Request> &
  AppDeclarationHandle<'query', Owner> &
  QueryOptimisticMethod<QueryInput, Value, Owner>;

/** Named app-scoped mutation handle with inferred input/result/error payloads. */
export interface MutationHandle<
  Input = unknown,
  Value = unknown,
  Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
  Request = unknown,
  Owner extends AppId = AppId,
> extends AppDeclarationHandle<'mutation', Owner> {
  readonly __kovoMutationTypes?: (
    input: Input,
    request: Request,
    errors: Errors,
  ) => Value;
}

type GuardRefinedRequest<Base, Candidate> = Candidate extends Guard<
  infer _Input,
  infer Refined
>
  ? Base & Refined
  : Base;

type AccessRefinedRequest<Base, Access> = Access extends readonly []
  ? Base
  : Access extends readonly [infer First, ...infer Rest]
    ? AccessRefinedRequest<Base & GuardRefinedRequest<Base, First>, Rest>
    : Access extends readonly (infer Item)[]
      ? Base & GuardRefinedRequest<Base, Item>
      : Base;

interface AppQueryDefinition<
  Request,
  Input,
  Value extends JsonValue,
  Access extends AccessDecision,
> {
  access: Access;
  delta?: QueryDefinition<string, Value, Input, Request>['delta'];
  guard?: never;
  instanceKey?: QueryInstanceKey<Input>;
  load?: (
    input: Input,
    context: QueryLoadContext<Request>,
  ) => Promise<Value> | Value;
  output?: Schema<Value>;
  read?: QueryReadConfig;
  reads?: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
}

/** Query factory bound to one app request/session/DB/env contract. */
export interface AppQueryFactory<Request, Owner extends AppId> {
  <
    const Access extends AccessDecision,
    Value extends JsonValue = JsonValue,
  >(
    definition: AppQueryDefinition<
      AccessRefinedRequest<Request, Access>,
      undefined,
      Value,
      Access
    > & { args?: never },
  ): QueryHandle<
    undefined,
    Value,
    Owner,
    AccessRefinedRequest<Request, Access>
  >;
  <
    Input,
    const Access extends AccessDecision,
    Value extends JsonValue = JsonValue,
  >(
    definition: AppQueryDefinition<
      AccessRefinedRequest<Request, Access>,
      Input,
      Value,
      Access
    > & { args: Schema<Input> },
  ): QueryHandle<
    Input,
    Value,
    Owner,
    AccessRefinedRequest<Request, Access>
  >;
}

type AppMutationDefinition<
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends MutationHandlerRequest<Request>,
  Owner extends AppId,
> = Omit<
  MutationDefinition<
    string,
    InputSchema,
    Errors,
    MutationHandlerRequest<Request>,
    Value,
    GuardedRequest
  >,
  | 'access'
  | 'csrf'
  | 'csrfJustification'
  | 'guard'
  | 'key'
  | 'machineReplayPrincipal'
  | 'optimistic'
> & {
  access: AccessDecision;
  optimistic?: readonly QueryOptimisticBinding<InferSchema<InputSchema>, unknown, Owner>[];
} & MutationCsrfDeclaration<MutationHandlerRequest<Request>, GuardedRequest>;

/** Mutation factory bound to one app request/session/DB/env contract. */
export interface AppMutationFactory<Request, Owner extends AppId> {
  <
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
    Value = unknown,
    GuardedRequest extends MutationHandlerRequest<Request> = MutationHandlerRequest<Request>,
  >(
    definition: AppMutationDefinition<
      InputSchema,
      Errors,
      Request,
      Value,
      GuardedRequest,
      Owner
    >,
  ): MutationDefinition<string, InputSchema, Errors, GuardedRequest, Value, GuardedRequest> &
    MutationFormDefinition<string, GuardedRequest> &
    MutationHandle<InferSchema<InputSchema>, Value, Errors, GuardedRequest, Owner>;
}

/** Endpoint factory with its managed DB context inferred from `defineKovo({ db })`. */
export interface AppEndpointFactory<Db, Owner extends AppId> {
  <
    const Path extends string,
    const Method extends EndpointMethod = EndpointMethod,
    const Mount extends EndpointMount = 'exact',
  >(
    path: Path,
    definition: EndpointDefinition<Method, Mount, Db>,
  ): EndpointDeclaration<Path, Method, Mount, Db> & EndpointHandle<Path, Owner>;
}

/** Route factory with params/search and lifecycle request inferred from the app contract. */
export interface AppRouteFactory<Request, Owner extends AppId> {
  <
    const Path extends string,
    const ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
    const SearchSchema extends MaybeSchema<Record<string, RouteSearchValue>> = undefined,
    Page extends RoutePageResult = RoutePageResult,
    Regions extends RouteRegionDefinitions<any, Request, Page> = RouteRegionDefinitions<
      any,
      Request,
      Page
    >,
  >(
    path: Path,
    definition: Omit<
      RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, Request, Regions>,
      'access' | 'guard'
    > & { access: AccessDecision; guard?: never },
  ): RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, Request> &
    RouteHandle<Path, Request, Owner>;
}

/** Layout factory bound to the app read request. */
export interface AppLayoutFactory<Request, Owner extends AppId> {
  <
    const Queries extends LayoutQueryMap<Request> = LayoutQueryMap<Request>,
    Page extends LayoutRenderResult = LayoutRenderResult,
    Regions extends LayoutRegionResults = LayoutRegionResults,
  >(
    definition: Omit<LayoutDefinition<Request, Queries, Page, Regions>, 'access' | 'guard'> &
      (
        | { access: AccessDecision; guard?: never }
        | { access?: never; guard?: never }
      ),
  ): LayoutDeclaration<Request, Queries, Page, Regions> & LayoutHandle<Request, Owner>;
}

/** Durable-task factory returning an app-owned named handle. */
export interface AppTaskFactory<Owner extends AppId> {
  <InputSchema extends Schema<unknown>, Value = unknown>(
    definition: Omit<TaskDefinition<string, InputSchema, Value>, 'key'>,
  ): TaskDefinition<string, InputSchema, Value> &
    TaskHandle<InferSchema<InputSchema>, Value, Owner>;
}

/** Provider/config declarations captured inertly by `defineKovo`. */
export interface DefineKovoOptions<
  RawRequest extends globalThis.Request,
  SessionValue,
  DbValue,
  EnvValue extends Record<string, unknown>,
  Request,
  Owner extends AppId,
> {
  appId?: Owner;
  auth?: SessionProvider<RawRequest, SessionValue>;
  clientModules?: VersionedClientModuleStore | VersionedClientModuleRegistry;
  csrf?: CsrfOptions<Request>;
  db?: DbProvider<RawRequest, DbValue, SessionValue>;
  document?: AppDocumentOptions | DocumentDeclaration;
  egress?: AppEgressOptions;
  env?: Schema<EnvValue>;
  /** Explicit operator snapshot seam for tests and custom supported hosts. */
  envSource?: Record<string, unknown>;
  errorShells?: AppErrorShellOptions;
  mutationReplayStore?: MutationReplayStore;
  onError?: ServerErrorHandler;
  principalEpochStore?: PrincipalEpochStore;
  renderRoute?: (value: unknown, context: AppRouteRenderContext) => Promise<string> | string;
  requestLimits?: AppRequestLimitOptions;
  stylesheets?: readonly (string | StylesheetAsset)[];
}

/** Explicit declaration inventory consumed once by `app.assemble()`. */
export interface AppAssemblyOptions<
  Request,
  DbValue,
  Owner extends AppId,
> {
  endpoints?: readonly (
    | (EndpointDeclaration<string, EndpointMethod, EndpointMount, DbValue> &
        AppDeclarationHandle<'endpoint', Owner>)
  )[];
  layouts?: readonly (
    | (LayoutDeclaration<Request, any, any, any> &
        AppDeclarationHandle<'layout', Owner>)
  )[];
  mutations?: readonly (
    | (AppMutationDeclaration<Request> & AppDeclarationHandle<'mutation', Owner>)
  )[];
  queries?: readonly (
    | (AppQueryDeclaration<Request> & AppDeclarationHandle<'query', Owner>)
  )[];
  routes?: readonly (
    | (AppRouteDeclaration<Request> & AppDeclarationHandle<'route', Owner>)
  )[];
  tasks?: readonly (
    | (AppTaskDeclaration<Request> & AppDeclarationHandle<'task', Owner>)
  )[];
}

/** App request refined by the executable `app.authenticated` guard. */
export type AuthenticatedAppRequest<Request> = Request extends {
  session: infer Session;
}
  ? Request & { session: NonNullable<Session> }
  : Request;

/**
 * Value-level app context. Factories, guards, env, and final assembly all share one private owner
 * identity (SPEC §6.2.1).
 */
export interface KovoContract<
  RawRequest extends globalThis.Request = globalThis.Request,
  SessionValue = never,
  DbValue = never,
  EnvValue extends Record<string, unknown> = Record<never, never>,
  Request = AppLifecycleRequest<RawRequest, SessionValue, DbValue, EnvValue>,
  Owner extends AppId = AppId,
> {
  readonly [kovoContractBrand]: {
    readonly db: DbValue;
    readonly env: EnvValue;
    readonly owner: Owner;
    readonly rawRequest: RawRequest;
    readonly request: Request;
    readonly session: SessionValue;
  };
  readonly authenticated: Guard<Request, AuthenticatedAppRequest<Request>>;
  readonly endpoint: AppEndpointFactory<DbValue, Owner>;
  readonly env: Readonly<EnvValue>;
  readonly layout: AppLayoutFactory<AppReadRequest<Request>, Owner>;
  readonly mutation: AppMutationFactory<Request & TaskSchedulingRequest, Owner>;
  readonly publicAccess: typeof publicAccess;
  readonly query: AppQueryFactory<AppReadRequest<Request>, Owner>;
  readonly route: AppRouteFactory<AppReadRequest<Request>, Owner>;
  readonly task: AppTaskFactory<Owner>;
  readonly verifiedAccess: typeof verifiedAccess;
  all<RefinedRequest extends Request = Request>(
    ...items: Guard<Request, RefinedRequest>[]
  ): Guard<Request, RefinedRequest>;
  assemble(
    options: AppAssemblyOptions<Request, DbValue, Owner>,
  ): KovoApp<KovoContract<RawRequest, SessionValue, DbValue, EnvValue, Request, Owner>>;
  owns<KeyedRequest extends Request = Request, Key = unknown>(
    keyOf: (request: KeyedRequest) => Key,
    keyColumn: FrameworkPostgresOwnerKeyColumn<Key>,
  ): Guard<Request>;
  rateLimit(options: RateLimitOptions<Request>): Guard<Request>;
  role(role: string): Guard<Request>;
}

interface ContractState {
  readonly config: Readonly<Record<string, unknown>>;
  readonly contract: object;
  readonly declarations: Record<AppDeclarationKind, object[]>;
  phase: 'assembling' | 'closed' | 'failed' | 'open';
  runtimeApp?: RuntimeKovoApp;
}

interface OptimisticBindingState {
  readonly apply?: OptimisticFunction;
  readonly keys?: OptimisticFunction;
  readonly owner: object;
  readonly query: QueryDefinition<string, unknown, unknown, unknown>;
  readonly status: QueryOptimisticStatus | 'hand-written';
}

const contractStates = createWitnessWeakMap<object, ContractState>();
const optimisticBindings = createWitnessWeakMap<object, OptimisticBindingState>();

/**
 * Declare one app context without evaluating any live provider. Provider invocation begins only
 * inside the returned contract's one `assemble()` call (SPEC §6.2.1/§9.5).
 */
export function defineKovo<
  RawRequest extends globalThis.Request = globalThis.Request,
  SessionValue = never,
  DbValue = never,
  EnvValue extends Record<string, unknown> = Record<never, never>,
  Request = AppLifecycleRequest<RawRequest, SessionValue, DbValue, EnvValue>,
  const Owner extends AppId = undefined,
>(
  options: DefineKovoOptions<
    RawRequest,
    SessionValue,
    DbValue,
    EnvValue,
    Request,
    Owner
  >,
): KovoContract<RawRequest, SessionValue, DbValue, EnvValue, Request, Owner> {
  const config = snapshotContractOptions(options);
  const contract = witnessCreateNullRecord<unknown>();
  const state: ContractState = {
    config,
    contract,
    declarations: {
      endpoint: [],
      layout: [],
      mutation: [],
      query: [],
      route: [],
      task: [],
    },
    phase: 'open',
  };
  witnessWeakMapSet(contractStates, contract, state);

  const authenticated = guards.authed<any>() as Guard<
    Request,
    AuthenticatedAppRequest<Request>
  >;
  witnessDefineProperty(contract, 'authenticated', immutable(authenticated));
  witnessDefineProperty(contract, 'publicAccess', immutable(publicAccess));
  witnessDefineProperty(contract, 'verifiedAccess', immutable(verifiedAccess));
  witnessDefineProperty(
    contract,
    'env',
    immutableGetter(() => contractRuntimeApp(state, 'app.env').env),
  );
  witnessDefineProperty(
    contract,
    'query',
    immutable(createAppQueryFactory<Request, Owner>(state)),
  );
  witnessDefineProperty(
    contract,
    'mutation',
    immutable(createAppMutationFactory<Request & TaskSchedulingRequest, Owner>(state)),
  );
  witnessDefineProperty(
    contract,
    'route',
    immutable(createAppRouteFactory<AppReadRequest<Request>, Owner>(state)),
  );
  witnessDefineProperty(
    contract,
    'layout',
    immutable(createAppLayoutFactory<AppReadRequest<Request>, Owner>(state)),
  );
  witnessDefineProperty(
    contract,
    'endpoint',
    immutable(createAppEndpointFactory<DbValue, Owner>(state)),
  );
  witnessDefineProperty(contract, 'task', immutable(createAppTaskFactory<Owner>(state)));
  witnessDefineProperty(
    contract,
    'all',
    immutable((...items: Guard<Request, Request>[]) => guards.all(...items)),
  );
  witnessDefineProperty(
    contract,
    'role',
    immutable((roleName: string) => guards.role<any>(roleName) as Guard<Request>),
  );
  witnessDefineProperty(
    contract,
    'rateLimit',
    immutable(
      (rateOptions: RateLimitOptions<Request>) =>
        guards.rateLimit<any>(rateOptions as RateLimitOptions<any>) as Guard<Request>,
    ),
  );
  witnessDefineProperty(
    contract,
    'owns',
    immutable(
      (
        keyOf: (request: Request) => unknown,
        keyColumn: FrameworkPostgresOwnerKeyColumn<unknown>,
      ) => guards.owns<any, any, unknown>(keyOf, keyColumn) as Guard<Request>,
    ),
  );
  witnessDefineProperty(
    contract,
    'assemble',
    immutable((assembly: AppAssemblyOptions<Request, DbValue, Owner>) =>
      assembleContract<
        RawRequest,
        SessionValue,
        DbValue,
        EnvValue,
        Request,
        Owner
      >(state, assembly),
    ),
  );

  return witnessFreeze(contract) as unknown as KovoContract<
    RawRequest,
    SessionValue,
    DbValue,
    EnvValue,
    Request,
    Owner
  >;
}

function createAppQueryFactory<Request, Owner extends AppId>(
  state: ContractState,
): AppQueryFactory<AppReadRequest<Request>, Owner> {
  return ((definition: object) => {
    assertContractOpen(state, 'app.query()');
    const declaration = query(definition as any) as QueryDefinition<
      string,
      unknown,
      unknown,
      unknown
    >;
    ownDeclaration(state, 'query', declaration);
    witnessDefineProperty(
      declaration,
      'optimistic',
      immutable((options: unknown) => createOptimisticBinding(state, declaration, options)),
    );
    return declaration;
  }) as unknown as AppQueryFactory<AppReadRequest<Request>, Owner>;
}

function createAppMutationFactory<Request, Owner extends AppId>(
  state: ContractState,
): AppMutationFactory<Request, Owner> {
  return ((definition: object) => {
    assertContractOpen(state, 'app.mutation()');
    const optimistic = optionalOwnDataValue(definition, 'optimistic', 'app.mutation.optimistic');
    const runtimeDefinition = copyOwnDataRecord(
      definition,
      'app.mutation definition',
      new Set(['optimistic']),
    );
    const declaration = mutation(runtimeDefinition as any);
    ownDeclaration(state, 'mutation', declaration);
    if (optimistic !== undefined) {
      const bindings = denseObjectArray(optimistic, 'app.mutation.optimistic');
      for (let index = 0; index < bindings.length; index += 1) {
        requireOptimisticBinding(bindings[index]!, state.contract, index);
      }
      registerAppDeclarationMetadata(declaration, witnessFreeze(bindings));
    }
    return declaration;
  }) as AppMutationFactory<Request, Owner>;
}

function createAppRouteFactory<Request, Owner extends AppId>(
  state: ContractState,
): AppRouteFactory<Request, Owner> {
  return ((path: string, definition: object) => {
    assertContractOpen(state, 'app.route()');
    return ownDeclaration(state, 'route', route(path, definition as any));
  }) as AppRouteFactory<Request, Owner>;
}

function createAppLayoutFactory<Request, Owner extends AppId>(
  state: ContractState,
): AppLayoutFactory<Request, Owner> {
  return ((definition: object) => {
    assertContractOpen(state, 'app.layout()');
    return ownDeclaration(state, 'layout', layout(definition as any));
  }) as AppLayoutFactory<Request, Owner>;
}

function createAppEndpointFactory<Db, Owner extends AppId>(
  state: ContractState,
): AppEndpointFactory<Db, Owner> {
  return ((path: string, definition: object) => {
    assertContractOpen(state, 'app.endpoint()');
    return ownDeclaration(state, 'endpoint', endpoint(path, definition as any));
  }) as AppEndpointFactory<Db, Owner>;
}

function createAppTaskFactory<Owner extends AppId>(
  state: ContractState,
): AppTaskFactory<Owner> {
  return ((definition: object) => {
    assertContractOpen(state, 'app.task()');
    return ownDeclaration(state, 'task', task(definition as any));
  }) as AppTaskFactory<Owner>;
}

function ownDeclaration<Declaration extends object>(
  state: ContractState,
  kind: AppDeclarationKind,
  declaration: Declaration,
): Declaration {
  registerAppDeclarationOwner(declaration, { contract: state.contract, kind });
  state.declarations[kind]!.push(
    appDeclarationOwner(declaration)!.declaration,
  );
  return declaration;
}

function createOptimisticBinding(
  state: ContractState,
  queryDeclaration: QueryDefinition<string, unknown, unknown, unknown>,
  options: unknown,
): QueryOptimisticBinding {
  const queryOwner = appDeclarationOwner(queryDeclaration);
  if (queryOwner?.contract !== state.contract || queryOwner.kind !== 'query') {
    throw ownerMismatch('query', 'app.query.optimistic()');
  }

  let bindingState: OptimisticBindingState;
  if (options === 'await-fragment') {
    bindingState = {
      owner: state.contract,
      query: queryDeclaration,
      status: 'await-fragment',
    };
  } else if (typeof options === 'function') {
    if (optionalOwnDataValue(queryDeclaration, 'args', 'query.args') !== undefined) {
      throw new TypeError(
        'KOVO_OPTIMISTIC_KEYS_REQUIRED: a parameterized query requires ' +
          'query.optimistic({ keys, apply }); the bare callback is only for an unkeyed query.',
      );
    }
    bindingState = {
      apply: options as unknown as OptimisticFunction,
      owner: state.contract,
      query: queryDeclaration,
      status: 'hand-written',
    };
  } else {
    if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
      throw new TypeError(
        'query.optimistic() requires a pure callback, { keys, apply }, or await-fragment.',
      );
    }
    const apply = requiredFunctionOwnDataValue(options, 'apply', 'query.optimistic.apply');
    const keys = requiredFunctionOwnDataValue(options, 'keys', 'query.optimistic.keys');
    bindingState = {
      apply,
      keys,
      owner: state.contract,
      query: queryDeclaration,
      status: 'hand-written',
    };
  }

  const binding = witnessFreeze(witnessCreateNullRecord());
  witnessWeakMapSet(optimisticBindings, binding, witnessFreeze(bindingState));
  return binding as unknown as QueryOptimisticBinding;
}

function assembleContract<
  RawRequest extends globalThis.Request,
  SessionValue,
  DbValue,
  EnvValue extends Record<string, unknown>,
  Request,
  Owner extends AppId,
>(
  state: ContractState,
  assembly: AppAssemblyOptions<Request, DbValue, Owner>,
): KovoApp<KovoContract<RawRequest, SessionValue, DbValue, EnvValue, Request, Owner>> {
  assertContractOpen(state, 'app.assemble()');
  state.phase = 'assembling';

  try {
    const inventories = snapshotAssembly(state, assembly);
    const config = copyOwnDataRecord(
      state.config,
      'defineKovo assembly options',
      new Set(['auth']),
    ) as CreateAppOptions<
      SessionValue,
      DbValue,
      RawRequest,
      Request,
      EnvValue
    >;
    const runtimeApp = createApp<
      SessionValue,
      DbValue,
      RawRequest,
      Request,
      EnvValue
    >({
      ...config,
      endpoints: inventories.endpoint as readonly EndpointDeclaration<
        string,
        EndpointMethod,
        EndpointMount,
        never
      >[],
      mutations: inventories.mutation.map(materializeMutationOptimism) as AppMutationDeclaration<
        Request
      >[],
      queries: inventories.query as AppQueryDeclaration<Request>[],
      routes: inventories.route as AppRouteDeclaration<Request>[],
      sessionProvider: state.config.auth as
        | SessionProvider<RawRequest, SessionValue>
        | undefined,
      tasks: inventories.task as AppTaskDeclaration<Request>[],
    } as CreateAppOptions<SessionValue, DbValue, RawRequest, Request, EnvValue>);
    state.runtimeApp = runtimeApp;
    state.phase = 'closed';
    return createKovoAppToken<
      KovoContract<RawRequest, SessionValue, DbValue, EnvValue, Request, Owner>
    >(runtimeApp);
  } catch (error) {
    state.phase = 'failed';
    throw error;
  }
}

function snapshotAssembly(
  state: ContractState,
  assembly: object,
): Record<AppDeclarationKind, object[]> {
  if (typeof assembly !== 'object' || assembly === null || witnessIsArray(assembly)) {
    throw new TypeError('app.assemble() requires one declaration inventory object.');
  }
  const allowed = createWitnessSet<string>();
  for (const kind of ['endpoint', 'layout', 'mutation', 'query', 'route', 'task'] as const) {
    witnessSetAdd(allowed, pluralDeclarationKind(kind));
  }
  const keys = witnessOwnKeys(assembly);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (typeof key !== 'string' || !witnessSetHas(allowed, key)) {
      throw new TypeError(`Unknown app.assemble() field ${String(key)}.`);
    }
  }

  const result: Record<AppDeclarationKind, object[]> = {
    endpoint: [],
    layout: [],
    mutation: [],
    query: [],
    route: [],
    task: [],
  };
  for (const kind of ['endpoint', 'layout', 'mutation', 'query', 'route', 'task'] as const) {
    const plural = pluralDeclarationKind(kind);
    const value = optionalOwnDataValue(assembly, plural, `app.assemble.${plural}`) ?? [];
    const handles = denseObjectArray(value, `app.assemble.${plural}`);
    const seen = createWitnessSet<object>();
    for (let index = 0; index < handles.length; index += 1) {
      const handle = handles[index]!;
      const ownership = appDeclarationOwner(handle);
      if (ownership?.contract !== state.contract || ownership.kind !== kind) {
        throw ownerMismatch(kind, `app.assemble.${plural}[${index}]`);
      }
      if (witnessSetHas(seen, ownership.declaration)) {
        throw new TypeError(
          `KOVO_APP_DUPLICATE_DECLARATION: ${plural}[${index}] repeats one ${kind} handle.`,
        );
      }
      witnessSetAdd(seen, ownership.declaration);
      result[kind].push(handle);
    }
    const declared = state.declarations[kind];
    if (declared.length !== seen.size) {
      const missing = declared.filter((identity) => !witnessSetHas(seen, identity));
      if (missing.length > 0) {
        throw new TypeError(
          `KOVO_APP_ORPHAN_DECLARATION: ${missing.length} app.${kind}() declaration(s) are ` +
            `missing from assemble({ ${plural}: [...] }). Add every exported handle exactly once.`,
        );
      }
    }
  }
  return result;
}

function pluralDeclarationKind(kind: AppDeclarationKind): string {
  return kind === 'query' ? 'queries' : `${kind}s`;
}

function materializeMutationOptimism(declaration: object): object {
  const metadata = appDeclarationMetadata(declaration);
  if (metadata === undefined) return declaration;
  const bindings = denseObjectArray(metadata, 'app mutation optimistic metadata');
  const optimistic = witnessCreateNullRecord<unknown>();
  const seen = createWitnessSet<string>();
  for (let index = 0; index < bindings.length; index += 1) {
    const binding = optimisticBindingsState(bindings[index]!, index);
    const key = binding.query.key;
    if (typeof key !== 'string' || key === '' || key.startsWith('\0kovo:')) {
      throw new TypeError(
        'KOVO_OPTIMISTIC_QUERY_IDENTITY: query handle has no compiler-derived identity. ' +
          'Run through kovo check/build and break any top-level query↔mutation import cycle.',
      );
    }
    if (witnessSetHas(seen, key)) {
      throw new TypeError(
        `KOVO_OPTIMISTIC_DUPLICATE: mutation declares query ${key} more than once.`,
      );
    }
    witnessSetAdd(seen, key);
    if (binding.status === 'await-fragment') {
      witnessDefineProperty(optimistic, key, mutable('await-fragment'));
    } else if (binding.keys === undefined) {
      witnessDefineProperty(optimistic, key, mutable(binding.apply));
    } else {
      witnessDefineProperty(
        optimistic,
        key,
        mutable({ keys: binding.keys, transform: binding.apply }),
      );
    }
  }
  const copy = copyOwnDataRecord(
    declaration,
    'app mutation materialization',
    new Set(['optimistic']),
  );
  witnessDefineProperty(copy, 'optimistic', mutable(witnessFreeze(optimistic)));
  return copy;
}

function optimisticBindingsState(value: object, index: number): OptimisticBindingState {
  const state = witnessWeakMapGet(optimisticBindings, value);
  if (state === undefined) {
    throw new TypeError(
      `KOVO_OPTIMISTIC_HANDLE: optimistic[${index}] is not an exact query.optimistic() result.`,
    );
  }
  return state;
}

function requireOptimisticBinding(value: object, owner: object, index: number): void {
  const state = optimisticBindingsState(value, index);
  if (state.owner !== owner) {
    throw new TypeError(
      `KOVO_APP_OWNER_MISMATCH: optimistic[${index}] belongs to another app contract or ` +
        'duplicate @kovojs/server package instance.',
    );
  }
}

function snapshotContractOptions(source: object): Readonly<Record<string, unknown>> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('defineKovo() requires a stable own-data options object.');
  }
  const allowed = new Set([
    'appId',
    'auth',
    'clientModules',
    'csrf',
    'db',
    'document',
    'egress',
    'env',
    'envSource',
    'errorShells',
    'mutationReplayStore',
    'onError',
    'principalEpochStore',
    'renderRoute',
    'requestLimits',
    'stylesheets',
  ]);
  return witnessFreeze(copyOwnDataRecord(source, 'defineKovo options', undefined, allowed));
}

function copyOwnDataRecord(
  source: object,
  label: string,
  omitted: ReadonlySet<PropertyKey> = new Set(),
  allowed?: ReadonlySet<PropertyKey>,
): Record<string, unknown> {
  const result = witnessCreateNullRecord<unknown>();
  const keys = witnessOwnKeys(source);
  if (keys.length > 100_000) throw new TypeError(`${label} must be bounded.`);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (omitted.has(key)) continue;
    if (allowed !== undefined && !allowed.has(key)) {
      throw new TypeError(`Unknown ${label} field ${String(key)}.`);
    }
    if (typeof key !== 'string') throw new TypeError(`${label} cannot contain symbol fields.`);
    const before = witnessGetOwnPropertyDescriptor(source, key);
    const after = witnessGetOwnPropertyDescriptor(source, key);
    if (
      before === undefined ||
      after === undefined ||
      !('value' in before) ||
      !('value' in after) ||
      !witnessObjectIs(before.value, after.value)
    ) {
      throw new TypeError(`${label}.${key} must be a stable own data property.`);
    }
    witnessDefineProperty(result, key, mutable(before.value, before.enumerable === true));
  }
  return result as Record<string, unknown>;
}

function denseObjectArray(value: unknown, label: string): object[] {
  if (!witnessIsArray(value)) throw new TypeError(`${label} must be a dense array.`);
  const result: object[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      (typeof descriptor.value !== 'object' && typeof descriptor.value !== 'function') ||
      descriptor.value === null
    ) {
      throw new TypeError(`${label}[${index}] must be a stable declaration handle.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function optionalOwnDataValue(source: object, property: PropertyKey, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(source, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label} must be an own data property.`);
  return descriptor.value;
}

function requiredFunctionOwnDataValue(
  source: object,
  property: PropertyKey,
  label: string,
): OptimisticFunction {
  const value = optionalOwnDataValue(source, property, label);
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function.`);
  return value as unknown as OptimisticFunction;
}

function assertContractOpen(state: ContractState, operation: string): void {
  if (state.phase === 'open') return;
  throw new TypeError(
    `${operation} cannot run after assembly has ${state.phase}. ` +
      'A Kovo contract has one declaration generation and one assemble() call (SPEC §6.2.1).',
  );
}

function contractRuntimeApp(state: ContractState, operation: string): RuntimeKovoApp {
  if (state.phase !== 'closed' || state.runtimeApp === undefined) {
    throw new TypeError(
      `${operation} is unavailable before app.assemble() closes and validates providers.`,
    );
  }
  return state.runtimeApp;
}

function ownerMismatch(kind: AppDeclarationKind, location: string): TypeError {
  return new TypeError(
    `KOVO_APP_OWNER_MISMATCH: ${location} requires an exact app.${kind}() handle from this ` +
      'contract. Free-factory declarations, structural copies, another app, and duplicate ' +
      '@kovojs/server package instances are rejected (SPEC §6.2.1).',
  );
}

function immutable(value: unknown): PropertyDescriptor {
  return {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  };
}

function immutableGetter(get: () => unknown): PropertyDescriptor {
  return {
    configurable: false,
    enumerable: true,
    get,
  };
}

function mutable(value: unknown, enumerable = true): PropertyDescriptor {
  return {
    configurable: true,
    enumerable,
    value,
    writable: true,
  };
}
