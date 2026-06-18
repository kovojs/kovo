/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  radioGroupItemAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
  type RadioGroupItem as HeadlessRadioGroupItem,
} from '@kovojs/headless-ui/radio-group';
import type { CollectionOrientation, TextDirection } from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

export interface RadioGroupStyleOverrides {
  item?: style.StyleInput;
  label?: style.StyleInput;
  radio?: style.StyleInput;
  root?: style.StyleInput;
}

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

export interface RadioGroupProps extends RadioGroupStateProps {
  children?: string;
  id?: string;
  labelledBy?: string;
  styles?: RadioGroupStyleOverrides;
}

export interface RadioGroupItemProps extends RadioGroupStateProps {
  children?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: RadioGroupStyleOverrides;
}

export interface RadioGroupRadioProps extends RadioGroupStateProps {
  controlId?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: RadioGroupStyleOverrides;
}

export interface RadioGroupLabelProps extends RadioGroupStateProps {
  children?: string;
  controlId?: string;
  id?: string;
  itemDisabled?: boolean;
  itemValue: string;
  styles?: RadioGroupStyleOverrides;
}

export const radioGroupStyles = style.create(
  {
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
    radio: {
      accentColor: '#0a0a0a',
      borderColor: '#d4d4d4',
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#0a0a0a',
      height: 16,
      width: 16,
      ':disabled': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
      ':focus-visible': {
        outlineColor: '#0a0a0a',
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
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
      '[data-orientation=horizontal]': {
        alignItems: 'center',
        display: 'flex',
        flexWrap: 'wrap',
      },
    },
  },
  { namespace: 'radioGroup', source: 'radio-group.tsx' },
);

export const radioGroupClasses = [style.attrs(radioGroupStyles.root).class ?? ''] as const;
export const radioGroupItemClasses = [style.attrs(radioGroupStyles.item).class ?? ''] as const;
export const radioGroupRadioClasses = [style.attrs(radioGroupStyles.radio).class ?? ''] as const;
export const radioGroupLabelClasses = [style.attrs(radioGroupStyles.label).class ?? ''] as const;

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
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

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

    return (
      <input
        {...styleAttrs}
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
