// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryFieldDemo$input_input = handler((event, ctx) => {
  ctx.state.email = 'ada@jiso.dev';
  ctx.state.invalid = false;
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-field-email-input')
    : undefined;
  const error = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-field-email-error')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="field-email"]')
    : undefined;

  if (input) {
    input['value'] = ctx.state.email;
    Object(input)['setAttribute']?.call(
      input,
      'aria-describedby',
      'gallery-interactive-field-email-description',
    );
    Object(input)['removeAttribute']?.call(input, 'aria-invalid');
    Object(input)['removeAttribute']?.call(input, 'data-invalid');
  }
  if (error) error['hidden'] = true;
  if (output) output['textContent'] = ctx.state.email;
});
export const GalleryFieldDemo$select_change = handler((event, ctx) => {
  ctx.state.plan = ctx.state.plan === 'team' ? 'enterprise' : 'team';
  const doc = Reflect['get'](globalThis, 'document');
  const select = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-field-plan-select')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="field-plan"]')
    : undefined;

  if (select) select['value'] = ctx.state.plan;
  if (output) output['textContent'] = ctx.state.plan;
});
export const GalleryFieldDemo$input_click = handler((event, ctx) => {
  ctx.state.shippingDisabled = !ctx.state.shippingDisabled;
  const doc = Reflect['get'](globalThis, 'document');
  const fieldset = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-fieldset')
    : undefined;
  const checkbox = doc
    ? Object(doc)['querySelector']?.call(doc, 'input[name="gallery-shipping-disabled"]')
    : undefined;

  if (fieldset) {
    fieldset['disabled'] = ctx.state.shippingDisabled;
    if (ctx.state.shippingDisabled) {
      Object(fieldset)['setAttribute']?.call(fieldset, 'data-disabled', '');
    } else {
      Object(fieldset)['removeAttribute']?.call(fieldset, 'data-disabled');
    }
  }
  if (checkbox) checkbox['checked'] = ctx.state.shippingDisabled;
});
