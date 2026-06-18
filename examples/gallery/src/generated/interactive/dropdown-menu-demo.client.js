// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  dropdownMenuFocusElement as _dropdownMenuFocusElement,
  dropdownMenuItemClick as _dropdownMenuItemClick,
  dropdownMenuItemKeyDown as _dropdownMenuItemKeyDown,
  dropdownMenuKeyDown as _dropdownMenuKeyDown,
  dropdownMenuMove as _dropdownMenuMove,
  dropdownMenuTriggerClick as _dropdownMenuTriggerClick,
  dropdownMenuTriggerKeyDown as _dropdownMenuTriggerKeyDown,
  dropdownMenuTypeahead as _dropdownMenuTypeahead,
} from '@kovojs/ui/dropdown-menu';

export const GalleryDropdownMenuDemo$DropdownMenuTrigger_click = handler((event, ctx) => {
  const result = _dropdownMenuTriggerClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ],
    open: ctx.state.open,
  });
  if (!result?.changed) return;
  ctx.state.open = result.open;
  ctx.state.highlightedValue = 'duplicate';
  if (result.open)
    _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-duplicate', {
      defer: true,
    });
});
export const GalleryDropdownMenuDemo$DropdownMenuTrigger_keydown = handler((event, ctx) => {
  const result = _dropdownMenuTriggerKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ],
    open: ctx.state.open,
  });
  if (!result?.changed) return;
  ctx.state.open = result.open;
  ctx.state.highlightedValue = Object(event).key === 'ArrowUp' ? 'rename' : 'duplicate';
  if (result.open) {
    _dropdownMenuFocusElement(
      Object(event),
      ctx.state.highlightedValue === 'rename'
        ? 'gallery-dropdown-menu-rename'
        : 'gallery-dropdown-menu-duplicate',
      { defer: true },
    );
  }
});
export const GalleryDropdownMenuDemo$DropdownMenuItem_keydown = handler((event, ctx) => {
  const result = _dropdownMenuItemKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    itemValue: 'duplicate',
    items: [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ],
    open: ctx.state.open,
  });
  if (result?.selected) {
    ctx.state.open = result.open.open;
    ctx.state.highlightedValue = result.value;
    ctx.state.value = result.value;
    _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
    return;
  }

  const keyResult = _dropdownMenuKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ],
    open: ctx.state.open,
  });
  if (keyResult?.changed) {
    ctx.state.open = keyResult.open;
    if (!keyResult.open) _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
    return;
  }

  const move = _dropdownMenuMove(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Duplicate', value: 'duplicate' },
        { disabled: true, label: 'Archive', value: 'archive' },
        { label: 'Rename', value: 'rename' },
      ],
      open: ctx.state.open,
    },
    Object(event).key,
    { loop: true },
  );
  if (move) {
    Object(event).preventDefault?.();
    ctx.state.highlightedValue = move.highlightedValue ?? ctx.state.highlightedValue;
    _dropdownMenuFocusElement(
      Object(event),
      ctx.state.highlightedValue === 'rename'
        ? 'gallery-dropdown-menu-rename'
        : 'gallery-dropdown-menu-duplicate',
    );
    return;
  }

  const typeahead = _dropdownMenuTypeahead(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Duplicate', value: 'duplicate' },
        { disabled: true, label: 'Archive', value: 'archive' },
        { label: 'Rename', value: 'rename' },
      ],
      open: ctx.state.open,
    },
    Object(event).key,
    { now: 0, loop: true },
  );
  if (typeahead.highlightedValue === ctx.state.highlightedValue) return;
  Object(event).preventDefault?.();
  ctx.state.highlightedValue = typeahead.highlightedValue ?? ctx.state.highlightedValue;
  _dropdownMenuFocusElement(
    Object(event),
    ctx.state.highlightedValue === 'rename'
      ? 'gallery-dropdown-menu-rename'
      : 'gallery-dropdown-menu-duplicate',
  );
});
export const GalleryDropdownMenuDemo$DropdownMenuItem_click = handler((event, ctx) => {
  const result = _dropdownMenuItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    itemValue: 'duplicate',
    items: [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ],
    open: ctx.state.open,
  });
  if (!result?.selected) return;
  ctx.state.open = result.open.open;
  ctx.state.highlightedValue = result.value;
  ctx.state.value = result.value;
  _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
});
export const GalleryDropdownMenuDemo$DropdownMenuItem_keydown_2 = handler((event, ctx) => {
  const result = _dropdownMenuItemKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    itemValue: 'rename',
    items: [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ],
    open: ctx.state.open,
  });
  if (result?.selected) {
    ctx.state.open = result.open.open;
    ctx.state.highlightedValue = result.value;
    ctx.state.value = result.value;
    _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
    return;
  }

  const keyResult = _dropdownMenuKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ],
    open: ctx.state.open,
  });
  if (keyResult?.changed) {
    ctx.state.open = keyResult.open;
    if (!keyResult.open) _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
    return;
  }

  const move = _dropdownMenuMove(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Duplicate', value: 'duplicate' },
        { disabled: true, label: 'Archive', value: 'archive' },
        { label: 'Rename', value: 'rename' },
      ],
      open: ctx.state.open,
    },
    Object(event).key,
    { loop: true },
  );
  if (move) {
    Object(event).preventDefault?.();
    ctx.state.highlightedValue = move.highlightedValue ?? ctx.state.highlightedValue;
    _dropdownMenuFocusElement(
      Object(event),
      ctx.state.highlightedValue === 'rename'
        ? 'gallery-dropdown-menu-rename'
        : 'gallery-dropdown-menu-duplicate',
    );
    return;
  }

  const typeahead = _dropdownMenuTypeahead(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Duplicate', value: 'duplicate' },
        { disabled: true, label: 'Archive', value: 'archive' },
        { label: 'Rename', value: 'rename' },
      ],
      open: ctx.state.open,
    },
    Object(event).key,
    { now: 0, loop: true },
  );
  if (typeahead.highlightedValue === ctx.state.highlightedValue) return;
  Object(event).preventDefault?.();
  ctx.state.highlightedValue = typeahead.highlightedValue ?? ctx.state.highlightedValue;
  _dropdownMenuFocusElement(
    Object(event),
    ctx.state.highlightedValue === 'rename'
      ? 'gallery-dropdown-menu-rename'
      : 'gallery-dropdown-menu-duplicate',
  );
});
export const GalleryDropdownMenuDemo$DropdownMenuItem_click_2 = handler((event, ctx) => {
  const result = _dropdownMenuItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    itemValue: 'rename',
    items: [
      { label: 'Duplicate', value: 'duplicate' },
      { disabled: true, label: 'Archive', value: 'archive' },
      { label: 'Rename', value: 'rename' },
    ],
    open: ctx.state.open,
  });
  if (!result?.selected) return;
  ctx.state.open = result.open.open;
  ctx.state.highlightedValue = result.value;
  ctx.state.value = result.value;
  _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
});

export const GalleryDropdownMenuDemo$DropdownMenu_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDropdownMenuDemo$DropdownMenuTrigger_aria_expanded_derive = derive(
  ['state'],
  (state) => (state.open ? 'true' : 'false'),
);
export const GalleryDropdownMenuDemo$DropdownMenuTrigger_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryDropdownMenuDemo$DropdownMenuContent_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryDropdownMenuDemo$DropdownMenuContent_hidden_derive = derive(
  ['state'],
  (state) => (!state.open ? '' : null),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_data_highlighted_derive = derive(
  ['state'],
  (state) => (state.highlightedValue === 'duplicate' ? '' : null),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_data_state_derive = derive(
  ['state'],
  (state) => (state.highlightedValue === 'duplicate' ? 'active' : 'inactive'),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_tabIndex_derive = derive(['state'], (state) =>
  state.highlightedValue === 'duplicate' ? 0 : -1,
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_data_highlighted_derive_2 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'rename' ? '' : null),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_data_state_derive_2 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'rename' ? 'active' : 'inactive'),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_tabIndex_derive_2 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'rename' ? 0 : -1),
);
export const GalleryDropdownMenuDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
