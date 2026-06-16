// @kovojs-ir
import { derive, handler } from '@kovojs/runtime';

export const GalleryPureMarkupDemo$button_click = handler((_event, ctx) => {
  ctx.state.submitted = true;
});

export const GalleryPureMarkupDemo$output_text_derive = derive(['state'], (state) =>
  state.submitted ? 'confirmed' : 'pending',
);
