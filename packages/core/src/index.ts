import type { ComponentMutationDefinitions, ComponentMutationForms, Form } from './forms-types.js';
import type { JsonValue } from './json.js';
import { blessSink } from './internal/sink-policy.js';
import { buildRoutePatternHref } from './internal/route-pattern.js';

export type { DiagnosticCode, DiagnosticSeverity } from './diagnostics.js';
export type { JsonValue } from './json.js';
export {
  declareOffWire,
  drainSecretRevealAuditFacts,
  isRedacted,
  isSecret,
  isUntrusted,
  publishToClient,
  redacted,
  revealRedacted,
  revealSecret,
  revealUntrusted,
  secret,
  trustedReveal,
  untrusted,
} from './secret.js';
export type {
  DeclareOffWireOptions,
  PublishToClientOptions,
  Redacted,
  RedactedOptions,
  RedactedValue,
  Secret,
  SecretRevealReason,
  SecretRevealAuditFact,
  SecretValue,
  TrustedRevealMethod,
  TrustedRevealOptions,
  TrustedRevealValue,
  Untrusted,
  UntrustedValue,
} from './secret.js';
export type {
  ComponentMutationFormState,
  Form,
  FormFailure,
  FormValidationFailure,
} from './forms-types.js';
export type {
  FileSystemStorageOptions,
  MemoryStorageOptions,
  S3CompatibleDeleteObjectInput,
  S3CompatibleGetObjectInput,
  S3CompatibleGetObjectOutput,
  S3CompatibleHeadObjectInput,
  S3CompatibleObjectClient,
  S3CompatibleObjectMetadata,
  S3CompatiblePutObjectInput,
  S3CompatiblePutObjectOutput,
  S3CompatibleStorageOptions,
  StorageBody,
  StorageCapability,
  StorageDeleteCapability,
  StorageGetResult,
  StorageObjectInfo,
  StoragePutCapability,
  StoragePutOptions,
  StoragePutResult,
  StorageReadCapability,
  StorageStreamResult,
} from './storage.js';
export {
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
} from './storage.js';
export type {
  CustomWebhookVerifier,
  HmacMultiSignature,
  HmacSecret,
  HmacSignatureEncoding,
  HmacSignatureOptions,
  HmacSignaturePayload,
  HmacSignaturePayloadContext,
  HmacSignatureTolerance,
  HmacSignatureVerifier,
  ResolvedHmacSignatureConfig,
  StandardWebhooksOptions,
  WebhookHeaders,
  WebhookHeaderValue,
  WebhookPayload,
  WebhookVerificationRequest,
  WebhookVerifier,
} from './verifier.js';
export { customVerifier, hmacSignature, standardWebhooks } from './verifier.js';

/** Opaque non-string result of a component's `render` — the compiler lowers TSX to HTML/IR (SPEC §4.1, §4.8). */
export type ComponentRenderResult =
  | boolean
  | null
  | number
  | readonly ComponentRenderResult[]
  | undefined
  | object;

/** Escaped text/message content used by explicit text-oriented helpers. */
export type ComponentTextResult = ComponentRenderResult | string;

/** Render-time child/slot composition value, including escaped text nodes (SPEC §4.5). */
export type ComponentChild = ComponentRenderResult | string;

interface FrameworkRenderedHtml {
  readonly html: string;
  [Symbol.toPrimitive](): string;
  toJSON(): string;
  toString(): string;
}

/** Props accepted by the server-bound `<ErrorBoundary />` render fallback helper. */
export interface ErrorBoundaryProps {
  children?: ComponentRenderResult;
  fallback: ComponentRenderResult | ((error: unknown) => ComponentRenderResult);
  target?: string;
}

/** Component-local fallback used by generated live-target renderers for unexpected errors. */
export interface ComponentErrorBoundary {
  fallback: ComponentRenderResult | ((error: unknown) => ComponentRenderResult);
  target?: string;
}

type NoComponentMutations = Record<never, never>;
type ComponentDefinitionMutations<Definition> = Definition extends { mutations: infer Mutations }
  ? Mutations extends ComponentMutationDefinitions
    ? Mutations
    : NoComponentMutations
  : NoComponentMutations;

interface ComponentRenderSlotValues {
  children?: ComponentChild;
  [slot: string]: unknown;
}

type ComponentRenderFormsSlot<Mutations extends ComponentMutationDefinitions> =
  keyof Mutations extends never
    ? { forms?: ComponentMutationForms<Mutations> }
    : { forms: ComponentMutationForms<Mutations> };

/** Render-time composition values for `children`, named slots, and mutation form state (SPEC §4.5/§6.3). */
export type ComponentRenderSlots<
  Mutations extends ComponentMutationDefinitions = NoComponentMutations,
> = ComponentRenderSlotValues & ComponentRenderFormsSlot<Mutations>;

/** Loosely-typed input accepted by `component()` before inference narrows it. */
export interface ComponentDefinitionInput {
  /** Declared clock inputs for time-dependent rendered positions and derives (SPEC §4.8/§4.9). */
  clocks?: Record<string, unknown>;
  /** Force-off escape hatch for inferred server refresh targets (SPEC §4.1). */
  disableServerRefresh?: boolean;
  /** Removed: query-backed components infer refresh targets; use `disableServerRefresh` to opt out. */
  fragmentTarget?: never;
  /** Unexpected render-error fallback for full-page and live-target renders (SPEC §9.2). */
  errorBoundary?: ComponentErrorBoundary;
  /** Force the compiler to keep server and client render output equivalent for this component. */
  isomorphic?: boolean;
  /** Co-located component CSS scoped by the compiler to this component's host. */
  css?: string;
  mutations?: Record<string, unknown>;
  /** Static prop metadata used by generated live-target renderers to serialize component props. */
  props?: Record<string, unknown>;
  queries?: unknown;
  state?: (() => any) | undefined;
  render: (...args: never[]) => ComponentRenderResult;
}

