// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryCheckboxDemo$input_click = handler((event, ctx) => {
  ctx.state.checked = ctx.state.checked === 'indeterminate' ? true : !ctx.state.checked;
});
