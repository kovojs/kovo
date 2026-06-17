/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  commandCloseAttributes,
  commandCloseClick as _commandCloseClick,
  commandDialogAttributes,
  commandEmptyAttributes,
  commandFilteredItems as _commandFilteredItems,
  commandInput as _commandInput,
  commandInputAttributes,
  commandItemAttributes,
  commandItemClick as _commandItemClick,
  commandKeyDown as _commandKeyDown,
  commandListboxAttributes,
  commandRootAttributes,
  commandTriggerAttributes,
  commandTriggerClick as _commandTriggerClick,
  type CommandItem,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/command.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
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
  'flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[selected]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
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
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryCommandDemo = component({
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
        data-placeholder={state.inputValue === '' ? '' : null}
        data-state={state.open ? 'open' : 'closed'}
      >
        <form id="gallery-command-form" data-gallery-form="command"></form>
        <button
          {...commandTriggerAttributes({ ...commandState, contentId })}
          aria-expanded={state.open ? 'true' : 'false'}
          class={TRIGGER_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          id="gallery-command-trigger"
          onClick={() => {
            const result = _commandTriggerClick(Object(event), { open: state.open });
            if (result) state.open = result.open;
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
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
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
              const result = _commandInput(Object(event), { inputValue: state.inputValue });
              if (!result) return;
              state.inputValue = result.inputValue;
              state.open = true;
              const filteredItems = _commandFilteredItems({
                inputValue: state.inputValue,
                items: [
                  {
                    id: 'gallery-command-listbox-item-0',
                    label: 'Open dashboard',
                    value: 'dashboard',
                  },
                  {
                    id: 'gallery-command-listbox-item-1',
                    label: 'Invite teammate',
                    value: 'invite',
                  },
                  {
                    disabled: true,
                    id: 'gallery-command-listbox-item-2',
                    label: 'Delete project',
                    value: 'delete',
                  },
                ],
              });
              state.highlightedValue =
                filteredItems[0]?.disabled === true ? '' : (filteredItems[0]?.value ?? '');
            }}
            onKeyDown={() => {
              const result = _commandKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                inputValue: state.inputValue,
                items: [
                  {
                    id: 'gallery-command-listbox-item-0',
                    label: 'Open dashboard',
                    value: 'dashboard',
                  },
                  {
                    id: 'gallery-command-listbox-item-1',
                    label: 'Invite teammate',
                    value: 'invite',
                  },
                  {
                    disabled: true,
                    id: 'gallery-command-listbox-item-2',
                    label: 'Delete project',
                    value: 'delete',
                  },
                ],
                open: state.open,
                value: state.value,
              });
              if (!result) return;

              if ('selected' in result) {
                if (result.selected) {
                  state.open = result.open.open;
                  state.value = result.value.value ?? state.value;
                  state.lastKeyAction = 'selected';
                } else {
                  state.lastKeyAction = 'canceled';
                }
              } else if ('highlightedValue' in result) {
                state.highlightedValue = result.highlightedValue ?? '';
                state.lastKeyAction = 'moved';
              } else {
                state.open = result.open;
                state.lastKeyAction = Object(event)['key'] === 'Escape' ? 'closed' : 'idle';
              }
            }}
            aria-activedescendant={
              state.highlightedValue === 'invite'
                ? 'gallery-command-listbox-item-1'
                : state.highlightedValue === 'delete'
                  ? 'gallery-command-listbox-item-2'
                  : state.highlightedValue === 'dashboard'
                    ? 'gallery-command-listbox-item-0'
                    : null
            }
            aria-expanded={state.open ? 'true' : 'false'}
            data-placeholder={state.inputValue === '' ? '' : null}
            data-state={state.open ? 'open' : 'closed'}
            value={state.inputValue}
          />
          <div
            {...commandListboxAttributes({ ...commandState, id: listboxId })}
            class={LISTBOX_CLASS}
            data-state={state.open ? 'open' : 'closed'}
            hidden={!state.open}
          >
            <button
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-0',
                itemLabel: 'Open dashboard',
                itemValue: 'dashboard',
              })}
              aria-selected={state.highlightedValue === 'dashboard' ? 'true' : 'false'}
              class={ITEM_CLASS}
              data-highlighted={state.highlightedValue === 'dashboard' ? '' : null}
              data-selected={state.value === 'dashboard' ? '' : null}
              data-state={state.highlightedValue === 'dashboard' ? 'active' : 'inactive'}
              hidden={
                state.inputValue !== '' &&
                !'open dashboard dashboard'.includes(state.inputValue.toLocaleLowerCase())
              }
              onClick={() => {
                const result = _commandItemClick(Object(event), {
                  highlightedValue: state.highlightedValue,
                  inputValue: state.inputValue,
                  items: [
                    {
                      id: 'gallery-command-listbox-item-0',
                      label: 'Open dashboard',
                      value: 'dashboard',
                    },
                    {
                      id: 'gallery-command-listbox-item-1',
                      label: 'Invite teammate',
                      value: 'invite',
                    },
                    {
                      disabled: true,
                      id: 'gallery-command-listbox-item-2',
                      label: 'Delete project',
                      value: 'delete',
                    },
                  ],
                  itemValue: 'dashboard',
                  open: state.open,
                  value: state.value,
                });
                if (!result) return;
                if (result.selected) {
                  state.open = result.open.open;
                  state.value = result.value.value ?? state.value;
                  state.lastKeyAction = 'selected';
                }
              }}
              tabIndex={state.highlightedValue === 'dashboard' ? 0 : -1}
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
              aria-selected={state.highlightedValue === 'invite' ? 'true' : 'false'}
              class={ITEM_CLASS}
              data-highlighted={state.highlightedValue === 'invite' ? '' : null}
              data-selected={state.value === 'invite' ? '' : null}
              data-state={state.highlightedValue === 'invite' ? 'active' : 'inactive'}
              hidden={
                state.inputValue !== '' &&
                !'invite teammate invite'.includes(state.inputValue.toLocaleLowerCase())
              }
              onClick={() => {
                const result = _commandItemClick(Object(event), {
                  highlightedValue: state.highlightedValue,
                  inputValue: state.inputValue,
                  items: [
                    {
                      id: 'gallery-command-listbox-item-0',
                      label: 'Open dashboard',
                      value: 'dashboard',
                    },
                    {
                      id: 'gallery-command-listbox-item-1',
                      label: 'Invite teammate',
                      value: 'invite',
                    },
                    {
                      disabled: true,
                      id: 'gallery-command-listbox-item-2',
                      label: 'Delete project',
                      value: 'delete',
                    },
                  ],
                  itemValue: 'invite',
                  open: state.open,
                  value: state.value,
                });
                if (!result) return;
                if (result.selected) {
                  state.open = result.open.open;
                  state.value = result.value.value ?? state.value;
                  state.lastKeyAction = 'selected';
                }
              }}
              tabIndex={state.highlightedValue === 'invite' ? 0 : -1}
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
              aria-selected={state.highlightedValue === 'delete' ? 'true' : 'false'}
              class={ITEM_CLASS}
              data-highlighted={state.highlightedValue === 'delete' ? '' : null}
              data-selected={state.value === 'delete' ? '' : null}
              data-state={state.highlightedValue === 'delete' ? 'active' : 'inactive'}
              hidden={
                state.inputValue !== '' &&
                !'delete project delete'.includes(state.inputValue.toLocaleLowerCase())
              }
              tabIndex={-1}
            >
              Delete project
            </button>
            <p
              {...commandEmptyAttributes(commandState)}
              hidden={
                state.inputValue === '' ||
                'open dashboard dashboard invite teammate invite delete project delete'.includes(
                  state.inputValue.toLocaleLowerCase(),
                )
              }
            >
              No commands found.
            </p>
          </div>
          <button
            {...commandCloseAttributes({ ...commandState, contentId })}
            class={CLOSE_CLASS}
            data-state={state.open ? 'open' : 'closed'}
            onClick={() => {
              const result = _commandCloseClick(Object(event), { open: state.open });
              if (result) state.open = result.open;
            }}
          >
            Close
          </button>
        </dialog>
        <output data-demo-state="command-input">{state.inputValue || 'empty'}</output>
        <output data-demo-state="command-key-canceled">{state.lastKeyAction}</output>
        <output data-demo-state="command-value">
          {state.value === 'invite' ? 'Invite teammate' : 'Open dashboard'}
        </output>
      </section>
    );
  },
});
