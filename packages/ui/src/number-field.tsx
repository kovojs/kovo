/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  numberFieldDecrementAttributes,
  numberFieldIncrementAttributes,
  numberFieldInputAttributes,
  numberFieldRootAttributes,
  type ClassValue,
  type NumberFieldValue,
} from '@jiso/headless-ui';

export interface NumberFieldStateProps {
  disabled?: boolean;
  invalid?: boolean;
  max?: number;
  min?: number;
  name?: string;
  required?: boolean;
  step?: number;
  value?: NumberFieldValue;
}

export interface NumberFieldProps extends NumberFieldStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface NumberFieldInputProps extends NumberFieldStateProps {
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface NumberFieldButtonProps extends NumberFieldStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  inputId?: string;
  label?: string;
}

export const numberFieldClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950',
  variants: {},
});

export const numberFieldControlClassNames = defineVariants({
  base: 'inline-flex h-9 w-fit items-center overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm data-[disabled]:opacity-60 data-[invalid]:border-red-400',
  variants: {},
});

export const numberFieldInputClassNames = defineVariants({
  base: 'h-9 w-20 border-0 bg-transparent px-3 text-center text-sm text-neutral-950 outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:text-red-950',
  variants: {},
});

export const numberFieldButtonClassNames = defineVariants({
  base: 'inline-flex h-9 w-9 items-center justify-center border-neutral-200 bg-neutral-50 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 data-[action=decrement]:border-r data-[action=increment]:border-l data-[disabled]:opacity-70',
  variants: {},
});

export const numberFieldClasses = numberFieldClassNames.classes;
export const numberFieldControlClasses = numberFieldControlClassNames.classes;
export const numberFieldInputClasses = numberFieldInputClassNames.classes;
export const numberFieldButtonClasses = numberFieldButtonClassNames.classes;

export const NumberField = component('number-field', {
  render(props: NumberFieldProps) {
    const attrs = numberFieldRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        class={cn(numberFieldClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const NumberFieldControl = component('number-field-control', {
  render(props: NumberFieldProps) {
    const attrs = numberFieldRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        class={cn(numberFieldControlClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const NumberFieldInput = component('number-field-input', {
  render(props: NumberFieldInputProps) {
    const attrs = numberFieldInputAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <input
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(numberFieldInputClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        max={attrs.max}
        min={attrs.min}
        name={attrs.name}
        required={attrs.required}
        step={attrs.step}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});

export const NumberFieldDecrement = component('number-field-decrement', {
  render(props: NumberFieldButtonProps) {
    const attrs = numberFieldDecrementAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputId === undefined ? {} : { inputId: props.inputId }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-label={attrs['aria-label']}
        class={cn(numberFieldButtonClassNames(), props.class)}
        data-action={attrs['data-action']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        id={attrs.id}
        type={attrs.type}
      >
        {props.children ?? '-'}
      </button>
    );
  },
});

export const NumberFieldIncrement = component('number-field-increment', {
  render(props: NumberFieldButtonProps) {
    const attrs = numberFieldIncrementAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputId === undefined ? {} : { inputId: props.inputId }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-label={attrs['aria-label']}
        class={cn(numberFieldButtonClassNames(), props.class)}
        data-action={attrs['data-action']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        id={attrs.id}
        type={attrs.type}
      >
        {props.children ?? '+'}
      </button>
    );
  },
});
