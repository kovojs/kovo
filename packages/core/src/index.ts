import type { ComponentMutationDefinitions, ComponentMutationForms, Form } from './forms-types.js';
import type { JsonValue } from './json.js';

export type { DiagnosticCode, DiagnosticSeverity } from './diagnostics.js';
export type { JsonValue } from './json.js';
export { trustedReveal } from './secret.js';
export type {
  Secret,
  TrustedRevealMethod,
  TrustedRevealOptions,
  TrustedRevealValue,
} from './secret.js';
export type {
  ComponentMutationFormState,
  Form,
  FormFailure,
  FormValidationFailure,
} from './forms-types.js';
export type {
  StorageBody,
  StorageCapability,
  StorageGetResult,
  StorageObjectInfo,
  StoragePutOptions,
  StoragePutResult,
  StorageStreamResult,
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
  children?: unknown;
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
  /** Force-off escape hatch for inferred server refresh targets (SPEC §4.1). */
  disableServerRefresh?: boolean;
  /** Removed: query-backed components infer refresh targets; use `disableServerRefresh` to opt out. */
  fragmentTarget?: never;
  /** Unexpected render-error fallback for full-page and live-target renders (SPEC §9.2). */
  errorBoundary?: ComponentErrorBoundary;
  mutations?: Record<string, unknown>;
  queries?: unknown;
  state?: () => JsonValue;
  render: (...args: never[]) => ComponentRenderResult;
}

/** A component descriptor returned by `component()`; the compiler injects `name` after derivation. */
export interface Component<Definition extends ComponentDefinitionInput> {
  (props?: Record<string, unknown>): any;
  definition: Definition;
  name?: string;
}

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
  const Definition extends Omit<ComponentDefinitionInput, 'mutations' | 'render'> & {
    mutations?: ComponentMutationDefinitions;
    render: (...args: any[]) => ComponentRenderResult;
  },
>(
  definition: Definition & {
    render: (
      queries: any,
      state: any,
      slots: ComponentRenderSlots<ComponentDefinitionMutations<Definition>>,
    ) => ComponentRenderResult;
  },
): Component<Definition> {
  const descriptor = (() => undefined) as Component<Definition>;
  Object.defineProperty(descriptor, 'name', {
    configurable: true,
    enumerable: true,
    value: undefined,
    writable: true,
  });
  descriptor.definition = definition;
  return descriptor;
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
export interface QueryArgsBinding<Key extends string, Result, Props, Args> {
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
  refresh<Spec extends QueryRefreshSpec<Result>>(
    spec: Spec,
  ): QueryRefreshBinding<Key, Result, Spec>;
  refreshSpec?: undefined;
  result?: Result;
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

// H1 (bugs-part4 L6-1): a param name is the whole segment after `:` up to the next
// `/`, `?`, or `#`. This mirrors the runtime matcher (server match.ts
// `parseRouteSegment`, which takes the entire segment after `:`) and `buildHref`'s
// `:([^/?#]+)` substitution, so a hyphen/dot param name (`:user-id`, `:name.json`)
// is one key across the type extractor, the URL builders, and the matcher.
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

/** A route descriptor: typed path, param/search shapes, and prefetch policy. */
export interface Route<
  Path extends string,
  Params extends Record<string, string> = PathParams<Path>,
  Search extends Record<string, JsonValue> = Record<string, JsonValue>,
> {
  path: Path;
  params?: Params;
  prefetch?: 'conservative' | 'moderate' | false;
  search?: Search;
}

/** Options accepted by `route()`: param/search shapes and prefetch policy. */
export interface RouteOptions<
  Params extends Record<string, string> = Record<string, never>,
  Search extends Record<string, JsonValue> = Record<string, JsonValue>,
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
  Definition extends Route<string, infer Params, Record<string, JsonValue>> ? Params : never;

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
  Search extends Record<string, JsonValue> = Record<string, JsonValue>,
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
    options as { params?: Record<string, string>; search?: Record<string, JsonValue> },
  );
}

/** Result of `Link()`: a resolved `href` string ready to spread onto an anchor. */
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
export function Link<const Path extends RegistryKey<RouteRegistry>>(
  path: Path,
  options: RouteHrefOptions<RouteFor<Path>>,
): LinkDescriptor {
  return { href: href(path, options) };
}

