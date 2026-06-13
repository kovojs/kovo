/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  numberFieldDecrementAttributes,
  numberFieldIncrementAttributes,
  numberFieldInputAttributes,
  numberFieldRootAttributes,
} from '@jiso/headless-ui/primitives';

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
      step: 1,
      value: state.value,
    };
    const formId = 'gallery-number-field-form';
    const inputId = 'gallery-number-field-input';

    return (
      <form
        {...numberFieldRootAttributes(fieldState)}
        class="inline-grid gap-2"
        data-gallery-interactive="number-field"
        id={formId}
      >
        <label for={inputId}>Seats</label>
        <div class="inline-flex items-center gap-1">
          <button
            {...numberFieldDecrementAttributes({ ...fieldState, inputId, label: 'Decrease seats' })}
            onClick={() => {
              state.value = state.value <= 0 ? 0 : state.value - 1;
              const doc = Reflect['get'](globalThis, 'document');
              const input = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-number-field-input')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="value"]')
                : undefined;

              if (input) input['value'] = String(state.value);
              if (output) output['textContent'] = String(state.value);
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
            onInput={() => {
              const delegatedEvent = event;
              const eventTarget =
                delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'target');
              const eventValue =
                eventTarget === null || eventTarget === undefined
                  ? state.value
                  : +Reflect['get'](Object(eventTarget), 'value');
              const nextValue = eventValue === eventValue ? eventValue : state.value;
              state.value = nextValue <= 0 ? 0 : nextValue >= 5 ? 5 : nextValue;

              const doc = Reflect['get'](globalThis, 'document');
              const input = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-number-field-input')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="value"]')
                : undefined;

              if (input) input['value'] = String(state.value);
              if (output) output['textContent'] = String(state.value);
            }}
          />
          <button
            {...numberFieldIncrementAttributes({ ...fieldState, inputId, label: 'Increase seats' })}
            onClick={() => {
              state.value = state.value >= 5 ? 5 : state.value + 1;
              const doc = Reflect['get'](globalThis, 'document');
              const input = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-number-field-input')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="value"]')
                : undefined;

              if (input) input['value'] = String(state.value);
              if (output) output['textContent'] = String(state.value);
            }}
          >
            +
          </button>
        </div>
        <output data-demo-state="value">{String(state.value)}</output>
      </form>
    );
  },
});
