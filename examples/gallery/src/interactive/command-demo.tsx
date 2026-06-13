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

export interface GalleryCommandDemoState {
  highlightedValue: string;
  inputValue: string;
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
  state: () => ({ highlightedValue: 'dashboard', inputValue: '', open: false, value: 'dashboard' }),
  render: (_queries: Record<string, never>, state: GalleryCommandDemoState) => {
    const contentId = 'gallery-command-dialog';
    const listboxId = 'gallery-command-listbox';
    const commandState = {
      highlightedValue: state.highlightedValue,
      inputValue: state.inputValue,
      items: commandItems,
      listboxId,
      open: state.open,
      placeholder: 'Type a command',
      value: state.value,
    };

    return (
      <section
        {...commandRootAttributes(commandState)}
        class="grid gap-2"
        data-gallery-interactive="command"
      >
        <button
          {...commandTriggerAttributes({ ...commandState, contentId })}
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
        >
          <h2 id="gallery-command-title">Command menu</h2>
          <p id="gallery-command-description">Search project actions.</p>
          <input
            {...commandInputAttributes({
              ...commandState,
              id: 'gallery-command-input',
              labelledBy: 'gallery-command-title',
            })}
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
              state.open = false;
              state.value = state.highlightedValue;
              const doc = Reflect['get'](globalThis, 'document');
              const dialog = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-command-dialog')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="command-value"]')
                : undefined;
              if (dialog) Object(dialog)['close']?.call(dialog);
              if (output) {
                if (state.highlightedValue === 'invite') {
                  output['textContent'] = 'Invite teammate';
                } else {
                  output['textContent'] = 'Open dashboard';
                }
              }
            }}
          />
          <div {...commandListboxAttributes({ ...commandState, id: listboxId })}>
            <button
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-0',
                itemLabel: 'Open dashboard',
                itemValue: 'dashboard',
              })}
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
            >
              Delete project
            </button>
          </div>
          <button
            {...commandCloseAttributes({ ...commandState, contentId })}
            onClick={() => {
              state.open = false;
            }}
          >
            Close
          </button>
        </dialog>
        <output data-demo-state="command-input">{state.inputValue || 'empty'}</output>
        <output data-demo-state="command-value">{commandValueText(commandState)}</output>
      </section>
    );
  },
});
