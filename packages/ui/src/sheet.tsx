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

export type SheetSide = 'top' | 'right' | 'bottom' | 'left';

export interface SheetStyleOverrides {
  body?: style.StyleInput;
  close?: style.StyleInput;
  content?: style.StyleInput;
  description?: style.StyleInput;
  header?: style.StyleInput;
  root?: style.StyleInput;
  title?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface SheetProps {
  children?: string;
  closeLabel?: string;
  contentId: string;
  description?: string;
  disabled?: boolean;
  open?: boolean;
  side?: SheetSide;
  styles?: SheetStyleOverrides;
  title: string;
  trigger?: string;
}

export interface SheetStateProps {
  disabled?: boolean;
  open?: boolean;
  styles?: SheetStyleOverrides;
}

export interface SheetRootProps extends SheetStateProps {
  children?: string;
  id?: string;
}

export interface SheetTriggerProps extends SheetStateProps {
  children?: string;
  contentId: string;
  id?: string;
}

export interface SheetContentProps extends SheetStateProps {
  children?: string;
  contentId: string;
  descriptionId?: string;
  side?: SheetSide;
  titleId: string;
}

export interface SheetPartProps {
  children?: string;
  id?: string;
  styles?: SheetStyleOverrides;
}

export interface SheetCloseProps extends SheetStateProps {
  children?: string;
  contentId: string;
  id?: string;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const sheetStyles = style.create({
  body: {
    fontSize: 14,
  },
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
    width: 'fit-content',
    ':disabled': {
      opacity: 0.5,
      pointerEvents: 'none',
    },
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
  },
  content: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderStyle: 'solid',
    borderWidth: 0,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    color: uiTheme.color.foreground,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    // Reset the UA modal-<dialog> box (inset:0 + margin:auto) that would otherwise
    // center the panel; the per-side rules in sheetSideStyles then anchor each edge.
    inset: 'auto',
    margin: 0,
    maxWidth: '100vw',
    opacity: 1,
    padding: 24,
    position: 'fixed',
    transitionBehavior: 'allow-discrete',
    transitionDuration: '220ms',
    transitionProperty: 'transform, opacity, display, overlay',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
    '::backdrop': {
      backgroundColor: 'rgb(0 0 0 / 0.8)',
    },
  },
  description: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
  },
  header: {
    display: 'grid',
    gap: 4,
  },
  root: {
    display: 'contents',
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
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
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
  },
});

export const sheetSideStyles = style.create({
  bottom: {
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    maxHeight: '85vh',
    right: 0,
    top: 'auto',
    transform: 'translateY(0)',
    '@starting-style': {
      transform: 'translateY(100%)',
    },
    '[data-state=closed]': {
      transform: 'translateY(100%)',
    },
  },
  left: {
    borderRightWidth: 1,
    bottom: 0,
    left: 0,
    maxWidth: 384,
    right: 'auto',
    top: 0,
    transform: 'translateX(0)',
    width: '100%',
    '@starting-style': {
      transform: 'translateX(-100%)',
    },
    '[data-state=closed]': {
      transform: 'translateX(-100%)',
    },
  },
  right: {
    borderLeftWidth: 1,
    bottom: 0,
    left: 'auto',
    maxWidth: 384,
    right: 0,
    top: 0,
    transform: 'translateX(0)',
    width: '100%',
    '@starting-style': {
      transform: 'translateX(100%)',
    },
    '[data-state=closed]': {
      transform: 'translateX(100%)',
    },
  },
  top: {
    borderBottomWidth: 1,
    bottom: 'auto',
    left: 0,
    maxHeight: '85vh',
    right: 0,
    top: 0,
    transform: 'translateY(0)',
    '@starting-style': {
      transform: 'translateY(-100%)',
    },
    '[data-state=closed]': {
      transform: 'translateY(-100%)',
    },
  },
});

