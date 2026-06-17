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
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/field.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const FIELD_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950 data-[required]:font-medium';
const LABEL_CLASS =
  'text-sm font-medium leading-none text-neutral-900 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-70';
const CONTROL_CLASS =
  'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-70 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus-visible:outline-red-500';
const TEXTAREA_CLASS =
  'min-h-24 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-70 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus-visible:outline-red-500';
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-70 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus-visible:outline-red-500';
const SELECT_OPTION_CLASS = 'text-neutral-950 disabled:text-neutral-400';
const DESCRIPTION_CLASS = 'text-sm text-neutral-500';
const ERROR_CLASS = 'text-sm font-medium text-red-600';
const FIELDSET_CLASS =
  'grid gap-3 rounded-md border border-neutral-200 p-4 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:border-red-300';
const LEGEND_CLASS = 'px-1 text-sm font-medium text-neutral-900';
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
          data-bind:data-invalid="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$div_data_invalid_derive"
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
            on:input="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$input_input"
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
            data-bind:aria-describedby="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$input_aria_describedby_derive"
            aria-invalid={state.invalid ? 'true' : null}
            data-bind:aria-invalid="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$input_aria_invalid_derive"
            data-invalid={state.invalid ? '' : null}
            data-bind:data-invalid="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$input_data_invalid_derive"
            value={state.email}
            data-bind:value="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$input_value_derive"
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
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$p_hidden_derive"
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
            on:change="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$select_change"
            {...fieldControlAttributes({
              descriptionId: 'gallery-interactive-field-plan-description',
              form: 'gallery-interactive-field-form',
              id: 'gallery-interactive-field-plan-select',
              name: 'gallery-plan',
              required: true,
            })}
            value={state.plan}
            data-bind:value="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$select_value_derive"
          >
            <option
              value="team"
              class={SELECT_OPTION_CLASS}
              selected={state.plan === 'team'}
              data-bind:selected="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$option_selected_derive"
            >
              Team
            </option>
            <option
              value="enterprise"
              class={SELECT_OPTION_CLASS}
              selected={state.plan === 'enterprise'}
              data-bind:selected="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$option_selected_derive_2"
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
          data-bind:data-disabled="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$fieldset_data_disabled_derive"
          disabled={state.shippingDisabled}
          data-bind:disabled="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$fieldset_disabled_derive"
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
                on:click="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$input_click"
                checked={state.shippingDisabled}
                data-bind:checked="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=af463500#GalleryFieldDemo$input_checked_derive"
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
