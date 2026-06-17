// @kovojs-ir
import { handler } from '@kovojs/runtime/generated';

export const ProductActions$button_click = handler((_event, ctx) => {
  ctx.state.saved += 1;
});
