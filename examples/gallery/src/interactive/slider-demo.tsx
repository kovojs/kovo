/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  sliderInputAttributes,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
} from '@jiso/headless-ui/primitives';

export interface GallerySliderDemoState {
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GallerySliderDemo = component('gallery-slider-demo', {
  state: () => ({ value: 25 }),
  render: (_queries: Record<string, never>, state: GallerySliderDemoState) => {
    const sliderState = {
      label: 'Completion',
      max: 100,
      min: 0,
      name: 'gallery-completion',
      step: 25,
      value: state.value,
      valueText: `${state.value} percent`,
    };

    return (
      <section
        {...sliderRootAttributes(sliderState)}
        class="grid gap-2"
        data-gallery-interactive="slider"
      >
        <label for="gallery-slider-input">Completion</label>
        <input
          {...sliderInputAttributes(sliderState)}
          id="gallery-slider-input"
          onInput={() => {
            state.value = state.value === 25 ? 75 : 25;
            const doc = Reflect['get'](globalThis, 'document');
            const input = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-slider-input')
              : undefined;
            const range = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-part="range"]')
              : undefined;
            const thumb = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-part="thumb"]')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="slider-value"]')
              : undefined;
            const ratio = String(state.value / 100);

            if (input) {
              input['value'] = String(state.value);
              Object(input)['setAttribute']?.call(
                input,
                'aria-valuetext',
                `${state.value} percent`,
              );
              Object(input)['setAttribute']?.call(input, 'data-value', String(state.value));
            }
            if (range) {
              Object(range)['setAttribute']?.call(range, 'data-value', String(state.value));
              Object(range)['setAttribute']?.call(range, 'data-value-ratio', ratio);
            }
            if (thumb) {
              Object(thumb)['setAttribute']?.call(thumb, 'data-value', String(state.value));
              Object(thumb)['setAttribute']?.call(thumb, 'data-value-ratio', ratio);
            }
            if (output) output['textContent'] = String(state.value);
          }}
        />
        <div {...sliderTrackAttributes(sliderState)}>
          <span {...sliderRangeAttributes(sliderState)} />
          <span {...sliderThumbAttributes(sliderState)} />
        </div>
        <output data-demo-state="slider-value">{String(state.value)}</output>
      </section>
    );
  },
});
