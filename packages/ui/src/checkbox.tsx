/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  checkboxRootAttributes,
  cn,
  defineVariants,
  type CheckboxCheckedState,
  type ClassValue,
} from '@jiso/headless-ui';

export interface CheckboxProps {
  checked?: CheckboxCheckedState;
  children?: string;
  class?: ClassValue;
  disabled?: boolean;
  form?: string;
  inputClass?: ClassValue;
  name?: string;
  required?: boolean;
  value?: string;
}

export const checkboxClassNames = defineVariants({
  base: 'inline-flex items-center gap-2 text-sm text-neutral-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  variants: {},
});

export const checkboxInputClassNames = defineVariants({
  base: 'h-4 w-4 rounded border border-neutral-300 text-neutral-950 accent-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50',
  variants: {},
});

export const checkboxClasses = checkboxClassNames.classes;
export const checkboxInputClasses = checkboxInputClassNames.classes;

export const Checkbox = component('checkbox', {
  render(props: CheckboxProps) {
    const attrs = checkboxRootAttributes({
      checked: props.checked ?? false,
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <label
        class={cn(checkboxClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
      >
        <input
          aria-checked={attrs['aria-checked']}
          checked={attrs.checked}
          class={cn(checkboxInputClassNames(), props.inputClass)}
          data-disabled={attrs['data-disabled']}
          data-state={attrs['data-state']}
          disabled={attrs.disabled}
          form={props.form}
          name={attrs.name}
          required={attrs.required}
          type={attrs.type}
          value={attrs.value}
        />
        {props.children}
      </label>
    );
  },
});
