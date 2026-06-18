import { describe, expect, it } from 'vitest';

import {
  setToggleGroupValue as exportedSetToggleGroupValue,
  toggleGroupButtonAttributes as exportedToggleGroupButtonAttributes,
  toggleGroupItemAttributes as exportedToggleGroupItemAttributes,
  toggleGroupItemClick as exportedToggleGroupItemClick,
  toggleGroupItemPressed as exportedToggleGroupItemPressed,
  toggleGroupItemValue as exportedToggleGroupItemValue,
  toggleGroupKeyDown as exportedToggleGroupKeyDown,
  toggleGroupMoveFocus as exportedToggleGroupMoveFocus,
  toggleGroupRootAttributes as exportedToggleGroupRootAttributes,
  toggleGroupRovingIndex as exportedToggleGroupRovingIndex,
} from './toggle-group.js';
import {
  setToggleGroupValue,
  toggleGroupButtonAttributes,
  toggleGroupItemAttributes,
  toggleGroupItemClick,
  toggleGroupItemPressed,
  toggleGroupItemValue,
  toggleGroupKeyDown,
  toggleGroupMoveFocus,
  toggleGroupRootAttributes,
  toggleGroupRovingIndex,
  type ToggleGroupItem,
} from './toggle-group.js';

const alignmentItems: readonly ToggleGroupItem[] = Object.freeze([
  { value: 'left' },
  { disabled: true, value: 'center' },
  { value: 'right' },
]);

