import type { Form, FormFailure } from './forms-types.js';
import type { JsonValue } from './json.js';
import { blessSink } from './internal/sink-policy.js';
import { buildRoutePatternHref } from './internal/route-pattern.js';
import {
  isFrameworkComponentDescriptor,
  registerComponentDefinition,
  type ComponentRuntimeDefinition,
} from './internal/component-render.js';
import {
  freezeSecurityValue,
  securityArrayAppend,
  securityArrayIncludesExact,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityIsArray,
  securityObjectKeys,
  securityNullRecord,
  securityString,
  securityStringCharCodeAt,
} from './internal/security-witness-intrinsics.js';

export type { JsonValue } from './json.js';
export type { Form, FormFailure, FormValidationFailure } from './forms-types.js';
export type { ScopedKey } from './scoped-key.js';
export { publicScopedKey } from './scoped-key.js';

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

interface MutationFormHelperOperation extends FrameworkRenderedHtml {
  readonly __kovoMutationFormHelperOperation: 'v1';
  readonly kind: 'field' | 'form';
  readonly props: Record<string, unknown>;
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

const componentHandleWitness: unique symbol = Symbol('kovo.component.handle');

/**
 * Opaque callable component handle. `Props` is the complete JSX/call-site contract; the authored
 * definition is retained only in a module-private framework registry. The unexported unique-symbol
 * witness prevents ordinary functions from structurally matching this author-time handle; exact
 * WeakMap membership remains the runtime authority (SPEC §4.1/§6.6).
 */
export interface Component<Props extends object = Record<string, never>> {
  <const Input extends Props>(
    ...args: {
      [Key in keyof Props]-?: {} extends Pick<Props, Key> ? never : Key;
    }[keyof Props] extends never
      ? [props?: Input & Record<Exclude<keyof Input, keyof Props>, never>]
      : [props: Input & Record<Exclude<keyof Input, keyof Props>, never>]
  ): ComponentRenderResult;
  readonly [componentHandleWitness]: typeof componentHandleWitness;
  name?: string;
}

/** Recursive JSON-serializability guardrail for authored state/query payload types (SPEC §4.1). */
export type Serializable<T> = T extends JsonValue
  ? T
  : T extends (...args: never[]) => unknown
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
 *     <button>{state.count}</button>,
 * });
 */
export function component<
  const State = undefined,
  const Mutations extends Record<string, { key: string }> = Record<never, never>,
  const Queries extends Readonly<Record<string, unknown>> = Record<never, never>,
  const RenderInput extends object = Record<never, never>,
>(definition: {
  /** Declared clock inputs for time-dependent rendered positions and derives (SPEC §4.8/§4.9). */
  clocks?: Record<string, unknown>;
  /** Co-located component CSS scoped by the compiler to this component's host. */
  css?: string;
  /** Force-off escape hatch for inferred server refresh targets (SPEC §4.1). */
  disableServerRefresh?: boolean;
  /** Removed: query-backed components infer refresh targets; use `disableServerRefresh`. */
  fragmentTarget?: never;
  /** Unexpected render-error fallback for full-page and live-target renders (SPEC §9.2). */
  errorBoundary?: ComponentErrorBoundary;
  /** Force the compiler to keep server and client render output equivalent. */
  isomorphic?: boolean;
  mutations?: Mutations;
  /** Static metadata used by generated live-target renderers to serialize component props. */
  props?: Record<
    string,
    | ArrayConstructor
    | BooleanConstructor
    | NumberConstructor
    | ObjectConstructor
    | StringConstructor
  >;
  queries?: Queries;
  render: (
    queries: RenderInput,
    state: State,
    slots: {
      children?: ComponentChild;
      [slot: string]: unknown;
    } & (keyof Mutations extends never
      ? {
          forms?: {
            [Name in keyof Mutations]: Mutations[Name] extends { key: string }
              ? {
                  failure: FormFailure<Mutations[Name]> | null;
                  submitted?: Partial<
                    Mutations[Name] extends {
                      input: { parse(input: unknown): infer Input };
                    }
                      ? Input extends Record<string, unknown>
                        ? Input
                        : Record<string, unknown>
                      : Mutations[Name] extends Form<string, infer Input, unknown>
                        ? Input
                        : Record<string, unknown>
                  >;
                }
              : never;
          };
        }
      : {
          forms: {
            [Name in keyof Mutations]: Mutations[Name] extends { key: string }
              ? {
                  failure: FormFailure<Mutations[Name]> | null;
                  submitted?: Partial<
                    Mutations[Name] extends {
                      input: { parse(input: unknown): infer Input };
                    }
                      ? Input extends Record<string, unknown>
                        ? Input
                        : Record<string, unknown>
                      : Mutations[Name] extends Form<string, infer Input, unknown>
                        ? Input
                        : Record<string, unknown>
                  >;
                }
              : never;
          };
        }),
  ) => ComponentRenderResult;
  state?: State extends Serializable<State> ? () => State : () => never;
}): Component<
  (0 extends 1 & RenderInput
    ? Record<never, never>
    : unknown extends RenderInput
      ? Record<never, never>
      : Omit<RenderInput, Extract<keyof Queries, string>>) & {
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
>;
export function component(definition: unknown): Component<Record<string, unknown>> {
  assertKnownComponentDefinitionKeys(definition as Record<PropertyKey, unknown>);
  const descriptor = () => undefined;
  securityDefineProperty(descriptor, componentHandleWitness, {
    configurable: false,
    enumerable: false,
    value: componentHandleWitness,
    writable: false,
  });
  securityDefineProperty(descriptor, 'name', {
    configurable: true,
    enumerable: true,
    value: undefined,
    writable: true,
  });
  registerComponentDefinition(
    descriptor,
    snapshotComponentDefinition(definition as ComponentRuntimeDefinition),
  );
  return descriptor as Component<Record<string, unknown>>;
}

const componentDescriptorVerifierKey = '__kovoIsComponentDescriptor';

securityDefineProperty(component, componentDescriptorVerifierKey, {
  configurable: false,
  enumerable: false,
  value: isFrameworkComponentDescriptor,
  writable: false,
});

function snapshotComponentDefinition(
  definition: ComponentRuntimeDefinition,
): ComponentRuntimeDefinition {
  const snapshot = securityNullRecord<unknown>();
  const keys = securityObjectKeys(definition);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) continue;
    const descriptor = securityGetOwnPropertyDescriptor(definition, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`component() definition field "${key}" must be an own data value.`);
    }
    securityDefineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return freezeSecurityValue(snapshot) as unknown as ComponentRuntimeDefinition;
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

