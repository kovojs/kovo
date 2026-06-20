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

export type DrawerSide = 'top' | 'right' | 'bottom' | 'left';

export interface DrawerStyleOverrides {
  body?: style.StyleInput;
  close?: style.StyleInput;
  content?: style.StyleInput;
  description?: style.StyleInput;
  handle?: style.StyleInput;
  header?: style.StyleInput;
  root?: style.StyleInput;
  title?: style.StyleInput;
  trigger?: style.StyleInput;
}

export interface DrawerProps {
  children?: string;
  closeLabel?: string;
  contentId: string;
  description?: string;
  disabled?: boolean;
  open?: boolean;
  side?: DrawerSide;
  styles?: DrawerStyleOverrides;
  title: string;
  trigger?: string;
}

export interface DrawerStateProps {
  disabled?: boolean;
  open?: boolean;
  styles?: DrawerStyleOverrides;
}

export interface DrawerRootProps extends DrawerStateProps {
  children?: string;
  id?: string;
}

export interface DrawerTriggerProps extends DrawerStateProps {
  children?: string;
  contentId: string;
  id?: string;
}

export interface DrawerContentProps extends DrawerStateProps {
  children?: string;
  contentId: string;
  descriptionId?: string;
  side?: DrawerSide;
  titleId: string;
}

export interface DrawerPartProps {
  children?: string;
  id?: string;
  styles?: DrawerStyleOverrides;
}

export interface DrawerCloseProps extends DrawerStateProps {
  children?: string;
  contentId: string;
  id?: string;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const drawerStyles = style.create({
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
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.25), 0 8px 10px -6px rgb(0 0 0 / 0.25)',
    color: uiTheme.color.foreground,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    maxWidth: '100vw',
    padding: 24,
    position: 'fixed',
    zIndex: 50,
    '[data-state=closed]': {
      display: 'none',
    },
  },
  description: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
  },
  handle: {
    backgroundColor: uiTheme.color.borderStrong,
    borderRadius: uiTheme.radius.full,
    height: 6,
    marginInline: 'auto',
    width: 48,
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
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
  },
});

export const drawerSideStyles = style.create({
  bottom: {
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    maxHeight: '85vh',
    right: 0,
  },
  left: {
    borderRightWidth: 1,
    bottom: 0,
    left: 0,
    maxWidth: 384,
    top: 0,
    width: '100%',
  },
  right: {
    borderLeftWidth: 1,
    bottom: 0,
    maxWidth: 384,
    right: 0,
    top: 0,
    width: '100%',
  },
  top: {
    borderBottomWidth: 1,
    left: 0,
    maxHeight: '85vh',
    right: 0,
    top: 0,
  },
});

export const Drawer = component({
  render(props: DrawerProps) {
    const open = props.open === true;
    const side = props.side ?? 'bottom';
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
    const rootStyleAttrs = style.attrs(drawerStyles.root, props.styles?.root);
    const triggerStyleAttrs = style.attrs(drawerStyles.trigger, props.styles?.trigger);
    const contentStyleAttrs = style.attrs(
      drawerStyles.content,
      drawerSideStyles[side],
      props.styles?.content,
    );
    const handleStyleAttrs = style.attrs(drawerStyles.handle, props.styles?.handle);
    const headerStyleAttrs = style.attrs(drawerStyles.header, props.styles?.header);
    const titleStyleAttrs = style.attrs(drawerStyles.title, props.styles?.title);
    const descriptionStyleAttrs = style.attrs(drawerStyles.description, props.styles?.description);
    const bodyStyleAttrs = style.attrs(drawerStyles.body, props.styles?.body);
    const closeStyleAttrs = style.attrs(drawerStyles.close, props.styles?.close);

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
          <div {...handleStyleAttrs} aria-hidden="true" />
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
  },
});

export const DrawerRoot = component({
  render(props: DrawerRootProps) {
    const attrs = dialogRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      open: props.open === true,
    });
    const styleAttrs = style.attrs(drawerStyles.root, props.styles?.root);

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

export const DrawerTrigger = component({
  render(props: DrawerTriggerProps) {
    const attrs = dialogTriggerAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      contentId: props.contentId,
      open: props.open === true,
    });
    const styleAttrs = style.attrs(drawerStyles.trigger, props.styles?.trigger);

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

export const DrawerContent = component({
  render(props: DrawerContentProps) {
    const side = props.side ?? 'bottom';
    const attrs = dialogContentAttributes({
      contentId: props.contentId,
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      open: props.open === true,
      titleId: props.titleId,
    });
    const styleAttrs = style.attrs(
      drawerStyles.content,
      drawerSideStyles[side],
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

export const DrawerHandle = component({
  render(props: DrawerPartProps) {
    const styleAttrs = style.attrs(drawerStyles.handle, props.styles?.handle);
    return <div {...styleAttrs} {...passThroughProps(props)} aria-hidden="true" id={props.id} />;
  },
});

export const DrawerHeader = component({
  render(props: DrawerPartProps) {
    const styleAttrs = style.attrs(drawerStyles.header, props.styles?.header);
    return (
      <header {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </header>
    );
  },
});

export const DrawerTitle = component({
  render(props: DrawerPartProps) {
    const styleAttrs = style.attrs(drawerStyles.title, props.styles?.title);
    return (
      <h2 {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </h2>
    );
  },
});

export const DrawerDescription = component({
  render(props: DrawerPartProps) {
    const styleAttrs = style.attrs(drawerStyles.description, props.styles?.description);
    return (
      <p {...styleAttrs} {...passThroughProps(props)} id={props.id}>
        {props.children}
      </p>
    );
  },
});

export const DrawerClose = component({
  render(props: DrawerCloseProps) {
    const attrs = dialogCloseAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      contentId: props.contentId,
      open: props.open === true,
    });
    const styleAttrs = style.attrs(drawerStyles.close, props.styles?.close);

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