/** Function type used by component type helpers for callable render slots and definitions. */
export type AnyFunction = (...args: any[]) => any;
/** Type-level predicate used by component prop inference to default-deny `any` render input. */
export type IsAny<T> = 0 extends 1 & T ? true : false;
/** First render-parameter input bag before query result keys are removed (SPEC §4.1/§6.2). */
export type ComponentRenderInput<Definition> = Definition extends {
  render: (input: infer Input, ...args: any[]) => any;
}
  ? IsAny<Input> extends true
    ? Record<never, never>
    : unknown extends Input
      ? Record<never, never>
      : Input extends object
        ? Input
        : Record<never, never>
  : Record<never, never>;

/** Query result property names supplied by the runtime rather than component call sites. */
export type ComponentQueryKeys<Definition> = Definition extends { queries: infer Queries }
  ? Extract<keyof Queries, string>
  : never;

/** Framework-level attributes accepted by component call sites in addition to rendered props. */
export interface ComponentCallSiteAttributes {
  [attribute: `aria-${string}`]: unknown;
  [attribute: `data-${string}`]: unknown;
  [attribute: `on${string}`]: unknown;
  checked?: unknown;
  class?: string;
  className?: string;
  disabled?: unknown;
  form?: unknown;
  hidden?: unknown;
  id?: unknown;
  'kovo-key'?: number | string;
  key?: number | string;
  name?: unknown;
  required?: unknown;
  role?: unknown;
  style?: unknown;
  styles?: unknown;
  tabIndex?: unknown;
  value?: unknown;
}

/**
 * Props accepted when calling or rendering a Kovo component descriptor. Per SPEC §4.1/§6.2,
 * the render function's first parameter is the source of truth, and query result keys are
 * supplied by the runtime rather than by call sites.
 */
export type ComponentProps<Definition> = Omit<
  ComponentRenderInput<Definition>,
  ComponentQueryKeys<Definition>
> &
  ComponentCallSiteAttributes;

/** Props consumed by a component query `args` binding. */
export type ComponentQueryBindingProps<Binding> =
  Binding extends QueryArgsBinding<string, unknown, infer Props, unknown> ? Props : never;

/** Query binding consistency check against render-derived call-site props. */
export type CheckedComponentQueryBindings<Definition> = Definition extends {
  queries: infer Queries;
}
  ? {
      [Key in keyof Queries]: ComponentQueryBindingProps<Queries[Key]> extends never
        ? Queries[Key]
        : ComponentQueryBindingProps<Queries[Key]> extends ComponentProps<Definition>
          ? Queries[Key]
          : never;
    }
  : unknown;

/** Constructor values accepted in component `props` metadata. */
export type ComponentPropMetadataValue =
  | ArrayConstructor
  | BooleanConstructor
  | NumberConstructor
  | ObjectConstructor
  | StringConstructor;

/** Runtime value type represented by a component `props` metadata constructor. */
export type ComponentPropMetadataType<Value> = Value extends StringConstructor
  ? string
  : Value extends NumberConstructor
    ? number
    : Value extends BooleanConstructor
      ? boolean
      : Value extends ArrayConstructor
        ? readonly JsonValue[]
        : Value extends ObjectConstructor
          ? Record<string, JsonValue>
          : never;

/** Props metadata consistency check against render-derived call-site props. */
export type CheckedComponentPropsMetadata<Definition> = Definition extends { props: infer Metadata }
  ? {
      [Key in keyof Metadata]: Key extends keyof ComponentProps<Definition>
        ? Metadata[Key] extends ComponentPropMetadataValue
          ? ComponentPropMetadataType<Metadata[Key]> extends ComponentProps<Definition>[Key]
            ? Metadata[Key]
            : never
          : never
        : never;
    }
  : unknown;

/** Definition-level consistency checks for query args and serializable props metadata. */
export type CheckedComponentDefinition<Definition extends ComponentDefinitionInput> = Definition &
  (Definition extends { queries: unknown }
    ? { queries: CheckedComponentQueryBindings<Definition> }
    : unknown) &
  (Definition extends { props: unknown }
    ? { props: CheckedComponentPropsMetadata<Definition> }
    : unknown);

/** Required keys of an object type, preserving `exactOptionalPropertyTypes` semantics. */
export type RequiredKeys<T extends object> = {
  [Key in keyof T]-?: {} extends Pick<T, Key> ? never : Key;
}[keyof T];

/** Exact object helper used to reject excess component call-site properties. */
export type ExactProps<Shape extends object, Input extends Shape> = Input &
  Record<Exclude<keyof Input, keyof Shape>, never>;

/** Tuple form for component calls: props are optional only when no render-derived prop is required. */
export type ComponentCallArgs<
  Definition extends ComponentDefinitionInput,
  Props extends ComponentProps<Definition>,
> =
  RequiredKeys<ComponentProps<Definition>> extends never
    ? [props?: ExactProps<ComponentProps<Definition>, Props>]
    : [props: ExactProps<ComponentProps<Definition>, Props>];

