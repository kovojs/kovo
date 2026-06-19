/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { switchRootAttributes } from '@kovojs/headless-ui/switch';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface SwitchStyleOverrides {
  input?: style.StyleInput;
  root?: style.StyleInput;
}

export interface SwitchProps {
  describedBy?: string;
  checked?: boolean;
  children?: string;
  disabled?: boolean;
  form?: string;
  id?: string;
  labelledBy?: string;
  name?: string;
  required?: boolean;
  styles?: SwitchStyleOverrides;
  value?: string;
}

export const switchStyles = style.create(
  {
    input: {
      accentColor: uiTheme.color.accent,
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.full,
      borderStyle: 'solid',
      borderWidth: 1,
      height: 20,
      transitionProperty: 'background-color, border-color, color, box-shadow',
      width: 36,
      ':checked': {
        backgroundColor: uiTheme.color.accent,
      },
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
    root: {
      alignItems: 'center',
      color: uiTheme.color.foreground,
      columnGap: 8,
      display: 'inline-flex',
      fontSize: 14,
      '[data-disabled]': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
  },
  { namespace: 'switch', source: 'switch.tsx' },
);

export const switchClasses = [style.attrs(switchStyles.root).class ?? ''] as const;
export const switchInputClasses = [style.attrs(switchStyles.input).class ?? ''] as const;

export const Switch = component({
  render(props: SwitchProps) {
    const attrs = switchRootAttributes({
      checked: props.checked ?? false,
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const rootStyleAttrs = style.attrs(switchStyles.root, props.styles?.root);
    const inputStyleAttrs = style.attrs(switchStyles.input, props.styles?.input);

    return (
      <label
        {...rootStyleAttrs}
        {...passThroughProps(props, { events: false })}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
      >
        <input
          {...inputStyleAttrs}
          {...passThroughProps(props)}
          aria-checked={attrs['aria-checked']}
          aria-describedby={props.describedBy}
          aria-labelledby={props.labelledBy}
          checked={attrs.checked}
          data-disabled={attrs['data-disabled']}
          data-state={attrs['data-state']}
          disabled={attrs.disabled}
          form={attrs.form}
          id={props.id}
          name={attrs.name}
          required={attrs.required}
          role={attrs.role}
          type={attrs.type}
          value={attrs.value}
        />
        {props.children}
      </label>
    );
  },
});
