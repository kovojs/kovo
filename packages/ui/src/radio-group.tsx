/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  radioGroupItemAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
  type ClassValue,
  type CollectionOrientation,
  type RadioGroupItem as HeadlessRadioGroupItem,
  type TextDirection,
} from '@jiso/headless-ui';

export interface RadioGroupStateProps {
  descriptionId?: string;
  dir?: TextDirection;
  disabled?: boolean;
  errorId?: string;
  invalid?: boolean;
  items?: readonly HeadlessRadioGroupItem[];
  loop?: boolean;
  name?: string;
  orientation?: CollectionOrientation;
  required?: boolean;
  value?: string;
}

export interface RadioGroupProps extends RadioGroupStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface RadioGroupItemProps extends RadioGroupStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface RadioGroupRadioProps extends RadioGroupStateProps {
  class?: ClassValue;
  controlId?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface RadioGroupLabelProps extends RadioGroupStateProps {
  children?: string;
  class?: ClassValue;
  controlId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
}

export const radioGroupClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[orientation=horizontal]:flex data-[orientation=horizontal]:flex-wrap data-[orientation=horizontal]:items-center data-[invalid]:text-red-950',
  variants: {},
});

export const radioGroupItemClassNames = defineVariants({
  base: 'inline-flex items-center gap-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  variants: {},
});

export const radioGroupRadioClassNames = defineVariants({
  base: 'h-4 w-4 border border-neutral-300 text-neutral-950 accent-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50',
  variants: {},
});

export const radioGroupLabelClassNames = defineVariants({
  base: 'select-none leading-none data-[disabled]:cursor-not-allowed',
  variants: {},
});

export const radioGroupClasses = radioGroupClassNames.classes;
export const radioGroupItemClasses = radioGroupItemClassNames.classes;
export const radioGroupRadioClasses = radioGroupRadioClassNames.classes;
export const radioGroupLabelClasses = radioGroupLabelClassNames.classes;

export const RadioGroup = component('radio-group', {
  render(props: RadioGroupProps) {
    const attrs = radioGroupRootAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
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
        class={cn(radioGroupClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-orientation={attrs['data-orientation']}
        data-required={attrs['data-required']}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const RadioGroupItem = component('radio-group-item', {
  render(props: RadioGroupItemProps) {
    const attrs = radioGroupItemAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        class={cn(radioGroupItemClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const RadioGroupRadio = component('radio-group-radio', {
  render(props: RadioGroupRadioProps) {
    const attrs = radioGroupRadioAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.controlId === undefined ? {} : { controlId: props.controlId }),
    });

    return (
      <input
        aria-checked={attrs['aria-checked']}
        checked={attrs.checked}
        class={cn(radioGroupRadioClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={attrs.id}
        name={attrs.name}
        required={attrs.required}
        tabIndex={attrs.tabIndex}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});

export const RadioGroupLabel = component('radio-group-label', {
  render(props: RadioGroupLabelProps) {
    const attrs = radioGroupLabelAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.controlId === undefined ? {} : { controlId: props.controlId }),
    });

    return (
      <label
        class={cn(radioGroupLabelClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        for={attrs.for}
        id={attrs.id}
      >
        {props.children}
      </label>
    );
  },
});
