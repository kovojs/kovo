// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryPopoverDemo$section_keydown = handler((event, ctx) => {
  ctx.state.open = false;
});
export const GalleryPopoverDemo$button_click = handler((event, ctx) => {
  ctx.state.open = !ctx.state.open;
});
