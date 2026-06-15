// @jiso-ir - lowered from examples/gallery/src/interactive/dropdown-menu-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryDropdownMenuDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@jiso/core';
import {
  dropdownMenuContentAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuRootAttributes,
  dropdownMenuTriggerAttributes,
  type DropdownMenuItem,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/dropdown-menu.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'min-w-40 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-md outline-none data-[state=closed]:hidden';
const ITEM_CLASS =
  'flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

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
          class={TRIGGER_CLASS}
          id="gallery-dropdown-menu-trigger"
          on:click="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=ae55f97b#GalleryDropdownMenuDemo$button_click"
        >
          Actions
        </button>
        <div
          {...dropdownMenuContentAttributes({ ...menuState, id: contentId })}
          class={CONTENT_CLASS}
          on:keydown="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=ae55f97b#GalleryDropdownMenuDemo$div_keydown"
        >
          <button
            {...dropdownMenuItemAttributes({
              ...menuState,
              id: 'gallery-dropdown-menu-duplicate',
              itemLabel: 'Duplicate',
              itemValue: 'duplicate',
            })}
            class={ITEM_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=ae55f97b#GalleryDropdownMenuDemo$button_click_2"
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
            class={ITEM_CLASS}
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
            class={ITEM_CLASS}
            on:keydown="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=ae55f97b#GalleryDropdownMenuDemo$button_keydown"
            on:click="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=ae55f97b#GalleryDropdownMenuDemo$button_click_3"
          >
            Rename
          </button>
        </div>
        <output
          data-demo-state="dropdown-open"
          data-bind="/c/examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js?v=ae55f97b#GalleryDropdownMenuDemo$output_text_derive"
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
