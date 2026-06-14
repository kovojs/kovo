/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  contextMenuContentAttributes,
  contextMenuItemAttributes,
  contextMenuRootAttributes,
  contextMenuTriggerAttributes,
  type ContextMenuItem,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/context-menu.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const TRIGGER_CLASS =
  'rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 data-[state=open]:border-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const CONTENT_CLASS =
  'min-w-40 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-md outline-none data-[state=closed]:hidden';
const ITEM_CLASS =
  'flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

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
          class={TRIGGER_CLASS}
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
            if (
              event &&
              Object(event)['key'] !== 'ContextMenu' &&
              !(Object(event)['shiftKey'] === true && Object(event)['key'] === 'F10')
            )
              return;

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
        <div {...contextMenuContentAttributes({ ...menuState, id: contentId })} class={CONTENT_CLASS}>
          <button
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-copy',
              itemLabel: 'Copy link',
              itemValue: 'copy',
            })}
            class={ITEM_CLASS}
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
            class={ITEM_CLASS}
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