/** Per-use query freshness cadence for clock-like server values (SPEC §4.9). */
export interface QueryRefreshSpec<Result> {
  at?: (value: Result) => unknown;
  every?: string;
  renderOnce?: true;
  until?: (value: Result) => unknown;
}

/** A typed query binding with a per-use refresh cadence. */
export type QueryRefreshBinding<
  Key extends string,
  Result,
  Spec extends QueryRefreshSpec<Result>,
> = Query<Key, Result, never, never, Spec>;

/** A typed query handle: a key and the result type it resolves to. */
export interface Query<
  Key extends string,
  Result,
  Props extends Record<string, JsonValue> = never,
  Args = never,
  Spec extends QueryRefreshSpec<Result> | undefined = undefined,
> {
  args: [Props] extends [never]
    ? <NextProps extends Record<string, JsonValue>, NextArgs extends Record<string, JsonValue>>(
        mapper: (props: NextProps) => NextArgs,
      ) => Query<Key, Result, NextProps, NextArgs, Spec>
    : (props: Props) => Args;
  key: Key;
  /**
   * Declarative per-query opt-out from refetch-on-focus (SPEC §9.3/§9.4). Refetch-on-focus
   * is on by default; an app-owned query declaration may set `refetchOnFocus: false` to exclude
   * this query from the visible-return/bfcache typed-read refetch (§9.4). Only `false` is accepted:
   * `true` would be the default and a no-op field.
   */
  refetchOnFocus?: false;
  refresh<NextSpec extends QueryRefreshSpec<Result>>(
    spec: NextSpec,
  ): Query<Key, Result, Props, Args, NextSpec>;
  refreshSpec?: Spec;
  result?: Result;
}

// Public signatures cannot reference internal subpath types. Keep this type-level
// mirror local while runtime href/matching consumes `internal/route-pattern`.
/** URL path parameter names parsed from `:param` route segments. */
export type PathParamNames<Path extends string> = Path extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? Param | PathParamNames<Tail>
    : Rest extends `${infer Param}?${string}`
      ? Param
      : Rest extends `${infer Param}#${string}`
        ? Param
        : Rest
  : never;

/** Route params object inferred from a path pattern. */
export type PathParams<Path extends string> =
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
export function href<const Path extends string>(
  path: Path,
  ...args: PathParamNames<Path> extends never
    ? [
        options?: {
          params?: PathParams<Path>;
          search?: Record<string, RouteSearchValue>;
        },
      ]
    : [
        options: {
          params: PathParams<Path>;
          search?: Record<string, RouteSearchValue>;
        },
      ]
): string {
  const options = args[0] ?? {};
  return buildHref(
    path,
    options as { params?: Record<string, string>; search?: Record<string, RouteSearchValue> },
  );
}

