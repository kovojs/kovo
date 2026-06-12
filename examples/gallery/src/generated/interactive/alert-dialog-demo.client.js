// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryAlertDialogDemo$button_click = handler((event, ctx) => {
  ctx.state.open = true;
});
export const GalleryAlertDialogDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryAlertDialogDemo$button_click_3 = handler((event, ctx) => {
  ctx.state.open = false;
});
