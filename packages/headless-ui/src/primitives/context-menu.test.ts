import { describe, expect, it } from 'vitest';

import {
  contextMenuContentAttributes as exportedContextMenuContentAttributes,
  contextMenuGroupAttributes as exportedContextMenuGroupAttributes,
  contextMenuItemAttributes as exportedContextMenuItemAttributes,
  contextMenuItemClick as exportedContextMenuItemClick,
  contextMenuItemHighlighted as exportedContextMenuItemHighlighted,
  contextMenuItemKeyDown as exportedContextMenuItemKeyDown,
  contextMenuKeyDown as exportedContextMenuKeyDown,
  contextMenuMove as exportedContextMenuMove,
  contextMenuPointFromEvent as exportedContextMenuPointFromEvent,
  contextMenuRootAttributes as exportedContextMenuRootAttributes,
  contextMenuSeparatorAttributes as exportedContextMenuSeparatorAttributes,
  contextMenuTriggerAttributes as exportedContextMenuTriggerAttributes,
  contextMenuTriggerContextMenu as exportedContextMenuTriggerContextMenu,
  contextMenuTriggerKeyDown as exportedContextMenuTriggerKeyDown,
  contextMenuTypeahead as exportedContextMenuTypeahead,
  selectContextMenuItem as exportedSelectContextMenuItem,
  setContextMenuOpen as exportedSetContextMenuOpen,
  toggleContextMenu as exportedToggleContextMenu,
} from '../index.js';
import {
  contextMenuContentAttributes,
  contextMenuGroupAttributes,
  contextMenuItemAttributes,
  contextMenuItemClick,
  contextMenuItemHighlighted,
  contextMenuItemKeyDown,
  contextMenuKeyDown,
  contextMenuMove,
  contextMenuPointFromEvent,
  contextMenuRootAttributes,
  contextMenuSeparatorAttributes,
  contextMenuTriggerAttributes,
  contextMenuTriggerContextMenu,
  contextMenuTriggerKeyDown,
  contextMenuTypeahead,
  selectContextMenuItem,
  setContextMenuOpen,
  toggleContextMenu,
  type ContextMenuItem,
} from './context-menu.js';
import { contextMenuRootAttributes as primitiveContextMenuRootAttributes } from './index.js';

const menuItems: readonly ContextMenuItem[] = Object.freeze([
  { label: 'Cut', value: 'cut' },
  { label: 'Crop', value: 'crop' },
  { disabled: true, label: 'Copy', value: 'copy' },
  { textValue: 'Paste as plain text', value: 'paste-plain' },
]);

