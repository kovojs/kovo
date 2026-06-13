/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  accordionContentAttributes,
  accordionHeaderAttributes,
  accordionItemAttributes,
  accordionRootAttributes,
  accordionTriggerAttributes,
  cn,
  defineVariants,
  type AccordionType,
  type AccordionValue,
  type ClassValue,
  type CollectionOrientation,
} from '@jiso/headless-ui';

export interface AccordionStateProps {
  collapsible?: boolean;
  disabled?: boolean;
  orientation?: CollectionOrientation;
  type?: AccordionType;
  value?: AccordionValue;
}

export interface AccordionProps extends AccordionStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface AccordionItemProps extends AccordionStateProps {
  children?: string;
  class?: ClassValue;
  itemDisabled?: boolean;
  itemValue: string;
}

export interface AccordionHeaderProps extends AccordionItemProps {
  level?: number;
}

export interface AccordionTriggerProps extends AccordionItemProps {
  contentId?: string;
  triggerId?: string;
}

export interface AccordionContentProps extends AccordionItemProps {
  contentId?: string;
  triggerId?: string;
}

export const accordionClassNames = defineVariants({
  base: 'grid w-full gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const accordionItemClassNames = defineVariants({
  base: 'rounded-md border border-neutral-200 bg-white data-[disabled]:opacity-50',
  variants: {},
});

export const accordionHeaderClassNames = defineVariants({
  base: 'm-0 text-sm font-medium',
  variants: {},
});

export const accordionTriggerClassNames = defineVariants({
  base: 'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none data-[state=open]:bg-neutral-50 data-[disabled]:opacity-50',
  variants: {},
});

export const accordionContentClassNames = defineVariants({
  base: 'px-3 pb-3 pt-1 text-sm text-neutral-700 data-[state=closed]:hidden',
  variants: {},
});

export const accordionClasses = accordionClassNames.classes;
export const accordionItemClasses = accordionItemClassNames.classes;
export const accordionHeaderClasses = accordionHeaderClassNames.classes;
export const accordionTriggerClasses = accordionTriggerClassNames.classes;
export const accordionContentClasses = accordionContentClassNames.classes;

function accordionState(props: AccordionStateProps) {
  return {
    ...(props.collapsible === undefined ? {} : { collapsible: props.collapsible }),
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
    ...(props.type === undefined ? {} : { type: props.type }),
    ...(props.value === undefined ? {} : { value: props.value }),
  };
}

function accordionItemState(props: AccordionItemProps) {
  return {
    ...accordionState(props),
    ...(props.itemDisabled === undefined ? {} : { itemDisabled: props.itemDisabled }),
    itemValue: props.itemValue,
  };
}

export const Accordion = component('accordion', {
  render(props: AccordionProps) {
    const attrs = accordionRootAttributes(accordionState(props));

    return (
      <div
        class={cn(accordionClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-orientation={attrs['data-orientation']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const AccordionItem = component('accordion-item', {
  render(props: AccordionItemProps) {
    const attrs = accordionItemAttributes(accordionItemState(props));

    return (
      <div
        class={cn(accordionItemClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        open={attrs.open}
      >
        {props.children}
      </div>
    );
  },
});

export const AccordionHeader = component('accordion-header', {
  render(props: AccordionHeaderProps) {
    const attrs = accordionHeaderAttributes({
      ...accordionItemState(props),
      ...(props.level === undefined ? {} : { level: props.level }),
    });

    return (
      <h3
        aria-level={attrs['aria-level']}
        class={cn(accordionHeaderClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        role={attrs.role}
      >
        {props.children}
      </h3>
    );
  },
});

export const AccordionTrigger = component('accordion-trigger', {
  render(props: AccordionTriggerProps) {
    const attrs = accordionTriggerAttributes({
      ...accordionItemState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.triggerId === undefined ? {} : { triggerId: props.triggerId }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        class={cn(accordionTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={attrs.id}
        type={attrs.type}
      >
        {props.children}
      </button>
    );
  },
});

export const AccordionContent = component('accordion-content', {
  render(props: AccordionContentProps) {
    const attrs = accordionContentAttributes({
      ...accordionItemState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.triggerId === undefined ? {} : { triggerId: props.triggerId }),
    });

    return (
      <div
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(accordionContentClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});
