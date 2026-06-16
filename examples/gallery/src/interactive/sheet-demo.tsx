/** @jsxImportSource @kovojs/server */
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

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/sheet.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
// CONTENT_CLASS is sheetContentClassNames base + the `right` side variant.
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50';
const CONTENT_CLASS =
  'fixed z-50 flex flex-col gap-4 border-neutral-200 bg-white p-6 text-neutral-950 shadow-xl inset-y-0 right-0 w-full max-w-sm border-l';
const HEADER_CLASS = 'grid gap-1';
const TITLE_CLASS = 'text-base font-semibold';
const DESCRIPTION_CLASS = 'text-sm text-neutral-600';
const CLOSE_CLASS =
  'inline-flex h-8 w-fit items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50';

export interface GallerySheetDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySheetDemo = component('gallery-sheet-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GallerySheetDemoState) => {
    const contentId = 'gallery-interactive-sheet-content';
    const titleId = 'gallery-interactive-sheet-title';
    const descriptionId = 'gallery-interactive-sheet-description';

    return (
      <section
        {...dialogRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="sheet"
        data-side="right"
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
          Open sheet
        </button>
        <dialog
          {...dialogContentAttributes({ contentId, descriptionId, open: state.open, titleId })}
          class={CONTENT_CLASS}
          data-side="right"
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
          onCancel={() => {
            const result = _dialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          <header class={HEADER_CLASS}>
            <h2 class={TITLE_CLASS} id={titleId}>
              Account settings
            </h2>
            <p class={DESCRIPTION_CLASS} id={descriptionId}>
              Review the account panel side sheet.
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
            Close sheet
          </button>
        </dialog>
        <output data-demo-state="sheet-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
