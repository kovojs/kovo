/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  disclosureContentAttributes,
  disclosureTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryDisclosureDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryDisclosureDemo = component('gallery-disclosure-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDisclosureDemoState) => {
    const contentId = 'gallery-interactive-disclosure-panel';
    const triggerAttrs = disclosureTriggerAttributes({ contentId, open: state.open });
    const contentAttrs = disclosureContentAttributes({ contentId, open: state.open });

    return (
      <section class="grid gap-2" data-gallery-interactive="disclosure">
        <button
          {...triggerAttrs}
          onClick={() => {
            state.open = !state.open;
          }}
        >
          Shipping rules
        </button>
        <div {...contentAttrs}>Orders over $50 ship free.</div>
      </section>
    );
  },
});
