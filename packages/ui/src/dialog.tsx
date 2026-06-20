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

export interface DialogStyleOverrides {
  close?: style.StyleInput;
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface DialogStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface DialogProps extends DialogStateProps {
  children?: string;
  id?: string;
  styles?: DialogStyleOverrides;
}

export interface DialogTriggerProps extends DialogStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: DialogStyleOverrides;
}

export interface DialogContentProps extends DialogStateProps {
  children?: string;
  contentId?: string;
  descriptionId?: string;
  dismissible?: boolean;
  styles?: DialogStyleOverrides;
  titleId?: string;
}

export interface DialogCloseProps extends DialogStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: DialogStyleOverrides;
}

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
    padding: 24,
    position: 'fixed',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'calc(100% - 2rem)',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    '::backdrop': {
      backgroundColor: 'rgb(0 0 0 / 0.8)',
    },
  },
  root: {
    color: uiTheme.color.foreground,
    display: 'contents',
    '[data-disabled]': {
      opacity: 0.5,
    },
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

export const dialogClasses = [style.attrs(dialogStyles.root).class ?? ''] as const;
export const dialogTriggerClasses = [style.attrs(dialogStyles.trigger).class ?? ''] as const;
export const dialogContentClasses = [style.attrs(dialogStyles.content).class ?? ''] as const;
export const dialogCloseClasses = [style.attrs(dialogStyles.close).class ?? ''] as const;
export const dialogClassNames = dialogStyles.root;
export const dialogTriggerClassNames = dialogStyles.trigger;
export const dialogContentClassNames = dialogStyles.content;
export const dialogCloseClassNames = dialogStyles.close;

function dialogState(props: DialogStateProps) {
  return {
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    open: props.open === true,
  };
}

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
