// @jiso-ir
import { handler } from '@jiso/runtime';

export const GallerySelectDemo$select_change = handler((event, ctx) => {
  const delegatedEvent = event;
  const target =
    delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'target');
  const nextValue =
    target === null || target === undefined
      ? ctx.state.value
      : String(Reflect['get'](Object(target), 'value'));
  const doc = Reflect['get'](globalThis, 'document');
  const select = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-select-control')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="select-value"]')
    : undefined;

  if (nextValue === 'drone' || nextValue === ctx.state.value) {
    if (select) select['value'] = ctx.state.value;
    if (delegatedEvent !== undefined) {
      Reflect['apply'](Reflect['get'](delegatedEvent, 'preventDefault'), delegatedEvent, []);
    }
    return;
  }

  ctx.state.value = nextValue === 'express' ? 'express' : 'standard';
  if (select) select['value'] = ctx.state.value;
  if (output) output['textContent'] = ctx.state.value === 'express' ? 'Express' : 'Standard';
});
