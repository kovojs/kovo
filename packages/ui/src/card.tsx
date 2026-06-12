/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { cn, type ClassValue } from '@jiso/headless-ui';

export interface CardProps {
  children?: string;
  class?: ClassValue;
}

export const cardClassNames =
  'rounded-lg border border-neutral-200 bg-white p-4 text-neutral-950 shadow-sm';
export const cardClasses = [cardClassNames] as const;

export const Card = component('card', {
  render(props: CardProps) {
    return <section class={cn(cardClassNames, props.class)}>{props.children}</section>;
  },
});
