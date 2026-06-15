// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryTooltipDemo$button_blur = handler((event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const target = event ? Reflect['get'](event, 'target') : undefined;
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-tooltip]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
    Object(trigger)['removeAttribute']?.call(trigger, 'aria-describedby');
  }
  if (content) {
    Object(content)['hidePopover']?.call(content);
    content['hidden'] = true;
    Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});
export const GalleryTooltipDemo$button_focus = handler((event, ctx) => {
  ctx.state.open = true;
  const doc = Reflect['get'](globalThis, 'document');
  const target = event ? Reflect['get'](event, 'target') : undefined;
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-tooltip]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'open');
    Object(trigger)['setAttribute']?.call(trigger, 'aria-describedby', 'gallery-tooltip-content');
  }
  if (content) {
    content['hidden'] = false;
    Object(content)['setAttribute']?.call(content, 'data-state', 'open');
    Object(content)['showPopover']?.call(content);
  }
  if (output) output['textContent'] = 'open';
});
export const GalleryTooltipDemo$button_keydown = handler((event, ctx) => {
  if (!event || Reflect['get'](event, 'key') !== 'Escape') return;

  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const target = Reflect['get'](event, 'target');
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-tooltip]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
    Object(trigger)['removeAttribute']?.call(trigger, 'aria-describedby');
  }
  if (content) {
    Object(content)['hidePopover']?.call(content);
    content['hidden'] = true;
    Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});
export const GalleryTooltipDemo$button_pointerenter = handler((event, ctx) => {
  ctx.state.open = true;
  const doc = Reflect['get'](globalThis, 'document');
  const target = event ? Reflect['get'](event, 'target') : undefined;
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-tooltip]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'open');
    Object(trigger)['setAttribute']?.call(trigger, 'aria-describedby', 'gallery-tooltip-content');
  }
  if (content) {
    content['hidden'] = false;
    Object(content)['setAttribute']?.call(content, 'data-state', 'open');
    Object(content)['showPopover']?.call(content);
  }
  if (output) output['textContent'] = 'open';
});
export const GalleryTooltipDemo$button_pointerleave = handler((event, ctx) => {
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const target = event ? Reflect['get'](event, 'target') : undefined;
  const trigger = target ? Object(target)['closest']?.call(target, '[jiso-tooltip]') : undefined;
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
    : undefined;

  if (trigger) {
    Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
    Object(trigger)['removeAttribute']?.call(trigger, 'aria-describedby');
  }
  if (content) {
    Object(content)['hidePopover']?.call(content);
    content['hidden'] = true;
    Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
  }
  if (output) output['textContent'] = 'closed';
});

export const GalleryTooltipDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
