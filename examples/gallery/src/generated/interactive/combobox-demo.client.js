// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryComboboxDemo$input_input = handler((event, ctx) => {
  ctx.state.open = true;
  ctx.state.highlightedValue = 'chicago';
  ctx.state.value = 'chicago';
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-input')
    : undefined;
  const listbox = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox')
    : undefined;
  const austin = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox-option-0')
    : undefined;
  const chicago = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox-option-2')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="combobox-value"]')
    : undefined;

  if (input) {
    input['value'] = 'chicago';
    Object(input)['setAttribute']?.call(input, 'aria-expanded', 'true');
    Object(input)['setAttribute']?.call(
      input,
      'aria-activedescendant',
      'gallery-combobox-listbox-option-2',
    );
  }
  if (listbox) {
    listbox['hidden'] = false;
    Object(listbox)['removeAttribute']?.call(listbox, 'hidden');
  }
  if (austin) Object(austin)['setAttribute']?.call(austin, 'aria-selected', 'false');
  if (chicago) {
    Object(chicago)['setAttribute']?.call(chicago, 'aria-selected', 'true');
    Object(chicago)['setAttribute']?.call(chicago, 'data-highlighted', '');
  }
  if (output) output['textContent'] = 'Chicago city';
});
export const GalleryComboboxDemo$input_keydown = handler((event, ctx) => {
  const delegatedEvent = event;
  const eventKey = delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'key');
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-input')
    : undefined;
  const listbox = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="combobox-value"]')
    : undefined;

  if (eventKey === 'Enter' && ctx.state.open && ctx.state.highlightedValue === 'chicago') {
    ctx.state.open = false;
    ctx.state.value = 'chicago';
    if (input) {
      input['value'] = 'chicago';
      Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
    }
    if (listbox) listbox['hidden'] = true;
    if (output) output['textContent'] = 'Chicago city';
  } else {
    ctx.state.open = !ctx.state.open;
  }
});
export const GalleryComboboxDemo$button_click = handler((event, ctx) => {
  ctx.state.open = false;
  ctx.state.highlightedValue = 'austin';
  ctx.state.value = 'austin';
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-input')
    : undefined;
  const listbox = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="combobox-value"]')
    : undefined;

  if (input) {
    input['value'] = 'austin';
    Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
  }
  if (listbox) listbox['hidden'] = true;
  if (output) output['textContent'] = 'Austin';
});
export const GalleryComboboxDemo$button_click_2 = handler((event, ctx) => {
  ctx.state.open = false;
  ctx.state.highlightedValue = 'chicago';
  ctx.state.value = 'chicago';
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-input')
    : undefined;
  const listbox = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-combobox-listbox')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="combobox-value"]')
    : undefined;

  if (input) {
    input['value'] = 'chicago';
    Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
  }
  if (listbox) listbox['hidden'] = true;
  if (output) output['textContent'] = 'Chicago city';
});
