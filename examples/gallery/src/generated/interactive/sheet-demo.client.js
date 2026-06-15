// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GallerySheetDemo$section_keydown = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GallerySheetDemo$button_click = handler((event, ctx) => {
  ctx.state.open = true;
});
export const GallerySheetDemo$dialog_cancel = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GallerySheetDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
});

export const GallerySheetDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
