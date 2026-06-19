// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  commandCloseClick as _commandCloseClick,
  commandFilteredItems as _commandFilteredItems,
  commandInput as _commandInput,
  commandItemClick as _commandItemClick,
  commandKeyDown as _commandKeyDown,
  commandTriggerClick as _commandTriggerClick,
} from '@kovojs/headless-ui/command';

export const GalleryCommandDemo$CommandTrigger_click = handler((event, ctx) => {
  const result = _commandTriggerClick(Object(event), { open: ctx.state.open });
  if (result) ctx.state.open = result.open;
});
export const GalleryCommandDemo$CommandInput_input = handler((event, ctx) => {
  const result = _commandInput(Object(event), { inputValue: ctx.state.inputValue });
  if (!result) return;
  ctx.state.inputValue = result.inputValue;
  ctx.state.open = true;
  const filteredItems = _commandFilteredItems({
    inputValue: ctx.state.inputValue,
    items: [
      {
        id: 'gallery-command-listbox-item-0',
        label: 'Open dashboard',
        value: 'dashboard',
      },
      {
        id: 'gallery-command-listbox-item-1',
        label: 'Invite teammate',
        value: 'invite',
      },
      {
        disabled: true,
        id: 'gallery-command-listbox-item-2',
        label: 'Delete project',
        value: 'delete',
      },
    ],
  });
  ctx.state.highlightedValue =
    filteredItems[0]?.disabled === true ? '' : (filteredItems[0]?.value ?? '');
});
export const GalleryCommandDemo$CommandInput_keydown = handler((event, ctx) => {
  const result = _commandKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    inputValue: ctx.state.inputValue,
    items: [
      {
        id: 'gallery-command-listbox-item-0',
        label: 'Open dashboard',
        value: 'dashboard',
      },
      {
        id: 'gallery-command-listbox-item-1',
        label: 'Invite teammate',
        value: 'invite',
      },
      {
        disabled: true,
        id: 'gallery-command-listbox-item-2',
        label: 'Delete project',
        value: 'delete',
      },
    ],
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;

  if ('selected' in result) {
    if (result.selected) {
      ctx.state.open = result.open.open;
      ctx.state.value = result.value.value ?? ctx.state.value;
      ctx.state.lastKeyAction = 'selected';
    } else {
      ctx.state.lastKeyAction = 'canceled';
    }
  } else if ('highlightedValue' in result) {
    ctx.state.highlightedValue = result.highlightedValue ?? '';
    ctx.state.lastKeyAction = 'moved';
  } else {
    ctx.state.open = result.open;
    ctx.state.lastKeyAction = Object(event)['key'] === 'Escape' ? 'closed' : 'idle';
  }
});
export const GalleryCommandDemo$CommandItem_click = handler((event, ctx) => {
  const result = _commandItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    inputValue: ctx.state.inputValue,
    items: [
      {
        id: 'gallery-command-listbox-item-0',
        label: 'Open dashboard',
        value: 'dashboard',
      },
      {
        id: 'gallery-command-listbox-item-1',
        label: 'Invite teammate',
        value: 'invite',
      },
      {
        disabled: true,
        id: 'gallery-command-listbox-item-2',
        label: 'Delete project',
        value: 'delete',
      },
    ],
    itemValue: 'dashboard',
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;
  if (result.selected) {
    ctx.state.open = result.open.open;
    ctx.state.value = result.value.value ?? ctx.state.value;
    ctx.state.lastKeyAction = 'selected';
  }
});
export const GalleryCommandDemo$CommandItem_click_2 = handler((event, ctx) => {
  const result = _commandItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    inputValue: ctx.state.inputValue,
    items: [
      {
        id: 'gallery-command-listbox-item-0',
        label: 'Open dashboard',
        value: 'dashboard',
      },
      {
        id: 'gallery-command-listbox-item-1',
        label: 'Invite teammate',
        value: 'invite',
      },
      {
        disabled: true,
        id: 'gallery-command-listbox-item-2',
        label: 'Delete project',
        value: 'delete',
      },
    ],
    itemValue: 'invite',
    open: ctx.state.open,
    value: ctx.state.value,
  });
  if (!result) return;
  if (result.selected) {
    ctx.state.open = result.open.open;
    ctx.state.value = result.value.value ?? ctx.state.value;
    ctx.state.lastKeyAction = 'selected';
  }
});
export const GalleryCommandDemo$CommandClose_click = handler((event, ctx) => {
  const result = _commandCloseClick(Object(event), { open: ctx.state.open });
  if (result) ctx.state.open = result.open;
});

