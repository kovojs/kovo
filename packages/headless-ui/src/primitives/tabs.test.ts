import { describe, expect, it } from 'vitest';

import {
  setTabsValue as exportedSetTabsValue,
  tabsItemSelected as exportedTabsItemSelected,
  tabsKeyDown as exportedTabsKeyDown,
  tabsListAttributes as exportedTabsListAttributes,
  tabsMoveFocus as exportedTabsMoveFocus,
  tabsPanelAttributes as exportedTabsPanelAttributes,
  tabsRootAttributes as exportedTabsRootAttributes,
  tabsRovingIndex as exportedTabsRovingIndex,
  tabsTriggerAttributes as exportedTabsTriggerAttributes,
  tabsTriggerClick as exportedTabsTriggerClick,
} from '../index.js';
import {
  setTabsValue,
  tabsItemSelected,
  tabsKeyDown,
  tabsListAttributes,
  tabsMoveFocus,
  tabsPanelAttributes,
  tabsRootAttributes,
  tabsRovingIndex,
  tabsTriggerAttributes,
  tabsTriggerClick,
  type TabsItem,
} from './tabs.js';

const billingItems: readonly TabsItem[] = Object.freeze([
  { value: 'card' },
  { disabled: true, value: 'invoice' },
  { value: 'wire' },
]);

