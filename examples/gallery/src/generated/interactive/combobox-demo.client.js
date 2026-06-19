// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  comboboxFilteredItems as _comboboxFilteredItems,
  comboboxInput as _comboboxInput,
  comboboxKeyDown as _comboboxKeyDown,
  comboboxOptionClick as _comboboxOptionClick,
} from '@kovojs/ui/combobox';

export const GalleryComboboxDemo$ComboboxInput_input = handler((event, ctx) => {
  const result = _comboboxInput(Object(event), { value: ctx.state.inputValue });
  if (!result) return;
  ctx.state.inputValue = result.value ?? '';
  ctx.state.open = true;
  const filteredItems = _comboboxFilteredItems({
    items: [
      {
        id: 'gallery-combobox-listbox-option-0',
        label: 'Austin',
        value: 'austin',
      },
      {
        disabled: true,
        id: 'gallery-combobox-listbox-option-1',
        label: 'Boston',
        value: 'boston',
      },
      {
        id: 'gallery-combobox-listbox-option-2',
        textValue: 'Chicago city',
        value: 'chicago',
      },
    ],
    value: ctx.state.inputValue,
  });
  ctx.state.highlightedValue =
    filteredItems[0]?.disabled === true ? '' : (filteredItems[0]?.value ?? '');
});
export const GalleryComboboxDemo$ComboboxInput_keydown = handler((event, ctx) => {
  const result = _comboboxKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: _comboboxFilteredItems({
      items: [
        {
          id: 'gallery-combobox-listbox-option-0',
          label: 'Austin',
          value: 'austin',
        },
        {
          disabled: true,
          id: 'gallery-combobox-listbox-option-1',
          label: 'Boston',
          value: 'boston',
        },
        {
          id: 'gallery-combobox-listbox-option-2',
          textValue: 'Chicago city',
          value: 'chicago',
        },
      ],
      value: ctx.state.inputValue,
    }),
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;

  if ('value' in result) {
    if (result.value.changed) {
      ctx.state.open = result.open.open;
      ctx.state.value = result.value.value ?? ctx.state.value;
      ctx.state.inputValue = ctx.state.value;
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
export const GalleryComboboxDemo$ComboboxOption_click = handler((event, ctx) => {
  const result = _comboboxOptionClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      {
        id: 'gallery-combobox-listbox-option-0',
        label: 'Austin',
        value: 'austin',
      },
      {
        disabled: true,
        id: 'gallery-combobox-listbox-option-1',
        label: 'Boston',
        value: 'boston',
      },
      {
        id: 'gallery-combobox-listbox-option-2',
        textValue: 'Chicago city',
        value: 'chicago',
      },
    ],
    itemValue: 'austin',
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;
  if (result.value.changed) {
    ctx.state.open = result.open.open;
    ctx.state.value = result.value.value ?? ctx.state.value;
    ctx.state.inputValue = ctx.state.value;
    ctx.state.highlightedValue = ctx.state.value;
  }
});
export const GalleryComboboxDemo$ComboboxOption_click_2 = handler((event, ctx) => {
  const result = _comboboxOptionClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      {
        id: 'gallery-combobox-listbox-option-0',
        label: 'Austin',
        value: 'austin',
      },
      {
        disabled: true,
        id: 'gallery-combobox-listbox-option-1',
        label: 'Boston',
        value: 'boston',
      },
      {
        id: 'gallery-combobox-listbox-option-2',
        textValue: 'Chicago city',
        value: 'chicago',
      },
    ],
    itemValue: 'chicago',
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;
  if (result.value.changed) {
    ctx.state.open = result.open.open;
    ctx.state.value = result.value.value ?? ctx.state.value;
    ctx.state.inputValue = ctx.state.value;
    ctx.state.highlightedValue = ctx.state.value;
  }
});

export const GalleryComboboxDemo$Combobox_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryComboboxDemo$ComboboxInput_aria_activedescendant_derive = derive(
  ['state'],
  (state) =>
    state.highlightedValue === 'chicago'
      ? 'gallery-combobox-listbox-option-2'
      : state.highlightedValue === 'boston'
        ? 'gallery-combobox-listbox-option-1'
        : state.highlightedValue === 'austin'
          ? 'gallery-combobox-listbox-option-0'
          : null,
);
export const GalleryComboboxDemo$ComboboxInput_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GalleryComboboxDemo$ComboboxInput_data_placeholder_derive = derive(
  ['state'],
  (state) => (state.inputValue === '' ? '' : null),
);
export const GalleryComboboxDemo$ComboboxInput_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryComboboxDemo$ComboboxInput_value_derive = derive(
  ['state'],
  (state) => state.inputValue,
);
export const GalleryComboboxDemo$ComboboxListbox_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryComboboxDemo$ComboboxListbox_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
export const GalleryComboboxDemo$ComboboxOption_aria_selected_derive = derive(['state'], (state) =>
  state.value === 'austin' ? 'true' : 'false',
);
export const GalleryComboboxDemo$ComboboxOption_data_highlighted_derive = derive(
  ['state'],
  (state) => (state.highlightedValue === 'austin' ? '' : null),
);
export const GalleryComboboxDemo$ComboboxOption_data_state_derive = derive(['state'], (state) =>
  state.value === 'austin' ? 'checked' : 'unchecked',
);
export const GalleryComboboxDemo$ComboboxOption_hidden_derive = derive(['state'], (state) =>
  state.inputValue !== '' && !'austin austin'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$ComboboxOption_tabIndex_derive = derive(['state'], (state) =>
  state.highlightedValue === 'austin' ? 0 : -1,
);
export const GalleryComboboxDemo$ComboboxOption_aria_selected_derive_2 = derive(
  ['state'],
  (state) => (state.value === 'boston' ? 'true' : 'false'),
);
export const GalleryComboboxDemo$ComboboxOption_data_highlighted_derive_2 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'boston' ? '' : null),
);
export const GalleryComboboxDemo$ComboboxOption_data_state_derive_2 = derive(['state'], (state) =>
  state.value === 'boston' ? 'checked' : 'unchecked',
);
export const GalleryComboboxDemo$ComboboxOption_hidden_derive_2 = derive(['state'], (state) =>
  state.inputValue !== '' && !'boston boston'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$ComboboxOption_aria_selected_derive_3 = derive(
  ['state'],
  (state) => (state.value === 'chicago' ? 'true' : 'false'),
);
export const GalleryComboboxDemo$ComboboxOption_data_highlighted_derive_3 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'chicago' ? '' : null),
);
export const GalleryComboboxDemo$ComboboxOption_data_state_derive_3 = derive(['state'], (state) =>
  state.value === 'chicago' ? 'checked' : 'unchecked',
);
export const GalleryComboboxDemo$ComboboxOption_hidden_derive_3 = derive(['state'], (state) =>
  state.inputValue !== '' && !'chicago city chicago'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$ComboboxOption_tabIndex_derive_2 = derive(['state'], (state) =>
  state.highlightedValue === 'chicago' ? 0 : -1,
);
