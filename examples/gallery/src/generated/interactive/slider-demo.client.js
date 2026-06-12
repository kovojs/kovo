// @jiso-ir
import { handler } from '@jiso/runtime';

export const GallerySliderDemo$input_input = handler((event, ctx) => {
  ctx.state.value = ctx.state.value === 25 ? 75 : 25;
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-slider-input') : undefined;
  const range = doc ? Object(doc)['querySelector']?.call(doc, '[data-part="range"]') : undefined;
  const thumb = doc ? Object(doc)['querySelector']?.call(doc, '[data-part="thumb"]') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="slider-value"]')
    : undefined;
  const ratio = String(ctx.state.value / 100);

  if (input) {
    input['value'] = String(ctx.state.value);
    Object(input)['setAttribute']?.call(input, 'aria-valuetext', `${ctx.state.value} percent`);
    Object(input)['setAttribute']?.call(input, 'data-value', String(ctx.state.value));
  }
  if (range) {
    Object(range)['setAttribute']?.call(range, 'data-value', String(ctx.state.value));
    Object(range)['setAttribute']?.call(range, 'data-value-ratio', ratio);
  }
  if (thumb) {
    Object(thumb)['setAttribute']?.call(thumb, 'data-value', String(ctx.state.value));
    Object(thumb)['setAttribute']?.call(thumb, 'data-value-ratio', ratio);
  }
  if (output) output['textContent'] = String(ctx.state.value);
});
