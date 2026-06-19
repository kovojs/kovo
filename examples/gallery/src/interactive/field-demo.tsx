/** @jsxImportSource @kovojs/server */
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
      <form data-gallery-interactive="field" id="gallery-interactive-field-form" class="grid gap-4">
        <Field
          {...emailFieldState}
          data-invalid={state.invalid ? '' : null}
          id="gallery-interactive-field-email"
        >
          <FieldLabel
            {...emailFieldState}
            controlId="gallery-interactive-field-email-input"
            id="gallery-interactive-field-email-label"
          >
            Email
          </FieldLabel>
          <FieldControl
            {...emailFieldState}
            aria-describedby={
              state.invalid
                ? 'gallery-interactive-field-email-description gallery-interactive-field-email-error'
                : 'gallery-interactive-field-email-description'
            }
            aria-invalid={state.invalid ? 'true' : null}
            data-invalid={state.invalid ? '' : null}
            descriptionId="gallery-interactive-field-email-description"
            errorId="gallery-interactive-field-email-error"
            form="gallery-interactive-field-form"
            id="gallery-interactive-field-email-input"
            name="gallery-email"
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
            pattern=".+@kovo\\.sh"
            type="email"
            value={state.email}
          />
          <FieldDescription id="gallery-interactive-field-email-description" required={true}>
            Use a reachable address for receipts.
          </FieldDescription>
          <UiFieldError
            hidden={!state.invalid}
            id="gallery-interactive-field-email-error"
            visible={state.invalid}
          >
            Enter a complete email address.
          </UiFieldError>
          <output data-demo-state="field-email" class={OUTPUT_CLASS}>
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
            onChange={() => {
              state.plan = Object(event)['target']?.value?.toString?.() ?? state.plan;
            }}
            required={true}
            value={state.plan}
          >
            <FieldSelectOption value="team" selected={state.plan === 'team'}>
              Team
            </FieldSelectOption>
            <FieldSelectOption value="enterprise" selected={state.plan === 'enterprise'}>
              Enterprise
            </FieldSelectOption>
          </FieldSelect>
          <FieldDescription id="gallery-interactive-field-plan-description">
            Native select remains the submitted control.
          </FieldDescription>
          <output data-demo-state="field-plan" class={OUTPUT_CLASS}>
            {state.plan}
          </output>
        </Field>

        <Fieldset
          {...fieldsetState}
          data-disabled={state.shippingDisabled ? '' : null}
          descriptionId="gallery-interactive-fieldset-description"
          disabled={state.shippingDisabled}
          form="gallery-interactive-field-form"
          id="gallery-interactive-fieldset"
          name="gallery-shipping"
        >
          <FieldsetLegend id="gallery-interactive-fieldset-legend" required={true}>
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
