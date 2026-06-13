// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryDrawerDemo$section_keydown = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryDrawerDemo$button_click = handler((event, ctx) => {
  ctx.state.open = true;
});
export const GalleryDrawerDemo$dialog_cancel = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryDrawerDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
});
