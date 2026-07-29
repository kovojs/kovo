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

/** Extract a form or declaration-handle failure union, including validation failure. */
export type FormFailure<Definition> =
  Definition extends {
    input: { parse(input: unknown): unknown };
    errors?: infer Errors;
  }
    ?
        | (NonNullable<Errors> extends Record<
            string,
            { parse(input: unknown): unknown }
          >
            ? {
                [Code in Extract<keyof NonNullable<Errors>, string>]: {
                  code: Code;
                  payload: NonNullable<Errors>[Code] extends {
                    parse(input: unknown): infer Payload;
                  }
                    ? Payload
                    : never;
                };
              }[Extract<keyof NonNullable<Errors>, string>]
            : never)
        | FormValidationFailure
    : Definition extends Form<string, any, infer Failure>
      ? Failure | FormValidationFailure
      : FormValidationFailure;

/** Render state for one typed mutation form instance. */
export interface ComponentMutationFormState<
  Failure,
  Input extends Record<string, unknown> = Record<string, JsonValue>,
> {
  failure: Failure | null;
  submitted?: Partial<Input>;
}

/** @internal Internal building block of `ComponentRenderSlots`; not app-facing. */
export type ComponentMutationDefinitions = Record<string, { key: string }>;

/**
 * @internal Render state keyed by a component's declared mutation handles.
 * Internal building block of `ComponentRenderSlots` (SPEC §4.5/§6.3); app
 * authors compose slots through `ComponentRenderSlots`, never this map directly.
 */
export type ComponentMutationForms<Mutations> = {
  [Name in keyof Mutations]: Mutations[Name] extends { key: string }
    ? ComponentMutationFormState<
        FormFailure<Mutations[Name]>,
        Mutations[Name] extends {
          input: { parse(input: unknown): infer Input };
        }
          ? Input extends Record<string, unknown>
            ? Input
            : Record<string, unknown>
          : Mutations[Name] extends Form<string, infer Input, unknown>
            ? Input
            : Record<string, unknown>
      >
    : never;
};
