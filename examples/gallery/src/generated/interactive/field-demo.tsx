// @kovojs-ir - lowered from examples/gallery/src/interactive/field-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryFieldDemo$Field_data_invalid_derive = derive(['state'], (state: any) =>
  state.invalid ? '' : null,
);
export const GalleryFieldDemo$FieldControl_aria_describedby_derive = derive(
  ['state'],
  (state: any) =>
    state.invalid
      ? 'gallery-interactive-field-email-description gallery-interactive-field-email-error'
      : 'gallery-interactive-field-email-description',
);
export const GalleryFieldDemo$FieldControl_aria_invalid_derive = derive(['state'], (state: any) =>
  state.invalid ? 'true' : null,
);
export const GalleryFieldDemo$FieldControl_data_invalid_derive = derive(['state'], (state: any) =>
  state.invalid ? '' : null,
);
export const GalleryFieldDemo$FieldControl_value_derive = derive(
  ['state'],
  (state: any) => state.email,
);
export const GalleryFieldDemo$UiFieldError_hidden_derive = derive(['state'], (state: any) =>
  !state.invalid ? '' : null,
);
export const GalleryFieldDemo$UiFieldError_visible_derive = derive(
  ['state'],
  (state: any) => state.invalid,
);
export const GalleryFieldDemo$FieldSelect_value_derive = derive(
  ['state'],
  (state: any) => state.plan,
);
export const GalleryFieldDemo$FieldSelectOption_selected_derive = derive(['state'], (state: any) =>
  state.plan === 'team' ? '' : null,
);
export const GalleryFieldDemo$FieldSelectOption_selected_derive_2 = derive(
  ['state'],
  (state: any) => (state.plan === 'enterprise' ? '' : null),
);
export const GalleryFieldDemo$Fieldset_data_disabled_derive = derive(['state'], (state: any) =>
  state.shippingDisabled ? '' : null,
);
export const GalleryFieldDemo$Fieldset_disabled_derive = derive(['state'], (state: any) =>
  state.shippingDisabled ? '' : null,
);
export const GalleryFieldDemo$input_checked_derive = derive(['state'], (state: any) =>
  state.shippingDisabled ? '' : null,
);

import { component } from '@kovojs/core';
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError as UiFieldError,
  FieldLabel,
  FieldSelect,
  FieldSelectOption,
  Fieldset,
  FieldsetLegend,
  FieldTextarea,
} from '@kovojs/ui/field';

const OUTPUT_CLASS = 'text-xs text-neutral-500';

