// @kovojs-ir - lowered from examples/gallery/src/interactive/drawer-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryDrawerDemo$DrawerRoot_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$DrawerRoot_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$DrawerTrigger_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryDrawerDemo$DrawerTrigger_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$DrawerTrigger_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$DrawerContent_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$DrawerContent_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$DrawerClose_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$DrawerClose_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerHeader,
  DrawerRoot,
  DrawerTitle,
  DrawerTrigger,
} from '@kovojs/ui/drawer';

export interface GalleryDrawerDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDrawerDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDrawerDemoState) => {
    const contentId = 'gallery-interactive-drawer-content';
    const titleId = 'gallery-interactive-drawer-title';
    const descriptionId = 'gallery-interactive-drawer-description';

    return (
      <DrawerRoot
        data-gallery-interactive="drawer"
        data-side="bottom"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerRoot_data_state_derive"
        open={state.open}
        data-bind:open="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerRoot_open_derive"
        kovo-state='{"open":false}'
      >
        <DrawerTrigger
          contentId={contentId}
          on:click="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerTrigger_click"
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerTrigger_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerTrigger_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerTrigger_open_derive"
        >
          Open drawer
        </DrawerTrigger>
        <DrawerContent
          contentId={contentId}
          data-side="bottom"
          descriptionId={descriptionId}
          on:cancel="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerContent_cancel"
          side="bottom"
          titleId={titleId}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerContent_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerContent_open_derive"
        >
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle id={titleId}>Mobile actions</DrawerTitle>
            <DrawerDescription id={descriptionId}>
              Directional sheet drawer; Vaul drag, snap, and background-scale gestures are not
              modeled.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerClose
            contentId={contentId}
            on:click="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerClose_click"
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerClose_data_state_derive"
            open={state.open}
            data-bind:open="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$DrawerClose_open_derive"
          >
            Close drawer
          </DrawerClose>
        </DrawerContent>
        <output
          data-demo-state="drawer-open"
          data-bind="/c/__v/eb6dbc68/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </DrawerRoot>
    );
  },
});
GalleryDrawerDemo.name = 'generated/interactive/drawer-demo/gallery-drawer-demo';
