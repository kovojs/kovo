// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryToggleDemo$button_click = handler((event, ctx) => {
  ctx.state.pressed = !ctx.state.pressed;
});
