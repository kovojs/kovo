/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  children?: string;
  disabled?: boolean;
  form?: string;
  name?: string;
  size?: ButtonSize;
  style?: style.StyleInput;
  type?: 'button' | 'submit' | 'reset';
  value?: string;
  variant?: ButtonVariant;
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
      justifyContent: 'center',
      transitionProperty: 'background-color, border-color, color, box-shadow',
      ':focus-visible': {
        outlineStyle: 'solid',
        outlineWidth: 2,
        outlineOffset: 2,
      },
      ':disabled': {
        opacity: 0.5,
        pointerEvents: 'none',
      },
    },
  },
  { namespace: 'button', source: 'button.tsx' },
);

const sizes = style.create(
  {
    sm: {
      columnGap: 6,
      height: 32,
      paddingInline: 10,
    },
    md: {
      columnGap: 8,
      height: 36,
      paddingInline: 12,
    },
  },
  { namespace: 'buttonSize', source: 'button.tsx' },
);

const variants = style.create(
  {
    ghost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: '#0a0a0a',
      ':focus-visible': {
        outlineColor: '#a3a3a3',
      },
      ':hover': {
        backgroundColor: '#f5f5f5',
      },
    },
    primary: {
      backgroundColor: '#0a0a0a',
      borderColor: '#0a0a0a',
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: '#ffffff',
      ':focus-visible': {
        outlineColor: '#0a0a0a',
      },
      ':hover': {
        backgroundColor: '#262626',
      },
    },
    secondary: {
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
  },
  { namespace: 'buttonVariant', source: 'button.tsx' },
);

export const buttonStyles = {
  base,
  sizes,
  variants,
} as const;

export const buttonClasses = [
  style.attrs(base.root, sizes.md, variants.primary).class ?? '',
  style.attrs(sizes.sm).class ?? '',
  style.attrs(variants.secondary).class ?? '',
  style.attrs(variants.ghost).class ?? '',
] as const;

export const Button = component({
  render(props: ButtonProps) {
    const attrs = style.attrs(
      base.root,
      sizes[props.size ?? 'md'],
      variants[props.variant ?? 'primary'],
      props.style,
    );

    return (
      <button
        {...attrs}
        disabled={props.disabled}
        form={props.form}
        name={props.name}
        type={props.type ?? 'button'}
        value={props.value}
      >
        {props.children}
      </button>
    );
  },
});
