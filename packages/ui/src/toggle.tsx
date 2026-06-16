/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { toggleRootAttributes } from '@kovojs/headless-ui';
import * as style from '@kovojs/style';

export type ToggleVariant = 'outline' | 'subtle';

export interface ToggleProps {
  children?: string;
  disabled?: boolean;
  pressed?: boolean;
  style?: style.StyleInput;
  variant?: ToggleVariant;
}

const base = style.create(
  {
    root: {
      alignItems: 'center',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'inline-flex',
      fontSize: 14,
      fontWeight: 500,
      height: 36,
      justifyContent: 'center',
      paddingInline: 12,
      transitionProperty: 'background-color, border-color, color',
      ':disabled': {
        opacity: 0.5,
        pointerEvents: 'none',
      },
      ':focus-visible': {
        outlineOffset: 2,
        outlineStyle: 'solid',
        outlineWidth: 2,
      },
      '[data-state=pressed]': {
        backgroundColor: '#0a0a0a',
        color: '#ffffff',
      },
    },
  },
  { namespace: 'toggle', source: 'toggle.tsx' },
);

const variants = style.create(
  {
    outline: {
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d4',
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: '#0a0a0a',
      ':focus-visible': {
        outlineColor: '#a3a3a3',
      },
      ':hover': {
        backgroundColor: '#fafafa',
      },
    },
    subtle: {
      backgroundColor: '#f5f5f5',
      borderColor: 'transparent',
      color: '#0a0a0a',
      ':focus-visible': {
        outlineColor: '#a3a3a3',
      },
      ':hover': {
        backgroundColor: '#e5e5e5',
      },
    },
  },
  { namespace: 'toggleVariant', source: 'toggle.tsx' },
);

export const toggleStyles = {
  base,
  variants,
} as const;

export const toggleClasses = [
  style.attrs(base.root, variants.outline).class ?? '',
  style.attrs(variants.subtle).class ?? '',
] as const;

export const Toggle = component({
  render(props: ToggleProps) {
    const attrs = toggleRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      pressed: props.pressed ?? false,
    });
    const styleAttrs = style.attrs(
      base.root,
      variants[props.variant ?? 'outline'],
      props.style,
    );

    return (
      <button
        {...styleAttrs}
        aria-pressed={attrs['aria-pressed']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        type={attrs.type}
      >
        {props.children}
      </button>
    );
  },
});
