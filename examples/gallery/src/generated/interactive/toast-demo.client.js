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
  if (toast) {
    toast['hidden'] = true;
    Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});
export const GalleryToastDemo$button_click = handler((event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
    : undefined;
  if (toast) {
    toast['hidden'] = true;
    Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});
export const GalleryToastDemo$button_click_2 = handler((event, ctx) => {
  if (!event) return;
  Object(event)['preventDefault']?.call(event);
  ctx.state.open = true;

  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
    : undefined;
  if (toast) {
    toast['hidden'] = false;
    Object(toast)['setAttribute']?.call(toast, 'data-state', 'open');
  }
  if (output) output['textContent'] = 'canceled';
});
export const GalleryToastDemo$button_click_3 = handler((event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
    : undefined;
  if (toast) {
    toast['hidden'] = true;
    Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});
export const GalleryToastDemo$button_click_4 = handler((event, ctx) => {
  if (!event) return;
  Object(event)['preventDefault']?.call(event);

  const doc = Reflect['get'](globalThis, 'document');
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toast-open"]')
    : undefined;
  if (output) output['textContent'] = ctx.state.open ? 'disabled' : 'closed';
});
