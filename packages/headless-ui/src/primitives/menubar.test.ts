import { describe, expect, it } from 'vitest';

import {
  menubarGroupAttributes as exportedMenubarGroupAttributes,
  menubarItemAttributes as exportedMenubarItemAttributes,
  menubarItemClick as exportedMenubarItemClick,
  menubarItemHighlighted as exportedMenubarItemHighlighted,
  menubarItemKeyDown as exportedMenubarItemKeyDown,
  menubarItemOpen as exportedMenubarItemOpen,
  menubarItemPointerEnter as exportedMenubarItemPointerEnter,
  menubarKeyDown as exportedMenubarKeyDown,
  menubarMove as exportedMenubarMove,
  menubarRootAttributes as exportedMenubarRootAttributes,
  menubarSeparatorAttributes as exportedMenubarSeparatorAttributes,
  menubarSubmenuAttributes as exportedMenubarSubmenuAttributes,
  menubarSubmenuTriggerClick as exportedMenubarSubmenuTriggerClick,
  menubarTypeahead as exportedMenubarTypeahead,
  selectMenubarItem as exportedSelectMenubarItem,
  setMenubarOpenValue as exportedSetMenubarOpenValue,
  toggleMenubarOpenValue as exportedToggleMenubarOpenValue,
} from '../index.js';
import {
  menubarGroupAttributes,
  menubarItemAttributes,
  menubarItemClick,
  menubarItemHighlighted,
  menubarItemKeyDown,
  menubarItemOpen,
  menubarItemPointerEnter,
  menubarKeyDown,
  menubarMove,
  menubarRootAttributes,
  menubarSeparatorAttributes,
  menubarSubmenuAttributes,
  menubarSubmenuTriggerClick,
  menubarTypeahead,
  selectMenubarItem,
  setMenubarOpenValue,
  toggleMenubarOpenValue,
  type MenubarItem,
} from './menubar.js';
import { menubarRootAttributes as primitiveMenubarRootAttributes } from './index.js';

const menubarItems: readonly MenubarItem[] = Object.freeze([
  { hasPopup: true, label: 'File', value: 'file' },
  { hasPopup: true, label: 'Format', value: 'format' },
  { disabled: true, hasPopup: true, label: 'Edit', value: 'edit' },
  { hasPopup: true, textValue: 'View options', value: 'view' },
  { label: 'New', parentValue: 'file', value: 'new' },
  { disabled: true, label: 'Open', parentValue: 'file', value: 'open' },
  { label: 'Save', parentValue: 'file', value: 'save' },
  { label: 'Zoom in', parentValue: 'view', value: 'zoom-in' },
]);

