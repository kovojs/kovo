/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  numberFieldDecrementAttributes,
  numberFieldDecrementClick as _numberFieldDecrementClick,
  numberFieldIncrementAttributes,
  numberFieldIncrementClick as _numberFieldIncrementClick,
  numberFieldInput as _numberFieldInput,
  numberFieldInputAttributes,
  numberFieldKeyDown as _numberFieldKeyDown,
  numberFieldRootAttributes,
} from '@kovojs/headless-ui/number-field';
import {
  numberFieldClasses,
  numberFieldControlClasses,
  numberFieldInputClasses,
  numberFieldButtonClasses,
} from '@kovojs/ui/number-field';

const ROOT_CLASS = numberFieldClasses.join(' ');
const CONTROL_CLASS = numberFieldControlClasses.join(' ');
const INPUT_CLASS = numberFieldInputClasses.join(' ');
const BUTTON_CLASS = numberFieldButtonClasses.join(' ');
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

export interface GalleryNumberFieldDemoState {
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryNumberFieldDemo = component({
  state: () => ({ value: 2 }),
  render: (_queries: Record<string, never>, state: GalleryNumberFieldDemoState) => {
    const fieldState = {
      max: 5,
      min: 0,
      name: 'gallery-seat-count',
      required: true,
      smallStep: 1,
      step: 1,
      value: state.value,
    };
    const formId = 'gallery-number-field-form';
    const inputId = 'gallery-number-field-input';

    return (
      <form
        {...numberFieldRootAttributes(fieldState)}
        class={ROOT_CLASS}
        data-gallery-interactive="number-field"
        id={formId}
      >
        <label for={inputId} class={LABEL_CLASS}>
          Seats
        </label>
        <div class={CONTROL_CLASS}>
          <button
            {...numberFieldDecrementAttributes({ ...fieldState, inputId, label: 'Decrease seats' })}
            class={BUTTON_CLASS}
            data-disabled={state.value <= 0 ? '' : null}
            disabled={state.value <= 0}
            onClick={() => {
              const result = _numberFieldDecrementClick(Object(event), {
                max: 5,
                min: 0,
                smallStep: 1,
                step: 1,
                value: state.value,
              });
              if (!result) return;
              state.value = result.value ?? 0;
            }}
          >
            -
          </button>
          <input
            {...numberFieldInputAttributes({
              ...fieldState,
              form: formId,
              id: inputId,
              label: 'Seats',
            })}
            class={INPUT_CLASS}
            value={state.value}
            onInput={() => {
              const result = _numberFieldInput(Object(event), {
                max: 5,
                min: 0,
                smallStep: 1,
                step: 1,
                value: state.value,
              });
              if (!result) return;
              state.value = result.value ?? 0;
            }}
            onKeyDown={() => {
              const result = _numberFieldKeyDown(Object(event), {
                max: 5,
                min: 0,
                smallStep: 1,
                step: 1,
                value: state.value,
              });
              if (!result) return;
              state.value = result.value ?? 0;
            }}
          />
          <button
            {...numberFieldIncrementAttributes({ ...fieldState, inputId, label: 'Increase seats' })}
            class={BUTTON_CLASS}
            data-disabled={state.value >= 5 ? '' : null}
            disabled={state.value >= 5}
            onClick={() => {
              const result = _numberFieldIncrementClick(Object(event), {
                max: 5,
                min: 0,
                smallStep: 1,
                step: 1,
                value: state.value,
              });
              if (!result) return;
              state.value = result.value ?? 0;
            }}
          >
            +
          </button>
        </div>
        <output data-demo-state="value" class="text-xs text-neutral-500">
          {String(state.value)}
        </output>
      </form>
    );
  },
});
