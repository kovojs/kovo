// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryDropdownMenuDemo$button_click = handler((event, ctx) => {
  ctx.state.open = !ctx.state.open;
  const doc = Reflect['get'](globalThis, 'document');
  const trigger = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-trigger')
    : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-open"]')
    : undefined;

  if (trigger)
    Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', String(ctx.state.open));
  if (content) content['hidden'] = !ctx.state.open;
  if (output) output['textContent'] = ctx.state.open ? 'open' : 'closed';
});
export const GalleryDropdownMenuDemo$div_keydown = handler((event, ctx) => {
  if (event && (Object(event)['defaultPrevented'] || Object(event)['key'] !== 'Escape')) return;

  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const trigger = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-trigger')
    : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-open"]')
    : undefined;

  if (trigger) Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'false');
  if (content) content['hidden'] = true;
  if (output) output['textContent'] = 'closed';
});
export const GalleryDropdownMenuDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
  ctx.state.highlightedValue = 'duplicate';
  ctx.state.value = 'duplicate';
  const doc = Reflect['get'](globalThis, 'document');
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-value"]')
    : undefined;
  if (content) content['hidden'] = true;
  if (output) output['textContent'] = 'duplicate';
});
export const GalleryDropdownMenuDemo$button_keydown = handler((event, ctx) => {
  if (
    event &&
    Object(event)['key'] !== 'Enter' &&
    Object(event)['key'] !== ' ' &&
    Object(event)['key'] !== 'Spacebar'
  )
    return;

  if (event) Object(event)['preventDefault']?.call(event);
  ctx.state.open = false;
  ctx.state.highlightedValue = 'rename';
  ctx.state.value = 'rename';
  const doc = Reflect['get'](globalThis, 'document');
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
    : undefined;
  const item = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-rename')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-value"]')
    : undefined;
  if (content) content['hidden'] = true;
  if (item) Object(item)['setAttribute']?.call(item, 'data-highlighted', '');
  if (output) output['textContent'] = 'rename';
});
export const GalleryDropdownMenuDemo$button_click_3 = handler((event, ctx) => {
  ctx.state.open = false;
  ctx.state.highlightedValue = 'rename';
  ctx.state.value = 'rename';
  const doc = Reflect['get'](globalThis, 'document');
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
    : undefined;
  const item = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-rename')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-value"]')
    : undefined;
  if (content) content['hidden'] = true;
  if (item) Object(item)['setAttribute']?.call(item, 'data-highlighted', '');
  if (output) output['textContent'] = 'rename';
});
