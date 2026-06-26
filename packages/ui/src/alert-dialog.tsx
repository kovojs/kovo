/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  alertDialogActionAttributes,
  alertDialogCancelAttributes,
  alertDialogContentAttributes,
  alertDialogRootAttributes,
  alertDialogTriggerAttributes,
  type AlertDialogActionIntent,
} from '@kovojs/headless-ui/alert-dialog';
import { X } from '@kovojs/icons/x';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the alert dialog components.
 *
 * @example
 * import type { AlertDialogStyleOverrides } from "@kovojs/ui/alert-dialog";
 * const styles: AlertDialogStyleOverrides = {};
 */
export interface AlertDialogStyleOverrides {
  action?: style.StyleInput;
  cancel?: style.StyleInput;
  close?: style.StyleInput;
  content?: style.StyleInput;
  description?: style.StyleInput;
  footer?: style.StyleInput;
  header?: style.StyleInput;
  root?: style.StyleInput;
  title?: style.StyleInput;
  trigger?: style.StyleInput;
}

/**
 * Shared state props for the alert dialog component family.
 *
 * @example
 * import type { AlertDialogStateProps } from "@kovojs/ui/alert-dialog";
 * const state: AlertDialogStateProps = {};
 */
export interface AlertDialogStateProps {
  disabled?: boolean;
  open?: boolean;
}

/**
 * Props for the alert dialog component.
 *
 * @example
 * import type { AlertDialogProps } from "@kovojs/ui/alert-dialog";
 * const props: AlertDialogProps = { children: 'Content' };
 */
export interface AlertDialogProps extends AlertDialogStateProps {
  children?: string;
  id?: string;
  styles?: AlertDialogStyleOverrides;
}

/**
 * Props for the alert dialog trigger component.
 *
 * @example
 * import type { AlertDialogTriggerProps } from "@kovojs/ui/alert-dialog";
 * const props: AlertDialogTriggerProps = { children: 'Content' };
 */
export interface AlertDialogTriggerProps extends AlertDialogStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: AlertDialogStyleOverrides;
}

/**
 * Props for the alert dialog content component.
 *
 * @example
 * import type { AlertDialogContentProps } from "@kovojs/ui/alert-dialog";
 * const props: AlertDialogContentProps = { children: 'Content' };
 */
export interface AlertDialogContentProps extends AlertDialogStateProps {
  children?: string;
  contentId?: string;
  descriptionId?: string;
  styles?: AlertDialogStyleOverrides;
  titleId?: string;
}

/**
 * Props for the alert dialog cancel component.
 *
 * @example
 * import type { AlertDialogCancelProps } from "@kovojs/ui/alert-dialog";
 * const props: AlertDialogCancelProps = { children: 'Content' };
 */
export interface AlertDialogCancelProps extends AlertDialogStateProps {
  autoFocus?: boolean;
  children?: string;
  contentId?: string;
  id?: string;
  styles?: AlertDialogStyleOverrides;
}

/**
 * Props for the alert dialog action component.
 *
 * @example
 * import type { AlertDialogActionProps } from "@kovojs/ui/alert-dialog";
 * const props: AlertDialogActionProps = { children: 'Content' };
 */
export interface AlertDialogActionProps extends AlertDialogStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  intent?: AlertDialogActionIntent;
  styles?: AlertDialogStyleOverrides;
}

/**
 * Props for the alert dialog part component.
 *
 * @example
 * import type { AlertDialogPartProps } from "@kovojs/ui/alert-dialog";
 * const props: AlertDialogPartProps = { children: 'Content' };
 */
export interface AlertDialogPartProps {
  children?: string;
  id?: string;
  styles?: AlertDialogStyleOverrides;
}

/**
 * Style definitions used by the alert dialog components.
 *
 * @example
 * import { alertDialogStyles } from "@kovojs/ui/alert-dialog";
 * const styles = alertDialogStyles;
 */
