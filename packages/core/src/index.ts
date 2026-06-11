export type { DiagnosticCode, DiagnosticDefinition, DiagnosticSeverity } from './diagnostics.js';
export { diagnosticDefinitions, getDiagnosticDefinition } from './diagnostics.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ComponentRenderResult = unknown;

export interface ComponentDefinition<
  Queries = Record<string, unknown>,
  State extends JsonValue = JsonValue,
> {
  fragmentTarget?: boolean;
  queries?: Queries;
  state?: () => State;
  render: (queries: Queries, state: State) => ComponentRenderResult;
}

export interface ComponentDefinitionInput {
  fragmentTarget?: boolean;
  queries?: unknown;
  state?: () => JsonValue;
  render: (...args: never[]) => ComponentRenderResult;
}

export interface Component<Name extends string, Definition extends ComponentDefinitionInput> {
  name: Name;
  definition: Definition;
}

export function component<
  const Name extends string,
  const Definition extends ComponentDefinitionInput,
>(name: Name, definition: Definition): Component<Name, Definition> {
  return { definition, name };
}

export interface Query<Key extends string, Result> {
  key: Key;
  result?: Result;
}

export interface QueryRegistry {}

export interface MutationRegistry {}

export interface FragmentTargets {}

export interface RouteRegistry {}

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

export function route<
  const Path extends string,
  Params extends Record<string, string> = PathParams<Path>,
  Search extends Record<string, JsonValue> = Record<string, JsonValue>,
>(path: Path, options: RouteOptions<Params, Search> = {}): Route<Path, Params, Search> {
  return { ...options, path };
}

export function href<const Path extends RegistryKey<RouteRegistry>>(
  path: Path,
  options: RouteHrefOptions<RouteFor<Path>>,
): string {
  return buildHref(
    path,
    options as { params?: Record<string, string>; search?: Record<string, JsonValue> },
  );
}

export interface LinkDescriptor {
  href: string;
}

export function Link<const Path extends RegistryKey<RouteRegistry>>(
  path: Path,
  options: RouteHrefOptions<RouteFor<Path>>,
): LinkDescriptor {
  return { href: href(path, options) };
}

export interface Redirect {
  location: string;
  status: 303;
}

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

export function query<
  const Key extends RegistryKey<QueryRegistry>,
  Result = Key extends keyof QueryRegistry ? QueryRegistry[Key] : unknown,
>(key: Key): Query<Key, Result> {
  return { key };
}

export interface Form<
  Key extends string,
  Input extends Record<string, JsonValue> = Record<string, JsonValue>,
  Failure extends JsonValue = JsonValue,
> {
  failure?: Failure;
  input?: Input;
  key: Key;
}

export interface FormValidationFailure {
  code: 'VALIDATION';
  fields: Record<string, string>;
}

export type FormInput<Definition> =
  Definition extends Form<string, infer Input, JsonValue> ? Input : never;

export type FormFailure<Definition> =
  Definition extends Form<string, Record<string, JsonValue>, infer Failure>
    ? Failure | FormValidationFailure
    : never;

export type FormFieldName<Definition> = Extract<keyof FormInput<Definition>, string>;

type MissingFormFields<
  Definition extends Form<string, Record<string, JsonValue>, JsonValue>,
  Fields extends readonly string[],
> = Exclude<FormFieldName<Definition>, Fields[number]>;

type CompleteFormFields<
  Definition extends Form<string, Record<string, JsonValue>, JsonValue>,
  Fields extends readonly FormFieldName<Definition>[],
> =
  MissingFormFields<Definition, Fields> extends never
    ? Fields
    : readonly ['Missing form fields', MissingFormFields<Definition, Fields>];

export function form<
  const Key extends RegistryKey<MutationRegistry>,
  Input extends Record<string, JsonValue> = Record<string, JsonValue>,
  Failure extends JsonValue = JsonValue,
>(key: Key): Form<Key, Input, Failure> {
  return { key };
}

export function formFields<
  Definition extends Form<string, Record<string, JsonValue>, JsonValue>,
  const Fields extends readonly FormFieldName<Definition>[],
>(_form: Definition, fields: CompleteFormFields<Definition, Fields>): Fields {
  return fields as Fields;
}

export interface FragmentTargetPatch<Target extends string, Props> {
  props: Props;
  target: Target;
}

export function fragmentTarget<const Target extends RegistryKey<FragmentTargets>>(
  target: Target,
  props: Target extends keyof FragmentTargets ? FragmentTargets[Target] : Record<string, never>,
): FragmentTargetPatch<
  Target,
  Target extends keyof FragmentTargets ? FragmentTargets[Target] : Record<string, never>
> {
  return { props, target };
}

export interface EventDefinition<Name extends string, Payload extends JsonValue = JsonValue> {
  name: Name;
  payload?: Payload;
  serverFactKeys?: readonly string[];
}

export type EventPayload<Definition> =
  Definition extends EventDefinition<string, infer Payload> ? Payload : never;

export interface EventOptions<Payload extends JsonValue = JsonValue> {
  serverFactKeys?: readonly Extract<keyof Payload, string>[];
}

export function event<const Name extends string, Payload extends JsonValue = JsonValue>(
  name: Name,
  options: EventOptions<Payload> = {},
): EventDefinition<Name, Payload> {
  return {
    name,
    ...(options.serverFactKeys === undefined ? {} : { serverFactKeys: options.serverFactKeys }),
  };
}
