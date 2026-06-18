/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
  disclosureTriggerClick as _disclosureTriggerClick,
} from '@kovojs/ui/disclosure';

export interface GalleryDisclosureDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDisclosureDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDisclosureDemoState) => (
    <Disclosure data-gallery-interactive="disclosure" open={state.open}>
      <DisclosureTrigger
        contentId="gallery-interactive-disclosure-panel"
        onClick={() => {
          const result = _disclosureTriggerClick(Object(event), { open: state.open });
          if (!result) return;
          state.open = result.open;
        }}
        open={state.open}
      >
        Shipping rules
      </DisclosureTrigger>
      <DisclosureContent contentId="gallery-interactive-disclosure-panel" open={state.open}>
        Orders over $50 ship free.
      </DisclosureContent>
    </Disclosure>
  ),
});
