// @kovojs-ir - lowered from examples/gallery/src/interactive/slider-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive, kovoStyleProperty } from '@kovojs/runtime/generated';

export const GallerySliderDemo$section_data_value_derive = derive(['state'], (state: any) =>
  String(state.value),
);
export const GallerySliderDemo$input_value_derive = derive(['state'], (state: any) => state.value);
export const GallerySliderDemo$div_data_value_derive = derive(['state'], (state: any) =>
  String(state.value),
);
export const GallerySliderDemo$div_data_value_ratio_derive = derive(['state'], (state: any) =>
  String(state.value / 100),
);
export const GallerySliderDemo$span_data_value_derive = derive(['state'], (state: any) =>
  String(state.value),
);
export const GallerySliderDemo$span_data_value_ratio_derive = derive(['state'], (state: any) =>
  String(state.value / 100),
);
export const GallerySliderDemo$span_style_derive = derive(['state'], (state: any) =>
  [kovoStyleProperty('width', `${state.value}%`)].filter(Boolean).join('; '),
);
export const GallerySliderDemo$span_aria_valuenow_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GallerySliderDemo$span_aria_valuetext_derive = derive(
  ['state'],
  (state: any) => `${state.value} percent`,
);
export const GallerySliderDemo$span_data_dragging_derive = derive(['state'], (state: any) =>
  state.dragging ? '' : null,
);
export const GallerySliderDemo$span_data_value_derive_2 = derive(['state'], (state: any) =>
  String(state.value),
);
export const GallerySliderDemo$span_data_value_ratio_derive_2 = derive(['state'], (state: any) =>
  String(state.value / 100),
);
export const GallerySliderDemo$span_style_derive_2 = derive(['state'], (state: any) =>
  [
    kovoStyleProperty('left', `${state.value}%`),
    kovoStyleProperty('top', '50%'),
    kovoStyleProperty('transform', 'translate(-50%, -50%)'),
  ]
    .filter(Boolean)
    .join('; '),
);
export const GallerySliderDemo$output_text_derive = derive(['state'], (state: any) =>
  String(state.value),
);

import { component } from '@kovojs/core';
import {
  sliderHiddenInputAttributes,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
} from '@kovojs/headless-ui/slider';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/slider.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950 data-[orientation=vertical]:inline-grid';
const TRACK_CLASS =
  'relative h-2 w-full cursor-pointer rounded-full bg-neutral-200 data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-2';
const RANGE_CLASS =
  'pointer-events-none block h-full rounded-full bg-neutral-950 data-[orientation=vertical]:w-full';
const THUMB_CLASS =
  'absolute block h-4 w-4 cursor-grab rounded-full border border-neutral-300 bg-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 data-[disabled]:opacity-50 data-[dragging]:cursor-grabbing';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';
const OUTPUT_CLASS = 'text-xs text-neutral-500';

export interface GallerySliderDemoState {
  dragging: boolean;
  dragPointerStart: number;
  dragValueStart: number;
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySliderDemo = component({
  state: () => ({
    dragging: false,
    dragPointerStart: 0,
    dragValueStart: 25,
    value: 25,
  }),
  render: (_queries: Record<string, never>, state: GallerySliderDemoState) => {
    const sliderState = {
      form: 'gallery-slider-form',
      labelledBy: 'gallery-slider-label',
      max: 100,
      min: 0,
      name: 'gallery-completion',
      step: 25,
      value: state.value,
      valueText: `${state.value} percent`,
    };

    return (
      <section
        class={ROOT_CLASS}
        data-gallery-interactive="slider"
        {...sliderRootAttributes(sliderState)}
        data-value={String(state.value)}
        data-bind:data-value="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$section_data_value_derive"
        kovo-c="gallery-slider-demo"
        kovo-state='{"dragging":false,"dragPointerStart":0,"dragValueStart":25,"value":25}'
      >
        <form id="gallery-slider-form" data-gallery-form="slider" />
        <label id="gallery-slider-label" class={LABEL_CLASS}>
          Completion
        </label>
        <input
          id="gallery-slider-input"
          {...sliderHiddenInputAttributes(sliderState)}
          value={state.value}
          data-bind:value="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$input_value_derive"
        />
        <div
          class={TRACK_CLASS}
          on:pointerdown="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$div_pointerdown"
          {...sliderTrackAttributes(sliderState)}
          data-value={String(state.value)}
          data-bind:data-value="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$div_data_value_derive"
          data-value-ratio={String(state.value / 100)}
          data-bind:data-value-ratio="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$div_data_value_ratio_derive"
        >
          <span
            class={RANGE_CLASS}
            {...sliderRangeAttributes(sliderState)}
            data-value={String(state.value)}
            data-bind:data-value="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_data_value_derive"
            data-value-ratio={String(state.value / 100)}
            data-bind:data-value-ratio="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_data_value_ratio_derive"
            style={{ width: `${state.value}%` }}
            data-bind:style="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_style_derive"
          />
          <span
            class={THUMB_CLASS}
            on:keydown="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_keydown"
            on:pointerdown="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_pointerdown"
            on:pointermove="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_pointermove"
            on:pointerup="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_pointerup"
            {...sliderThumbAttributes(sliderState)}
            aria-valuenow={state.value}
            data-bind:aria-valuenow="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_aria_valuenow_derive"
            aria-valuetext={`${state.value} percent`}
            data-bind:aria-valuetext="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_aria_valuetext_derive"
            data-dragging={state.dragging ? '' : null}
            data-bind:data-dragging="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_data_dragging_derive"
            data-value={String(state.value)}
            data-bind:data-value="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_data_value_derive_2"
            data-value-ratio={String(state.value / 100)}
            data-bind:data-value-ratio="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_data_value_ratio_derive_2"
            style={{
              left: `${state.value}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            data-bind:style="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$span_style_derive_2"
          />
        </div>
        <output
          data-demo-state="slider-value"
          class={OUTPUT_CLASS}
          data-bind="/c/__v/8b71bb23/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </section>
    );
  },
});
GallerySliderDemo.name = 'generated/interactive/slider-demo/gallery-slider-demo';
