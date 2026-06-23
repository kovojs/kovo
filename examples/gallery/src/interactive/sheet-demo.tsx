/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  dialogCancel as _dialogCancel,
  dialogCloseClick as _dialogCloseClick,
  dialogTriggerClick as _dialogTriggerClick,
} from '@kovojs/headless-ui/dialog';
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetRoot,
  SheetTitle,
  SheetTrigger,
} from '@kovojs/ui/sheet';

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
      <SheetRoot
        data-gallery-interactive="sheet"
        data-side="right"
        data-state={state.open ? 'open' : 'closed'}
        open={state.open}
      >
        <SheetTrigger
          aria-expanded={state.open ? 'true' : 'false'}
          contentId={contentId}
          data-state={state.open ? 'open' : 'closed'}
          open={state.open}
          onClick={() => {
            const result = _dialogTriggerClick(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
        >
          Open sheet
        </SheetTrigger>
        <SheetContent
          contentId={contentId}
          data-side="right"
          data-state={state.open ? 'open' : 'closed'}
          descriptionId={descriptionId}
          open={state.open}
          onCancel={() => {
            const result = _dialogCancel(Object(event), { open: state.open });
            if (!result?.changed) return;
            state.open = result.open;
          }}
          side="right"
          titleId={titleId}
        >
          {/* shadcn-style corner dismiss: icon-only X (no text children, which
              would overflow the 32px icon button). Accessible name comes from the
              component's built-in aria-label. */}
          <SheetClose
            contentId={contentId}
            data-state={state.open ? 'open' : 'closed'}
            open={state.open}
            onClick={() => {
              const result = _dialogCloseClick(Object(event), { open: state.open });
              if (!result?.changed) return;
              state.open = result.open;
              const root = Object(event)['target']?.closest?.('[data-gallery-interactive="sheet"]');
              const trigger = Object(root)?.querySelector?.('button[command="show-modal"]');
              Object(trigger)['focus']?.call(trigger);
            }}
          />
          <SheetHeader>
            <SheetTitle id={titleId}>Account settings</SheetTitle>
            <SheetDescription id={descriptionId}>
              Update your profile. Changes apply when you save.
            </SheetDescription>
          </SheetHeader>
          <div style="display:grid;gap:1rem;font-size:0.875rem">
            <div style="display:grid;gap:0.375rem">
              <span style="font-weight:500;color:var(--ink,#171717)">Name</span>
              <div style="display:flex;height:2.25rem;align-items:center;border-radius:0.375rem;border:1px solid var(--edge,#e5e5e5);background:var(--bg,#fff);padding:0 0.75rem;color:var(--ink,#171717)">
                Ada Lovelace
              </div>
            </div>
            <div style="display:grid;gap:0.375rem">
              <span style="font-weight:500;color:var(--ink,#171717)">Email</span>
              <div style="display:flex;height:2.25rem;align-items:center;border-radius:0.375rem;border:1px solid var(--edge,#e5e5e5);background:var(--bg,#fff);padding:0 0.75rem;color:var(--dim,#6b7280)">
                ada@example.com
              </div>
            </div>
          </div>
          {/* Footer pinned to the bottom of the flex column (margin-top:auto),
              mirroring shadcn's Save / Close action row. Both use the native
              dialog `command="close"` and sync the bound open state. */}
          <div style="margin-top:auto;display:flex;justify-content:flex-end;gap:0.5rem">
            <button
              command="close"
              commandfor={contentId}
              onClick={() => {
                state.open = false;
              }}
              style="display:inline-flex;height:2.25rem;align-items:center;justify-content:center;border-radius:0.375rem;border:1px solid var(--edge,#d4d4d4);background:var(--panel,#fff);padding:0 0.75rem;font-size:0.875rem;font-weight:500;color:var(--ink,#0a0a0a)"
              type="button"
            >
              Close
            </button>
            <button
              command="close"
              commandfor={contentId}
              onClick={() => {
                state.open = false;
              }}
              style="display:inline-flex;height:2.25rem;align-items:center;justify-content:center;border-radius:0.375rem;border:1px solid var(--ink,#0a0a0a);background:var(--ink,#0a0a0a);padding:0 0.75rem;font-size:0.875rem;font-weight:500;color:var(--bg,#fff)"
              type="button"
            >
              Save changes
            </button>
          </div>
        </SheetContent>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="sheet-open"
        >
          {state.open ? 'open' : 'closed'}
        </output>
      </SheetRoot>
    );
  },
});
