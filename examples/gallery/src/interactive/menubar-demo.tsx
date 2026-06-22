/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  menubarFocusElement as _menubarFocusElement,
  menubarItemClick as _menubarItemClick,
  menubarItemKeyDown as _menubarItemKeyDown,
  menubarKeyDown as _menubarKeyDown,
  menubarMove as _menubarMove,
  menubarSubmenuTriggerClick as _menubarSubmenuTriggerClick,
  menubarTypeahead as _menubarTypeahead,
  type MenubarItem as GalleryMenubarItem,
} from '@kovojs/headless-ui/menubar';
import { Menubar, MenubarItem, MenubarSubmenu } from '@kovojs/ui/menubar';

export interface GalleryMenubarDemoState {
  activeValue: string;
  openValue: string;
  value: string;
}

const menubarItems: readonly GalleryMenubarItem[] = Object.freeze([
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
        style="display:grid;gap:0.5rem"
        data-gallery-interactive="menubar"
        data-open={state.openValue || 'none'}
        onKeyDown={() => {
          const keyResult = _menubarKeyDown(Object(event), {
            activeValue: state.activeValue,
            items: [
              { hasPopup: true, label: 'File', value: 'file' },
              { label: 'Edit', value: 'edit' },
              { label: 'New file', parentValue: 'file', value: 'new' },
              { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
            ],
            ...(state.openValue === '' ? {} : { openValue: state.openValue }),
          });
          if (keyResult?.changed) {
            state.openValue = keyResult.openValue ?? '';
            if (Object(event).key === 'Escape') {
              state.activeValue = 'file';
              _menubarFocusElement(Object(event), 'gallery-menubar-file');
            } else if (state.activeValue === 'file') {
              state.activeValue = 'new';
              _menubarFocusElement(Object(event), 'gallery-menubar-new', { defer: true });
            }
            return;
          }

          const move = _menubarMove(
            {
              activeValue: state.activeValue,
              items: [
                { hasPopup: true, label: 'File', value: 'file' },
                { label: 'Edit', value: 'edit' },
                { label: 'New file', parentValue: 'file', value: 'new' },
                { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
              ],
              ...(state.openValue === '' ? {} : { openValue: state.openValue }),
            },
            Object(event).key,
            { loop: true },
          );
          if (move) {
            Object(event).preventDefault?.();
            state.activeValue = move.activeValue ?? state.activeValue;
            if (state.openValue !== '')
              state.openValue = state.activeValue === 'file' ? 'file' : '';
            _menubarFocusElement(
              Object(event),
              state.activeValue === 'edit' ? 'gallery-menubar-edit' : 'gallery-menubar-file',
            );
            return;
          }

          const typeahead = _menubarTypeahead(
            {
              activeValue: state.activeValue,
              items: [
                { hasPopup: true, label: 'File', value: 'file' },
                { label: 'Edit', value: 'edit' },
                { label: 'New file', parentValue: 'file', value: 'new' },
                { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
              ],
              ...(state.openValue === '' ? {} : { openValue: state.openValue }),
            },
            Object(event).key,
            { loop: true, now: 0 },
          );
          if (typeahead.activeValue === state.activeValue) return;
          Object(event).preventDefault?.();
          state.activeValue = typeahead.activeValue ?? state.activeValue;
          if (state.openValue !== '') state.openValue = state.activeValue === 'file' ? 'file' : '';
          _menubarFocusElement(
            Object(event),
            state.activeValue === 'edit' ? 'gallery-menubar-edit' : 'gallery-menubar-file',
          );
        }}
      >
        {/* Positioned anchor: the submenu is rendered position:absolute, so wrap
            the trigger Menubar + its dropdown in a position:relative,
            inline-block box so the menu anchors to the trigger instead of the
            viewport (and no longer covers the button). */}
        <div style="position:relative;display:inline-block">
        <Menubar {...rootState}>
          <MenubarItem
            {...rootState}
            aria-expanded={state.openValue === 'file' ? 'true' : 'false'}
            contentId="gallery-menubar-file-menu"
            data-highlighted={state.activeValue === 'file' ? '' : null}
            data-state={state.activeValue === 'file' ? 'active' : 'inactive'}
            id="gallery-menubar-file"
            itemLabel="File"
            itemValue="file"
            onClick={() => {
              const result = _menubarSubmenuTriggerClick(Object(event), {
                activeValue: state.activeValue,
                contentId: 'gallery-menubar-file-menu',
                itemValue: 'file',
                items: [
                  { hasPopup: true, label: 'File', value: 'file' },
                  { label: 'Edit', value: 'edit' },
                  { label: 'New file', parentValue: 'file', value: 'new' },
                  { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                ],
                ...(state.openValue === '' ? {} : { openValue: state.openValue }),
              });
              if (!result?.changed) return;
              state.openValue = result.openValue ?? '';
              state.activeValue = result.openValue === 'file' ? 'new' : 'file';
              if (result.openValue === 'file')
                _menubarFocusElement(Object(event), 'gallery-menubar-new', { defer: true });
            }}
            onKeyDown={() => {
              if (
                Object(event).key !== 'Enter' &&
                Object(event).key !== ' ' &&
                Object(event).key !== 'Spacebar'
              )
                return;

              const result = _menubarSubmenuTriggerClick(Object(event), {
                activeValue: state.activeValue,
                contentId: 'gallery-menubar-file-menu',
                itemValue: 'file',
                items: [
                  { hasPopup: true, label: 'File', value: 'file' },
                  { label: 'Edit', value: 'edit' },
                  { label: 'New file', parentValue: 'file', value: 'new' },
                  { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                ],
                ...(state.openValue === '' ? {} : { openValue: state.openValue }),
              });
              if (!result?.changed) return;
              Object(event).preventDefault?.();
              state.openValue = result.openValue ?? '';
              state.activeValue = result.openValue === 'file' ? 'new' : 'file';
              if (result.openValue === 'file')
                _menubarFocusElement(Object(event), 'gallery-menubar-new', { defer: true });
            }}
            tabIndex={state.activeValue === 'file' ? 0 : -1}
          >
            File
          </MenubarItem>
          <MenubarItem
            {...rootState}
            data-highlighted={state.activeValue === 'edit' ? '' : null}
            data-state={state.activeValue === 'edit' ? 'active' : 'inactive'}
            id="gallery-menubar-edit"
            itemLabel="Edit"
            itemValue="edit"
            onClick={() => {
              state.activeValue = 'edit';
              state.openValue = '';
            }}
            tabIndex={state.activeValue === 'edit' ? 0 : -1}
          >
            Edit
          </MenubarItem>
        </Menubar>
        <MenubarSubmenu
          {...rootState}
          data-state={state.openValue === 'file' ? 'open' : 'closed'}
          hidden={state.openValue !== 'file'}
          id="gallery-menubar-file-menu"
          labelledBy="gallery-menubar-file"
          value="file"
        >
          <MenubarItem
            {...rootState}
            data-highlighted={state.activeValue === 'new' ? '' : null}
            data-state={state.activeValue === 'new' ? 'active' : 'inactive'}
            id="gallery-menubar-new"
            itemLabel="New file"
            itemParentValue="file"
            itemValue="new"
            onKeyDown={() => {
              const result = _menubarItemKeyDown(Object(event), {
                activeValue: state.activeValue,
                itemParentValue: 'file',
                itemValue: 'new',
                items: [
                  { hasPopup: true, label: 'File', value: 'file' },
                  { label: 'Edit', value: 'edit' },
                  { label: 'New file', parentValue: 'file', value: 'new' },
                  { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                ],
                ...(state.openValue === '' ? {} : { openValue: state.openValue }),
              });
              if (result?.selected) {
                state.openValue = result.open.openValue ?? '';
                state.activeValue = 'file';
                state.value = result.value;
                _menubarFocusElement(Object(event), 'gallery-menubar-file');
                return;
              }

              const keyResult = _menubarKeyDown(Object(event), {
                activeValue: state.activeValue,
                items: [
                  { hasPopup: true, label: 'File', value: 'file' },
                  { label: 'Edit', value: 'edit' },
                  { label: 'New file', parentValue: 'file', value: 'new' },
                  { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                ],
                ...(state.openValue === '' ? {} : { openValue: state.openValue }),
              });
              if (keyResult?.changed) {
                state.openValue = keyResult.openValue ?? '';
                state.activeValue = 'file';
                _menubarFocusElement(Object(event), 'gallery-menubar-file');
                return;
              }

              const move = _menubarMove(
                {
                  activeValue: state.activeValue,
                  items: [
                    { hasPopup: true, label: 'File', value: 'file' },
                    { label: 'Edit', value: 'edit' },
                    { label: 'New file', parentValue: 'file', value: 'new' },
                    { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                  ],
                  ...(state.openValue === '' ? {} : { openValue: state.openValue }),
                },
                Object(event).key,
                { loop: true, parentValue: 'file' },
              );
              if (move) {
                Object(event).preventDefault?.();
                state.activeValue = move.activeValue ?? state.activeValue;
                _menubarFocusElement(Object(event), 'gallery-menubar-new');
                return;
              }

              const typeahead = _menubarTypeahead(
                {
                  activeValue: state.activeValue,
                  items: [
                    { hasPopup: true, label: 'File', value: 'file' },
                    { label: 'Edit', value: 'edit' },
                    { label: 'New file', parentValue: 'file', value: 'new' },
                    { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                  ],
                  ...(state.openValue === '' ? {} : { openValue: state.openValue }),
                },
                Object(event).key,
                { loop: true, now: 0, parentValue: 'file' },
              );
              if (typeahead.activeValue === state.activeValue) return;
              Object(event).preventDefault?.();
              state.activeValue = typeahead.activeValue ?? state.activeValue;
              _menubarFocusElement(Object(event), 'gallery-menubar-new');
            }}
            onClick={() => {
              const result = _menubarItemClick(Object(event), {
                activeValue: state.activeValue,
                itemParentValue: 'file',
                itemValue: 'new',
                items: [
                  { hasPopup: true, label: 'File', value: 'file' },
                  { label: 'Edit', value: 'edit' },
                  { label: 'New file', parentValue: 'file', value: 'new' },
                  { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                ],
                ...(state.openValue === '' ? {} : { openValue: state.openValue }),
              });
              if (!result?.selected) return;
              state.openValue = result.open.openValue ?? '';
              state.activeValue = 'file';
              state.value = result.value;
              _menubarFocusElement(Object(event), 'gallery-menubar-file');
            }}
            tabIndex={state.activeValue === 'new' ? 0 : -1}
          >
            New file
          </MenubarItem>
          <MenubarItem
            {...rootState}
            id="gallery-menubar-import"
            itemDisabled={true}
            itemLabel="Import"
            itemParentValue="file"
            itemValue="import"
          >
            Import
          </MenubarItem>
        </MenubarSubmenu>
        </div>
        <output
          data-demo-state="menubar-active"
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
        >
          {state.activeValue}
        </output>
        <output
          data-demo-state="menubar-open"
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
        >
          {state.openValue || 'none'}
        </output>
        <output
          data-demo-state="menubar-value"
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
        >
          {state.value}
        </output>
      </section>
    );
  },
});
