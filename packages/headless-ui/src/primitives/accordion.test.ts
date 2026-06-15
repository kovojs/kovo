import { describe, expect, it } from 'vitest';

import {
  accordionContentAttributes,
  accordionHeaderAttributes,
  accordionItemAttributes,
  accordionKeyDown,
  accordionItemOpen,
  accordionMoveFocus,
  accordionRootAttributes,
  accordionRovingIndex,
  accordionTriggerAttributes,
  accordionTriggerClick,
  setAccordionValue,
  toggleAccordionItem,
} from './accordion.js';

describe('headless-ui accordion primitive', () => {
  it('builds root, item, header, trigger, and content attributes', () => {
    expect(accordionRootAttributes({ orientation: 'horizontal', value: 'shipping' })).toEqual({
      'data-orientation': 'horizontal',
    });
    expect(accordionRootAttributes({ disabled: true, value: undefined })).toEqual({
      'data-disabled': '',
      'data-orientation': 'vertical',
    });

    expect(accordionItemAttributes({ itemValue: 'shipping', value: 'shipping' })).toEqual({
      'data-state': 'open',
      open: true,
    });
    expect(
      accordionHeaderAttributes({ itemDisabled: true, itemValue: 'shipping', level: 9 }),
    ).toEqual({
      'aria-level': 6,
      'data-disabled': '',
      'data-state': 'closed',
      role: 'heading',
    });

    expect(
      accordionTriggerAttributes({
        contentId: 'shipping-panel',
        itemValue: 'shipping',
        triggerId: 'shipping-trigger',
        value: 'shipping',
      }),
    ).toEqual({
      'aria-controls': 'shipping-panel',
      'aria-expanded': 'true',
      'data-state': 'open',
      disabled: false,
      id: 'shipping-trigger',
      tabIndex: 0,
      type: 'button',
    });

    expect(
      accordionContentAttributes({
        contentId: 'shipping-panel',
        itemValue: 'shipping',
        triggerId: 'shipping-trigger',
      }),
    ).toEqual({
      'aria-labelledby': 'shipping-trigger',
      'data-state': 'closed',
      hidden: true,
      id: 'shipping-panel',
      role: 'region',
    });
  });

  it('computes item open state for single and multiple accordions', () => {
    expect(accordionItemOpen({ itemValue: 'one', value: 'one' })).toBe(true);
    expect(accordionItemOpen({ itemValue: 'two', value: 'one' })).toBe(false);
    expect(accordionItemOpen({ itemValue: 'two', type: 'multiple', value: ['one', 'two'] })).toBe(
      true,
    );
  });

  it('computes roving focus across enabled accordion triggers', () => {
    const items = [{ value: 'shipping' }, { disabled: true, value: 'tax' }, { value: 'billing' }];

    expect(accordionRovingIndex({ items, value: 'shipping' })).toBe(0);
    expect(accordionRovingIndex({ activeValue: 'billing', items, value: 'shipping' })).toBe(2);
    expect(accordionMoveFocus({ items, value: 'shipping' }, 'next')).toEqual({
      index: 2,
      value: 'billing',
    });
    expect(accordionMoveFocus({ activeValue: 'billing', items, loop: false }, 'next')).toEqual({
      index: 2,
      value: 'billing',
    });
    expect(
      accordionTriggerAttributes({
        activeValue: 'billing',
        itemValue: 'shipping',
        items,
        value: 'shipping',
      }),
    ).toMatchObject({ tabIndex: -1 });
  });

  it('dispatches a cancelable value change detail before committing state', () => {
    const seen: string[] = [];
    const result = setAccordionValue({ value: 'one' }, 'two', 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${String(detail.value)}`);
      },
    });

    expect(seen).toEqual(['programmatic:two']);
    expect(result.changed).toBe(true);
    expect(result.value).toBe('two');
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('toggles single accordion items with optional collapsible behavior', () => {
    expect(toggleAccordionItem({ value: 'one' }, 'two', 'programmatic')).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'programmatic', value: 'two' }),
      value: 'two',
    });
    expect(toggleAccordionItem({ value: 'one' }, 'one', 'programmatic')).toEqual({
      changed: false,
      value: 'one',
    });
    expect(toggleAccordionItem({ collapsible: true, value: 'one' }, 'one', 'programmatic')).toEqual(
      {
        changed: true,
        detail: expect.objectContaining({ reason: 'programmatic', value: undefined }),
        value: undefined,
      },
    );
  });

  it('toggles multiple accordion item values', () => {
    const added = toggleAccordionItem({ type: 'multiple', value: ['one'] }, 'two', 'programmatic');
    const removed = toggleAccordionItem(
      { type: 'multiple', value: ['one', 'two'] },
      'one',
      'programmatic',
    );

    expect(added).toMatchObject({ changed: true, value: ['one', 'two'] });
    expect(removed).toMatchObject({ changed: true, value: ['two'] });
  });

  it('keeps the previous state when a change detail is prevented', () => {
    const result = toggleAccordionItem({ value: 'one' }, 'two', 'trigger-click', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.value).toBe('one');
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      setAccordionValue({ disabled: true, value: 'one' }, 'two', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'one' });
    expect(setAccordionValue({ value: 'one' }, 'one', 'programmatic', { onValueChange })).toEqual({
      changed: false,
      value: 'one',
    });
    expect(callCount).toBe(0);
  });

  it('guards the primitive trigger handler when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = accordionTriggerClick(
      event,
      { itemValue: 'two', value: 'one' },
      {
        onValueChange() {
          throw new Error('change should not dispatch after defaultPrevented');
        },
      },
    );

    expect(result).toBeUndefined();
  });

  it('uses trigger-click as the handler change reason', () => {
    const reasons: string[] = [];
    const result = accordionTriggerClick(
      new Event('click', { cancelable: true }),
      { itemValue: 'two', value: 'one' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(result).toMatchObject({ changed: true, value: 'two' });
    expect(reasons).toEqual(['trigger-click']);
  });

  it('prevents native summary toggling when disabled or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = accordionTriggerClick(disabledEvent, {
      itemDisabled: true,
      itemValue: 'two',
      value: 'one',
    });

    expect(disabledResult).toEqual({ changed: false, value: 'one' });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = accordionTriggerClick(
      canceledEvent,
      { itemValue: 'two', value: 'one' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, value: 'one' });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('maps keyboard navigation to roving focus movement', () => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'End' });
    const result = accordionKeyDown(event, {
      items: [{ value: 'shipping' }, { disabled: true, value: 'tax' }, { value: 'billing' }],
      value: 'shipping',
    });

    expect(result).toEqual({ index: 2, value: 'billing' });
    expect(event.defaultPrevented).toBe(true);
    expect(
      accordionKeyDown(Object.assign(new Event('keydown'), { key: 'Enter' }), {}),
    ).toBeUndefined();
  });
});
