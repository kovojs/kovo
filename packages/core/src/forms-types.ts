import type { JsonValue } from './json.js';

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

/** The built-in validation failure shape returned when form input fails parsing. */
export interface FormValidationFailure {
  code: 'VALIDATION';
  fieldErrors: Record<string, string>;
}

/** Extract the failure type of a `Form`, unioned with the built-in validation failure. */
export type FormFailure<Definition> =
  Definition extends Form<string, any, infer Failure> ? Failure | FormValidationFailure : never;

/** Render state for one typed mutation form instance. */
export interface ComponentMutationFormState<Failure> {
  failure: Failure | null;
}

/** @internal Internal building block of `ComponentRenderSlots`; not app-facing. */
export type ComponentMutationDefinitions = Record<string, Form<string, any, any>>;

/**
 * @internal Render state keyed by a component's declared mutation handles.
 * Internal building block of `ComponentRenderSlots` (SPEC §4.5/§6.3); app
 * authors compose slots through `ComponentRenderSlots`, never this map directly.
 */
export type ComponentMutationForms<Mutations extends ComponentMutationDefinitions> = {
  [Name in keyof Mutations]: ComponentMutationFormState<FormFailure<Mutations[Name]>>;
};
