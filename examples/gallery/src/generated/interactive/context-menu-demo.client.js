// @kovojs-ir
import { derive, handler } from '@kovojs/runtime/generated';

import {
  contextMenuFocusElement as _contextMenuFocusElement,
  contextMenuItemClick as _contextMenuItemClick,
  contextMenuItemKeyDown as _contextMenuItemKeyDown,
  contextMenuKeyDown as _contextMenuKeyDown,
  contextMenuMove as _contextMenuMove,
  contextMenuTriggerContextMenu as _contextMenuTriggerContextMenu,
  contextMenuTriggerKeyDown as _contextMenuTriggerKeyDown,
  contextMenuTypeahead as _contextMenuTypeahead,
} from '@kovojs/headless-ui/context-menu';

export const GalleryContextMenuDemo$ContextMenuTrigger_contextmenu = handler((event, ctx) => {
  const result = _contextMenuTriggerContextMenu(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Copy link', value: 'copy' },
      { disabled: true, label: 'Delete', value: 'delete' },
      { label: 'Inspect', value: 'inspect' },
    ],
    open: ctx.state.open,
    point: ctx.state.point,
  });
  if (!result?.changed) return;
  ctx.state.open = result.open;
  ctx.state.point = result.point ?? ctx.state.point;
  ctx.state.highlightedValue = 'copy';
  if (result.open)
    _contextMenuFocusElement(Object(event), 'gallery-context-menu-copy', { defer: true });
});
export const GalleryContextMenuDemo$ContextMenuTrigger_keydown = handler((event, ctx) => {
  const result = _contextMenuTriggerKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Copy link', value: 'copy' },
      { disabled: true, label: 'Delete', value: 'delete' },
      { label: 'Inspect', value: 'inspect' },
    ],
    open: ctx.state.open,
    point: ctx.state.point,
  });
  if (!result?.changed) return;
  ctx.state.open = result.open;
  ctx.state.point = result.point ?? ctx.state.point;
  ctx.state.highlightedValue = 'copy';
  if (result.open)
    _contextMenuFocusElement(Object(event), 'gallery-context-menu-copy', { defer: true });
});
export const GalleryContextMenuDemo$ContextMenuItem_keydown = handler((event, ctx) => {
  const result = _contextMenuItemKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    itemValue: 'copy',
    items: [
      { label: 'Copy link', value: 'copy' },
      { disabled: true, label: 'Delete', value: 'delete' },
      { label: 'Inspect', value: 'inspect' },
    ],
    open: ctx.state.open,
    point: ctx.state.point,
  });
  if (result?.selected) {
    ctx.state.open = result.open.open;
    ctx.state.highlightedValue = result.value;
    ctx.state.value = result.value;
    _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
    return;
  }

  const keyResult = _contextMenuKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Copy link', value: 'copy' },
      { disabled: true, label: 'Delete', value: 'delete' },
      { label: 'Inspect', value: 'inspect' },
    ],
    open: ctx.state.open,
    point: ctx.state.point,
  });
  if (keyResult?.changed) {
    ctx.state.open = keyResult.open;
    if (!keyResult.open) _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
    return;
  }

  const move = _contextMenuMove(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Copy link', value: 'copy' },
        { disabled: true, label: 'Delete', value: 'delete' },
        { label: 'Inspect', value: 'inspect' },
      ],
      open: ctx.state.open,
      point: ctx.state.point,
    },
    Object(event).key,
    { loop: true },
  );
  if (move) {
    Object(event).preventDefault?.();
    ctx.state.highlightedValue = move.highlightedValue ?? ctx.state.highlightedValue;
    _contextMenuFocusElement(
      Object(event),
      ctx.state.highlightedValue === 'inspect'
        ? 'gallery-context-menu-inspect'
        : 'gallery-context-menu-copy',
    );
    return;
  }

  const typeahead = _contextMenuTypeahead(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Copy link', value: 'copy' },
        { disabled: true, label: 'Delete', value: 'delete' },
        { label: 'Inspect', value: 'inspect' },
      ],
      open: ctx.state.open,
      point: ctx.state.point,
    },
    Object(event).key,
    { now: 0, loop: true },
  );
  if (typeahead.highlightedValue === ctx.state.highlightedValue) return;
  Object(event).preventDefault?.();
  ctx.state.highlightedValue = typeahead.highlightedValue ?? ctx.state.highlightedValue;
  _contextMenuFocusElement(
    Object(event),
    ctx.state.highlightedValue === 'inspect'
      ? 'gallery-context-menu-inspect'
      : 'gallery-context-menu-copy',
  );
});
export const GalleryContextMenuDemo$ContextMenuItem_click = handler((event, ctx) => {
  const result = _contextMenuItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    itemValue: 'copy',
    items: [
      { label: 'Copy link', value: 'copy' },
      { disabled: true, label: 'Delete', value: 'delete' },
      { label: 'Inspect', value: 'inspect' },
    ],
    open: ctx.state.open,
    point: ctx.state.point,
  });
  if (!result?.selected) return;
  ctx.state.open = result.open.open;
  ctx.state.highlightedValue = result.value;
  ctx.state.value = result.value;
  _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
});
export const GalleryContextMenuDemo$ContextMenuItem_keydown_2 = handler((event, ctx) => {
  const result = _contextMenuItemKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    itemValue: 'inspect',
    items: [
      { label: 'Copy link', value: 'copy' },
      { disabled: true, label: 'Delete', value: 'delete' },
      { label: 'Inspect', value: 'inspect' },
    ],
    open: ctx.state.open,
    point: ctx.state.point,
  });
  if (result?.selected) {
    ctx.state.open = result.open.open;
    ctx.state.highlightedValue = result.value;
    ctx.state.value = result.value;
    _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
    return;
  }

  const keyResult = _contextMenuKeyDown(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    items: [
      { label: 'Copy link', value: 'copy' },
      { disabled: true, label: 'Delete', value: 'delete' },
      { label: 'Inspect', value: 'inspect' },
    ],
    open: ctx.state.open,
    point: ctx.state.point,
  });
  if (keyResult?.changed) {
    ctx.state.open = keyResult.open;
    if (!keyResult.open) _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
    return;
  }

  const move = _contextMenuMove(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Copy link', value: 'copy' },
        { disabled: true, label: 'Delete', value: 'delete' },
        { label: 'Inspect', value: 'inspect' },
      ],
      open: ctx.state.open,
      point: ctx.state.point,
    },
    Object(event).key,
    { loop: true },
  );
  if (move) {
    Object(event).preventDefault?.();
    ctx.state.highlightedValue = move.highlightedValue ?? ctx.state.highlightedValue;
    _contextMenuFocusElement(
      Object(event),
      ctx.state.highlightedValue === 'inspect'
        ? 'gallery-context-menu-inspect'
        : 'gallery-context-menu-copy',
    );
    return;
  }

  const typeahead = _contextMenuTypeahead(
    {
      highlightedValue: ctx.state.highlightedValue,
      items: [
        { label: 'Copy link', value: 'copy' },
        { disabled: true, label: 'Delete', value: 'delete' },
        { label: 'Inspect', value: 'inspect' },
      ],
      open: ctx.state.open,
      point: ctx.state.point,
    },
    Object(event).key,
    { now: 0, loop: true },
  );
  if (typeahead.highlightedValue === ctx.state.highlightedValue) return;
  Object(event).preventDefault?.();
  ctx.state.highlightedValue = typeahead.highlightedValue ?? ctx.state.highlightedValue;
  _contextMenuFocusElement(
    Object(event),
    ctx.state.highlightedValue === 'inspect'
      ? 'gallery-context-menu-inspect'
      : 'gallery-context-menu-copy',
  );
});
export const GalleryContextMenuDemo$ContextMenuItem_click_2 = handler((event, ctx) => {
  const result = _contextMenuItemClick(Object(event), {
    highlightedValue: ctx.state.highlightedValue,
    itemValue: 'inspect',
    items: [
      { label: 'Copy link', value: 'copy' },
      { disabled: true, label: 'Delete', value: 'delete' },
      { label: 'Inspect', value: 'inspect' },
    ],
    open: ctx.state.open,
    point: ctx.state.point,
  });
  if (!result?.selected) return;
  ctx.state.open = result.open.open;
  ctx.state.highlightedValue = result.value;
  ctx.state.value = result.value;
  _contextMenuFocusElement(Object(event), 'gallery-context-menu-trigger');
});

