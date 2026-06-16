export type {
  DiagnosticCode,
  DiagnosticDefinition,
  DiagnosticSeverity,
  DiagnosticTextOptions,
} from './diagnostics.js';
export {
  diagnosticDefinitions,
  diagnosticDefinitionText,
  isDiagnosticCode,
} from './diagnostics.js';
export type {
  AlgebraicField,
  AlgebraicQueryShape,
  ApplyPatchOptions,
  ArithOp,
  DerivationResult,
  DerivationStatus,
  OrderByColumn,
  PatchOp,
  PatchProgram,
  PlaceholderKind,
  PuntReason,
  PushPosition,
  RowMatch,
  Rowset,
  RowsetFilter,
  RowWitness,
  SymbolicEffect,
  SymbolicKeyEq,
  SymbolicMatch,
  SymbolicValue,
} from './derivation.js';
export { applyPatchProgram, derived, punt, puntReasonLabel } from './derivation.js';
export type {
  AttributeMergeExplain,
  CaptureChannel,
  ComponentExplain,
  DeriveExplain,
  EndpointExplain,
  EventPayloadFact,
  FixpointCheck,
  KovoCheckInput,
  KovoExplainInput,
  GraphInputValidationError,
  HandlerExplain,
  MutationExplain,
  OptimisticCoverage,
  PackageComponentPrefixExplain,
  OwnerDomainFact,
  PageExplain,
  PageMetaExplain,
  PlatformSubstitutionExplain,
  QueryDataFact,
  QueryReadSet,
  ReadSite,
  RenderEquivalenceCheck,
  ScopeAuditFact,
  SemanticLint,
  SourcePosition,
  StaticDiagnosticFact,
  TouchGraph,
  TouchGraphEntry,
  TouchSite,
  TriggerExplain,
  UnresolvedWriteSite,
  UpdateCoverageFact,
  VerificationDiagnosticFact,
} from './graph.js';
export { validateKovoExplainInput } from './graph.js';
export type { PackageComponentPrefixManifestOptions } from './package-prefix.js';
export { packageComponentPrefixFactFromPackageManifest } from './package-prefix.js';
export type {
  FileSystemStorageOptions,
  MemoryStorageOptions,
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
  StorageGetResult,
  StorageObjectInfo,
  StoragePutOptions,
  StoragePutResult,
  StorageStreamResult,
} from './storage.js';
export {
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
  normalizeStorageKey,
  storageBodyToBytes,
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
  StripeSignatureOptions,
  WebhookHeaders,
  WebhookHeaderValue,
  WebhookPayload,
  WebhookVerificationRequest,
  WebhookVerifier,
} from './verifier.js';
export { customVerifier, hmacSignature, standardWebhooks, stripeSignature } from './verifier.js';

/** Any value that survives a JSON round-trip; the boundary type for island state and wire payloads (SPEC §4.1). */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Opaque result of a component's `render` — the compiler lowers it to HTML/IR. */
export type ComponentRenderResult = unknown;

/** Typed body of a component: its query bindings, island state factory, and `render`. */
export interface ComponentDefinition<
  Queries = Record<string, unknown>,
  State extends JsonValue = JsonValue,
> {
  fragmentTarget?: boolean;
  queries?: Queries;
  state?: () => State;
  render: (queries: Queries, state: State) => ComponentRenderResult;
}

/** Loosely-typed input accepted by `component()` before inference narrows it. */
export interface ComponentDefinitionInput {
  fragmentTarget?: boolean;
  queries?: unknown;
  state?: () => JsonValue;
  render: (...args: never[]) => ComponentRenderResult;
}

/** A component descriptor returned by `component()`; the compiler injects `name` after derivation. */
export interface Component<Definition extends ComponentDefinitionInput> {
  definition: Definition;
  name?: string;
}

