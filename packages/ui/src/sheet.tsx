/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
  type ClassValue,
} from '@jiso/headless-ui';

export type SheetSide = 'left' | 'right';

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

export const sheetContentClassNames = defineVariants({
  base: 'fixed inset-y-0 z-50 flex w-full max-w-sm flex-col gap-4 border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl',
  variants: {
    side: {
      left: 'left-0 border-r',
      right: 'right-0 border-l',
    },
  },
  defaultVariants: {
    side: 'right',
  },
});

export const sheetContentClasses = sheetContentClassNames.classes;

export const Sheet = component('sheet', {
  render(props: SheetProps) {
    const open = props.open === true;
    const side = props.side ?? 'right';
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
          {props.trigger ?? 'Open'}
        </button>
        <dialog
          aria-describedby={contentAttrs['aria-describedby']}
          aria-labelledby={contentAttrs['aria-labelledby']}
          class={cn(sheetContentClassNames({ side }), props.contentClass)}
          data-state={contentAttrs['data-state']}
          id={contentAttrs.id}
          open={contentAttrs.open}
        >
          <header class="grid gap-1">
            <h2 class="text-base font-semibold" id={titleId}>
              {props.title}
            </h2>
            {descriptionId === undefined ? (
              ''
            ) : (
              <p class="text-sm text-neutral-600" id={descriptionId}>
                {props.description}
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
            {props.closeLabel ?? 'Close'}
          </button>
        </dialog>
      </div>
    );
  },
});
