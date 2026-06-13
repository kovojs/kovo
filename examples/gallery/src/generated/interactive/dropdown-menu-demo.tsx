// @jiso-ir - lowered from examples/gallery/src/interactive/dropdown-menu-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  dropdownMenuContentAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuRootAttributes,
  dropdownMenuTriggerAttributes,
  type DropdownMenuItem,
} from '@jiso/headless-ui/primitives';

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
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryDropdownMenuDemo = component('gallery-dropdown-menu-demo', {
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
        {...dropdownMenuRootAttributes(menuState)}
        class="grid gap-2"
        data-gallery-interactive="dropdown-menu"
        fw-c="gallery-dropdown-menu-demo"
        fw-state='{"highlightedValue":"duplicate","open":false,"value":"duplicate"}'
      >
        <button
          {...dropdownMenuTriggerAttributes({ ...menuState, contentId })}
          id="gallery-dropdown-menu-trigger"
          on:click="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=2d7b7818#GalleryDropdownMenuDemo$button_click"
        >
          Actions
        </button>
        <div
          {...dropdownMenuContentAttributes({ ...menuState, id: contentId })}
          on:keydown="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=2d7b7818#GalleryDropdownMenuDemo$div_keydown"
        >
          <button
            {...dropdownMenuItemAttributes({
              ...menuState,
              id: 'gallery-dropdown-menu-duplicate',
              itemLabel: 'Duplicate',
              itemValue: 'duplicate',
            })}
            on:click="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=2d7b7818#GalleryDropdownMenuDemo$button_click_2"
          >
            Duplicate
          </button>
          <button
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
            {...dropdownMenuItemAttributes({
              ...menuState,
              id: 'gallery-dropdown-menu-rename',
              itemLabel: 'Rename',
              itemValue: 'rename',
            })}
            on:keydown="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=2d7b7818#GalleryDropdownMenuDemo$button_keydown"
            on:click="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=2d7b7818#GalleryDropdownMenuDemo$button_click_3"
          >
            Rename
          </button>
        </div>
        <output data-demo-state="dropdown-open">{state.open ? 'open' : 'closed'}</output>
        <output data-demo-state="dropdown-value">{state.value}</output>
      </section>
    );
  },
});
