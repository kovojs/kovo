// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryAlertDialogDemo$section_keydown = handler((_event, ctx) => {
  ctx.state.open = false;
});
export const GalleryAlertDialogDemo$button_click = handler((_event, ctx) => {
  ctx.state.open = true;
});
export const GalleryAlertDialogDemo$dialog_cancel = handler((_event, ctx) => {
  ctx.state.open = false;
});
export const GalleryAlertDialogDemo$button_click_2 = handler((_event, ctx) => {
  ctx.state.open = false;
});
export const GalleryAlertDialogDemo$button_click_3 = handler((_event, ctx) => {
  ctx.state.open = false;
});

export const GalleryAlertDialogDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
