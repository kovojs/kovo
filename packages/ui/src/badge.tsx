/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'destructive' | 'outline';

export interface BadgeProps {
  children?: string;
  style?: style.StyleInput;
  variant?: BadgeVariant;
}

const base = style.create({
  root: {
    // Filled variants are borderless; only the outline variant draws a border.
    alignItems: 'center',
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 0,
    display: 'inline-flex',
    fontSize: 12,
    fontWeight: 600,
    paddingBlock: 2,
    paddingInline: 8,
  },
});

const variants = style.create({
  destructive: {
    backgroundColor: uiTheme.color.danger.background,
    borderColor: uiTheme.color.danger.border,
    color: uiTheme.color.danger.foreground,
  },
  neutral: {
    backgroundColor: uiTheme.color.backgroundSubtle,
    borderColor: uiTheme.color.border,
    color: uiTheme.color.foreground,
  },
  outline: {
    backgroundColor: 'transparent',
    borderColor: uiTheme.color.border,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
  },
  success: {
    backgroundColor: uiTheme.color.success.background,
    borderColor: uiTheme.color.success.border,
    color: uiTheme.color.success.foreground,
  },
  warning: {
    backgroundColor: uiTheme.color.warning.background,
    borderColor: uiTheme.color.warning.border,
    color: uiTheme.color.warning.foreground,
  },
});

export const badgeStyles = {
  base,
  variants,
} as const;

export const Badge = component({
  render(props: BadgeProps) {
    const attrs = style.attrs(base.root, variants[props.variant ?? 'neutral'], props.style);

    return <span {...attrs}>{props.children}</span>;
  },
});