/**
 * Declare a UI component with optional query bindings, optional serializable
 * island state, and a render function. The compiler derives the component's
 * load-bearing name from the exported binding and module path; queries and
 * state are passed to `render` at runtime. Authored components are plain TSX —
 * the compiler derives stamps, bindings, names, and the client module, so you
 * never write derivable `data-bind`/`kovo-*` attributes by hand (SPEC §4.1,
 * §4.8).
 *
 * @param definition - `render` plus optional `queries`, `state`, and `fragmentTarget`.
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
  const Definition extends ComponentDefinitionInput,
>(definition: Definition): Component<Definition> {
  return { definition };
}

/** A typed query handle: a key and the result type it resolves to. */
export interface Query<Key extends string, Result> {
  key: Key;
  result?: Result;
}

/** Augmentable registry mapping query keys to result types (declaration-merged by apps). */
export interface QueryRegistry {}

/** Augmentable registry mapping mutation keys to input/failure types. */
export interface MutationRegistry {}

/** Augmentable registry mapping fragment-target names to their props. */
export interface FragmentTargets {}

/** Augmentable registry mapping derived component registry keys to component descriptors. */
export interface ComponentRegistry {}

/** Augmentable registry mapping route paths to their `Route` descriptors. */
export interface RouteRegistry {}

/** Augmentable registry of declared endpoints. */
export interface EndpointRegistry {}

/** HTTP method for an endpoint; arbitrary strings are allowed for custom verbs. */
export type EndpointMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' | (string & {});

/** Whether an endpoint matches an exact path or a path prefix. */
export type EndpointMount = 'exact' | 'prefix';

/** Records an explicit, justified opt-out of default-on CSRF for an endpoint (SPEC §6.6). */
export interface EndpointCsrfExemption {
  exempt: true;
  justification: string;
}

/** How an endpoint authenticates: a named verifier, a named custom scheme, or a justified `none`. */
export type EndpointAuthDeclaration =
  | { kind: 'custom'; name: string }
  | { kind: 'none'; justification: string }
  | { kind: 'verifier'; name: string };

/** A raw HTTP endpoint descriptor: path, method, mount mode, and auth/CSRF declarations. */
export interface Endpoint<
  Path extends string,
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = 'exact',
> {
  auth?: EndpointAuthDeclaration;
  csrf?: EndpointCsrfExemption;
  method?: Method;
  mount: Mount;
  path: Path;
}

/** Augmentable registry mapping mutation keys to the query names they invalidate (drives `OptimisticFor`). */
export interface InvalidationSets {}

type RegistryKey<Registry> = keyof Registry extends never
  ? string
  : Extract<keyof Registry, string>;

type PathParamNames<Path extends string> = Path extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? Param | PathParamNames<Tail>
    : Rest extends `${infer Param}?${string}`
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
  const pathname = path.replace(/:([A-Za-z_$][\w$]*)/g, (_match, key: string) =>
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
  return { key };
}

/** A typed mutation form handle: its key, input shape, and failure type. */
export interface Form<
  Key extends string,
  Input extends Record<string, JsonValue> = Record<string, JsonValue>,
  Failure = JsonValue,
