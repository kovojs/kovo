/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
  type ClassValue,
} from '@jiso/headless-ui';

export interface TooltipStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface TooltipProps extends TooltipStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface TooltipTriggerProps extends TooltipStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
}

export interface TooltipContentProps extends TooltipStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
}

export const tooltipClassNames = defineVariants({
  base: 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const tooltipTriggerClassNames = defineVariants({
  base: 'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:bg-neutral-100',
  variants: {},
});

export const tooltipContentClassNames = defineVariants({
  base: 'mt-2 w-max max-w-64 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs text-white shadow-md data-[state=closed]:hidden',
  variants: {},
});

export const tooltipClasses = tooltipClassNames.classes;
export const tooltipTriggerClasses = tooltipTriggerClassNames.classes;
export const tooltipContentClasses = tooltipContentClassNames.classes;

function tooltipState(props: TooltipStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Tooltip = component('tooltip', {
  render(props: TooltipProps) {
    const attrs = tooltipRootAttributes(tooltipState(props));

    return (
      <div
        class={cn(tooltipClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const TooltipTrigger = component('tooltip-trigger', {
  render(props: TooltipTriggerProps) {
    const attrs = tooltipTriggerAttributes({
      ...tooltipState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <button
        aria-describedby={attrs['aria-describedby']}
        class={cn(tooltipTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
        jiso-tooltip={attrs['jiso-tooltip']}
        type="button"
      >
        {props.children}
      </button>
    );
  },
});

export const TooltipContent = component('tooltip-content', {
  render(props: TooltipContentProps) {
    const attrs = tooltipContentAttributes({
      ...tooltipState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <div
        class={cn(tooltipContentClassNames(), props.class)}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        popover={attrs.popover}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});
