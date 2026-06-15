// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryCheckboxGroupDemo$section_keydown = handler((event, ctx) => {
  if (
    event &&
    Object(event)['key'] !== 'ArrowDown' &&
    Object(event)['key'] !== 'ArrowLeft' &&
    Object(event)['key'] !== 'ArrowRight' &&
    Object(event)['key'] !== 'ArrowUp' &&
    Object(event)['key'] !== 'End' &&
    Object(event)['key'] !== 'Home'
  ) {
    return;
  }
  if (event) Object(event)['preventDefault']?.call(event);
  ctx.state.activeValue = ctx.state.activeValue === 'updates' ? 'billing' : 'updates';
  const doc = Reflect['get'](globalThis, 'document');
  const updates = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-updates')
    : undefined;
  const billing = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-billing')
    : undefined;

  if (updates) updates['tabIndex'] = ctx.state.activeValue === 'updates' ? 0 : -1;
  if (billing) {
    billing['tabIndex'] = ctx.state.activeValue === 'billing' ? 0 : -1;
    if (ctx.state.activeValue === 'billing') Object(billing)['focus']?.call(billing);
  }
  if (updates && ctx.state.activeValue === 'updates') Object(updates)['focus']?.call(updates);
});
export const GalleryCheckboxGroupDemo$input_click = handler((event, ctx) => {
  ctx.state.value =
    ctx.state.value === 'updates,billing'
      ? 'billing'
      : ctx.state.value === 'updates'
        ? ''
        : ctx.state.value === 'billing'
          ? 'updates,billing'
          : 'updates';
  const doc = Reflect['get'](globalThis, 'document');
  const updates = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-updates')
    : undefined;
  const billing = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-billing')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="checkbox-group-value"]')
    : undefined;
  const updatesChecked = ctx.state.value === 'updates' || ctx.state.value === 'updates,billing';
  const billingChecked = ctx.state.value === 'billing' || ctx.state.value === 'updates,billing';

  if (updates) {
    updates['checked'] = updatesChecked;
    Object(updates)['setAttribute']?.call(
      updates,
      'aria-checked',
      updatesChecked ? 'true' : 'false',
    );
    Object(updates)['setAttribute']?.call(
      updates,
      'data-state',
      updatesChecked ? 'checked' : 'unchecked',
    );
  }
  if (billing) {
    billing['checked'] = billingChecked;
    Object(billing)['setAttribute']?.call(
      billing,
      'aria-checked',
      billingChecked ? 'true' : 'false',
    );
    Object(billing)['setAttribute']?.call(
      billing,
      'data-state',
      billingChecked ? 'checked' : 'unchecked',
    );
  }
  if (output) output['textContent'] = ctx.state.value || 'none';
});
export const GalleryCheckboxGroupDemo$input_click_2 = handler((event, ctx) => {
  ctx.state.value =
    ctx.state.value === 'updates,billing'
      ? 'updates'
      : ctx.state.value === 'billing'
        ? ''
        : ctx.state.value === 'updates'
          ? 'updates,billing'
          : 'billing';
  const doc = Reflect['get'](globalThis, 'document');
  const updates = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-updates')
    : undefined;
  const billing = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-checkbox-group-billing')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="checkbox-group-value"]')
    : undefined;
  const updatesChecked = ctx.state.value === 'updates' || ctx.state.value === 'updates,billing';
  const billingChecked = ctx.state.value === 'billing' || ctx.state.value === 'updates,billing';

  if (updates) {
    updates['checked'] = updatesChecked;
    Object(updates)['setAttribute']?.call(
      updates,
      'aria-checked',
      updatesChecked ? 'true' : 'false',
    );
    Object(updates)['setAttribute']?.call(
      updates,
      'data-state',
      updatesChecked ? 'checked' : 'unchecked',
    );
  }
  if (billing) {
    billing['checked'] = billingChecked;
    Object(billing)['setAttribute']?.call(
      billing,
      'aria-checked',
      billingChecked ? 'true' : 'false',
    );
    Object(billing)['setAttribute']?.call(
      billing,
      'data-state',
      billingChecked ? 'checked' : 'unchecked',
    );
  }
  if (output) output['textContent'] = ctx.state.value || 'none';
});

export const GalleryCheckboxGroupDemo$output_text_derive = derive(
  ['state'],
  (state) => state.value || 'none',
);
