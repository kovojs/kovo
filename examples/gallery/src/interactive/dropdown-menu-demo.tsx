/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  dropdownMenuFocusElement as _dropdownMenuFocusElement,
  DropdownMenuItem,
  dropdownMenuItemClick as _dropdownMenuItemClick,
  dropdownMenuItemKeyDown as _dropdownMenuItemKeyDown,
  dropdownMenuKeyDown as _dropdownMenuKeyDown,
  dropdownMenuMove as _dropdownMenuMove,
  DropdownMenuTrigger,
  dropdownMenuTriggerClick as _dropdownMenuTriggerClick,
  dropdownMenuTriggerKeyDown as _dropdownMenuTriggerKeyDown,
  dropdownMenuTypeahead as _dropdownMenuTypeahead,
  type DropdownMenuItem as GalleryDropdownMenuItem,
} from '@kovojs/ui/dropdown-menu';

export interface GalleryDropdownMenuDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const dropdownItems: readonly GalleryDropdownMenuItem[] = Object.freeze([
  { label: 'Duplicate', value: 'duplicate' },
  { disabled: true, label: 'Archive', value: 'archive' },
  { label: 'Rename', value: 'rename' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDropdownMenuDemo = component({
  state: () => ({ highlightedValue: 'duplicate', open: false, value: 'duplicate' }),
  render: (_queries: Record<string, never>, state: GalleryDropdownMenuDemoState) => {
    const contentId = 'gallery-dropdown-menu-content';
    const menuState = {
      highlightedValue: state.highlightedValue,
      items: dropdownItems,
      open: state.open,
    };

    return (
      <DropdownMenu
        {...menuState}
        data-gallery-interactive="dropdown-menu"
        data-state={state.open ? 'open' : 'closed'}
      >
        <DropdownMenuTrigger
          {...menuState}
          aria-expanded={state.open ? 'true' : 'false'}
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
          id="gallery-dropdown-menu-trigger"
          onClick={() => {
            const result = _dropdownMenuTriggerClick(Object(event), {
              highlightedValue: state.highlightedValue,
              items: [
                { label: 'Duplicate', value: 'duplicate' },
                { disabled: true, label: 'Archive', value: 'archive' },
                { label: 'Rename', value: 'rename' },
              ],
              open: state.open,
            });
            if (!result?.changed) return;
            state.open = result.open;
            state.highlightedValue = 'duplicate';
            if (result.open)
              _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-duplicate', {
                defer: true,
              });
          }}
          onKeyDown={() => {
            const result = _dropdownMenuTriggerKeyDown(Object(event), {
              highlightedValue: state.highlightedValue,
              items: [
                { label: 'Duplicate', value: 'duplicate' },
                { disabled: true, label: 'Archive', value: 'archive' },
                { label: 'Rename', value: 'rename' },
              ],
              open: state.open,
            });
            if (!result?.changed) return;
            state.open = result.open;
            state.highlightedValue = Object(event).key === 'ArrowUp' ? 'rename' : 'duplicate';
            if (result.open) {
              _dropdownMenuFocusElement(
                Object(event),
                state.highlightedValue === 'rename'
                  ? 'gallery-dropdown-menu-rename'
                  : 'gallery-dropdown-menu-duplicate',
                { defer: true },
              );
            }
          }}
        >
          Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent
          {...menuState}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
          id={contentId}
        >
          <DropdownMenuItem
            {...menuState}
            data-highlighted={state.highlightedValue === 'duplicate' ? '' : null}
            data-state={state.highlightedValue === 'duplicate' ? 'active' : 'inactive'}
            id="gallery-dropdown-menu-duplicate"
            itemLabel="Duplicate"
            itemValue="duplicate"
            onKeyDown={() => {
              const result = _dropdownMenuItemKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                itemValue: 'duplicate',
                items: [
                  { label: 'Duplicate', value: 'duplicate' },
                  { disabled: true, label: 'Archive', value: 'archive' },
                  { label: 'Rename', value: 'rename' },
                ],
                open: state.open,
              });
              if (result?.selected) {
                state.open = result.open.open;
                state.highlightedValue = result.value;
                state.value = result.value;
                _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
                return;
              }

              const keyResult = _dropdownMenuKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  { label: 'Duplicate', value: 'duplicate' },
                  { disabled: true, label: 'Archive', value: 'archive' },
                  { label: 'Rename', value: 'rename' },
                ],
                open: state.open,
              });
              if (keyResult?.changed) {
                state.open = keyResult.open;
                if (!keyResult.open)
                  _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
                return;
              }

              const move = _dropdownMenuMove(
                {
                  highlightedValue: state.highlightedValue,
                  items: [
                    { label: 'Duplicate', value: 'duplicate' },
                    { disabled: true, label: 'Archive', value: 'archive' },
                    { label: 'Rename', value: 'rename' },
                  ],
                  open: state.open,
                },
                Object(event).key,
                { loop: true },
              );
              if (move) {
                Object(event).preventDefault?.();
                state.highlightedValue = move.highlightedValue ?? state.highlightedValue;
                _dropdownMenuFocusElement(
                  Object(event),
                  state.highlightedValue === 'rename'
                    ? 'gallery-dropdown-menu-rename'
                    : 'gallery-dropdown-menu-duplicate',
                );
                return;
              }

              const typeahead = _dropdownMenuTypeahead(
                {
                  highlightedValue: state.highlightedValue,
                  items: [
                    { label: 'Duplicate', value: 'duplicate' },
                    { disabled: true, label: 'Archive', value: 'archive' },
                    { label: 'Rename', value: 'rename' },
                  ],
                  open: state.open,
                },
                Object(event).key,
                { now: 0, loop: true },
              );
              if (typeahead.highlightedValue === state.highlightedValue) return;
              Object(event).preventDefault?.();
              state.highlightedValue = typeahead.highlightedValue ?? state.highlightedValue;
              _dropdownMenuFocusElement(
                Object(event),
                state.highlightedValue === 'rename'
                  ? 'gallery-dropdown-menu-rename'
                  : 'gallery-dropdown-menu-duplicate',
              );
            }}
            onClick={() => {
              const result = _dropdownMenuItemClick(Object(event), {
                highlightedValue: state.highlightedValue,
                itemValue: 'duplicate',
                items: [
                  { label: 'Duplicate', value: 'duplicate' },
                  { disabled: true, label: 'Archive', value: 'archive' },
                  { label: 'Rename', value: 'rename' },
                ],
                open: state.open,
              });
              if (!result?.selected) return;
              state.open = result.open.open;
              state.highlightedValue = result.value;
              state.value = result.value;
              _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
            }}
            tabIndex={state.highlightedValue === 'duplicate' ? 0 : -1}
          >
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            {...menuState}
            id="gallery-dropdown-menu-archive"
            itemDisabled={true}
            itemLabel="Archive"
            itemValue="archive"
          >
            Archive
          </DropdownMenuItem>
          <DropdownMenuItem
            {...menuState}
            data-highlighted={state.highlightedValue === 'rename' ? '' : null}
            data-state={state.highlightedValue === 'rename' ? 'active' : 'inactive'}
            id="gallery-dropdown-menu-rename"
            itemLabel="Rename"
            itemValue="rename"
            onKeyDown={() => {
              const result = _dropdownMenuItemKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                itemValue: 'rename',
                items: [
                  { label: 'Duplicate', value: 'duplicate' },
                  { disabled: true, label: 'Archive', value: 'archive' },
                  { label: 'Rename', value: 'rename' },
                ],
                open: state.open,
              });
              if (result?.selected) {
                state.open = result.open.open;
                state.highlightedValue = result.value;
                state.value = result.value;
                _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
                return;
              }

              const keyResult = _dropdownMenuKeyDown(Object(event), {
                highlightedValue: state.highlightedValue,
                items: [
                  { label: 'Duplicate', value: 'duplicate' },
                  { disabled: true, label: 'Archive', value: 'archive' },
                  { label: 'Rename', value: 'rename' },
                ],
                open: state.open,
              });
              if (keyResult?.changed) {
                state.open = keyResult.open;
                if (!keyResult.open)
                  _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
                return;
              }

              const move = _dropdownMenuMove(
                {
                  highlightedValue: state.highlightedValue,
                  items: [
                    { label: 'Duplicate', value: 'duplicate' },
                    { disabled: true, label: 'Archive', value: 'archive' },
                    { label: 'Rename', value: 'rename' },
                  ],
                  open: state.open,
                },
                Object(event).key,
                { loop: true },
              );
              if (move) {
                Object(event).preventDefault?.();
                state.highlightedValue = move.highlightedValue ?? state.highlightedValue;
                _dropdownMenuFocusElement(
                  Object(event),
                  state.highlightedValue === 'rename'
                    ? 'gallery-dropdown-menu-rename'
                    : 'gallery-dropdown-menu-duplicate',
                );
                return;
              }

              const typeahead = _dropdownMenuTypeahead(
                {
                  highlightedValue: state.highlightedValue,
                  items: [
                    { label: 'Duplicate', value: 'duplicate' },
                    { disabled: true, label: 'Archive', value: 'archive' },
                    { label: 'Rename', value: 'rename' },
                  ],
                  open: state.open,
                },
                Object(event).key,
                { now: 0, loop: true },
              );
              if (typeahead.highlightedValue === state.highlightedValue) return;
              Object(event).preventDefault?.();
              state.highlightedValue = typeahead.highlightedValue ?? state.highlightedValue;
              _dropdownMenuFocusElement(
                Object(event),
                state.highlightedValue === 'rename'
                  ? 'gallery-dropdown-menu-rename'
                  : 'gallery-dropdown-menu-duplicate',
              );
            }}
            onClick={() => {
              const result = _dropdownMenuItemClick(Object(event), {
                highlightedValue: state.highlightedValue,
                itemValue: 'rename',
                items: [
                  { label: 'Duplicate', value: 'duplicate' },
                  { disabled: true, label: 'Archive', value: 'archive' },
                  { label: 'Rename', value: 'rename' },
                ],
                open: state.open,
              });
              if (!result?.selected) return;
              state.open = result.open.open;
              state.highlightedValue = result.value;
              state.value = result.value;
              _dropdownMenuFocusElement(Object(event), 'gallery-dropdown-menu-trigger');
            }}
            tabIndex={state.highlightedValue === 'rename' ? 0 : -1}
          >
            Rename
          </DropdownMenuItem>
        </DropdownMenuContent>
        <output data-demo-state="dropdown-open">{state.open ? 'open' : 'closed'}</output>
        <output data-demo-state="dropdown-value">{state.value}</output>
      </DropdownMenu>
    );
  },
});
