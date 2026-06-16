// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

export const GalleryProgressDemo$button_click = handler((_event, ctx) => {
  ctx.state.value = ctx.state.value === 100 ? 40 : 100;
});
export const GalleryProgressDemo$button_click_2 = handler((_event, ctx) => {
  ctx.state.value = null;
});

export const GalleryProgressDemo$progress_aria_valuetext_derive = derive(['state'], (state) =>
  state.value === null ? 'Upload pending' : `${state.value} percent uploaded`,
);
export const GalleryProgressDemo$progress_data_state_derive = derive(['state'], (state) =>
  state.value === null ? 'indeterminate' : state.value === 100 ? 'complete' : 'loading',
);
export const GalleryProgressDemo$progress_data_value_derive = derive(['state'], (state) =>
  state.value === null ? undefined : String(state.value),
);
export const GalleryProgressDemo$progress_value_derive = derive(['state'], (state) =>
  state.value === null ? undefined : state.value,
);
export const GalleryProgressDemo$output_text_derive = derive(['state'], (state) =>
  state.value === null ? 'pending' : `${state.value}%`,
);
