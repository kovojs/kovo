// @kovojs-ir - lowered from examples/gallery/src/interactive/slider-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive, kovoStyleProperty } from '@kovojs/runtime/generated';

export const GallerySliderDemo$Slider_data_value_derive = derive(['state'], (state: any) =>
  String(state.value),
);
export const GallerySliderDemo$SliderInput_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GallerySliderDemo$SliderTrack_data_value_derive = derive(['state'], (state: any) =>
  String(state.value),
);
export const GallerySliderDemo$SliderTrack_data_value_ratio_derive = derive(
  ['state'],
  (state: any) => String(state.value / 100),
);
export const GallerySliderDemo$SliderRange_data_value_derive = derive(['state'], (state: any) =>
  String(state.value),
);
export const GallerySliderDemo$SliderRange_data_value_ratio_derive = derive(
  ['state'],
  (state: any) => String(state.value / 100),
);
export const GallerySliderDemo$SliderRange_style_derive = derive(['state'], (state: any) =>
  [kovoStyleProperty('width', `${state.value}%`)].filter(Boolean).join('; '),
);
export const GallerySliderDemo$SliderThumb_aria_valuenow_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GallerySliderDemo$SliderThumb_aria_valuetext_derive = derive(
  ['state'],
  (state: any) => `${state.value} percent`,
);
export const GallerySliderDemo$SliderThumb_data_dragging_derive = derive(['state'], (state: any) =>
  state.dragging ? '' : null,
);
export const GallerySliderDemo$SliderThumb_data_value_derive = derive(['state'], (state: any) =>
  String(state.value),
);
export const GallerySliderDemo$SliderThumb_data_value_ratio_derive = derive(
  ['state'],
  (state: any) => String(state.value / 100),
);
export const GallerySliderDemo$SliderThumb_style_derive = derive(['state'], (state: any) =>
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
import { Slider, SliderInput, SliderRange, SliderThumb, SliderTrack } from '@kovojs/ui/slider';

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
      <Slider
        data-gallery-interactive="slider"
        {...sliderState}
        data-value={String(state.value)}
        data-bind:data-value="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$Slider_data_value_derive"
        kovo-state='{"dragging":false,"dragPointerStart":0,"dragValueStart":25,"value":25}'
      >
        <form id="gallery-slider-form" data-gallery-form="slider" />
        <label id="gallery-slider-label" class={LABEL_CLASS}>
          Completion
        </label>
        <SliderInput
          id="gallery-slider-input"
          {...sliderState}
          value={state.value}
          data-bind:value="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderInput_value_derive"
        />
        <SliderTrack
          on:pointerdown="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderTrack_pointerdown"
          {...sliderState}
          data-value={String(state.value)}
          data-bind:data-value="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderTrack_data_value_derive"
          data-value-ratio={String(state.value / 100)}
          data-bind:data-value-ratio="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderTrack_data_value_ratio_derive"
        >
          <SliderRange
            {...sliderState}
            data-value={String(state.value)}
            data-bind:data-value="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderRange_data_value_derive"
            data-value-ratio={String(state.value / 100)}
            data-bind:data-value-ratio="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderRange_data_value_ratio_derive"
            style={{ width: `${state.value}%` }}
            data-bind:style="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderRange_style_derive"
          />
          <SliderThumb
            on:keydown="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_keydown"
            on:pointerdown="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_pointerdown"
            on:pointermove="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_pointermove"
            on:pointerup="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_pointerup"
            {...sliderState}
            aria-valuenow={state.value}
            data-bind:aria-valuenow="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_aria_valuenow_derive"
            aria-valuetext={`${state.value} percent`}
            data-bind:aria-valuetext="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_aria_valuetext_derive"
            data-dragging={state.dragging ? '' : null}
            data-bind:data-dragging="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_data_dragging_derive"
            data-value={String(state.value)}
            data-bind:data-value="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_data_value_derive"
            data-value-ratio={String(state.value / 100)}
            data-bind:data-value-ratio="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_data_value_ratio_derive"
            style={{
              left: `${state.value}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            data-bind:style="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$SliderThumb_style_derive"
          />
        </SliderTrack>
        <output
          data-demo-state="slider-value"
          class={OUTPUT_CLASS}
          data-bind="/c/__v/21c09a9e/examples/gallery/src/generated/interactive/slider-demo.client.js#GallerySliderDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </Slider>
    );
  },
});
GallerySliderDemo.name = 'generated/interactive/slider-demo/gallery-slider-demo';
