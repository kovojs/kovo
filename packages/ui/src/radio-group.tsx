/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  radioGroupItemAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
  type RadioGroupItem as HeadlessRadioGroupItem,
} from '@kovojs/headless-ui/radio-group';
import * as style from '@kovojs/style';

import type { CollectionOrientation, TextDirection } from './navigation-types.js';
import { bindingProps, passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the radio group components.
 *
 * @example
 * import type { RadioGroupStyleOverrides } from "@kovojs/ui/radio-group";
 * const styles: RadioGroupStyleOverrides = {};
 */
export interface RadioGroupStyleOverrides {
  item?: style.StyleInput;
  label?: style.StyleInput;
  radio?: style.StyleInput;
  radioControl?: style.StyleInput;
  root?: style.StyleInput;
}

/**
 * Shared state props for the radio group component family.
 *
 * @example
 * import type { RadioGroupStateProps } from "@kovojs/ui/radio-group";
 * const state: RadioGroupStateProps = {};
 */
export interface RadioGroupStateProps {
  descriptionId?: string;
  dir?: TextDirection;
  disabled?: boolean;
  errorId?: string;
  form?: string;
  invalid?: boolean;
  items?: readonly HeadlessRadioGroupItem[];
  loop?: boolean;
  name?: string;
  orientation?: CollectionOrientation;
  required?: boolean;
  value?: string;
}

/**
 * Props for the radio group component.
 *
 * @example
 * import type { RadioGroupProps } from "@kovojs/ui/radio-group";
 * const props: RadioGroupProps = { children: 'Content' };
 */
export interface RadioGroupProps extends RadioGroupStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: RadioGroupStyleOverrides;
}

/**
 * Props for the radio group item component.
 *
 * @example
 * import type { RadioGroupItemProps } from "@kovojs/ui/radio-group";
 * const props: RadioGroupItemProps = { itemValue: 'item', children: 'Content' };
 */
export interface RadioGroupItemProps extends RadioGroupStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: RadioGroupStyleOverrides;
}

/**
 * Props for the radio group radio component.
 *
 * @example
 * import type { RadioGroupRadioProps } from "@kovojs/ui/radio-group";
 * const props: RadioGroupRadioProps = { itemValue: 'item' };
 */
export interface RadioGroupRadioProps extends RadioGroupStateProps {
  controlId?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: RadioGroupStyleOverrides;
}

/**
 * Props for the radio group label component.
 *
 * @example
 * import type { RadioGroupLabelProps } from "@kovojs/ui/radio-group";
 * const props: RadioGroupLabelProps = { itemValue: 'item', children: 'Content' };
 */
export interface RadioGroupLabelProps extends RadioGroupStateProps {
  children?: string;
  controlId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: RadioGroupStyleOverrides;
}

/**
 * Style definitions used by the radio group components.
 *
 * @example
 * import { radioGroupStyles } from "@kovojs/ui/radio-group";
 * const styles = radioGroupStyles;
 */
export const radioGroupStyles = style.create({
  item: {
    alignItems: 'center',
    columnGap: 8,
    display: 'inline-flex',
    // Hug control+label instead of stretching the full grid column so each row
    // reads as a compact radio + label (matches shadcn).
    justifySelf: 'start',
    width: 'fit-content',
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
  // Native radio kept for a11y/form state; visually hidden, stretched over
  // the custom circle so it stays the click/focus target.
  radio: {
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
  // Custom circle. Carries data-state to paint the selected center dot.
  radioControl: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.borderStrong,
    borderRadius: uiTheme.radius.full,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    display: 'inline-flex',
    flexShrink: 0,
    height: 18,
    justifyContent: 'center',
    position: 'relative',
    transitionDuration: '0.15s',
    transitionProperty: 'border-color, box-shadow',
    width: 18,
    '[data-state=checked]': {
      borderColor: uiTheme.color.accent,
    },
    '[data-state=checked]::after': {
      backgroundColor: uiTheme.color.accent,
      borderRadius: uiTheme.radius.full,
      content: '""',
      height: 9,
      width: 9,
    },
    ':focus-within': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
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

/**
 * Renders the styled radio group primitive.
 *
 * @example
 * import { RadioGroup } from "@kovojs/ui/radio-group";
 * const component = RadioGroup;
 */
export const RadioGroup = component({
  render(props: RadioGroupProps) {
    const attrs = radioGroupRootAttributes({
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
    const styleAttrs = style.attrs(radioGroupStyles.root, props.styles?.root);

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

/**
 * Renders the styled radio group item primitive.
 *
 * @example
 * import { RadioGroupItem } from "@kovojs/ui/radio-group";
 * const component = RadioGroupItem;
 */
export const RadioGroupItem = component({
  render(props: RadioGroupItemProps) {
    const attrs = radioGroupItemAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
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
    const styleAttrs = style.attrs(radioGroupStyles.item, props.styles?.item);

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

/**
 * Renders the styled radio group radio primitive.
 *
 * @example
 * import { RadioGroupRadio } from "@kovojs/ui/radio-group";
 * const component = RadioGroupRadio;
 */
export const RadioGroupRadio = component({
  render(props: RadioGroupRadioProps) {
    const attrs = radioGroupRadioAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
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
    const styleAttrs = style.attrs(radioGroupStyles.radio, props.styles?.radio);
    const controlStyleAttrs = style.attrs(
      radioGroupStyles.radioControl,
      props.styles?.radioControl,
    );

    return (
      <span
        {...controlStyleAttrs}
        {...bindingProps(props, ['data-state'])}
        data-state={attrs['data-state']}
      >
        <input
          {...styleAttrs}
          {...passThroughProps(props, { island: false })}
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

/**
 * Renders the styled radio group label primitive.
 *
 * @example
 * import { RadioGroupLabel } from "@kovojs/ui/radio-group";
 * const component = RadioGroupLabel;
 */
export const RadioGroupLabel = component({
  render(props: RadioGroupLabelProps) {
    const attrs = radioGroupLabelAttributes({
      ...(props.dir === undefined ? {} : { dir: props.dir }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
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
    const styleAttrs = style.attrs(radioGroupStyles.label, props.styles?.label);

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
