// @jiso-ir
import { derive, handler } from '@jiso/runtime';

export const GalleryMeterDemo$button_click = handler((_event, ctx) => {
  ctx.state.value = ctx.state.value === 92 ? 72 : 92;
  const doc = Reflect['get'](globalThis, 'document');
  const meter = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-meter-value') : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="meter-value"]')
    : undefined;

  if (meter) {
    meter['value'] = ctx.state.value;
    Object(meter)['setAttribute']?.call(meter, 'value', String(ctx.state.value));
    Object(meter)['setAttribute']?.call(meter, 'data-value', String(ctx.state.value));
    Object(meter)['setAttribute']?.call(
      meter,
      'data-state',
      ctx.state.value === 92 ? 'optimum' : 'suboptimum',
    );
    Object(meter)['setAttribute']?.call(
      meter,
      'aria-valuetext',
      `${ctx.state.value} percent capacity`,
    );
  }
  if (output) output['textContent'] = String(ctx.state.value);
});

export const GalleryMeterDemo$output_text_derive = derive(['state'], (state) =>
  String(state.value),
);