/** A component descriptor returned by `component()`; the compiler injects `name` after derivation. */
export interface Component<Definition extends ComponentDefinitionInput> {
  <const Props extends ComponentProps<Definition>>(
    ...args: ComponentCallArgs<Definition, Props>
  ): any;
  definition: Definition;
  name?: string;
}

/** Recursive JSON-serializability guardrail for authored state/query payload types (SPEC §4.1). */
export type Serializable<T> = T extends JsonValue
  ? T
  : T extends (...args: any[]) => any
    ? never
    : T extends readonly (infer Item)[]
      ? readonly Serializable<Item>[]
      : T extends object
        ? { [Key in keyof T]: Serializable<T[Key]> }
        : never;

/**
 * Declare a UI component with optional query bindings, optional serializable
 * island state, and a render function. The compiler derives the component's
 * load-bearing name and live refresh target from the exported binding, module
 * path, queries, and authored keys; queries and state are passed to `render` at
 * runtime. Authored components are plain TSX — the compiler derives stamps,
 * bindings, names, and the client module, so you never write derivable
 * `data-bind`/`kovo-*` attributes by hand (SPEC §4.1, §4.8).
 *
 * @param definition - `render` plus optional `queries`, `state`, and
 * `disableServerRefresh`.
 * @returns A `Component` descriptor the compiler lowers and the server renders.
 * @example
 * import { component } from '@kovojs/core';
 *
 * type CounterState = { count: number };
 *
 * export const Counter = component({
 *   state: (): CounterState => ({ count: 0 }),
 *   render: (_queries: Record<string, never>, state: CounterState) =>
 *     `<button>${state.count}</button>`,
 * });
 */
export function component<
  const State,
  const Definition extends Omit<ComponentDefinitionInput, 'mutations' | 'render' | 'state'> & {
    state: () => State;
    mutations?: ComponentMutationDefinitions;
    render: (...args: any[]) => ComponentRenderResult;
  },
>(
  definition: CheckedComponentDefinition<Definition> &
    (State extends Serializable<State> ? { state: () => State } : { state: () => never }) & {
      render: (
        queries: any,
        state: any,
        slots: ComponentRenderSlots<ComponentDefinitionMutations<Definition>>,
      ) => ComponentRenderResult;
    },
): Component<Definition>;
export function component<
  const Definition extends Omit<ComponentDefinitionInput, 'mutations' | 'render' | 'state'> & {
    mutations?: ComponentMutationDefinitions;
    render: (...args: any[]) => ComponentRenderResult;
    state?: undefined;
  },
>(
  definition: CheckedComponentDefinition<Definition> & {
    render: (
      queries: any,
      state: any,
      slots: ComponentRenderSlots<ComponentDefinitionMutations<Definition>>,
    ) => ComponentRenderResult;
  },
): Component<Definition>;
export function component(
  definition: ComponentDefinitionInput & {
    render: (
      queries: any,
      state: any,
      slots: ComponentRenderSlots<ComponentMutationDefinitions>,
    ) => ComponentRenderResult;
  },
): Component<any> {
  assertKnownComponentDefinitionKeys(definition as unknown as Record<PropertyKey, unknown>);
  const descriptor = (() => undefined) as Component<any>;
  Object.defineProperty(descriptor, 'name', {
    configurable: true,
    enumerable: true,
    value: undefined,
    writable: true,
  });
  descriptor.definition = definition;
  return descriptor;
}

const COMPONENT_DEFINITION_KEYS = new Set([
  'clocks',
  'css',
  'disableServerRefresh',
  'errorBoundary',
  'isomorphic',
  'mutations',
  'props',
  'queries',
  'render',
  'state',
]);

function assertKnownComponentDefinitionKeys(definition: Record<PropertyKey, unknown>): void {
  for (const key of Reflect.ownKeys(definition)) {
    if (typeof key !== 'string') continue;
    if (COMPONENT_DEFINITION_KEYS.has(key)) continue;
    throw new TypeError(
      `Unknown component() definition field "${key}". Supported fields are ${[
        ...COMPONENT_DEFINITION_KEYS,
      ].join(', ')}.`,
    );
  }
}

/**
 * Declare a tree-local unexpected-error boundary. Server JSX catches descendant
 * render failures and renders `fallback`; typed mutation failures remain normal
 * `<FieldError>` / `<FormError>` state (SPEC §9.2).
 */
export function ErrorBoundary(props: ErrorBoundaryProps): ComponentRenderResult {
  return props.children;
}

/** A typed component query binding with args derived from serializable component props. */
export interface QueryArgsBinding<
  Key extends string,
  Result,
  Props extends Record<string, JsonValue>,
  Args,
> {
  args: (props: Props) => Args;
  key: Key;
  refresh<PropsSpec extends QueryRefreshSpec<Result>>(
    spec: PropsSpec,
  ): QueryArgsBinding<Key, Result, Props, Args> & { refreshSpec: PropsSpec };
  refreshSpec?: QueryRefreshSpec<Result>;
  result?: Result;
}

/** Per-use query freshness cadence for clock-like server values (SPEC §4.9). */
export interface QueryRefreshSpec<Result> {
  at?: (value: Result) => unknown;
  every?: string;
  renderOnce?: true;
  until?: (value: Result) => unknown;
}

/** A typed query binding with a per-use refresh cadence and optional prop args. */
export interface QueryRefreshBinding<
  Key extends string,
  Result,
  Spec extends QueryRefreshSpec<Result>,
