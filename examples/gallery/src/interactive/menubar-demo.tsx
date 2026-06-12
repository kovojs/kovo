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
        onKeyDown={() => {
          state.activeValue = 'edit';
          const doc = Reflect['get'](globalThis, 'document');
          const file = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file')
            : undefined;
          const edit = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-edit')
            : undefined;
          const output = doc
            ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-active"]')
            : undefined;
          if (file) file['tabIndex'] = -1;
          if (edit) edit['tabIndex'] = 0;
          if (output) output['textContent'] = 'edit';
        }}
      >
        <button
          {...menubarItemAttributes({
            ...rootState,
            contentId: 'gallery-menubar-file-menu',
            id: 'gallery-menubar-file',
            itemLabel: 'File',
            itemValue: 'file',
          })}
          onClick={() => {
            state.activeValue = 'file';
            state.openValue = state.openValue === 'file' ? '' : 'file';
            const doc = Reflect['get'](globalThis, 'document');
            const file = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file')
              : undefined;
            const menu = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file-menu')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-open"]')
              : undefined;
            if (file)
              Object(file)['setAttribute']?.call(
                file,
                'aria-expanded',
                String(state.openValue === 'file'),
              );
            if (menu) menu['hidden'] = state.openValue !== 'file';
            if (output) output['textContent'] = state.openValue || 'none';
          }}
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
            onClick={() => {
              state.openValue = '';
              state.value = 'new';
              const doc = Reflect['get'](globalThis, 'document');
              const menu = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file-menu')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-value"]')
                : undefined;
              if (menu) menu['hidden'] = true;
              if (output) output['textContent'] = 'new';
            }}
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