export const alertDialogStyles = style.create({
  action: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.backgroundInverse,
    borderColor: 'transparent',
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foregroundInverse,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    height: 32,
    justifyContent: 'center',
    paddingInline: 10,
    transitionProperty: 'background-color',
    ':disabled': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    // Lighten the dark action surface on hover (Material state layer) rather than flipping to cyan.
    ':hover': {
      filter: 'brightness(1.2)',
    },
    '[data-intent=destructive]': {
      backgroundColor: uiTheme.color.danger.border,
      color: uiTheme.color.foregroundInverse,
    },
    '[data-intent=destructive]:hover': {
      filter: 'brightness(0.92)',
    },
  },
  cancel: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    height: 32,
    justifyContent: 'center',
    paddingInline: 10,
    transitionProperty: 'background-color',
    ':disabled': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
  },
  close: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: 'transparent',
    borderRadius: uiTheme.radius.md,
    borderStyle: 'none',
    borderWidth: 0,
    color: uiTheme.color.foregroundMuted,
    cursor: 'pointer',
    display: 'inline-flex',
    height: 28,
    justifyContent: 'center',
    lineHeight: 1,
    opacity: 0.7,
    padding: 0,
    position: 'absolute',
    right: 12,
    top: 12,
    transitionProperty: 'background-color, color, opacity',
    width: 28,
    ':disabled': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
      color: uiTheme.color.foreground,
      opacity: 1,
    },
  },
  content: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.lg,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    color: uiTheme.color.foreground,
    left: '50%',
    maxWidth: 448,
    opacity: 1,
    padding: 24,
    position: 'fixed',
    top: '50%',
    // Reset the UA dialog:modal centering (inset:0 + margin:auto). Without this the
    // author left/top:50% only override the inline/block-START insets; the UA
    // right/bottom:0 + margin:auto survive, over-constrain the box, and auto-center
    // it in the bottom-right quadrant (off-center on large viewports). With right/
    // bottom:auto + margin:0 the translate(-50%,-50%) centers it in the viewport.
    right: 'auto',
    bottom: 'auto',
    margin: 0,
    transform: 'translate(-50%, -50%) scale(1)',
    transitionBehavior: 'allow-discrete',
    transitionDuration: '160ms',
    transitionProperty: 'opacity, transform, display, overlay',
    width: 'calc(100% - 2rem)',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    '@starting-style': {
      opacity: 0,
      transform: 'translate(-50%, -50%) scale(0.96)',
    },
    '::backdrop': {
      backgroundColor: 'rgb(0 0 0 / 0.8)',
    },
  },
  description: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    margin: 0,
  },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  header: {
    display: 'grid',
    gap: 4,
    marginBottom: 16,
  },
  root: {
    color: uiTheme.color.foreground,
    display: 'contents',
    '[data-disabled]': {
      opacity: 0.5,
    },
  },
  title: {
    color: uiTheme.color.foreground,
    fontSize: 16,
    fontWeight: 600,
    margin: 0,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    display: 'inline-flex',
    fontSize: 14,
    fontWeight: 500,
    height: 36,
    justifyContent: 'center',
    paddingInline: 12,
    transitionProperty: 'background-color',
    ':disabled': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    ':focus-visible': {
      outlineColor: uiTheme.color.accent,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
  },
});

