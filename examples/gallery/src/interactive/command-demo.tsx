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
} from '@kovojs/headless-ui/command';
import {
  commandClasses,
  commandTriggerClasses,
  commandDialogClasses,
  commandInputClasses,
  commandListboxClasses,
  commandItemClasses,
  commandCloseClasses,
} from '@kovojs/ui/command';

const ROOT_CLASS = commandClasses.join(' ');
const TRIGGER_CLASS = commandTriggerClasses.join(' ');
const DIALOG_CLASS = commandDialogClasses.join(' ');
const INPUT_CLASS = commandInputClasses.join(' ');
const LISTBOX_CLASS = commandListboxClasses.join(' ');
const ITEM_CLASS = commandItemClasses.join(' ');
const CLOSE_CLASS = commandCloseClasses.join(' ');

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
