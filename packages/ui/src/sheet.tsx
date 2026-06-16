/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  defineVariants,
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
  type ClassValue,
} from '@kovojs/headless-ui';
import { escapeHtml } from '@kovojs/server';

export type SheetSide = 'top' | 'right' | 'bottom' | 'left';
export type DrawerSide = SheetSide;

export interface SheetProps {
  children?: string;
  class?: ClassValue;
  closeLabel?: string;
  contentClass?: ClassValue;
  contentId: string;
  description?: string;
  disabled?: boolean;
  open?: boolean;
  side?: SheetSide;
  title: string;
  trigger?: string;
  triggerClass?: ClassValue;
}

export interface DrawerProps extends SheetProps {
  side?: DrawerSide;
}

export const sheetContentClassNames = defineVariants({
  base: 'fixed z-50 flex flex-col gap-4 border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl',
  variants: {
    side: {
      bottom: 'inset-x-0 bottom-0 max-h-[85vh] border-t',
      left: 'inset-y-0 left-0 w-full max-w-sm border-r',
      right: 'inset-y-0 right-0 w-full max-w-sm border-l',
      top: 'inset-x-0 top-0 max-h-[85vh] border-b',
    },
  },
  defaultVariants: {
    side: 'right',
  },
});

export const sheetContentClasses = sheetContentClassNames.classes;

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

  return (
    <div
      class={cn('contents', props.class)}
      data-disabled={rootAttrs['data-disabled']}
      data-state={rootAttrs['data-state']}
    >
      <button
        aria-controls={triggerAttrs['aria-controls']}
        aria-expanded={triggerAttrs['aria-expanded']}
        aria-haspopup={triggerAttrs['aria-haspopup']}
        class={cn(
          'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50',
          props.triggerClass,
        )}
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
        aria-describedby={contentAttrs['aria-describedby']}
        aria-labelledby={contentAttrs['aria-labelledby']}
        class={cn(sheetContentClassNames({ side }), props.contentClass)}
        closedby={contentAttrs.closedby}
        data-state={contentAttrs['data-state']}
        id={contentAttrs.id}
        open={contentAttrs.open}
      >
        <header class="grid gap-1">
          <h2 class="text-base font-semibold" id={titleId}>
            {escapeHtml(props.title)}
          </h2>
          {descriptionId === undefined ? (
            ''
          ) : (
            <p class="text-sm text-neutral-600" id={descriptionId}>
              {escapeHtml(props.description ?? '')}
            </p>
          )}
        </header>
        <div class="text-sm">{props.children}</div>
        <button
          class="inline-flex h-8 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
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

export const Sheet = component('sheet', {
  render(props: SheetProps) {
    return renderDialogPanel(props, 'right');
  },
});

export const Drawer = component('drawer', {
  render(props: DrawerProps) {
    return renderDialogPanel(props, 'bottom');
  },
});
