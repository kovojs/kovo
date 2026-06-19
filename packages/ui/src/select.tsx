/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  selectContentAttributes,
  selectHiddenInputAttributes,
  selectItemAttributes,
  selectRootAttributes,
  selectTriggerAttributes,
  selectValueAttributes,
  selectValueText,
  type SelectItem as HeadlessSelectItem,
} from '@kovojs/headless-ui/select';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface SelectStyleOverrides {
  content?: style.StyleInput;
  hiddenInput?: style.StyleInput;
  item?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
  value?: style.StyleInput;
}

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
  id?: string;
  styles?: SelectStyleOverrides;
}

export interface SelectTriggerProps extends SelectStateProps {
  children?: string;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  labelledBy?: string;
  styles?: SelectStyleOverrides;
}

export interface SelectHiddenInputProps extends SelectStateProps {
  id?: string;
  styles?: SelectStyleOverrides;
}

export interface SelectContentProps extends SelectStateProps {
  children?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: SelectStyleOverrides;
}

export interface SelectItemProps extends SelectStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemLabel?: string;
  itemValue: string;
  styles?: SelectStyleOverrides;
}

export interface SelectValueProps extends SelectStateProps {
  id?: string;
  styles?: SelectStyleOverrides;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const selectStyles = style.create(
  {
    content: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      color: uiTheme.color.foreground,
      fontSize: 14,
      marginTop: 4,
      maxHeight: 224,
      minWidth: 180,
      outlineStyle: 'none',
      overflow: 'auto',
      padding: 4,
      position: 'absolute',
      width: '100%',
      zIndex: 50,
      '[data-state=closed]': {
        display: 'none',
      },
      '[data-state=open]': {
        display: 'block',
      },
    },
    hiddenInput: {},
    item: {
      alignItems: 'center',
      borderRadius: uiTheme.radius.sm,
      color: uiTheme.color.foreground,
      cursor: 'default',
      display: 'flex',
      fontSize: 14,
      outlineStyle: 'none',
      paddingBlock: 6,
      paddingInline: 8,
      paddingLeft: 28,
      position: 'relative',
      '[data-disabled]': {
        color: uiTheme.color.foregroundMuted,
        opacity: 0.5,
        pointerEvents: 'none',
      },
      '[data-highlighted]': {
        backgroundColor: uiTheme.color.backgroundSubtle,
        color: uiTheme.color.foreground,
      },
      '[data-state=checked]': {
        fontWeight: 500,
      },
      '[data-state=checked]::before': {
        content: '"\\2713"',
        left: 8,
        position: 'absolute',
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
    trigger: {
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
        outlineColor: uiTheme.color.borderStrong,
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
    },
    value: {
      color: uiTheme.color.foregroundMuted,
      fontSize: 14,
      '[data-placeholder]': {
        color: uiTheme.color.foregroundMuted,
      },
    },
  },
  { namespace: 'select', source: 'select.tsx' },
);

export const selectClasses = [style.attrs(selectStyles.root).class ?? ''] as const;
export const selectTriggerClasses = [style.attrs(selectStyles.trigger).class ?? ''] as const;
export const selectContentClasses = [style.attrs(selectStyles.content).class ?? ''] as const;
export const selectItemClasses = [style.attrs(selectStyles.item).class ?? ''] as const;
export const selectValueClasses = [style.attrs(selectStyles.value).class ?? ''] as const;
export const selectHiddenInputClasses = [
  style.attrs(selectStyles.hiddenInput).class ?? '',
] as const;

export const Select = component({
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
    const styleAttrs = style.attrs(selectStyles.root, props.styles?.root);

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

export const SelectTrigger = component({
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
    const styleAttrs = style.attrs(selectStyles.trigger, props.styles?.trigger);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        aria-invalid={attrs['aria-invalid']}
        aria-labelledby={attrs['aria-labelledby']}
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

export const SelectHiddenInput = component({
  render(props: SelectHiddenInputProps) {
    const attrs = selectHiddenInputAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(selectStyles.hiddenInput, props.styles?.hiddenInput);

    return (
      <input
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const SelectContent = component({
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
    const styleAttrs = style.attrs(selectStyles.content, props.styles?.content);

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

export const SelectItem = component({
  render(props: SelectItemProps) {
    const attrs = selectItemAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.highlightedValue === undefined ? {} : { highlightedValue: props.highlightedValue }),
      ...(props.id === undefined ? {} : { id: props.id }),
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
    const styleAttrs = style.attrs(selectStyles.item, props.styles?.item);

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
        label={attrs.label}
        role={attrs.role}
        value={attrs.value}
      >
        {props.children ?? escapeHtml(props.itemLabel ?? props.itemValue ?? '')}
      </div>
    );
  },
});

export const SelectValue = component({
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
    const styleAttrs = style.attrs(selectStyles.value, props.styles?.value);

    return (
      <span
        {...styleAttrs}
        {...passThroughProps(props)}
        data-placeholder={attrs['data-placeholder']}
        id={attrs.id}
      >
        {escapeHtml(selectValueText(props))}
      </span>
    );
  },
});
