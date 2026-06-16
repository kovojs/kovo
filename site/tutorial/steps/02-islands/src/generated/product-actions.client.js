// @kovojs-ir
import { handler } from '@kovojs/runtime';

export const ProductActions$button_click = handler((_event, ctx) => {
  ctx.state.saved += 1;
});
