/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { cn, defineVariants, toggleRootAttributes, type ClassValue } from '@kovojs/headless-ui';

export type ToggleVariant = 'outline' | 'subtle';

export interface ToggleProps {
  children?: string;
  class?: ClassValue;
  disabled?: boolean;
  pressed?: boolean;
  variant?: ToggleVariant;
}

export const toggleClassNames = defineVariants({
  base: 'inline-flex h-9 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=pressed]:bg-neutral-950 data-[state=pressed]:text-white',
  variants: {
    variant: {
      outline:
        'border-neutral-300 bg-white text-neutral-950 shadow-sm hover:bg-neutral-50 focus-visible:outline-neutral-400',
      subtle:
        'border-transparent bg-neutral-100 text-neutral-950 hover:bg-neutral-200 focus-visible:outline-neutral-400',
    },
  },
  defaultVariants: {
    variant: 'outline',
  },
});

export const toggleClasses = toggleClassNames.classes;

export const Toggle = component('toggle', {
  render(props: ToggleProps) {
    const attrs = toggleRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      pressed: props.pressed ?? false,
    });

    return (
      <button
        aria-pressed={attrs['aria-pressed']}
        class={cn(toggleClassNames({ variant: props.variant }), props.class)}
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
