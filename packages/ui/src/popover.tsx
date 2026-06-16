/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  defineVariants,
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
  type ClassValue,
} from '@kovojs/headless-ui';

export interface PopoverStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface PopoverProps extends PopoverStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface PopoverTriggerProps extends PopoverStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
}

export interface PopoverContentProps extends PopoverStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
}

export const popoverClassNames = defineVariants({
  base: 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const popoverTriggerClassNames = defineVariants({
  base: 'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-100',
  variants: {},
});

export const popoverContentClassNames = defineVariants({
  base: 'mt-2 w-64 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 shadow-md data-[state=closed]:hidden',
  variants: {},
});

export const popoverClasses = popoverClassNames.classes;
export const popoverTriggerClasses = popoverTriggerClassNames.classes;
export const popoverContentClasses = popoverContentClassNames.classes;

function popoverState(props: PopoverStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Popover = component('popover', {
  render(props: PopoverProps) {
    const attrs = popoverRootAttributes(popoverState(props));

    return (
      <div
        class={cn(popoverClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const PopoverTrigger = component('popover-trigger', {
  render(props: PopoverTriggerProps) {
    const attrs = popoverTriggerAttributes({
      ...popoverState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        class={cn(popoverTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={props.id}
        popovertarget={attrs.popovertarget}
        popovertargetaction={attrs.popovertargetaction}
        type={attrs.type}
      >
        {props.children}
      </button>
    );
  },
});

export const PopoverContent = component('popover-content', {
  render(props: PopoverContentProps) {
    const attrs = popoverContentAttributes({
      ...popoverState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <div
        class={cn(popoverContentClassNames(), props.class)}
        data-state={attrs['data-state']}
        id={attrs.id}
        popover={attrs.popover}
      >
        {props.children}
      </div>
    );
  },
});
