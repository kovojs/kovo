// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryContextMenuDemo$div_contextmenu = handler((event, ctx) => {
  ctx.state.open = true;
  const doc = Reflect['get'](globalThis, 'document');
  const trigger = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-trigger')
    : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="context-open"]')
    : undefined;

  if (event) Object(event)['preventDefault']?.call(event);
  if (trigger) Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'true');
  if (content) content['hidden'] = false;
  if (output) output['textContent'] = 'open';
});
export const GalleryContextMenuDemo$div_keydown = handler((event, ctx) => {
  if (
    event &&
    Object(event)['key'] !== 'ContextMenu' &&
    !(Object(event)['shiftKey'] === true && Object(event)['key'] === 'F10')
  )
    return;

  ctx.state.open = true;
  const doc = Reflect['get'](globalThis, 'document');
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-content')
    : undefined;
  if (content) content['hidden'] = false;
});
export const GalleryContextMenuDemo$button_keydown = handler((event, ctx) => {
  if (
    event &&
    Object(event)['key'] !== 'Enter' &&
    Object(event)['key'] !== ' ' &&
    Object(event)['key'] !== 'Spacebar'
  )
    return;

  if (event) Object(event)['preventDefault']?.call(event);
  ctx.state.open = false;
  ctx.state.highlightedValue = 'inspect';
  ctx.state.value = 'inspect';
  const doc = Reflect['get'](globalThis, 'document');
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="context-value"]')
    : undefined;
  if (content) content['hidden'] = true;
  if (output) output['textContent'] = 'inspect';
});
export const GalleryContextMenuDemo$button_click = handler((event, ctx) => {
  ctx.state.open = false;
  ctx.state.highlightedValue = 'inspect';
  ctx.state.value = 'inspect';
  const doc = Reflect['get'](globalThis, 'document');
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="context-value"]')
    : undefined;
  if (content) content['hidden'] = true;
  if (output) output['textContent'] = 'inspect';
});
