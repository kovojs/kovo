/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerAttributes,
  defineVariants,
  type ClassValue,
} from '@kovojs/headless-ui';

export interface CollapsibleStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface CollapsibleProps extends CollapsibleStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface CollapsibleTriggerProps extends CollapsibleStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
}

export interface CollapsibleContentProps extends CollapsibleStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
}

export const collapsibleClassNames = defineVariants({
  base: 'rounded-md border border-neutral-200 bg-white text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const collapsibleTriggerClassNames = defineVariants({
  base: 'cursor-pointer px-3 py-2 font-medium text-neutral-950 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:bg-neutral-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  variants: {},
});

export const collapsibleContentClassNames = defineVariants({
  base: 'px-3 pb-3 text-sm text-neutral-700 data-[state=closed]:hidden',
  variants: {},
});

export const collapsibleClasses = collapsibleClassNames.classes;
export const collapsibleTriggerClasses = collapsibleTriggerClassNames.classes;
export const collapsibleContentClasses = collapsibleContentClassNames.classes;

function collapsibleState(props: CollapsibleStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Collapsible = component('collapsible', {
  render(props: CollapsibleProps) {
    const attrs = collapsibleRootAttributes(collapsibleState(props));

    return (
      <details
        class={cn(collapsibleClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
        open={attrs.open}
      >
        {props.children}
      </details>
    );
  },
});

export const CollapsibleTrigger = component('collapsible-trigger', {
  render(props: CollapsibleTriggerProps) {
    const attrs = collapsibleTriggerAttributes({
      ...collapsibleState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <summary
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        class={cn(collapsibleTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </summary>
    );
  },
});

export const CollapsibleContent = component('collapsible-content', {
  render(props: CollapsibleContentProps) {
    const attrs = collapsibleContentAttributes({
      ...collapsibleState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <div
        class={cn(collapsibleContentClassNames(), props.class)}
        data-state={attrs['data-state']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});
