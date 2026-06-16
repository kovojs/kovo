/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  hoverCardContentAttributes,
  hoverCardRootAttributes,
  hoverCardTriggerAttributes,
  safeUrl,
  type ClassValue,
} from '@jiso/headless-ui';

export interface HoverCardStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface HoverCardProps extends HoverCardStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface HoverCardTriggerProps extends HoverCardStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  href?: string;
  id?: string;
}

export interface HoverCardContentProps extends HoverCardStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
}

export const hoverCardClassNames = defineVariants({
  base: 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const hoverCardTriggerClassNames = defineVariants({
  base: 'inline-flex items-center rounded-md text-sm font-medium text-neutral-950 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:underline',
  variants: {},
});

export const hoverCardContentClassNames = defineVariants({
  base: 'mt-2 w-72 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-md data-[state=closed]:hidden',
  variants: {},
});

export const hoverCardClasses = hoverCardClassNames.classes;
export const hoverCardTriggerClasses = hoverCardTriggerClassNames.classes;
export const hoverCardContentClasses = hoverCardContentClassNames.classes;

function hoverCardState(props: HoverCardStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const HoverCard = component('hover-card', {
  render(props: HoverCardProps) {
    const attrs = hoverCardRootAttributes(hoverCardState(props));

    return (
      <div
        class={cn(hoverCardClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const HoverCardTrigger = component('hover-card-trigger', {
  render(props: HoverCardTriggerProps) {
    const attrs = hoverCardTriggerAttributes({
      ...hoverCardState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <a
        aria-controls={attrs['aria-controls']}
        aria-disabled={props.disabled === true ? 'true' : undefined}
        aria-expanded={attrs['aria-expanded']}
        class={cn(hoverCardTriggerClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        // SECURITY_FINDINGS.md H3: sanitize the caller href so a dangerous
        // scheme is neutralized to the '#' fallback. Existing semantics kept:
        // omit href when disabled, default to '#' when no href is supplied.
        href={props.disabled === true ? undefined : safeUrl(props.href)}
        id={props.id}
        jiso-hover-card={attrs['jiso-hover-card']}
      >
        {props.children}
      </a>
    );
  },
});

export const HoverCardContent = component('hover-card-content', {
  render(props: HoverCardContentProps) {
    const attrs = hoverCardContentAttributes({
      ...hoverCardState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <div
        class={cn(hoverCardContentClassNames(), props.class)}
        data-state={attrs['data-state']}
        hidden={attrs.hidden}
        id={attrs.id}
        popover={attrs.popover}
      >
        {props.children}
      </div>
    );
  },
});
