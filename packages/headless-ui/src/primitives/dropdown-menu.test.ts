import { describe, expect, it } from 'vitest';

import {
  dropdownMenuContentAttributes as exportedDropdownMenuContentAttributes,
  dropdownMenuGroupAttributes as exportedDropdownMenuGroupAttributes,
  dropdownMenuItemAttributes as exportedDropdownMenuItemAttributes,
  dropdownMenuItemClick as exportedDropdownMenuItemClick,
  dropdownMenuItemHighlighted as exportedDropdownMenuItemHighlighted,
  dropdownMenuItemKeyDown as exportedDropdownMenuItemKeyDown,
  dropdownMenuKeyDown as exportedDropdownMenuKeyDown,
  dropdownMenuMove as exportedDropdownMenuMove,
  dropdownMenuRootAttributes as exportedDropdownMenuRootAttributes,
  dropdownMenuSeparatorAttributes as exportedDropdownMenuSeparatorAttributes,
  dropdownMenuTriggerAttributes as exportedDropdownMenuTriggerAttributes,
  dropdownMenuTriggerClick as exportedDropdownMenuTriggerClick,
  dropdownMenuTypeahead as exportedDropdownMenuTypeahead,
  selectDropdownMenuItem as exportedSelectDropdownMenuItem,
  setDropdownMenuOpen as exportedSetDropdownMenuOpen,
  toggleDropdownMenu as exportedToggleDropdownMenu,
} from '../index.js';
import {
  dropdownMenuContentAttributes,
  dropdownMenuGroupAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuItemClick,
  dropdownMenuItemHighlighted,
  dropdownMenuItemKeyDown,
  dropdownMenuKeyDown,
  dropdownMenuMove,
  dropdownMenuRootAttributes,
  dropdownMenuSeparatorAttributes,
  dropdownMenuTriggerAttributes,
  dropdownMenuTriggerClick,
  dropdownMenuTypeahead,
  selectDropdownMenuItem,
  setDropdownMenuOpen,
  toggleDropdownMenu,
  type DropdownMenuItem,
} from './dropdown-menu.js';
import { dropdownMenuRootAttributes as primitiveDropdownMenuRootAttributes } from './index.js';

const menuItems: readonly DropdownMenuItem[] = Object.freeze([
  { label: 'Profile', value: 'profile' },
  { disabled: true, label: 'Billing', value: 'billing' },
  { textValue: 'Team settings', value: 'team' },
  { label: 'Preferences', value: 'preferences' },
]);

