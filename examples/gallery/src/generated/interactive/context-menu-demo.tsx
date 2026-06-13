// @jiso-ir - lowered from examples/gallery/src/interactive/context-menu-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
        fw-c="gallery-context-menu-demo"
        fw-state='{"highlightedValue":"copy","open":false,"value":"copy"}'
      >
        <div
          {...contextMenuTriggerAttributes({ ...menuState, contentId })}
          id="gallery-context-menu-trigger"
          on:contextmenu="/c/examples/gallery/src/generated/interactive/context-menu-demo.client.js?v=02816e0a#GalleryContextMenuDemo$div_contextmenu"
          on:keydown="/c/examples/gallery/src/generated/interactive/context-menu-demo.client.js?v=02816e0a#GalleryContextMenuDemo$div_keydown"
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
            on:keydown="/c/examples/gallery/src/generated/interactive/context-menu-demo.client.js?v=02816e0a#GalleryContextMenuDemo$button_keydown"
            on:click="/c/examples/gallery/src/generated/interactive/context-menu-demo.client.js?v=02816e0a#GalleryContextMenuDemo$button_click"
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
