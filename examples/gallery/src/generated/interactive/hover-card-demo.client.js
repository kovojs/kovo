// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryHoverCardDemo$a_blur = handler((event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const target = event ? Reflect['get'](event, 'target') : undefined;
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-hover-card]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
    Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'false');
  }
  if (content) {
    Object(content)['hidePopover']?.call(content);
    content['hidden'] = true;
    Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});
export const GalleryHoverCardDemo$a_focus = handler((event, ctx) => {
  ctx.state.open = true;
  const doc = Reflect['get'](globalThis, 'document');
  const target = event ? Reflect['get'](event, 'target') : undefined;
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-hover-card]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'open');
    Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'true');
  }
  if (content) {
    content['hidden'] = false;
    Object(content)['setAttribute']?.call(content, 'data-state', 'open');
    Object(content)['showPopover']?.call(content);
  }
  if (output) output['textContent'] = 'open';
});
export const GalleryHoverCardDemo$a_keydown = handler((event, ctx) => {
  if (!event || Reflect['get'](event, 'key') !== 'Escape') return;

  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const target = Reflect['get'](event, 'target');
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-hover-card]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
    Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'false');
  }
  if (content) {
    Object(content)['hidePopover']?.call(content);
    content['hidden'] = true;
    Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});
export const GalleryHoverCardDemo$a_pointerenter = handler((event, ctx) => {
  ctx.state.open = true;
  const doc = Reflect['get'](globalThis, 'document');
  const target = event ? Reflect['get'](event, 'target') : undefined;
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-hover-card]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'open');
    Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'true');
  }
  if (content) {
    content['hidden'] = false;
    Object(content)['setAttribute']?.call(content, 'data-state', 'open');
    Object(content)['showPopover']?.call(content);
  }
  if (output) output['textContent'] = 'open';
});
export const GalleryHoverCardDemo$a_pointerleave = handler((event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const target = event ? Reflect['get'](event, 'target') : undefined;
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-hover-card]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
    Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'false');
  }
  if (content) {
    Object(content)['hidePopover']?.call(content);
    content['hidden'] = true;
    Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});