> {
  args<Props extends Record<string, JsonValue>, Args extends Record<string, JsonValue>>(
    mapper: (props: Props) => Args,
  ): QueryArgsBinding<Key, Result, Props, Args> & { refreshSpec: Spec };
  key: Key;
  refresh<PropsSpec extends QueryRefreshSpec<Result>>(
    spec: PropsSpec,
  ): QueryRefreshBinding<Key, Result, PropsSpec>;
  refreshSpec: Spec;
  result?: Result;
}

/** A typed query handle: a key and the result type it resolves to. */
export interface Query<Key extends string, Result> {
  args<Props extends Record<string, JsonValue>, Args extends Record<string, JsonValue>>(
    mapper: (props: Props) => Args,
  ): QueryArgsBinding<Key, Result, Props, Args>;
  key: Key;
  /**
   * Declarative per-query opt-out from refetch-on-focus (SPEC §9.3/§9.4). Refetch-on-focus
   * is on by default; set `refetchOnFocus: false` on the {@link query} handle to exclude this
   * query from the visible-return/bfcache typed-read refetch (§9.4). Only `false` is accepted:
   * `true` would be the default and a no-op field, so it is not part of the type. Present only
   * when the query was declared with `query(key, { refetchOnFocus: false })`.
   */
  refetchOnFocus?: false;
  refresh<Spec extends QueryRefreshSpec<Result>>(
    spec: Spec,
  ): QueryRefreshBinding<Key, Result, Spec>;
  refreshSpec?: undefined;
  result?: Result;
}

/**
 * Declaration-site config for {@link query} (SPEC §9.3/§9.4).
 *
 * `refetchOnFocus: false` opts the query out of refetch-on-focus — the per-query loader
 * behavior that re-runs queries over the typed read endpoint (`/_q/`, §9.4) when a stale tab
 * returns. Refetch-on-focus is on by default, so this is an opt-out, not an opt-in; `true` is
 * not accepted because it would be a no-op field.
 *
 * Note: `live: true` (SPEC §9.3:905/§9.4) is intentionally NOT part of this config. The
 * `<kovo-live>` SSE subscriber is unimplemented (roadmap; no `text/event-stream` transport
 * ships today), and a field that silently does nothing would violate the no-op-field contract.
 * It can be added once the SSE transport lands and a declared `live: true` has an observable effect.
 */
export interface QueryConfig {
  refetchOnFocus?: false;
}

/**
 * Augmentable registry mapping query keys to result types (declaration-merged by apps).
 *
 * @augmented The canonical entries are emitted by the compiler via
 * `declare module '@kovojs/core'` (compiler/src/emit/registry.ts); hand-augmentation is
 * the SPEC §5.2/KV235-discouraged exception. Mirrors the `@generated` registries in
 * `core/src/generated.ts`, but stays here because `form`/`query`/`href` typing resolves it.
 */
export interface QueryRegistry {}

/**
 * Augmentable registry mapping mutation keys to input/failure types.
 * @augmented Compiler-populated (see {@link QueryRegistry}).
 */
export interface MutationRegistry {}

/**
 * Augmentable registry mapping route paths to their `Route` descriptors.
 * @augmented Compiler-populated (see {@link QueryRegistry}).
 */
export interface RouteRegistry {}

/**
 * Augmentable registry mapping mutation keys to the query names they invalidate (drives `OptimisticFor`).
 * @augmented Compiler-populated (see {@link QueryRegistry}).
 */
export interface InvalidationSets {}

/**
 * Augmentable registry mapping mutation keys to invalidated query names covered by generated optimism.
 * @augmented Compiler-populated (see {@link QueryRegistry}).
 */
export interface OptimisticDerivationSets {}

type RegistryKey<Registry> = keyof Registry extends never
  ? string
  : Extract<keyof Registry, string>;

// Public signatures cannot reference internal subpath types. Keep this type-level
// mirror local while runtime href/matching consumes `internal/route-pattern`.
type PathParamNames<Path extends string> = Path extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? Param | PathParamNames<Tail>
    : Rest extends `${infer Param}?${string}`
      ? Param
      : Rest extends `${infer Param}#${string}`
        ? Param
        : Rest
  : never;

type PathParams<Path extends string> =
  PathParamNames<Path> extends never ? {} : Record<PathParamNames<Path>, string>;

/** JSON URL search values accepted by typed routes; `undefined` means omit the key. */
export type RouteSearchValue = JsonValue | undefined;

/** A route descriptor: typed path, param/search shapes, and prefetch policy. */
export interface Route<
  Path extends string,
  Params extends Record<string, string> = PathParams<Path>,
  Search extends Record<string, RouteSearchValue> = Record<string, JsonValue>,
> {
  path: Path;
  params?: Params;
  prefetch?: 'conservative' | 'moderate' | false;
  search?: Search;
}

/** Options accepted by `route()`: param/search shapes and prefetch policy. */
export interface RouteOptions<
  Params extends Record<string, string> = Record<string, never>,
  Search extends Record<string, RouteSearchValue> = Record<string, JsonValue>,
> {
  params?: Params;
  prefetch?: 'conservative' | 'moderate' | false;
  search?: Search;
}

type RouteFor<Path extends string> = Path extends keyof RouteRegistry
  ? RouteRegistry[Path] extends Route<Path, infer Params, infer Search>
    ? Route<Path, Params, Search>
    : Route<Path>
  : Route<Path>;

type RouteParams<Definition> =
  Definition extends Route<string, infer Params, Record<string, RouteSearchValue>> ? Params : never;

type RouteSearch<Definition> =
  Definition extends Route<string, Record<string, string>, infer Search> ? Search : never;

