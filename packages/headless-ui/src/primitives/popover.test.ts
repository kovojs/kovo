import { describe, expect, it } from 'vitest';

import {
  popoverBeforeToggle as exportedPopoverBeforeToggle,
  popoverContentAttributes as exportedPopoverContentAttributes,
  popoverEscapeKeyDown as exportedPopoverEscapeKeyDown,
  popoverRootAttributes as exportedPopoverRootAttributes,
  popoverTriggerAttributes as exportedPopoverTriggerAttributes,
  popoverTriggerClick as exportedPopoverTriggerClick,
  setPopoverOpen as exportedSetPopoverOpen,
  togglePopover as exportedTogglePopover,
} from './popover.js';
import {
  popoverBeforeToggle,
  popoverContentAttributes,
  popoverEscapeKeyDown,
  popoverRootAttributes,
  popoverTriggerAttributes,
  popoverTriggerClick,
  setPopoverOpen,
  togglePopover,
} from './popover.js';

describe('headless-ui popover primitive', () => {
  it('builds root, trigger, and native popover content attributes', () => {
    expect(popoverRootAttributes({ open: true })).toEqual({
      'data-state': 'open',
    });
    expect(popoverRootAttributes({ disabled: true, open: false })).toEqual({
      'data-disabled': '',
      'data-state': 'closed',
    });

    expect(popoverTriggerAttributes({ contentId: 'account-menu', open: true })).toEqual({
      'aria-controls': 'account-menu',
      'aria-expanded': 'true',
      'data-state': 'open',
      disabled: false,
      popovertarget: 'account-menu',
      popovertargetaction: 'toggle',
      type: 'button',
    });
    expect(popoverTriggerAttributes({ contentId: 'account-menu', open: false })).toEqual({
      'aria-controls': 'account-menu',
      'aria-expanded': 'false',
      'data-state': 'closed',
      disabled: false,
      popovertarget: 'account-menu',
      popovertargetaction: 'toggle',
      type: 'button',
    });
    expect(
      popoverTriggerAttributes({ contentId: 'account-menu', disabled: true, open: false }),
    ).toEqual({
      'aria-expanded': 'false',
      'data-disabled': '',
      'data-state': 'closed',
      disabled: true,
      type: 'button',
    });

    expect(popoverContentAttributes({ contentId: 'account-menu', open: true })).toEqual({
      'data-state': 'open',
      id: 'account-menu',
      popover: 'auto',
    });
    expect(popoverContentAttributes({ contentId: 'account-menu', open: false })).toEqual({
      'data-state': 'closed',
      id: 'account-menu',
      popover: 'auto',
    });
  });

  it('dispatches a cancelable open change detail before committing state', () => {
    const seen: string[] = [];
    const result = setPopoverOpen({ open: false }, true, 'programmatic', {
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
    const result = togglePopover({ open: false }, 'trigger-click', {
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
      setPopoverOpen({ disabled: true, open: false }, true, 'programmatic', {
        onOpenChange,
      }),
    ).toEqual({ changed: false, open: false });
    expect(setPopoverOpen({ open: true }, true, 'programmatic', { onOpenChange })).toEqual({
      changed: false,
      open: true,
    });
    expect(callCount).toBe(0);
  });

  it('guards primitive trigger handlers when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = popoverTriggerClick(
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

  it('uses trigger-click as the trigger handler change reason', () => {
    const reasons: string[] = [];
    const result = popoverTriggerClick(
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

  it('prevents native trigger toggling when disabled or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = popoverTriggerClick(disabledEvent, {
      disabled: true,
      open: false,
    });

    expect(disabledResult).toEqual({ changed: false, open: false });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = popoverTriggerClick(
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

  it('syncs native beforetoggle transitions and allows them to be canceled', () => {
    const reasons: string[] = [];
    const openEvent = beforeToggleEvent('open', true);
    const openResult = popoverBeforeToggle(
      openEvent,
      { open: false },
      {
        onOpenChange(detail) {
          reasons.push(`${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(openResult).toMatchObject({ changed: true, open: true });
    expect(openEvent.defaultPrevented).toBe(false);
    expect(reasons).toEqual(['native-beforetoggle:true']);

    const canceledEvent = beforeToggleEvent('closed', true);
    const canceledResult = popoverBeforeToggle(
      canceledEvent,
      { open: true },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, open: true });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
    expect(popoverBeforeToggle(beforeToggleEvent(undefined), { open: true })).toBeUndefined();
  });

  it('closes on Escape and ignores other keys', () => {
    const escapeEvent = keydownEvent('Escape');
    const result = popoverEscapeKeyDown(escapeEvent, { open: true });

    expect(result).toEqual(
      expect.objectContaining({
        changed: true,
        open: false,
      }),
    );
    expect(result?.detail?.reason).toBe('escape-key');
    expect(popoverEscapeKeyDown(keydownEvent('Enter'), { open: true })).toBeUndefined();
  });

  it('prevents default on Escape when closing is disabled or canceled', () => {
    const disabledEvent = keydownEvent('Escape', true);
    const disabledResult = popoverEscapeKeyDown(disabledEvent, {
      disabled: true,
      open: true,
    });

    expect(disabledResult).toEqual({ changed: false, open: true });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = keydownEvent('Escape', true);
    const canceledResult = popoverEscapeKeyDown(
      canceledEvent,
      { open: true },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, open: true });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(popoverRootAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(popoverTriggerAttributes({ open: true }))).toBe(true);
    expect(Object.isFrozen(popoverContentAttributes({ open: true }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedPopoverBeforeToggle).toBe(popoverBeforeToggle);
    expect(exportedPopoverContentAttributes).toBe(popoverContentAttributes);
    expect(exportedPopoverEscapeKeyDown).toBe(popoverEscapeKeyDown);
    expect(exportedPopoverRootAttributes).toBe(popoverRootAttributes);
    expect(exportedPopoverTriggerAttributes).toBe(popoverTriggerAttributes);
    expect(exportedPopoverTriggerClick).toBe(popoverTriggerClick);
    expect(exportedSetPopoverOpen).toBe(setPopoverOpen);
    expect(exportedTogglePopover).toBe(togglePopover);
  });
});

function keydownEvent(key: string, cancelable = false): Event & Readonly<{ key: string }> {
  return Object.assign(new Event('keydown', { cancelable }), { key });
}

function beforeToggleEvent(
  newState: 'closed' | 'open' | undefined,
  cancelable = false,
): Event & Readonly<{ newState?: 'closed' | 'open' }> {
  return Object.assign(
    new Event('beforetoggle', { cancelable }),
    newState === undefined ? {} : { newState },
  );
}
