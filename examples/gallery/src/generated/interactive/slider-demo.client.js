// @kovojs-ir
import { derive, handler, kovoStyleProperty } from '@kovojs/runtime/generated';

import {
  sliderKeyDown as _sliderKeyDown,
  sliderThumbDrag as _sliderThumbDrag,
  sliderThumbDragStart as _sliderThumbDragStart,
  sliderTrackPointerDown as _sliderTrackPointerDown,
} from '@kovojs/headless-ui/primitives';

export const GallerySliderDemo$div_pointerdown = handler((event, ctx) => {
  const result = _sliderTrackPointerDown(Object(event), {
    max: 100,
    min: 0,
    step: 25,
    value: ctx.state.value,
  });
  if (!result?.changed) return;
  ctx.state.value = result.value;
});
export const GallerySliderDemo$span_keydown = handler((event, ctx) => {
  const result = _sliderKeyDown(Object(event), {
    max: 100,
    min: 0,
    step: 25,
    value: ctx.state.value,
  });
  if (!result?.changed) return;
  ctx.state.value = result.value;
});
export const GallerySliderDemo$span_pointerdown = handler((event, ctx) => {
  const result = _sliderThumbDragStart(Object(event), {
    max: 100,
    min: 0,
    step: 25,
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.dragging = true;
  ctx.state.dragPointerStart = result.pointerStart;
  ctx.state.dragValueStart = result.valueStart;
});
export const GallerySliderDemo$span_pointermove = handler((event, ctx) => {
  if (!ctx.state.dragging) return;
  const result = _sliderThumbDrag(
    Object(event),
    {
      max: 100,
      min: 0,
      step: 25,
      value: ctx.state.value,
    },
    {
      pointerStart: ctx.state.dragPointerStart,
      valueStart: ctx.state.dragValueStart,
    },
  );
  if (!result?.changed) return;
  ctx.state.value = result.value;
});
export const GallerySliderDemo$span_pointerup = handler((_event, ctx) => {
  ctx.state.dragging = false;
});

export const GallerySliderDemo$section_data_value_derive = derive(['state'], (state) =>
  String(state.value),
);
export const GallerySliderDemo$input_value_derive = derive(['state'], (state) => state.value);
export const GallerySliderDemo$div_data_value_derive = derive(['state'], (state) =>
  String(state.value),
);
export const GallerySliderDemo$div_data_value_ratio_derive = derive(['state'], (state) =>
  String(state.value / 100),
);
export const GallerySliderDemo$span_data_value_derive = derive(['state'], (state) =>
  String(state.value),
);
export const GallerySliderDemo$span_data_value_ratio_derive = derive(['state'], (state) =>
  String(state.value / 100),
);
export const GallerySliderDemo$span_style_derive = derive(['state'], (state) =>
  [kovoStyleProperty('width', `${state.value}%`)].filter(Boolean).join('; '),
);
export const GallerySliderDemo$span_aria_valuenow_derive = derive(
  ['state'],
  (state) => state.value,
);
export const GallerySliderDemo$span_aria_valuetext_derive = derive(
  ['state'],
  (state) => `${state.value} percent`,
);
export const GallerySliderDemo$span_data_dragging_derive = derive(['state'], (state) =>
  state.dragging ? '' : null,
);
export const GallerySliderDemo$span_data_value_derive_2 = derive(['state'], (state) =>
  String(state.value),
);
export const GallerySliderDemo$span_data_value_ratio_derive_2 = derive(['state'], (state) =>
  String(state.value / 100),
);
export const GallerySliderDemo$span_style_derive_2 = derive(['state'], (state) =>
  [
    kovoStyleProperty('left', `${state.value}%`),
    kovoStyleProperty('top', '50%'),
    kovoStyleProperty('transform', 'translate(-50%, -50%)'),
  ]
    .filter(Boolean)
    .join('; '),
);
export const GallerySliderDemo$output_text_derive = derive(['state'], (state) =>
  String(state.value),
);