export const GalleryCommandDemo$Command_data_placeholder_derive = derive(['state'], (state) =>
  state.inputValue === '' ? '' : null,
);
export const GalleryCommandDemo$Command_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandTrigger_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GalleryCommandDemo$CommandTrigger_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandDialog_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandDialog_open_derive = derive(['state'], (state) =>
  state.open ? '' : null,
);
export const GalleryCommandDemo$CommandInput_aria_activedescendant_derive = derive(
  ['state'],
  (state) =>
    state.highlightedValue === 'invite'
      ? 'gallery-command-listbox-item-1'
      : state.highlightedValue === 'delete'
        ? 'gallery-command-listbox-item-2'
        : state.highlightedValue === 'dashboard'
          ? 'gallery-command-listbox-item-0'
          : null,
);
export const GalleryCommandDemo$CommandInput_aria_expanded_derive = derive(['state'], (state) =>
  state.open ? 'true' : 'false',
);
export const GalleryCommandDemo$CommandInput_data_placeholder_derive = derive(['state'], (state) =>
  state.inputValue === '' ? '' : null,
);
export const GalleryCommandDemo$CommandInput_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandInput_value_derive = derive(
  ['state'],
  (state) => state.inputValue,
);
export const GalleryCommandDemo$CommandListbox_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandListbox_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
export const GalleryCommandDemo$CommandItem_aria_selected_derive = derive(['state'], (state) =>
  state.highlightedValue === 'dashboard' ? 'true' : 'false',
);
export const GalleryCommandDemo$CommandItem_data_highlighted_derive = derive(['state'], (state) =>
  state.highlightedValue === 'dashboard' ? '' : null,
);
export const GalleryCommandDemo$CommandItem_data_selected_derive = derive(['state'], (state) =>
  state.value === 'dashboard' ? '' : null,
);
export const GalleryCommandDemo$CommandItem_data_state_derive = derive(['state'], (state) =>
  state.highlightedValue === 'dashboard' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$CommandItem_hidden_derive = derive(['state'], (state) =>
  state.inputValue !== '' &&
  !'open dashboard dashboard'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$CommandItem_tabIndex_derive = derive(['state'], (state) =>
  state.highlightedValue === 'dashboard' ? 0 : -1,
);
export const GalleryCommandDemo$CommandItem_aria_selected_derive_2 = derive(['state'], (state) =>
  state.highlightedValue === 'invite' ? 'true' : 'false',
);
export const GalleryCommandDemo$CommandItem_data_highlighted_derive_2 = derive(['state'], (state) =>
  state.highlightedValue === 'invite' ? '' : null,
);
export const GalleryCommandDemo$CommandItem_data_selected_derive_2 = derive(['state'], (state) =>
  state.value === 'invite' ? '' : null,
);
export const GalleryCommandDemo$CommandItem_data_state_derive_2 = derive(['state'], (state) =>
  state.highlightedValue === 'invite' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$CommandItem_hidden_derive_2 = derive(['state'], (state) =>
  state.inputValue !== '' &&
  !'invite teammate invite'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$CommandItem_tabIndex_derive_2 = derive(['state'], (state) =>
  state.highlightedValue === 'invite' ? 0 : -1,
);
export const GalleryCommandDemo$CommandItem_aria_selected_derive_3 = derive(['state'], (state) =>
  state.highlightedValue === 'delete' ? 'true' : 'false',
);
export const GalleryCommandDemo$CommandItem_data_highlighted_derive_3 = derive(['state'], (state) =>
  state.highlightedValue === 'delete' ? '' : null,
);
export const GalleryCommandDemo$CommandItem_data_selected_derive_3 = derive(['state'], (state) =>
  state.value === 'delete' ? '' : null,
);
export const GalleryCommandDemo$CommandItem_data_state_derive_3 = derive(['state'], (state) =>
  state.highlightedValue === 'delete' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$CommandItem_hidden_derive_3 = derive(['state'], (state) =>
  state.inputValue !== '' && !'delete project delete'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$CommandEmpty_hidden_derive = derive(['state'], (state) =>
  state.inputValue === '' ||
  'open dashboard dashboard invite teammate invite delete project delete'.includes(
    state.inputValue.toLocaleLowerCase(),
  )
    ? ''
    : null,
);
export const GalleryCommandDemo$CommandClose_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$output_text_derive = derive(
  ['state'],
  (state) => state.inputValue || 'empty',
);
export const GalleryCommandDemo$output_text_derive_2 = derive(['state'], (state) =>
  state.value === 'invite' ? 'Invite teammate' : 'Open dashboard',
);
