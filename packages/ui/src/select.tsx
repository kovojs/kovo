/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  selectContentAttributes,
  selectHiddenInputAttributes,
  selectItemAttributes,
  selectRootAttributes,
  selectTriggerAttributes,
  selectValueAttributes,
  selectValueText,
  type ClassValue,
  type SelectItem as HeadlessSelectItem,
} from '@jiso/headless-ui';
import { escapeHtml } from '@jiso/server';

export interface SelectStateProps {
  disabled?: boolean;
  form?: string;
  highlightedValue?: string;
  invalid?: boolean;
  items?: readonly HeadlessSelectItem[];
  listboxId?: string;
  name?: string;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

export interface SelectProps extends SelectStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface SelectTriggerProps extends SelectStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface SelectHiddenInputProps extends SelectStateProps {
  class?: ClassValue;
  id?: string;
}

export interface SelectContentProps extends SelectStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  label?: string;
  labelledBy?: string;
}

export interface SelectItemProps extends SelectStateProps {
  children?: string;
  class?: ClassValue;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface SelectValueProps extends SelectStateProps {
  class?: ClassValue;
  id?: string;
}

export const selectClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950',
  variants: {},
});

export const selectTriggerClassNames = defineVariants({
  base: 'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500',
  variants: {},
});

export const selectContentClassNames = defineVariants({
  base: 'bg-white text-sm text-neutral-950 data-[state=open]:block data-[state=closed]:hidden',
  variants: {},
});

export const selectItemClassNames = defineVariants({
  base: 'text-neutral-950 data-[state=checked]:font-medium disabled:text-neutral-400',
  variants: {},
});

export const selectValueClassNames = defineVariants({
  base: 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500',
  variants: {},
});

export const selectClasses = selectClassNames.classes;
export const selectTriggerClasses = selectTriggerClassNames.classes;
export const selectContentClasses = selectContentClassNames.classes;
export const selectItemClasses = selectItemClassNames.classes;
export const selectValueClasses = selectValueClassNames.classes;

export const Select = component('select', {
  render(props: SelectProps) {
    const attrs = selectRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.listboxId === undefined ? {} : { listboxId: props.listboxId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        class={cn(selectClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-placeholder={attrs['data-placeholder']}
        data-required={attrs['data-required']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const SelectTrigger = component('select-trigger', {
  render(props: SelectTriggerProps) {
    const attrs = selectTriggerAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.listboxId === undefined ? {} : { listboxId: props.listboxId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <button
        aria-describedby={attrs['aria-describedby']}
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-invalid={attrs['aria-invalid']}
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(selectTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-placeholder={attrs['data-placeholder']}
        data-required={attrs['data-required']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={attrs.id}
        type={attrs.type}
      >
        {props.children}
      </button>
    );
  },
});

export const SelectHiddenInput = component('select-hidden-input', {
  render(props: SelectHiddenInputProps) {
    const attrs = selectHiddenInputAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <input
        class={props.class}
        disabled={attrs.disabled}
        form={attrs.form}
        id={props.id}
        name={attrs.name}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});

export const SelectContent = component('select-content', {
  render(props: SelectContentProps) {
    const attrs = selectContentAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.listboxId === undefined ? {} : { listboxId: props.listboxId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(selectContentClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-placeholder={attrs['data-placeholder']}
        data-required={attrs['data-required']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const SelectItem = component('select-item', {
  render(props: SelectItemProps) {
    const attrs = selectItemAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.listboxId === undefined ? {} : { listboxId: props.listboxId }),
      itemValue: props.itemValue,
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        aria-disabled={attrs['aria-disabled']}
        aria-selected={attrs['aria-selected']}
        class={cn(selectItemClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-highlighted={attrs['data-highlighted']}
        data-state={attrs['data-state']}
        id={attrs.id}
        label={attrs.label}
        role={attrs.role}
        value={attrs.value}
      >
        {props.children ?? escapeHtml(props.itemLabel ?? props.itemValue ?? '')}
      </div>
    );
  },
});

export const SelectValue = component('select-value', {
  render(props: SelectValueProps) {
    const attrs = selectValueAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.listboxId === undefined ? {} : { listboxId: props.listboxId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <span
        class={cn(selectValueClassNames(), props.class)}
        data-placeholder={attrs['data-placeholder']}
        id={attrs.id}
      >
        {escapeHtml(selectValueText(props))}
      </span>
    );
  },
});
