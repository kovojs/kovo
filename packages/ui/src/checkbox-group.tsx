/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupLabelAttributes,
  checkboxGroupRootAttributes,
  type CheckboxGroupItem as HeadlessCheckboxGroupItem,
} from '@kovojs/headless-ui/checkbox-group';
import * as style from '@kovojs/style';

import type { CollectionOrientation, TextDirection } from './navigation-types.js';
import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface CheckboxGroupStyleOverrides {
  control?: style.StyleInput;
  item?: style.StyleInput;
  label?: style.StyleInput;
  root?: style.StyleInput;
}

export interface CheckboxGroupStateProps {
  activeValue?: string;
  descriptionId?: string;
  dir?: TextDirection;
  disabled?: boolean;
  errorId?: string;
  form?: string;
  invalid?: boolean;
  items?: readonly HeadlessCheckboxGroupItem[];
  loop?: boolean;
  name?: string;
  orientation?: CollectionOrientation;
  required?: boolean;
  value?: readonly string[];
}

export interface CheckboxGroupProps extends CheckboxGroupStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: CheckboxGroupStyleOverrides;
}

export interface CheckboxGroupItemProps extends CheckboxGroupStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: CheckboxGroupStyleOverrides;
}

export interface CheckboxGroupControlProps extends CheckboxGroupStateProps {
  controlId?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: CheckboxGroupStyleOverrides;
}

export interface CheckboxGroupLabelProps extends CheckboxGroupStateProps {
  children?: string;
  controlId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: CheckboxGroupStyleOverrides;
}

export const checkboxGroupStyles = style.create({
  control: {
    accentColor: uiTheme.color.accent,
    borderColor: uiTheme.color.border,
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
    height: 16,
    width: 16,
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.borderStrong,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
  },
  item: {
    alignItems: 'center',
    columnGap: 8,
    display: 'inline-flex',
    '[data-disabled]': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
  label: {
    lineHeight: 1,
    userSelect: 'none',
    '[data-disabled]': {
      cursor: 'not-allowed',
    },
  },
  root: {
    color: uiTheme.color.foreground,
    display: 'grid',
    fontSize: 14,
    rowGap: 8,
    '[data-disabled]': {
      opacity: 0.5,
    },
    '[data-invalid]': {
      color: uiTheme.color.danger.foreground,
    },
    '[data-orientation=horizontal]': {
      alignItems: 'center',
      display: 'flex',
      flexWrap: 'wrap',
    },
  },
});

export const CheckboxGroup = component({
  render(props: CheckboxGroupProps) {
    const attrs = checkboxGroupRootAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
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
    const styleAttrs = style.attrs(checkboxGroupStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-invalid={attrs['aria-invalid']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-required={attrs['aria-required']}
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

export const CheckboxGroupItem = component({
  render(props: CheckboxGroupItemProps) {
    const attrs = checkboxGroupItemAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
      ...(props.items === undefined ? {} : { items: props.items }),
      itemValue: props.itemValue,
      ...(props.loop === undefined ? {} : { loop: props.loop }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(checkboxGroupStyles.item, props.styles?.item);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const CheckboxGroupControl = component({
  render(props: CheckboxGroupControlProps) {
    const attrs = checkboxGroupControlAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.form === undefined ? {} : { form: props.form }),
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
    const styleAttrs = style.attrs(checkboxGroupStyles.control, props.styles?.control);

    return (
      <input
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-checked={attrs['aria-checked']}
        checked={attrs.checked}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        form={attrs.form}
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

export const CheckboxGroupLabel = component({
  render(props: CheckboxGroupLabelProps) {
    const attrs = checkboxGroupLabelAttributes({
      ...(props.activeValue === undefined ? {} : { activeValue: props.activeValue }),
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.form === undefined ? {} : { form: props.form }),
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
    const styleAttrs = style.attrs(checkboxGroupStyles.label, props.styles?.label);

    return (
      <label
        {...styleAttrs}
        {...passThroughProps(props)}
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