/** Props accepted by the compiler-bound `<Link />` navigation sugar (SPEC §6.4). */
export interface LinkProps {
  children?: ComponentChild;
  params?: Record<string, string>;
  search?: Record<string, RouteSearchValue>;
  to: string;
  [attribute: string]: unknown;
}

/**
 * Compiler-bound JSX navigation sugar. Use {@link href} when imperative code
 * needs a URL string (SPEC §6.4).
 *
 * @param props - Registered route, params/search, children, and anchor attributes.
 * @returns Compiler-rendered link output.
 * @example
 * import { Link } from '@kovojs/core';
 *
 * const link = <Link to="/products/:id" params={{ id: 'p1' }}>View</Link>;
 */
export function Link(_props: LinkProps): ComponentRenderResult {
  return undefined;
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
export function redirect<const Path extends string>(
  path: Path,
  ...args: PathParamNames<Path> extends never
    ? [
        options?: {
          params?: PathParams<Path>;
          search?: Record<string, RouteSearchValue>;
        },
      ]
    : [
        options: {
          params: PathParams<Path>;
          search?: Record<string, RouteSearchValue>;
        },
      ]
): Redirect {
  const options = args[0] ?? {};
  return blessSink(ROUTE_REDIRECT_SINK, {
    location: buildHref(path, {
      ...(options.params === undefined ? {} : { params: options.params as Record<string, string> }),
      ...(options.search === undefined ? {} : { search: options.search }),
    }),
    status: 303,
  });
}

function buildHref(
  path: string,
  options: { params?: Record<string, string>; search?: Record<string, RouteSearchValue> },
): string {
  return buildRoutePatternHref(path, options);
}

/** A typed accessor for one search field of a GET form (`form.get(...).input(name)`). */
interface GetFormInput<Name extends string> {
  name: Name;
}

/** Props accepted by the compiler/runtime-bound `<f.Form />` GET-form sugar (SPEC §6.4). */
interface GetFormProps {
  children?: ComponentRenderResult;
  [attribute: string]: unknown;
}

/** Props accepted by the compiler/runtime-bound `<f.input />` GET-form sugar (SPEC §6.4). */
interface GetFormInputProps<Name extends string> {
  name: Name;
  [attribute: string]: unknown;
}

/** Renderable descriptor for a GET form element: its `action` and `method`. */
interface GetFormDescriptor {
  (props: GetFormProps): ComponentRenderResult;
  action: string;
  method: 'get';
}

/** Typed GET-form input descriptor and JSX component. */
interface GetFormInputHelper<Search extends Record<string, RouteSearchValue>> {
  <const Name extends Extract<keyof Search, string>>(name: Name): GetFormInput<Name>;
  <const Name extends Extract<keyof Search, string>>(
    props: GetFormInputProps<Name>,
  ): ComponentRenderResult;
}

/** A GET-route search form: its action, `Form` descriptor, and typed `input(name)` accessors. */
interface GetForm<
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
  message?: ComponentTextResult | ((failure: Failure) => ComponentTextResult);
  name: string;
  role?: string;
  [attribute: string]: unknown;
}

/** Props accepted by the compiler-bound `<FormError />` mutation failure helper. */
export interface FormErrorProps<
  Failure = unknown,
  Code extends string | readonly string[] | undefined = string | readonly string[] | undefined,
> {
  children?: unknown;
  class?: string;
  code?: Code;
  failure?: Failure | null;
  id?: string;
  message?:
    | ComponentTextResult
    | ((
        failure: Code extends readonly (infer Item extends string)[]
          ? Extract<NoInfer<Failure>, { code: Item }>
          : Code extends string
            ? Extract<NoInfer<Failure>, { code: Code }>
            : NoInfer<Failure>,
      ) => ComponentTextResult);
  role?: string;
  [attribute: string]: unknown;
}

type MutationFormHelperKind = 'field' | 'form';
const getRouteFormHelperKindKey = Symbol.for('kovo.getRouteFormHelperKind');

function deferMutationFormHelper(
  kind: MutationFormHelperKind,
  props: Record<string, unknown>,
): string {
  return mutationFormHelperOperation(kind, props, '') as unknown as string;
}

interface SchemaLike<Value> {
  parse(input: unknown): Value;
}

type InferSchemaLike<Schema> = Schema extends SchemaLike<infer Value> ? Value : never;

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
  const Key extends string,
  Input extends Record<string, JsonValue> = Record<string, JsonValue>,
  Failure = JsonValue,
