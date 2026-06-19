/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { checkboxRootAttributes, type CheckboxCheckedState } from '@kovojs/headless-ui/checkbox';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface CheckboxStyleOverrides {
  box?: style.StyleInput;
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
    // Custom square. Carries data-state to paint the fill + check/dash glyph.
    box: {
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
        outlineColor: uiTheme.color.borderStrong,
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
    },
    // Native checkbox kept for a11y/form state; visually hidden but still the
    // click/focus target (stretched over the box).
    input: {
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
    root: {
      alignItems: 'center',
      color: uiTheme.color.foreground,
      columnGap: 8,
      cursor: 'pointer',
      display: 'inline-flex',
      fontSize: 14,
      lineHeight: 1,
      userSelect: 'none',
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
export const checkboxBoxClasses = [style.attrs(checkboxStyles.box).class ?? ''] as const;

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
    const boxStyleAttrs = style.attrs(checkboxStyles.box, props.styles?.box);

    return (
      <label
        {...rootStyleAttrs}
        {...passThroughProps(props, { events: false })}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
      >
        <span {...boxStyleAttrs} data-state={attrs['data-state']}>
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
        </span>
        {props.children}
      </label>
    );
  },
});

export * from '@kovojs/headless-ui/checkbox';
