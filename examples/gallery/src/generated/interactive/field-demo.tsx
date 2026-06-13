// @jiso-ir - lowered from examples/gallery/src/interactive/field-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
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
        fw-c="gallery-field-demo"
        fw-state='{"email":"ada@example","invalid":true,"plan":"team","shippingDisabled":false}'
      >
        <div
          {...fieldRootAttributes({ ...emailFieldState, id: 'gallery-interactive-field-email' })}
          class="grid gap-2"
        >
          <label
            {...fieldLabelAttributes({
              ...emailFieldState,
              controlId: 'gallery-interactive-field-email-input',
              id: 'gallery-interactive-field-email-label',
            })}
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
            value={state.email}
            on:input="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=9b1992a4#GalleryFieldDemo$input_input"
          />
          <p
            {...fieldDescriptionAttributes({
              id: 'gallery-interactive-field-email-description',
              required: true,
            })}
          >
            Use a reachable address for receipts.
          </p>
          <p
            {...fieldErrorAttributes({
              id: 'gallery-interactive-field-email-error',
              visible: state.invalid,
            })}
          >
            Enter a complete email address.
          </p>
          <output data-demo-state="field-email">{state.email}</output>
        </div>

        <div {...fieldRootAttributes({ id: 'gallery-interactive-field-profile' })}>
          <label
            {...fieldLabelAttributes({
              controlId: 'gallery-interactive-field-bio',
              id: 'gallery-interactive-field-bio-label',
            })}
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
            rows={2}
          >
            Frontend systems lead.
          </textarea>
          <p {...fieldDescriptionAttributes({ id: 'gallery-interactive-field-bio-description' })}>
            Short public profile summary.
          </p>
        </div>

        <div {...fieldRootAttributes({ id: 'gallery-interactive-field-plan' })}>
          <label
            {...fieldLabelAttributes({
              controlId: 'gallery-interactive-field-plan-select',
              id: 'gallery-interactive-field-plan-label',
            })}
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
            value={state.plan}
            on:change="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=9b1992a4#GalleryFieldDemo$select_change"
          >
            <option value="team" selected={state.plan === 'team'}>
              Team
            </option>
            <option value="enterprise" selected={state.plan === 'enterprise'}>
              Enterprise
            </option>
          </select>
          <p {...fieldDescriptionAttributes({ id: 'gallery-interactive-field-plan-description' })}>
            Native select remains the submitted control.
          </p>
          <output data-demo-state="field-plan">{state.plan}</output>
        </div>

        <fieldset
          {...fieldsetRootAttributes({
            ...fieldsetState,
            descriptionId: 'gallery-interactive-fieldset-description',
            form: 'gallery-interactive-field-form',
            id: 'gallery-interactive-fieldset',
            name: 'gallery-shipping',
          })}
        >
          <legend
            {...fieldsetLegendAttributes({
              id: 'gallery-interactive-fieldset-legend',
              required: true,
            })}
          >
            Shipping options
            <label>
              <input
                name="gallery-shipping-disabled"
                type="checkbox"
                checked={state.shippingDisabled}
                on:click="/c/examples/gallery/src/generated/interactive/field-demo.client.js?v=9b1992a4#GalleryFieldDemo$input_click"
              />
              Disable shipping group
            </label>
          </legend>
          <p {...fieldDescriptionAttributes({ id: 'gallery-interactive-fieldset-description' })}>
            Grouped controls inherit native fieldset disabled behavior.
          </p>
          <label>
            <input
              form="gallery-interactive-field-form"
              name="gallery-seat"
              type="text"
              value="window"
            />
            Seat preference
          </label>
        </fieldset>
      </form>
    );
  },
});
