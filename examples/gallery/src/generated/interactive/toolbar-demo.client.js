// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryToolbarDemo$div_keydown = handler((event, ctx) => {
  ctx.state.activeValue = ctx.state.activeValue === 'bold' ? 'link' : 'bold';
  const doc = Reflect['get'](globalThis, 'document');
  const bold = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-bold') : undefined;
  const link = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-link') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-active"]')
    : undefined;

  if (bold) bold['tabIndex'] = ctx.state.activeValue === 'bold' ? 0 : -1;
  if (link) link['tabIndex'] = ctx.state.activeValue === 'link' ? 0 : -1;
  if (ctx.state.activeValue === 'bold' && bold) Object(bold)['focus']?.call(bold);
  if (ctx.state.activeValue === 'link' && link) Object(link)['focus']?.call(link);
  if (output) output['textContent'] = ctx.state.activeValue;
});
export const GalleryToolbarDemo$button_click = handler((event, ctx) => {
  ctx.state.activeValue = 'bold';
  ctx.state.pressedValue = ctx.state.pressedValue === 'bold' ? '' : 'bold';
  const doc = Reflect['get'](globalThis, 'document');
  const bold = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-bold') : undefined;
  const link = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-link') : undefined;
  const activeOutput = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-active"]')
    : undefined;
  const pressedOutput = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-pressed"]')
    : undefined;

  if (bold) {
    bold['tabIndex'] = 0;
    Object(bold)['setAttribute']?.call(
      bold,
      'aria-pressed',
      ctx.state.pressedValue === 'bold' ? 'true' : 'false',
    );
    Object(bold)['setAttribute']?.call(
      bold,
      'data-pressed',
      ctx.state.pressedValue === 'bold' ? 'true' : 'false',
    );
  }
  if (link) {
    link['tabIndex'] = -1;
    Object(link)['setAttribute']?.call(
      link,
      'aria-pressed',
      ctx.state.pressedValue === 'link' ? 'true' : 'false',
    );
    Object(link)['setAttribute']?.call(
      link,
      'data-pressed',
      ctx.state.pressedValue === 'link' ? 'true' : 'false',
    );
  }
  if (activeOutput) activeOutput['textContent'] = ctx.state.activeValue;
  if (pressedOutput) pressedOutput['textContent'] = ctx.state.pressedValue || 'none';
});
export const GalleryToolbarDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.activeValue = 'link';
  ctx.state.pressedValue = ctx.state.pressedValue === 'link' ? '' : 'link';
  const doc = Reflect['get'](globalThis, 'document');
  const bold = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-bold') : undefined;
  const link = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-toolbar-link') : undefined;
  const activeOutput = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-active"]')
    : undefined;
  const pressedOutput = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toolbar-pressed"]')
    : undefined;

  if (bold) {
    bold['tabIndex'] = -1;
    Object(bold)['setAttribute']?.call(
      bold,
      'aria-pressed',
      ctx.state.pressedValue === 'bold' ? 'true' : 'false',
    );
    Object(bold)['setAttribute']?.call(
      bold,
      'data-pressed',
      ctx.state.pressedValue === 'bold' ? 'true' : 'false',
    );
  }
  if (link) {
    link['tabIndex'] = 0;
    Object(link)['setAttribute']?.call(
      link,
      'aria-pressed',
      ctx.state.pressedValue === 'link' ? 'true' : 'false',
    );
    Object(link)['setAttribute']?.call(
      link,
      'data-pressed',
      ctx.state.pressedValue === 'link' ? 'true' : 'false',
    );
  }
  if (activeOutput) activeOutput['textContent'] = ctx.state.activeValue;
  if (pressedOutput) pressedOutput['textContent'] = ctx.state.pressedValue || 'none';
});
