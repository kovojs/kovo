// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryDialogDemo$button_click = handler((event, ctx) => {
  ctx.state.open = true;
});
export const GalleryDialogDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
});
