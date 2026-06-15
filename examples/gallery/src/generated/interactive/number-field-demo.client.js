// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryNumberFieldDemo$button_click = handler((_event, ctx) => {
  ctx.state.value = ctx.state.value <= 0 ? 0 : ctx.state.value - 1;
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-number-field-input')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="value"]')
    : undefined;

  if (input) input['value'] = String(ctx.state.value);
  if (output) output['textContent'] = String(ctx.state.value);
});
export const GalleryNumberFieldDemo$input_input = handler((event, ctx) => {
  const delegatedEvent = event;
  const eventTarget =
    delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'target');
  const eventValue =
    eventTarget === null || eventTarget === undefined
      ? ctx.state.value
      : +Reflect['get'](Object(eventTarget), 'value');
  const nextValue = eventValue === eventValue ? eventValue : ctx.state.value;
  ctx.state.value = nextValue <= 0 ? 0 : nextValue >= 5 ? 5 : nextValue;

  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-number-field-input')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="value"]')
    : undefined;

  if (input) input['value'] = String(ctx.state.value);
  if (output) output['textContent'] = String(ctx.state.value);
});
export const GalleryNumberFieldDemo$button_click_2 = handler((_event, ctx) => {
  ctx.state.value = ctx.state.value >= 5 ? 5 : ctx.state.value + 1;
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-number-field-input')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="value"]')
    : undefined;

  if (input) input['value'] = String(ctx.state.value);
  if (output) output['textContent'] = String(ctx.state.value);
});

export const GalleryNumberFieldDemo$output_text_derive = derive(['state'], (state) =>
  String(state.value),
);
