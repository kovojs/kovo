// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryPopoverDemo$section_keydown = handler((event, ctx) => {
  if (!event || Reflect['get'](event, 'key') !== 'Escape') return;
  ctx.state.open = false;
  const doc = Reflect['get'](globalThis, 'document');
  const content = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-popover-content')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="popover-open"]')
    : undefined;

  if (content) Object(content)['hidePopover']?.call(content);
  if (output) output['textContent'] = 'closed';
});
export const GalleryPopoverDemo$button_click = handler((event, ctx) => {
  ctx.state.open = !ctx.state.open;
  const doc = Reflect['get'](globalThis, 'document');
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="popover-open"]')
    : undefined;

  if (output) output['textContent'] = ctx.state.open ? 'open' : 'closed';
});

export const GalleryPopoverDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
