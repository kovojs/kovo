/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

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
      borderRadius: 6,
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
      backgroundColor: '#f5f5f5',
      borderColor: '#e5e5e5',
      color: '#171717',
    },
    success: {
      backgroundColor: '#ecfdf5',
      borderColor: '#a7f3d0',
      color: '#065f46',
    },
    warning: {
      backgroundColor: '#fffbeb',
      borderColor: '#fde68a',
      color: '#78350f',
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
