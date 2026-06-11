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

type RegistryKey<Registry> = keyof Registry extends never
  ? string
  : Extract<keyof Registry, string>;

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
