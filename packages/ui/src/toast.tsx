/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  toastActionAttributes,
  toastCloseAttributes,
  toastDescriptionAttributes,
  toastRootAttributes,
  toastTitleAttributes,
  toastViewportAttributes,
  type ToastPlacement,
  type ToastPoliteness,
  type ToastVariant,
} from '@kovojs/headless-ui/toast';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface ToastStyleOverrides {
  action?: style.StyleInput;
  close?: style.StyleInput;
  description?: style.StyleInput;
  root?: style.StyleInput;
  title?: style.StyleInput;
  viewport?: style.StyleInput;
}

export interface ToastViewportProps {
  children?: string;
  disabled?: boolean;
  id?: string;
  label?: string;
  placement?: ToastPlacement;
  styles?: ToastStyleOverrides;
}

export interface ToastProps {
  children?: string;
  descriptionId?: string;
  disabled?: boolean;
  id: string;
  open?: boolean;
  politeness?: ToastPoliteness;
  styles?: ToastStyleOverrides;
  titleId?: string;
  variant?: ToastVariant;
}

export interface ToastPartProps {
  children?: string;
  id?: string;
  styles?: ToastStyleOverrides;
}

export interface ToastActionProps {
  actionValue?: string;
  children?: string;
  disabled?: boolean;
  dismissOnAction?: boolean;
  id: string;
  open?: boolean;
  styles?: ToastStyleOverrides;
  variant?: ToastVariant;
}

export type ToastCloseProps = ToastActionProps;

export const toastStyles = style.create({
  action: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.borderStrong,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    font: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    // better-components-ux: keep actions in the trailing grid column, hugging
    // their content (not stretched to a full-width bar). See toastStyles.root.
    gridColumnStart: 2,
    height: 32,
    justifyContent: 'center',
    justifySelf: 'end',
    paddingInline: 12,
    transitionProperty: 'background-color, color',
    whiteSpace: 'nowrap',
    width: 'auto',
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
    },
  },
  close: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: 'transparent',
    borderStyle: 'none',
    borderWidth: 0,
    borderRadius: uiTheme.radius.md,
    color: uiTheme.color.foregroundMuted,
    display: 'inline-flex',
    font: 'inherit',
    // better-components-ux: pin the close affordance to the trailing column at
    // the top of the toast, like shadcn's top-right dismiss. See toastStyles.root.
    gridColumnStart: 2,
    gridRowStart: 1,
    height: 32,
    justifyContent: 'center',
    justifySelf: 'end',
    transitionProperty: 'background-color, color',
    width: 32,
    ':disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
      color: uiTheme.color.foreground,
    },
  },
  description: {
    color: uiTheme.color.foregroundMuted,
    // Content lives in the leading column (see toastStyles.root).
    gridColumnStart: 1,
  },
  root: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    color: uiTheme.color.foreground,
    // better-components-ux: inline layout [content | actions/close] instead of a
    // single full-width column where every child became a stacked full-width bar.
    // Content (title/description) flows down the leading 1fr column; actions and
    // the close button sit in the trailing auto column on the right.
    columnGap: 12,
    display: 'grid',
    fontSize: 14,
    gridTemplateColumns: '1fr auto',
    alignItems: 'start',
    padding: 16,
    rowGap: 4,
    '[data-disabled]': {
      opacity: 0.5,
    },
    '[data-state=closed]': {
      display: 'none',
    },
    '[data-variant=error]': {
      backgroundColor: uiTheme.color.danger.background,
      borderColor: uiTheme.color.danger.border,
    },
    // better-components-ux: soften the info/success fills to a quieter component-
    // local tone. The full container hue reads as a loud bar; layering a faint
    // surface over the semantic background keeps the Material hue (per MEMORY
    // ui-shadcn-parity-material-skin) but at a calmer intensity. Only the border
    // keeps the saturated semantic color as the accent.
    '[data-variant=info]': {
      backgroundColor: uiTheme.color.info.background,
      backgroundImage: 'linear-gradient(0deg, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.55))',
      borderColor: uiTheme.color.info.border,
    },
    '[data-variant=success]': {
      backgroundColor: uiTheme.color.success.background,
      backgroundImage: 'linear-gradient(0deg, rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.55))',
      borderColor: uiTheme.color.success.border,
    },
    '[data-variant=warning]': {
      backgroundColor: uiTheme.color.warning.background,
      borderColor: uiTheme.color.warning.border,
    },
  },
  title: {
    color: uiTheme.color.foreground,
    fontWeight: 500,
    // Content lives in the leading column (see toastStyles.root).
    gridColumnStart: 1,
  },
  viewport: {
    display: 'grid',
    maxWidth: 384,
    outlineStyle: 'none',
    padding: 16,
    position: 'fixed',
    rowGap: 8,
    width: '100%',
    zIndex: 50,
    '[data-disabled]': {
      opacity: 0.5,
    },
    '[data-placement=bottom-center]': {
      bottom: 0,
      left: '50%',
      // better-components-ux: left:50% alone offsets the viewport's left edge to
      // center; translateX(-50%) re-centers the box itself.
      transform: 'translateX(-50%)',
    },
    '[data-placement=bottom-end]': {
      bottom: 0,
      right: 0,
    },
    '[data-placement=bottom-start]': {
      bottom: 0,
      left: 0,
    },
    '[data-placement=top-center]': {
      left: '50%',
      top: 0,
      // better-components-ux: re-center the box after the left:50% origin offset.
      transform: 'translateX(-50%)',
    },
    '[data-placement=top-end]': {
      right: 0,
      top: 0,
    },
    '[data-placement=top-start]': {
      left: 0,
      top: 0,
    },
  },
});

