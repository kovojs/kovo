import { describe, expect, it } from 'vitest';

import {
  setTogglePressed as exportedSetTogglePressed,
  togglePressed as exportedTogglePressed,
  toggleRootAttributes as exportedToggleRootAttributes,
  toggleTriggerClick as exportedToggleTriggerClick,
} from '../index.js';
import {
  setTogglePressed,
  togglePressed,
  toggleRootAttributes,
  toggleTriggerClick,
} from './toggle.js';

describe('headless-ui toggle primitive', () => {
  it('builds native button attributes for pressed and unpressed states', () => {
    expect(toggleRootAttributes({ pressed: true })).toEqual({
      'aria-pressed': 'true',
      'data-state': 'pressed',
      disabled: false,
      type: 'button',
    });

    expect(toggleRootAttributes({ disabled: true, pressed: false })).toEqual({
      'aria-pressed': 'false',
      'data-disabled': '',
      'data-state': 'off',
      disabled: true,
      type: 'button',
    });
  });

  it('dispatches a cancelable pressed change detail before committing state', () => {
    const seen: string[] = [];
    const result = setTogglePressed({ pressed: false }, true, 'programmatic', {
      onPressedChange(detail) {
        seen.push(`${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['programmatic:true']);
    expect(result.changed).toBe(true);
    expect(result.pressed).toBe(true);
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous state when a change detail is prevented', () => {
    const result = togglePressed({ pressed: false }, 'trigger-click', {
      onPressedChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.pressed).toBe(false);
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled or unchanged states', () => {
    let callCount = 0;
    const onPressedChange = () => {
      callCount += 1;
    };

    expect(
      setTogglePressed({ disabled: true, pressed: false }, true, 'programmatic', {
        onPressedChange,
      }),
    ).toEqual({ changed: false, pressed: false });
    expect(setTogglePressed({ pressed: true }, true, 'programmatic', { onPressedChange })).toEqual({
      changed: false,
      pressed: true,
    });
    expect(callCount).toBe(0);
  });

  it('guards the primitive trigger handler when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = toggleTriggerClick(
      event,
      { pressed: false },
      {
        onPressedChange() {
          throw new Error('change should not dispatch after defaultPrevented');
        },
      },
    );

    expect(result).toBeUndefined();
  });

  it('uses trigger-click as the handler change reason', () => {
    const reasons: string[] = [];
    const result = toggleTriggerClick(
      new Event('click', { cancelable: true }),
      { pressed: false },
      {
        onPressedChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(result).toMatchObject({ changed: true, pressed: true });
    expect(reasons).toEqual(['trigger-click']);
  });

  it('prevents default action when disabled or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = toggleTriggerClick(disabledEvent, {
      disabled: true,
      pressed: false,
    });

    expect(disabledResult).toEqual({ changed: false, pressed: false });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = toggleTriggerClick(
      canceledEvent,
      { pressed: false },
      {
        onPressedChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, pressed: false });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(toggleRootAttributes({ pressed: true }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedSetTogglePressed).toBe(setTogglePressed);
    expect(exportedTogglePressed).toBe(togglePressed);
    expect(exportedToggleRootAttributes).toBe(toggleRootAttributes);
    expect(exportedToggleTriggerClick).toBe(toggleTriggerClick);
  });
});
