// @jiso-ir
import { handler } from '@jiso/runtime';

export const GallerySliderDemo$input_input = handler((event, ctx) => {
  const doc = Reflect['get'](globalThis, 'document');
  const delegatedEvent = event;
  const eventTarget =
    delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'target');
  const eventValue =
    eventTarget === null || eventTarget === undefined
      ? ctx.state.value
      : +Reflect['get'](Object(eventTarget), 'value');
  const nextValue = eventValue === eventValue ? eventValue : ctx.state.value;
  ctx.state.value =
    nextValue <= 12.5
      ? 0
      : nextValue <= 37.5
        ? 25
        : nextValue <= 62.5
          ? 50
          : nextValue <= 87.5
            ? 75
            : 100;
  const root = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-gallery-interactive="slider"]')
    : undefined;
  const input = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-slider-input') : undefined;
  const track = doc ? Object(doc)['querySelector']?.call(doc, '[data-part="track"]') : undefined;
  const range = doc ? Object(doc)['querySelector']?.call(doc, '[data-part="range"]') : undefined;
  const thumb = doc ? Object(doc)['querySelector']?.call(doc, '[data-part="thumb"]') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="slider-value"]')
    : undefined;
  const ratio = String(ctx.state.value / 100);

  if (root) Object(root)['setAttribute']?.call(root, 'data-value', String(ctx.state.value));
  if (input) {
    input['value'] = String(ctx.state.value);
    Object(input)['setAttribute']?.call(input, 'aria-valuetext', `${ctx.state.value} percent`);
    Object(input)['setAttribute']?.call(input, 'data-value', String(ctx.state.value));
  }
  if (track) {
    Object(track)['setAttribute']?.call(track, 'data-value', String(ctx.state.value));
    Object(track)['setAttribute']?.call(track, 'data-value-ratio', ratio);
  }
  if (range) {
    Object(range)['setAttribute']?.call(range, 'data-value', String(ctx.state.value));
    Object(range)['setAttribute']?.call(range, 'data-value-ratio', ratio);
  }
  if (thumb) {
    Object(thumb)['setAttribute']?.call(thumb, 'data-value', String(ctx.state.value));
    Object(thumb)['setAttribute']?.call(thumb, 'data-value-ratio', ratio);
  }
  if (output) output['textContent'] = String(ctx.state.value);
});
