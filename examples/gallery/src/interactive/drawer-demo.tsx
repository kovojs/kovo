/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  dialogCancel as _dialogCancel,
  dialogCloseAttributes,
  dialogCloseClick as _dialogCloseClick,
  dialogContentAttributes,
  dialogRootAttributes,
  dialogTriggerClick as _dialogTriggerClick,
  dialogTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/drawer.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
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
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryDrawerDemo = component('gallery-drawer-demo', {
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
      >
        <button
          {...dialogTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          aria-expanded={state.open ? 'true' : 'false'}
          data-state={state.open ? 'open' : 'closed'}
          onClick={() => {
            const result = _dialogTriggerClick(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          Open drawer
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          class={CONTENT_CLASS}
          data-side="bottom"
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
          onCancel={() => {
            const result = _dialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          <div aria-hidden="true" class={HANDLE_CLASS} />
          <header class={HEADER_CLASS}>
            <h2 class={TITLE_CLASS} id={titleId}>
              Mobile actions
            </h2>
            <p class={DESCRIPTION_CLASS} id={descriptionId}>
              Directional sheet drawer; Vaul drag, snap, and background-scale gestures are not modeled.
            </p>
          </header>
          <button
            {...dialogCloseAttributes({ contentId, open: state.open })}
            class={CLOSE_CLASS}
            data-state={state.open ? 'open' : 'closed'}
            onClick={() => {
              const result = _dialogCloseClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
            }}
          >
            Close drawer
          </button>
        </dialog>
        <output data-demo-state="drawer-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
