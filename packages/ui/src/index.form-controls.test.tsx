import { describe, expect, it } from 'vitest';

import {
  Checkbox,
  CheckboxGroup,
  CheckboxGroupControl,
  CheckboxGroupItem,
  CheckboxGroupLabel,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSelect,
  FieldSelectOption,
  FieldTextarea,
  Fieldset,
  FieldsetLegend,
  NumberField,
  NumberFieldControl,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  OtpField,
  OtpFieldGroup,
  OtpFieldHiddenInput,
  OtpFieldInput,
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
  Switch,
  Toggle,
  ToggleGroup,
  ToggleGroupButton,
  ToggleGroupItem,
  Toolbar,
  ToolbarButton,
  ToolbarItem,
  checkboxGroupControlClasses,
  checkboxGroupItemClasses,
  checkboxGroupLabelClasses,
  fieldControlClasses,
  fieldDescriptionClasses,
  fieldErrorClasses,
  fieldLabelClasses,
  fieldSelectClasses,
  fieldSelectOptionClasses,
  fieldTextareaClasses,
  fieldsetClasses,
  fieldsetLegendClasses,
  numberFieldButtonClasses,
  numberFieldControlClasses,
  numberFieldInputClasses,
  otpFieldGroupClasses,
  otpFieldHiddenInputClasses,
  otpFieldInputClasses,
} from './index.js';

