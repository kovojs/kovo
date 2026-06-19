/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  NumberField,
  NumberFieldControl,
  NumberFieldDecrement,
  numberFieldDecrementClick as _numberFieldDecrementClick,
  NumberFieldIncrement,
  numberFieldIncrementClick as _numberFieldIncrementClick,
  numberFieldInput as _numberFieldInput,
  NumberFieldInput,
  numberFieldKeyDown as _numberFieldKeyDown,
} from '@kovojs/ui/number-field';


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
      <NumberField {...fieldState} data-gallery-interactive="number-field" id={formId}>
        <label for={inputId} style="font-size:0.875rem;font-weight:500;line-height:1;color:#171717">
          Seats
        </label>
        <NumberFieldControl {...fieldState}>
          <NumberFieldDecrement
            {...fieldState}
            data-disabled={state.value <= 0 ? '' : null}
            disabled={state.value <= 0}
            inputId={inputId}
            label="Decrease seats"
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
          </NumberFieldDecrement>
          <NumberFieldInput
            {...fieldState}
            form={formId}
            id={inputId}
            label="Seats"
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
            value={state.value}
          />
          <NumberFieldIncrement
            {...fieldState}
            data-disabled={state.value >= 5 ? '' : null}
            disabled={state.value >= 5}
            inputId={inputId}
            label="Increase seats"
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
          </NumberFieldIncrement>
        </NumberFieldControl>
        <output
          data-demo-state="value"
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
        >
          {String(state.value)}
        </output>
      </NumberField>
    );
  },
});
