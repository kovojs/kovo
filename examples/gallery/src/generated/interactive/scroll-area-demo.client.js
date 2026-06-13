// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryScrollAreaDemo$button_click = handler((event, ctx) => {
  ctx.state.position = ctx.state.position === 'top' ? 'end' : 'top';
  const nextAtEnd = ctx.state.position === 'end';
  const doc = Reflect['get'](globalThis, 'document');
  const viewport = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-scroll-area-viewport')
    : undefined;
  const thumb = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-scroll-area-thumb')
    : undefined;
  const button = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-scroll-area-toggle')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="scroll-area-position"]')
    : undefined;
  const scrollTop = ctx.state.position === 'end' ? 160 : 0;

  if (viewport) {
    viewport['scrollTop'] = scrollTop;
    Object(viewport)['setAttribute']?.call(viewport, 'data-scroll-position', ctx.state.position);
  }
  if (thumb) {
    Object(thumb)['setAttribute']?.call(thumb, 'data-scroll-position', ctx.state.position);
  }
  if (button) {
    Object(button)['setAttribute']?.call(button, 'aria-pressed', String(nextAtEnd));
    button['textContent'] = nextAtEnd ? 'Back to top' : 'Jump to end';
  }
  if (output) output['textContent'] = ctx.state.position;
});
