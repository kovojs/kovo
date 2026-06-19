/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { switchRootAttributes } from '@kovojs/headless-ui/switch';
import * as style from '@kovojs/style';

import { bindingProps, passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface SwitchStyleOverrides {
  input?: style.StyleInput;
  root?: style.StyleInput;
  thumb?: style.StyleInput;
  track?: style.StyleInput;
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
    // Native checkbox kept for a11y/form state; visually hidden but still the
    // click/focus target (stretched over the track via absolute positioning).
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
      fontWeight: 500,
      lineHeight: 1,
      userSelect: 'none',
      '[data-disabled]': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
    // The visible pill. Carries data-state so it tracks the checked color.
    track: {
      alignItems: 'center',
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
      borderColor: 'transparent',
      borderRadius: uiTheme.radius.full,
      borderStyle: 'solid',
      borderWidth: 2,
      boxSizing: 'border-box',
      display: 'inline-flex',
      flexShrink: 0,
      height: 24,
      position: 'relative',
      transitionDuration: '0.15s',
      transitionProperty: 'background-color, border-color, box-shadow',
      width: 44,
      '[data-state=checked]': {
        backgroundColor: uiTheme.color.accent,
      },
      ':focus-within': {
        outlineColor: uiTheme.color.borderStrong,
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
    },
    // The sliding knob. Slides via translateX keyed on its own data-state.
    thumb: {
      backgroundColor: uiTheme.color.background,
      borderRadius: uiTheme.radius.full,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.2)',
      display: 'block',
      height: 16,
      pointerEvents: 'none',
      transform: 'translateX(2px)',
      transitionDuration: '0.15s',
      transitionProperty: 'transform',
      width: 16,
      '[data-state=checked]': {
        transform: 'translateX(22px)',
      },
    },
  },
  { namespace: 'switch', source: 'switch.tsx' },
);

export const switchClasses = [style.attrs(switchStyles.root).class ?? ''] as const;
export const switchInputClasses = [style.attrs(switchStyles.input).class ?? ''] as const;
export const switchTrackClasses = [style.attrs(switchStyles.track).class ?? ''] as const;
export const switchThumbClasses = [style.attrs(switchStyles.thumb).class ?? ''] as const;

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
    const trackStyleAttrs = style.attrs(switchStyles.track, props.styles?.track);
    const thumbStyleAttrs = style.attrs(switchStyles.thumb, props.styles?.thumb);

    return (
      <label
        {...rootStyleAttrs}
        {...passThroughProps(props, { events: false })}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
      >
        <span {...trackStyleAttrs} {...bindingProps(props, ['data-state'])} data-state={attrs['data-state']}>
          <input
            {...inputStyleAttrs}
            {...passThroughProps(props, { island: false })}
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
          <span
            {...thumbStyleAttrs}
            {...bindingProps(props, ['data-state'])}
            aria-hidden="true"
            data-state={attrs['data-state']}
          />
        </span>
        {props.children}
      </label>
    );
  },
});