export interface GalleryFieldDemoState {
  email: string;
  invalid: boolean;
  plan: string;
  shippingDisabled: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryFieldDemo = component({
  state: () => ({
    email: 'ada@example',
    invalid: true,
    plan: 'team',
    shippingDisabled: false,
  }),
  render: (_queries: Record<string, never>, state: GalleryFieldDemoState) => {
    const emailFieldState = {
      invalid: state.invalid,
      required: true,
    };
    const fieldsetState = {
      disabled: state.shippingDisabled,
      required: true,
    };

    return (
      <form
        data-gallery-interactive="field"
        id="gallery-interactive-field-form"
        class="grid gap-4"
        kovo-c="gallery-field-demo"
        kovo-state='{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}'
      >
        <Field
          id="gallery-interactive-field-email"
          {...emailFieldState}
          data-invalid={state.invalid ? '' : null}
          data-bind:data-invalid="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$Field_data_invalid_derive"
        >
          <FieldLabel
            controlId="gallery-interactive-field-email-input"
            id="gallery-interactive-field-email-label"
            {...emailFieldState}
          >
            Email
          </FieldLabel>
          <FieldControl
            descriptionId="gallery-interactive-field-email-description"
            errorId="gallery-interactive-field-email-error"
            form="gallery-interactive-field-form"
            id="gallery-interactive-field-email-input"
            name="gallery-email"
            on:input="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldControl_input"
            pattern=".+@kovo\\.sh"
            type="email"
            {...emailFieldState}
            aria-describedby={
              state.invalid
                ? 'gallery-interactive-field-email-description gallery-interactive-field-email-error'
                : 'gallery-interactive-field-email-description'
            }
            data-bind:aria-describedby="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldControl_aria_describedby_derive"
            aria-invalid={state.invalid ? 'true' : null}
            data-bind:aria-invalid="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldControl_aria_invalid_derive"
            data-invalid={state.invalid ? '' : null}
            data-bind:data-invalid="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldControl_data_invalid_derive"
            value={state.email}
            data-bind:value="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldControl_value_derive"
          />
          <FieldDescription id="gallery-interactive-field-email-description" required={true}>
            Use a reachable address for receipts.
          </FieldDescription>
          <UiFieldError
            id="gallery-interactive-field-email-error"
            hidden={!state.invalid}
            data-bind:hidden="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$UiFieldError_hidden_derive"
            visible={state.invalid}
            data-bind:visible="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$UiFieldError_visible_derive"
          >
            Enter a complete email address.
          </UiFieldError>
          <output data-demo-state="field-email" class={OUTPUT_CLASS} data-bind="state.email">
            {state.email}
          </output>
        </Field>

        <Field id="gallery-interactive-field-profile">
          <FieldLabel
            controlId="gallery-interactive-field-bio"
            id="gallery-interactive-field-bio-label"
          >
            Bio
          </FieldLabel>
          <FieldTextarea
            descriptionId="gallery-interactive-field-bio-description"
            form="gallery-interactive-field-form"
            id="gallery-interactive-field-bio"
            name="gallery-bio"
            rows={2}
          >
            Frontend systems lead.
          </FieldTextarea>
          <FieldDescription id="gallery-interactive-field-bio-description">
            Short public profile summary.
          </FieldDescription>
        </Field>

        <Field id="gallery-interactive-field-plan">
          <FieldLabel
            controlId="gallery-interactive-field-plan-select"
            id="gallery-interactive-field-plan-label"
          >
            Plan
          </FieldLabel>
          <FieldSelect
            descriptionId="gallery-interactive-field-plan-description"
            form="gallery-interactive-field-form"
            id="gallery-interactive-field-plan-select"
            name="gallery-plan"
            on:change="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldSelect_change"
            required={true}
            value={state.plan}
            data-bind:value="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldSelect_value_derive"
          >
            <FieldSelectOption
              value="team"
              selected={state.plan === 'team'}
              data-bind:selected="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldSelectOption_selected_derive"
            >
              Team
            </FieldSelectOption>
            <FieldSelectOption
              value="enterprise"
              selected={state.plan === 'enterprise'}
              data-bind:selected="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$FieldSelectOption_selected_derive_2"
            >
              Enterprise
            </FieldSelectOption>
          </FieldSelect>
          <FieldDescription id="gallery-interactive-field-plan-description">
            Native select remains the submitted control.
          </FieldDescription>
          <output data-demo-state="field-plan" class={OUTPUT_CLASS} data-bind="state.plan">
            {state.plan}
          </output>
        </Field>

        <Fieldset
          descriptionId="gallery-interactive-fieldset-description"
          form="gallery-interactive-field-form"
          id="gallery-interactive-fieldset"
          name="gallery-shipping"
          {...fieldsetState}
          data-disabled={state.shippingDisabled ? '' : null}
          data-bind:data-disabled="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$Fieldset_data_disabled_derive"
          disabled={state.shippingDisabled}
          data-bind:disabled="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$Fieldset_disabled_derive"
        >
          <FieldsetLegend id="gallery-interactive-fieldset-legend" required={true}>
            Shipping options
            <label class="ml-2 inline-flex items-center gap-1 text-sm font-normal text-neutral-700">
              <input
                name="gallery-shipping-disabled"
                type="checkbox"
                on:click="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_click"
                checked={state.shippingDisabled}
                data-bind:checked="/c/__v/9bd73f9b/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_checked_derive"
              />
              Disable shipping group
            </label>
          </FieldsetLegend>
          <FieldDescription id="gallery-interactive-fieldset-description">
            Grouped controls inherit native fieldset disabled behavior.
          </FieldDescription>
          <label class="grid gap-2 text-sm font-medium leading-none text-neutral-900">
            <FieldControl
              form="gallery-interactive-field-form"
              name="gallery-seat"
              type="text"
              value="window"
            />
            Seat preference
          </label>
        </Fieldset>
      </form>
    );
  },
});
GalleryFieldDemo.name = 'generated/interactive/field-demo/gallery-field-demo';
