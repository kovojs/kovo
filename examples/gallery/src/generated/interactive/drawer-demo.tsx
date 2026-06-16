// @kovojs-ir - lowered from examples/gallery/src/interactive/drawer-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

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
  dialogCancel as _dialogCancel,
  dialogCloseAttributes,
  dialogCloseClick as _dialogCloseClick,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerClick as _dialogTriggerClick,
  dialogTriggerAttributes,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/drawer.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
// CONTENT_CLASS is drawerContentClassNames base + the `bottom` side variant.
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50';
const CONTENT_CLASS =
  'fixed z-50 flex flex-col gap-4 border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl inset-x-0 bottom-0 max-h-[85vh] border-t';
const HANDLE_CLASS = 'mx-auto h-1.5 w-12 rounded-full bg-neutral-300';
const HEADER_CLASS = 'grid gap-1';
const TITLE_CLASS = 'text-base font-semibold';
const DESCRIPTION_CLASS = 'text-sm text-neutral-600';
const CLOSE_CLASS =
  'inline-flex h-8 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50';

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
        {...dialogRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="drawer"
        data-side="bottom"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$section_data_state_derive"
        kovo-c="gallery-drawer-demo"
        kovo-state='{"open":false}'
      >
        <button
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$button_data_state_derive"
          on:click="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$button_click"
        >
          Open drawer
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          class={CONTENT_CLASS}
          data-side="bottom"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$dialog_data_state_derive"
          open={state.open}
          data-bind:open="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$dialog_open_derive"
          on:cancel="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$dialog_cancel"
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
            {...dialogCloseAttributes({ contentId, open: state.open })}
            class={CLOSE_CLASS}
            data-state={state.open ? 'open' : 'closed'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$button_data_state_derive_2"
            on:click="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$button_click_2"
          >
            Close drawer
          </button>
        </dialog>
        <output
          data-demo-state="drawer-open"
          data-bind="/c/examples/gallery/src/generated/interactive/drawer-demo.client.js?v=f8bd92a3#GalleryDrawerDemo$output_text_derive"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </section>
    );
  },
});