type RouteHrefOptions<Definition> = keyof RouteParams<Definition> extends never
  ? { params?: RouteParams<Definition>; search?: Partial<RouteSearch<Definition>> }
  : { params: RouteParams<Definition>; search?: Partial<RouteSearch<Definition>> };

type RouteGetFormArgs<Definition> = keyof RouteParams<Definition> extends never
  ? [options?: { params?: RouteParams<Definition> }]
  : [options: { params: RouteParams<Definition> }];

/**
 * Declare a route descriptor: a typed path plus its param/search shapes. This
 * is the registry-level seed used for typed links (`href`, `Link`, `redirect`);
 * to also attach a server page handler, use `route` from `@kovojs/server`, which
 * extends this with `page`, guards, and meta (SPEC §6.4).
 *
 * @param path - URL pattern; `:name` segments become typed params.
 * @param options - Optional `params`/`search` shapes and `prefetch` policy.
 * @returns A `Route` descriptor keyed by `path`.
 * @example
 * import { route } from '@kovojs/core';
 *
 * export const productRoute = route('/products/:id', {
 *   params: { id: '' },
 *   prefetch: 'conservative',
 * });
 */
export function route<
  const Path extends string,
  Params extends Record<string, string> = PathParams<Path>,
  Search extends Record<string, RouteSearchValue> = Record<string, JsonValue>,
>(path: Path, options: RouteOptions<Params, Search> = {}): Route<Path, Params, Search> {
  return { ...options, path };
}

/**
 * Build a URL string for a registered route, substituting `:param` segments
 * and appending typed `search` values. Params for the path are required and
 * type-checked against the route's declared shape (SPEC §6.4).
 *
 * @param path - A registered route path.
 * @param options - `params` for the path segments and optional `search`.
 * @returns The encoded URL string.
 * @example
 * import { href } from '@kovojs/core';
 *
 * const url: string = href('/products/:id', { params: { id: 'p1' } });
 */
export function href<const Path extends RegistryKey<RouteRegistry>>(
  path: Path,
  options: RouteHrefOptions<RouteFor<Path>>,
): string {
  return buildHref(
    path,
    options as { params?: Record<string, string>; search?: Record<string, RouteSearchValue> },
  );
}

/** Props accepted by the compiler-bound `<Link />` navigation sugar (SPEC §6.4). */
export interface LinkProps {
  children?: ComponentRenderResult;
  params?: Record<string, string>;
  search?: Record<string, RouteSearchValue>;
  to: keyof RouteRegistry extends never ? string : Extract<keyof RouteRegistry, string>;
  [attribute: string]: unknown;
}

/** Result of `Link(path, options)`: a resolved `href` string ready to spread onto an anchor. */
export interface LinkDescriptor {
  href: string;
}

/**
 * Build a typed link descriptor (`{ href }`) for a registered route. Same
 * typing as `href`, returned as an object you can spread onto an anchor
 * (SPEC §6.4).
 *
 * @param path - A registered route path.
 * @param options - `params` for the path segments and optional `search`.
 * @returns A `LinkDescriptor` carrying the resolved `href`.
 * @example
 * import { Link } from '@kovojs/core';
 *
 * const link = Link('/products/:id', { params: { id: 'p1' } });
 * const anchor = `<a href="${link.href}">View</a>`;
 */
export function Link(props: LinkProps): ComponentRenderResult;
export function Link<const Path extends RegistryKey<RouteRegistry>>(
  path: Path,
  options: RouteHrefOptions<RouteFor<Path>>,
): LinkDescriptor;
export function Link<const Path extends RegistryKey<RouteRegistry>>(
  pathOrProps: Path | LinkProps,
  options?: RouteHrefOptions<RouteFor<Path>>,
): ComponentRenderResult | LinkDescriptor {
  const path = pathOrProps;
  if (typeof path === 'object' && path !== null) return undefined;
  return { href: href(path, options as RouteHrefOptions<RouteFor<Path>>) };
}

/** A 303 redirect outcome returned by `redirect()`. */
export interface Redirect {
  location: string;
  status: 303;
}

const ROUTE_REDIRECT_SINK = 'core:route-redirect';

/**
 * Build a 303 redirect to a registered route. Return it from a route page or
 * mutation handler to send the browser to a typed destination (SPEC §6.4).
 *
 * @param path - A registered route path.
 * @param options - `params` for the path segments and optional `search`.
 * @returns A `Redirect` with `status: 303` and the resolved `location`.
 * @example
 * import { redirect } from '@kovojs/core';
 *
 * const toProduct = redirect('/products/:id', { params: { id: 'p1' } });
 * // toProduct.status === 303
 */
export function redirect<const Path extends RegistryKey<RouteRegistry>>(
  path: Path,
  options: RouteHrefOptions<RouteFor<Path>>,
): Redirect {
  return blessSink(ROUTE_REDIRECT_SINK, {
    location: href(path, options),
    status: 303,
  });
}

function buildHref(
  path: string,
  options: { params?: Record<string, string>; search?: Record<string, RouteSearchValue> },
): string {
  return buildRoutePatternHref(path, options);
}

/**
 * Reference a registered query by key for component bindings. This is the
 * client-facing query handle (just `{ key }`); the server-side query with a
 * loader and read set is `query` from `@kovojs/server` (SPEC §10.2).
 *
 * @param key - A registered query key.
 * @param config - Optional declaration-site config (SPEC §9.3/§9.4); e.g.
 *   `{ refetchOnFocus: false }` to opt this query out of refetch-on-focus.
 * @returns A typed `Query` handle whose `result` reflects the registry entry.
 * @example
 * import { query } from '@kovojs/core';
 *
 * export const cart = query('cart');
 * // SPEC §9.3/§9.4: opt a query out of refetch-on-focus at the declaration site.
 * export const ticker = query('ticker', { refetchOnFocus: false });
 */