> {
  failure?: Failure;
  input?: Input;
  key: Key;
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

/** The built-in validation failure shape returned when form input fails parsing. */
export interface FormValidationFailure {
  code: 'VALIDATION';
  fields: Record<string, string>;
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
  ? MutationRegistry[Key] extends Form<string, Record<string, JsonValue>, infer Failure>
    ? Failure
    : MutationRegistry[Key] extends { errors?: infer Errors }
      ? MutationErrorFailures<Errors>
      : JsonValue
  : JsonValue;

type MutationErrorFailures<Errors> =
  Errors extends Record<string, SchemaLike<unknown>>
    ? {
        [Code in Extract<keyof Errors, string>]: {
          code: Code;
          data: InferSchemaLike<Errors[Code]>;
        };
      }[Extract<keyof Errors, string>]
    : JsonValue;

/** Extract the input shape of a `Form` definition. */
export type FormInput<Definition> =
  Definition extends Form<string, infer Input, unknown> ? Input : never;

/** Extract the failure type of a `Form`, unioned with the built-in validation failure. */
export type FormFailure<Definition> =
  Definition extends Form<string, Record<string, JsonValue>, infer Failure>
    ? Failure | FormValidationFailure
    : never;

/** The string-literal union of a form's field names. */
export type FormFieldName<Definition> = Extract<keyof FormInput<Definition>, string>;

type MissingFormFields<
  Definition extends Form<string, Record<string, JsonValue>, unknown>,
  Fields extends readonly string[],
> = Exclude<FormFieldName<Definition>, Fields[number]>;

type CompleteFormFields<
  Definition extends Form<string, Record<string, JsonValue>, unknown>,
  Fields extends readonly FormFieldName<Definition>[],
> =
  MissingFormFields<Definition, Fields> extends never
    ? Fields
    : readonly ['Missing form fields', MissingFormFields<Definition, Fields>];

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
 * Assert and return the exhaustive field list of a form. TypeScript rejects the
 * call unless `fields` names every input field of the form, so renaming a field
 * surfaces as a type error at every call site (SPEC §6.3).
 *
 * @param _form - The form whose fields are being enumerated.
 * @param fields - The complete tuple of the form's field names.
 * @returns The same `fields` tuple, typed.
 */
export function formFields<
  Definition extends Form<string, Record<string, JsonValue>, unknown>,
  const Fields extends readonly FormFieldName<Definition>[],
>(_form: Definition, fields: CompleteFormFields<Definition, Fields>): Fields {
  return fields as Fields;
}

/** A fragment-target patch: the target name plus the props to re-render it with. */
export interface FragmentTargetPatch<Target extends string, Props> {
  props: Props;
  target: Target;
}

/**
 * Address a server-rendered fragment target for a wire patch, pairing the
 * target name with its typed props. The mutation wire replaces the live
 * `<kovo-fragment target="…">` with freshly rendered HTML (SPEC §9.1).
 *
 * @param target - A registered fragment-target name.
 * @param props - The props that target's renderer expects.
 * @returns A `FragmentTargetPatch` carrying the target and props.
 * @example
 * import { fragmentTarget } from '@kovojs/core';
 *
 * const patch = fragmentTarget('product-form', {});
 * // patch.target === 'product-form'
 */
export function fragmentTarget<const Target extends RegistryKey<FragmentTargets>>(
  target: Target,
  props: Target extends keyof FragmentTargets ? FragmentTargets[Target] : Record<string, never>,
): FragmentTargetPatch<
  Target,
  Target extends keyof FragmentTargets ? FragmentTargets[Target] : Record<string, never>
> {
  return { props, target };
}

/** A typed event descriptor: its name, payload type, and server-populated payload keys. */
export interface EventDefinition<Name extends string, Payload extends JsonValue = JsonValue> {
  name: Name;
  payload?: Payload;
  serverFactKeys?: readonly string[];
}

/** Extract the payload type of an `EventDefinition`. */
export type EventPayload<Definition> =
  Definition extends EventDefinition<string, infer Payload> ? Payload : never;

/** Options for `event()`: which payload keys the server is allowed to supply. */
export interface EventOptions<Payload extends JsonValue = JsonValue> {
  serverFactKeys?: readonly Extract<keyof Payload, string>[];
}

/**
 * Declare a typed client event with a serializable payload. Handlers dispatch
 * and listen for events by this name; `serverFactKeys` marks payload fields the
 * server is allowed to populate (SPEC §4.3).
 *
 * @param name - Event name used when dispatching and listening.
 * @param options - Optional `serverFactKeys` naming server-provided payload fields.
 * @returns An `EventDefinition` whose `payload` type is `Payload`.
 * @example
 * import { event } from '@kovojs/core';
 *
 * export const itemAdded = event<'item-added', { id: string }>('item-added');
 */
export function event<const Name extends string, Payload extends JsonValue = JsonValue>(
  name: Name,
  options: EventOptions<Payload> = {},
): EventDefinition<Name, Payload> {
  return {
    name,
    ...(options.serverFactKeys === undefined ? {} : { serverFactKeys: options.serverFactKeys }),
  };
}
