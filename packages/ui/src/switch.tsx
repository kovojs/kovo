/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { cn, defineVariants, switchRootAttributes, type ClassValue } from '@jiso/headless-ui';

export interface SwitchProps {
  describedBy?: string;
  checked?: boolean;
  children?: string;
  class?: ClassValue;
  disabled?: boolean;
  form?: string;
  id?: string;
  inputClass?: ClassValue;
  labelledBy?: string;
  name?: string;
  required?: boolean;
  value?: string;
}

export const switchClassNames = defineVariants({
  base: 'inline-flex items-center gap-2 text-sm text-neutral-950 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  variants: {},
});

export const switchInputClassNames = defineVariants({
  base: 'h-5 w-9 rounded-full border border-neutral-300 bg-neutral-200 accent-neutral-950 transition-colors checked:bg-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50',
  variants: {},
});

export const switchClasses = switchClassNames.classes;
export const switchInputClasses = switchInputClassNames.classes;

export const Switch = component('switch', {
  render(props: SwitchProps) {
    const attrs = switchRootAttributes({
      checked: props.checked ?? false,
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <label
        class={cn(switchClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
      >
        <input
          aria-checked={attrs['aria-checked']}
          aria-describedby={props.describedBy}
          aria-labelledby={props.labelledBy}
          checked={attrs.checked}
          class={cn(switchInputClassNames(), props.inputClass)}
          data-disabled={attrs['data-disabled']}
          data-state={attrs['data-state']}
          disabled={attrs.disabled}
          form={attrs.form}
          id={props.id}
          name={attrs.name}
          required={attrs.required}
          role={attrs.role}
          type={attrs.type}
          value={attrs.value}
        />
        {props.children}
      </label>
    );
  },
});
