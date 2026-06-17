/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  comboboxInputAttributes,
  comboboxListboxAttributes,
  comboboxOptionAttributes,
  comboboxRootAttributes,
  comboboxValueAttributes,
  comboboxValueText,
  type ComboboxItem as HeadlessComboboxItem,
} from '@kovojs/headless-ui';
import { escapeHtml } from '@kovojs/server';
import * as style from '@kovojs/style';

export interface ComboboxStyleOverrides {
  input?: style.StyleInput;
  listbox?: style.StyleInput;
  option?: style.StyleInput;
  root?: style.StyleInput;
  value?: style.StyleInput;
}

export interface ComboboxStateProps {
  disabled?: boolean;
  form?: string;
  highlightedValue?: string;
  invalid?: boolean;
  items?: readonly HeadlessComboboxItem[];
  listboxId?: string;
  name?: string;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

export interface ComboboxProps extends ComboboxStateProps {
  children?: string;
  id?: string;
  styles?: ComboboxStyleOverrides;
}

export interface ComboboxInputProps extends ComboboxStateProps {
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
  styles?: ComboboxStyleOverrides;
}

export interface ComboboxListboxProps extends ComboboxStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: ComboboxStyleOverrides;
}

export interface ComboboxOptionProps extends ComboboxStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: ComboboxStyleOverrides;
}

export interface ComboboxValueProps extends ComboboxStateProps {
  id?: string;
  styles?: ComboboxStyleOverrides;
}

export const comboboxStyles = style.create(
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
    listbox: {
      backgroundColor: '#ffffff',
      borderColor: '#e5e5e5',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      maxHeight: 224,
      overflow: 'auto',
      padding: 4,
      '[data-state=closed]': {
        display: 'none',
      },
    },
    option: {
      borderRadius: 4,
      color: '#404040',
      fontSize: 14,
      paddingBlock: 6,
      paddingInline: 8,
      '[data-disabled]': {
        opacity: 0.5,
        pointerEvents: 'none',
      },
      '[data-highlighted]': {
        backgroundColor: '#f5f5f5',
      },
      '[data-state=checked]': {
        color: '#0a0a0a',
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
  { namespace: 'combobox', source: 'combobox.tsx' },
);

export const comboboxClasses = [style.attrs(comboboxStyles.root).class ?? ''] as const;
export const comboboxInputClasses = [style.attrs(comboboxStyles.input).class ?? ''] as const;
export const comboboxListboxClasses = [style.attrs(comboboxStyles.listbox).class ?? ''] as const;
export const comboboxOptionClasses = [style.attrs(comboboxStyles.option).class ?? ''] as const;
export const comboboxValueClasses = [style.attrs(comboboxStyles.value).class ?? ''] as const;

export const Combobox = component({
  render(props: ComboboxProps) {
    const attrs = comboboxRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
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
    const styleAttrs = style.attrs(comboboxStyles.root, props.styles?.root);

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

export const ComboboxInput = component({
  render(props: ComboboxInputProps) {
    const attrs = comboboxInputAttributes({
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
    const styleAttrs = style.attrs(comboboxStyles.input, props.styles?.input);

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

export const ComboboxListbox = component({
  render(props: ComboboxListboxProps) {
    const attrs = comboboxListboxAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
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
    const styleAttrs = style.attrs(comboboxStyles.listbox, props.styles?.listbox);

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

export const ComboboxOption = component({
  render(props: ComboboxOptionProps) {
    const attrs = comboboxOptionAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.itemLabel === undefined ? {} : { itemLabel: props.itemLabel }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.listboxId === undefined ? {} : { listboxId: props.listboxId }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(comboboxStyles.option, props.styles?.option);

    return (
      <div
        {...styleAttrs}
        aria-disabled={attrs['aria-disabled']}
        aria-selected={attrs['aria-selected']}
        data-disabled={attrs['data-disabled']}
        data-highlighted={attrs['data-highlighted']}
        data-state={attrs['data-state']}
        id={attrs.id}
        role={attrs.role}
        value={attrs.value}
      >
        {props.children ?? escapeHtml(props.itemLabel ?? props.itemValue ?? '')}
      </div>
    );
  },
});

export const ComboboxValue = component({
  render(props: ComboboxValueProps) {
    const attrs = comboboxValueAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
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
    const styleAttrs = style.attrs(comboboxStyles.value, props.styles?.value);

    return (
      <span
        {...styleAttrs}
        data-placeholder={attrs['data-placeholder']}
        id={attrs.id}
      >
        {escapeHtml(comboboxValueText(props))}
      </span>
    );
  },
});
