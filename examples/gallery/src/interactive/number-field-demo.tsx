/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  numberFieldDecrementAttributes,
  numberFieldDecrementClick as _numberFieldDecrementClick,
  numberFieldIncrementAttributes,
  numberFieldIncrementClick as _numberFieldIncrementClick,
  numberFieldInput as _numberFieldInput,
  numberFieldInputAttributes,
  numberFieldKeyDown as _numberFieldKeyDown,
  numberFieldRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/number-field.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const CONTROL_CLASS =
  'inline-flex h-9 w-fit items-center overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm data-[disabled]:opacity-60 data-[invalid]:border-red-400';
const INPUT_CLASS =
  'h-9 w-20 border-0 bg-transparent px-3 text-center text-sm text-neutral-950 outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:text-red-950';
const BUTTON_CLASS =
  'inline-flex h-9 w-9 items-center justify-center border-neutral-200 bg-neutral-50 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 data-[action=decrement]:border-r data-[action=increment]:border-l data-[disabled]:opacity-70';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

export interface GalleryNumberFieldDemoState {
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryNumberFieldDemo = component('gallery-number-field-demo', {
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
