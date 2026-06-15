// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryPureMarkupDemo$button_click = handler((event, ctx) => {
  ctx.state.submitted = true;
  const doc = Reflect['get'](globalThis, 'document');
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="pure-markup-submit"]')
    : undefined;

  if (output) output['textContent'] = 'confirmed';
});

export const GalleryPureMarkupDemo$output_text_derive = derive(['state'], (state) =>
  state.submitted ? 'confirmed' : 'pending',
);
