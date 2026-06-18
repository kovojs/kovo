// @kovojs-ir - lowered from examples/gallery/src/interactive/drawer-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryDrawerDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryDrawerDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$dialog_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$dialog_open_derive = derive(['state'], (state: any) =>
  state.open ? '' : null,
);
export const GalleryDrawerDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryDrawerDemo$output_text_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);

import { component } from '@kovojs/core';
import {
  dialogCloseAttributes,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/dialog';
import {
  drawerTriggerClasses,
  drawerContentClasses,
  drawerHandleClasses,
  drawerHeaderClasses,
  drawerTitleClasses,
  drawerDescriptionClasses,
  drawerCloseClasses,
} from '@kovojs/ui/drawer';

// CONTENT_CLASS is drawerContentClassNames base + the `bottom` side variant.
const TRIGGER_CLASS = drawerTriggerClasses.join(' ');
const CONTENT_CLASS = drawerContentClasses.join(' ');
const HANDLE_CLASS = drawerHandleClasses.join(' ');
const HEADER_CLASS = drawerHeaderClasses.join(' ');
const TITLE_CLASS = drawerTitleClasses.join(' ');
const DESCRIPTION_CLASS = drawerDescriptionClasses.join(' ');
const CLOSE_CLASS = drawerCloseClasses.join(' ');

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
      <section
        class="grid gap-2"
        data-gallery-interactive="drawer"
        data-side="bottom"
        {...dialogRootAttributes({ open: state.open })}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$section_data_state_derive"
        kovo-c="gallery-drawer-demo"
        kovo-state='{"open":false}'
      >
        <button
          class={TRIGGER_CLASS}
          on:click="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$button_click"
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$button_data_state_derive"
        >
          Open drawer
        </button>
        <dialog
          class={CONTENT_CLASS}
          data-side="bottom"
          on:cancel="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$dialog_cancel"
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$dialog_open_derive"
        >
          <div aria-hidden="true" class={HANDLE_CLASS} />
          <header class={HEADER_CLASS}>
            <h2 class={TITLE_CLASS} id={titleId}>
              Mobile actions
            </h2>
            <p class={DESCRIPTION_CLASS} id={descriptionId}>
              Directional sheet drawer; Vaul drag, snap, and background-scale gestures are not
              modeled.
            </p>
          </header>
          <button
            class={CLOSE_CLASS}
            on:click="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$button_click_2"
            {...dialogCloseAttributes({ contentId, open: state.open })}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$button_data_state_derive_2"
          >
            Close drawer
          </button>
        </dialog>
        <output
          data-demo-state="drawer-open"
          data-bind="/c/__v/f4740b0b/examples/gallery/src/generated/interactive/drawer-demo.client.js#GalleryDrawerDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
GalleryDrawerDemo.name = 'generated/interactive/drawer-demo/gallery-drawer-demo';
