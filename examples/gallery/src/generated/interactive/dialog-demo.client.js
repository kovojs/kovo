// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryDialogDemo$section_keydown = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryDialogDemo$button_click = handler((event, ctx) => {
  ctx.state.open = true;
});
export const GalleryDialogDemo$dialog_cancel = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryDialogDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
});

export const GalleryDialogDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
