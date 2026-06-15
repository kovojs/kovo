// @jiso-ir
import { handler } from '@jiso/runtime';

export const GalleryAutocompleteDemo$input_input = handler((_event, ctx) => {
  ctx.state.inputValue = 'dev';
  ctx.state.highlightedValue = 'development';
  ctx.state.open = true;
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-autocomplete-input')
    : undefined;
  const development = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-autocomplete-list-option-0')
    : undefined;

  if (input) {
    input['value'] = 'dev';
    Object(input)['setAttribute']?.call(input, 'aria-expanded', 'true');
    Object(input)['setAttribute']?.call(
      input,
      'aria-activedescendant',
      'gallery-autocomplete-list-option-0',
    );
  }
  if (development) {
    development['value'] = 'development';
    Object(development)['setAttribute']?.call(development, 'data-highlighted', '');
  }
});
export const GalleryAutocompleteDemo$input_keydown = handler((event, ctx) => {
  const delegatedEvent = event;
  const eventKey = delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'key');
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-autocomplete-input')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="autocomplete-value"]')
    : undefined;

  if (eventKey === 'Enter' && ctx.state.open && ctx.state.highlightedValue === 'development') {
    ctx.state.inputValue = 'development';
    ctx.state.open = false;
    ctx.state.value = 'development';
    if (input) {
      input['value'] = 'development';
      Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
    }
    if (output) output['textContent'] = 'Development';
  } else {
    ctx.state.open = !ctx.state.open;
  }
});
export const GalleryAutocompleteDemo$option_click = handler((_event, ctx) => {
  ctx.state.inputValue = 'development';
  ctx.state.open = false;
  ctx.state.highlightedValue = 'development';
  ctx.state.value = 'development';
  const doc = Reflect['get'](globalThis, 'document');
  const input = doc
    ? Object(doc)['getElementById']?.call(doc, 'gallery-autocomplete-input')
    : undefined;
  const output = doc
    ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="autocomplete-value"]')
    : undefined;

  if (input) {
    input['value'] = 'development';
    Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
  }
  if (output) output['textContent'] = 'Development';
});
