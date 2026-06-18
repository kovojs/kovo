/** @jsxImportSource @kovojs/server */
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
      <form data-gallery-interactive="field" id="gallery-interactive-field-form" class="grid gap-4">
        <div
          {...fieldRootAttributes({ ...emailFieldState, id: 'gallery-interactive-field-email' })}
          class={FIELD_CLASS}
          data-invalid={state.invalid ? '' : null}
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
              pattern: '.+@kovo\\.sh',
            })}
            type="email"
            class={CONTROL_CLASS}
            aria-describedby={
              state.invalid
                ? 'gallery-interactive-field-email-description gallery-interactive-field-email-error'
                : 'gallery-interactive-field-email-description'
            }
            aria-invalid={state.invalid ? 'true' : null}
            data-invalid={state.invalid ? '' : null}
            value={state.email}
            onInput={() => {
              const target = Object(event)['target'];
              const nextEmail = Object(target)['value']?.toString?.() ?? state.email;
              const checkValidity = Object(target)['checkValidity'];
              state.email = nextEmail;
              state.invalid =
                typeof checkValidity === 'function'
                  ? !checkValidity.call(target)
                  : !/.+@kovo\.sh/.test(nextEmail);
            }}
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
            hidden={!state.invalid}
          >
            Enter a complete email address.
          </p>
          <output data-demo-state="field-email" class={OUTPUT_CLASS}>
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
            value={state.plan}
            onChange={() => {
              state.plan = Object(event)['target']?.value?.toString?.() ?? state.plan;
            }}
          >
            <option value="team" selected={state.plan === 'team'} class={SELECT_OPTION_CLASS}>
              Team
            </option>
            <option
              value="enterprise"
              selected={state.plan === 'enterprise'}
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
          <output data-demo-state="field-plan" class={OUTPUT_CLASS}>
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
          data-disabled={state.shippingDisabled ? '' : null}
          disabled={state.shippingDisabled}
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
                checked={state.shippingDisabled}
                onClick={() => {
                  const checked = Object(event)['target']?.checked;
                  state.shippingDisabled =
                    typeof checked === 'boolean' ? checked : !state.shippingDisabled;
                }}
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
