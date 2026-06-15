// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryRadioGroupDemo$div_keydown = handler((_event, ctx) => {
  ctx.state.value = ctx.state.value === 'email' ? 'sms' : 'email';
  const doc = Reflect['get'](globalThis, 'document');
  const email = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-email') : undefined;
  const sms = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-sms') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="radio-value"]')
    : undefined;

  if (email) {
    email['checked'] = ctx.state.value === 'email';
    email['tabIndex'] = ctx.state.value === 'email' ? 0 : -1;
    Object(email)['setAttribute']?.call(
      email,
      'aria-checked',
      ctx.state.value === 'email' ? 'true' : 'false',
    );
  }
  if (sms) {
    sms['checked'] = ctx.state.value === 'sms';
    sms['tabIndex'] = ctx.state.value === 'sms' ? 0 : -1;
    Object(sms)['setAttribute']?.call(
      sms,
      'aria-checked',
      ctx.state.value === 'sms' ? 'true' : 'false',
    );
  }
  if (output) output['textContent'] = ctx.state.value;
});
export const GalleryRadioGroupDemo$input_click = handler((_event, ctx) => {
  ctx.state.value = 'email';
  const doc = Reflect['get'](globalThis, 'document');
  const email = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-email') : undefined;
  const sms = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-sms') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="radio-value"]')
    : undefined;

  if (email) {
    email['checked'] = true;
    email['tabIndex'] = 0;
    Object(email)['setAttribute']?.call(email, 'aria-checked', 'true');
  }
  if (sms) {
    sms['checked'] = false;
    sms['tabIndex'] = -1;
    Object(sms)['setAttribute']?.call(sms, 'aria-checked', 'false');
  }
  if (output) output['textContent'] = 'email';
});
export const GalleryRadioGroupDemo$input_click_2 = handler((_event, ctx) => {
  ctx.state.value = 'sms';
  const doc = Reflect['get'](globalThis, 'document');
  const email = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-email') : undefined;
  const sms = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-sms') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="radio-value"]')
    : undefined;

  if (email) {
    email['checked'] = false;
    email['tabIndex'] = -1;
    Object(email)['setAttribute']?.call(email, 'aria-checked', 'false');
  }
  if (sms) {
    sms['checked'] = true;
    sms['tabIndex'] = 0;
    Object(sms)['setAttribute']?.call(sms, 'aria-checked', 'true');
  }
  if (output) output['textContent'] = 'sms';
});
