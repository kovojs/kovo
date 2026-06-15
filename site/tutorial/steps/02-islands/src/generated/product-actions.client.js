// @jiso-ir
import { handler } from '@jiso/runtime';

export const ProductActions$button_click = handler((_event, ctx) => {
  ctx.state.saved += 1;
});