export const GalleryContextMenuDemo$ContextMenu_data_state_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
export const GalleryContextMenuDemo$ContextMenuTrigger_aria_expanded_derive = derive(
  ['state'],
  (state) => (state.open ? 'true' : 'false'),
);
export const GalleryContextMenuDemo$ContextMenuTrigger_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryContextMenuDemo$ContextMenuContent_data_anchor_x_derive = derive(
  ['state'],
  (state) => String(state.point.x),
);
export const GalleryContextMenuDemo$ContextMenuContent_data_anchor_y_derive = derive(
  ['state'],
  (state) => String(state.point.y),
);
export const GalleryContextMenuDemo$ContextMenuContent_data_state_derive = derive(
  ['state'],
  (state) => (state.open ? 'open' : 'closed'),
);
export const GalleryContextMenuDemo$ContextMenuContent_hidden_derive = derive(['state'], (state) =>
  !state.open ? '' : null,
);
export const GalleryContextMenuDemo$ContextMenuItem_data_highlighted_derive = derive(
  ['state'],
  (state) => (state.highlightedValue === 'copy' ? '' : null),
);
export const GalleryContextMenuDemo$ContextMenuItem_data_state_derive = derive(['state'], (state) =>
  state.highlightedValue === 'copy' ? 'active' : 'inactive',
);
export const GalleryContextMenuDemo$ContextMenuItem_tabIndex_derive = derive(['state'], (state) =>
  state.highlightedValue === 'copy' ? 0 : -1,
);
export const GalleryContextMenuDemo$ContextMenuItem_data_highlighted_derive_2 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'inspect' ? '' : null),
);
export const GalleryContextMenuDemo$ContextMenuItem_data_state_derive_2 = derive(
  ['state'],
  (state) => (state.highlightedValue === 'inspect' ? 'active' : 'inactive'),
);
export const GalleryContextMenuDemo$ContextMenuItem_tabIndex_derive_2 = derive(['state'], (state) =>
  state.highlightedValue === 'inspect' ? 0 : -1,
);
export const GalleryContextMenuDemo$output_text_derive = derive(['state'], (state) =>
  state.open ? 'open' : 'closed',
);
