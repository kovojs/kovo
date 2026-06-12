// @jiso-ir - lowered from examples/gallery/src/interactive/menubar-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  menubarItemAttributes,
  menubarRootAttributes,
  menubarSubmenuAttributes,
  type MenubarItem,
} from '@jiso/headless-ui/primitives';

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
        {...menubarRootAttributes(rootState)}
        class="grid gap-2"
        data-gallery-interactive="menubar"
        on:keydown="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=ecf10a63#GalleryMenubarDemo$section_keydown"
        fw-c="gallery-menubar-demo"
        fw-state='{"activeValue":"file","openValue":"","value":"new"}'
      >
        <button
          {...menubarItemAttributes({
            ...rootState,
            contentId: 'gallery-menubar-file-menu',
            id: 'gallery-menubar-file',
            itemLabel: 'File',
            itemValue: 'file',
          })}
          on:click="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=ecf10a63#GalleryMenubarDemo$button_click"
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
        >
          Edit
        </button>
        <div
          {...menubarSubmenuAttributes({
            ...rootState,
            id: 'gallery-menubar-file-menu',
            labelledBy: 'gallery-menubar-file',
            value: 'file',
          })}
        >
          <button
            {...menubarItemAttributes({
              ...rootState,
              id: 'gallery-menubar-new',
              itemLabel: 'New file',
              itemParentValue: 'file',
              itemValue: 'new',
            })}
            on:click="/c/examples/gallery/src/generated/interactive/menubar-demo.client.js?v=ecf10a63#GalleryMenubarDemo$button_click_2"
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
          >
            Import
          </button>
        </div>
        <output data-demo-state="menubar-active">{state.activeValue}</output>
        <output data-demo-state="menubar-open">{state.openValue || 'none'}</output>
        <output data-demo-state="menubar-value">{state.value}</output>
      </section>
    );
  },
});
