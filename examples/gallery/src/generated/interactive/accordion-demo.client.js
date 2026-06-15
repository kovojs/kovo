// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryAccordionDemo$button_click = handler((_event, ctx) => {
  ctx.state.value = ctx.state.value === 'shipping' ? '' : 'shipping';
  const doc = Reflect['get'](globalThis, 'document');
  const shippingTrigger = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-shipping-trigger')
    : undefined;
  const billingTrigger = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-billing-trigger')
    : undefined;
  const shippingPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-shipping-content')
    : undefined;
  const billingPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-billing-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="accordion-value"]')
    : undefined;

  if (shippingTrigger)
    Object(shippingTrigger)['setAttribute']?.call(
      shippingTrigger,
      'aria-expanded',
      ctx.state.value === 'shipping' ? 'true' : 'false',
    );
  if (billingTrigger)
    Object(billingTrigger)['setAttribute']?.call(
      billingTrigger,
      'aria-expanded',
      ctx.state.value === 'billing' ? 'true' : 'false',
    );
  if (shippingPanel) shippingPanel['hidden'] = ctx.state.value !== 'shipping';
  if (billingPanel) billingPanel['hidden'] = ctx.state.value !== 'billing';
  if (output) output['textContent'] = ctx.state.value || 'none';
});
export const GalleryAccordionDemo$button_click_2 = handler((_event, ctx) => {
  ctx.state.value = ctx.state.value === 'billing' ? '' : 'billing';
  const doc = Reflect['get'](globalThis, 'document');
  const shippingTrigger = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-shipping-trigger')
    : undefined;
  const billingTrigger = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-billing-trigger')
    : undefined;
  const shippingPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-shipping-content')
    : undefined;
  const billingPanel = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-accordion-billing-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="accordion-value"]')
    : undefined;

  if (shippingTrigger)
    Object(shippingTrigger)['setAttribute']?.call(
      shippingTrigger,
      'aria-expanded',
      ctx.state.value === 'shipping' ? 'true' : 'false',
    );
  if (billingTrigger)
    Object(billingTrigger)['setAttribute']?.call(
      billingTrigger,
      'aria-expanded',
      ctx.state.value === 'billing' ? 'true' : 'false',
    );
  if (shippingPanel) shippingPanel['hidden'] = ctx.state.value !== 'shipping';
  if (billingPanel) billingPanel['hidden'] = ctx.state.value !== 'billing';
  if (output) output['textContent'] = ctx.state.value || 'none';
});

export const GalleryAccordionDemo$output_text_derive = derive(
  ['state'],
  (state) => state.value || 'none',
);
