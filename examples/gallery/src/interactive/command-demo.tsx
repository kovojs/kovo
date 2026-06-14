/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  commandCloseAttributes,
  commandDialogAttributes,
  commandInputAttributes,
  commandItemAttributes,
  commandListboxAttributes,
  commandRootAttributes,
  commandTriggerAttributes,
  commandValueText,
  type CommandItem,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/command.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-neutral-100';
const DIALOG_CLASS =
  'w-full max-w-lg rounded-md border border-neutral-200 bg-white p-4 text-neutral-950 shadow-lg backdrop:bg-black/20 data-[state=closed]:hidden';
const INPUT_CLASS =
  'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 data-[placeholder]:text-neutral-500';
const LISTBOX_CLASS =
  'mt-3 max-h-64 overflow-auto rounded-md border border-neutral-200 bg-white p-1 data-[state=closed]:hidden';
const ITEM_CLASS =
  'flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const CLOSE_CLASS =
  'mt-3 inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';

export interface GalleryCommandDemoState {
  highlightedValue: string;
  inputValue: string;
  lastKeyAction: string;
  open: boolean;
  value: string;
}

const commandItems: readonly CommandItem[] = Object.freeze([
  { id: 'gallery-command-listbox-item-0', label: 'Open dashboard', value: 'dashboard' },
  { id: 'gallery-command-listbox-item-1', label: 'Invite teammate', value: 'invite' },
  {
    disabled: true,
    id: 'gallery-command-listbox-item-2',
    label: 'Delete project',
    value: 'delete',
  },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryCommandDemo = component('gallery-command-demo', {
  state: () => ({
    highlightedValue: 'dashboard',
    inputValue: '',
    lastKeyAction: 'idle',
    open: false,
    value: 'dashboard',
  }),
  render: (_queries: Record<string, never>, state: GalleryCommandDemoState) => {
    const contentId = 'gallery-command-dialog';
    const listboxId = 'gallery-command-listbox';
    const commandState = {
      form: 'gallery-command-form',
      highlightedValue: state.highlightedValue,
      inputValue: state.inputValue,
      items: commandItems,
      listboxId,
      name: 'gallery-command-query',
      open: state.open,
      placeholder: 'Type a command',
      required: true,
      value: state.value,
    };

    return (
      <section
        {...commandRootAttributes(commandState)}
        class={ROOT_CLASS}
        data-gallery-interactive="command"
      >
        <form id="gallery-command-form" data-gallery-form="command"></form>
        <button
          {...commandTriggerAttributes({ ...commandState, contentId })}
          class={TRIGGER_CLASS}
          id="gallery-command-trigger"
          onClick={() => {
            state.open = true;
          }}
        >
          Open command
        </button>
        <dialog
          {...commandDialogAttributes({
            ...commandState,
            contentId,
            descriptionId: 'gallery-command-description',
            titleId: 'gallery-command-title',
          })}
          class={DIALOG_CLASS}
        >
          <h2 id="gallery-command-title">Command menu</h2>
          <p id="gallery-command-description">Search project actions.</p>
          <input
            {...commandInputAttributes({
              ...commandState,
              id: 'gallery-command-input',
              labelledBy: 'gallery-command-title',
            })}
            class={INPUT_CLASS}
            onInput={() => {
              state.open = true;
              state.inputValue = 'invite';
              state.highlightedValue = 'invite';
              const doc = Reflect['get'](globalThis, 'document');
              const input = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-command-input')
                : undefined;
              const invite = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-command-listbox-item-1')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="command-input"]')
                : undefined;
              if (input) {
                input['value'] = 'invite';
                Object(input)['setAttribute']?.call(
                  input,
                  'aria-activedescendant',
                  'gallery-command-listbox-item-1',
                );
              }
              if (invite) Object(invite)['setAttribute']?.call(invite, 'aria-selected', 'true');
              if (output) output['textContent'] = 'invite';
            }}
            onKeyDown={() => {
              if (event && Object(event)['key'] !== 'Enter') return;
              if (event) Object(event)['preventDefault']?.call(event);
              const doc = Reflect['get'](globalThis, 'document');
              const dialog = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-command-dialog')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="command-value"]')
                : undefined;
              const canceled = doc
                ? Object(doc)['querySelector']?.call(
                    doc,
                    '[data-demo-state="command-key-canceled"]',
                  )
                : undefined;
              if (state.value === 'dashboard') {
                state.lastKeyAction = 'canceled';
                if (canceled) canceled['textContent'] = 'canceled';
                if (output) output['textContent'] = 'Open dashboard';
              } else {
                state.open = false;
                state.value = state.highlightedValue;
                state.lastKeyAction = 'selected';
                if (dialog) Object(dialog)['close']?.call(dialog);
                if (output) {
                  if (state.value === 'invite') {
                    output['textContent'] = 'Invite teammate';
                  } else {
                    output['textContent'] = 'Open dashboard';
                  }
                }
                if (canceled) canceled['textContent'] = 'selected';
              }
            }}
          />
          <div {...commandListboxAttributes({ ...commandState, id: listboxId })} class={LISTBOX_CLASS}>
            <button
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-0',
                itemLabel: 'Open dashboard',
                itemValue: 'dashboard',
              })}
              class={ITEM_CLASS}
            >
              Open dashboard
            </button>
            <button
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-1',
                itemLabel: 'Invite teammate',
                itemValue: 'invite',
              })}
              class={ITEM_CLASS}
              onClick={() => {
                state.open = false;
                state.value = 'invite';
                const doc = Reflect['get'](globalThis, 'document');
                const dialog = doc
                  ? Object(doc)['getElementById']?.call(doc, 'gallery-command-dialog')
                  : undefined;
                const output = doc
                  ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="command-value"]')
                  : undefined;
                if (dialog) Object(dialog)['close']?.call(dialog);
                if (output) output['textContent'] = 'Invite teammate';
              }}
            >
              Invite teammate
            </button>
            <button
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-2',
                itemDisabled: true,
                itemLabel: 'Delete project',
                itemValue: 'delete',
              })}
              class={ITEM_CLASS}
            >
              Delete project
            </button>
          </div>
          <button
            {...commandCloseAttributes({ ...commandState, contentId })}
            class={CLOSE_CLASS}
            onClick={() => {
              state.open = false;
            }}
          >
            Close
          </button>
        </dialog>
        <output data-demo-state="command-input">{state.inputValue || 'empty'}</output>
        <output data-demo-state="command-key-canceled">{state.lastKeyAction}</output>
        <output data-demo-state="command-value">{commandValueText(commandState)}</output>
      </section>
    );
  },
});
