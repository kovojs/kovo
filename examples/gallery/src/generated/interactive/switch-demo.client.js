// @jiso-ir
import { handler } from '@jiso/runtime';

export const GallerySwitchDemo$input_click = handler((event, ctx) => {
  ctx.state.checked = !ctx.state.checked;
});
