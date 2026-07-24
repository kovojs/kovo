/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  browserEventKey as _browserEventKey,
  browserEventPreventDefault as _browserEventPreventDefault,
  menubarFocusElement as _menubarFocusElement,
  menubarItemClick as _menubarItemClick,
  menubarItemKeyDown as _menubarItemKeyDown,
  menubarKeyDown as _menubarKeyDown,
  menubarMove as _menubarMove,
  menubarSubmenuTriggerClick as _menubarSubmenuTriggerClick,
  menubarTypeahead as _menubarTypeahead,
  type MenubarItem as GalleryMenubarItem,
} from '../primitive-actions.js';
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
      openValue: state.openValue || undefined,
    };

    return (
      <section
        style="display:grid;gap:0.5rem"
        data-gallery-interactive="menubar"
        data-open={state.openValue || 'none'}
        onKeyDown={() => {
          const keyResult = _menubarKeyDown(event! as never, {
            activeValue: state.activeValue,
            items: [
              { hasPopup: true, label: 'File', value: 'file' },
              { label: 'Edit', value: 'edit' },
              { label: 'New file', parentValue: 'file', value: 'new' },
              { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
            ],
            openValue: state.openValue || undefined,
          });
          if (keyResult?.changed) {
            state.openValue = keyResult.openValue ?? '';
            if (_browserEventKey(event! as never) === 'Escape') {
              state.activeValue = 'file';
              _menubarFocusElement(event! as never, 'gallery-menubar-file');
            } else if (state.activeValue === 'file') {
              state.activeValue = 'new';
              _menubarFocusElement(event! as never, 'gallery-menubar-new', { defer: true });
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
              openValue: state.openValue || undefined,
            },
            _browserEventKey(event! as never),
            { loop: true },
          );
          if (move) {
            _browserEventPreventDefault(event! as never);
            state.activeValue = move.activeValue ?? state.activeValue;
            if (state.openValue !== '')
              state.openValue = state.activeValue === 'file' ? 'file' : '';
            _menubarFocusElement(
              event! as never,
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
              openValue: state.openValue || undefined,
            },
            _browserEventKey(event! as never),
            { loop: true, now: 0 },
          );
          if (typeahead.activeValue === state.activeValue) return;
          _browserEventPreventDefault(event! as never);
          state.activeValue = typeahead.activeValue ?? state.activeValue;
          if (state.openValue !== '') state.openValue = state.activeValue === 'file' ? 'file' : '';
          _menubarFocusElement(
            event! as never,
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
                const result = _menubarSubmenuTriggerClick(event! as never, {
                  activeValue: state.activeValue,
                  contentId: 'gallery-menubar-file-menu',
                  itemValue: 'file',
                  items: [
                    { hasPopup: true, label: 'File', value: 'file' },
                    { label: 'Edit', value: 'edit' },
                    { label: 'New file', parentValue: 'file', value: 'new' },
                    { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                  ],
                  openValue: state.openValue || undefined,
                });
                if (!result?.changed) return;
                state.openValue = result.openValue ?? '';
                state.activeValue = result.openValue === 'file' ? 'new' : 'file';
                if (result.openValue === 'file')
                  _menubarFocusElement(event! as never, 'gallery-menubar-new', { defer: true });
              }}
              onKeyDown={() => {
                if (
                  _browserEventKey(event! as never) !== 'Enter' &&
                  _browserEventKey(event! as never) !== ' ' &&
                  _browserEventKey(event! as never) !== 'Spacebar'
                )
                  return;

                const result = _menubarSubmenuTriggerClick(event! as never, {
                  activeValue: state.activeValue,
                  contentId: 'gallery-menubar-file-menu',
                  itemValue: 'file',
                  items: [
                    { hasPopup: true, label: 'File', value: 'file' },
                    { label: 'Edit', value: 'edit' },
                    { label: 'New file', parentValue: 'file', value: 'new' },
                    { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                  ],
                  openValue: state.openValue || undefined,
                });
                if (!result?.changed) return;
                _browserEventPreventDefault(event! as never);
                state.openValue = result.openValue ?? '';
                state.activeValue = result.openValue === 'file' ? 'new' : 'file';
                if (result.openValue === 'file')
                  _menubarFocusElement(event! as never, 'gallery-menubar-new', { defer: true });
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
                const result = _menubarItemKeyDown(event! as never, {
                  activeValue: state.activeValue,
                  itemParentValue: 'file',
                  itemValue: 'new',
                  items: [
                    { hasPopup: true, label: 'File', value: 'file' },
                    { label: 'Edit', value: 'edit' },
                    { label: 'New file', parentValue: 'file', value: 'new' },
                    { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                  ],
                  openValue: state.openValue || undefined,
                });
                if (result?.selected) {
                  state.openValue = result.open.openValue ?? '';
                  state.activeValue = 'file';
                  state.value = result.value;
                  _menubarFocusElement(event! as never, 'gallery-menubar-file');
                  return;
                }

                const keyResult = _menubarKeyDown(event! as never, {
                  activeValue: state.activeValue,
                  items: [
                    { hasPopup: true, label: 'File', value: 'file' },
                    { label: 'Edit', value: 'edit' },
                    { label: 'New file', parentValue: 'file', value: 'new' },
                    { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                  ],
                  openValue: state.openValue || undefined,
                });
                if (keyResult?.changed) {
                  state.openValue = keyResult.openValue ?? '';
                  state.activeValue = 'file';
                  _menubarFocusElement(event! as never, 'gallery-menubar-file');
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
                    openValue: state.openValue || undefined,
                  },
                  _browserEventKey(event! as never),
                  { loop: true, parentValue: 'file' },
                );
                if (move) {
                  _browserEventPreventDefault(event! as never);
                  state.activeValue = move.activeValue ?? state.activeValue;
                  _menubarFocusElement(event! as never, 'gallery-menubar-new');
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
                    openValue: state.openValue || undefined,
                  },
                  _browserEventKey(event! as never),
                  { loop: true, now: 0, parentValue: 'file' },
                );
                if (typeahead.activeValue === state.activeValue) return;
                _browserEventPreventDefault(event! as never);
                state.activeValue = typeahead.activeValue ?? state.activeValue;
                _menubarFocusElement(event! as never, 'gallery-menubar-new');
              }}
              onClick={() => {
                const result = _menubarItemClick(event! as never, {
                  activeValue: state.activeValue,
                  itemParentValue: 'file',
                  itemValue: 'new',
                  items: [
                    { hasPopup: true, label: 'File', value: 'file' },
                    { label: 'Edit', value: 'edit' },
                    { label: 'New file', parentValue: 'file', value: 'new' },
                    { disabled: true, label: 'Import', parentValue: 'file', value: 'import' },
                  ],
                  openValue: state.openValue || undefined,
                });
                if (!result?.selected) return;
                state.openValue = result.open.openValue ?? '';
                state.activeValue = 'file';
                state.value = result.value;
                _menubarFocusElement(event! as never, 'gallery-menubar-file');
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
