import type { ComponentMutationFormState, Form, FormFailure } from '../index.js';

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
