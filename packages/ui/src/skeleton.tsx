/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { cn, type ClassValue } from '@kovojs/headless-ui';

export interface SkeletonProps {
  class?: ClassValue;
}

export const skeletonClassNames = 'animate-pulse rounded-md bg-neutral-200';
export const skeletonClasses = [skeletonClassNames] as const;

export const Skeleton = component({
  render(props: SkeletonProps) {
    return <div aria-hidden="true" class={cn(skeletonClassNames, props.class)} />;
  },
});
