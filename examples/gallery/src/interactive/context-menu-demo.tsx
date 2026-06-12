/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  contextMenuContentAttributes,
  contextMenuItemAttributes,
  contextMenuRootAttributes,
  contextMenuTriggerAttributes,
  type ContextMenuItem,
} from '@jiso/headless-ui/primitives';

export interface GalleryContextMenuDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const contextItems: readonly ContextMenuItem[] = Object.freeze([
  { label: 'Copy link', value: 'copy' },
  { disabled: true, label: 'Delete', value: 'delete' },
  { label: 'Inspect', value: 'inspect' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryContextMenuDemo = component('gallery-context-menu-demo', {
  state: () => ({ highlightedValue: 'copy', open: false, value: 'copy' }),
  render: (_queries: Record<string, never>, state: GalleryContextMenuDemoState) => {
    const contentId = 'gallery-context-menu-content';
    const menuState = {
      highlightedValue: state.highlightedValue,
      items: contextItems,
      open: state.open,
      point: { x: 24, y: 40 },
    };

    return (
      <section
        {...contextMenuRootAttributes(menuState)}
        class="grid gap-2"
        data-gallery-interactive="context-menu"
      >
        <div
          {...contextMenuTriggerAttributes({ ...menuState, contentId })}
          id="gallery-context-menu-trigger"
          onContextMenu={() => {
            state.open = true;
            const doc = Reflect['get'](globalThis, 'document');
            const trigger = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-trigger')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="context-open"]')
              : undefined;

            if (event) Object(event)['preventDefault']?.call(event);
            if (trigger) Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'true');
            if (content) content['hidden'] = false;
            if (output) output['textContent'] = 'open';
          }}
          onKeyDown={() => {
            state.open = true;
            const doc = Reflect['get'](globalThis, 'document');
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-content')
              : undefined;
            if (content) content['hidden'] = false;
          }}
          tabIndex="0"
        >
          Right click target
        </div>
        <div {...contextMenuContentAttributes({ ...menuState, id: contentId })}>
          <button
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-copy',
              itemLabel: 'Copy link',
              itemValue: 'copy',
            })}
          >
            Copy link
          </button>
          <button
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-delete',
              itemDisabled: true,
              itemLabel: 'Delete',
              itemValue: 'delete',
            })}
          >
            Delete
          </button>
          <button
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-inspect',
              itemLabel: 'Inspect',
              itemValue: 'inspect',
            })}
            onClick={() => {
              state.open = false;
              state.highlightedValue = 'inspect';
              state.value = 'inspect';
              const doc = Reflect['get'](globalThis, 'document');
              const content = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-context-menu-content')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="context-value"]')
                : undefined;
              if (content) content['hidden'] = true;
              if (output) output['textContent'] = 'inspect';
            }}
          >
            Inspect
          </button>
        </div>
        <output data-demo-state="context-open">{state.open ? 'open' : 'closed'}</output>
        <output data-demo-state="context-value">{state.value}</output>
      </section>
    );
  },
});
