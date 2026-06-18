// @kovojs-ir - lowered from examples/gallery/src/interactive/context-menu-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryContextMenuDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryContextMenuDemo$div_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryContextMenuDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryContextMenuDemo$div_data_anchor_x_derive = derive(['state'], (state: any) =>
  String(state.point.x),
);
export const GalleryContextMenuDemo$div_data_anchor_y_derive = derive(['state'], (state: any) =>
  String(state.point.y),
);
export const GalleryContextMenuDemo$div_data_state_derive_2 = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryContextMenuDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryContextMenuDemo$button_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'copy' ? '' : null),
);
export const GalleryContextMenuDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'copy' ? 'active' : 'inactive',
);
export const GalleryContextMenuDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'copy' ? 0 : -1,
);
export const GalleryContextMenuDemo$button_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'inspect' ? '' : null),
);
export const GalleryContextMenuDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'inspect' ? 'active' : 'inactive',
);
export const GalleryContextMenuDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'inspect' ? 0 : -1,
);
export const GalleryContextMenuDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  contextMenuContentAttributes,
  contextMenuItemAttributes,
  contextMenuRootAttributes,
  contextMenuTriggerAttributes,
  type ContextMenuItem,
  type ContextMenuPoint,
} from '@kovojs/headless-ui/context-menu';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/context-menu.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const TRIGGER_CLASS =
  'rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 data-[state=open]:border-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const CONTENT_CLASS =
  'min-w-40 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-md outline-none data-[state=closed]:hidden';
const ITEM_CLASS =
  'flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

export interface GalleryContextMenuDemoState {
  highlightedValue: string;
  open: boolean;
  point: ContextMenuPoint;
  value: string;
}

const contextItems: readonly ContextMenuItem[] = Object.freeze([
  { label: 'Copy link', value: 'copy' },
  { disabled: true, label: 'Delete', value: 'delete' },
  { label: 'Inspect', value: 'inspect' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryContextMenuDemo = component({
  state: () => ({ highlightedValue: 'copy', open: false, point: { x: 24, y: 40 }, value: 'copy' }),
  render: (_queries: Record<string, never>, state: GalleryContextMenuDemoState) => {
    const contentId = 'gallery-context-menu-content';
    const menuState = {
      highlightedValue: state.highlightedValue,
      items: contextItems,
      open: state.open,
      point: state.point,
    };

    return (
      <section
        class="grid gap-2"
        data-gallery-interactive="context-menu"
        {...contextMenuRootAttributes(menuState)}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$section_data_state_derive"
        kovo-c="gallery-context-menu-demo"
        kovo-state='{"highlightedValue":"copy","open":false,"point":{"x":24,"y":40},"value":"copy"}'
      >
        <div
          class={TRIGGER_CLASS}
          id="gallery-context-menu-trigger"
          on:contextmenu="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$div_contextmenu"
          on:keydown="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$div_keydown"
          tabIndex="0"
          {...contextMenuTriggerAttributes({ ...menuState, contentId })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$div_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$div_data_state_derive"
        >
          Right click target
        </div>
        <div
          class={CONTENT_CLASS}
          {...contextMenuContentAttributes({ ...menuState, id: contentId })}
          data-anchor-x={String(state.point.x)}
          data-bind:data-anchor-x="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$div_data_anchor_x_derive"
          data-anchor-y={String(state.point.y)}
          data-bind:data-anchor-y="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$div_data_anchor_y_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$div_data_state_derive_2"
          hidden={!state.open}
          data-bind:hidden="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$div_hidden_derive"
        >
          <button
            class={ITEM_CLASS}
            on:keydown="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_keydown"
            on:click="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_click"
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-copy',
              itemLabel: 'Copy link',
              itemValue: 'copy',
            })}
            data-highlighted={state.highlightedValue === 'copy' ? '' : null}
            data-bind:data-highlighted="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_data_highlighted_derive"
            data-state={state.highlightedValue === 'copy' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_data_state_derive"
            tabIndex={state.highlightedValue === 'copy' ? 0 : -1}
            data-bind:tabIndex="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_tabIndex_derive"
          >
            Copy link
          </button>
          <button
            class={ITEM_CLASS}
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
            class={ITEM_CLASS}
            on:keydown="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_keydown_2"
            on:click="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_click_2"
            {...contextMenuItemAttributes({
              ...menuState,
              id: 'gallery-context-menu-inspect',
              itemLabel: 'Inspect',
              itemValue: 'inspect',
            })}
            data-highlighted={state.highlightedValue === 'inspect' ? '' : null}
            data-bind:data-highlighted="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_data_highlighted_derive_2"
            data-state={state.highlightedValue === 'inspect' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_data_state_derive_2"
            tabIndex={state.highlightedValue === 'inspect' ? 0 : -1}
            data-bind:tabIndex="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$button_tabIndex_derive_2"
          >
            Inspect
          </button>
        </div>
        <output
          data-demo-state="context-open"
          data-bind="/c/__v/ac2b6896/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
        <output data-demo-state="context-value" data-bind="state.value">
          {state.value}
        </output>
      </section>
    );
  },
});
GalleryContextMenuDemo.name = 'generated/interactive/context-menu-demo/gallery-context-menu-demo';
