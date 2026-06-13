// @jiso-ir - lowered from examples/gallery/src/interactive/slider-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
        fw-c="gallery-slider-demo"
        fw-state='{"value":25}'
      >
        <label for="gallery-slider-input">Completion</label>
        <input
          {...sliderInputAttributes(sliderState)}
          id="gallery-slider-input"
          on:input="/c/examples/gallery/src/generated/interactive/slider-demo.client.js?v=a96ffe28#GallerySliderDemo$input_input"
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
