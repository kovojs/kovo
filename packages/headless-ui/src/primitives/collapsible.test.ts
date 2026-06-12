import { describe, expect, it } from 'vitest';

import {
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
  collapsibleTriggerClick,
  setCollapsibleOpen,
  toggleCollapsible,
} from './collapsible.js';

describe('headless-ui collapsible primitive', () => {
  it('builds details, summary, and content attributes from shared state helpers', () => {
    expect(collapsibleRootAttributes({ open: true })).toEqual({
      'data-state': 'open',
      open: true,
    });
    expect(collapsibleRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
      open: false,
    });

    expect(collapsibleTriggerAttributes({ contentId: 'filters-panel', open: true })).toEqual({
      'aria-controls': 'filters-panel',
      'aria-expanded': 'true',
      'data-state': 'open',
    });
    expect(collapsibleTriggerAttributes({ disabled: true, open: false })).toEqual({
      'aria-expanded': 'false',
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(collapsibleContentAttributes({ contentId: 'filters-panel', open: false })).toEqual({
      'data-state': 'closed',
      id: 'filters-panel',
    });
  });

  it('dispatches a cancelable open change detail before committing state', () => {
    const seen: string[] = [];
    const result = setCollapsibleOpen({ open: false }, true, 'programmatic', {
      onOpenChange(detail) {
        seen.push(`${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['programmatic:true']);
    expect(result.changed).toBe(true);
    expect(result.open).toBe(true);
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous state when a change detail is prevented', () => {
    const result = toggleCollapsible({ open: false }, 'trigger-click', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.open).toBe(false);
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled or unchanged states', () => {
    let callCount = 0;
    const onOpenChange = () => {
      callCount += 1;
    };

    expect(
      setCollapsibleOpen({ disabled: true, open: false }, true, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, open: false });
    expect(setCollapsibleOpen({ open: true }, true, 'programmatic', { onOpenChange })).toEqual({
      changed: false,
      open: true,
    });
    expect(callCount).toBe(0);
  });

  it('guards the primitive trigger handler when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = collapsibleTriggerClick(
      event,
      { open: false },
      {
        onOpenChange() {
          throw new Error('change should not dispatch after defaultPrevented');
        },
      },
    );

    expect(result).toBeUndefined();
  });

  it('uses trigger-click as the handler change reason', () => {
    const reasons: string[] = [];
    const result = collapsibleTriggerClick(
      new Event('click', { cancelable: true }),
      { open: false },
      {
        onOpenChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(result).toMatchObject({ changed: true, open: true });
    expect(reasons).toEqual(['trigger-click']);
  });

  it('prevents native details toggling when disabled or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = collapsibleTriggerClick(disabledEvent, {
      disabled: true,
      open: false,
    });

    expect(disabledResult).toEqual({ changed: false, open: false });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = collapsibleTriggerClick(
      canceledEvent,
      { open: false },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, open: false });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });
});