describe('@kovojs/ui styled package foundation', () => {
  it('wraps the headless checkbox-group primitive as styled native checkboxes', () => {
    const items = [
      { value: 'updates' },
      { value: 'billing' },
      { disabled: true, value: 'security' },
    ];
    const state = {
      descriptionId: 'notifications-help',
      form: 'notifications-form',
      items,
      name: 'notifications',
      required: true,
      value: ['updates'] as const,
    };

    const root = CheckboxGroup.definition.render({
      ...state,
      children: 'checkbox options',
      errorId: 'notifications-error',
      id: 'notifications',
      invalid: true,
      labelledBy: 'notifications-label',
    });
    const item = CheckboxGroupItem.definition.render({
      ...state,
      children: 'updates input',
      itemValue: 'updates',
    });
    const control = CheckboxGroupControl.definition.render({
      ...state,
      controlId: 'notifications-updates',
      itemValue: 'updates',
    });
    const disabledControl = CheckboxGroupControl.definition.render({
      ...state,
      controlId: 'notifications-security',
      itemValue: 'security',
    });
    const label = CheckboxGroupLabel.definition.render({
      ...state,
      children: 'Product updates',
      controlId: 'notifications-updates',
      itemValue: 'updates',
    });

    expect(root).toContain('aria-describedby="notifications-help notifications-error"');
    expect(root).toContain('aria-invalid="true"');
    expect(root).toContain('aria-required="true"');
    expect(root).toContain('role="group"');
    expect(item).toContain('data-state="checked"');
    expect(control).toContain('aria-checked="true" checked');
    expect(control).toContain(
      'form="notifications-form" id="notifications-updates" name="notifications" required',
    );
    expect(control).toContain('tabIndex="0" type="checkbox" value="updates"');
    expect(disabledControl).toContain('data-disabled="" data-state="unchecked" disabled');
    expect(disabledControl).toContain('id="notifications-security"');
    expect(disabledControl).toContain('tabIndex="-1" type="checkbox" value="security"');
    expect(label).toContain('for="notifications-updates"');
    expect(checkboxGroupItemClasses.join(' ')).toContain('data-[disabled]:opacity-50');
    expect(checkboxGroupControlClasses.join(' ')).toContain('accent-neutral-950');
    expect(checkboxGroupLabelClasses.join(' ')).toContain('select-none');
  });

  it('wraps the headless radio-group primitive as styled native radios', () => {
    const items = [
      { value: 'standard' },
      { value: 'express' },
      { disabled: true, value: 'freight' },
    ];
    const state = {
      descriptionId: 'shipping-help',
      form: 'checkout-form',
      items,
      name: 'shipping-speed',
      required: true,
      value: 'express',
    };

    const root = RadioGroup.definition.render({
      ...state,
      children: 'radio options',
      id: 'shipping-speed',
      invalid: true,
    });
    const item = RadioGroupItem.definition.render({
      ...state,
      children: 'express input',
      itemValue: 'express',
    });
    const radio = RadioGroupRadio.definition.render({
      ...state,
      controlId: 'shipping-express',
      itemValue: 'express',
    });
    const disabledRadio = RadioGroupRadio.definition.render({
      ...state,
      controlId: 'shipping-freight',
      itemValue: 'freight',
    });
    const label = RadioGroupLabel.definition.render({
      ...state,
      children: 'Express',
      controlId: 'shipping-express',
      itemValue: 'express',
    });

    expect(root).toContain('aria-describedby="shipping-help"');
    expect(root).toContain('aria-invalid="true"');
    expect(root).toContain('aria-required="true"');
    expect(root).toContain('role="radiogroup"');
    expect(item).toContain('data-state="checked"');
    expect(radio).toContain('aria-checked="true" checked');
    expect(radio).toContain('form="checkout-form" id="shipping-express"');
    expect(radio).toContain('name="shipping-speed" required');
    expect(radio).toContain('tabIndex="0" type="radio" value="express"');
    expect(disabledRadio).toContain('data-disabled=""');
    expect(disabledRadio).toContain('disabled form="checkout-form" id="shipping-freight"');
    expect(disabledRadio).toContain('tabIndex="-1" type="radio" value="freight"');
    expect(label).toContain('for="shipping-express"');
  });

  it('wraps headless form-control primitives as styled native controls', () => {
    const checkbox = Checkbox.definition.render({
      checked: 'indeterminate',
      children: 'Some permissions',
      describedBy: 'permissions-help permissions-error',
      form: 'permissions-form',
      id: 'permissions-partial',
      labelledBy: 'permissions-label',
      name: 'permissions',
      required: true,
      value: 'partial',
    });
    const switchControl = Switch.definition.render({
      checked: true,
      children: 'Notifications',
      describedBy: 'notifications-help',
      form: 'preferences-form',
      id: 'notifications-switch',
      labelledBy: 'notifications-label',
      name: 'notifications',
      value: 'enabled',
    });
    const toggle = Toggle.definition.render({
      children: 'Bold',
      pressed: true,
      variant: 'subtle',
    });

    expect(checkbox).toContain('data-state="indeterminate"');
    expect(checkbox).toContain('aria-checked="mixed"');
    expect(checkbox).toContain('aria-describedby="permissions-help permissions-error"');
    expect(checkbox).toContain('aria-labelledby="permissions-label"');
    expect(checkbox).toContain('form="permissions-form"');
    expect(checkbox).toContain('id="permissions-partial"');
    expect(checkbox).toContain('name="permissions"');
    expect(checkbox).toContain('required type="checkbox" value="partial"');
    expect(checkbox).toContain('Some permissions</label>');
    expect(switchControl).toContain('data-state="checked"');
    expect(switchControl).toContain('aria-checked="true"');
    expect(switchControl).toContain('checked');
    expect(switchControl).toContain('aria-describedby="notifications-help"');
    expect(switchControl).toContain('aria-labelledby="notifications-label"');
    expect(switchControl).toContain('form="preferences-form"');
    expect(switchControl).toContain('id="notifications-switch"');
    expect(switchControl).toContain('name="notifications"');
    expect(switchControl).toContain('role="switch" type="checkbox" value="enabled"');
    expect(toggle).toContain('data-state="pressed"');
    expect(toggle).toContain('aria-pressed="true"');
  });

  it('wraps the headless toggle-group primitive as styled roving buttons', () => {
    const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'strike' }];
    const state = {
      activeValue: 'bold',
      items,
      type: 'multiple' as const,
      value: ['bold'] as const,
    };

    const root = ToggleGroup.definition.render({
      ...state,
      children: 'format controls',
      descriptionId: 'format-help',
      id: 'formatting',
      labelledBy: 'format-label',
      orientation: 'vertical',
    });
    const item = ToggleGroupItem.definition.render({
      ...state,
      children: 'bold button',
      id: 'bold-item',
      itemValue: 'bold',
    });
    const button = ToggleGroupButton.definition.render({
      ...state,
      children: 'Bold',
      id: 'bold-button',
      itemValue: 'bold',
    });
    const disabledButton = ToggleGroupButton.definition.render({
      ...state,
      children: 'Strike',
      itemValue: 'strike',
    });

    expect(root).toContain('aria-describedby="format-help"');
    expect(root).toContain('aria-labelledby="format-label"');
    expect(root).toContain('data-orientation="vertical" id="formatting" role="group"');
    expect(item).toContain('data-state="pressed" id="bold-item"');
    expect(button).toContain('aria-pressed="true"');
    expect(button).toContain('data-state="pressed"');
    expect(button).toContain('data-style-src="toggle-group.tsx#button"');
    expect(button).toContain('id="bold-button" tabIndex="0" type="button" value="bold"');
    expect(disabledButton).toContain('aria-pressed="false"');
    expect(disabledButton).toContain('data-disabled="" data-state="off" disabled');
    expect(disabledButton).toContain('tabIndex="-1" type="button" value="strike"');
    expect(item).toContain('data-style-src="toggle-group.tsx#item"');
    expect(root).toContain('data-style-src="toggle-group.tsx#root"');
  });

  it('wraps the headless toolbar primitive as styled roving controls', () => {
    const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'link' }];
    const state = {
      activeValue: 'bold',
      items,
      orientation: 'vertical' as const,
    };

    const root = Toolbar.definition.render({
      ...state,
      children: 'format controls',
      descriptionId: 'format-help',
      id: 'formatting-toolbar',
      labelledBy: 'format-label',
    });
    const item = ToolbarItem.definition.render({
      ...state,
      children: 'bold button',
      id: 'bold-item',
      itemValue: 'bold',
    });
    const button = ToolbarButton.definition.render({
      ...state,
      children: 'Bold',
      id: 'bold-button',
      itemValue: 'bold',
      pressed: true,
    });
    const disabledButton = ToolbarButton.definition.render({
      ...state,
      children: 'Link',
      itemValue: 'link',
      pressed: false,
    });

    expect(root).toContain('aria-describedby="format-help"');
    expect(root).toContain('aria-labelledby="format-label"');
    expect(root).toContain('aria-orientation="vertical"');
    expect(root).toContain('data-orientation="vertical" id="formatting-toolbar" role="toolbar"');
    expect(item).toContain('id="bold-item"');
    expect(button).toContain('aria-pressed="true"');
    expect(button).toContain('data-pressed="true"');
    expect(button).toContain('data-style-src="toolbar.tsx#button"');
    expect(button).toContain('id="bold-button" tabIndex="0" type="button" value="bold"');
    expect(disabledButton).toContain('aria-pressed="false"');
    expect(disabledButton).toContain('data-disabled="" data-pressed="false" disabled');
    expect(disabledButton).toContain('tabIndex="-1" type="button" value="link"');
    expect(item).toContain('data-style-src="toolbar.tsx#item"');
    expect(root).toContain('data-style-src="toolbar.tsx#root"');
  });

  it('wraps the headless number-field primitive as a styled native number input', () => {
    const state = {
      invalid: true,
      max: 10,
      min: 0,
      name: 'quantity',
      required: true,
      step: 2,
      value: 2,
    };

    const root = NumberField.definition.render({
      ...state,
      children: 'quantity controls',
      id: 'quantity-field',
    });
    const control = NumberFieldControl.definition.render({
      ...state,
      children: 'stepper',
      id: 'quantity-control',
    });
    const decrement = NumberFieldDecrement.definition.render({
      ...state,
      id: 'quantity-decrement',
      inputId: 'quantity-input',
      label: 'Decrease quantity',
    });
    const input = NumberFieldInput.definition.render({
      ...state,
      descriptionId: 'quantity-description',
      errorId: 'quantity-error',
      form: 'cart-form',
      id: 'quantity-input',
      labelledBy: 'quantity-label',
    });
    const increment = NumberFieldIncrement.definition.render({
      ...state,
      id: 'quantity-increment',
      inputId: 'quantity-input',
      label: 'Increase quantity',
    });
    const disabledAtMax = NumberFieldIncrement.definition.render({
      max: 10,
      value: 10,
    });

    expect(root).toContain('data-invalid="" data-required="" id="quantity-field"');
    expect(control).toContain('data-invalid="" data-required="" id="quantity-control"');
    expect(decrement).toContain('aria-controls="quantity-input"');
    expect(decrement).toContain('aria-label="Decrease quantity"');
    expect(decrement).toContain('data-action="decrement"');
    expect(input).toContain('aria-describedby="quantity-description quantity-error"');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain(
      'form="cart-form" id="quantity-input" max="10" min="0" name="quantity" required',
    );
    expect(input).toContain('step="2" type="number" value="2"');
    expect(increment).toContain('data-action="increment"');
    expect(disabledAtMax).toContain('data-disabled=""');
    expect(disabledAtMax).toContain('disabled type="button"');
    expect(numberFieldControlClasses.join(' ')).toContain('inline-flex h-9');
    expect(numberFieldInputClasses.join(' ')).toContain('text-center');
    expect(numberFieldButtonClasses.join(' ')).toContain('data-[action=increment]:border-l');
  });

  it('wraps the headless otp-field primitive as styled aggregate and slot inputs', () => {
    const state = {
      descriptionId: 'otp-description',
      errorId: 'otp-error',
      form: 'otp-form',
      invalid: true,
      labelledBy: 'otp-label',
      length: 6,
      name: 'otp-code',
      pattern: '[0-9]*',
      required: true,
      value: '1234',
    };

    const root = OtpField.definition.render({
      ...state,
      children: 'otp controls',
      id: 'otp-field',
    });
    const group = OtpFieldGroup.definition.render({ children: 'slots' });
    const hidden = OtpFieldHiddenInput.definition.render({ ...state, id: 'otp-code' });
    const firstSlot = OtpFieldInput.definition.render({
      ...state,
      id: 'otp-slot-1',
      label: 'One-time code digit 1',
      slotIndex: 0,
    });
    const emptySlot = OtpFieldInput.definition.render({
      ...state,
      id: 'otp-slot-6',
      slotIndex: 5,
    });
    const completeDisabled = OtpField.definition.render({
      disabled: true,
      length: 4,
      value: '9876',
    });

    expect(root).toContain('aria-describedby="otp-description otp-error"');
    expect(root).toContain('aria-invalid="true"');
    expect(root).toContain('data-required=""');
    expect(root).toContain('role="group"');
    expect(group).toContain('flex items-center gap-2');
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).toContain('data-slot="hidden-input"');
    expect(hidden).toContain('autoComplete="one-time-code"');
    expect(hidden).toContain('form="otp-form" id="otp-code"');
    expect(hidden).toContain('maxLength="6"');
    expect(hidden).toContain('minLength="6"');
    expect(hidden).toContain('name="otp-code"');
    expect(hidden).toContain('required tabIndex="-1" type="text" value="1234"');
    expect(firstSlot).toContain('aria-label="One-time code digit 1"');
    expect(firstSlot).toContain('data-filled=""');
    expect(firstSlot).toContain('data-slot="0"');
    expect(firstSlot).toContain('maxLength="1"');
    expect(emptySlot).toContain('data-slot="5"');
    expect(completeDisabled).toContain('data-complete="" data-disabled=""');
    expect(otpFieldGroupClasses.join(' ')).toContain('flex items-center gap-2');
    expect(otpFieldHiddenInputClasses.join(' ')).toContain('sr-only');
    expect(otpFieldInputClasses.join(' ')).toContain('data-[filled]:border-neutral-500');
  });

  it('wraps field and fieldset primitives as styled native form wiring', () => {
    const state = {
      invalid: true,
      required: true,
    };

    const root = Field.definition.render({
      ...state,
      children: 'email field',
      id: 'email-field',
    });
    const label = FieldLabel.definition.render({
      ...state,
      children: 'Email',
      controlId: 'email',
      id: 'email-label',
    });
    const control = FieldControl.definition.render({
      ...state,
      autoComplete: 'email',
      descriptionId: 'email-description',
      errorId: 'email-error',
      form: 'profile-form',
      id: 'email',
      inputMode: 'email',
      maxLength: 80,
      minLength: 3,
      name: 'email',
      pattern: '.+@example\\.com',
      placeholder: 'ada@example.com',
      type: 'email',
      value: 'ada@example.com',
    });
    const textarea = FieldTextarea.definition.render({
      autoComplete: 'off',
      descriptionId: 'bio-description',
      form: 'profile-form',
      id: 'bio',
      maxLength: 240,
      name: 'bio',
      placeholder: 'Short bio',
      rows: 4,
    });
    const select = FieldSelect.definition.render({
      children:
        '<option value="starter">Starter</option><option value="team" selected>Team</option>',
      descriptionId: 'plan-description',
      form: 'profile-form',
      id: 'plan',
      name: 'plan',
      required: true,
      value: 'team',
    });
    const selectOption = FieldSelectOption.definition.render({
      children: 'Enterprise',
      disabled: true,
      selected: true,
      value: 'enterprise',
    });
    const description = FieldDescription.definition.render({
      children: 'Used for notifications.',
      id: 'email-description',
    });
    const error = FieldError.definition.render({ children: 'Email required.', id: 'email-error' });
    const fieldset = Fieldset.definition.render({
      children:
        FieldsetLegend.definition.render({ children: 'Plan', id: 'plan-legend' }) +
        FieldControl.definition.render({
          id: 'seat',
          form: 'profile-form',
          name: 'seat',
          value: 'window',
        }),
      descriptionId: 'plan-description',
      disabled: true,
      form: 'profile-form',
      id: 'plan-fieldset',
      invalid: true,
      name: 'plan-options',
    });

    expect(root).toContain('data-invalid="" data-required="" id="email-field"');
    expect(label).toContain('for="email" id="email-label"');
    expect(control).toContain('aria-describedby="email-description email-error"');
    expect(control).toContain('aria-invalid="true"');
    expect(control).toContain('autoComplete="email"');
    expect(control).toContain('inputMode="email"');
    expect(control).toContain('maxLength="80"');
    expect(control).toContain('minLength="3"');
    expect(control).toContain('pattern=".+@example\\.com"');
    expect(control).toContain('placeholder="ada@example.com"');
    expect(control).toContain('form="profile-form"');
    expect(control).toContain('id="email"');
    expect(control).toContain('name="email"');
    expect(control).toContain('required type="email"');
    expect(control).toContain('value="ada@example.com"');
    expect(control).not.toMatch(/\sdisabled(?:\s|>|=)/);
    expect(textarea).toContain('<textarea aria-describedby="bio-description"');
    expect(textarea).toContain('autoComplete="off"');
    expect(textarea).toContain('form="profile-form"');
    expect(textarea).toContain('id="bio"');
    expect(textarea).toContain('name="bio"');
    expect(textarea).toContain('placeholder="Short bio"');
    expect(textarea).toContain('rows="4"');
    expect(textarea).toContain('maxLength="240"');
    expect(textarea).not.toMatch(/\sdisabled(?:\s|>|=)/);
    expect(select).toContain('<select aria-describedby="plan-description"');
    expect(select).toContain('form="profile-form"');
    expect(select).toContain('id="plan" name="plan" required value="team"');
    expect(select).toContain('<option value="team" selected>Team</option>');
    expect(select).not.toMatch(/\sdisabled(?:\s|>|=)/);
    expect(selectOption).toContain(
      '<option class="text-neutral-950 disabled:text-neutral-400" disabled selected value="enterprise">Enterprise</option>',
    );
    expect(description).toContain('id="email-description"');
    expect(error).toContain('role="alert"');
    expect(fieldset).toContain('aria-describedby="plan-description"');
    expect(fieldset).toContain('aria-invalid="true"');
    expect(fieldset).toContain('data-disabled=""');
    expect(fieldset).toContain('disabled form="profile-form" id="plan-fieldset"');
    expect(fieldset).toContain('name="plan-options"');
    expect(fieldset).toContain('form="profile-form"');
    expect(fieldset).toContain('id="seat" name="seat"');
    expect(fieldset).toContain('id="plan-fieldset"');
    expect(fieldset).toContain('id="plan-legend"');
    expect(fieldLabelClasses.join(' ')).toContain('text-sm font-medium');
    expect(fieldControlClasses.join(' ')).toContain('aria-[invalid=true]:border-red-500');
    expect(fieldTextareaClasses.join(' ')).toContain('min-h-24');
    expect(fieldSelectClasses.join(' ')).toContain('h-9 w-full');
    expect(fieldSelectOptionClasses.join(' ')).toContain('disabled:text-neutral-400');
    expect(fieldDescriptionClasses.join(' ')).toContain('text-neutral-500');
    expect(fieldErrorClasses.join(' ')).toContain('text-red-600');
    expect(fieldsetClasses.join(' ')).toContain('rounded-md border border-neutral-200');
    expect(fieldsetLegendClasses.join(' ')).toContain('px-1 text-sm font-medium');
  });
});
