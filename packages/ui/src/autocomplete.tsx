/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  autocompleteInputAttributes,
  autocompleteListAttributes,
  autocompleteOptionAttributes,
  autocompleteRootAttributes,
  autocompleteValueAttributes,
  autocompleteValueText,
  cn,
  defineVariants,
  type AutocompleteItem as HeadlessAutocompleteItem,
  type ClassValue,
} from '@jiso/headless-ui';

export interface AutocompleteStateProps {
  disabled?: boolean;
  form?: string;
  highlightedValue?: string;
  inputValue?: string;
  invalid?: boolean;
  items?: readonly HeadlessAutocompleteItem[];
  listId?: string;
  name?: string;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

export interface AutocompleteProps extends AutocompleteStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface AutocompleteInputProps extends AutocompleteStateProps {
  autocomplete?: string;
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
}

export interface AutocompleteListProps extends AutocompleteStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  labelledBy?: string;
}

export interface AutocompleteOptionProps extends AutocompleteStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
}

export interface AutocompleteValueProps extends AutocompleteStateProps {
  class?: ClassValue;
  id?: string;
}

export const autocompleteClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950',
  variants: {},
});

export const autocompleteInputClassNames = defineVariants({
  base: 'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500',
  variants: {},
});

export const autocompleteListClassNames = defineVariants({
  base: 'rounded-md border border-neutral-200 bg-white text-sm text-neutral-950 shadow-sm',
  variants: {},
});

export const autocompleteOptionClassNames = defineVariants({
  base: 'text-neutral-950 data-[highlighted]:font-medium data-[state=checked]:font-medium disabled:text-neutral-400',
  variants: {},
});

export const autocompleteValueClassNames = defineVariants({
  base: 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500',
  variants: {},
});

export const autocompleteClasses = autocompleteClassNames.classes;
export const autocompleteInputClasses = autocompleteInputClassNames.classes;
export const autocompleteListClasses = autocompleteListClassNames.classes;
export const autocompleteOptionClasses = autocompleteOptionClassNames.classes;
export const autocompleteValueClasses = autocompleteValueClassNames.classes;

export const Autocomplete = component('autocomplete', {
  render(props: AutocompleteProps) {
    const attrs = autocompleteRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputValue === undefined ? {} : { inputValue: props.inputValue }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.listId === undefined ? {} : { listId: props.listId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <div
        class={cn(autocompleteClassNames(), props.class)}
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

export const AutocompleteInput = component('autocomplete-input', {
  render(props: AutocompleteInputProps) {
    const attrs = autocompleteInputAttributes({
      ...(props.autocomplete === undefined ? {} : { autocomplete: props.autocomplete }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputValue === undefined ? {} : { inputValue: props.inputValue }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.listId === undefined ? {} : { listId: props.listId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <input
        aria-activedescendant={attrs['aria-activedescendant']}
        aria-autocomplete={attrs['aria-autocomplete']}
        aria-controls={attrs['aria-controls']}
        aria-describedby={attrs['aria-describedby']}
        aria-expanded={attrs['aria-expanded']}
        aria-invalid={attrs['aria-invalid']}
        aria-labelledby={attrs['aria-labelledby']}
        autocomplete={attrs.autocomplete}
        class={cn(autocompleteInputClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-placeholder={attrs['data-placeholder']}
        data-required={attrs['data-required']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        list={attrs.list}
        name={attrs.name}
        placeholder={attrs.placeholder}
        required={attrs.required}
        role={attrs.role}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});

export const AutocompleteList = component('autocomplete-list', {
  render(props: AutocompleteListProps) {
    const attrs = autocompleteListAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputValue === undefined ? {} : { inputValue: props.inputValue }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.listId === undefined ? {} : { listId: props.listId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <datalist
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(autocompleteListClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-placeholder={attrs['data-placeholder']}
        data-required={attrs['data-required']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </datalist>
    );
  },
});

export const AutocompleteOption = component('autocomplete-option', {
  render(props: AutocompleteOptionProps) {
    const attrs = autocompleteOptionAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputValue === undefined ? {} : { inputValue: props.inputValue }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.listId === undefined ? {} : { listId: props.listId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <option
        class={cn(autocompleteOptionClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-highlighted={attrs['data-highlighted']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={attrs.id}
        label={attrs.label}
        selected={attrs.selected}
        value={attrs.value}
      >
        {props.children ?? props.itemLabel ?? props.itemValue}
      </option>
    );
  },
});

export const AutocompleteValue = component('autocomplete-value', {
  render(props: AutocompleteValueProps) {
    const attrs = autocompleteValueAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.inputValue === undefined ? {} : { inputValue: props.inputValue }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.items === undefined ? {} : { items: props.items }),
      ...(props.listId === undefined ? {} : { listId: props.listId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });

    return (
      <span
        class={cn(autocompleteValueClassNames(), props.class)}
        data-placeholder={attrs['data-placeholder']}
        id={attrs.id}
      >
        {autocompleteValueText(props)}
      </span>
    );
  },
});
