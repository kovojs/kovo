/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { cn, defineVariants, type ClassValue } from '@jiso/headless-ui';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  children?: string;
  class?: ClassValue;
  disabled?: boolean;
  form?: string;
  name?: string;
  size?: ButtonSize;
  type?: 'button' | 'submit' | 'reset';
  value?: string;
  variant?: ButtonVariant;
}

export const buttonClassNames = defineVariants({
  base: 'inline-flex items-center justify-center rounded-md border text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
  variants: {
    size: {
      sm: 'h-8 gap-1.5 px-2.5',
      md: 'h-9 gap-2 px-3',
    },
    variant: {
      ghost:
        'border-transparent bg-transparent text-neutral-950 hover:bg-neutral-100 focus-visible:outline-neutral-400',
      primary:
        'border-neutral-950 bg-neutral-950 text-white shadow-sm hover:bg-neutral-800 focus-visible:outline-neutral-950',
      secondary:
        'border-neutral-300 bg-white text-neutral-950 shadow-sm hover:bg-neutral-50 focus-visible:outline-neutral-400',
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'primary',
  },
});

export const buttonClasses = buttonClassNames.classes;

export const Button = component('button', {
  render(props: ButtonProps) {
    return (
      <button
        class={cn(buttonClassNames({ size: props.size, variant: props.variant }), props.class)}
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
