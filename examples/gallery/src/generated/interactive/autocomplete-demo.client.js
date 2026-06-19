// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  autocompleteInput as _autocompleteInput,
  autocompleteKeyDown as _autocompleteKeyDown,
  autocompleteOptionClick as _autocompleteOptionClick,
  autocompleteSuggestions as _autocompleteSuggestions,
} from '@kovojs/ui/autocomplete';

export const GalleryAutocompleteDemo$AutocompleteInput_input = handler((event, ctx) => {
  const result = _autocompleteInput(Object(event), {
    inputValue: ctx.state.inputValue,
    value: ctx.state.value,
  });
  if (!result) return;
  ctx.state.inputValue = result.inputValue;
  ctx.state.open = true;
  ctx.state.highlightedValue =
    _autocompleteSuggestions({
      inputValue: ctx.state.inputValue,
      items: [
        {
          id: 'gallery-autocomplete-list-option-0',
          label: 'Design',
          value: 'design',
        },
        {
          disabled: true,
          id: 'gallery-autocomplete-list-option-1',
          label: 'Deprecated',
          value: 'deprecated',
        },
        {
          id: 'gallery-autocomplete-list-option-2',
          textValue: 'Development',
          value: 'development',
        },
      ],
    })[0]?.value ?? '';
});
export const GalleryAutocompleteDemo$AutocompleteInput_keydown = handler((event, ctx) => {
  const result = _autocompleteKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    inputValue: ctx.state.inputValue,
    items: [
      {
        id: 'gallery-autocomplete-list-option-0',
        label: 'Design',
        value: 'design',
      },
      {
        disabled: true,
        id: 'gallery-autocomplete-list-option-1',
        label: 'Deprecated',
        value: 'deprecated',
      },
      {
        id: 'gallery-autocomplete-list-option-2',
        textValue: 'Development',
        value: 'development',
      },
    ],
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;

  if ('value' in result) {
    if (result.value.changed) {
      ctx.state.inputValue = result.inputValue.inputValue;
      ctx.state.open = result.open.open;
      ctx.state.value = result.value.value ?? ctx.state.value;
      ctx.state.highlightedValue = ctx.state.value;
    }
  } else if ('highlightedValue' in result) {
    ctx.state.highlightedValue = result.highlightedValue ?? '';
  } else {
    ctx.state.open = result.open;
    if (Object(event)['key'] === 'Escape') {
      ctx.state.inputValue = ctx.state.value;
      ctx.state.highlightedValue = ctx.state.value;
    }
  }
});
export const GalleryAutocompleteDemo$AutocompleteOption_click = handler((event, ctx) => {
  const result = _autocompleteOptionClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    inputValue: ctx.state.inputValue,
    items: [
      {
        id: 'gallery-autocomplete-list-option-0',
        label: 'Design',
        value: 'design',
      },
      {
        disabled: true,
        id: 'gallery-autocomplete-list-option-1',
        label: 'Deprecated',
        value: 'deprecated',
      },
      {
        id: 'gallery-autocomplete-list-option-2',
        textValue: 'Development',
        value: 'development',
      },
    ],
    itemValue: 'design',
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;
  if (result.value.changed) {
    ctx.state.inputValue = result.inputValue.inputValue;
    ctx.state.open = result.open.open;
    ctx.state.value = result.value.value ?? ctx.state.value;
    ctx.state.highlightedValue = ctx.state.value;
  }
});
export const GalleryAutocompleteDemo$AutocompleteOption_click_2 = handler((event, ctx) => {
  const result = _autocompleteOptionClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    inputValue: ctx.state.inputValue,
    items: [
      {
        id: 'gallery-autocomplete-list-option-0',
        label: 'Design',
        value: 'design',
      },
      {
        disabled: true,
        id: 'gallery-autocomplete-list-option-1',
        label: 'Deprecated',
        value: 'deprecated',
      },
      {
        id: 'gallery-autocomplete-list-option-2',
        textValue: 'Development',
        value: 'development',
      },
    ],
    itemValue: 'development',
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;
  if (result.value.changed) {
    ctx.state.inputValue = result.inputValue.inputValue;
    ctx.state.open = result.open.open;
    ctx.state.value = result.value.value ?? ctx.state.value;
    ctx.state.highlightedValue = ctx.state.value;
  }
});

export const GalleryAutocompleteDemo$Autocomplete_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAutocompleteDemo$AutocompleteInput_aria_activedescendant_derive = derive(
  ['state'],
  (state) =>
    state.highlightedValue === 'development'
      ? 'gallery-autocomplete-list-option-2'
      : state.highlightedValue === 'deprecated'
        ? 'gallery-autocomplete-list-option-1'
        : state.highlightedValue === 'design'
          ? 'gallery-autocomplete-list-option-0'
          : null,
);
export const GalleryAutocompleteDemo$AutocompleteInput_aria_expanded_derive = derive(
  ['state'],
  (state) => (state.open ? 'true' : 'false'),
);
export const GalleryAutocompleteDemo$AutocompleteInput_data_placeholder_derive = derive(
  ['state'],
  (state) => (state.inputValue === '' ? '' : null),
);
export const GalleryAutocompleteDemo$AutocompleteInput_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryAutocompleteDemo$AutocompleteInput_value_derive = derive(
  ['state'],
  (state) => state.inputValue,
);
export const GalleryAutocompleteDemo$AutocompleteList_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryAutocompleteDemo$AutocompleteList_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
export const GalleryAutocompleteDemo$AutocompleteOption_aria_selected_derive = derive(
  ['state'],
  (state) => (state.value === 'design' ? 'true' : 'false'),
);
export const GalleryAutocompleteDemo$AutocompleteOption_data_highlighted_derive = derive(
  ['state'],
  (state) => (state.highlightedValue === 'design' ? '' : null),
);
export const GalleryAutocompleteDemo$AutocompleteOption_data_state_derive = derive(
  ['state'],
  (state) => (state.value === 'design' ? 'checked' : 'unchecked'),
);
export const GalleryAutocompleteDemo$AutocompleteOption_hidden_derive = derive(['state'], (state) =>
  state.inputValue !== '' && !'design'.startsWith(state.inputValue.toLocaleLowerCase()) ? '' : null,
);
export const GalleryAutocompleteDemo$AutocompleteOption_tabIndex_derive = derive(
  ['state'],
  (state) => (state.highlightedValue === 'design' ? 0 : -1),
);
export const GalleryAutocompleteDemo$AutocompleteOption_aria_selected_derive_2 = derive(
  ['state'],
  (state) => (state.value === 'development' ? 'true' : 'false'),
);
export const GalleryAutocompleteDemo$AutocompleteOption_data_highlighted_derive_2 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'development' ? '' : null),
);
export const GalleryAutocompleteDemo$AutocompleteOption_data_state_derive_2 = derive(
  ['state'],
  (state) => (state.value === 'development' ? 'checked' : 'unchecked'),
);
export const GalleryAutocompleteDemo$AutocompleteOption_hidden_derive_2 = derive(
  ['state'],
  (state) =>
    state.inputValue !== '' && !'development'.startsWith(state.inputValue.toLocaleLowerCase())
      ? ''
      : null,
);
export const GalleryAutocompleteDemo$AutocompleteOption_tabIndex_derive_2 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'development' ? 0 : -1),
);
