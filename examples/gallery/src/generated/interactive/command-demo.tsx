// @kovojs-ir - lowered from examples/gallery/src/interactive/command-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryCommandDemo$Command_data_placeholder_derive = derive(['state'], (state: any) =>
  state.inputValue === '' ? '' : null,
);
export const GalleryCommandDemo$Command_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandTrigger_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryCommandDemo$CommandTrigger_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandDialog_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandDialog_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryCommandDemo$CommandInput_aria_activedescendant_derive = derive(
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
export const GalleryCommandDemo$CommandInput_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryCommandDemo$CommandInput_data_placeholder_derive = derive(
  ['state'],
  (state: any) => (state.inputValue === '' ? '' : null),
);
export const GalleryCommandDemo$CommandInput_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandInput_value_derive = derive(
  ['state'],
  (state: any) => state.inputValue,
);
export const GalleryCommandDemo$CommandListbox_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryCommandDemo$CommandListbox_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryCommandDemo$CommandItem_aria_selected_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'dashboard' ? 'true' : 'false',
);
export const GalleryCommandDemo$CommandItem_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'dashboard' ? '' : null),
);
export const GalleryCommandDemo$CommandItem_data_selected_derive = derive(['state'], (state: any) =>
  state.value === 'dashboard' ? '' : null,
);
export const GalleryCommandDemo$CommandItem_data_state_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'dashboard' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$CommandItem_hidden_derive = derive(['state'], (state: any) =>
  state.inputValue !== '' &&
  !'open dashboard dashboard'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$CommandItem_tabIndex_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'dashboard' ? 0 : -1,
);
export const GalleryCommandDemo$CommandItem_aria_selected_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'invite' ? 'true' : 'false'),
);
export const GalleryCommandDemo$CommandItem_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'invite' ? '' : null),
);
export const GalleryCommandDemo$CommandItem_data_selected_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'invite' ? '' : null),
);
export const GalleryCommandDemo$CommandItem_data_state_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'invite' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$CommandItem_hidden_derive_2 = derive(['state'], (state: any) =>
  state.inputValue !== '' &&
  !'invite teammate invite'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$CommandItem_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'invite' ? 0 : -1,
);
export const GalleryCommandDemo$CommandItem_aria_selected_derive_3 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'delete' ? 'true' : 'false'),
);
export const GalleryCommandDemo$CommandItem_data_highlighted_derive_3 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'delete' ? '' : null),
);
export const GalleryCommandDemo$CommandItem_data_selected_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'delete' ? '' : null),
);
export const GalleryCommandDemo$CommandItem_data_state_derive_3 = derive(['state'], (state: any) =>
  state.highlightedValue === 'delete' ? 'active' : 'inactive',
);
export const GalleryCommandDemo$CommandItem_hidden_derive_3 = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'delete project delete'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryCommandDemo$CommandEmpty_hidden_derive = derive(['state'], (state: any) =>
  state.inputValue === '' ||
  'open dashboard dashboard invite teammate invite delete project delete'.includes(
    state.inputValue.toLocaleLowerCase(),
  )
    ? ''
    : null,
);
export const GalleryCommandDemo$CommandClose_data_state_derive = derive(['state'], (state: any) =>
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
  Command,
  CommandClose,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandListbox,
  CommandTrigger,
  type CommandItem as GalleryCommandItem,
} from '@kovojs/ui/command';

export interface GalleryCommandDemoState {
  highlightedValue: string;
  inputValue: string;
  lastKeyAction: string;
  open: boolean;
  value: string;
}

