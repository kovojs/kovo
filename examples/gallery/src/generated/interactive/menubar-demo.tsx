// @kovojs-ir - lowered from examples/gallery/src/interactive/menubar-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

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

import { component } from '@kovojs/core';
import {
  menubarItemAttributes,
  menubarRootAttributes,
  menubarSubmenuAttributes,
  type MenubarItem,
} from '@kovojs/headless-ui/menubar';
import { menubarClasses, menubarItemClasses, menubarSubmenuClasses } from '@kovojs/ui/menubar';

const ROOT_CLASS = menubarClasses.join(' ');
const ITEM_CLASS = menubarItemClasses.join(' ');
const SUBMENU_CLASS = menubarSubmenuClasses.join(' ');

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
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryMenubarDemo = component({
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
        on:keydown="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$section_keydown"
        data-open={state.openValue || 'none'}
        data-bind:data-open="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$section_data_open_derive"
        kovo-c="gallery-menubar-demo"
        kovo-state='{"activeValue":"file","openValue":"","value":"new"}'
      >
        <div class={ROOT_CLASS} {...menubarRootAttributes(rootState)}>
          <button
            class={ITEM_CLASS}
            on:click="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_click"
            on:keydown="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_keydown"
            {...menubarItemAttributes({
              ...rootState,
              contentId: 'gallery-menubar-file-menu',
              id: 'gallery-menubar-file',
              itemLabel: 'File',
              itemValue: 'file',
            })}
            aria-expanded={state.openValue === 'file' ? 'true' : 'false'}
            data-bind:aria-expanded="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_aria_expanded_derive"
            data-highlighted={state.activeValue === 'file' ? '' : null}
            data-bind:data-highlighted="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_data_highlighted_derive"
            data-state={state.activeValue === 'file' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_data_state_derive"
            tabIndex={state.activeValue === 'file' ? 0 : -1}
            data-bind:tabIndex="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_tabIndex_derive"
          >
            File
          </button>
          <button
            class={ITEM_CLASS}
            on:click="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_click_2"
            {...menubarItemAttributes({
              ...rootState,
              id: 'gallery-menubar-edit',
              itemLabel: 'Edit',
              itemValue: 'edit',
            })}
            data-highlighted={state.activeValue === 'edit' ? '' : null}
            data-bind:data-highlighted="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_data_highlighted_derive_2"
            data-state={state.activeValue === 'edit' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_data_state_derive_2"
            tabIndex={state.activeValue === 'edit' ? 0 : -1}
            data-bind:tabIndex="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_tabIndex_derive_2"
          >
            Edit
          </button>
        </div>
        <div
          class={SUBMENU_CLASS}
          {...menubarSubmenuAttributes({
            ...rootState,
            id: 'gallery-menubar-file-menu',
            labelledBy: 'gallery-menubar-file',
            value: 'file',
          })}
          data-state={state.openValue === 'file' ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$div_data_state_derive"
          hidden={state.openValue !== 'file'}
          data-bind:hidden="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$div_hidden_derive"
        >
          <button
            class={ITEM_CLASS}
            on:keydown="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_keydown_2"
            on:click="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_click_3"
            {...menubarItemAttributes({
              ...rootState,
              id: 'gallery-menubar-new',
              itemLabel: 'New file',
              itemParentValue: 'file',
              itemValue: 'new',
            })}
            data-highlighted={state.activeValue === 'new' ? '' : null}
            data-bind:data-highlighted="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_data_highlighted_derive_3"
            data-state={state.activeValue === 'new' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_data_state_derive_3"
            tabIndex={state.activeValue === 'new' ? 0 : -1}
            data-bind:tabIndex="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$button_tabIndex_derive_3"
          >
            New file
          </button>
          <button
            class={ITEM_CLASS}
            {...menubarItemAttributes({
              ...rootState,
              id: 'gallery-menubar-import',
              itemDisabled: true,
              itemLabel: 'Import',
              itemParentValue: 'file',
              itemValue: 'import',
            })}
          >
            Import
          </button>
        </div>
        <output data-demo-state="menubar-active" data-bind="state.activeValue">
          {state.activeValue}
        </output>
        <output
          data-demo-state="menubar-open"
          data-bind="/c/__v/7838d29c/examples/gallery/src/generated/interactive/menubar-demo.client.js#GalleryMenubarDemo$output_text_derive"
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
GalleryMenubarDemo.name = 'generated/interactive/menubar-demo/gallery-menubar-demo';
