// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryOtpFieldDemo$input_keydown = handler((event, ctx) => {
  ctx.state.activeSlot = 1;
  const doc = Reflect['get'](globalThis, 'document');
  const first = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-0')
    : undefined;
  const second = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-1')
    : undefined;

  if (first) first['tabIndex'] = -1;
  if (second) second['tabIndex'] = 0;
  if (second) Object(second)['focus']?.call(second);
});
export const GalleryOtpFieldDemo$input_keydown_2 = handler((event, ctx) => {
  ctx.state.value = '1';
  ctx.state.activeSlot = 1;
  const doc = Reflect['get'](globalThis, 'document');
  const hidden = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-hidden')
    : undefined;
  const second = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-1')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="otp-value"]')
    : undefined;

  if (hidden) hidden['value'] = ctx.state.value;
  if (second) second['value'] = '';
  if (output) output['textContent'] = ctx.state.value;
});
export const GalleryOtpFieldDemo$input_input = handler((event, ctx) => {
  ctx.state.value = ctx.state.value === '12' ? '123' : ctx.state.value;
  ctx.state.activeSlot = 3;
  const doc = Reflect['get'](globalThis, 'document');
  const hidden = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-hidden')
    : undefined;
  const third = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-2')
    : undefined;
  const fourth = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-3')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="otp-value"]')
    : undefined;

  if (hidden) hidden['value'] = ctx.state.value;
  if (third) {
    third['value'] = '3';
    third['tabIndex'] = -1;
    Object(third)['setAttribute']?.call(third, 'data-filled', '');
  }
  if (fourth) {
    fourth['tabIndex'] = 0;
    Object(fourth)['focus']?.call(fourth);
  }
  if (output) output['textContent'] = ctx.state.value;
});
export const GalleryOtpFieldDemo$input_input_2 = handler((event, ctx) => {
  ctx.state.value = '1234';
  ctx.state.activeSlot = 3;
  const doc = Reflect['get'](globalThis, 'document');
  const root = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp')
    : undefined;
  const hidden = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-hidden')
    : undefined;
  const fourth = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-3')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="otp-value"]')
    : undefined;

  if (root) Object(root)['setAttribute']?.call(root, 'data-complete', '');
  if (hidden) {
    hidden['value'] = ctx.state.value;
    Object(hidden)['setAttribute']?.call(hidden, 'data-complete', '');
  }
  if (fourth) {
    fourth['value'] = '4';
    Object(fourth)['setAttribute']?.call(fourth, 'data-filled', '');
    Object(fourth)['setAttribute']?.call(fourth, 'data-complete', '');
  }
  if (output) output['textContent'] = ctx.state.value;
});