describe('headless-ui menubar primitive', () => {
  it('builds root, item, submenu, group, and separator attributes', () => {
    expect(
      menubarRootAttributes({
        activeValue: 'file',
        id: 'app-menubar',
        label: 'Application',
        openValue: 'file',
      }),
    ).toEqual({
      'aria-label': 'Application',
      'data-orientation': 'horizontal',
      'data-state': 'open',
      id: 'app-menubar',
      role: 'menubar',
    });
    expect(menubarRootAttributes({ disabled: true, orientation: 'vertical' })).toEqual({
      'aria-disabled': 'true',
      'aria-orientation': 'vertical',
      'data-disabled': '',
      'data-orientation': 'vertical',
      'data-state': 'closed',
      role: 'menubar',
    });

    expect(
      menubarItemAttributes({
        activeValue: 'file',
        contentId: 'file-menu',
        itemValue: 'file',
        items: menubarItems,
        openValue: 'file',
      }),
    ).toEqual({
      'aria-controls': 'file-menu',
      'aria-expanded': 'true',
      'aria-haspopup': 'menu',
      'data-highlighted': '',
      'data-state': 'active',
      role: 'menuitem',
      tabIndex: 0,
      value: 'file',
    });
    expect(
      menubarItemAttributes({
        activeValue: 'file',
        contentId: 'edit-menu',
        itemValue: 'edit',
        items: menubarItems,
      }),
    ).toEqual({
      'aria-disabled': 'true',
      'aria-expanded': 'false',
      'aria-haspopup': 'menu',
      'data-disabled': '',
      'data-state': 'inactive',
      role: 'menuitem',
      tabIndex: -1,
      value: 'edit',
    });
    expect(menubarItemHighlighted({ activeValue: 'file', itemValue: 'file' })).toBe(true);
    expect(menubarItemOpen({ itemValue: 'file', openValue: 'file' })).toBe(true);

    expect(
      menubarSubmenuAttributes({
        id: 'file-menu',
        labelledBy: 'file-trigger',
        openValue: 'file',
        value: 'file',
      }),
    ).toEqual({
      'aria-labelledby': 'file-trigger',
      'data-state': 'open',
      id: 'file-menu',
      role: 'menu',
      tabIndex: -1,
    });
    expect(menubarSubmenuAttributes({ openValue: 'view', value: 'file' })).toEqual({
      'data-state': 'closed',
      hidden: true,
      role: 'menu',
      tabIndex: -1,
    });
    expect(menubarGroupAttributes({ id: 'file-group', openValue: 'file' })).toEqual({
      'data-orientation': 'horizontal',
      'data-state': 'open',
      id: 'file-group',
      role: 'group',
    });
    expect(menubarSeparatorAttributes({ id: 'file-separator' })).toEqual({
      id: 'file-separator',
      role: 'separator',
    });
  });

  it('dispatches cancelable open and select details before committing state', () => {
    const seen: string[] = [];
    const openResult = setMenubarOpenValue({ items: menubarItems }, 'file', 'programmatic', {
      onOpenChange(detail) {
        seen.push(`open:${detail.reason}:${detail.value}`);
      },
    });
    const selectResult = selectMenubarItem(
      { items: menubarItems, openValue: 'file' },
      'save',
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

    expect(openResult).toMatchObject({ changed: true, openValue: 'file' });
    expect(selectResult).toMatchObject({ selected: true, value: 'save' });
    expect(selectResult.open).toMatchObject({ changed: true, openValue: undefined });
    expect(seen).toEqual([
      'open:programmatic:file',
      'select:programmatic:save',
      'open:item-select:undefined',
    ]);
  });

  it('keeps previous state when open or select changes are prevented', () => {
    const openResult = toggleMenubarOpenValue({}, 'file', 'item-click', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });
    const selectResult = selectMenubarItem({ openValue: 'file' }, 'new', 'item-click', {
      onSelect(detail) {
        detail.preventDefault();
      },
    });

    expect(openResult.changed).toBe(false);
    expect(openResult.openValue).toBeUndefined();
    expect(openResult.detail?.defaultPrevented).toBe(true);
    expect(selectResult.selected).toBe(false);
    expect(selectResult.open.openValue).toBe('file');
    expect(selectResult.detail?.defaultPrevented).toBe(true);
  });

  it('restores selection when the item-select close change is prevented', () => {
    const seen: string[] = [];
    const selectResult = selectMenubarItem(
      { items: menubarItems, openValue: 'file' },
      'save',
      'item-click',
      {
        onOpenChange(detail) {
          seen.push(`open:${detail.reason}:${detail.value}`);
          if (detail.reason === 'item-select') detail.preventDefault();
        },
        onSelect(detail) {
          seen.push(`select:${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(selectResult.selected).toBe(false);
    expect(selectResult.value).toBe('save');
    expect(selectResult.detail?.defaultPrevented).toBe(false);
    expect(selectResult.open).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true, reason: 'item-select' }),
      openValue: 'file',
    });
    expect(seen).toEqual(['select:item-click:save', 'open:item-select:undefined']);
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

    expect(setMenubarOpenValue({ disabled: true }, 'file', 'programmatic', options)).toEqual({
      changed: false,
      openValue: undefined,
    });
    expect(setMenubarOpenValue({ openValue: 'file' }, 'file', 'programmatic', options)).toEqual({
      changed: false,
      openValue: 'file',
    });
    expect(
      selectMenubarItem(
        { items: menubarItems, openValue: 'file' },
        'open',
        'programmatic',
        options,
      ),
    ).toEqual({
      open: { changed: false, openValue: 'file' },
      selected: false,
      value: 'open',
    });
    expect(callCount).toBe(0);
  });

  it('moves through enabled root and submenu items with shared keyboard navigation', () => {
    expect(menubarMove({ activeValue: 'file', items: menubarItems }, 'ArrowRight')).toEqual({
      activeIndex: 1,
      activeValue: 'format',
      parentValue: undefined,
    });
    expect(menubarMove({ activeValue: 'view', items: menubarItems }, 'Home')).toEqual({
      activeIndex: 0,
      activeValue: 'file',
      parentValue: undefined,
    });
    expect(
      menubarMove({ activeValue: 'new', items: menubarItems }, 'ArrowDown', {
        parentValue: 'file',
      }),
    ).toEqual({
      activeIndex: 2,
      activeValue: 'save',
      parentValue: 'file',
    });
    expect(menubarMove({ disabled: true, items: menubarItems }, 'ArrowRight')).toBeUndefined();
    expect(menubarMove({ items: menubarItems }, 'Enter')).toBeUndefined();
  });

  it('uses shared typeahead helpers in the active menubar collection', () => {
    const root = menubarTypeahead({ activeValue: 'file', items: menubarItems }, 'v', {
      now: 100,
    });
    const submenu = menubarTypeahead({ activeValue: 'new', items: menubarItems }, 's', {
      now: 900,
      parentValue: 'file',
      state: root.state,
    });

    expect(root).toMatchObject({ activeIndex: 3, activeValue: 'view', parentValue: undefined });
    expect(submenu).toMatchObject({ activeIndex: 2, activeValue: 'save', parentValue: 'file' });
    expect(submenu.state.buffer).toBe('s');
  });

  it('cycles enabled root menu items when typeahead repeats the same key', () => {
    const first = menubarTypeahead({ activeValue: 'file', items: menubarItems }, 'f', {
      now: 100,
    });
    const second = menubarTypeahead({ activeValue: 'format', items: menubarItems }, 'f', {
      now: 300,
      state: first.state,
    });

    expect(first).toMatchObject({ activeIndex: 1, activeValue: 'format' });
    expect(first.state.buffer).toBe('f');
    expect(second).toMatchObject({ activeIndex: 0, activeValue: 'file' });
    expect(second.state.buffer).toBe('f');
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const triggerEvent = new Event('click', { cancelable: true });
    triggerEvent.preventDefault();
    const pointerEvent = new Event('pointerenter', { cancelable: true });
    pointerEvent.preventDefault();
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

    expect(
      menubarSubmenuTriggerClick(triggerEvent, { itemValue: 'file' }, options),
    ).toBeUndefined();
    expect(
      menubarItemPointerEnter(
        pointerEvent,
        { contentId: 'file-menu', itemValue: 'file', openValue: 'view' },
        options,
      ),
    ).toBeUndefined();
    expect(
      menubarItemClick(itemEvent, { itemValue: 'new', openValue: 'file' }, options),
    ).toBeUndefined();
    expect(
      menubarItemKeyDown(itemKeyEvent, { itemValue: 'new', openValue: 'file' }, options),
    ).toBeUndefined();
    expect(menubarKeyDown(keyEvent, { openValue: 'file' }, options)).toBeUndefined();
  });

  it('selects submenu items from keyboard activation keys', () => {
    const seen: string[] = [];
    const enterEvent = keydownEvent('Enter');
    const spaceEvent = keydownEvent(' ');
    const legacySpaceEvent = keydownEvent('Spacebar');

    expect(
      menubarItemKeyDown(
        enterEvent,
        {
          activeValue: 'new',
          itemParentValue: 'file',
          itemValue: 'new',
          items: menubarItems,
          openValue: 'file',
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
      open: { changed: true, openValue: undefined },
      selected: true,
      value: 'new',
    });
    expect(enterEvent.defaultPrevented).toBe(true);

    expect(
      menubarItemKeyDown(spaceEvent, {
        itemParentValue: 'file',
        itemValue: 'save',
        items: menubarItems,
        openValue: 'file',
      }),
    ).toMatchObject({ selected: true, value: 'save' });
    expect(spaceEvent.defaultPrevented).toBe(true);

    expect(
      menubarItemKeyDown(legacySpaceEvent, {
        itemParentValue: 'view',
        itemValue: 'zoom-in',
        items: menubarItems,
        openValue: 'view',
      }),
    ).toMatchObject({ selected: true, value: 'zoom-in' });
    expect(legacySpaceEvent.defaultPrevented).toBe(true);
    expect(seen).toEqual(['select:keyboard:new', 'open:item-select:undefined']);
    expect(
      menubarItemKeyDown(keydownEvent('ArrowDown'), {
        itemValue: 'new',
        items: menubarItems,
        openValue: 'file',
      }),
    ).toBeUndefined();
  });

  it('keeps keyboard item activation cancelable and disabled-aware', () => {
    const disabledEvent = keydownEvent('Enter');
    const disabledResult = menubarItemKeyDown(disabledEvent, {
      itemParentValue: 'file',
      itemValue: 'open',
      items: menubarItems,
      openValue: 'file',
    });
    expect(disabledResult).toEqual({
      open: { changed: false, openValue: 'file' },
      selected: false,
      value: 'open',
    });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = keydownEvent(' ');
    const canceledResult = menubarItemKeyDown(
      canceledEvent,
      {
        itemParentValue: 'file',
        itemValue: 'new',
        items: menubarItems,
        openValue: 'file',
      },
      {
        onSelect(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledResult?.selected).toBe(false);
    expect(canceledResult?.open.openValue).toBe('file');
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('uses handler reasons and prevents native actions when disabled or canceled', () => {
    const reasons: string[] = [];
    const triggerResult = menubarSubmenuTriggerClick(
      new Event('click', { cancelable: true }),
      { contentId: 'file-menu', itemValue: 'file' },
      {
        onOpenChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(triggerResult).toMatchObject({ changed: true, openValue: 'file' });
    expect(reasons).toEqual(['item-click']);

    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = menubarSubmenuTriggerClick(disabledEvent, {
      disabled: true,
      itemValue: 'file',
    });
    expect(disabledResult).toEqual({ changed: false, openValue: undefined });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const pointerResult = menubarItemPointerEnter(new Event('pointerenter', { cancelable: true }), {
      contentId: 'view-menu',
      itemValue: 'view',
      openValue: 'file',
    });
    expect(pointerResult).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'item-pointer-enter', value: 'view' }),
      openValue: 'view',
    });

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = menubarItemClick(
      canceledEvent,
      { itemValue: 'new', openValue: 'file' },
      {
        onSelect(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledResult?.selected).toBe(false);
    expect(canceledResult?.open.openValue).toBe('file');
    expect(canceledEvent.defaultPrevented).toBe(true);

    const escapeEvent = keydownEvent('Escape');
    expect(menubarKeyDown(escapeEvent, { openValue: 'file' })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'escape-key', value: undefined }),
      openValue: undefined,
    });
    expect(escapeEvent.defaultPrevented).toBe(true);

    const arrowEvent = keydownEvent('ArrowDown');
    expect(
      menubarKeyDown(arrowEvent, {
        activeValue: 'file',
        items: menubarItems,
      }),
    ).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'item-keyboard', value: 'file' }),
      openValue: 'file',
    });
    expect(arrowEvent.defaultPrevented).toBe(true);
    expect(menubarKeyDown(keydownEvent('Enter'), { openValue: 'file' })).toBeUndefined();
  });

  it('exports menubar helpers from package and primitives barrels', () => {
    expect(exportedMenubarGroupAttributes).toBe(menubarGroupAttributes);
    expect(exportedMenubarItemAttributes).toBe(menubarItemAttributes);
    expect(exportedMenubarItemClick).toBe(menubarItemClick);
    expect(exportedMenubarItemHighlighted).toBe(menubarItemHighlighted);
    expect(exportedMenubarItemKeyDown).toBe(menubarItemKeyDown);
    expect(exportedMenubarItemOpen).toBe(menubarItemOpen);
    expect(exportedMenubarItemPointerEnter).toBe(menubarItemPointerEnter);
    expect(exportedMenubarKeyDown).toBe(menubarKeyDown);
    expect(exportedMenubarMove).toBe(menubarMove);
    expect(exportedMenubarRootAttributes).toBe(menubarRootAttributes);
    expect(exportedMenubarSeparatorAttributes).toBe(menubarSeparatorAttributes);
    expect(exportedMenubarSubmenuAttributes).toBe(menubarSubmenuAttributes);
    expect(exportedMenubarSubmenuTriggerClick).toBe(menubarSubmenuTriggerClick);
    expect(exportedMenubarTypeahead).toBe(menubarTypeahead);
    expect(exportedSelectMenubarItem).toBe(selectMenubarItem);
    expect(exportedSetMenubarOpenValue).toBe(setMenubarOpenValue);
    expect(exportedToggleMenubarOpenValue).toBe(toggleMenubarOpenValue);
    expect(primitiveMenubarRootAttributes).toBe(menubarRootAttributes);
  });
});

function keydownEvent(key: string): Event & { readonly key: string } {
  return Object.assign(new Event('keydown', { cancelable: true }), { key });
}
