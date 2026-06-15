// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryToastDemo$section_keydown = handler((event, ctx) => {
  if (!event || Reflect['get'](event, 'key') !== 'Escape') return;
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  if (toast) {
    toast['hidden'] = true;
    Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
  }
});
export const GalleryToastDemo$button_click = handler((_event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  if (toast) {
    toast['hidden'] = true;
    Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
  }
});
export const GalleryToastDemo$button_click_2 = handler((event, ctx) => {
  if (!event) return;
  Object(event)['preventDefault']?.call(event);
  ctx.state.open = true;

  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  if (toast) {
    toast['hidden'] = false;
    Object(toast)['setAttribute']?.call(toast, 'data-state', 'open');
  }
});
export const GalleryToastDemo$button_click_3 = handler((_event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const toast = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toast') : undefined;
  if (toast) {
    toast['hidden'] = true;
    Object(toast)['setAttribute']?.call(toast, 'data-state', 'closed');
  }
});
export const GalleryToastDemo$button_click_4 = handler((event, _ctx) => {
  if (!event) return;
  Object(event)['preventDefault']?.call(event);
});

export const GalleryToastDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
