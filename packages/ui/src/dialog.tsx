/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/dialog';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

/**
 * Style override slots accepted by the dialog components.
 *
 * @example
 * import type { DialogStyleOverrides } from "@kovojs/ui/dialog";
 * const styles: DialogStyleOverrides = {};
 */
export interface DialogStyleOverrides {
  close?: style.StyleInput;
  closeX?: style.StyleInput;
  content?: style.StyleInput;
  description?: style.StyleInput;
  header?: style.StyleInput;
  root?: style.StyleInput;
  title?: style.StyleInput;
  trigger?: style.StyleInput;
}

/**
 * Shared state props for the dialog component family.
 *
 * @example
 * import type { DialogStateProps } from "@kovojs/ui/dialog";
 * const state: DialogStateProps = {};
 */
export interface DialogStateProps {
  disabled?: boolean;
  open?: boolean;
}

/**
 * Props for the dialog component.
 *
 * @example
 * import type { DialogProps } from "@kovojs/ui/dialog";
 * const props: DialogProps = { children: 'Content' };
 */
export interface DialogProps extends DialogStateProps {
  children?: string;
  id?: string;
  styles?: DialogStyleOverrides;
}

/**
 * Props for the dialog trigger component.
 *
 * @example
 * import type { DialogTriggerProps } from "@kovojs/ui/dialog";
 * const props: DialogTriggerProps = { children: 'Content' };
 */
export interface DialogTriggerProps extends DialogStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: DialogStyleOverrides;
}

/**
 * Props for the dialog content component.
 *
 * @example
 * import type { DialogContentProps } from "@kovojs/ui/dialog";
 * const props: DialogContentProps = { children: 'Content' };
 */
export interface DialogContentProps extends DialogStateProps {
  children?: string;
  contentId?: string;
  descriptionId?: string;
  dismissible?: boolean;
  styles?: DialogStyleOverrides;
  titleId?: string;
}

/**
 * Props for the dialog close component.
 *
 * @example
 * import type { DialogCloseProps } from "@kovojs/ui/dialog";
 * const props: DialogCloseProps = { children: 'Content' };
 */
export interface DialogCloseProps extends DialogStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: DialogStyleOverrides;
}

/**
 * Props for the dialog part component.
 *
 * @example
 * import type { DialogPartProps } from "@kovojs/ui/dialog";
 * const props: DialogPartProps = { children: 'Content' };
 */
export interface DialogPartProps {
  children?: string;
  id?: string;
  styles?: DialogStyleOverrides;
}

/**
 * Style definitions used by the dialog components.
 *
 * @example
 * import { dialogStyles } from "@kovojs/ui/dialog";
 * const styles = dialogStyles;
 */
export const dialogStyles = style.create({
  close: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.borderStrong,
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
  closeX: {
    alignItems: 'center',
    appearance: 'none',
    backgroundColor: 'transparent',
    borderRadius: uiTheme.radius.md,
    borderStyle: 'none',
    borderWidth: 0,
    color: uiTheme.color.foregroundMuted,
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: 18,
    height: 28,
    justifyContent: 'center',
    lineHeight: 1,
    padding: 0,
    position: 'absolute',
    right: 16,
    top: 16,
    transitionProperty: 'background-color, color',
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
    maxWidth: 512,
    opacity: 1,
    padding: 24,
    position: 'fixed',
    top: '50%',
    transform: 'translate(-50%, -50%) scale(1)',
    transitionBehavior: 'allow-discrete',
    transitionDuration: '160ms',
    transitionProperty: 'opacity, transform, display, overlay',
    width: 'calc(100% - 2rem)',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    // Enter-from / exit-to keyframe: fade + slight scale toward center.
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

function dialogState(props: DialogStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

/**
 * Renders the styled dialog primitive.
 *
 * @example
 * import { Dialog } from "@kovojs/ui/dialog";
 * const component = Dialog;
 */
export const Dialog = component({
  render(props: DialogProps) {
    const attrs = dialogRootAttributes(dialogState(props));
    const styleAttrs = style.attrs(dialogStyles.root, props.styles?.root);

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
 * Renders the styled dialog trigger primitive.
 *
 * @example
 * import { DialogTrigger } from "@kovojs/ui/dialog";
 * const component = DialogTrigger;
 */
export const DialogTrigger = component({
  render(props: DialogTriggerProps) {
    const attrs = dialogTriggerAttributes({
      ...dialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(dialogStyles.trigger, props.styles?.trigger);

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
 * Renders the styled dialog content primitive.
 *
 * @example
 * import { DialogContent } from "@kovojs/ui/dialog";
 * const component = DialogContent;
 */
export const DialogContent = component({
  render(props: DialogContentProps) {
    const attrs = dialogContentAttributes({
      ...dialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.dismissible === undefined ? {} : { dismissible: props.dismissible }),
      ...(props.titleId === undefined ? {} : { titleId: props.titleId }),
    });
    const styleAttrs = style.attrs(dialogStyles.content, props.styles?.content);

    return (
      <dialog
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-modal={attrs['aria-modal']}
        closedby={attrs.closedby}
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

/**
 * Renders the styled dialog close primitive.
 *
 * @example
 * import { DialogClose } from "@kovojs/ui/dialog";
 * const component = DialogClose;
 */
export const DialogClose = component({
  render(props: DialogCloseProps) {
    const attrs = dialogCloseAttributes({
      ...dialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(dialogStyles.close, props.styles?.close);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
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

// Top-right "×" affordance carrying the same command='close'/commandfor close
// semantics as DialogClose (shadcn Dialog parity). SPEC.md §5.2 keeps the
// command wiring intact; an accessible name is required (rules/accessibility-conformance.md).
/**
 * Renders the styled dialog close x primitive.
 *
 * @example
 * import { DialogCloseX } from "@kovojs/ui/dialog";
 * const component = DialogCloseX;
 */
export const DialogCloseX = component({
  render(props: DialogCloseProps) {
    const attrs = dialogCloseAttributes({
      ...dialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
    });
    const styleAttrs = style.attrs(dialogStyles.closeX, props.styles?.closeX);

    return (
      <button
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-label="Close"
        command={attrs.command}
        commandfor={attrs.commandfor}
        data-disabled={attrs['data-disabled']}
        data-state={attrs['data-state']}
        disabled={attrs.disabled}
        id={props.id}
        type={attrs.type}
      >
        {props.children ?? '×'}
      </button>
    );
  },
});

/**
 * Renders the styled dialog header primitive.
 *
 * @example
 * import { DialogHeader } from "@kovojs/ui/dialog";
 * const component = DialogHeader;
 */
export const DialogHeader = component({
  render(props: DialogPartProps) {
    const styleAttrs = style.attrs(dialogStyles.header, props.styles?.header);
    return (
      <div {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </div>
    );
  },
});

/**
 * Renders the styled dialog title primitive.
 *
 * @example
 * import { DialogTitle } from "@kovojs/ui/dialog";
 * const component = DialogTitle;
 */
export const DialogTitle = component({
  render(props: DialogPartProps) {
    const styleAttrs = style.attrs(dialogStyles.title, props.styles?.title);
    return (
      <h2 {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </h2>
    );
  },
});

/**
 * Renders the styled dialog description primitive.
 *
 * @example
 * import { DialogDescription } from "@kovojs/ui/dialog";
 * const component = DialogDescription;
 */
export const DialogDescription = component({
  render(props: DialogPartProps) {
    const styleAttrs = style.attrs(dialogStyles.description, props.styles?.description);
    return (
      <p {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </p>
    );
  },
});
