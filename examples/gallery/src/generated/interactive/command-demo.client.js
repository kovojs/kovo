// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryCommandDemo$button_click = handler((event, ctx) => {
  ctx.state.open = true;
});
export const GalleryCommandDemo$input_input = handler((event, ctx) => {
  ctx.state.open = true;
  ctx.state.inputValue = 'invite';
  ctx.state.highlightedValue = 'invite';
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc ? Object(doc)['getElementById']?.call(doc, 'gallery-command-input') : undefined;
  const invite = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-command-listbox-item-1')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="command-input"]')
    : undefined;
  if (input) {
    input['value'] = 'invite';
    Object(input)['setAttribute']?.call(
      input,
      'aria-activedescendant',
      'gallery-command-listbox-item-1',
    );
  }
  if (invite) Object(invite)['setAttribute']?.call(invite, 'aria-selected', 'true');
  if (output) output['textContent'] = 'invite';
});
export const GalleryCommandDemo$input_keydown = handler((event, ctx) => {
  if (event && Object(event)['key'] !== 'Enter') return;
  if (event) Object(event)['preventDefault']?.call(event);
  const doc = Reflect['get'](globalThis, 'document');
  const dialog = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-command-dialog')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="command-value"]')
    : undefined;
  const canceled = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="command-key-canceled"]')
    : undefined;
  if (ctx.state.value === 'dashboard') {
    ctx.state.lastKeyAction = 'canceled';
    if (canceled) canceled['textContent'] = 'canceled';
    if (output) output['textContent'] = 'Open dashboard';
  } else {
    ctx.state.open = false;
    ctx.state.value = ctx.state.highlightedValue;
    ctx.state.lastKeyAction = 'selected';
    if (dialog) Object(dialog)['close']?.call(dialog);
    if (output) {
      if (ctx.state.value === 'invite') {
        output['textContent'] = 'Invite teammate';
      } else {
        output['textContent'] = 'Open dashboard';
      }
    }
    if (canceled) canceled['textContent'] = 'selected';
  }
});
export const GalleryCommandDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
  ctx.state.value = 'invite';
  const doc = Reflect['get'](globalThis, 'document');
  const dialog = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-command-dialog')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="command-value"]')
    : undefined;
  if (dialog) Object(dialog)['close']?.call(dialog);
  if (output) output['textContent'] = 'Invite teammate';
});
export const GalleryCommandDemo$button_click_3 = handler((event, ctx) => {
  ctx.state.open = false;
});
