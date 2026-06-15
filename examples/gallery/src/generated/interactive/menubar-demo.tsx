// @jiso-ir - lowered from examples/gallery/src/interactive/menubar-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryMenubarDemo$section_data_open_derive = derive(
  ['state'],
  (state: any) => state.openValue || 'none',
);
export const GalleryMenubarDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  state.openValue === 'file' ? 'true' : 'false',
);
export const GalleryMenubarDemo$button_data_highlighted_derive = derive(['state'], (state: any) =>
  state.activeValue === 'file' ? '' : null,
);
export const GalleryMenubarDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.activeValue === 'file' ? 'active' : 'inactive',
);
export const GalleryMenubarDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeValue === 'file' ? 0 : -1,
);
export const GalleryMenubarDemo$button_data_highlighted_derive_2 = derive(['state'], (state: any) =>
  state.activeValue === 'edit' ? '' : null,
);
export const GalleryMenubarDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.activeValue === 'edit' ? 'active' : 'inactive',
);
export const GalleryMenubarDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.activeValue === 'edit' ? 0 : -1,
);
export const GalleryMenubarDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.openValue === 'file' ? 'open' : 'closed',
);
export const GalleryMenubarDemo$div_hidden_derive = derive(['state'], (state: any) =>
  state.openValue !== 'file' ? '' : null,
);
export const GalleryMenubarDemo$button_data_highlighted_derive_3 = derive(['state'], (state: any) =>
  state.activeValue === 'new' ? '' : null,
);
export const GalleryMenubarDemo$button_data_state_derive_3 = derive(['state'], (state: any) =>
  state.activeValue === 'new' ? 'active' : 'inactive',
);
export const GalleryMenubarDemo$button_tabIndex_derive_3 = derive(['state'], (state: any) =>
  state.activeValue === 'new' ? 0 : -1,
);
export const GalleryMenubarDemo$output_text_derive = derive(
  ['state'],
  (state: any) => state.openValue || 'none',
);

import { component } from '@jiso/core';
import {
  menubarFocusElement as _menubarFocusElement,
  menubarItemAttributes,
  menubarItemClick as _menubarItemClick,
  menubarItemKeyDown as _menubarItemKeyDown,
  menubarKeyDown as _menubarKeyDown,
  menubarMove as _menubarMove,
  menubarRootAttributes,
  menubarSubmenuAttributes,
  menubarSubmenuTriggerClick as _menubarSubmenuTriggerClick,
  menubarTypeahead as _menubarTypeahead,
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
        data-open={state.openValue || 'none'}
        data-bind:data-open="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$section_data_open_derive"
        on:keydown="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$section_keydown"
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
            aria-expanded={state.openValue === 'file' ? 'true' : 'false'}
            data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_aria_expanded_derive"
            class={ITEM_CLASS}
            data-highlighted={state.activeValue === 'file' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_data_highlighted_derive"
            data-state={state.activeValue === 'file' ? 'active' : 'inactive'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_data_state_derive"
            tabIndex={state.activeValue === 'file' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_tabIndex_derive"
            on:click="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_click"
            on:keydown="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_keydown"
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
            data-highlighted={state.activeValue === 'edit' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_data_highlighted_derive_2"
            data-state={state.activeValue === 'edit' ? 'active' : 'inactive'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_data_state_derive_2"
            tabIndex={state.activeValue === 'edit' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_tabIndex_derive_2"
            on:click="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_click_2"
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
          data-state={state.openValue === 'file' ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$div_data_state_derive"
          hidden={state.openValue !== 'file'}
          data-bind:hidden="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$div_hidden_derive"
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
            data-highlighted={state.activeValue === 'new' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_data_highlighted_derive_3"
            data-state={state.activeValue === 'new' ? 'active' : 'inactive'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_data_state_derive_3"
            tabIndex={state.activeValue === 'new' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_tabIndex_derive_3"
            on:keydown="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_keydown_2"
            on:click="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$button_click_3"
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
          data-bind="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=676d9617#GalleryMenubarDemo$output_text_derive"
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