>(key: Key): Form<Key, Input, Failure>;
function createMutationForm<const Definition extends MutationFormSource>(
  definition: Definition,
): Form<
  Definition['key'],
  MutationFormSourceInput<Definition>,
  MutationFormSourceFailure<Definition>
>;
function createMutationForm(
  keyOrDefinition: string | MutationFormSource,
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

function getRouteForm<
  const Path extends string,
  Search extends Record<string, RouteSearchValue> = Record<string, JsonValue>,
>(
  path: Path,
  ...args: PathParamNames<Path> extends never
    ? [options?: { params?: PathParams<Path> }]
    : [options: { params: PathParams<Path> }]
): GetForm<Path, Search> {
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
  ) as GetFormInputHelper<Search>;

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
 * // kovo-sample: illustrative reason="The form descriptor depends on an app-local mutation declaration."
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

  return renderFailureOutput('field', props, failure, message);
}

/**
 * Render a form-scoped mutation failure message. Validation failures stay
 * field-scoped; declared coded failures render here by default (SPEC §9.2).
 */
export function FormError<
  Failure = unknown,
  const Code extends string | readonly string[] | undefined = undefined,
>(
  props: FormErrorProps<Failure, Code>,
): string {
  if (props.failure === undefined) {
    return deferMutationFormHelper('form', props as Record<string, unknown>);
  }

  const failure = props.failure;
  if (!isRecord(failure)) return '';
  if (failure.code === 'VALIDATION') return '';
  if (!failureCodeMatches(failure, props.code)) return '';

  const message = failureMessage(failure, props);
  if (message === undefined || message === null || message === false) return '';

  return renderFailureOutput('form', props, failure, message);
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
  return securityIsArray(code)
    ? securityArrayIncludesExact(code, failure.code)
    : failure.code === code;
}

function renderFailureOutput<Failure>(
  kind: MutationFormHelperKind,
  props:
    | FieldErrorProps<Failure>
    | FormErrorProps<Failure, string | readonly string[] | undefined>,
  failure: Record<string, unknown>,
  message: unknown,
): string {
  const attrs = failureOutputAttributes(props, failure);
  return mutationFormHelperOperation(
    kind,
    props as Record<string, unknown>,
    `<output${attrs}>${escapeHtmlText(securityString(message))}</output>`,
  ) as unknown as string;
}

function failureOutputAttributes<Failure>(
  props:
    | FieldErrorProps<Failure>
    | FormErrorProps<Failure, string | readonly string[] | undefined>,
  failure: Record<string, unknown>,
): string {
  const role = failureOutputOwnString(props, 'role') ?? 'alert';
  const id = failureOutputOwnString(props, 'id');
  const className = failureOutputOwnString(props, 'class');
  const code = failureOutputOwnString(failure, 'code');
  const attrs: string[] = [`role="${escapeHtmlAttribute(role)}"`];
  if (id !== undefined) securityArrayAppend(attrs, `id="${escapeHtmlAttribute(id)}"`);
  if (className !== undefined) {
    securityArrayAppend(attrs, `class="${escapeHtmlAttribute(className)}"`);
  }
  if (code !== undefined) {
    securityArrayAppend(attrs, `data-error-code="${escapeHtmlAttribute(code)}"`);
  }
  let rendered = '';
  for (let index = 0; index < attrs.length; index += 1) {
    rendered += `${index === 0 ? '' : ' '}${attrs[index] ?? ''}`;
  }
  return rendered === '' ? '' : ` ${rendered}`;
}

function failureOutputOwnString(value: object, property: 'class' | 'code' | 'id' | 'role') {
  const before = securityGetOwnPropertyDescriptor(value, property);
  const after = securityGetOwnPropertyDescriptor(value, property);
  if (before === undefined && after === undefined) return undefined;
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    before.value !== after.value ||
    (before.value !== undefined && typeof before.value !== 'string')
  ) {
    throw new TypeError(
      `Kovo failure output ${property} must be a stable own string data property.`,
    );
  }
  return before.value as string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value, true);
}

function escapeHtmlText(value: string): string {
  return escapeHtml(value, false);
}

function escapeHtml(value: string, attribute: boolean): string {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    escaped +=
      code === 0x26
        ? '&amp;'
        : code === 0x3c
          ? '&lt;'
          : code === 0x3e
            ? '&gt;'
            : attribute && code === 0x22
              ? '&quot;'
              : (value[index] ?? '');
  }
  return escaped;
}

function mutationFormHelperOperation(
  kind: MutationFormHelperKind,
  props: Record<string, unknown>,
  html: string,
): MutationFormHelperOperation {
  return {
    __kovoMutationFormHelperOperation: 'v1',
    html,
    kind,
    props,
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
}