function alertDialogState(props: AlertDialogStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

/**
 * Renders the styled alert dialog primitive.
 *
 * @example
 * import { AlertDialog } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialog;
 */
export const AlertDialog = component({
  render(props: AlertDialogProps) {
    const attrs = alertDialogRootAttributes(alertDialogState(props));
    const styleAttrs = style.attrs(alertDialogStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        id={props.id}
      >
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled alert dialog trigger primitive.
 *
 * @example
 * import { AlertDialogTrigger } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialogTrigger;
 */
export const AlertDialogTrigger = component({
  render(props: AlertDialogTriggerProps) {
    const attrs = alertDialogTriggerAttributes({
      ...alertDialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(alertDialogStyles.trigger, props.styles?.trigger);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-controls={attrs['aria-controls']}
        aria-expanded={attrs['aria-expanded']}
        aria-haspopup={attrs['aria-haspopup']}
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

/**
 * Renders the styled alert dialog content primitive.
 *
 * @example
 * import { AlertDialogContent } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialogContent;
 */
export const AlertDialogContent = component({
  render(props: AlertDialogContentProps) {
    const attrs = alertDialogContentAttributes({
      ...alertDialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.titleId === undefined ? {} : { titleId: props.titleId }),
    });
    const styleAttrs = style.attrs(alertDialogStyles.content, props.styles?.content);
    // Top-right "X" affordance. It closes through the native invoker exactly like
    // AlertDialogCancel (command='request-close'/commandfor=contentId); reusing the
    // cancel attributes keeps that wiring in one place. An accessible name is
    // required (rules/accessibility-conformance.md). Backdrop light-dismiss is
    // enabled via `closedby="any"` on the dialog below — it fires a `cancel` event
    // the call site already syncs (same path as Escape); the explicit X / Cancel /
    // Action affordances remain the primary choices.
    const closeAttrs = alertDialogCancelAttributes({
      ...alertDialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const closeStyleAttrs = style.attrs(alertDialogStyles.close, props.styles?.close);

    return (
      <dialog
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-modal={attrs['aria-modal']}
        closedby="any"
        data-state={attrs['data-state']}
        id={attrs.id}
        open={attrs.open}
        role={attrs.role}
      >
        <button
          {...closeStyleAttrs}
          aria-label="Close"
          command={closeAttrs.command}
          commandfor={closeAttrs.commandfor}
          data-disabled={closeAttrs['data-disabled']}
          data-state={closeAttrs['data-state']}
          disabled={closeAttrs.disabled}
          type={closeAttrs.type}
        >
          <X aria-hidden="true" />
        </button>
        {props.children}
      </dialog>
    );
  },
});

/**
 * Renders the styled alert dialog cancel primitive.
 *
 * @example
 * import { AlertDialogCancel } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialogCancel;
 */
export const AlertDialogCancel = component({
  render(props: AlertDialogCancelProps) {
    const attrs = alertDialogCancelAttributes({
      ...alertDialogState(props),
      ...(props.autoFocus === undefined ? {} : { autoFocus: props.autoFocus }),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(alertDialogStyles.cancel, props.styles?.cancel);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        autofocus={attrs.autofocus}
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

/**
 * Renders the styled alert dialog action primitive.
 *
 * @example
 * import { AlertDialogAction } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialogAction;
 */
export const AlertDialogAction = component({
  render(props: AlertDialogActionProps) {
    const attrs = alertDialogActionAttributes({
      ...alertDialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.intent === undefined ? {} : { intent: props.intent }),
    });
    const styleAttrs = style.attrs(alertDialogStyles.action, props.styles?.action);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
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

/**
 * Renders the styled alert dialog header primitive.
 *
 * @example
 * import { AlertDialogHeader } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialogHeader;
 */
export const AlertDialogHeader = component({
  render(props: AlertDialogPartProps) {
    const styleAttrs = style.attrs(alertDialogStyles.header, props.styles?.header);
    return (
      <div {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled alert dialog title primitive.
 *
 * @example
 * import { AlertDialogTitle } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialogTitle;
 */
export const AlertDialogTitle = component({
  render(props: AlertDialogPartProps) {
    const styleAttrs = style.attrs(alertDialogStyles.title, props.styles?.title);
    return (
      <h2 {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </h2>
    );
  },
});

/**
 * Renders the styled alert dialog description primitive.
 *
 * @example
 * import { AlertDialogDescription } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialogDescription;
 */
export const AlertDialogDescription = component({
  render(props: AlertDialogPartProps) {
    const styleAttrs = style.attrs(alertDialogStyles.description, props.styles?.description);
    return (
      <p {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </p>
    );
  },
});

// Footer row that lays the Cancel/Action buttons out with a real gap instead of
// flush siblings (the "squished footer" defect). See issues-digest alert-dialog P1.
/**
 * Renders the styled alert dialog footer primitive.
 *
 * @example
 * import { AlertDialogFooter } from "@kovojs/ui/alert-dialog";
 * const component = AlertDialogFooter;
 */
export const AlertDialogFooter = component({
  render(props: AlertDialogPartProps) {
    const styleAttrs = style.attrs(alertDialogStyles.footer, props.styles?.footer);
    return (
      <div {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </div>
    );
  },
});