describe('headless-ui toggle-group primitive', () => {
  it('builds root attributes for grouped toggle button semantics', () => {
    expect(
      toggleGroupRootAttributes({
        descriptionId: 'alignment-help',
        id: 'alignment',
        labelledBy: 'alignment-label',
        orientation: 'vertical',
      }),
    ).toEqual({
      'aria-describedby': 'alignment-help',
      'aria-labelledby': 'alignment-label',
      'data-orientation': 'vertical',
      id: 'alignment',
      role: 'group',
    });

    expect(toggleGroupRootAttributes({ disabled: true })).toEqual({
      'aria-disabled': 'true',
      'data-disabled': '',
      'data-orientation': 'horizontal',
      role: 'group',
    });
  });

  it('builds item and native button attributes with roving tabindex', () => {
    const state = {
      items: alignmentItems,
      value: 'left',
    };

    expect(toggleGroupItemAttributes({ ...state, id: 'left-item', itemValue: 'left' })).toEqual({
      'data-state': 'pressed',
      id: 'left-item',
    });
    expect(toggleGroupButtonAttributes({ ...state, id: 'left-button', itemValue: 'left' })).toEqual(
      {
        'aria-pressed': 'true',
        'data-state': 'pressed',
        disabled: false,
        id: 'left-button',
        tabIndex: 0,
        type: 'button',
        value: 'left',
      },
    );
    expect(toggleGroupButtonAttributes({ ...state, itemValue: 'center' })).toEqual({
      'aria-pressed': 'false',
      'data-disabled': '',
      'data-state': 'off',
      disabled: true,
      tabIndex: -1,
      type: 'button',
      value: 'center',
    });
  });

  it('supports multiple pressed values', () => {
    const state = {
      items: alignmentItems,
      type: 'multiple' as const,
      value: ['left', 'right'] as const,
    };

    expect(toggleGroupItemPressed({ ...state, itemValue: 'right' })).toBe(true);
    expect(toggleGroupButtonAttributes({ ...state, itemValue: 'right' })).toMatchObject({
      'aria-pressed': 'true',
      'data-state': 'pressed',
      tabIndex: -1,
    });
  });

  it('dispatches cancelable value changes before committing state', () => {
    const seen: string[] = [];
    const result = setToggleGroupValue({ value: 'left' }, 'right', 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${String(detail.value)}`);
      },
    });

    expect(seen).toEqual(['programmatic:right']);
    expect(result.changed).toBe(true);
    expect(result.value).toBe('right');
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous value when a value change is prevented', () => {
    const result = toggleGroupItemValue({ itemValue: 'right', value: 'left' }, 'item-click', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.value).toBe('left');
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('toggles single and multiple item values', () => {
    expect(toggleGroupItemValue({ itemValue: 'right', value: 'left' }, 'programmatic')).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'programmatic', value: 'right' }),
      value: 'right',
    });
    expect(
      toggleGroupItemValue({ collapsible: true, itemValue: 'left', value: 'left' }, 'programmatic'),
    ).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'programmatic', value: undefined }),
      value: undefined,
    });
    expect(
      toggleGroupItemValue(
        { itemValue: 'bold', type: 'multiple', value: ['italic'] },
        'programmatic',
      ),
    ).toMatchObject({ changed: true, value: ['italic', 'bold'] });
    expect(
      toggleGroupItemValue(
        { itemValue: 'italic', type: 'multiple', value: ['italic', 'bold'] },
        'programmatic',
      ),
    ).toMatchObject({ changed: true, value: ['bold'] });
  });

  it('does not dispatch changes for disabled, item-disabled, or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      toggleGroupItemValue({ disabled: true, itemValue: 'right', value: 'left' }, 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'left' });
    expect(
      toggleGroupItemValue(
        { itemDisabled: true, itemValue: 'right', value: 'left' },
        'programmatic',
        {
          onValueChange,
        },
      ),
    ).toEqual({ changed: false, value: 'left' });
    expect(
      setToggleGroupValue({ value: 'left' }, 'left', 'programmatic', { onValueChange }),
    ).toEqual({
      changed: false,
      value: 'left',
    });
    expect(callCount).toBe(0);
  });

  it('moves focus with roving keyboard navigation without changing pressed value', () => {
    expect(toggleGroupRovingIndex({ items: alignmentItems, value: 'left' })).toBe(0);
    expect(
      toggleGroupMoveFocus(
        {
          items: alignmentItems,
          value: 'left',
        },
        'next',
      ),
    ).toEqual({ index: 2, value: 'right' });

    expect(
      toggleGroupMoveFocus(
        {
          activeValue: 'right',
          items: alignmentItems,
          loop: false,
          value: 'left',
        },
        'next',
      ),
    ).toEqual({ index: 2, value: 'right' });
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const clickEvent = new Event('click', { cancelable: true });
    clickEvent.preventDefault();

    expect(
      toggleGroupItemClick(
        clickEvent,
        { itemValue: 'right', value: 'left' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();

    const keyEvent = toggleGroupKeyboardEvent('ArrowRight');
    keyEvent.preventDefault();
    expect(toggleGroupKeyDown(keyEvent, { items: alignmentItems, value: 'left' })).toBeUndefined();
  });

  it('uses item-click change reasons and prevents native button changes when needed', () => {
    const reasons: string[] = [];
    const clickResult = toggleGroupItemClick(
      new Event('click', { cancelable: true }),
      { itemValue: 'right', value: 'left' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(clickResult).toMatchObject({ changed: true, value: 'right' });
    expect(reasons).toEqual(['item-click']);

    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = toggleGroupItemClick(disabledEvent, {
      itemDisabled: true,
      itemValue: 'right',
      value: 'left',
    });

    expect(disabledResult).toEqual({ changed: false, value: 'left' });
    expect(disabledEvent.defaultPrevented).toBe(true);
  });

  it('prevents default for handled keyboard navigation', () => {
    const event = toggleGroupKeyboardEvent('ArrowRight');
    const result = toggleGroupKeyDown(event, {
      items: alignmentItems,
      value: 'left',
    });

    expect(result).toEqual({ index: 2, value: 'right' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not trap keyboard events for disabled, empty, or fully disabled collections', () => {
    const disabledEvent = toggleGroupKeyboardEvent('ArrowRight');
    expect(
      toggleGroupKeyDown(disabledEvent, {
        activeValue: 'left',
        disabled: true,
        items: alignmentItems,
        value: 'left',
      }),
    ).toBeUndefined();
    expect(disabledEvent.defaultPrevented).toBe(false);

    const emptyEvent = toggleGroupKeyboardEvent('ArrowRight');
    expect(toggleGroupKeyDown(emptyEvent, { activeValue: 'left', items: [] })).toBeUndefined();
    expect(emptyEvent.defaultPrevented).toBe(false);

    const allDisabledEvent = toggleGroupKeyboardEvent('ArrowRight');
    expect(
      toggleGroupKeyDown(allDisabledEvent, {
        items: [{ disabled: true, value: 'only' }],
        value: 'only',
      }),
    ).toBeUndefined();
    expect(allDisabledEvent.defaultPrevented).toBe(false);
  });

  it('returns frozen attribute records and exposes selection helpers', () => {
    expect(Object.isFrozen(toggleGroupRootAttributes())).toBe(true);
    expect(Object.isFrozen(toggleGroupButtonAttributes({ itemValue: 'left' }))).toBe(true);
    expect(toggleGroupItemPressed({ itemValue: 'left', value: 'left' })).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedToggleGroupRootAttributes).toBe(toggleGroupRootAttributes);
    expect(exportedToggleGroupItemAttributes).toBe(toggleGroupItemAttributes);
    expect(exportedToggleGroupButtonAttributes).toBe(toggleGroupButtonAttributes);
    expect(exportedSetToggleGroupValue).toBe(setToggleGroupValue);
    expect(exportedToggleGroupItemValue).toBe(toggleGroupItemValue);
    expect(exportedToggleGroupMoveFocus).toBe(toggleGroupMoveFocus);
    expect(exportedToggleGroupRovingIndex).toBe(toggleGroupRovingIndex);
    expect(exportedToggleGroupItemPressed).toBe(toggleGroupItemPressed);
    expect(exportedToggleGroupItemClick).toBe(toggleGroupItemClick);
    expect(exportedToggleGroupKeyDown).toBe(toggleGroupKeyDown);
  });
});

function toggleGroupKeyboardEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}
