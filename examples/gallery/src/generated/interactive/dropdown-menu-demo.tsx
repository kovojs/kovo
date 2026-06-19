// @kovojs-ir - lowered from examples/gallery/src/interactive/dropdown-menu-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryDropdownMenuDemo$DropdownMenu_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryDropdownMenuDemo$DropdownMenuTrigger_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryDropdownMenuDemo$DropdownMenuTrigger_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryDropdownMenuDemo$DropdownMenuContent_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryDropdownMenuDemo$DropdownMenuContent_hidden_derive = derive(
  ['state'],
  (state: any) => (!state.open ? '' : null),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'duplicate' ? '' : null),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_data_state_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'duplicate' ? 'active' : 'inactive'),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'duplicate' ? 0 : -1),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'rename' ? '' : null),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'rename' ? 'active' : 'inactive'),
);
export const GalleryDropdownMenuDemo$DropdownMenuItem_tabIndex_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'rename' ? 0 : -1),
);
export const GalleryDropdownMenuDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import type { DropdownMenuItem as GalleryDropdownMenuItem } from '@kovojs/headless-ui/dropdown-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kovojs/ui/dropdown-menu';

export interface GalleryDropdownMenuDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const dropdownItems: readonly GalleryDropdownMenuItem[] = Object.freeze([
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
      <DropdownMenu
        data-gallery-interactive="dropdown-menu"
        {...menuState}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenu_data_state_derive"
        kovo-state='{"highlightedValue":"duplicate","open":false,"value":"duplicate"}'
      >
        <DropdownMenuTrigger
          contentId={contentId}
          id="gallery-dropdown-menu-trigger"
          on:click="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuTrigger_click"
          on:keydown="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuTrigger_keydown"
          {...menuState}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuTrigger_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuTrigger_data_state_derive"
        >
          Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent
          id={contentId}
          {...menuState}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuContent_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuContent_hidden_derive"
        >
          <DropdownMenuItem
            id="gallery-dropdown-menu-duplicate"
            itemLabel="Duplicate"
            itemValue="duplicate"
            on:keydown="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_keydown"
            on:click="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_click"
            {...menuState}
            data-highlighted={state.highlightedValue === 'duplicate' ? '' : null}
            data-bind:data-highlighted="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_data_highlighted_derive"
            data-state={state.highlightedValue === 'duplicate' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_data_state_derive"
            tabIndex={state.highlightedValue === 'duplicate' ? 0 : -1}
            data-bind:tabIndex="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_tabIndex_derive"
          >
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            id="gallery-dropdown-menu-archive"
            itemDisabled={true}
            itemLabel="Archive"
            itemValue="archive"
            {...menuState}
          >
            Archive
          </DropdownMenuItem>
          <DropdownMenuItem
            id="gallery-dropdown-menu-rename"
            itemLabel="Rename"
            itemValue="rename"
            on:keydown="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_keydown_2"
            on:click="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_click_2"
            {...menuState}
            data-highlighted={state.highlightedValue === 'rename' ? '' : null}
            data-bind:data-highlighted="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_data_highlighted_derive_2"
            data-state={state.highlightedValue === 'rename' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_data_state_derive_2"
            tabIndex={state.highlightedValue === 'rename' ? 0 : -1}
            data-bind:tabIndex="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$DropdownMenuItem_tabIndex_derive_2"
          >
            Rename
          </DropdownMenuItem>
        </DropdownMenuContent>
        <output
          data-demo-state="dropdown-open"
          data-bind="/c/__v/e1298890/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js#GalleryDropdownMenuDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
        <output data-demo-state="dropdown-value" data-bind="state.value">
          {state.value}
        </output>
      </DropdownMenu>
    );
  },
});
GalleryDropdownMenuDemo.name =
  'generated/interactive/dropdown-menu-demo/gallery-dropdown-menu-demo';
