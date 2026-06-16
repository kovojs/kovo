/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { cn, type ClassValue } from '@kovojs/headless-ui';

export interface KbdProps {
  children?: string;
  class?: ClassValue;
}

export const kbdClassNames =
  'inline-flex h-5 min-w-5 items-center justify-center rounded border border-neutral-300 bg-neutral-50 px-1 font-mono text-[11px] font-medium leading-none text-neutral-700 shadow-sm';
export const kbdClasses = [kbdClassNames] as const;

export const Kbd = component('kbd', {
  render(props: KbdProps) {
    return <kbd class={cn(kbdClassNames, props.class)}>{props.children}</kbd>;
  },
});
