// @kovojs-ir - lowered from examples/gallery/src/interactive/command-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryCommandDemo$section_data_placeholder_derive = derive(['state'], (state: any) =>
  state.inputValue === '' ? '' : null,
);
export const GalleryCommandDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryCommandDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$dialog_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$dialog_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryCommandDemo$input_aria_activedescendant_derive = derive(
  ['state'],
  (state: any) =>
    state.highlightedValue === 'invite'
      ? 'gallery-command-listbox-item-1'
      : state.highlightedValue === 'delete'
        ? 'gallery-command-listbox-item-2'
        : state.highlightedValue === 'dashboard'
          ? 'gallery-command-listbox-item-0'
          : null,
);
export const GalleryCommandDemo$input_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryCommandDemo$input_data_placeholder_derive = derive(['state'], (state: any) =>
  state.inputValue === '' ? '' : null,
);
export const GalleryCommandDemo$input_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$input_value_derive = derive(
  ['state'],
  (state: any) => state.inputValue,
);
export const GalleryCommandDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryCommandDemo$button_aria_selected_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'dashboard' ? 'true' : 'false',
);
export const GalleryCommandDemo$button_data_highlighted_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'dashboard' ? '' : null,
);
export const GalleryCommandDemo$button_data_selected_derive = derive(['state'], (state: any) =>
  state.value === 'dashboard' ? '' : null,
);
export const GalleryCommandDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'dashboard' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$button_hidden_derive = derive(['state'], (state: any) =>
  state.inputValue !== '' &&
  !'open dashboard dashboard'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'dashboard' ? 0 : -1,
);
export const GalleryCommandDemo$button_aria_selected_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'invite' ? 'true' : 'false',
);
export const GalleryCommandDemo$button_data_highlighted_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'invite' ? '' : null,
);
export const GalleryCommandDemo$button_data_selected_derive_2 = derive(['state'], (state: any) =>
  state.value === 'invite' ? '' : null,
);
export const GalleryCommandDemo$button_data_state_derive_3 = derive(['state'], (state: any) =>
  state.highlightedValue === 'invite' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$button_hidden_derive_2 = derive(['state'], (state: any) =>
  state.inputValue !== '' &&
  !'invite teammate invite'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'invite' ? 0 : -1,
);
export const GalleryCommandDemo$button_aria_selected_derive_3 = derive(['state'], (state: any) =>
  state.highlightedValue === 'delete' ? 'true' : 'false',
);
export const GalleryCommandDemo$button_data_highlighted_derive_3 = derive(['state'], (state: any) =>
  state.highlightedValue === 'delete' ? '' : null,
);
export const GalleryCommandDemo$button_data_selected_derive_3 = derive(['state'], (state: any) =>
  state.value === 'delete' ? '' : null,
);
export const GalleryCommandDemo$button_data_state_derive_4 = derive(['state'], (state: any) =>
  state.highlightedValue === 'delete' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$button_hidden_derive_3 = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'delete project delete'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$p_hidden_derive = derive(['state'], (state: any) =>
  state.inputValue === '' ||
  'open dashboard dashboard invite teammate invite delete project delete'.includes(
    state.inputValue.toLocaleLowerCase(),
  )
    ? ''
    : null,
);
export const GalleryCommandDemo$button_data_state_derive_5 = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.inputValue || 'empty',
);
export const GalleryCommandDemo$output_text_derive_2 = derive(['state'], (state: any) =>
  state.value === 'invite' ? 'Invite teammate' : 'Open dashboard',
);

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
        class={ROOT_CLASS}
        data-gallery-interactive="command"
        {...commandRootAttributes(commandState)}
        data-placeholder={state.inputValue === '' ? '' : null}
        data-bind:data-placeholder="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$section_data_placeholder_derive"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$section_data_state_derive"
        kovo-c="gallery-command-demo"
        kovo-state='{"highlightedValue":"dashboard","inputValue":"","lastKeyAction":"idle","open":false,"value":"dashboard"}'
      >
        <form id="gallery-command-form" data-gallery-form="command"></form>
        <button
          class={TRIGGER_CLASS}
          id="gallery-command-trigger"
          on:click="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_click"
          {...commandTriggerAttributes({ ...commandState, contentId })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_state_derive"
        >
          Open command
        </button>
        <dialog
          class={DIALOG_CLASS}
          {...commandDialogAttributes({
            ...commandState,
            contentId,
            descriptionId: 'gallery-command-description',
            titleId: 'gallery-command-title',
          })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$dialog_open_derive"
        >
          <h2 id="gallery-command-title">Command menu</h2>
          <p id="gallery-command-description">Search project actions.</p>
          <input
            class={INPUT_CLASS}
            on:input="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$input_input"
            on:keydown="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$input_keydown"
            {...commandInputAttributes({
              ...commandState,
              id: 'gallery-command-input',
              labelledBy: 'gallery-command-title',
            })}
            aria-activedescendant={
              state.highlightedValue === 'invite'
                ? 'gallery-command-listbox-item-1'
                : state.highlightedValue === 'delete'
                  ? 'gallery-command-listbox-item-2'
                  : state.highlightedValue === 'dashboard'
                    ? 'gallery-command-listbox-item-0'
                    : null
            }
            data-bind:aria-activedescendant="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$input_aria_activedescendant_derive"
            aria-expanded={state.open ? 'true' : 'false'}
            data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$input_aria_expanded_derive"
            data-placeholder={state.inputValue === '' ? '' : null}
            data-bind:data-placeholder="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$input_data_placeholder_derive"
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$input_data_state_derive"
            value={state.inputValue}
            data-bind:value="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$input_value_derive"
          />
          <div
            class={LISTBOX_CLASS}
            {...commandListboxAttributes({ ...commandState, id: listboxId })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$div_data_state_derive"
            hidden={!state.open}
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$div_hidden_derive"
          >
            <button
              class={ITEM_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_click_2"
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-0',
                itemLabel: 'Open dashboard',
                itemValue: 'dashboard',
              })}
              aria-selected={state.highlightedValue === 'dashboard' ? 'true' : 'false'}
              data-bind:aria-selected="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_aria_selected_derive"
              data-highlighted={state.highlightedValue === 'dashboard' ? '' : null}
              data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_highlighted_derive"
              data-selected={state.value === 'dashboard' ? '' : null}
              data-bind:data-selected="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_selected_derive"
              data-state={state.highlightedValue === 'dashboard' ? 'active' : 'inactive'}
              data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_state_derive_2"
              hidden={
                state.inputValue !== '' &&
                !'open dashboard dashboard'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_hidden_derive"
              tabIndex={state.highlightedValue === 'dashboard' ? 0 : -1}
              data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_tabIndex_derive"
            >
              Open dashboard
            </button>
            <button
              class={ITEM_CLASS}
              on:click="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_click_3"
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-1',
                itemLabel: 'Invite teammate',
                itemValue: 'invite',
              })}
              aria-selected={state.highlightedValue === 'invite' ? 'true' : 'false'}
              data-bind:aria-selected="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_aria_selected_derive_2"
              data-highlighted={state.highlightedValue === 'invite' ? '' : null}
              data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_highlighted_derive_2"
              data-selected={state.value === 'invite' ? '' : null}
              data-bind:data-selected="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_selected_derive_2"
              data-state={state.highlightedValue === 'invite' ? 'active' : 'inactive'}
              data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_state_derive_3"
              hidden={
                state.inputValue !== '' &&
                !'invite teammate invite'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_hidden_derive_2"
              tabIndex={state.highlightedValue === 'invite' ? 0 : -1}
              data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_tabIndex_derive_2"
            >
              Invite teammate
            </button>
            <button
              class={ITEM_CLASS}
              tabIndex={-1}
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-2',
                itemDisabled: true,
                itemLabel: 'Delete project',
                itemValue: 'delete',
              })}
              aria-selected={state.highlightedValue === 'delete' ? 'true' : 'false'}
              data-bind:aria-selected="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_aria_selected_derive_3"
              data-highlighted={state.highlightedValue === 'delete' ? '' : null}
              data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_highlighted_derive_3"
              data-selected={state.value === 'delete' ? '' : null}
              data-bind:data-selected="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_selected_derive_3"
              data-state={state.highlightedValue === 'delete' ? 'active' : 'inactive'}
              data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_state_derive_4"
              hidden={
                state.inputValue !== '' &&
                !'delete project delete'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_hidden_derive_3"
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
              data-bind:hidden="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$p_hidden_derive"
            >
              No commands found.
            </p>
          </div>
          <button
            class={CLOSE_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_click_4"
            {...commandCloseAttributes({ ...commandState, contentId })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$button_data_state_derive_5"
          >
            Close
          </button>
        </dialog>
        <output
          data-demo-state="command-input"
          data-bind="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$output_text_derive"
        >
          {state.inputValue || 'empty'}
        </output>
        <output data-demo-state="command-key-canceled" data-bind="state.lastKeyAction">
          {state.lastKeyAction}
        </output>
        <output
          data-demo-state="command-value"
          data-bind="/c/examples/gallery/src/generated/interactive/command-demo.client.js?v=cc29a41c#GalleryCommandDemo$output_text_derive_2"
        >
          {state.value === 'invite' ? 'Invite teammate' : 'Open dashboard'}
        </output>
      </section>
    );
  },
});
GalleryCommandDemo.name = 'generated/interactive/command-demo/gallery-command-demo';
