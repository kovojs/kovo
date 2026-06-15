/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
  type ClassValue,
} from '@jiso/headless-ui';

export interface DialogStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface DialogProps extends DialogStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface DialogTriggerProps extends DialogStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
}

export interface DialogContentProps extends DialogStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  descriptionId?: string;
  dismissible?: boolean;
  titleId?: string;
}

export interface DialogCloseProps extends DialogStateProps {
  children?: string;
  class?: ClassValue;
  contentId?: string;
  id?: string;
}

export const dialogClassNames = defineVariants({
  base: 'contents text-neutral-950 data-[disabled]:opacity-50',
  variants: {},
});

export const dialogTriggerClassNames = defineVariants({
  base: 'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50',
  variants: {},
});

export const dialogContentClassNames = defineVariants({
  base: 'm-auto max-w-lg rounded-lg border border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl backdrop:bg-black/30 data-[state=closed]:hidden',
  variants: {},
});

export const dialogCloseClassNames = defineVariants({
  base: 'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50',
  variants: {},
});

export const dialogClasses = dialogClassNames.classes;
export const dialogTriggerClasses = dialogTriggerClassNames.classes;
export const dialogContentClasses = dialogContentClassNames.classes;
export const dialogCloseClasses = dialogCloseClassNames.classes;

function dialogState(props: DialogStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

export const Dialog = component('dialog', {
  render(props: DialogProps) {
    const attrs = dialogRootAttributes(dialogState(props));

    return (
      <div
        class={cn(dialogClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

export const DialogTrigger = component('dialog-trigger', {
  render(props: DialogTriggerProps) {
    const attrs = dialogTriggerAttributes({
      ...dialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <button
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
        class={cn(dialogTriggerClassNames(), props.class)}
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

export const DialogContent = component('dialog-content', {
  render(props: DialogContentProps) {
    const attrs = dialogContentAttributes({
      ...dialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dismissible === undefined ? {} : { dismissible: props.dismissible }),
      ...(props.titleId === undefined ? {} : { titleId: props.titleId }),
    });

    return (
      <dialog
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        class={cn(dialogContentClassNames(), props.class)}
        closedby={attrs.closedby}
        data-state={attrs['data-state']}
        id={attrs.id}
        open={attrs.open}
      >
        {props.children}
      </dialog>
    );
  },
});

export const DialogClose = component('dialog-close', {
  render(props: DialogCloseProps) {
    const attrs = dialogCloseAttributes({
      ...dialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });

    return (
      <button
        class={cn(dialogCloseClassNames(), props.class)}
        command={attrs.command}
        commandfor={attrs.commandfor}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={props.id}
        type={attrs.type}
      >
        {props.children ?? 'Close'}
      </button>
    );
  },
});
