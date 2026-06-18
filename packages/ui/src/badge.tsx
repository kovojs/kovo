/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

export type BadgeVariant = 'neutral' | 'success' | 'warning';

export interface BadgeProps {
  children?: string;
  style?: style.StyleInput;
  variant?: BadgeVariant;
}

const base = style.create(
  {
    root: {
      alignItems: 'center',
      borderRadius: uiTheme.radius.md,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'inline-flex',
      fontSize: 12,
      fontWeight: 500,
      paddingBlock: 2,
      paddingInline: 8,
    },
  },
  { namespace: 'badge', source: 'badge.tsx' },
);

const variants = style.create(
  {
    neutral: {
      backgroundColor: uiTheme.color.backgroundSubtle,
      borderColor: uiTheme.color.border,
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
  },
  { namespace: 'badgeVariant', source: 'badge.tsx' },
);

export const badgeStyles = {
  base,
  variants,
} as const;

export const badgeClasses = [
  style.attrs(base.root, variants.neutral).class ?? '',
  style.attrs(variants.success).class ?? '',
  style.attrs(variants.warning).class ?? '',
] as const;

export const Badge = component({
  render(props: BadgeProps) {
    const attrs = style.attrs(base.root, variants[props.variant ?? 'neutral'], props.style);

    return <span {...attrs}>{props.children}</span>;
  },
});
