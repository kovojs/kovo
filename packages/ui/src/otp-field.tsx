/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
  type ClassValue,
  type OtpFieldInputMode,
} from '@jiso/headless-ui';

export interface OtpFieldStateProps {
  disabled?: boolean;
  inputMode?: OtpFieldInputMode;
  invalid?: boolean;
  length?: number;
  name?: string;
  pattern?: string;
  required?: boolean;
  value?: string;
}

export interface OtpFieldProps extends OtpFieldStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface OtpFieldHiddenInputProps extends OtpFieldStateProps {
  class?: ClassValue;
  id?: string;
}

export interface OtpFieldInputProps extends OtpFieldStateProps {
  class?: ClassValue;
  id?: string;
  label?: string;
  labelledBy?: string;
  slotIndex: number;
}

export const otpFieldClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950',
  variants: {},
});

export const otpFieldGroupClassNames = defineVariants({
  base: 'flex items-center gap-2',
  variants: {},
});

export const otpFieldHiddenInputClassNames = defineVariants({
  base: 'sr-only',
  variants: {},
});

export const otpFieldInputClassNames = defineVariants({
  base: 'h-10 w-9 rounded-md border border-neutral-300 bg-white text-center text-base font-medium text-neutral-950 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 data-[filled]:border-neutral-500 data-[invalid]:border-red-500 data-[invalid]:focus-visible:outline-red-500',
  variants: {},
});

export const otpFieldClasses = otpFieldClassNames.classes;
export const otpFieldGroupClasses = otpFieldGroupClassNames.classes;
export const otpFieldHiddenInputClasses = otpFieldHiddenInputClassNames.classes;
export const otpFieldInputClasses = otpFieldInputClassNames.classes;

export const OtpField = component('otp-field', {
  render(props: OtpFieldProps) {
    const attrs = otpFieldRootAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputMode === undefined ? {} : { inputMode: props.inputMode }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.length === undefined ? {} : { length: props.length }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.pattern === undefined ? {} : { pattern: props.pattern }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-invalid={attrs['aria-invalid']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-required={attrs['aria-required']}
        class={cn(otpFieldClassNames(), props.class)}
        data-complete={attrs['data-complete']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const OtpFieldGroup = component('otp-field-group', {
  render(props: { children?: string; class?: ClassValue }) {
    return <div class={cn(otpFieldGroupClassNames(), props.class)}>{props.children}</div>;
  },
});

export const OtpFieldHiddenInput = component('otp-field-hidden-input', {
  render(props: OtpFieldHiddenInputProps) {
    const attrs = otpFieldHiddenInputAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputMode === undefined ? {} : { inputMode: props.inputMode }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.length === undefined ? {} : { length: props.length }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.pattern === undefined ? {} : { pattern: props.pattern }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <input
        aria-hidden={attrs['aria-hidden']}
        autoComplete={attrs.autoComplete}
        class={cn(otpFieldHiddenInputClassNames(), props.class)}
        data-complete={attrs['data-complete']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        data-slot={attrs['data-slot']}
        disabled={attrs.disabled}
        id={attrs.id}
        inputMode={attrs.inputMode}
        maxLength={attrs.maxLength}
        minLength={attrs.minLength}
        name={attrs.name}
        pattern={attrs.pattern}
        required={attrs.required}
        tabIndex={attrs.tabIndex}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});

export const OtpFieldInput = component('otp-field-input', {
  render(props: OtpFieldInputProps) {
    const attrs = otpFieldInputAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputMode === undefined ? {} : { inputMode: props.inputMode }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.length === undefined ? {} : { length: props.length }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.pattern === undefined ? {} : { pattern: props.pattern }),
      ...(props.required === undefined ? {} : { required: props.required }),
      slotIndex: props.slotIndex,
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <input
        aria-invalid={attrs['aria-invalid']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        autoComplete={attrs.autoComplete}
        class={cn(otpFieldInputClassNames(), props.class)}
        data-complete={attrs['data-complete']}
        data-disabled={attrs['data-disabled']}
        data-filled={attrs['data-filled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        data-slot={attrs['data-slot']}
        disabled={attrs.disabled}
        id={attrs.id}
        inputMode={attrs.inputMode}
        maxLength={attrs.maxLength}
        pattern={attrs.pattern}
        required={attrs.required}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});
