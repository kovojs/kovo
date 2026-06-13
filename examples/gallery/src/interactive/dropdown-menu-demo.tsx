/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  dropdownMenuContentAttributes,
  dropdownMenuItemAttributes,
  dropdownMenuRootAttributes,
  dropdownMenuTriggerAttributes,
  type DropdownMenuItem,
} from '@jiso/headless-ui/primitives';

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
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryDropdownMenuDemo = component('gallery-dropdown-menu-demo', {
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
      >
        <button
          {...dropdownMenuTriggerAttributes({ ...menuState, contentId })}
          id="gallery-dropdown-menu-trigger"
          onClick={() => {
            state.open = !state.open;
            const doc = Reflect['get'](globalThis, 'document');
            const trigger = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-trigger')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-open"]')
              : undefined;

            if (trigger)
              Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', String(state.open));
            if (content) content['hidden'] = !state.open;
            if (output) output['textContent'] = state.open ? 'open' : 'closed';
          }}
        >
          Actions
        </button>
        <div
          {...dropdownMenuContentAttributes({ ...menuState, id: contentId })}
          onKeyDown={() => {
            if (event && (Object(event)['defaultPrevented'] || Object(event)['key'] !== 'Escape'))
              return;

            state.open = false;
            const doc = Reflect['get'](globalThis, 'document');
            const trigger = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-trigger')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-open"]')
              : undefined;

            if (trigger) Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'false');
            if (content) content['hidden'] = true;
            if (output) output['textContent'] = 'closed';
          }}
        >
          <button
            {...dropdownMenuItemAttributes({
              ...menuState,
              id: 'gallery-dropdown-menu-duplicate',
              itemLabel: 'Duplicate',
              itemValue: 'duplicate',
            })}
            onClick={() => {
              state.open = false;
              state.highlightedValue = 'duplicate';
              state.value = 'duplicate';
              const doc = Reflect['get'](globalThis, 'document');
              const content = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-value"]')
                : undefined;
              if (content) content['hidden'] = true;
              if (output) output['textContent'] = 'duplicate';
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
            onKeyDown={() => {
              if (
                event &&
                Object(event)['key'] !== 'Enter' &&
                Object(event)['key'] !== ' ' &&
                Object(event)['key'] !== 'Spacebar'
              )
                return;

              if (event) Object(event)['preventDefault']?.call(event);
              state.open = false;
              state.highlightedValue = 'rename';
              state.value = 'rename';
              const doc = Reflect['get'](globalThis, 'document');
              const content = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
                : undefined;
              const item = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-rename')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-value"]')
                : undefined;
              if (content) content['hidden'] = true;
              if (item) Object(item)['setAttribute']?.call(item, 'data-highlighted', '');
              if (output) output['textContent'] = 'rename';
            }}
            onClick={() => {
              state.open = false;
              state.highlightedValue = 'rename';
              state.value = 'rename';
              const doc = Reflect['get'](globalThis, 'document');
              const content = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-content')
                : undefined;
              const item = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-dropdown-menu-rename')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="dropdown-value"]')
                : undefined;
              if (content) content['hidden'] = true;
              if (item) Object(item)['setAttribute']?.call(item, 'data-highlighted', '');
              if (output) output['textContent'] = 'rename';
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
