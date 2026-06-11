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
  AttributeMergeExplain,
  CaptureChannel,
  ComponentExplain,
  DeriveExplain,
  EndpointExplain,
  EventPayloadFact,
  FixpointCheck,
  FwCheckInput,
  FwExplainInput,
  GraphInputValidationError,
  HandlerExplain,
  MutationExplain,
  OptimisticCoverage,
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
export { validateFwExplainInput } from './graph.js';
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

export interface EndpointRegistry {}

export type EndpointMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' | (string & {});

export type EndpointMount = 'exact' | 'prefix';

export interface EndpointCsrfExemption {
  exempt: true;
  justification: string;
}

export type EndpointAuthDeclaration =
  | { kind: 'custom'; name: string }
  | { kind: 'none'; justification: string }
  | { kind: 'verifier'; name: string };

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

type RouteGetFormArgs<Definition> = keyof RouteParams<Definition> extends never
  ? [options?: { params?: RouteParams<Definition> }]
  : [options: { params: RouteParams<Definition> }];

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
  Failure = JsonValue,
> {
  failure?: Failure;
  input?: Input;
  key: Key;
}

export interface GetFormInput<Name extends string> {
  name: Name;
}

export interface GetFormDescriptor {
  action: string;
  method: 'get';
}

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

export type FormInput<Definition> =
  Definition extends Form<string, infer Input, unknown> ? Input : never;

export type FormFailure<Definition> =
  Definition extends Form<string, Record<string, JsonValue>, infer Failure>
    ? Failure | FormValidationFailure
    : never;

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

export const form = Object.assign(createMutationForm, {
  get: getRouteForm,
});

export function formFields<
  Definition extends Form<string, Record<string, JsonValue>, unknown>,
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