function renderDialogPanel(props: SheetProps, defaultSide: SheetSide): string {
  const open = props.open === true;
  const side = props.side ?? defaultSide;
  const titleId = `${props.contentId}-title`;
  const descriptionId =
    props.description === undefined ? undefined : `${props.contentId}-description`;
  const disabledState = props.disabled === undefined ? {} : { disabled: props.disabled };
  const descriptionState = descriptionId === undefined ? {} : { descriptionId };
  const rootAttrs = dialogRootAttributes({ ...disabledState, open });
  const triggerAttrs = dialogTriggerAttributes({
    ...disabledState,
    contentId: props.contentId,
    open,
  });
  const contentAttrs = dialogContentAttributes({
    ...descriptionState,
    contentId: props.contentId,
    open,
    titleId,
  });
  const closeAttrs = dialogCloseAttributes({
    ...disabledState,
    contentId: props.contentId,
    open,
  });
  const rootStyleAttrs = style.attrs(sheetStyles.root, props.styles?.root);
  const triggerStyleAttrs = style.attrs(sheetStyles.trigger, props.styles?.trigger);
  const contentStyleAttrs = style.attrs(
    sheetStyles.content,
    sheetSideStyles[side],
    props.styles?.content,
  );
  const headerStyleAttrs = style.attrs(sheetStyles.header, props.styles?.header);
  const titleStyleAttrs = style.attrs(sheetStyles.title, props.styles?.title);
  const descriptionStyleAttrs = style.attrs(sheetStyles.description, props.styles?.description);
  const bodyStyleAttrs = style.attrs(sheetStyles.body, props.styles?.body);
  const closeStyleAttrs = style.attrs(sheetStyles.close, props.styles?.close);

  return (
    <div
      {...rootStyleAttrs}
      {...passThroughProps(props)}
      data-disabled={rootAttrs['data-disabled']}
      data-state={rootAttrs['data-state']}
    >
      <button
        {...triggerStyleAttrs}
        {...passThroughProps(props)}
        aria-controls={triggerAttrs['aria-controls']}
        aria-expanded={triggerAttrs['aria-expanded']}
        aria-haspopup={triggerAttrs['aria-haspopup']}
        command={triggerAttrs.command}
        commandfor={triggerAttrs.commandfor}
        data-disabled={triggerAttrs['data-disabled']}
        data-state={triggerAttrs['data-state']}
        disabled={triggerAttrs.disabled}
        type={triggerAttrs.type}
      >
        {escapeHtml(props.trigger ?? 'Open')}
      </button>
      <dialog
        {...contentStyleAttrs}
        {...passThroughProps(props)}
        aria-describedby={contentAttrs['aria-describedby']}
        aria-labelledby={contentAttrs['aria-labelledby']}
        closedby={contentAttrs.closedby}
        data-state={contentAttrs['data-state']}
        id={contentAttrs.id}
        open={contentAttrs.open}
      >
        <header {...headerStyleAttrs}>
          <h2 {...titleStyleAttrs} id={titleId}>
            {escapeHtml(props.title)}
          </h2>
          {descriptionId === undefined ? (
            ''
          ) : (
            <p {...descriptionStyleAttrs} id={descriptionId}>
              {escapeHtml(props.description ?? '')}
            </p>
          )}
        </header>
        <div {...bodyStyleAttrs}>{props.children}</div>
        <button
          {...closeStyleAttrs}
          {...passThroughProps(props)}
          command={closeAttrs.command}
          commandfor={closeAttrs.commandfor}
          data-disabled={closeAttrs['data-disabled']}
          data-state={closeAttrs['data-state']}
          disabled={closeAttrs.disabled}
          type={closeAttrs.type}
        >
          {escapeHtml(props.closeLabel ?? 'Close')}
        </button>
      </dialog>
    </div>
  );
}

export const Sheet = component({
  render(props: SheetProps) {
    return renderDialogPanel(props, 'right');
  },
});

export const SheetRoot = component({
  render(props: SheetRootProps) {
    const attrs = dialogRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      open: props.open === true,
    });
    const styleAttrs = style.attrs(sheetStyles.root, props.styles?.root);

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

export const SheetTrigger = component({
  render(props: SheetTriggerProps) {
    const attrs = dialogTriggerAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      contentId: props.contentId,
      open: props.open === true,
    });
    const styleAttrs = style.attrs(sheetStyles.trigger, props.styles?.trigger);

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

export const SheetContent = component({
  render(props: SheetContentProps) {
    const side = props.side ?? 'right';
    const attrs = dialogContentAttributes({
      contentId: props.contentId,
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      open: props.open === true,
      titleId: props.titleId,
    });
    const styleAttrs = style.attrs(
      sheetStyles.content,
      sheetSideStyles[side],
      props.styles?.content,
    );

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

export const SheetHeader = component({
  render(props: SheetPartProps) {
    const styleAttrs = style.attrs(sheetStyles.header, props.styles?.header);
    return (
      <header {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </header>
    );
  },
});

export const SheetTitle = component({
  render(props: SheetPartProps) {
    const styleAttrs = style.attrs(sheetStyles.title, props.styles?.title);
    return (
      <h2 {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </h2>
    );
  },
});

export const SheetDescription = component({
  render(props: SheetPartProps) {
    const styleAttrs = style.attrs(sheetStyles.description, props.styles?.description);
    return (
      <p {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </p>
    );
  },
});

export const SheetClose = component({
  render(props: SheetCloseProps) {
    const attrs = dialogCloseAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      contentId: props.contentId,
      open: props.open === true,
    });
    const styleAttrs = style.attrs(sheetStyles.close, props.styles?.close);

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
