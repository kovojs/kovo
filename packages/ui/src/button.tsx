/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
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
      borderRadius: uiTheme.radius.md,
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
    destructive: {
      backgroundColor: uiTheme.color.danger.border,
      borderColor: uiTheme.color.danger.border,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: uiTheme.color.foregroundInverse,
      ':focus-visible': {
        outlineColor: uiTheme.color.danger.border,
      },
      ':hover': {
        backgroundColor: uiTheme.color.danger.background,
        borderColor: uiTheme.color.danger.background,
        color: uiTheme.color.danger.foreground,
      },
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: uiTheme.color.foreground,
      ':focus-visible': {
        outlineColor: uiTheme.color.borderStrong,
      },
      ':hover': {
        backgroundColor: uiTheme.color.backgroundSubtle,
      },
    },
    outline: {
      backgroundColor: 'transparent',
      borderColor: uiTheme.color.border,
      color: uiTheme.color.foreground,
      ':focus-visible': {
        outlineColor: uiTheme.color.borderStrong,
      },
      ':hover': {
        backgroundColor: uiTheme.color.backgroundSubtle,
      },
    },
    primary: {
      backgroundColor: uiTheme.color.accent,
      borderColor: uiTheme.color.accentBorder,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: uiTheme.color.accentForeground,
      ':focus-visible': {
        outlineColor: uiTheme.color.accentBorder,
      },
      ':hover': {
        backgroundColor: uiTheme.color.accentHover,
      },
    },
    secondary: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      color: uiTheme.color.foreground,
      ':focus-visible': {
        outlineColor: uiTheme.color.borderStrong,
      },
      ':hover': {
        backgroundColor: uiTheme.color.backgroundRaised,
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
  style.attrs(variants.destructive).class ?? '',
  style.attrs(variants.outline).class ?? '',
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
        {...passThroughProps(props)}
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
