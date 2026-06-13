import { describe, expect, it } from 'vitest';

import {
  otpFieldComplete as exportedOtpFieldComplete,
  otpFieldHiddenInputAttributes as exportedOtpFieldHiddenInputAttributes,
  otpFieldInput as exportedOtpFieldInput,
  otpFieldInputAttributes as exportedOtpFieldInputAttributes,
  otpFieldKeyDown as exportedOtpFieldKeyDown,
  otpFieldMoveFocus as exportedOtpFieldMoveFocus,
  otpFieldPaste as exportedOtpFieldPaste,
  otpFieldRootAttributes as exportedOtpFieldRootAttributes,
  otpFieldSlotValue as exportedOtpFieldSlotValue,
  otpFieldValueFromString as exportedOtpFieldValueFromString,
  setOtpFieldSlotValue as exportedSetOtpFieldSlotValue,
  setOtpFieldValue as exportedSetOtpFieldValue,
} from '../index.js';
import {
  otpFieldComplete as primitiveOtpFieldComplete,
  otpFieldHiddenInputAttributes as primitiveOtpFieldHiddenInputAttributes,
  otpFieldInput as primitiveOtpFieldInput,
  otpFieldInputAttributes as primitiveOtpFieldInputAttributes,
  otpFieldKeyDown as primitiveOtpFieldKeyDown,
  otpFieldMoveFocus as primitiveOtpFieldMoveFocus,
  otpFieldPaste as primitiveOtpFieldPaste,
  otpFieldRootAttributes as primitiveOtpFieldRootAttributes,
  otpFieldSlotValue as primitiveOtpFieldSlotValue,
  otpFieldValueFromString as primitiveOtpFieldValueFromString,
  setOtpFieldSlotValue as primitiveSetOtpFieldSlotValue,
  setOtpFieldValue as primitiveSetOtpFieldValue,
} from './index.js';
import {
  otpFieldComplete,
  otpFieldHiddenInputAttributes,
  otpFieldInput,
  otpFieldInputAttributes,
  otpFieldKeyDown,
  otpFieldMoveFocus,
  otpFieldPaste,
  otpFieldRootAttributes,
  otpFieldSlotValue,
  otpFieldValueFromString,
  setOtpFieldSlotValue,
  setOtpFieldValue,
} from './otp-field.js';

