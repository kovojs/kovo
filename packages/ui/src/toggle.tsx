/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { toggleRootAttributes } from '@kovojs/headless-ui/toggle';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Supported toggle variant values.
 *
 * @example
 * import type { ToggleVariant } from "@kovojs/ui/toggle";
 * const value: ToggleVariant = 'outline';
 */
export type ToggleVariant = 'outline' | 'subtle';

/**
 * Props for the toggle component.
 *
 * @example
 * import type { ToggleProps } from "@kovojs/ui/toggle";
 * const props: ToggleProps = { children: 'Content' };
 */
export interface ToggleProps {
  children?: string;
  disabled?: boolean;
  pressed?: boolean;
  style?: style.StyleInput;
  variant?: ToggleVariant;
}

const base = style.create({
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
      backgroundColor: uiTheme.color.accent,
      color: uiTheme.color.accentForeground,
    },
  },
});

const variants = style.create({
  outline: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
  },
  subtle: {
    backgroundColor: uiTheme.color.backgroundSubtle,
    borderColor: 'transparent',
    color: uiTheme.color.foreground,
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
  },
});

/**
 * Style definitions used by the toggle components.
 *
 * @example
 * import { toggleStyles } from "@kovojs/ui/toggle";
 * const styles = toggleStyles;
 */
export const toggleStyles = {
  base,
  variants,
} as const;

/**
 * Renders the styled toggle primitive.
 *
 * @example
 * import { Toggle } from "@kovojs/ui/toggle";
 * const component = Toggle;
 */
export const Toggle = component({
  render(props: ToggleProps) {
    const attrs = toggleRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      pressed: props.pressed ?? false,
    });
    const styleAttrs = style.attrs(base.root, variants[props.variant ?? 'outline'], props.style);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
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
