/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  toastActionAttributes,
  toastCloseAttributes,
  toastDescriptionAttributes,
  toastRootAttributes,
  toastTitleAttributes,
  toastViewportAttributes,
  type ClassValue,
  type ToastPlacement,
  type ToastPoliteness,
  type ToastVariant,
} from '@jiso/headless-ui';

export interface ToastViewportProps {
  children?: string;
  class?: ClassValue;
  disabled?: boolean;
  id?: string;
  label?: string;
  placement?: ToastPlacement;
}

export interface ToastProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  disabled?: boolean;
  id: string;
  open?: boolean;
  politeness?: ToastPoliteness;
  titleId?: string;
  variant?: ToastVariant;
}

export interface ToastPartProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface ToastActionProps {
  actionValue?: string;
  children?: string;
  class?: ClassValue;
  disabled?: boolean;
  dismissOnAction?: boolean;
  id: string;
  open?: boolean;
}

export type ToastCloseProps = ToastActionProps;

export const toastViewportClassNames = defineVariants({
  base: 'fixed z-50 grid w-full max-w-sm gap-2 p-4 outline-none data-[placement=top-start]:left-0 data-[placement=top-start]:top-0 data-[placement=top-end]:right-0 data-[placement=top-end]:top-0 data-[placement=bottom-start]:bottom-0 data-[placement=bottom-start]:left-0 data-[placement=bottom-end]:bottom-0 data-[placement=bottom-end]:right-0 data-[placement=top-center]:left-1/2 data-[placement=top-center]:top-0 data-[placement=bottom-center]:bottom-0 data-[placement=bottom-center]:left-1/2 data-[disabled]:opacity-50',
  variants: {},
});

export const toastClassNames = defineVariants({
  base: 'grid gap-2 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-950 shadow-lg data-[state=closed]:hidden data-[variant=success]:border-emerald-200 data-[variant=success]:bg-emerald-50 data-[variant=warning]:border-amber-200 data-[variant=warning]:bg-amber-50 data-[variant=error]:border-red-200 data-[variant=error]:bg-red-50 data-[variant=info]:border-sky-200 data-[variant=info]:bg-sky-50 data-[disabled]:opacity-50',
  variants: {},
});

export const toastTitleClassNames = defineVariants({
  base: 'font-medium text-neutral-950',
  variants: {},
});

export const toastDescriptionClassNames = defineVariants({
  base: 'text-neutral-700',
  variants: {},
});

export const toastActionClassNames = defineVariants({
  base: 'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50',
  variants: {},
});

export const toastCloseClassNames = defineVariants({
  base: 'inline-flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50',
  variants: {},
});

export const toastViewportClasses = toastViewportClassNames.classes;
export const toastClasses = toastClassNames.classes;
export const toastTitleClasses = toastTitleClassNames.classes;
export const toastDescriptionClasses = toastDescriptionClassNames.classes;
export const toastActionClasses = toastActionClassNames.classes;
export const toastCloseClasses = toastCloseClassNames.classes;

export const ToastViewport = component('toast-viewport', {
  render(props: ToastViewportProps) {
    const attrs = toastViewportAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.placement === undefined ? {} : { placement: props.placement }),
    });

    return (
      <div
        aria-label={attrs['aria-label']}
        class={cn(toastViewportClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-placement={attrs['data-placement']}
        id={attrs.id}
        role={attrs.role}
        tabIndex={attrs.tabIndex}
      >
        {props.children}
      </div>
    );
  },
});

export const Toast = component('toast', {
  render(props: ToastProps) {
    const attrs = toastRootAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      id: props.id,
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.politeness === undefined ? {} : { politeness: props.politeness }),
      ...(props.titleId === undefined ? {} : { titleId: props.titleId }),
      ...(props.variant === undefined ? {} : { variant: props.variant }),
    });

    return (
      <div
        aria-atomic={attrs['aria-atomic']}
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-live={attrs['aria-live']}
        class={cn(toastClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        data-variant={attrs['data-variant']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </div>
    );
  },
});

export const ToastTitle = component('toast-title', {
  render(props: ToastPartProps) {
    const attrs = toastTitleAttributes(props.id === undefined ? {} : { id: props.id });

    return (
      <div
        class={cn(toastTitleClassNames(), props.class)}
        data-part={attrs['data-part']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const ToastDescription = component('toast-description', {
  render(props: ToastPartProps) {
    const attrs = toastDescriptionAttributes(props.id === undefined ? {} : { id: props.id });

    return (
      <div
        class={cn(toastDescriptionClassNames(), props.class)}
        data-part={attrs['data-part']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const ToastAction = component('toast-action', {
  render(props: ToastActionProps) {
    const attrs = toastActionAttributes({
      ...(props.actionValue === undefined ? {} : { actionValue: props.actionValue }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.dismissOnAction === undefined ? {} : { dismissOnAction: props.dismissOnAction }),
      id: props.id,
      ...(props.open === undefined ? {} : { open: props.open }),
    });

    return (
      <button
        class={cn(toastActionClassNames(), props.class)}
        data-action={attrs['data-action']}
        data-dismiss-on-action={attrs['data-dismiss-on-action']}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        data-variant={attrs['data-variant']}
        disabled={attrs.disabled}
        type={attrs.type}
        value={attrs.value}
      >
        {props.children}
      </button>
    );
  },
});

export const ToastClose = component('toast-close', {
  render(props: ToastCloseProps) {
    const attrs = toastCloseAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      id: props.id,
      ...(props.open === undefined ? {} : { open: props.open }),
    });

    return (
      <button
        class={cn(toastCloseClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-dismiss={attrs['data-dismiss']}
        data-state={attrs['data-state']}
        data-variant={attrs['data-variant']}
        disabled={attrs.disabled}
        type={attrs.type}
      >
        {props.children ?? 'Close'}
      </button>
    );
  },
});