const commandItems: readonly GalleryCommandItem[] = Object.freeze([
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
      <Command
        data-gallery-interactive="command"
        {...commandState}
        data-placeholder={state.inputValue === '' ? '' : null}
        data-bind:data-placeholder="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$Command_data_placeholder_derive"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$Command_data_state_derive"
        kovo-state='{"highlightedValue":"dashboard","inputValue":"","lastKeyAction":"idle","open":false,"value":"dashboard"}'
      >
        <form id="gallery-command-form" data-gallery-form="command"></form>
        <CommandTrigger
          contentId={contentId}
          id="gallery-command-trigger"
          on:click="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandTrigger_click"
          {...commandState}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandTrigger_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandTrigger_data_state_derive"
        >
          Open command
        </CommandTrigger>
        <CommandDialog
          contentId={contentId}
          descriptionId="gallery-command-description"
          titleId="gallery-command-title"
          {...commandState}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandDialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandDialog_open_derive"
        >
          <h2 id="gallery-command-title">Command menu</h2>
          <p id="gallery-command-description">Search project actions.</p>
          <CommandInput
            id="gallery-command-input"
            labelledBy="gallery-command-title"
            on:input="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandInput_input"
            on:keydown="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandInput_keydown"
            {...commandState}
            aria-activedescendant={
              state.highlightedValue === 'invite'
                ? 'gallery-command-listbox-item-1'
                : state.highlightedValue === 'delete'
                  ? 'gallery-command-listbox-item-2'
                  : state.highlightedValue === 'dashboard'
                    ? 'gallery-command-listbox-item-0'
                    : null
            }
            data-bind:aria-activedescendant="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandInput_aria_activedescendant_derive"
            aria-expanded={state.open ? 'true' : 'false'}
            data-bind:aria-expanded="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandInput_aria_expanded_derive"
            data-placeholder={state.inputValue === '' ? '' : null}
            data-bind:data-placeholder="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandInput_data_placeholder_derive"
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandInput_data_state_derive"
            value={state.inputValue}
            data-bind:value="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandInput_value_derive"
          />
          <CommandListbox
            id={listboxId}
            {...commandState}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandListbox_data_state_derive"
            hidden={!state.open}
            data-bind:hidden="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandListbox_hidden_derive"
          >
            <CommandItem
              id="gallery-command-listbox-item-0"
              itemLabel="Open dashboard"
              itemValue="dashboard"
              on:click="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_click"
              {...commandState}
              aria-selected={state.highlightedValue === 'dashboard' ? 'true' : 'false'}
              data-bind:aria-selected="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_aria_selected_derive"
              data-highlighted={state.highlightedValue === 'dashboard' ? '' : null}
              data-bind:data-highlighted="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_highlighted_derive"
              data-selected={state.value === 'dashboard' ? '' : null}
              data-bind:data-selected="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_selected_derive"
              data-state={state.highlightedValue === 'dashboard' ? 'active' : 'inactive'}
              data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_state_derive"
              hidden={
                state.inputValue !== '' &&
                !'open dashboard dashboard'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_hidden_derive"
              tabIndex={state.highlightedValue === 'dashboard' ? 0 : -1}
              data-bind:tabIndex="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_tabIndex_derive"
            >
              Open dashboard
            </CommandItem>
            <CommandItem
              id="gallery-command-listbox-item-1"
              itemLabel="Invite teammate"
              itemValue="invite"
              on:click="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_click_2"
              {...commandState}
              aria-selected={state.highlightedValue === 'invite' ? 'true' : 'false'}
              data-bind:aria-selected="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_aria_selected_derive_2"
              data-highlighted={state.highlightedValue === 'invite' ? '' : null}
              data-bind:data-highlighted="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_highlighted_derive_2"
              data-selected={state.value === 'invite' ? '' : null}
              data-bind:data-selected="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_selected_derive_2"
              data-state={state.highlightedValue === 'invite' ? 'active' : 'inactive'}
              data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_state_derive_2"
              hidden={
                state.inputValue !== '' &&
                !'invite teammate invite'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_hidden_derive_2"
              tabIndex={state.highlightedValue === 'invite' ? 0 : -1}
              data-bind:tabIndex="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_tabIndex_derive_2"
            >
              Invite teammate
            </CommandItem>
            <CommandItem
              id="gallery-command-listbox-item-2"
              itemDisabled={true}
              itemLabel="Delete project"
              itemValue="delete"
              tabIndex={-1}
              {...commandState}
              aria-selected={state.highlightedValue === 'delete' ? 'true' : 'false'}
              data-bind:aria-selected="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_aria_selected_derive_3"
              data-highlighted={state.highlightedValue === 'delete' ? '' : null}
              data-bind:data-highlighted="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_highlighted_derive_3"
              data-selected={state.value === 'delete' ? '' : null}
              data-bind:data-selected="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_selected_derive_3"
              data-state={state.highlightedValue === 'delete' ? 'active' : 'inactive'}
              data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_data_state_derive_3"
              hidden={
                state.inputValue !== '' &&
                !'delete project delete'.includes(state.inputValue.toLocaleLowerCase())
              }
              data-bind:hidden="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandItem_hidden_derive_3"
            >
              Delete project
            </CommandItem>
            <CommandEmpty
              {...commandState}
              hidden={
                state.inputValue === '' ||
                'open dashboard dashboard invite teammate invite delete project delete'.includes(
                  state.inputValue.toLocaleLowerCase(),
                )
              }
              data-bind:hidden="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandEmpty_hidden_derive"
            >
              No commands found.
            </CommandEmpty>
          </CommandListbox>
          <CommandClose
            contentId={contentId}
            on:click="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandClose_click"
            {...commandState}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$CommandClose_data_state_derive"
          >
            Close
          </CommandClose>
        </CommandDialog>
        <output
          data-demo-state="command-input"
          data-bind="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$output_text_derive"
        >
          {state.inputValue || 'empty'}
        </output>
        <output data-demo-state="command-key-canceled" data-bind="state.lastKeyAction">
          {state.lastKeyAction}
        </output>
        <output
          data-demo-state="command-value"
          data-bind="/c/__v/ff1160bb/examples/gallery/src/generated/interactive/command-demo.client.js#GalleryCommandDemo$output_text_derive_2"
        >
          {state.value === 'invite' ? 'Invite teammate' : 'Open dashboard'}
        </output>
      </Command>
    );
  },
});
GalleryCommandDemo.name = 'generated/interactive/command-demo/gallery-command-demo';