export function query<
  const Key extends RegistryKey<QueryRegistry>,
  Result = Key extends keyof QueryRegistry ? QueryRegistry[Key] : unknown,
>(key: Key, config?: QueryConfig): Query<Key, Result> {
  const handle = queryBinding<Key, Result>(key);
  // SPEC §9.3/§9.4: record the declared refetch-on-focus opt-out on the handle so the runtime
  // refetch machinery can derive its opt-out set from declarations instead of an install-only
  // option. Default (no field) keeps refetch-on-focus on; only `false` is meaningful.
  return config?.refetchOnFocus === false ? { ...handle, refetchOnFocus: false } : handle;
}

function queryBinding<Key extends string, Result>(key: Key): Query<Key, Result>;
function queryBinding<Key extends string, Result, Spec extends QueryRefreshSpec<Result>>(
  key: Key,
  refreshSpec: Spec,
): QueryRefreshBinding<Key, Result, Spec>;
function queryBinding<Key extends string, Result>(
  key: Key,
  refreshSpec?: QueryRefreshSpec<Result>,
): Query<Key, Result> | QueryRefreshBinding<Key, Result, QueryRefreshSpec<Result>> {
  const args = <Props extends Record<string, JsonValue>, Args extends Record<string, JsonValue>>(
    mapper: (props: Props) => Args,
  ) =>
    refreshSpec === undefined
      ? queryArgsBinding<Key, Result, Props, Args>(key, mapper)
      : queryArgsBinding<Key, Result, Props, Args, QueryRefreshSpec<Result>>(
          key,
          mapper,
          refreshSpec,
        );
  const refresh = <Spec extends QueryRefreshSpec<Result>>(nextSpec: Spec) =>
    queryBinding<Key, Result, Spec>(key, nextSpec);
  return {
    args,
    key,
    ...(refreshSpec === undefined ? {} : { refreshSpec }),
    refresh,
  } as unknown as Query<Key, Result> | QueryRefreshBinding<Key, Result, QueryRefreshSpec<Result>>;
}

function queryArgsBinding<
  Key extends string,
  Result,
  Props extends Record<string, JsonValue>,
  Args extends Record<string, JsonValue>,
>(key: Key, mapper: (props: Props) => Args): QueryArgsBinding<Key, Result, Props, Args>;
function queryArgsBinding<
  Key extends string,
  Result,
  Props extends Record<string, JsonValue>,
  Args extends Record<string, JsonValue>,
  Spec extends QueryRefreshSpec<Result>,
>(
  key: Key,
  mapper: (props: Props) => Args,
  refreshSpec: Spec,
): QueryArgsBinding<Key, Result, Props, Args> & { refreshSpec: Spec };
function queryArgsBinding<
  Key extends string,
  Result,
  Props extends Record<string, JsonValue>,
  Args extends Record<string, JsonValue>,
>(
  key: Key,
  mapper: (props: Props) => Args,
  refreshSpec?: QueryRefreshSpec<Result>,
):
  | QueryArgsBinding<Key, Result, Props, Args>
  | (QueryArgsBinding<Key, Result, Props, Args> & { refreshSpec: QueryRefreshSpec<Result> }) {
  const refresh = <Spec extends QueryRefreshSpec<Result>>(nextSpec: Spec) =>
    queryArgsBinding<Key, Result, Props, Args, Spec>(key, mapper, nextSpec);
  return {
    args: mapper,
    key,
    ...(refreshSpec === undefined ? {} : { refreshSpec }),
    refresh,
  } as unknown as
    | QueryArgsBinding<Key, Result, Props, Args>
    | (QueryArgsBinding<Key, Result, Props, Args> & { refreshSpec: QueryRefreshSpec<Result> });
}

/** A typed accessor for one search field of a GET form (`form.get(...).input(name)`). */
export interface GetFormInput<Name extends string> {
  name: Name;
}

/** Props accepted by the compiler/runtime-bound `<f.Form />` GET-form sugar (SPEC §6.4). */
export interface GetFormProps {
  children?: ComponentRenderResult;
  [attribute: string]: unknown;
}

/** Props accepted by the compiler/runtime-bound `<f.input />` GET-form sugar (SPEC §6.4). */
export interface GetFormInputProps<Name extends string> {
  name: Name;
  [attribute: string]: unknown;
}

/** Renderable descriptor for a GET form element: its `action` and `method`. */
export interface GetFormDescriptor {
  (props: GetFormProps): ComponentRenderResult;
  action: string;
  method: 'get';
}

/** Typed GET-form input descriptor and JSX component. */
export interface GetFormInputHelper<Search extends Record<string, RouteSearchValue>> {
  <const Name extends Extract<keyof Search, string>>(name: Name): GetFormInput<Name>;
  <const Name extends Extract<keyof Search, string>>(
    props: GetFormInputProps<Name>,
  ): ComponentRenderResult;
}

/** A GET-route search form: its action, `Form` descriptor, and typed `input(name)` accessors. */
export interface GetForm<
  Path extends string,
  Search extends Record<string, RouteSearchValue> = Record<string, JsonValue>,
> {
  action: string;
  Form: GetFormDescriptor;
  input: GetFormInputHelper<Search>;
  method: 'get';
  path: Path;
}

