/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { cn, defineVariants, type ClassValue } from '@kovojs/headless-ui';

export type BadgeVariant = 'neutral' | 'success' | 'warning';

export interface BadgeProps {
  children?: string;
  class?: ClassValue;
  variant?: BadgeVariant;
}

export const badgeClassNames = defineVariants({
  base: 'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
  variants: {
    variant: {
      neutral: 'border-neutral-200 bg-neutral-100 text-neutral-900',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
    },
  },
  defaultVariants: {
    variant: 'neutral',
  },
});

export const badgeClasses = badgeClassNames.classes;

export const Badge = component('badge', {
  render(props: BadgeProps) {
    return (
      <span class={cn(badgeClassNames({ variant: props.variant }), props.class)}>
        {props.children}
      </span>
    );
  },
});
