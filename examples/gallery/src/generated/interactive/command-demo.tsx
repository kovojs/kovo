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
  commandDialogAttributes,
  commandEmptyAttributes,
  commandInputAttributes,
  commandItemAttributes,
  commandListboxAttributes,
  commandRootAttributes,
  commandTriggerAttributes,
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
        class={ROOT_CLASS}
        data-gallery-interactive="command"
        {...commandRootAttributes(commandState)}
        data-placeholder={state.inputValue === '' ? '' : null}
        data-bind:data-placeholder="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$section_data_placeholder_derive"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$section_data_state_derive"
        kovo-c="gallery-command-demo"
        kovo-state='{"highlightedValue":"dashboard","inputValue":"","lastKeyAction":"idle","open":false,"value":"dashboard"}'
      >
        <form id="gallery-command-form" data-gallery-form="command"></form>
        <button
          class={TRIGGER_CLASS}
          id="gallery-command-trigger"
          on:click="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_click"
          {...commandTriggerAttributes({ ...commandState, contentId })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_state_derive"
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
          data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$dialog_open_derive"
        >
          <h2 id="gallery-command-title">Command menu</h2>
          <p id="gallery-command-description">Search project actions.</p>
          <input
            class={INPUT_CLASS}
            on:input="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$input_input"
            on:keydown="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$input_keydown"
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
            data-bind:aria-activedescendant="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$input_aria_activedescendant_derive"
            aria-expanded={state.open ? 'true' : 'false'}
            data-bind:aria-expanded="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$input_aria_expanded_derive"
            data-placeholder={state.inputValue === '' ? '' : null}
            data-bind:data-placeholder="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$input_data_placeholder_derive"
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$input_data_state_derive"
            value={state.inputValue}
            data-bind:value="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$input_value_derive"
          />
          <div
            class={LISTBOX_CLASS}
            {...commandListboxAttributes({ ...commandState, id: listboxId })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$div_data_state_derive"
            hidden={!state.open}
            data-bind:hidden="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$div_hidden_derive"
          >
            <button
              class={ITEM_CLASS}
              on:click="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_click_2"
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-0',
                itemLabel: 'Open dashboard',
                itemValue: 'dashboard',
              })}
              aria-selected={state.highlightedValue === 'dashboard' ? 'true' : 'false'}
              data-bind:aria-selected="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_aria_selected_derive"
              data-highlighted={state.highlightedValue === 'dashboard' ? '' : null}
              data-bind:data-highlighted="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_highlighted_derive"
              data-selected={state.value === 'dashboard' ? '' : null}
              data-bind:data-selected="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_selected_derive"
              data-state={state.highlightedValue === 'dashboard' ? 'active' : 'inactive'}
              data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_state_derive_2"
              hidden={
                state.inputValue !== '' &&
                !'open dashboard dashboard'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_hidden_derive"
              tabIndex={state.highlightedValue === 'dashboard' ? 0 : -1}
              data-bind:tabIndex="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_tabIndex_derive"
            >
              Open dashboard
            </button>
            <button
              class={ITEM_CLASS}
              on:click="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_click_3"
              {...commandItemAttributes({
                ...commandState,
                id: 'gallery-command-listbox-item-1',
                itemLabel: 'Invite teammate',
                itemValue: 'invite',
              })}
              aria-selected={state.highlightedValue === 'invite' ? 'true' : 'false'}
              data-bind:aria-selected="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_aria_selected_derive_2"
              data-highlighted={state.highlightedValue === 'invite' ? '' : null}
              data-bind:data-highlighted="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_highlighted_derive_2"
              data-selected={state.value === 'invite' ? '' : null}
              data-bind:data-selected="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_selected_derive_2"
              data-state={state.highlightedValue === 'invite' ? 'active' : 'inactive'}
              data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_state_derive_3"
              hidden={
                state.inputValue !== '' &&
                !'invite teammate invite'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_hidden_derive_2"
              tabIndex={state.highlightedValue === 'invite' ? 0 : -1}
              data-bind:tabIndex="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_tabIndex_derive_2"
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
              data-bind:aria-selected="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_aria_selected_derive_3"
              data-highlighted={state.highlightedValue === 'delete' ? '' : null}
              data-bind:data-highlighted="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_highlighted_derive_3"
              data-selected={state.value === 'delete' ? '' : null}
              data-bind:data-selected="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_selected_derive_3"
              data-state={state.highlightedValue === 'delete' ? 'active' : 'inactive'}
              data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_state_derive_4"
              hidden={
                state.inputValue !== '' &&
                !'delete project delete'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_hidden_derive_3"
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
              data-bind:hidden="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$p_hidden_derive"
            >
              No commands found.
            </p>
          </div>
          <button
            class={CLOSE_CLASS}
            on:click="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_click_4"
            {...commandCloseAttributes({ ...commandState, contentId })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$button_data_state_derive_5"
          >
            Close
          </button>
        </dialog>
        <output
          data-demo-state="command-input"
          data-bind="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$output_text_derive"
        >
          {state.inputValue || 'empty'}
        </output>
        <output data-demo-state="command-key-canceled" data-bind="state.lastKeyAction">
          {state.lastKeyAction}
        </output>
        <output
          data-demo-state="command-value"
          data-bind="/c/__v/f25523b3/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$output_text_derive_2"
        >
          {state.value === 'invite' ? 'Invite teammate' : 'Open dashboard'}
        </output>
      </section>
    );
  },
});
GalleryCommandDemo.name = 'generated/interactive/command-demo/gallery-command-demo';
