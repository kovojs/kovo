// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

export const GalleryProgressDemo$Button_click = handler((_event, ctx) => {
  ctx.state.value = ctx.state.value === 100 ? 40 : 100;
});
export const GalleryProgressDemo$Button_click_2 = handler((_event, ctx) => {
  ctx.state.value = null;
});

export const GalleryProgressDemo$Progress_aria_valuetext_derive = derive(['state'], (state) =>
  state.value === null ? 'Upload pending' : `${state.value} percent uploaded`,
);
export const GalleryProgressDemo$Progress_value_derive = derive(['state'], (state) => state.value);
export const GalleryProgressDemo$output_text_derive = derive(['state'], (state) =>
  state.value === null ? 'pending' : `${state.value}%`,
);
