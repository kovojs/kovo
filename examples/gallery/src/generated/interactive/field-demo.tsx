// @jiso-ir - lowered from examples/gallery/src/interactive/field-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryFieldDemo$input_value_derive = derive(['state'], (state) => state.email);
export const GalleryFieldDemo$select_value_derive = derive(['state'], (state) => state.plan);
export const GalleryFieldDemo$option_selected_derive = derive(['state'], (state) =>
  state.plan === 'team' ? '' : null,
);
export const GalleryFieldDemo$option_selected_derive_2 = derive(['state'], (state) =>
  state.plan === 'enterprise' ? '' : null,
);
export const GalleryFieldDemo$input_checked_derive = derive(['state'], (state) =>
  state.shippingDisabled ? '' : null,
);

import { component } from '@jiso/core';
import {
  fieldControlAttributes,
  fieldDescriptionAttributes,
  fieldErrorAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  fieldsetLegendAttributes,
  fieldsetRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/field.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
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
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryFieldDemo = component('gallery-field-demo', {
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
        fw-c="gallery-field-demo"
        fw-state='{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}'
      >
        <div
          {...fieldRootAttributes({ ...emailFieldState, id: 'gallery-interactive-field-email' })}
          class={FIELD_CLASS}
        >
          <label
            {...fieldLabelAttributes({
              ...emailFieldState,
              controlId: 'gallery-interactive-field-email-input',
              id: 'gallery-interactive-field-email-label',
            })}
            class={LABEL_CLASS}
          >
            Email
          </label>
          <input
            {...fieldControlAttributes({
              ...emailFieldState,
              descriptionId: 'gallery-interactive-field-email-description',
              errorId: 'gallery-interactive-field-email-error',
              form: 'gallery-interactive-field-form',
              id: 'gallery-interactive-field-email-input',
              name: 'gallery-email',
              pattern: '.+@jiso\\.dev',
            })}
            type="email"
            class={CONTROL_CLASS}
            data-bind:value="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=c1790758#GalleryFieldDemo$input_value_derive"
            on:input="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=c1790758#GalleryFieldDemo$input_input"
          />
          <p
            {...fieldDescriptionAttributes({
              id: 'gallery-interactive-field-email-description',
              required: true,
            })}
            class={DESCRIPTION_CLASS}
          >
            Use a reachable address for receipts.
          </p>
          <p
            {...fieldErrorAttributes({
              id: 'gallery-interactive-field-email-error',
              visible: state.invalid,
            })}
            class={ERROR_CLASS}
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
            {...fieldControlAttributes({
              descriptionId: 'gallery-interactive-field-plan-description',
              form: 'gallery-interactive-field-form',
              id: 'gallery-interactive-field-plan-select',
              name: 'gallery-plan',
              required: true,
            })}
            class={SELECT_CLASS}
            data-bind:value="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=c1790758#GalleryFieldDemo$select_value_derive"
            on:change="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=c1790758#GalleryFieldDemo$select_change"
          >
            <option
              value="team"
              data-bind:selected="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=c1790758#GalleryFieldDemo$option_selected_derive"
              class={SELECT_OPTION_CLASS}
            >
              Team
            </option>
            <option
              value="enterprise"
              data-bind:selected="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=c1790758#GalleryFieldDemo$option_selected_derive_2"
              class={SELECT_OPTION_CLASS}
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
          {...fieldsetRootAttributes({
            ...fieldsetState,
            descriptionId: 'gallery-interactive-fieldset-description',
            form: 'gallery-interactive-field-form',
            id: 'gallery-interactive-fieldset',
            name: 'gallery-shipping',
          })}
          class={FIELDSET_CLASS}
        >
          <legend
            {...fieldsetLegendAttributes({
              id: 'gallery-interactive-fieldset-legend',
              required: true,
            })}
            class={LEGEND_CLASS}
          >
            Shipping options
            <label class="ml-2 inline-flex items-center gap-1 text-sm font-normal text-neutral-700">
              <input
                name="gallery-shipping-disabled"
                type="checkbox"
                data-bind:checked="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=c1790758#GalleryFieldDemo$input_checked_derive"
                on:click="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=c1790758#GalleryFieldDemo$input_click"
              />
              Disable shipping group
            </label>
          </legend>
          <p
            {...fieldDescriptionAttributes({ id: 'gallery-interactive-fieldset-description' })}
            class={DESCRIPTION_CLASS}
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
