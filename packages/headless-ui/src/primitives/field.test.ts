import { describe, expect, it } from 'vitest';

import {
  fieldControlAttributes as exportedFieldControlAttributes,
  fieldDescriptionAttributes as exportedFieldDescriptionAttributes,
  fieldErrorAttributes as exportedFieldErrorAttributes,
  fieldLabelAttributes as exportedFieldLabelAttributes,
  fieldRootAttributes as exportedFieldRootAttributes,
  fieldsetLegendAttributes as exportedFieldsetLegendAttributes,
  fieldsetRootAttributes as exportedFieldsetRootAttributes,
} from '../index.js';
import {
  fieldControlAttributes,
  fieldDescriptionAttributes,
  fieldErrorAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  fieldsetLegendAttributes,
  fieldsetRootAttributes,
} from './field.js';

describe('headless-ui field primitive', () => {
  it('builds field root and label attributes from shared field state', () => {
    expect(
      fieldRootAttributes({
        disabled: true,
        id: 'email-field',
        invalid: true,
        required: true,
      }),
    ).toEqual({
      'data-disabled': '',
      'data-invalid': '',
      'data-required': '',
      id: 'email-field',
    });

    expect(
      fieldLabelAttributes({
        controlId: 'email',
        disabled: true,
        id: 'email-label',
        required: true,
      }),
    ).toEqual({
      'data-disabled': '',
      'data-required': '',
      for: 'email',
      id: 'email-label',
    });
  });

  it('wires a native named control for typed form integration', () => {
    expect(
      fieldControlAttributes({
        autoComplete: 'email',
        descriptionId: 'email-help',
        errorId: 'email-error',
        form: 'profile-form',
        id: 'email',
        inputMode: 'email',
        invalid: true,
        maxLength: 80,
        minLength: 3,
        name: 'email',
        pattern: '.+@example\\.com',
        required: true,
      }),
    ).toEqual({
      'aria-describedby': 'email-help email-error',
      'aria-invalid': 'true',
      autoComplete: 'email',
      'data-invalid': '',
      'data-required': '',
      form: 'profile-form',
      id: 'email',
      inputMode: 'email',
      maxLength: 80,
      minLength: 3,
      name: 'email',
      pattern: '.+@example\\.com',
      required: true,
    });
  });

  it('preserves native external form ownership for controls and fieldsets', () => {
    expect(
      fieldControlAttributes({
        form: 'checkout-form',
        id: 'seat',
        name: 'seat',
        required: true,
      }),
    ).toEqual({
      'data-required': '',
      form: 'checkout-form',
      id: 'seat',
      name: 'seat',
      required: true,
    });

    expect(
      fieldsetRootAttributes({
        descriptionId: 'shipping-help',
        form: 'checkout-form',
        id: 'shipping',
        name: 'shipping-options',
      }),
    ).toEqual({
      'aria-describedby': 'shipping-help',
      form: 'checkout-form',
      id: 'shipping',
      name: 'shipping-options',
    });
  });

  it('omits the error IDREF while a field is valid', () => {
    expect(
      fieldControlAttributes({
        descriptionId: 'email-help',
        errorId: 'email-error',
        id: 'email',
        name: 'email',
      }),
    ).toEqual({
      'aria-describedby': 'email-help',
      id: 'email',
      name: 'email',
    });

    expect(fieldControlAttributes({ id: 'email' })).toEqual({
      id: 'email',
    });
  });

  it('omits native disabled boolean attributes unless the disabled state is active', () => {
    expect(fieldControlAttributes({ disabled: false, id: 'email' })).toEqual({
      id: 'email',
    });
    expect(fieldControlAttributes({ disabled: true, id: 'email' })).toEqual({
      'data-disabled': '',
      disabled: true,
      id: 'email',
    });
    expect(fieldsetRootAttributes({ disabled: false, id: 'shipping' })).toEqual({
      id: 'shipping',
    });
    expect(fieldsetRootAttributes({ disabled: true, id: 'shipping' })).toEqual({
      'data-disabled': '',
      disabled: true,
      id: 'shipping',
    });
  });

  it('builds description and alert-backed error message attributes', () => {
    expect(fieldDescriptionAttributes({ id: 'email-help' })).toEqual({
      id: 'email-help',
    });

    expect(fieldErrorAttributes({ disabled: true, id: 'email-error', visible: false })).toEqual({
      'data-disabled': '',
      'data-invalid': '',
      hidden: true,
      id: 'email-error',
      role: 'alert',
    });
  });

  it('builds fieldset and legend attributes for grouped form controls', () => {
    expect(
      fieldsetRootAttributes({
        descriptionId: 'shipping-help',
        disabled: true,
        errorId: 'shipping-error',
        id: 'shipping',
        invalid: true,
        required: true,
      }),
    ).toEqual({
      'aria-describedby': 'shipping-help shipping-error',
      'aria-invalid': 'true',
      'data-disabled': '',
      'data-invalid': '',
      'data-required': '',
      disabled: true,
      id: 'shipping',
    });

    expect(fieldsetLegendAttributes({ id: 'shipping-legend', required: true })).toEqual({
      'data-required': '',
      id: 'shipping-legend',
    });
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(fieldRootAttributes())).toBe(true);
    expect(Object.isFrozen(fieldControlAttributes())).toBe(true);
    expect(Object.isFrozen(fieldsetRootAttributes())).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedFieldRootAttributes).toBe(fieldRootAttributes);
    expect(exportedFieldLabelAttributes).toBe(fieldLabelAttributes);
    expect(exportedFieldControlAttributes).toBe(fieldControlAttributes);
    expect(exportedFieldDescriptionAttributes).toBe(fieldDescriptionAttributes);
    expect(exportedFieldErrorAttributes).toBe(fieldErrorAttributes);
    expect(exportedFieldsetRootAttributes).toBe(fieldsetRootAttributes);
    expect(exportedFieldsetLegendAttributes).toBe(fieldsetLegendAttributes);
  });
});
