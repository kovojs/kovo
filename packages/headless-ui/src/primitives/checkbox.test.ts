import { describe, expect, it } from 'vitest';

import {
  applyCheckboxIndeterminate as exportedApplyCheckboxIndeterminate,
  checkboxRootAttributes as exportedCheckboxRootAttributes,
  checkboxTriggerClick as exportedCheckboxTriggerClick,
  setCheckboxChecked as exportedSetCheckboxChecked,
  toggleCheckbox as exportedToggleCheckbox,
} from './checkbox.js';
import {
  applyCheckboxIndeterminate,
  checkboxRootAttributes,
  checkboxTriggerClick,
  setCheckboxChecked,
  toggleCheckbox,
} from './checkbox.js';

describe('headless-ui checkbox primitive', () => {
  it('builds native checkbox input attributes for checked and unchecked states', () => {
    expect(checkboxRootAttributes({ checked: true, name: 'terms', value: 'yes' })).toEqual({
      'aria-checked': 'true',
      checked: true,
      'data-state': 'checked',
      disabled: false,
      name: 'terms',
      type: 'checkbox',
      value: 'yes',
    });

    expect(checkboxRootAttributes({ checked: false, disabled: true })).toEqual({
      'aria-checked': 'false',
      checked: false,
      'data-disabled': '',
      'data-state': 'unchecked',
      disabled: true,
      type: 'checkbox',
    });
  });

  it('marks indeterminate state without posting a checked native value', () => {
    expect(checkboxRootAttributes({ checked: 'indeterminate', required: true })).toEqual({
      'aria-checked': 'mixed',
      checked: false,
      'data-state': 'indeterminate',
      disabled: false,
      required: true,
      type: 'checkbox',
    });
  });

  it('applies mixed state through the native checkbox DOM property', () => {
    const input = { indeterminate: false };

    applyCheckboxIndeterminate(input, 'indeterminate');
    expect(input.indeterminate).toBe(true);

    applyCheckboxIndeterminate(input, true);
    expect(input.indeterminate).toBe(false);

    applyCheckboxIndeterminate(input, false);
    expect(input.indeterminate).toBe(false);
  });

  it('dispatches a cancelable checked change detail before committing state', () => {
    const seen: string[] = [];
    const result = setCheckboxChecked({ checked: false }, true, 'programmatic', {
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
    const result = setCheckboxChecked({ checked: false }, true, 'trigger-click', {
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
      setCheckboxChecked({ checked: false, disabled: true }, true, 'programmatic', {
        onCheckedChange,
      }),
    ).toEqual({ changed: false, checked: false });
    expect(
      setCheckboxChecked({ checked: true }, true, 'programmatic', { onCheckedChange }),
    ).toEqual({
      changed: false,
      checked: true,
    });
    expect(callCount).toBe(0);
  });

  it('toggles unchecked and indeterminate states to checked', () => {
    expect(toggleCheckbox({ checked: false }, 'programmatic')).toMatchObject({
      changed: true,
      checked: true,
    });
    expect(toggleCheckbox({ checked: 'indeterminate' }, 'programmatic')).toMatchObject({
      changed: true,
      checked: true,
    });
    expect(toggleCheckbox({ checked: true }, 'programmatic')).toMatchObject({
      changed: true,
      checked: false,
    });
  });

  it('guards the primitive trigger handler when author behavior prevented default', () => {
    const event = new Event('click', { cancelable: true });
    event.preventDefault();

    const result = checkboxTriggerClick(
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
    const result = checkboxTriggerClick(
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
    const disabledResult = checkboxTriggerClick(disabledEvent, {
      checked: false,
      disabled: true,
    });

    expect(disabledResult).toEqual({ changed: false, checked: false });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = checkboxTriggerClick(
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
    expect(Object.isFrozen(checkboxRootAttributes({ checked: true }))).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedApplyCheckboxIndeterminate).toBe(applyCheckboxIndeterminate);
    expect(exportedCheckboxRootAttributes).toBe(checkboxRootAttributes);
    expect(exportedCheckboxTriggerClick).toBe(checkboxTriggerClick);
    expect(exportedSetCheckboxChecked).toBe(setCheckboxChecked);
    expect(exportedToggleCheckbox).toBe(toggleCheckbox);
  });
});
