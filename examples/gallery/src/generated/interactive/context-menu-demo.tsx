// @kovojs-ir - lowered from examples/gallery/src/interactive/context-menu-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryContextMenuDemo$ContextMenu_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryContextMenuDemo$ContextMenuTrigger_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryContextMenuDemo$ContextMenuTrigger_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryContextMenuDemo$ContextMenuContent_data_anchor_x_derive = derive(
  ['state'],
  (state: any) => String(state.point.x),
);
export const GalleryContextMenuDemo$ContextMenuContent_data_anchor_y_derive = derive(
  ['state'],
  (state: any) => String(state.point.y),
);
export const GalleryContextMenuDemo$ContextMenuContent_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryContextMenuDemo$ContextMenuContent_hidden_derive = derive(
  ['state'],
  (state: any) => (!state.open ? '' : null),
);
export const GalleryContextMenuDemo$ContextMenuItem_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'copy' ? '' : null),
);
export const GalleryContextMenuDemo$ContextMenuItem_data_state_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'copy' ? 'active' : 'inactive'),
);
export const GalleryContextMenuDemo$ContextMenuItem_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'copy' ? 0 : -1),
);
export const GalleryContextMenuDemo$ContextMenuItem_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'inspect' ? '' : null),
);
export const GalleryContextMenuDemo$ContextMenuItem_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'inspect' ? 'active' : 'inactive'),
);
export const GalleryContextMenuDemo$ContextMenuItem_tabIndex_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'inspect' ? 0 : -1),
);
export const GalleryContextMenuDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  type ContextMenuItem as GalleryContextMenuItem,
  type ContextMenuPoint,
} from '@kovojs/ui/context-menu';

export interface GalleryContextMenuDemoState {
  highlightedValue: string;
  open: boolean;
  point: ContextMenuPoint;
  value: string;
}

const contextItems: readonly GalleryContextMenuItem[] = Object.freeze([
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
      <ContextMenu
        data-gallery-interactive="context-menu"
        {...menuState}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenu_data_state_derive"
        kovo-state='{"highlightedValue":"copy","open":false,"point":{"x":24,"y":40},"value":"copy"}'
      >
        <ContextMenuTrigger
          contentId={contentId}
          id="gallery-context-menu-trigger"
          on:contextmenu="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuTrigger_contextmenu"
          on:keydown="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuTrigger_keydown"
          tabIndex="0"
          {...menuState}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuTrigger_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuTrigger_data_state_derive"
        >
          Right click target
        </ContextMenuTrigger>
        <ContextMenuContent
          id={contentId}
          {...menuState}
          data-anchor-x={String(state.point.x)}
          data-bind:data-anchor-x="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuContent_data_anchor_x_derive"
          data-anchor-y={String(state.point.y)}
          data-bind:data-anchor-y="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuContent_data_anchor_y_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuContent_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuContent_hidden_derive"
        >
          <ContextMenuItem
            id="gallery-context-menu-copy"
            itemLabel="Copy link"
            itemValue="copy"
            on:keydown="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_keydown"
            on:click="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_click"
            {...menuState}
            data-highlighted={state.highlightedValue === 'copy' ? '' : null}
            data-bind:data-highlighted="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_data_highlighted_derive"
            data-state={state.highlightedValue === 'copy' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_data_state_derive"
            tabIndex={state.highlightedValue === 'copy' ? 0 : -1}
            data-bind:tabIndex="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_tabIndex_derive"
          >
            Copy link
          </ContextMenuItem>
          <ContextMenuItem
            id="gallery-context-menu-delete"
            itemDisabled={true}
            itemLabel="Delete"
            itemValue="delete"
            {...menuState}
          >
            Delete
          </ContextMenuItem>
          <ContextMenuItem
            id="gallery-context-menu-inspect"
            itemLabel="Inspect"
            itemValue="inspect"
            on:keydown="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_keydown_2"
            on:click="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_click_2"
            {...menuState}
            data-highlighted={state.highlightedValue === 'inspect' ? '' : null}
            data-bind:data-highlighted="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_data_highlighted_derive_2"
            data-state={state.highlightedValue === 'inspect' ? 'active' : 'inactive'}
            data-bind:data-state="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_data_state_derive_2"
            tabIndex={state.highlightedValue === 'inspect' ? 0 : -1}
            data-bind:tabIndex="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$ContextMenuItem_tabIndex_derive_2"
          >
            Inspect
          </ContextMenuItem>
        </ContextMenuContent>
        <output
          data-demo-state="context-open"
          data-bind="/c/__v/31ebc968/examples/gallery/src/generated/interactive/context-menu-demo.client.js#GalleryContextMenuDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
        <output data-demo-state="context-value" data-bind="state.value">
          {state.value}
        </output>
      </ContextMenu>
    );
  },
});
GalleryContextMenuDemo.name = 'generated/interactive/context-menu-demo/gallery-context-menu-demo';
