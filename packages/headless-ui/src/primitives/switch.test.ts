import { describe, expect, it } from 'vitest';

import {
  setSwitchChecked as exportedSetSwitchChecked,
  switchRootAttributes as exportedSwitchRootAttributes,
  switchTriggerClick as exportedSwitchTriggerClick,
  toggleSwitch as exportedToggleSwitch,
} from '../index.js';
import {
  setSwitchChecked,
  switchRootAttributes,
  switchTriggerClick,
  toggleSwitch,
} from './switch.js';

describe('headless-ui switch primitive', () => {
  it('builds native checkbox-backed switch attributes for on and off states', () => {
    expect(switchRootAttributes({ checked: true, name: 'marketing', value: 'yes' })).toEqual({
      'aria-checked': 'true',
      checked: true,
      'data-state': 'checked',
      disabled: false,
      name: 'marketing',
      role: 'switch',
      type: 'checkbox',
      value: 'yes',
    });

    expect(switchRootAttributes({ checked: false, disabled: true })).toEqual({
      'aria-checked': 'false',
      checked: false,
      'data-disabled': '',
      'data-state': 'unchecked',
      disabled: true,
      role: 'switch',
      type: 'checkbox',
    });
  });

  it('keeps required form-control semantics on the native control', () => {
    expect(switchRootAttributes({ checked: false, required: true })).toEqual({
      'aria-checked': 'false',
      checked: false,
      'data-state': 'unchecked',
      disabled: false,
      required: true,
      role: 'switch',
      type: 'checkbox',
    });
  });

  it('dispatches a cancelable checked change detail before committing state', () => {
    const seen: string[] = [];
    const result = setSwitchChecked({ checked: false }, true, 'programmatic', {
      onCheckedChange(detail) {
        seen.push(`${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['programmatic:true']);
    expect(result.changed).toBe(true);
    expect(result.checked).toBe(true);
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous state when a change detail is prevented', () => {
    const result = setSwitchChecked({ checked: false }, true, 'trigger-click', {
      onCheckedChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.checked).toBe(false);
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled or unchanged states', () => {
    let callCount = 0;
    const onCheckedChange = () => {
      callCount += 1;
    };

    expect(
      setSwitchChecked({ checked: false, disabled: true }, true, 'programmatic', {
        onCheckedChange,
      }),
    ).toEqual({ changed: false, checked: false });
    expect(setSwitchChecked({ checked: true }, true, 'programmatic', { onCheckedChange })).toEqual({
      changed: false,
      checked: true,
    });
    expect(callCount).toBe(0);
  });

  it('toggles checked state', () => {
    expect(toggleSwitch({ checked: false }, 'programmatic')).toMatchObject({
      changed: true,
      checked: true,
    });
    expect(toggleSwitch({ checked: true }, 'programmatic')).toMatchObject({
      changed: true,
      checked: false,
    });
  });

  it('guards the primitive trigger handler when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = switchTriggerClick(
      event,
      { checked: false },
      {
        onCheckedChange() {
          throw new Error('change should not dispatch after defaultPrevented');
        },
      },
    );

    expect(result).toBeUndefined();
  });

  it('uses trigger-click as the handler change reason', () => {
    const reasons: string[] = [];
    const result = switchTriggerClick(
      new Event('click', { cancelable: true }),
      { checked: false },
      {
        onCheckedChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(result).toMatchObject({ changed: true, checked: true });
    expect(reasons).toEqual(['trigger-click']);
  });

  it('prevents default action when disabled or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = switchTriggerClick(disabledEvent, {
      checked: false,
      disabled: true,
    });

    expect(disabledResult).toEqual({ changed: false, checked: false });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = switchTriggerClick(
      canceledEvent,
      { checked: false },
      {
        onCheckedChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, checked: false });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(switchRootAttributes({ checked: true }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedSetSwitchChecked).toBe(setSwitchChecked);
    expect(exportedSwitchRootAttributes).toBe(switchRootAttributes);
    expect(exportedSwitchTriggerClick).toBe(switchTriggerClick);
    expect(exportedToggleSwitch).toBe(toggleSwitch);
  });
});