export const ToastViewport = component({
  render(props: ToastViewportProps) {
    const attrs = toastViewportAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.placement === undefined ? {} : { placement: props.placement }),
    });
    const styleAttrs = style.attrs(toastStyles.viewport, props.styles?.viewport);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props, { style: true })}
        aria-label={attrs['aria-label']}
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

export const Toast = component({
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
    const styleAttrs = style.attrs(toastStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-atomic={attrs['aria-atomic']}
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-live={attrs['aria-live']}
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

export const ToastTitle = component({
  render(props: ToastPartProps) {
    const attrs = toastTitleAttributes(props.id === undefined ? {} : { id: props.id });
    const styleAttrs = style.attrs(toastStyles.title, props.styles?.title);

    return (
      <div {...styleAttrs} data-part={attrs['data-part']} id={attrs.id}>
        {props.children}
      </div>
    );
  },
});

export const ToastDescription = component({
  render(props: ToastPartProps) {
    const attrs = toastDescriptionAttributes(props.id === undefined ? {} : { id: props.id });
    const styleAttrs = style.attrs(toastStyles.description, props.styles?.description);

    return (
      <div {...styleAttrs} data-part={attrs['data-part']} id={attrs.id}>
        {props.children}
      </div>
    );
  },
});

export const ToastAction = component({
  render(props: ToastActionProps) {
    const attrs = toastActionAttributes({
      ...(props.actionValue === undefined ? {} : { actionValue: props.actionValue }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.dismissOnAction === undefined ? {} : { dismissOnAction: props.dismissOnAction }),
      id: props.id,
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.variant === undefined ? {} : { variant: props.variant }),
    });
    const styleAttrs = style.attrs(toastStyles.action, props.styles?.action);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
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

export const ToastClose = component({
  render(props: ToastCloseProps) {
    const attrs = toastCloseAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      id: props.id,
      ...(props.open === undefined ? {} : { open: props.open }),
      ...(props.variant === undefined ? {} : { variant: props.variant }),
    });
    const styleAttrs = style.attrs(toastStyles.close, props.styles?.close);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
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