describe('headless-ui otp-field primitive', () => {
  it('builds root attributes with field state and description wiring', () => {
    expect(
      otpFieldRootAttributes({
        descriptionId: 'otp-help',
        errorId: 'otp-error',
        id: 'otp-field',
        invalid: true,
        labelledBy: 'otp-label',
        length: 4,
        required: true,
        value: '1234',
      }),
    ).toEqual({
      'aria-describedby': 'otp-help otp-error',
      'aria-invalid': 'true',
      'aria-labelledby': 'otp-label',
      'aria-required': 'true',
      'data-complete': '',
      'data-invalid': '',
      'data-required': '',
      id: 'otp-field',
      role: 'group',
    });

    expect(otpFieldRootAttributes({ disabled: true })).toEqual({
      'aria-disabled': 'true',
      'data-disabled': '',
      role: 'group',
    });
  });

  it('builds aggregate and visible slot input attributes', () => {
    expect(
      otpFieldHiddenInputAttributes({
        id: 'otp',
        length: 4,
        name: 'otp',
        pattern: '[0-9]*',
        required: true,
        value: '123456',
      }),
    ).toEqual({
      'aria-hidden': 'true',
      'data-complete': '',
      'data-required': '',
      'data-slot': 'hidden-input',
      autoComplete: 'one-time-code',
      disabled: false,
      id: 'otp',
      inputMode: 'numeric',
      maxLength: 4,
      minLength: 4,
      name: 'otp',
      pattern: '[0-9]*',
      required: true,
      tabIndex: -1,
      type: 'text',
      value: '1234',
    });

    expect(
      otpFieldInputAttributes({
        id: 'otp-2',
        invalid: true,
        label: 'Second OTP digit',
        length: 4,
        pattern: '[0-9]*',
        required: true,
        slotIndex: 1,
        value: '1234',
      }),
    ).toEqual({
      'aria-invalid': 'true',
      'aria-label': 'Second OTP digit',
      'data-complete': '',
      'data-filled': '',
      'data-invalid': '',
      'data-required': '',
      'data-slot': '1',
      autoComplete: 'off',
      disabled: false,
      id: 'otp-2',
      inputMode: 'numeric',
      maxLength: 1,
      pattern: '[0-9]*',
      required: true,
      type: 'text',
      value: '2',
    });

    expect(
      otpFieldInputAttributes({
        inputMode: 'text',
        length: 4,
        labelledBy: 'otp-label',
        slotIndex: 0,
        value: '',
      }),
    ).toEqual({
      'aria-label': 'One-time code character 1',
      'aria-labelledby': 'otp-label',
      'data-slot': '0',
      autoComplete: 'one-time-code',
      disabled: false,
      inputMode: 'text',
      maxLength: 1,
      type: 'text',
      value: '',
    });
  });

  it('normalizes values and reports completion', () => {
    expect(otpFieldValueFromString(' 1 2 3 4 5 ', 4)).toBe('1234');
    expect(otpFieldSlotValue({ length: 4, value: '1234' }, 2)).toBe('3');
    expect(otpFieldSlotValue({ length: 4, value: '1234' }, 99)).toBe('4');
    expect(otpFieldComplete({ length: 4, value: '1234' })).toBe(true);
    expect(otpFieldComplete({ length: 4, value: '123' })).toBe(false);
  });

  it('dispatches cancelable aggregate value changes before committing state', () => {
    const seen: string[] = [];
    const result = setOtpFieldValue({ length: 4, value: '12' }, '1234', 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['programmatic:1234']);
    expect(result).toMatchObject({ changed: true, complete: true, value: '1234' });
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous value when a value change is prevented', () => {
    const result = setOtpFieldValue({ length: 4, value: '12' }, '1234', 'programmatic', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.value).toBe('12');
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      setOtpFieldValue({ disabled: true, length: 4, value: '12' }, '1234', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, complete: false, value: '12' });
    expect(
      setOtpFieldValue({ length: 4, value: '12' }, '12', 'programmatic', { onValueChange }),
    ).toEqual({ changed: false, complete: false, value: '12' });
    expect(callCount).toBe(0);
  });

  it('sets slot values and paste ranges with next focus hints', () => {
    expect(setOtpFieldSlotValue({ length: 4, value: '1234' }, 1, '9', 'input')).toMatchObject({
      changed: true,
      focusIndex: 2,
      value: '1934',
    });
    expect(setOtpFieldSlotValue({ length: 4, value: '12' }, 2, '3456', 'paste')).toMatchObject({
      changed: true,
      complete: true,
      focusIndex: 3,
      value: '1234',
    });
    expect(setOtpFieldSlotValue({ length: 4, value: '1234' }, 1, '', 'delete')).toMatchObject({
      changed: true,
      focusIndex: 1,
      value: '134',
    });
  });

  it('moves focus for arrow and edge keys', () => {
    expect(otpFieldMoveFocus({ length: 4 }, 1, 'ArrowLeft')).toEqual({ focusIndex: 0 });
    expect(otpFieldMoveFocus({ length: 4 }, 1, 'ArrowRight')).toEqual({ focusIndex: 2 });
    expect(otpFieldMoveFocus({ length: 4 }, 1, 'Home')).toEqual({ focusIndex: 0 });
    expect(otpFieldMoveFocus({ length: 4 }, 1, 'End')).toEqual({ focusIndex: 3 });
    expect(otpFieldMoveFocus({ length: 4 }, 1, 'Enter')).toBeUndefined();
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const inputEvent = otpInputEvent('5');
    inputEvent.preventDefault();
    expect(
      otpFieldInput(
        inputEvent,
        { length: 4, slotIndex: 0, value: '' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();

    const keyEvent = otpKeyboardEvent('Backspace');
    keyEvent.preventDefault();
    expect(
      otpFieldKeyDown(
        keyEvent,
        { length: 4, slotIndex: 0, value: '1' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();

    const pasteEvent = otpPasteEvent('1234');
    pasteEvent.preventDefault();
    expect(
      otpFieldPaste(
        pasteEvent,
        { length: 4, slotIndex: 0, value: '' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('handles input, delete, movement, and paste events', () => {
    const reasons: string[] = [];
    const inputResult = otpFieldInput(
      otpInputEvent('5'),
      { length: 4, slotIndex: 0, value: '' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );
    const deleteEvent = otpKeyboardEvent('Backspace');
    const deleteResult = otpFieldKeyDown(
      deleteEvent,
      { length: 4, slotIndex: 0, value: '5' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );
    const moveEvent = otpKeyboardEvent('ArrowRight');
    const moveResult = otpFieldKeyDown(moveEvent, { length: 4, slotIndex: 0, value: '' });
    const pasteEvent = otpPasteEvent(' 1 2 3 4 5 ');
    const pasteResult = otpFieldPaste(
      pasteEvent,
      { length: 4, slotIndex: 0, value: '' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );
    const canceledInputEvent = otpInputEvent('9');
    const canceledInputResult = otpFieldInput(
      canceledInputEvent,
      { length: 4, slotIndex: 1, value: '1234' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(inputResult).toMatchObject({ changed: true, focusIndex: 1, value: '5' });
    expect(deleteResult).toMatchObject({ changed: true, focusIndex: 0, value: '' });
    expect(deleteEvent.defaultPrevented).toBe(true);
    expect(moveResult).toEqual({ focusIndex: 1 });
    expect(moveEvent.defaultPrevented).toBe(true);
    expect(pasteResult).toMatchObject({
      changed: true,
      complete: true,
      focusIndex: 3,
      value: '1234',
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(canceledInputResult).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true }),
      focusIndex: 2,
      value: '1234',
    });
    expect(canceledInputEvent.currentTarget?.value).toBe('2');
    expect(canceledInputEvent.defaultPrevented).toBe(true);
    expect(reasons).toEqual(['input', 'delete', 'paste']);
  });

  it('restores the live slot value when delete and paste changes are rejected', () => {
    const canceledDeleteEvent = otpKeyboardEvent('Backspace', '2');
    const canceledDeleteResult = otpFieldKeyDown(
      canceledDeleteEvent,
      { length: 4, slotIndex: 1, value: '1234' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );
    const canceledPasteEvent = otpPasteEvent('9876', '2');
    const canceledPasteResult = otpFieldPaste(
      canceledPasteEvent,
      { length: 4, slotIndex: 1, value: '1234' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledDeleteResult).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true }),
      focusIndex: 1,
      value: '1234',
    });
    expect(canceledDeleteEvent.currentTarget?.value).toBe('2');
    expect(canceledDeleteEvent.defaultPrevented).toBe(true);
    expect(canceledPasteResult).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true }),
      focusIndex: 3,
      value: '1234',
    });
    expect(canceledPasteEvent.currentTarget?.value).toBe('2');
    expect(canceledPasteEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(otpFieldRootAttributes())).toBe(true);
    expect(Object.isFrozen(otpFieldHiddenInputAttributes())).toBe(true);
    expect(Object.isFrozen(otpFieldInputAttributes({ slotIndex: 0 }))).toBe(true);
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedOtpFieldComplete).toBe(otpFieldComplete);
    expect(exportedOtpFieldHiddenInputAttributes).toBe(otpFieldHiddenInputAttributes);
    expect(exportedOtpFieldInput).toBe(otpFieldInput);
    expect(exportedOtpFieldInputAttributes).toBe(otpFieldInputAttributes);
    expect(exportedOtpFieldKeyDown).toBe(otpFieldKeyDown);
    expect(exportedOtpFieldMoveFocus).toBe(otpFieldMoveFocus);
    expect(exportedOtpFieldPaste).toBe(otpFieldPaste);
    expect(exportedOtpFieldRootAttributes).toBe(otpFieldRootAttributes);
    expect(exportedOtpFieldSlotValue).toBe(otpFieldSlotValue);
    expect(exportedOtpFieldValueFromString).toBe(otpFieldValueFromString);
    expect(exportedSetOtpFieldSlotValue).toBe(setOtpFieldSlotValue);
    expect(exportedSetOtpFieldValue).toBe(setOtpFieldValue);

    expect(primitiveOtpFieldComplete).toBe(otpFieldComplete);
    expect(primitiveOtpFieldHiddenInputAttributes).toBe(otpFieldHiddenInputAttributes);
    expect(primitiveOtpFieldInput).toBe(otpFieldInput);
    expect(primitiveOtpFieldInputAttributes).toBe(otpFieldInputAttributes);
    expect(primitiveOtpFieldKeyDown).toBe(otpFieldKeyDown);
    expect(primitiveOtpFieldMoveFocus).toBe(otpFieldMoveFocus);
    expect(primitiveOtpFieldPaste).toBe(otpFieldPaste);
    expect(primitiveOtpFieldRootAttributes).toBe(otpFieldRootAttributes);
    expect(primitiveOtpFieldSlotValue).toBe(otpFieldSlotValue);
    expect(primitiveOtpFieldValueFromString).toBe(otpFieldValueFromString);
    expect(primitiveSetOtpFieldSlotValue).toBe(setOtpFieldSlotValue);
    expect(primitiveSetOtpFieldValue).toBe(setOtpFieldValue);
  });
});

function otpInputEvent(value: string): Event & {
  readonly currentTarget: { value: string } | null;
} {
  const event = new Event('input', { cancelable: true }) as Event & {
    currentTarget: { value: string } | null;
  };
  Object.defineProperty(event, 'currentTarget', { value: { value } });
  return event;
}

function otpKeyboardEvent(
  key: string,
  currentValue?: string,
): Event & { readonly currentTarget?: { value: string } | null; readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & {
    currentTarget?: { value: string } | null;
    key: string;
  };
  Object.defineProperty(event, 'key', { value: key });
  if (currentValue !== undefined) {
    Object.defineProperty(event, 'currentTarget', { value: { value: currentValue } });
  }
  return event;
}

function otpPasteEvent(
  text: string,
  currentValue?: string,
): Event & {
  readonly clipboardData: { getData(format: string): string } | null;
  readonly currentTarget?: { value: string } | null;
} {
  const event = new Event('paste', { cancelable: true }) as Event & {
    clipboardData: { getData(format: string): string } | null;
    currentTarget?: { value: string } | null;
  };
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData(format: string) {
        return format === 'text' ? text : '';
      },
    },
  });
  if (currentValue !== undefined) {
    Object.defineProperty(event, 'currentTarget', { value: { value: currentValue } });
  }
  return event;
}
