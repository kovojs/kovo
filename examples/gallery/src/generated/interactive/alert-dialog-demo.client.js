// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryAlertDialogDemo$section_keydown = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryAlertDialogDemo$button_click = handler((event, ctx) => {
  ctx.state.open = true;
});
export const GalleryAlertDialogDemo$dialog_cancel = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryAlertDialogDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryAlertDialogDemo$button_click_3 = handler((event, ctx) => {
  ctx.state.open = false;
});

export const GalleryAlertDialogDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
