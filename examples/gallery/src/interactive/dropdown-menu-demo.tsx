/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dropdownMenuContentAttributes,
  dropdownMenuFocusElement as _dropdownMenuFocusElement,
  dropdownMenuItemAttributes,
  dropdownMenuItemClick as _dropdownMenuItemClick,
  dropdownMenuItemKeyDown as _dropdownMenuItemKeyDown,
  dropdownMenuKeyDown as _dropdownMenuKeyDown,
  dropdownMenuMove as _dropdownMenuMove,
  dropdownMenuRootAttributes,
  dropdownMenuTriggerAttributes,
  dropdownMenuTriggerClick as _dropdownMenuTriggerClick,
  dropdownMenuTriggerKeyDown as _dropdownMenuTriggerKeyDown,
  dropdownMenuTypeahead as _dropdownMenuTypeahead,
  type DropdownMenuItem,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/dropdown-menu.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
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
      <section
        {...dropdownMenuRootAttributes(menuState)}
        class="grid gap-2"
        data-gallery-interactive="dropdown-menu"
        data-state={state.open ? 'open' : 'closed'}
      >
        <button
          {...dropdownMenuTriggerAttributes({ ...menuState, contentId })}
          class={TRIGGER_CLASS}
          id="gallery-dropdown-menu-trigger"
          aria-expanded={state.open ? 'true' : 'false'}
          data-state={state.open ? 'open' : 'closed'}
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
        </button>
        <div
          {...dropdownMenuContentAttributes({ ...menuState, id: contentId })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
        >
          <button
            {...dropdownMenuItemAttributes({
              ...menuState,
              id: 'gallery-dropdown-menu-duplicate',
              itemLabel: 'Duplicate',
              itemValue: 'duplicate',
            })}
            class={ITEM_CLASS}
            data-highlighted={state.highlightedValue === 'duplicate' ? '' : null}
            data-state={state.highlightedValue === 'duplicate' ? 'active' : 'inactive'}
            tabIndex={state.highlightedValue === 'duplicate' ? 0 : -1}
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
            data-highlighted={state.highlightedValue === 'rename' ? '' : null}
            data-state={state.highlightedValue === 'rename' ? 'active' : 'inactive'}
            tabIndex={state.highlightedValue === 'rename' ? 0 : -1}
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
          >
            Rename
          </button>
        </div>
        <output data-demo-state="dropdown-open">{state.open ? 'open' : 'closed'}</output>
        <output data-demo-state="dropdown-value">{state.value}</output>
      </section>
    );
  },
});