/** A 303 redirect outcome returned by `redirect()`. */
export interface Redirect {
  location: string;
  status: 303;
}

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
  return {
    location: href(path, options),
    status: 303,
  };
}

function buildHref(
  path: string,
  options: { params?: Record<string, string>; search?: Record<string, JsonValue> },
): string {
  const params = options.params ?? {};
  // H1 (bugs-part4 L6-1): the param name is the whole segment after `:` up to the
  // next `/`, `?`, or `#`, matching both the `PathParamNames` type extractor above
  // and the runtime matcher (server match.ts `parseRouteSegment`, which takes the
  // entire segment after `:`). A narrower `\w`-only name dropped hyphen/dot params
  // (`:user-id` matched only `user`, emitting `/users/-id` instead of `/users/42`).
  const pathname = path.replace(/:([^/?#]+)/g, (_match, key: string) =>
    encodeURIComponent(params[key] ?? ''),
  );
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(options.search ?? {})) {
    if (value === null || value === undefined) continue;
    search.set(key, searchValueToString(value));
  }

  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function searchValueToString(value: JsonValue): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Reference a registered query by key for component bindings. This is the
 * client-facing query handle (just `{ key }`); the server-side query with a
 * loader and read set is `query` from `@kovojs/server` (SPEC §10.2).
 *
 * @param key - A registered query key.
 * @returns A typed `Query` handle whose `result` reflects the registry entry.
 * @example
 * import { query } from '@kovojs/core';
 *
 * export const cart = query('cart');
 */
export function query<
  const Key extends RegistryKey<QueryRegistry>,
  Result = Key extends keyof QueryRegistry ? QueryRegistry[Key] : unknown,
>(key: Key): Query<Key, Result> {
  return queryBinding<Key, Result>(key);
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

/** Renderable descriptor for a GET form element: its `action` and `method`. */
export interface GetFormDescriptor {
  action: string;
  method: 'get';
}

/** A GET-route search form: its action, `Form` descriptor, and typed `input(name)` accessors. */
export interface GetForm<
  Path extends string,
  Search extends Record<string, JsonValue> = Record<string, JsonValue>,
> {
  action: string;
  Form: GetFormDescriptor;
  input<const Name extends Extract<keyof Search, string>>(name: Name): GetFormInput<Name>;
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

interface MutationFormHelperPlaceholder {
  kind: MutationFormHelperKind;
  props: Record<string, unknown>;
}

interface MutationFormHelperRegistry {
  nextId: number;
  placeholders: Map<number, MutationFormHelperPlaceholder>;
}

const mutationFormHelperRegistryKey = Symbol.for('kovo.mutationFormHelperRegistry');

function mutationFormHelperRegistry(): MutationFormHelperRegistry {
  const global = globalThis as typeof globalThis & Record<symbol, unknown>;
  global[mutationFormHelperRegistryKey] ??= {
    nextId: 0,
    placeholders: new Map(),
  };
  return global[mutationFormHelperRegistryKey] as MutationFormHelperRegistry;
}

function deferMutationFormHelper(
  kind: MutationFormHelperKind,
  props: Record<string, unknown>,
): string {
  const registry = mutationFormHelperRegistry();
  registry.nextId += 1;
  registry.placeholders.set(registry.nextId, { kind, props });
  return `<!--kovo-form-helper:${registry.nextId}-->`;
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

/** Extract the input shape of a `Form` definition. */
export type FormInput<Definition> =
  Definition extends Form<string, infer Input, unknown> ? Input : never;

function createMutationForm<
  const Key extends RegistryKey<MutationRegistry>,
  Input extends Record<string, JsonValue> = RegistryMutationInput<Key>,
  Failure = RegistryMutationFailure<Key>,
>(key: Key): Form<Key, Input, Failure> {
  return { key };
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

  return {
    action,
    Form: {
      action,
      method: 'get',
    },
    input(name) {
      return { name };
    },
    method: 'get',
    path,
  };
}

/**
 * Reference a registered mutation as a typed form, or a GET route as a search
 * form via `form.get`. `form(key)` returns a `Form` whose input and failure
 * types come from the mutation registry; `form.get(path)` returns a descriptor
 * with typed `input(name)` accessors for the route's search fields (SPEC §6.3).
 *
 * @example
 * import { form } from '@kovojs/core';
 *
 * export const addToCart = form('cart/add');
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
  return `<output${attrs}>${escapeHtmlText(String(message))}</output>`;
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
