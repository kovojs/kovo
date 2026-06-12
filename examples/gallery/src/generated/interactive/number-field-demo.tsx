// @jiso-ir - lowered from examples/gallery/src/interactive/number-field-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
    const inputId = 'gallery-number-field-input';

    return (
      <section
        {...numberFieldRootAttributes(fieldState)}
        class="inline-grid gap-2"
        data-gallery-interactive="number-field"
        fw-c="gallery-number-field-demo"
        fw-state='{"value":2}'
      >
        <label for={inputId}>Seats</label>
        <div class="inline-flex items-center gap-1">
          <button
            {...numberFieldDecrementAttributes({ ...fieldState, inputId, label: 'Decrease seats' })}
            on:click="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=e2674935#GalleryNumberFieldDemo$button_click"
          >
            -
          </button>
          <input {...numberFieldInputAttributes({ ...fieldState, id: inputId, label: 'Seats' })} />
          <button
            {...numberFieldIncrementAttributes({ ...fieldState, inputId, label: 'Increase seats' })}
            on:click="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=e2674935#GalleryNumberFieldDemo$button_click_2"
          >
            +
          </button>
        </div>
        <output data-demo-state="value">{String(state.value)}</output>
      </section>
    );
  },
});
