// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryCheckboxDemo$input_click = handler((event, ctx) => {
  ctx.state.checked = ctx.state.checked === 'indeterminate' ? true : !ctx.state.checked;
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['querySelector']?.call(
        doc,
        '[data-gallery-interactive="checkbox"] input[type="checkbox"]',
      )
    : undefined;
  if (input) input['indeterminate'] = false;
});
