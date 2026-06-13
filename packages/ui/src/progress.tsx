/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { cn, defineVariants, progressRootAttributes, type ClassValue } from '@jiso/headless-ui';

export interface ProgressProps {
  children?: string;
  class?: ClassValue;
  max?: number;
  value?: number | null;
  valueText?: string;
}

export const progressClassNames = defineVariants({
  base: 'h-2 w-full overflow-hidden rounded-full bg-neutral-200 accent-neutral-950 data-[state=complete]:accent-emerald-600 data-[state=indeterminate]:animate-pulse',
  variants: {},
});

export const progressClasses = progressClassNames.classes;

export const Progress = component('progress', {
  render(props: ProgressProps) {
    const attrs = progressRootAttributes({
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.valueText === undefined ? {} : { valueText: props.valueText }),
    });

    return (
      <progress
        aria-valuetext={attrs['aria-valuetext']}
        class={cn(progressClassNames(), props.class)}
        data-max={attrs['data-max']}
        data-state={attrs['data-state']}
        data-value={attrs['data-value']}
        max={attrs.max}
        value={attrs.value}
      >
        {props.children}
      </progress>
    );
  },
});
