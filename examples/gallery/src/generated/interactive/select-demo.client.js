// @jiso-ir
import { handler } from '@jiso/runtime';

export const GallerySelectDemo$select_change = handler((event, ctx) => {
  ctx.state.value = ctx.state.value === 'standard' ? 'express' : 'standard';
  const doc = Reflect['get'](globalThis, 'document');
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="select-value"]')
    : undefined;

  if (output) output['textContent'] = ctx.state.value === 'express' ? 'Express' : 'Standard';
});