/** Props accepted by the compiler-bound `<FieldError />` mutation failure helper. */
export interface FieldErrorProps<Failure = unknown> {
  children?: unknown;
  class?: string;
  code?: string | readonly string[];
  failure?: Failure | null;
  id?: string;
  message?: ComponentTextResult | ((failure: any) => ComponentTextResult);
  name: string;
  role?: string;
  [attribute: string]: unknown;
}

/** Props accepted by the compiler-bound `<FormError />` mutation failure helper. */
export interface FormErrorProps<Failure = unknown> {
  children?: unknown;
  class?: string;
  code?: string | readonly string[];
  failure?: Failure | null;
  id?: string;
  message?: ComponentTextResult | ((failure: any) => ComponentTextResult);
  role?: string;
  [attribute: string]: unknown;
}

type MutationFormHelperKind = 'field' | 'form';

interface MutationFormHelperRenderContext {
  defer(kind: MutationFormHelperKind, props: Record<string, unknown>): unknown;
  renderHtml?(html: string): unknown;
}

const mutationFormHelperRenderContextKey = Symbol.for('kovo.mutationFormHelperRenderContext');
const getRouteFormHelperKindKey = Symbol.for('kovo.getRouteFormHelperKind');

function currentMutationFormHelperRenderContext(): MutationFormHelperRenderContext | undefined {
  const global = globalThis as typeof globalThis & Record<symbol, unknown>;
  const context = global[mutationFormHelperRenderContextKey];
  if (!isRecord(context) || typeof context.defer !== 'function') return undefined;
  return context as unknown as MutationFormHelperRenderContext;
}

function deferMutationFormHelper(
  kind: MutationFormHelperKind,
  props: Record<string, unknown>,
): string {
  return (currentMutationFormHelperRenderContext()?.defer(kind, props) ??
    frameworkRenderedHtml('')) as string;
}

interface SchemaLike<Value> {
  parse(input: unknown): Value;
}

type InferSchemaLike<Schema> = Schema extends SchemaLike<infer Value> ? Value : never;

type RegistryMutationInputSchema<Value> = Value extends { input: infer InputSchema }
  ? InferSchemaLike<InputSchema> extends infer Input
    ? Input extends Record<string, JsonValue>
      ? Input
      : Record<string, JsonValue>
    : Record<string, JsonValue>
  : Record<string, JsonValue>;

type RegistryMutationInput<Key extends string> = Key extends keyof MutationRegistry
  ? MutationRegistry[Key] extends Form<string, infer Input, unknown>
    ? Input
    : RegistryMutationInputSchema<MutationRegistry[Key]>
  : Record<string, JsonValue>;

type RegistryMutationFailure<Key extends string> = Key extends keyof MutationRegistry
  ? MutationRegistry[Key] extends { errors: infer Errors }
    ? MutationErrorFailures<Errors>
    : MutationRegistry[Key] extends Form<string, any, infer Failure>
      ? Failure
      : JsonValue
  : JsonValue;

type MutationErrorFailures<Errors> =
  Errors extends Record<string, SchemaLike<unknown>>
    ? {
        [Code in Extract<keyof Errors, string>]: {
          code: Code;
          payload: InferSchemaLike<Errors[Code]>;
        };
      }[Extract<keyof Errors, string>]
    : JsonValue;

type MutationFormSource<Key extends string = string> = {
  errors?: Record<string, SchemaLike<unknown>>;
  input?: SchemaLike<unknown>;
  key: Key;
};

type MutationFormSourceInput<Definition> = Definition extends { input: infer InputSchema }
  ? InferSchemaLike<InputSchema> extends infer Input
    ? Input extends Record<string, JsonValue>
      ? Input
      : Record<string, JsonValue>
    : Record<string, JsonValue>
  : Record<string, JsonValue>;

type MutationFormSourceFailure<Definition> = Definition extends { errors: infer Errors }
  ? MutationErrorFailures<Errors>
  : JsonValue;

/** Extract the input shape of a `Form` definition. */
export type FormInput<Definition> =
  Definition extends Form<string, infer Input, unknown> ? Input : never;

function createMutationForm<
  const Key extends RegistryKey<MutationRegistry>,
  Input extends Record<string, JsonValue> = RegistryMutationInput<Key>,
  Failure = RegistryMutationFailure<Key>,
>(key: Key): Form<Key, Input, Failure>;
function createMutationForm<const Definition extends MutationFormSource>(
  definition: Definition,
): Form<
  Definition['key'],
  MutationFormSourceInput<Definition>,
  MutationFormSourceFailure<Definition>
>;
function createMutationForm(
  keyOrDefinition: RegistryKey<MutationRegistry> | MutationFormSource,
): Form<string, Record<string, JsonValue>, JsonValue> {
  if (typeof keyOrDefinition !== 'string') {
    assertMutationFormSourceKey(keyOrDefinition);
    return { key: keyOrDefinition.key };
  }
  const key = keyOrDefinition;
  return { key };
}

function assertMutationFormSourceKey(
  definition: MutationFormSource,
): asserts definition is MutationFormSource & { key: string } {
  if (typeof definition.key !== 'string' || definition.key.length === 0) {
    throw new TypeError(
      'form(mutation({ ... })) requires a resolved mutation key. The Kovo compiler derives one ' +
        'from the exported binding before runtime use; use the compiled artifact or generated key path.',
    );
  }
}

