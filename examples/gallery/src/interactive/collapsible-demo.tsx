/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  collapsibleTriggerClick as _collapsibleTriggerClick,
} from '@kovojs/ui/collapsible';

export interface GalleryCollapsibleDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryCollapsibleDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryCollapsibleDemoState) => {
    const contentId = 'gallery-collapsible-content';

    return (
      <Collapsible data-gallery-interactive="collapsible" open={state.open}>
        <CollapsibleTrigger
          contentId={contentId}
          onClick={() => {
            const result = _collapsibleTriggerClick(Object(event), { open: state.open });
            if (!result) return;
            Object(event)['preventDefault']?.call(event);
            state.open = result.open;
          }}
          open={state.open}
        >
          Release notes
        </CollapsibleTrigger>
        <CollapsibleContent contentId={contentId} open={state.open}>
          Added browser-backed compiled coverage.
        </CollapsibleContent>
      </Collapsible>
    );
  },
});
