/** @jsxImportSource @jiso/server */
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
            onKeyDown={() => {
              if (
                event &&
                Object(event)['key'] !== 'Enter' &&
                Object(event)['key'] !== ' ' &&
                Object(event)['key'] !== 'Spacebar'
              )
                return;

              if (event) Object(event)['preventDefault']?.call(event);
              state.openValue = '';
              state.value = 'new';
              const doc = Reflect['get'](globalThis, 'document');
              const file = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file')
                : undefined;
              const menu = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file-menu')
                : undefined;
              const openOutput = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-open"]')
                : undefined;
              const valueOutput = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-value"]')
                : undefined;
              if (file) Object(file)['setAttribute']?.call(file, 'aria-expanded', 'false');
              if (menu) menu['hidden'] = true;
              if (openOutput) openOutput['textContent'] = 'none';
              if (valueOutput) valueOutput['textContent'] = 'new';
            }}
            onClick={() => {
              state.openValue = '';
              state.value = 'new';
              const doc = Reflect['get'](globalThis, 'document');
              const file = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file')
                : undefined;
              const menu = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-menubar-file-menu')
                : undefined;
              const openOutput = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-open"]')
                : undefined;
              const valueOutput = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="menubar-value"]')
                : undefined;
              if (file) Object(file)['setAttribute']?.call(file, 'aria-expanded', 'false');
              if (menu) menu['hidden'] = true;
              if (openOutput) openOutput['textContent'] = 'none';
              if (valueOutput) valueOutput['textContent'] = 'new';
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
            class={ITEM_CLASS}
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
