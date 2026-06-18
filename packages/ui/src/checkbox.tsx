/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { checkboxRootAttributes, type CheckboxCheckedState } from '@kovojs/headless-ui/checkbox';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface CheckboxStyleOverrides {
  input?: style.StyleInput;
  root?: style.StyleInput;
}

export interface CheckboxProps {
  describedBy?: string;
  checked?: CheckboxCheckedState;
  children?: string;
  disabled?: boolean;
  form?: string;
  id?: string;
  labelledBy?: string;
  name?: string;
  required?: boolean;
  styles?: CheckboxStyleOverrides;
  value?: string;
}

export const checkboxStyles = style.create(
  {
    input: {
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
  { namespace: 'checkbox', source: 'checkbox.tsx' },
);

export const checkboxClasses = [style.attrs(checkboxStyles.root).class ?? ''] as const;
export const checkboxInputClasses = [style.attrs(checkboxStyles.input).class ?? ''] as const;

export const Checkbox = component({
  render(props: CheckboxProps) {
    const attrs = checkboxRootAttributes({
      checked: props.checked ?? false,
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const rootStyleAttrs = style.attrs(checkboxStyles.root, props.styles?.root);
    const inputStyleAttrs = style.attrs(checkboxStyles.input, props.styles?.input);

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
          form={props.form}
          id={props.id}
          name={attrs.name}
          required={attrs.required}
          type={attrs.type}
          value={attrs.value}
        />
        {props.children}
      </label>
    );
  },
});

export * from '@kovojs/headless-ui/checkbox';
