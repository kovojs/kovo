// @jiso-ir - lowered from examples/gallery/src/interactive/command-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
  { label: 'Open dashboard', value: 'dashboard' },
  { label: 'Invite teammate', value: 'invite' },
  { disabled: true, label: 'Delete project', value: 'delete' },
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
        fw-c="gallery-command-demo"
        fw-state='{"highlightedValue":"dashboard","inputValue":"","open":false,"value":"dashboard"}'
      >
        <button
          {...commandTriggerAttributes({ ...commandState, contentId })}
          id="gallery-command-trigger"
          on:click="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=7bc0e286#GalleryCommandDemo$button_click"
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
            on:input="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=7bc0e286#GalleryCommandDemo$input_input"
            on:keydown="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=7bc0e286#GalleryCommandDemo$input_keydown"
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
              on:click="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=7bc0e286#GalleryCommandDemo$button_click_2"
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
            on:click="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=7bc0e286#GalleryCommandDemo$button_click_3"
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
