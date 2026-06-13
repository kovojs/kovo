// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryProgressDemo$button_click = handler((event, ctx) => {
  ctx.state.value = ctx.state.value === 100 ? 40 : 100;
  const doc = Reflect['get'](globalThis, 'document');
  const progress = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-progress-value')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="progress-value"]')
    : undefined;
  const text = `${ctx.state.value} percent uploaded`;

  if (progress) {
    progress['value'] = ctx.state.value;
    Object(progress)['setAttribute']?.call(progress, 'value', String(ctx.state.value));
    Object(progress)['setAttribute']?.call(progress, 'data-value', String(ctx.state.value));
    Object(progress)['setAttribute']?.call(
      progress,
      'data-state',
      ctx.state.value === 100 ? 'complete' : 'loading',
    );
    Object(progress)['setAttribute']?.call(progress, 'aria-valuetext', text);
  }
  if (output) output['textContent'] = `${ctx.state.value}%`;
});
export const GalleryProgressDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.value = null;
  const doc = Reflect['get'](globalThis, 'document');
  const progress = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-progress-value')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="progress-value"]')
    : undefined;

  if (progress) {
    Object(progress)['removeAttribute']?.call(progress, 'value');
    Object(progress)['removeAttribute']?.call(progress, 'data-value');
    Object(progress)['setAttribute']?.call(progress, 'data-state', 'indeterminate');
    Object(progress)['setAttribute']?.call(progress, 'aria-valuetext', 'Upload pending');
  }
  if (output) output['textContent'] = 'pending';
});