function getRouteForm<const Path extends RegistryKey<RouteRegistry>>(
  path: Path,
  ...args: RouteGetFormArgs<RouteFor<Path>>
): GetForm<Path, RouteSearch<RouteFor<Path>>> {
  const options = args[0] ?? {};
  const params = (options as { params?: Record<string, string> }).params;
  const action = buildHref(path, {
    ...(params === undefined ? {} : { params }),
    search: {},
  });

  const Form = Object.assign((_props: GetFormProps) => undefined, {
    action,
    [getRouteFormHelperKindKey]: 'form',
    method: 'get' as const,
  });
  const input = Object.assign(
    (nameOrProps: string | GetFormInputProps<string>) =>
      typeof nameOrProps === 'string' ? { name: nameOrProps } : undefined,
    {
      [getRouteFormHelperKindKey]: 'input',
    },
  ) as GetFormInputHelper<RouteSearch<RouteFor<Path>>>;

  return {
    action,
    Form,
    input,
    method: 'get',
    path,
  };
}

/**
 * Reference a registered mutation value as a typed form, or a GET route as a
 * search form via `form.get`. `form(addMutation)` returns a `Form` whose input
 * and failure types come from the mutation definition; `form.get(path)` returns
 * a descriptor with typed `input(name)` accessors for the route's search fields
 * (SPEC §6.3).
 *
 * @example
 * import { form } from '@kovojs/core';
 * import { addToCart } from './mutations';
 *
 * export const addToCartForm = form(addToCart);
 * export const search = form.get('/products');
 */
export const form = Object.assign(createMutationForm, {
  get: getRouteForm,
});

/**
 * Render a field-scoped mutation failure message. The compiler injects the
 * enclosing typed form's `failure` slot and validates `name` against the
 * mutation input schema (SPEC §6.3 / §9.2).
 */
export function FieldError<Failure = unknown>(props: FieldErrorProps<Failure>): string {
  if (props.failure === undefined) {
    return deferMutationFormHelper('field', props as Record<string, unknown>);
  }

  const failure = props.failure;
  if (!isRecord(failure)) return '';

  const message = fieldErrorMessage(failure, props);
  if (message === undefined || message === null || message === false) return '';

  return renderFailureOutput(props, failure, message);
}

/**
 * Render a form-scoped mutation failure message. Validation failures stay
 * field-scoped; declared coded failures render here by default (SPEC §9.2).
 */
export function FormError<Failure = unknown>(props: FormErrorProps<Failure>): string {
  if (props.failure === undefined) {
    return deferMutationFormHelper('form', props as Record<string, unknown>);
  }

  const failure = props.failure;
  if (!isRecord(failure)) return '';
  if (failure.code === 'VALIDATION') return '';
  if (!failureCodeMatches(failure, props.code)) return '';

  const message = failureMessage(failure, props);
  if (message === undefined || message === null || message === false) return '';

  return renderFailureOutput(props, failure, message);
}

function fieldErrorMessage<Failure>(
  failure: Record<string, unknown>,
  props: FieldErrorProps<Failure>,
): unknown {
  if (!failureCodeMatches(failure, props.code)) return undefined;
  if (props.message !== undefined || props.children !== undefined) {
    return failureMessage(failure, props);
  }
  if (failure.code !== 'VALIDATION') return undefined;

  const fieldErrors = failure.fieldErrors;
  if (!isRecord(fieldErrors)) return undefined;
  return fieldErrors[props.name];
}

function failureMessage<Failure>(
  failure: Record<string, unknown>,
  props: Pick<FieldErrorProps<Failure>, 'children' | 'message'>,
): unknown {
  const message = props.message ?? props.children;
  if (typeof message === 'function')
    return (message as (failure: Failure) => unknown)(failure as Failure);
  if (message !== undefined) return message;
  if (failure.code === 'VALIDATION') return undefined;
  return typeof failure.code === 'string' ? failure.code : 'Form submission failed.';
}

function failureCodeMatches(
  failure: Record<string, unknown>,
  code: string | readonly string[] | undefined,
): boolean {
  if (code === undefined) return true;
  if (typeof failure.code !== 'string') return false;
  return Array.isArray(code) ? code.includes(failure.code) : failure.code === code;
}

function renderFailureOutput<Failure>(
  props: FieldErrorProps<Failure> | FormErrorProps<Failure>,
  failure: Record<string, unknown>,
  message: unknown,
): string {
  const attrs = failureOutputAttributes(props, failure);
  return frameworkRenderedHtml(`<output${attrs}>${escapeHtmlText(String(message))}</output>`);
}

function failureOutputAttributes<Failure>(
  props: FieldErrorProps<Failure> | FormErrorProps<Failure>,
  failure: Record<string, unknown>,
): string {
  const attrs: string[] = [`role="${escapeHtmlAttribute(String(props.role ?? 'alert'))}"`];
  if (props.id !== undefined) attrs.push(`id="${escapeHtmlAttribute(props.id)}"`);
  if (props.class !== undefined) attrs.push(`class="${escapeHtmlAttribute(props.class)}"`);
  if (typeof failure.code === 'string')
    attrs.push(`data-error-code="${escapeHtmlAttribute(failure.code)}"`);
  return attrs.length === 0 ? '' : ` ${attrs.join(' ')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replaceAll('"', '&quot;');
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function frameworkRenderedHtml(html: string): string {
  const contextualRenderedHtml = currentMutationFormHelperRenderContext()?.renderHtml?.(html);
  if (contextualRenderedHtml !== undefined) return contextualRenderedHtml as string;

  const rendered: FrameworkRenderedHtml = {
    html,
    [Symbol.toPrimitive]() {
      return html;
    },
    toJSON() {
      return html;
    },
    toString() {
      return html;
    },
  };
  return rendered as unknown as string;
}
