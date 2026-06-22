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

// "sonner"-like enter/exit motion keyed on [data-state] (open/closed): a subtle
// slide-in + fade. The `style.keyframes` name is resolved by the StyleX extractor,
// which emits the `@keyframes` block into the served CSS (SPEC.md §13.1). We never
// transition `display`; visibility is still toggled via the [data-state=closed]
// `display:none` rule on the root.
const toastEnter = style.keyframes(
  {
    '0%': { opacity: 0, transform: 'translateY(8px)' },
    '100%': { opacity: 1, transform: 'translateY(0)' },
  },
  { namespace: 'toastEnter', source: 'toast.tsx' },
);

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
    // "sonner"-like: every variant sits on the neutral surface; the variant
    // semantics read as a thin left-edge accent (see [data-variant=*] below)
    // instead of flooding the whole toast with a pastel hue. Keeps the Material
    // skin (per MEMORY ui-shadcn-parity-material-skin) but at a calmer intensity.
    backgroundColor: uiTheme.color.background,
    // Variant accent rides the left border; reset to neutral here so a left edge
    // without a [data-variant] doesn't show a stray colored stripe.
    borderColor: uiTheme.color.border,
    borderLeftColor: uiTheme.color.border,
    borderLeftWidth: 3,
    borderRadius: uiTheme.radius.lg,
    borderStyle: 'solid',
    borderWidth: 1,
    // Single soft drop shadow (was a heavier two-layer shadow).
    boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
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
    padding: 12,
    rowGap: 4,
    '[data-disabled]': {
      opacity: 0.5,
    },
    // Subtle enter motion on open; no `display` transition (visibility toggles via
    // the [data-state=closed] display:none below).
    '[data-state=open]': {
      animationDuration: '180ms',
      animationName: toastEnter,
      animationTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
    },
    '[data-state=closed]': {
      display: 'none',
    },
    // Variant semantics expressed as a left-edge accent only; background stays neutral.
    '[data-variant=error]': {
      borderLeftColor: uiTheme.color.danger.border,
    },
    '[data-variant=info]': {
      borderLeftColor: uiTheme.color.info.border,
    },
    '[data-variant=success]': {
      borderLeftColor: uiTheme.color.success.border,
    },
    '[data-variant=warning]': {
      borderLeftColor: uiTheme.color.warning.border,
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
