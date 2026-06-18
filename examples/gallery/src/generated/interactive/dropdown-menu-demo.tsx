// @kovojs-ir - lowered from examples/gallery/src/interactive/dropdown-menu-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryDropdownMenuDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDropdownMenuDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryDropdownMenuDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDropdownMenuDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDropdownMenuDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryDropdownMenuDemo$button_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'duplicate' ? '' : null),
);
export const GalleryDropdownMenuDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'duplicate' ? 'active' : 'inactive',
);
export const GalleryDropdownMenuDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'duplicate' ? 0 : -1,
);
export const GalleryDropdownMenuDemo$button_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'rename' ? '' : null),
);
export const GalleryDropdownMenuDemo$button_data_state_derive_3 = derive(['state'], (state: any) =>
  state.highlightedValue === 'rename' ? 'active' : 'inactive',
);
export const GalleryDropdownMenuDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'rename' ? 0 : -1,
);
export const GalleryDropdownMenuDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  dropdownMenuContentAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuRootAttributes,
  dropdownMenuTriggerAttributes,
  type DropdownMenuItem,
} from '@kovojs/headless-ui/dropdown-menu';
import {
  dropdownMenuTriggerClasses,
  dropdownMenuContentClasses,
  dropdownMenuItemClasses,
} from '@kovojs/ui/dropdown-menu';

const TRIGGER_CLASS = dropdownMenuTriggerClasses.join(' ');
const CONTENT_CLASS = dropdownMenuContentClasses.join(' ');
const ITEM_CLASS = dropdownMenuItemClasses.join(' ');

export interface GalleryDropdownMenuDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const dropdownItems: readonly DropdownMenuItem[] = Object.freeze([
  { label: 'Duplicate', value: 'duplicate' },
  { disabled: true, label: 'Archive', value: 'archive' },
  { label: 'Rename', value: 'rename' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDropdownMenuDemo = component({
  state: () => ({ highlightedValue: 'duplicate', open: false, value: 'duplicate' }),
  render: (_queries: Record<string, never>, state: GalleryDropdownMenuDemoState) => {
    const contentId = 'gallery-dropdown-menu-content';
    const menuState = {
      highlightedValue: state.highlightedValue,
      items: dropdownItems,
      open: state.open,
    };

    return (
      <section
        class="grid gap-2"
        data-gallery-interactive="dropdown-menu"
        {...dropdownMenuRootAttributes(menuState)}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$section_data_state_derive"
        kovo-c="gallery-dropdown-menu-demo"
        kovo-state='{"highlightedValue":"duplicate","open":false,"value":"duplicate"}'
      >
        <button
          class={TRIGGER_CLASS}
          id="gallery-dropdown-menu-trigger"
          on:click="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_click"
          on:keydown="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_keydown"
          {...dropdownMenuTriggerAttributes({ ...menuState, contentId })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_data_state_derive"
        >
          Actions
        </button>
        <div
          class={CONTENT_CLASS}
          {...dropdownMenuContentAttributes({ ...menuState, id: contentId })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$div_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$div_hidden_derive"
        >
          <button
            class={ITEM_CLASS}
            on:keydown="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_keydown_2"
            on:click="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_click_2"
            {...dropdownMenuItemAttributes({
              ...menuState,
              id: 'gallery-dropdown-menu-duplicate',
              itemLabel: 'Duplicate',
              itemValue: 'duplicate',
            })}
            data-highlighted={state.highlightedValue === 'duplicate' ? '' : null}
            data-bind:data-highlighted="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_data_highlighted_derive"
            data-state={state.highlightedValue === 'duplicate' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_data_state_derive_2"
            tabIndex={state.highlightedValue === 'duplicate' ? 0 : -1}
            data-bind:tabIndex="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_tabIndex_derive"
          >
            Duplicate
          </button>
          <button
            class={ITEM_CLASS}
            {...dropdownMenuItemAttributes({
              ...menuState,
              id: 'gallery-dropdown-menu-archive',
              itemDisabled: true,
              itemLabel: 'Archive',
              itemValue: 'archive',
            })}
          >
            Archive
          </button>
          <button
            class={ITEM_CLASS}
            on:keydown="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_keydown_3"
            on:click="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_click_3"
            {...dropdownMenuItemAttributes({
              ...menuState,
              id: 'gallery-dropdown-menu-rename',
              itemLabel: 'Rename',
              itemValue: 'rename',
            })}
            data-highlighted={state.highlightedValue === 'rename' ? '' : null}
            data-bind:data-highlighted="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_data_highlighted_derive_2"
            data-state={state.highlightedValue === 'rename' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_data_state_derive_3"
            tabIndex={state.highlightedValue === 'rename' ? 0 : -1}
            data-bind:tabIndex="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$button_tabIndex_derive_2"
          >
            Rename
          </button>
        </div>
        <output
          data-demo-state="dropdown-open"
          data-bind="/c/__v/c25707ab/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
        <output data-demo-state="dropdown-value" data-bind="state.value">
          {state.value}
        </output>
      </section>
    );
  },
});
GalleryDropdownMenuDemo.name =
  'generated/interactive/dropdown-menu-demo/gallery-dropdown-menu-demo';
