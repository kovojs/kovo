// @jiso-ir - lowered from examples/gallery/src/interactive/menubar-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryMenubarDemo$output_text_derive = derive(
  ['state'],
  (state) => state.openValue || 'none',
);

import { component } from '@jiso/core';
import {
  menubarItemAttributes,
  menubarRootAttributes,
  menubarSubmenuAttributes,
  type MenubarItem,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/menubar.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'inline-flex rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-sm data-[orientation=vertical]:flex-col data-[disabled]:opacity-50';
const ITEM_CLASS =
  'inline-flex h-8 items-center rounded px-2.5 text-sm text-neutral-700 outline-none data-[state=open]:bg-neutral-100 data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const SUBMENU_CLASS =
  'min-w-40 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-md outline-none data-[state=closed]:hidden';

export interface GalleryMenubarDemoState {
  activeValue: string;
  openValue: string;
  value: string;
}

const menubarItems: readonly MenubarItem[] = Object.freeze([
  { hasPopup: true, label: 'File', value: 'file' },
  { label: 'Edit', value: 'edit' },
  { label: 'New file', parentValue: 'file', value: 'new' },
  { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryMenubarDemo = component('gallery-menubar-demo', {
  state: () => ({ activeValue: 'file', openValue: '', value: 'new' }),
  render: (_queries: Record<string, never>, state: GalleryMenubarDemoState) => {
    const rootState = {
      activeValue: state.activeValue,
      items: menubarItems,
      label: 'Document commands',
      ...(state.openValue === '' ? {} : { openValue: state.openValue }),
    };

    return (
      <section
        class="grid gap-2"
        data-gallery-interactive="menubar"
        on:keydown="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=32f6984a#GalleryMenubarDemo$section_keydown"
        fw-c="gallery-menubar-demo"
        fw-state='{"activeValue":"file","openValue":"","value":"new"}'
      >
        <div {...menubarRootAttributes(rootState)} class={ROOT_CLASS}>
          <button
            {...menubarItemAttributes({
              ...rootState,
              contentId: 'gallery-menubar-file-menu',
              id: 'gallery-menubar-file',
              itemLabel: 'File',
              itemValue: 'file',
            })}
            class={ITEM_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=32f6984a#GalleryMenubarDemo$button_click"
          >
            File
          </button>
          <button
            {...menubarItemAttributes({
              ...rootState,
              id: 'gallery-menubar-edit',
              itemLabel: 'Edit',
              itemValue: 'edit',
            })}
            class={ITEM_CLASS}
          >
            Edit
          </button>
        </div>
        <div
          {...menubarSubmenuAttributes({
            ...rootState,
            id: 'gallery-menubar-file-menu',
            labelledBy: 'gallery-menubar-file',
            value: 'file',
          })}
          class={SUBMENU_CLASS}
        >
          <button
            {...menubarItemAttributes({
              ...rootState,
              id: 'gallery-menubar-new',
              itemLabel: 'New file',
              itemParentValue: 'file',
              itemValue: 'new',
            })}
            class={ITEM_CLASS}
            on:keydown="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=32f6984a#GalleryMenubarDemo$button_keydown"
            on:click="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=32f6984a#GalleryMenubarDemo$button_click_2"
          >
            New file
          </button>
          <button
            {...menubarItemAttributes({
              ...rootState,
              id: 'gallery-menubar-import',
              itemDisabled: true,
              itemLabel: 'Import',
              itemParentValue: 'file',
              itemValue: 'import',
            })}
            class={ITEM_CLASS}
          >
            Import
          </button>
        </div>
        <output data-demo-state="menubar-active" data-bind="state.activeValue">
          {state.activeValue}
        </output>
        <output
          data-demo-state="menubar-open"
          data-bind="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=32f6984a#GalleryMenubarDemo$output_text_derive"
        >
          {state.openValue || 'none'}
        </output>
        <output data-demo-state="menubar-value" data-bind="state.value">
          {state.value}
        </output>
      </section>
    );
  },
});
