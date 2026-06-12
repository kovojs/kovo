// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryNavigationMenuDemo$section_keydown = handler((event, ctx) => {
  ctx.state.activeValue = 'docs';
  const doc = Reflect['get'](globalThis, 'document');
  const products = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-products-trigger')
    : undefined;
  const docs = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-docs-link')
    : undefined;
  if (products) products['tabIndex'] = -1;
  if (docs) docs['tabIndex'] = 0;
});
export const GalleryNavigationMenuDemo$button_click = handler((event, ctx) => {
  ctx.state.openValue = ctx.state.openValue === 'products' ? '' : 'products';
  const doc = Reflect['get'](globalThis, 'document');
  const trigger = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-products-trigger')
    : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-products-content')
    : undefined;
  const viewport = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-navigation-viewport')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="navigation-open"]')
    : undefined;
  if (trigger)
    Object(trigger)['setAttribute']?.call(
      trigger,
      'aria-expanded',
      String(ctx.state.openValue === 'products'),
    );
  if (content) content['hidden'] = ctx.state.openValue !== 'products';
  if (viewport) viewport['hidden'] = ctx.state.openValue === '';
  if (output) output['textContent'] = ctx.state.openValue || 'none';
});
export const GalleryNavigationMenuDemo$a_click = handler((event, ctx) => {
  ctx.state.openValue = '';
  ctx.state.value = 'docs';
  const doc = Reflect['get'](globalThis, 'document');
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="navigation-value"]')
    : undefined;
  if (event) Object(event)['preventDefault']?.call(event);
  if (output) output['textContent'] = 'docs';
});
