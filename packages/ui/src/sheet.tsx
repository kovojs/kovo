/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/dialog';
import * as style from '@kovojs/style';

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

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export const sheetStyles = style.create(
  {
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
      boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
      color: uiTheme.color.foreground,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      padding: 24,
      position: 'fixed',
      zIndex: 50,
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
  },
  { namespace: 'sheet', source: 'sheet.tsx' },
);

export const sheetSideStyles = style.create(
  {
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
  },
  { namespace: 'sheetSide', source: 'sheet.tsx' },
);

export const sheetClasses = [style.attrs(sheetStyles.root).class ?? ''] as const;
export const sheetTriggerClasses = [style.attrs(sheetStyles.trigger).class ?? ''] as const;
export const sheetContentClasses = [
  style.attrs(sheetStyles.content, sheetSideStyles.right).class ?? '',
  style.attrs(sheetSideStyles.bottom).class ?? '',
  style.attrs(sheetSideStyles.left).class ?? '',
  style.attrs(sheetSideStyles.top).class ?? '',
] as const;
export const sheetHeaderClasses = [style.attrs(sheetStyles.header).class ?? ''] as const;
export const sheetTitleClasses = [style.attrs(sheetStyles.title).class ?? ''] as const;
export const sheetDescriptionClasses = [style.attrs(sheetStyles.description).class ?? ''] as const;
export const sheetBodyClasses = [style.attrs(sheetStyles.body).class ?? ''] as const;
export const sheetCloseClasses = [style.attrs(sheetStyles.close).class ?? ''] as const;
export const sheetContentClassNames = sheetStyles.content;

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
      data-disabled={rootAttrs['data-disabled']}
      data-state={rootAttrs['data-state']}
    >
      <button
        {...triggerStyleAttrs}
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
