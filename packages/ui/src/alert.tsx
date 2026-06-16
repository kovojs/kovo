/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { cn, defineVariants, type ClassValue } from '@kovojs/headless-ui';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  children?: string;
  class?: ClassValue;
  role?: 'alert' | 'status';
  title?: string;
  variant?: AlertVariant;
}

export const alertClassNames = defineVariants({
  base: 'grid gap-1 rounded-lg border p-4 text-sm',
  variants: {
    variant: {
      danger: 'border-red-200 bg-red-50 text-red-950',
      info: 'border-sky-200 bg-sky-50 text-sky-950',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
      warning: 'border-amber-200 bg-amber-50 text-amber-950',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

export const alertClasses = alertClassNames.classes;

export const Alert = component({
  render(props: AlertProps) {
    return (
      <div
        class={cn(alertClassNames({ variant: props.variant }), props.class)}
        role={props.role ?? 'status'}
      >
        {props.title === undefined ? '' : <strong class="font-medium">{props.title}</strong>}
        <div>{props.children}</div>
      </div>
    );
  },
});
