// @kovojs-ir - lowered from examples/gallery/src/interactive/field-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryFieldDemo$div_data_invalid_derive = derive(['state'], (state: any) =>
  state.invalid ? '' : null,
);
export const GalleryFieldDemo$input_aria_describedby_derive = derive(['state'], (state: any) =>
  state.invalid
    ? 'gallery-interactive-field-email-description gallery-interactive-field-email-error'
    : 'gallery-interactive-field-email-description',
);
export const GalleryFieldDemo$input_aria_invalid_derive = derive(['state'], (state: any) =>
  state.invalid ? 'true' : null,
);
export const GalleryFieldDemo$input_data_invalid_derive = derive(['state'], (state: any) =>
  state.invalid ? '' : null,
);
export const GalleryFieldDemo$input_value_derive = derive(['state'], (state: any) => state.email);
export const GalleryFieldDemo$p_hidden_derive = derive(['state'], (state: any) =>
  !state.invalid ? '' : null,
);
export const GalleryFieldDemo$select_value_derive = derive(['state'], (state: any) => state.plan);
export const GalleryFieldDemo$option_selected_derive = derive(['state'], (state: any) =>
  state.plan === 'team' ? '' : null,
);
export const GalleryFieldDemo$option_selected_derive_2 = derive(['state'], (state: any) =>
  state.plan === 'enterprise' ? '' : null,
);
export const GalleryFieldDemo$fieldset_data_disabled_derive = derive(['state'], (state: any) =>
  state.shippingDisabled ? '' : null,
);
export const GalleryFieldDemo$fieldset_disabled_derive = derive(['state'], (state: any) =>
  state.shippingDisabled ? '' : null,
);
export const GalleryFieldDemo$input_checked_derive = derive(['state'], (state: any) =>
  state.shippingDisabled ? '' : null,
);

import { component } from '@kovojs/core';
import {
  fieldControlAttributes,
  fieldDescriptionAttributes,
  fieldErrorAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  fieldsetLegendAttributes,
  fieldsetRootAttributes,
} from '@kovojs/headless-ui/field';
import {
  fieldClasses,
  fieldLabelClasses,
  fieldControlClasses,
  fieldTextareaClasses,
  fieldSelectClasses,
  fieldSelectOptionClasses,
  fieldDescriptionClasses,
  fieldErrorClasses,
  fieldsetClasses,
  fieldsetLegendClasses,
} from '@kovojs/ui/field';