describe('headless-ui dropdown-menu primitive', () => {
  it('builds root, trigger, content, group, separator, and item attributes', () => {
    expect(dropdownMenuRootAttributes({ id: 'account-root', open: true })).toEqual({
      'data-state': 'open',
      id: 'account-root',
    });
    expect(dropdownMenuRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(
      dropdownMenuTriggerAttributes({
        contentId: 'account-menu',
        id: 'account-trigger',
        labelledBy: 'account-label',
        open: true,
      }),
    ).toEqual({
      'aria-controls': 'account-menu',
      'aria-expanded': 'true',
      'aria-haspopup': 'menu',
      'aria-labelledby': 'account-label',
      'data-state': 'open',
      disabled: false,
      id: 'account-trigger',
      type: 'button',
    });
    expect(
      dropdownMenuTriggerAttributes({
        contentId: 'account-menu',
        disabled: true,
        open: false,
      }),
    ).toEqual({
      'aria-expanded': 'false',
      'aria-haspopup': 'menu',
      'data-disabled': '',
      'data-state': 'closed',
      disabled: true,
      type: 'button',
    });

    expect(dropdownMenuContentAttributes({ id: 'account-menu', open: true })).toEqual({
      'data-state': 'open',
      id: 'account-menu',
      role: 'menu',
      tabIndex: -1,
    });
    expect(dropdownMenuContentAttributes({ id: 'account-menu', open: false })).toEqual({
      'data-state': 'closed',
      hidden: true,
      id: 'account-menu',
      role: 'menu',
      tabIndex: -1,
    });

    expect(
      dropdownMenuGroupAttributes({
        id: 'account-group',
        labelledBy: 'account-group-label',
        open: true,
      }),
    ).toEqual({
      'aria-labelledby': 'account-group-label',
      'data-state': 'open',
      id: 'account-group',
      role: 'group',
    });
    expect(dropdownMenuSeparatorAttributes({ id: 'account-separator' })).toEqual({
      id: 'account-separator',
      role: 'separator',
    });
  });

  it('marks highlighted and disabled menu items', () => {
    const state = {
      highlightedValue: 'team',
      items: menuItems,
      open: true,
    };

    expect(dropdownMenuItemAttributes({ ...state, itemValue: 'profile' })).toEqual({
      'data-state': 'inactive',
      role: 'menuitem',
      tabIndex: -1,
      value: 'profile',
    });
    expect(dropdownMenuItemAttributes({ ...state, itemValue: 'billing' })).toEqual({
      'aria-disabled': 'true',
      'data-disabled': '',
      'data-state': 'inactive',
      role: 'menuitem',
      tabIndex: -1,
      value: 'billing',
    });
    expect(dropdownMenuItemAttributes({ ...state, id: 'team-item', itemValue: 'team' })).toEqual({
      'data-highlighted': '',
      'data-state': 'active',
      id: 'team-item',
      role: 'menuitem',
      tabIndex: 0,
      value: 'team',
    });
    expect(dropdownMenuItemHighlighted({ ...state, itemValue: 'team' })).toBe(true);
  });

  it('dispatches cancelable open and select details before committing state', () => {
    const seen: string[] = [];
    const openResult = setDropdownMenuOpen({ open: false }, true, 'programmatic', {
      onOpenChange(detail) {
        seen.push(`open:${detail.reason}:${detail.value}`);
      },
    });
    const selectResult = selectDropdownMenuItem(
      { items: menuItems, open: true },
      'team',
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
    expect(selectResult).toMatchObject({ selected: true, value: 'team' });
    expect(selectResult.open).toMatchObject({ changed: true, open: false });
    expect(seen).toEqual([
      'open:programmatic:true',
      'select:programmatic:team',
      'open:item-select:false',
    ]);
  });

  it('selects highlighted menu items from keyboard activation keys', () => {
    const seen: string[] = [];
    const enterEvent = keydownEvent('Enter');
    const spaceEvent = keydownEvent(' ');
    const legacySpaceEvent = keydownEvent('Spacebar');

    expect(
      dropdownMenuItemKeyDown(
        enterEvent,
        { highlightedValue: 'team', itemValue: 'team', items: menuItems, open: true },
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
      open: { changed: true, open: false },
      selected: true,
      value: 'team',
    });
    expect(enterEvent.defaultPrevented).toBe(true);

    expect(
      dropdownMenuItemKeyDown(spaceEvent, {
        highlightedValue: 'profile',
        itemValue: 'profile',
        items: menuItems,
        open: true,
      }),
    ).toMatchObject({ selected: true, value: 'profile' });
    expect(spaceEvent.defaultPrevented).toBe(true);

    expect(
      dropdownMenuItemKeyDown(legacySpaceEvent, {
        highlightedValue: 'preferences',
        itemValue: 'preferences',
        items: menuItems,
        open: true,
      }),
    ).toMatchObject({ selected: true, value: 'preferences' });
    expect(legacySpaceEvent.defaultPrevented).toBe(true);
    expect(seen).toEqual(['select:item-keyboard:team', 'open:item-select:false']);
    expect(
      dropdownMenuItemKeyDown(keydownEvent('ArrowDown'), {
        itemValue: 'team',
        items: menuItems,
        open: true,
      }),
    ).toBeUndefined();
  });

  it('keeps keyboard item activation cancelable and disabled-aware', () => {
    const disabledEvent = keydownEvent('Enter');
    const disabledResult = dropdownMenuItemKeyDown(disabledEvent, {
      itemValue: 'billing',
      items: menuItems,
      open: true,
    });
    expect(disabledResult).toEqual({
      open: { changed: false, open: true },
      selected: false,
      value: 'billing',
    });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = keydownEvent(' ');
    const canceledResult = dropdownMenuItemKeyDown(
      canceledEvent,
      {
        itemValue: 'team',
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

  it('keeps previous state when open or select changes are prevented', () => {
    const openResult = toggleDropdownMenu({ open: false }, 'trigger-click', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });
    const selectResult = selectDropdownMenuItem({ open: true }, 'profile', 'item-click', {
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
      setDropdownMenuOpen({ disabled: true, open: false }, true, 'programmatic', options),
    ).toEqual({ changed: false, open: false });
    expect(setDropdownMenuOpen({ open: true }, true, 'programmatic', options)).toEqual({
      changed: false,
      open: true,
    });
    expect(
      selectDropdownMenuItem({ items: menuItems, open: true }, 'billing', 'programmatic', options),
    ).toEqual({
      open: { changed: false, open: true },
      selected: false,
      value: 'billing',
    });
    expect(callCount).toBe(0);
  });

  it('moves through enabled items with shared menu keyboard navigation', () => {
    expect(
      dropdownMenuMove({ highlightedValue: 'profile', items: menuItems }, 'ArrowDown'),
    ).toEqual({
      highlightedIndex: 2,
      highlightedValue: 'team',
    });
    expect(dropdownMenuMove({ highlightedValue: 'team', items: menuItems }, 'Home')).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'profile',
    });
    expect(dropdownMenuMove({ disabled: true, items: menuItems }, 'ArrowDown')).toBeUndefined();
    expect(dropdownMenuMove({ items: menuItems }, 'Enter')).toBeUndefined();
  });

  it('uses shared typeahead helpers to find enabled menu items', () => {
    const first = dropdownMenuTypeahead({ highlightedValue: 'profile', items: menuItems }, 'b', {
      now: 100,
    });
    const second = dropdownMenuTypeahead({ highlightedValue: 'profile', items: menuItems }, 't', {
      now: 900,
      state: first.state,
    });

    expect(first).toMatchObject({ highlightedIndex: -1, highlightedValue: 'profile' });
    expect(second).toMatchObject({ highlightedIndex: 2, highlightedValue: 'team' });
    expect(second.state.buffer).toBe('t');
  });

  it('cycles enabled menu items when typeahead repeats the same key', () => {
    const first = dropdownMenuTypeahead({ highlightedValue: 'profile', items: menuItems }, 'p', {
      now: 100,
    });
    const second = dropdownMenuTypeahead(
      { highlightedValue: 'preferences', items: menuItems },
      'p',
      {
        now: 300,
        state: first.state,
      },
    );

    expect(first).toMatchObject({ highlightedIndex: 3, highlightedValue: 'preferences' });
    expect(first.state.buffer).toBe('p');
    expect(second).toMatchObject({ highlightedIndex: 0, highlightedValue: 'profile' });
    expect(second.state.buffer).toBe('p');
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const triggerEvent = new Event('click', { cancelable: true });
    triggerEvent.preventDefault();
    const itemEvent = new Event('click', { cancelable: true });
    itemEvent.preventDefault();
    const itemKeyEvent = keydownEvent('Enter');
    itemKeyEvent.preventDefault();
    const keyEvent = keydownEvent('Escape');
    keyEvent.preventDefault();

    expect(
      dropdownMenuTriggerClick(
        triggerEvent,
        { open: false },
        {
          onOpenChange() {
            throw new Error('trigger should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
    expect(
      dropdownMenuItemClick(
        itemEvent,
        { itemValue: 'profile', open: true },
        {
          onSelect() {
            throw new Error('item should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
    expect(
      dropdownMenuItemKeyDown(
        itemKeyEvent,
        { itemValue: 'profile', open: true },
        {
          onSelect() {
            throw new Error('item keyboard should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
    expect(
      dropdownMenuKeyDown(
        keyEvent,
        { open: true },
        {
          onOpenChange() {
            throw new Error('keyboard should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('uses handler reasons and prevents native actions when disabled or canceled', () => {
    const reasons: string[] = [];
    const triggerResult = dropdownMenuTriggerClick(
      new Event('click', { cancelable: true }),
      {
        open: false,
      },
      {
        onOpenChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(triggerResult).toMatchObject({ changed: true, open: true });
    expect(reasons).toEqual(['trigger-click']);

    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = dropdownMenuTriggerClick(disabledEvent, {
      disabled: true,
      open: false,
    });
    expect(disabledResult).toEqual({ changed: false, open: false });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = dropdownMenuItemClick(
      canceledEvent,
      {
        itemValue: 'profile',
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
    expect(dropdownMenuKeyDown(escapeEvent, { open: true })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'escape-key', value: false }),
      open: false,
    });
    expect(escapeEvent.defaultPrevented).toBe(true);

    const arrowEvent = keydownEvent('ArrowDown');
    expect(dropdownMenuKeyDown(arrowEvent, { open: false })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'arrow-key', value: true }),
      open: true,
    });
    expect(arrowEvent.defaultPrevented).toBe(true);
    expect(dropdownMenuKeyDown(keydownEvent('Enter'), { open: true })).toBeUndefined();
  });

  it('exports dropdown-menu helpers from package and primitives barrels', () => {
    expect(exportedDropdownMenuContentAttributes).toBe(dropdownMenuContentAttributes);
    expect(exportedDropdownMenuGroupAttributes).toBe(dropdownMenuGroupAttributes);
    expect(exportedDropdownMenuItemAttributes).toBe(dropdownMenuItemAttributes);
    expect(exportedDropdownMenuItemClick).toBe(dropdownMenuItemClick);
    expect(exportedDropdownMenuItemHighlighted).toBe(dropdownMenuItemHighlighted);
    expect(exportedDropdownMenuItemKeyDown).toBe(dropdownMenuItemKeyDown);
    expect(exportedDropdownMenuKeyDown).toBe(dropdownMenuKeyDown);
    expect(exportedDropdownMenuMove).toBe(dropdownMenuMove);
    expect(exportedDropdownMenuRootAttributes).toBe(dropdownMenuRootAttributes);
    expect(exportedDropdownMenuSeparatorAttributes).toBe(dropdownMenuSeparatorAttributes);
    expect(exportedDropdownMenuTriggerAttributes).toBe(dropdownMenuTriggerAttributes);
    expect(exportedDropdownMenuTriggerClick).toBe(dropdownMenuTriggerClick);
    expect(exportedDropdownMenuTypeahead).toBe(dropdownMenuTypeahead);
    expect(exportedSelectDropdownMenuItem).toBe(selectDropdownMenuItem);
    expect(exportedSetDropdownMenuOpen).toBe(setDropdownMenuOpen);
    expect(exportedToggleDropdownMenu).toBe(toggleDropdownMenu);
    expect(primitiveDropdownMenuRootAttributes).toBe(dropdownMenuRootAttributes);
  });
});

function keydownEvent(key: string): Event & { readonly key: string } {
  return Object.assign(new Event('keydown', { cancelable: true }), { key });
}
