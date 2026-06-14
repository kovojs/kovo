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

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/slider.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950 data-[orientation=vertical]:inline-grid';
const INPUT_CLASS =
  'h-2 w-full accent-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-2';
const TRACK_CLASS =
  'relative h-2 w-full overflow-hidden rounded-full bg-neutral-200 data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-2';
const RANGE_CLASS = 'block h-full rounded-full bg-neutral-950 data-[orientation=vertical]:w-full';
const THUMB_CLASS =
  'block h-4 w-4 rounded-full border border-neutral-300 bg-white shadow-sm data-[disabled]:opacity-50';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';
const OUTPUT_CLASS = 'text-xs text-neutral-500';

export interface GallerySliderDemoState {
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GallerySliderDemo = component('gallery-slider-demo', {
  state: () => ({ value: 25 }),
  render: (_queries: Record<string, never>, state: GallerySliderDemoState) => {
    const sliderState = {
      form: 'gallery-slider-form',
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
        class={ROOT_CLASS}
        data-gallery-interactive="slider"
        fw-c="gallery-slider-demo"
        fw-state='{"value":25}'
      >
        <form id="gallery-slider-form" data-gallery-form="slider" />
        <label for="gallery-slider-input" class={LABEL_CLASS}>
          Completion
        </label>
        <input
          {...sliderInputAttributes(sliderState)}
          id="gallery-slider-input"
          class={INPUT_CLASS}
          on:input="/c/examples/gallery/src/generated/interactive/slider-demo.client.js?v=a96ffe28#GallerySliderDemo$input_input"
        />
        <div {...sliderTrackAttributes(sliderState)} class={TRACK_CLASS}>
          <span {...sliderRangeAttributes(sliderState)} class={RANGE_CLASS} />
          <span {...sliderThumbAttributes(sliderState)} class={THUMB_CLASS} />
        </div>
        <output data-demo-state="slider-value" class={OUTPUT_CLASS}>
          {String(state.value)}
        </output>
      </section>
    );
  },
});