const FIELD_CLASS = fieldClasses.join(' ');
const LABEL_CLASS = fieldLabelClasses.join(' ');
const CONTROL_CLASS = fieldControlClasses.join(' ');
const TEXTAREA_CLASS = fieldTextareaClasses.join(' ');
const SELECT_CLASS = fieldSelectClasses.join(' ');
const SELECT_OPTION_CLASS = fieldSelectOptionClasses.join(' ');
const DESCRIPTION_CLASS = fieldDescriptionClasses.join(' ');
const ERROR_CLASS = fieldErrorClasses.join(' ');
const FIELDSET_CLASS = fieldsetClasses.join(' ');
const LEGEND_CLASS = fieldsetLegendClasses.join(' ');
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
        <div
          class={FIELD_CLASS}
          {...fieldRootAttributes({ ...emailFieldState, id: 'gallery-interactive-field-email' })}
          data-invalid={state.invalid ? '' : null}
          data-bind:data-invalid="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$div_data_invalid_derive"
        >
          <label
            class={LABEL_CLASS}
            {...fieldLabelAttributes({
              ...emailFieldState,
              controlId: 'gallery-interactive-field-email-input',
              id: 'gallery-interactive-field-email-label',
            })}
          >
            Email
          </label>
          <input
            type="email"
            class={CONTROL_CLASS}
            on:input="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_input"
            {...fieldControlAttributes({
              ...emailFieldState,
              descriptionId: 'gallery-interactive-field-email-description',
              errorId: 'gallery-interactive-field-email-error',
              form: 'gallery-interactive-field-form',
              id: 'gallery-interactive-field-email-input',
              name: 'gallery-email',
              pattern: '.+@kovo\\.sh',
            })}
            aria-describedby={
              state.invalid
                ? 'gallery-interactive-field-email-description gallery-interactive-field-email-error'
                : 'gallery-interactive-field-email-description'
            }
            data-bind:aria-describedby="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_aria_describedby_derive"
            aria-invalid={state.invalid ? 'true' : null}
            data-bind:aria-invalid="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_aria_invalid_derive"
            data-invalid={state.invalid ? '' : null}
            data-bind:data-invalid="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_data_invalid_derive"
            value={state.email}
            data-bind:value="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_value_derive"
          />
          <p
            class={DESCRIPTION_CLASS}
            {...fieldDescriptionAttributes({
              id: 'gallery-interactive-field-email-description',
              required: true,
            })}
          >
            Use a reachable address for receipts.
          </p>
          <p
            class={ERROR_CLASS}
            {...fieldErrorAttributes({
              id: 'gallery-interactive-field-email-error',
              visible: state.invalid,
            })}
            hidden={!state.invalid}
            data-bind:hidden="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$p_hidden_derive"
          >
            Enter a complete email address.
          </p>
          <output data-demo-state="field-email" class={OUTPUT_CLASS} data-bind="state.email">
            {state.email}
          </output>
        </div>

        <div
          {...fieldRootAttributes({ id: 'gallery-interactive-field-profile' })}
          class={FIELD_CLASS}
        >
          <label
            {...fieldLabelAttributes({
              controlId: 'gallery-interactive-field-bio',
              id: 'gallery-interactive-field-bio-label',
            })}
            class={LABEL_CLASS}
          >
            Bio
          </label>
          <textarea
            {...fieldControlAttributes({
              descriptionId: 'gallery-interactive-field-bio-description',
              form: 'gallery-interactive-field-form',
              id: 'gallery-interactive-field-bio',
              name: 'gallery-bio',
            })}
            class={TEXTAREA_CLASS}
            rows={2}
          >
            Frontend systems lead.
          </textarea>
          <p
            {...fieldDescriptionAttributes({ id: 'gallery-interactive-field-bio-description' })}
            class={DESCRIPTION_CLASS}
          >
            Short public profile summary.
          </p>
        </div>

        <div {...fieldRootAttributes({ id: 'gallery-interactive-field-plan' })} class={FIELD_CLASS}>
          <label
            {...fieldLabelAttributes({
              controlId: 'gallery-interactive-field-plan-select',
              id: 'gallery-interactive-field-plan-label',
            })}
            class={LABEL_CLASS}
          >
            Plan
          </label>
          <select
            class={SELECT_CLASS}
            on:change="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$select_change"
            {...fieldControlAttributes({
              descriptionId: 'gallery-interactive-field-plan-description',
              form: 'gallery-interactive-field-form',
              id: 'gallery-interactive-field-plan-select',
              name: 'gallery-plan',
              required: true,
            })}
            value={state.plan}
            data-bind:value="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$select_value_derive"
          >
            <option
              value="team"
              class={SELECT_OPTION_CLASS}
              selected={state.plan === 'team'}
              data-bind:selected="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$option_selected_derive"
            >
              Team
            </option>
            <option
              value="enterprise"
              class={SELECT_OPTION_CLASS}
              selected={state.plan === 'enterprise'}
              data-bind:selected="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$option_selected_derive_2"
            >
              Enterprise
            </option>
          </select>
          <p
            {...fieldDescriptionAttributes({ id: 'gallery-interactive-field-plan-description' })}
            class={DESCRIPTION_CLASS}
          >
            Native select remains the submitted control.
          </p>
          <output data-demo-state="field-plan" class={OUTPUT_CLASS} data-bind="state.plan">
            {state.plan}
          </output>
        </div>

        <fieldset
          class={FIELDSET_CLASS}
          {...fieldsetRootAttributes({
            ...fieldsetState,
            descriptionId: 'gallery-interactive-fieldset-description',
            form: 'gallery-interactive-field-form',
            id: 'gallery-interactive-fieldset',
            name: 'gallery-shipping',
          })}
          data-disabled={state.shippingDisabled ? '' : null}
          data-bind:data-disabled="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$fieldset_data_disabled_derive"
          disabled={state.shippingDisabled}
          data-bind:disabled="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$fieldset_disabled_derive"
        >
          <legend
            class={LEGEND_CLASS}
            {...fieldsetLegendAttributes({
              id: 'gallery-interactive-fieldset-legend',
              required: true,
            })}
          >
            Shipping options
            <label class="ml-2 inline-flex items-center gap-1 text-sm font-normal text-neutral-700">
              <input
                name="gallery-shipping-disabled"
                type="checkbox"
                on:click="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_click"
                checked={state.shippingDisabled}
                data-bind:checked="/c/__v/af463500/examples/gallery/src/generated/interactive/field-demo.client.js#GalleryFieldDemo$input_checked_derive"
              />
              Disable shipping group
            </label>
          </legend>
          <p
            class={DESCRIPTION_CLASS}
            {...fieldDescriptionAttributes({ id: 'gallery-interactive-fieldset-description' })}
          >
            Grouped controls inherit native fieldset disabled behavior.
          </p>
          <label class="grid gap-2 text-sm font-medium leading-none text-neutral-900">
            <input
              form="gallery-interactive-field-form"
              name="gallery-seat"
              type="text"
              value="window"
              class={CONTROL_CLASS}
            />
            Seat preference
          </label>
        </fieldset>
      </form>
    );
  },
});
GalleryFieldDemo.name = 'generated/interactive/field-demo/gallery-field-demo';
