// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryToggleGroupDemo$section_keydown = handler((event, ctx) => {
  ctx.state.activeValue = ctx.state.activeValue === 'bold' ? 'italic' : 'bold';
  const doc = Reflect['get'](globalThis, 'document');
  const bold = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-bold')
    : undefined;
  const italic = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-italic')
    : undefined;

  if (bold) bold['tabIndex'] = ctx.state.activeValue === 'bold' ? 0 : -1;
  if (italic) italic['tabIndex'] = ctx.state.activeValue === 'italic' ? 0 : -1;
});
export const GalleryToggleGroupDemo$button_click = handler((event, ctx) => {
  ctx.state.value =
    ctx.state.value === 'bold,italic'
      ? 'italic'
      : ctx.state.value === 'bold'
        ? ''
        : ctx.state.value === 'italic'
          ? 'bold,italic'
          : 'bold';
  const doc = Reflect['get'](globalThis, 'document');
  const bold = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-bold')
    : undefined;
  const italic = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-italic')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toggle-group-value"]')
    : undefined;
  const boldPressed = ctx.state.value === 'bold' || ctx.state.value === 'bold,italic';
  const italicPressed = ctx.state.value === 'italic' || ctx.state.value === 'bold,italic';

  if (bold) {
    Object(bold)['setAttribute']?.call(bold, 'aria-pressed', boldPressed ? 'true' : 'false');
    Object(bold)['setAttribute']?.call(bold, 'data-state', boldPressed ? 'pressed' : 'off');
  }
  if (italic) {
    Object(italic)['setAttribute']?.call(italic, 'aria-pressed', italicPressed ? 'true' : 'false');
    Object(italic)['setAttribute']?.call(italic, 'data-state', italicPressed ? 'pressed' : 'off');
  }
  if (output) output['textContent'] = ctx.state.value || 'none';
});
export const GalleryToggleGroupDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.value =
    ctx.state.value === 'bold,italic'
      ? 'bold'
      : ctx.state.value === 'italic'
        ? ''
        : ctx.state.value === 'bold'
          ? 'bold,italic'
          : 'italic';
  const doc = Reflect['get'](globalThis, 'document');
  const bold = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-bold')
    : undefined;
  const italic = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-toggle-group-italic')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="toggle-group-value"]')
    : undefined;
  const boldPressed = ctx.state.value === 'bold' || ctx.state.value === 'bold,italic';
  const italicPressed = ctx.state.value === 'italic' || ctx.state.value === 'bold,italic';

  if (bold) {
    Object(bold)['setAttribute']?.call(bold, 'aria-pressed', boldPressed ? 'true' : 'false');
    Object(bold)['setAttribute']?.call(bold, 'data-state', boldPressed ? 'pressed' : 'off');
  }
  if (italic) {
    Object(italic)['setAttribute']?.call(italic, 'aria-pressed', italicPressed ? 'true' : 'false');
    Object(italic)['setAttribute']?.call(italic, 'data-state', italicPressed ? 'pressed' : 'off');
  }
  if (output) output['textContent'] = ctx.state.value || 'none';
});