describe('headless-ui context-menu primitive', () => {
  it('builds root, trigger, content, group, separator, and item attributes', () => {
    expect(contextMenuRootAttributes({ id: 'editor-menu-root', open: true })).toEqual({
      'data-state': 'open',
      id: 'editor-menu-root',
    });
    expect(contextMenuRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(
      contextMenuTriggerAttributes({
        contentId: 'editor-menu',
        id: 'editor-surface',
        labelledBy: 'editor-label',
        open: true,
      }),
    ).toEqual({
      'aria-controls': 'editor-menu',
      'aria-expanded': 'true',
      'aria-haspopup': 'menu',
      'aria-labelledby': 'editor-label',
      'data-state': 'open',
      'jiso-context-menu': 'editor-menu',
      id: 'editor-surface',
      role: 'button',
    });
    expect(
      contextMenuTriggerAttributes({
        contentId: 'editor-menu',
        disabled: true,
        open: false,
      }),
    ).toEqual({
      'aria-disabled': 'true',
      'aria-expanded': 'false',
      'aria-haspopup': 'menu',
      'data-disabled': '',
      'data-state': 'closed',
      role: 'button',
    });

    expect(
      contextMenuContentAttributes({
        id: 'editor-menu',
        open: true,
        point: { x: 24, y: 48 },
      }),
    ).toEqual({
      'data-anchor-x': '24',
      'data-anchor-y': '48',
      'data-state': 'open',
      id: 'editor-menu',
      role: 'menu',
      tabIndex: -1,
    });
    expect(contextMenuContentAttributes({ id: 'editor-menu', open: false })).toEqual({
      'data-state': 'closed',
      hidden: true,
      id: 'editor-menu',
      role: 'menu',
      tabIndex: -1,
    });

    expect(
      contextMenuGroupAttributes({
        id: 'editor-group',
        labelledBy: 'editor-group-label',
        open: true,
      }),
    ).toEqual({
      'aria-labelledby': 'editor-group-label',
      'data-state': 'open',
      id: 'editor-group',
      role: 'group',
    });
    expect(contextMenuSeparatorAttributes({ id: 'editor-separator' })).toEqual({
      id: 'editor-separator',
      role: 'separator',
    });
  });

  it('marks highlighted and disabled menu items', () => {
    const state = {
      highlightedValue: 'paste-plain',
      items: menuItems,
      open: true,
    };

    expect(contextMenuItemAttributes({ ...state, itemValue: 'cut' })).toEqual({
      'data-state': 'inactive',
      role: 'menuitem',
      tabIndex: -1,
      value: 'cut',
    });
    expect(contextMenuItemAttributes({ ...state, itemValue: 'copy' })).toEqual({
      'aria-disabled': 'true',
      'data-disabled': '',
      'data-state': 'inactive',
      role: 'menuitem',
      tabIndex: -1,
      value: 'copy',
    });
    expect(
      contextMenuItemAttributes({ ...state, id: 'paste-plain-item', itemValue: 'paste-plain' }),
    ).toEqual({
      'data-highlighted': '',
      'data-state': 'active',
      id: 'paste-plain-item',
      role: 'menuitem',
      tabIndex: 0,
      value: 'paste-plain',
    });
    expect(contextMenuItemHighlighted({ ...state, itemValue: 'paste-plain' })).toBe(true);
  });

  it('dispatches cancelable open and select details before committing state', () => {
    const seen: string[] = [];
    const openResult = setContextMenuOpen({ open: false }, true, 'programmatic', {
      onOpenChange(detail) {
        seen.push(`open:${detail.reason}:${detail.value}`);
      },
    });
    const selectResult = selectContextMenuItem(
      { items: menuItems, open: true, point: { x: 1, y: 2 } },
      'paste-plain',
      'programmatic',
      {
        onOpenChange(detail) {
          seen.push(`open:${detail.reason}:${detail.value}`);
        },
        onSelect(detail) {
          seen.push(`select:${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(openResult).toMatchObject({ changed: true, open: true });
    expect(selectResult).toMatchObject({ selected: true, value: 'paste-plain' });
    expect(selectResult.open).toMatchObject({
      changed: true,
      open: false,
      point: { x: 1, y: 2 },
    });
    expect(seen).toEqual([
      'open:programmatic:true',
      'select:programmatic:paste-plain',
      'open:item-select:false',
    ]);
  });

  it('keeps previous state when open or select changes are prevented', () => {
    const openResult = toggleContextMenu({ open: false }, 'trigger-context-menu', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });
    const selectResult = selectContextMenuItem({ open: true }, 'cut', 'item-click', {
      onSelect(detail) {
        detail.preventDefault();
      },
    });

    expect(openResult.changed).toBe(false);
    expect(openResult.open).toBe(false);
    expect(openResult.detail?.defaultPrevented).toBe(true);
    expect(selectResult.selected).toBe(false);
    expect(selectResult.open.open).toBe(true);
    expect(selectResult.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled, item-disabled, or unchanged states', () => {
    let callCount = 0;
    const options = {
      onOpenChange() {
        callCount += 1;
      },
      onSelect() {
        callCount += 1;
      },
    };

    expect(
      setContextMenuOpen({ disabled: true, open: false }, true, 'programmatic', options),
    ).toEqual({ changed: false, open: false });
    expect(setContextMenuOpen({ open: true }, true, 'programmatic', options)).toEqual({
      changed: false,
      open: true,
    });
    expect(
      selectContextMenuItem({ items: menuItems, open: true }, 'copy', 'programmatic', options),
    ).toEqual({
      open: { changed: false, open: true },
      selected: false,
      value: 'copy',
    });
    expect(callCount).toBe(0);
  });

  it('selects highlighted context menu items from keyboard activation keys', () => {
    const seen: string[] = [];
    const enterEvent = keydownEvent('Enter');
    const spaceEvent = keydownEvent(' ');
    const legacySpaceEvent = keydownEvent('Spacebar');

    expect(
      contextMenuItemKeyDown(
        enterEvent,
        {
          highlightedValue: 'paste-plain',
          itemValue: 'paste-plain',
          items: menuItems,
          open: true,
          point: { x: 3, y: 4 },
        },
        {
          onOpenChange(detail) {
            seen.push(`open:${detail.reason}:${detail.value}`);
          },
          onSelect(detail) {
            seen.push(`select:${detail.reason}:${detail.value}`);
          },
        },
      ),
    ).toMatchObject({
      open: { changed: true, open: false, point: { x: 3, y: 4 } },
      selected: true,
      value: 'paste-plain',
    });
    expect(enterEvent.defaultPrevented).toBe(true);

    expect(
      contextMenuItemKeyDown(spaceEvent, {
        highlightedValue: 'cut',
        itemValue: 'cut',
        items: menuItems,
        open: true,
      }),
    ).toMatchObject({ selected: true, value: 'cut' });
    expect(spaceEvent.defaultPrevented).toBe(true);

    expect(
      contextMenuItemKeyDown(legacySpaceEvent, {
        highlightedValue: 'crop',
        itemValue: 'crop',
        items: menuItems,
        open: true,
      }),
    ).toMatchObject({ selected: true, value: 'crop' });
    expect(legacySpaceEvent.defaultPrevented).toBe(true);
    expect(seen).toEqual(['select:item-keyboard:paste-plain', 'open:item-select:false']);
    expect(
      contextMenuItemKeyDown(keydownEvent('ArrowDown'), {
        itemValue: 'cut',
        items: menuItems,
        open: true,
      }),
    ).toBeUndefined();
  });

  it('keeps keyboard context item activation cancelable and disabled-aware', () => {
    const disabledEvent = keydownEvent('Enter');
    const disabledResult = contextMenuItemKeyDown(disabledEvent, {
      itemValue: 'copy',
      items: menuItems,
      open: true,
      point: { x: 8, y: 16 },
    });
    expect(disabledResult).toEqual({
      open: { changed: false, open: true, point: { x: 8, y: 16 } },
      selected: false,
      value: 'copy',
    });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = keydownEvent(' ');
    const canceledResult = contextMenuItemKeyDown(
      canceledEvent,
      {
        itemValue: 'cut',
        items: menuItems,
        open: true,
      },
      {
        onSelect(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledResult?.selected).toBe(false);
    expect(canceledResult?.open.open).toBe(true);
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('moves through enabled items with shared menu keyboard navigation', () => {
    expect(contextMenuMove({ highlightedValue: 'cut', items: menuItems }, 'ArrowDown')).toEqual({
      highlightedIndex: 1,
      highlightedValue: 'crop',
    });
    expect(contextMenuMove({ highlightedValue: 'paste-plain', items: menuItems }, 'Home')).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'cut',
    });
    expect(contextMenuMove({ disabled: true, items: menuItems }, 'ArrowDown')).toBeUndefined();
    expect(contextMenuMove({ items: menuItems }, 'Enter')).toBeUndefined();
  });

  it('uses shared typeahead helpers to find enabled menu items', () => {
    const first = contextMenuTypeahead({ highlightedValue: 'cut', items: menuItems }, 'o', {
      now: 100,
    });
    const second = contextMenuTypeahead({ highlightedValue: 'cut', items: menuItems }, 'p', {
      now: 900,
      state: first.state,
    });

    expect(first).toMatchObject({ highlightedIndex: -1, highlightedValue: 'cut' });
    expect(second).toMatchObject({ highlightedIndex: 3, highlightedValue: 'paste-plain' });
    expect(second.state.buffer).toBe('p');
  });

  it('cycles enabled menu items when typeahead repeats the same key', () => {
    const first = contextMenuTypeahead({ highlightedValue: 'cut', items: menuItems }, 'c', {
      now: 100,
    });
    const second = contextMenuTypeahead({ highlightedValue: 'crop', items: menuItems }, 'c', {
      now: 300,
      state: first.state,
    });

    expect(first).toMatchObject({ highlightedIndex: 1, highlightedValue: 'crop' });
    expect(first.state.buffer).toBe('c');
    expect(second).toMatchObject({ highlightedIndex: 0, highlightedValue: 'cut' });
    expect(second.state.buffer).toBe('c');
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const triggerEvent = contextmenuEvent(10, 20);
    triggerEvent.preventDefault();
    const triggerKeyEvent = keydownEvent('ContextMenu');
    triggerKeyEvent.preventDefault();
    const itemEvent = new Event('click', { cancelable: true });
    itemEvent.preventDefault();
    const itemKeyEvent = keydownEvent('Enter');
    itemKeyEvent.preventDefault();
    const keyEvent = keydownEvent('Escape');
    keyEvent.preventDefault();

    const options = {
      onOpenChange() {
        throw new Error('open should not dispatch after defaultPrevented');
      },
      onSelect() {
        throw new Error('select should not dispatch after defaultPrevented');
      },
    };

    expect(contextMenuTriggerContextMenu(triggerEvent, { open: false }, options)).toBeUndefined();
    expect(contextMenuTriggerKeyDown(triggerKeyEvent, { open: false }, options)).toBeUndefined();
    expect(
      contextMenuItemClick(itemEvent, { itemValue: 'cut', open: true }, options),
    ).toBeUndefined();
    expect(
      contextMenuItemKeyDown(itemKeyEvent, { itemValue: 'cut', open: true }, options),
    ).toBeUndefined();
    expect(contextMenuKeyDown(keyEvent, { open: true }, options)).toBeUndefined();
  });

  it('uses handler reasons, trigger points, and prevents native actions when handled', () => {
    const reasons: string[] = [];
    const triggerEvent = contextmenuEvent(32, 64);
    const triggerResult = contextMenuTriggerContextMenu(
      triggerEvent,
      {
        open: false,
      },
      {
        onOpenChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(triggerResult).toMatchObject({
      changed: true,
      open: true,
      point: { x: 32, y: 64 },
    });
    expect(triggerEvent.defaultPrevented).toBe(true);
    expect(reasons).toEqual(['trigger-context-menu']);

    const keyboardEvent = keydownEvent('F10', { shiftKey: true });
    expect(contextMenuTriggerKeyDown(keyboardEvent, { open: false })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'keyboard-open', value: true }),
      open: true,
    });

    const disabledEvent = contextmenuEvent(0, 0);
    const disabledResult = contextMenuTriggerContextMenu(disabledEvent, {
      disabled: true,
      open: false,
    });
    expect(disabledResult).toEqual({ changed: false, open: false });
    expect(disabledEvent.defaultPrevented).toBe(false);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = contextMenuItemClick(
      canceledEvent,
      {
        itemValue: 'cut',
        open: true,
      },
      {
        onSelect(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledResult?.selected).toBe(false);
    expect(canceledResult?.open.open).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);

    const escapeEvent = keydownEvent('Escape');
    expect(contextMenuKeyDown(escapeEvent, { open: true })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'escape-key', value: false }),
      open: false,
    });
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(contextMenuKeyDown(keydownEvent('Enter'), { open: true })).toBeUndefined();
  });

  it('extracts a fallback point from context menu events', () => {
    expect(contextMenuPointFromEvent(new Event('contextmenu'))).toEqual({ x: 0, y: 0 });
    expect(contextMenuPointFromEvent(contextmenuEvent(4, 8))).toEqual({ x: 4, y: 8 });
  });

  it('exports context-menu helpers from package and primitives barrels', () => {
    expect(exportedContextMenuContentAttributes).toBe(contextMenuContentAttributes);
    expect(exportedContextMenuGroupAttributes).toBe(contextMenuGroupAttributes);
    expect(exportedContextMenuItemAttributes).toBe(contextMenuItemAttributes);
    expect(exportedContextMenuItemClick).toBe(contextMenuItemClick);
    expect(exportedContextMenuItemHighlighted).toBe(contextMenuItemHighlighted);
    expect(exportedContextMenuItemKeyDown).toBe(contextMenuItemKeyDown);
    expect(exportedContextMenuKeyDown).toBe(contextMenuKeyDown);
    expect(exportedContextMenuMove).toBe(contextMenuMove);
    expect(exportedContextMenuPointFromEvent).toBe(contextMenuPointFromEvent);
    expect(exportedContextMenuRootAttributes).toBe(contextMenuRootAttributes);
    expect(exportedContextMenuSeparatorAttributes).toBe(contextMenuSeparatorAttributes);
    expect(exportedContextMenuTriggerAttributes).toBe(contextMenuTriggerAttributes);
    expect(exportedContextMenuTriggerContextMenu).toBe(contextMenuTriggerContextMenu);
    expect(exportedContextMenuTriggerKeyDown).toBe(contextMenuTriggerKeyDown);
    expect(exportedContextMenuTypeahead).toBe(contextMenuTypeahead);
    expect(exportedSelectContextMenuItem).toBe(selectContextMenuItem);
    expect(exportedSetContextMenuOpen).toBe(setContextMenuOpen);
    expect(exportedToggleContextMenu).toBe(toggleContextMenu);
    expect(primitiveContextMenuRootAttributes).toBe(contextMenuRootAttributes);
  });
});

function contextmenuEvent(
  clientX: number,
  clientY: number,
): Event & { clientX: number; clientY: number } {
  return Object.assign(new Event('contextmenu', { cancelable: true }), { clientX, clientY });
}

function keydownEvent(
  key: string,
  options: { shiftKey?: boolean } = {},
): Event & { readonly key: string; readonly shiftKey?: boolean } {
  return Object.assign(new Event('keydown', { cancelable: true }), {
    key,
    ...(options.shiftKey === undefined ? {} : { shiftKey: options.shiftKey }),
  });
}
