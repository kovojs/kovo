/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  defineVariants,
  disclosureContentAttributes,
  disclosureRootAttributes,
  disclosureTriggerAttributes,
  type ClassValue,
} from '@kovojs/headless-ui';

export interface DisclosureStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface DisclosureProps extends DisclosureStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface DisclosureTriggerProps extends DisclosureStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
}

export interface DisclosureContentProps extends DisclosureStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
}

export const disclosureClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const disclosureTriggerClassNames = defineVariants({
  base: 'inline-flex h-9 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-100',
  variants: {},
});

export const disclosureContentClassNames = defineVariants({
  base: 'rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 data-[state=closed]:hidden',
  variants: {},
});

export const disclosureClasses = disclosureClassNames.classes;
export const disclosureTriggerClasses = disclosureTriggerClassNames.classes;
export const disclosureContentClasses = disclosureContentClassNames.classes;

function disclosureState(props: DisclosureStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Disclosure = component('disclosure', {
  render(props: DisclosureProps) {
    const attrs = disclosureRootAttributes(disclosureState(props));

    return (
      <div
        class={cn(disclosureClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const DisclosureTrigger = component('disclosure-trigger', {
  render(props: DisclosureTriggerProps) {
    const attrs = disclosureTriggerAttributes({
      ...disclosureState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        class={cn(disclosureTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={props.id}
        type={attrs.type}
      >
        {props.children}
      </button>
    );
  },
});

export const DisclosureContent = component('disclosure-content', {
  render(props: DisclosureContentProps) {
    const attrs = disclosureContentAttributes({
      ...disclosureState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <div
        class={cn(disclosureContentClassNames(), props.class)}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});
