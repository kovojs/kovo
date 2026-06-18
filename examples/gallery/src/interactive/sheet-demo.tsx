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
} from '@kovojs/headless-ui/dialog';
import {
  sheetTriggerClasses,
  sheetContentClasses,
  sheetHeaderClasses,
  sheetTitleClasses,
  sheetDescriptionClasses,
  sheetCloseClasses,
} from '@kovojs/ui/sheet';

// CONTENT_CLASS is sheetContentClassNames base + the `right` side variant.
const TRIGGER_CLASS = sheetTriggerClasses.join(' ');
const CONTENT_CLASS = sheetContentClasses.join(' ');
const HEADER_CLASS = sheetHeaderClasses.join(' ');
const TITLE_CLASS = sheetTitleClasses.join(' ');
const DESCRIPTION_CLASS = sheetDescriptionClasses.join(' ');
const CLOSE_CLASS = sheetCloseClasses.join(' ');

export interface GallerySheetDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySheetDemo = component({
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
