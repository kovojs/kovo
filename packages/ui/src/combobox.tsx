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
} from '@kovojs/headless-ui/combobox';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

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

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const comboboxStyles = style.create({
  input: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    fontSize: 14,
    height: 36,
    outlineStyle: 'none',
    paddingInline: 12,
    transitionProperty: 'background-color, border-color, color, box-shadow',
    width: '100%',
    '[data-placeholder]': {
      color: uiTheme.color.foregroundMuted,
    },
    '[aria-invalid=true]': {
      borderColor: uiTheme.color.danger.border,
    },
    ':disabled': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foregroundMuted,
      cursor: 'not-allowed',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
  },
  listbox: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    // T6 (UX): anchor the listbox flush to the bottom edge of the relative root
    // so it drops below the input instead of painting over it. marginTop is gap.
    left: 0,
    marginTop: 4,
    maxHeight: 224,
    minWidth: 180,
    overflow: 'auto',
    padding: 4,
    position: 'absolute',
    top: '100%',
    width: '100%',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    '[data-state=open]': {
      display: 'block',
    },
  },
  option: {
    alignItems: 'center',
    borderRadius: uiTheme.radius.sm,
    color: uiTheme.color.foregroundMuted,
    columnGap: 8,
    cursor: 'default',
    display: 'flex',
    fontSize: 14,
    paddingBlock: 6,
    paddingInline: 8,
    '[data-disabled]': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    '[data-highlighted]': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
    },
    '[aria-selected=true]': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
      fontWeight: 500,
    },
    '[data-state=checked]': {
      color: uiTheme.color.foreground,
      fontWeight: 500,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtle,
      color: uiTheme.color.foreground,
    },
  },
  root: {
    color: uiTheme.color.foreground,
    display: 'grid',
    fontSize: 14,
    position: 'relative',
    rowGap: 8,
    '[data-disabled]': {
      opacity: 0.5,
    },
    '[data-invalid]': {
      color: uiTheme.color.danger.foreground,
    },
  },
  value: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    '[data-placeholder]': {
      color: uiTheme.color.foregroundMuted,
    },
  },
});

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
        {...passThroughProps(props)}
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
        {...passThroughProps(props)}
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
        {...passThroughProps(props)}
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
        {...passThroughProps(props)}
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
        {...passThroughProps(props)}
        data-placeholder={attrs['data-placeholder']}
        id={attrs.id}
      >
        {escapeHtml(comboboxValueText(props))}
      </span>
    );
  },
});
