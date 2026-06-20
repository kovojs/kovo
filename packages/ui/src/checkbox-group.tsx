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
import { bindingProps, passThroughProps } from './pass-through.js';

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
  // Custom square matching the standalone Checkbox box. Carries data-state to
  // paint the teal fill + check/dash glyph (mirrors checkbox.tsx `box`). Kept
  // under the `control` key so the public control class export is unchanged.
  control: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.borderStrong,
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    color: uiTheme.color.accentForeground,
    display: 'inline-flex',
    flexShrink: 0,
    height: 18,
    justifyContent: 'center',
    position: 'relative',
    transitionDuration: '0.15s',
    transitionProperty: 'background-color, border-color, box-shadow',
    width: 18,
    '[data-state=checked]': {
      backgroundColor: uiTheme.color.accent,
      borderColor: uiTheme.color.accent,
    },
    '[data-state=indeterminate]': {
      backgroundColor: uiTheme.color.accent,
      borderColor: uiTheme.color.accent,
    },
    // Checkmark (drawn with borders, rotated) shown only when checked.
    '[data-state=checked]::after': {
      borderColor: uiTheme.color.accentForeground,
      borderStyle: 'solid',
      borderWidth: '0 2px 2px 0',
      boxSizing: 'border-box',
      content: '""',
      height: 9,
      marginTop: -1,
      transform: 'rotate(45deg)',
      width: 5,
    },
    // Dash for the indeterminate state.
    '[data-state=indeterminate]::after': {
      backgroundColor: uiTheme.color.accentForeground,
      borderRadius: 1,
      content: '""',
      height: 2,
      width: 9,
    },
    ':focus-within': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
  },
  // Native checkbox kept for a11y/form state; visually hidden but still the
  // click/focus target stretched over the box (mirrors checkbox.tsx `input`).
  controlInput: {
    cursor: 'pointer',
    height: '100%',
    left: 0,
    margin: 0,
    opacity: 0,
    position: 'absolute',
    top: 0,
    width: '100%',
    ':disabled': {
      cursor: 'not-allowed',
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
    const boxStyleAttrs = style.attrs(checkboxGroupStyles.control, props.styles?.control);
    const inputStyleAttrs = style.attrs(checkboxGroupStyles.controlInput);

    // Custom box matching the standalone Checkbox (checkbox.tsx): a decorative
    // `span` paints the teal fill + check glyph driven by data-state, wrapping a
    // visually-hidden native input that remains the real checkbox — semantics,
    // form state, events, island ownership, and the single click/focus/tab
    // target. bindingProps forwards only the data-state binding stamp so the box
    // re-renders its fill client-side without becoming a second tab stop or
    // splitting the island scope (SPEC.md §4.6).
    return (
      <span
        {...boxStyleAttrs}
        {...bindingProps(props, ['data-state'])}
        data-state={attrs['data-state']}
      >
        <input
          {...inputStyleAttrs}
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
      </span>
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