describe('headless-ui tabs primitive', () => {
  it('builds root and tablist attributes for grouped tab semantics', () => {
    expect(tabsRootAttributes({ id: 'billing-tabs', value: 'card' })).toEqual({
      'data-orientation': 'horizontal',
      id: 'billing-tabs',
    });

    expect(
      tabsListAttributes({
        descriptionId: 'billing-help',
        disabled: true,
        labelledBy: 'billing-label',
        orientation: 'vertical',
      }),
    ).toEqual({
      'aria-describedby': 'billing-help',
      'aria-disabled': 'true',
      'aria-labelledby': 'billing-label',
      'aria-orientation': 'vertical',
      'data-disabled': '',
      'data-orientation': 'vertical',
      role: 'tablist',
    });
  });

  it('builds native button triggers and tab panels with active state wiring', () => {
    const state = {
      items: billingItems,
      value: 'card',
    };

    expect(
      tabsTriggerAttributes({
        ...state,
        id: 'card-tab',
        itemValue: 'card',
        panelId: 'card-panel',
      }),
    ).toEqual({
      'aria-controls': 'card-panel',
      'aria-selected': 'true',
      'data-state': 'active',
      disabled: false,
      id: 'card-tab',
      role: 'tab',
      tabIndex: 0,
      type: 'button',
      value: 'card',
    });
    expect(tabsPanelAttributes({ ...state, id: 'card-panel', itemValue: 'card' })).toEqual({
      'data-state': 'active',
      hidden: false,
      id: 'card-panel',
      role: 'tabpanel',
      tabIndex: 0,
    });

    expect(tabsTriggerAttributes({ ...state, itemValue: 'invoice' })).toEqual({
      'aria-selected': 'false',
      'data-disabled': '',
      'data-state': 'inactive',
      disabled: true,
      role: 'tab',
      tabIndex: -1,
      type: 'button',
      value: 'invoice',
    });
    expect(tabsPanelAttributes({ ...state, itemValue: 'wire', triggerId: 'wire-tab' })).toEqual({
      'aria-labelledby': 'wire-tab',
      'data-state': 'inactive',
      hidden: true,
      role: 'tabpanel',
    });
  });

  it('falls back roving tabindex to the first enabled tab when nothing is selected', () => {
    expect(tabsRovingIndex({ items: billingItems })).toBe(0);
    expect(tabsTriggerAttributes({ items: billingItems, itemValue: 'card' })).toMatchObject({
      tabIndex: 0,
    });
    expect(tabsTriggerAttributes({ items: billingItems, itemValue: 'wire' })).toMatchObject({
      tabIndex: -1,
    });
  });

  it('dispatches cancelable value changes before committing state', () => {
    const seen: string[] = [];
    const result = setTabsValue({ value: 'card' }, 'wire', 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${String(detail.value)}`);
      },
    });

    expect(seen).toEqual(['programmatic:wire']);
    expect(result.changed).toBe(true);
    expect(result.value).toBe('wire');
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous value when a value change is prevented', () => {
    const result = setTabsValue({ value: 'card' }, 'wire', 'trigger-click', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.value).toBe('card');
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled, item-disabled, or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      setTabsValue({ disabled: true, value: 'card' }, 'wire', 'programmatic', { onValueChange }),
    ).toEqual({ changed: false, value: 'card' });
    expect(
      setTabsValue({ items: billingItems, value: 'card' }, 'invoice', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'card' });
    expect(setTabsValue({ value: 'card' }, 'card', 'programmatic', { onValueChange })).toEqual({
      changed: false,
      value: 'card',
    });
    expect(callCount).toBe(0);
  });

  it('moves focus with roving keyboard navigation and skips disabled tabs', () => {
    expect(tabsMoveFocus({ items: billingItems, value: 'card' }, 'next')).toEqual({
      index: 2,
      value: 'wire',
    });
    expect(tabsMoveFocus({ items: billingItems, loop: false, value: 'wire' }, 'next')).toEqual({
      index: 2,
      value: 'wire',
    });
  });

  it('activates focused tabs automatically from keyboard navigation by default', () => {
    const reasons: string[] = [];
    const event = tabsKeyboardEvent('ArrowRight');
    const result = tabsKeyDown(
      event,
      { items: billingItems, value: 'card' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(result).toMatchObject({
      activeValue: 'wire',
      changed: true,
      index: 2,
      value: 'wire',
    });
    expect(reasons).toEqual(['keyboard']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps selection unchanged for manual keyboard activation', () => {
    const event = tabsKeyboardEvent('ArrowRight');
    const result = tabsKeyDown(event, {
      activationMode: 'manual',
      items: billingItems,
      value: 'card',
    });

    expect(result).toEqual({
      activeValue: 'wire',
      changed: false,
      index: 2,
      value: 'card',
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not clear selection when keyboard navigation has no enabled tab target', () => {
    const event = tabsKeyboardEvent('ArrowRight');
    const result = tabsKeyDown(event, {
      items: [{ disabled: true, value: 'invoice' }],
      value: 'invoice',
    });

    expect(result).toEqual({
      activeValue: undefined,
      changed: false,
      index: -1,
      value: 'invoice',
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const clickEvent = new Event('click', { cancelable: true });
    clickEvent.preventDefault();

    expect(
      tabsTriggerClick(
        clickEvent,
        { itemValue: 'wire', value: 'card' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();

    const keyEvent = tabsKeyboardEvent('ArrowRight');
    keyEvent.preventDefault();
    expect(
      tabsKeyDown(
        keyEvent,
        { items: billingItems, value: 'card' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('uses trigger-click change reasons and prevents native button behavior when needed', () => {
    const reasons: string[] = [];
    const clickResult = tabsTriggerClick(
      new Event('click', { cancelable: true }),
      { itemValue: 'wire', value: 'card' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(clickResult).toMatchObject({ changed: true, value: 'wire' });
    expect(reasons).toEqual(['trigger-click']);

    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = tabsTriggerClick(disabledEvent, {
      itemDisabled: true,
      itemValue: 'wire',
      value: 'card',
    });

    expect(disabledResult).toEqual({ changed: false, value: 'card' });
    expect(disabledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records and exposes selection helpers', () => {
    expect(Object.isFrozen(tabsRootAttributes())).toBe(true);
    expect(Object.isFrozen(tabsTriggerAttributes({ itemValue: 'card' }))).toBe(true);
    expect(tabsItemSelected({ itemValue: 'card', value: 'card' })).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedTabsRootAttributes).toBe(tabsRootAttributes);
    expect(exportedTabsListAttributes).toBe(tabsListAttributes);
    expect(exportedTabsTriggerAttributes).toBe(tabsTriggerAttributes);
    expect(exportedTabsPanelAttributes).toBe(tabsPanelAttributes);
    expect(exportedSetTabsValue).toBe(setTabsValue);
    expect(exportedTabsMoveFocus).toBe(tabsMoveFocus);
    expect(exportedTabsRovingIndex).toBe(tabsRovingIndex);
    expect(exportedTabsItemSelected).toBe(tabsItemSelected);
    expect(exportedTabsTriggerClick).toBe(tabsTriggerClick);
    expect(exportedTabsKeyDown).toBe(tabsKeyDown);
  });
});

function tabsKeyboardEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}
