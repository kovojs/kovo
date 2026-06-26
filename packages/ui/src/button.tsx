/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Supported button variant values.
 *
 * @example
 * import type { ButtonVariant } from "@kovojs/ui/button";
 * const value: ButtonVariant = 'primary';
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'outline';
/**
 * Supported button size values.
 *
 * @example
 * import type { ButtonSize } from "@kovojs/ui/button";
 * const value: ButtonSize = 'md';
 */
export type ButtonSize = 'sm' | 'md';

/**
 * Props for the button component.
 *
 * @example
 * import type { ButtonProps } from "@kovojs/ui/button";
 * const props: ButtonProps = { children: 'Content' };
 */
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

const base = style.create({
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
});

const sizes = style.create({
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
});

const variants = style.create({
  destructive: {
    backgroundColor: uiTheme.color.danger.border,
    borderColor: uiTheme.color.danger.border,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foregroundInverse,
    ':focus-visible': {
      outlineColor: uiTheme.color.danger.border,
    },
    // Darken on hover (Material state layer) instead of swapping to the pale error container.
    ':hover': {
      filter: 'brightness(0.92)',
    },
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    color: uiTheme.color.foreground,
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
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
      outlineColor: uiTheme.color.accent,
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
    // Darken the teal on hover rather than lightening to the bright primary container.
    ':hover': {
      filter: 'brightness(0.92)',
    },
  },
  secondary: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
  },
});

/**
 * Style definitions used by the button components.
 *
 * @example
 * import { buttonStyles } from "@kovojs/ui/button";
 * const styles = buttonStyles;
 */
export const buttonStyles = {
  base,
  sizes,
  variants,
} as const;

/**
 * Renders the styled button primitive.
 *
 * @example
 * import { Button } from "@kovojs/ui/button";
 * const component = Button;
 */
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
