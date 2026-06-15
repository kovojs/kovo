// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryCollapsibleDemo$summary_click = handler((_event, ctx) => {
  ctx.state.open = !ctx.state.open;
});
