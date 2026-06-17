/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  autocompleteInputAttributes,
  autocompleteListAttributes,
  autocompleteOptionAttributes,
  autocompleteRootAttributes,
  autocompleteValueAttributes,
  autocompleteValueText,
  type AutocompleteItem as HeadlessAutocompleteItem,
} from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

export interface AutocompleteStyleOverrides {
  input?: style.StyleInput;
  list?: style.StyleInput;
  option?: style.StyleInput;
  root?: style.StyleInput;
  value?: style.StyleInput;
}

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
  id?: string;
  styles?: AutocompleteStyleOverrides;
}

export interface AutocompleteInputProps extends AutocompleteStateProps {
  autocomplete?: string;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
  styles?: AutocompleteStyleOverrides;
}

export interface AutocompleteListProps extends AutocompleteStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: AutocompleteStyleOverrides;
}

export interface AutocompleteOptionProps extends AutocompleteStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: AutocompleteStyleOverrides;
}

export interface AutocompleteValueProps extends AutocompleteStateProps {
  id?: string;
  styles?: AutocompleteStyleOverrides;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const autocompleteStyles = style.create(
  {
    input: {
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d4',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: '#0a0a0a',
      fontSize: 14,
      height: 36,
      outlineStyle: 'none',
      paddingInline: 12,
      transitionProperty: 'background-color, border-color, color, box-shadow',
      width: '100%',
      '[data-placeholder]': {
        color: '#737373',
      },
      '[aria-invalid=true]': {
        borderColor: '#f87171',
      },
      ':disabled': {
        backgroundColor: '#f5f5f5',
        color: '#737373',
        cursor: 'not-allowed',
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
    },
    list: {
      backgroundColor: '#ffffff',
      borderColor: '#e5e5e5',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: '#0a0a0a',
      fontSize: 14,
      '[data-state=closed]': {
        display: 'none',
      },
    },
    option: {
      color: '#0a0a0a',
      '[data-disabled]': {
        color: '#a3a3a3',
      },
      '[data-highlighted]': {
        fontWeight: 500,
      },
      '[data-state=checked]': {
        fontWeight: 500,
      },
    },
    root: {
      color: '#0a0a0a',
      display: 'grid',
      fontSize: 14,
      rowGap: 8,
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-invalid]': {
        color: '#450a0a',
      },
    },
    value: {
      color: '#404040',
      fontSize: 14,
      '[data-placeholder]': {
        color: '#737373',
      },
    },
  },
  { namespace: 'autocomplete', source: 'autocomplete.tsx' },
);

export const autocompleteClasses = [style.attrs(autocompleteStyles.root).class ?? ''] as const;
export const autocompleteInputClasses = [
  style.attrs(autocompleteStyles.input).class ?? '',
] as const;
export const autocompleteListClasses = [style.attrs(autocompleteStyles.list).class ?? ''] as const;
export const autocompleteOptionClasses = [
  style.attrs(autocompleteStyles.option).class ?? '',
] as const;
export const autocompleteValueClasses = [
  style.attrs(autocompleteStyles.value).class ?? '',
] as const;

export const Autocomplete = component({
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
    const styleAttrs = style.attrs(autocompleteStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
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

export const AutocompleteInput = component({
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
    const styleAttrs = style.attrs(autocompleteStyles.input, props.styles?.input);

    return (
      <input
        {...styleAttrs}
        aria-activedescendant={attrs['aria-activedescendant']}
        aria-autocomplete={attrs['aria-autocomplete']}
        aria-controls={attrs['aria-controls']}
        aria-describedby={attrs['aria-describedby']}
        aria-expanded={attrs['aria-expanded']}
        aria-invalid={attrs['aria-invalid']}
        aria-labelledby={attrs['aria-labelledby']}
        autocomplete={attrs.autocomplete}
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

export const AutocompleteList = component({
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
    const styleAttrs = style.attrs(autocompleteStyles.list, props.styles?.list);

    return (
      <div
        {...styleAttrs}
        aria-labelledby={attrs['aria-labelledby']}
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

export const AutocompleteOption = component({
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
    const styleAttrs = style.attrs(autocompleteStyles.option, props.styles?.option);

    return (
      <div
        {...styleAttrs}
        aria-disabled={attrs['aria-disabled']}
        aria-selected={attrs['aria-selected']}
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

export const AutocompleteValue = component({
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
    const styleAttrs = style.attrs(autocompleteStyles.value, props.styles?.value);

    return (
      <span {...styleAttrs} data-placeholder={attrs['data-placeholder']} id={attrs.id}>
        {escapeHtml(autocompleteValueText(props))}
      </span>
    );
  },
});
