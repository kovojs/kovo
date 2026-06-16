/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  alertDialogActionAttributes,
  alertDialogCancelAttributes,
  alertDialogContentAttributes,
  alertDialogRootAttributes,
  alertDialogTriggerAttributes,
  cn,
  defineVariants,
  type AlertDialogActionIntent,
  type ClassValue,
} from '@kovojs/headless-ui';

export interface AlertDialogStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface AlertDialogProps extends AlertDialogStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface AlertDialogTriggerProps extends AlertDialogStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
}

export interface AlertDialogContentProps extends AlertDialogStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  descriptionId?: string;
  titleId?: string;
}

export interface AlertDialogCancelProps extends AlertDialogStateProps {
  autoFocus?: boolean;
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
}

export interface AlertDialogActionProps extends AlertDialogStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
  intent?: AlertDialogActionIntent;
}

export const alertDialogClassNames = defineVariants({
  base: 'contents text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const alertDialogTriggerClassNames = defineVariants({
  base: 'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50',
  variants: {},
});

export const alertDialogContentClassNames = defineVariants({
  base: 'm-auto max-w-md rounded-lg border border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl backdrop:bg-black/40 data-[state=closed]:hidden',
  variants: {},
});

export const alertDialogCancelClassNames = defineVariants({
  base: 'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50',
  variants: {},
});

export const alertDialogActionClassNames = defineVariants({
  base: 'inline-flex h-8 items-center justify-center rounded-md border border-transparent bg-neutral-950 px-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[intent=destructive]:bg-red-600 data-[intent=destructive]:hover:bg-red-700',
  variants: {},
});

export const alertDialogClasses = alertDialogClassNames.classes;
export const alertDialogTriggerClasses = alertDialogTriggerClassNames.classes;
export const alertDialogContentClasses = alertDialogContentClassNames.classes;
export const alertDialogCancelClasses = alertDialogCancelClassNames.classes;
export const alertDialogActionClasses = alertDialogActionClassNames.classes;

function alertDialogState(props: AlertDialogStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const AlertDialog = component({
  render(props: AlertDialogProps) {
    const attrs = alertDialogRootAttributes(alertDialogState(props));

    return (
      <div
        class={cn(alertDialogClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const AlertDialogTrigger = component({
  render(props: AlertDialogTriggerProps) {
    const attrs = alertDialogTriggerAttributes({
      ...alertDialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        class={cn(alertDialogTriggerClassNames(), props.class)}
        command={attrs.command}
        commandfor={attrs.commandfor}
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

export const AlertDialogContent = component({
  render(props: AlertDialogContentProps) {
    const attrs = alertDialogContentAttributes({
      ...alertDialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.titleId === undefined ? {} : { titleId: props.titleId }),
    });

    return (
      <dialog
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-modal={attrs['aria-modal']}
        class={cn(alertDialogContentClassNames(), props.class)}
        data-state={attrs['data-state']}
        id={attrs.id}
        open={attrs.open}
        role={attrs.role}
      >
        {props.children}
      </dialog>
    );
  },
});

export const AlertDialogCancel = component({
  render(props: AlertDialogCancelProps) {
    const attrs = alertDialogCancelAttributes({
      ...alertDialogState(props),
      ...(props.autoFocus === undefined ? {} : { autoFocus: props.autoFocus }),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <button
        autofocus={attrs.autofocus}
        class={cn(alertDialogCancelClassNames(), props.class)}
        command={attrs.command}
        commandfor={attrs.commandfor}
        data-disabled={attrs['data-disabled']}
        data-intent={attrs['data-intent']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={props.id}
        type={attrs.type}
      >
        {props.children ?? 'Cancel'}
      </button>
    );
  },
});

export const AlertDialogAction = component({
  render(props: AlertDialogActionProps) {
    const attrs = alertDialogActionAttributes({
      ...alertDialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.intent === undefined ? {} : { intent: props.intent }),
    });

    return (
      <button
        class={cn(alertDialogActionClassNames(), props.class)}
        command={attrs.command}
        commandfor={attrs.commandfor}
        data-disabled={attrs['data-disabled']}
        data-intent={attrs['data-intent']}
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
