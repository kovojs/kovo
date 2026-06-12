// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryNumberFieldDemo$button_click = handler((event, ctx) => {
  ctx.state.value = ctx.state.value <= 0 ? 0 : ctx.state.value - 1;
});
export const GalleryNumberFieldDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.value = ctx.state.value >= 5 ? 5 : ctx.state.value + 1;
});
