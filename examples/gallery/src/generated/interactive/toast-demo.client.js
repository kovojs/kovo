// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryToastDemo$section_keydown = handler((event, ctx) => {
  if (!event || Reflect['get'](event, 'key') !== 'Escape') return;
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
    : undefined;
  if (toast) toast['hidden'] = true;
  if (output) output['textContent'] = 'closed';
});
export const GalleryToastDemo$button_click = handler((event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
    : undefined;
  if (toast) toast['hidden'] = true;
  if (output) output['textContent'] = 'closed';
});
export const GalleryToastDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
    : undefined;
  if (toast) toast['hidden'] = true;
  if (output) output['textContent'] = 'closed';
});
