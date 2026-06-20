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
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface AlertDialogStyleOverrides {
  action?: style.StyleInput;
  cancel?: style.StyleInput;
  content?: style.StyleInput;
  root?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface AlertDialogStateProps {
  disabled?: boolean;
  open?: boolean;
}

export interface AlertDialogProps extends AlertDialogStateProps {
  children?: string;
  id?: string;
  styles?: AlertDialogStyleOverrides;
}

export interface AlertDialogTriggerProps extends AlertDialogStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  styles?: AlertDialogStyleOverrides;
}

export interface AlertDialogContentProps extends AlertDialogStateProps {
  children?: string;
  contentId?: string;
  descriptionId?: string;
  styles?: AlertDialogStyleOverrides;
  titleId?: string;
}

export interface AlertDialogCancelProps extends AlertDialogStateProps {
  autoFocus?: boolean;
  children?: string;
  contentId?: string;
  id?: string;
  styles?: AlertDialogStyleOverrides;
}

export interface AlertDialogActionProps extends AlertDialogStateProps {
  children?: string;
  contentId?: string;
  id?: string;
  intent?: AlertDialogActionIntent;
  styles?: AlertDialogStyleOverrides;
}

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
      outlineColor: uiTheme.color.borderStrong,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
    ':hover': {
      backgroundColor: uiTheme.color.accentHover,
      color: uiTheme.color.foreground,
    },
    '[data-intent=destructive]': {
      backgroundColor: uiTheme.color.danger.border,
      color: uiTheme.color.foregroundInverse,
    },
    '[data-intent=destructive]:hover': {
      backgroundColor: uiTheme.color.danger.background,
      color: uiTheme.color.danger.foreground,
    },
  },
  cancel: {
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
      outlineColor: uiTheme.color.borderStrong,
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
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.25), 0 8px 10px -6px rgb(0 0 0 / 0.25)',
    color: uiTheme.color.foreground,
    left: '50%',
    maxWidth: 448,
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
      backgroundColor: 'rgb(0 0 0 / 0.4)',
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
    borderColor: uiTheme.color.borderStrong,
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
      outlineColor: uiTheme.color.borderStrong,
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

export const AlertDialogContent = component({
  render(props: AlertDialogContentProps) {
    const attrs = alertDialogContentAttributes({
      ...alertDialogState(props),
      ...(props.contentId === undefined ? {} : { contentId: props.contentId }),
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.titleId === undefined ? {} : { titleId: props.titleId }),
    });
    const styleAttrs = style.attrs(alertDialogStyles.content, props.styles?.content);

    return (
      <dialog
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-modal={attrs['aria-modal']}
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
