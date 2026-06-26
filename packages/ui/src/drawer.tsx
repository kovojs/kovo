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
 * Supported drawer side values.
 *
 * @example
 * import type { DrawerSide } from "@kovojs/ui/drawer";
 * const value: DrawerSide = 'right';
 */
export type DrawerSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Style override slots accepted by the drawer components.
 *
 * @example
 * import type { DrawerStyleOverrides } from "@kovojs/ui/drawer";
 * const styles: DrawerStyleOverrides = {};
 */
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

/**
 * Props for the drawer component.
 *
 * @example
 * import type { DrawerProps } from "@kovojs/ui/drawer";
 * const props: DrawerProps = { contentId: 'content-id', title: 'Title', children: 'Content' };
 */
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

/**
 * Shared state props for the drawer component family.
 *
 * @example
 * import type { DrawerStateProps } from "@kovojs/ui/drawer";
 * const state: DrawerStateProps = {};
 */
export interface DrawerStateProps {
  disabled?: boolean;
  open?: boolean;
  styles?: DrawerStyleOverrides;
}

/**
 * Props for the drawer root component.
 *
 * @example
 * import type { DrawerRootProps } from "@kovojs/ui/drawer";
 * const props: DrawerRootProps = { children: 'Content' };
 */
export interface DrawerRootProps extends DrawerStateProps {
  children?: string;
  id?: string;
}

/**
 * Props for the drawer trigger component.
 *
 * @example
 * import type { DrawerTriggerProps } from "@kovojs/ui/drawer";
 * const props: DrawerTriggerProps = { contentId: 'content-id', children: 'Content' };
 */
export interface DrawerTriggerProps extends DrawerStateProps {
  children?: string;
  contentId: string;
  id?: string;
}

/**
 * Props for the drawer content component.
 *
 * @example
 * import type { DrawerContentProps } from "@kovojs/ui/drawer";
 * const props: DrawerContentProps = { contentId: 'content-id', titleId: 'title-id', children: 'Content' };
 */
export interface DrawerContentProps extends DrawerStateProps {
  children?: string;
  contentId: string;
  descriptionId?: string;
  side?: DrawerSide;
  titleId: string;
}

/**
 * Props for the drawer part component.
 *
 * @example
 * import type { DrawerPartProps } from "@kovojs/ui/drawer";
 * const props: DrawerPartProps = { children: 'Content' };
 */
export interface DrawerPartProps {
  children?: string;
  id?: string;
  styles?: DrawerStyleOverrides;
}

/**
 * Props for the drawer close component.
 *
 * @example
 * import type { DrawerCloseProps } from "@kovojs/ui/drawer";
 * const props: DrawerCloseProps = { contentId: 'content-id', children: 'Content' };
 */
export interface DrawerCloseProps extends DrawerStateProps {
  children?: string;
  contentId: string;
  id?: string;
}

/**
 * Style definitions used by the drawer components.
 *
 * @example
 * import { drawerStyles } from "@kovojs/ui/drawer";
 * const styles = drawerStyles;
 */
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
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    color: uiTheme.color.foreground,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    // Reset the UA modal-<dialog> box (inset:0 + margin:auto) that would otherwise
    // center the panel; the per-side rules in drawerSideStyles then anchor each edge.
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
  handle: {
    backgroundColor: uiTheme.color.border,
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

/**
 * Style definitions used by the drawer side components.
 *
 * @example
 * import { drawerSideStyles } from "@kovojs/ui/drawer";
 * const styles = drawerSideStyles;
 */
export const drawerSideStyles = style.create({
  bottom: {
    borderTopLeftRadius: uiTheme.radius.lg,
    borderTopRightRadius: uiTheme.radius.lg,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    maxHeight: '85vh',
    right: 0,
    // Anchor to the bottom edge: clear the opposite (top) inset so the panel is a
    // full-width strip flush to the bottom rather than a centered card.
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

/**
 * Renders the styled drawer primitive.
 *
 * @example
 * import { Drawer } from "@kovojs/ui/drawer";
 * const component = Drawer;
 */
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
          {props.trigger ?? 'Open'}
        </button>
        <dialog
          {...contentStyleAttrs}
          {...passThroughProps(props)}
          aria-describedby={contentAttrs['aria-describedby']}
          aria-labelledby={contentAttrs['aria-labelledby']}
          aria-modal={contentAttrs['aria-modal']}
          closedby={contentAttrs.closedby}
          data-state={contentAttrs['data-state']}
          id={contentAttrs.id}
          open={contentAttrs.open}
          role={contentAttrs.role}
        >
          <div {...handleStyleAttrs} aria-hidden="true" />
          <header {...headerStyleAttrs}>
            <h2 {...titleStyleAttrs} id={titleId}>
              {props.title}
            </h2>
            {descriptionId === undefined ? (
              ''
            ) : (
              <p {...descriptionStyleAttrs} id={descriptionId}>
                {props.description ?? ''}
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
            {props.closeLabel ?? 'Close'}
          </button>
        </dialog>
      </div>
    );
  },
});

/**
 * Renders the styled drawer root primitive.
 *
 * @example
 * import { DrawerRoot } from "@kovojs/ui/drawer";
 * const component = DrawerRoot;
 */
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

/**
 * Renders the styled drawer trigger primitive.
 *
 * @example
 * import { DrawerTrigger } from "@kovojs/ui/drawer";
 * const component = DrawerTrigger;
 */
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

/**
 * Renders the styled drawer content primitive.
 *
 * @example
 * import { DrawerContent } from "@kovojs/ui/drawer";
 * const component = DrawerContent;
 */
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
 * Renders the styled drawer handle primitive.
 *
 * @example
 * import { DrawerHandle } from "@kovojs/ui/drawer";
 * const component = DrawerHandle;
 */
export const DrawerHandle = component({
  render(props: DrawerPartProps) {
    const styleAttrs = style.attrs(drawerStyles.handle, props.styles?.handle);
    return <div {...styleAttrs} {...passThroughProps(props)} aria-hidden="true" id={props.id} />;
  },
});

/**
 * Renders the styled drawer header primitive.
 *
 * @example
 * import { DrawerHeader } from "@kovojs/ui/drawer";
 * const component = DrawerHeader;
 */
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

/**
 * Renders the styled drawer title primitive.
 *
 * @example
 * import { DrawerTitle } from "@kovojs/ui/drawer";
 * const component = DrawerTitle;
 */
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

/**
 * Renders the styled drawer description primitive.
 *
 * @example
 * import { DrawerDescription } from "@kovojs/ui/drawer";
 * const component = DrawerDescription;
 */
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

/**
 * Renders the styled drawer close primitive.
 *
 * @example
 * import { DrawerClose } from "@kovojs/ui/drawer";
 * const component = DrawerClose;
 */
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
