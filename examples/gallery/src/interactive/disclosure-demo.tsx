/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { disclosureTriggerClick as _disclosureTriggerClick } from '@kovojs/headless-ui/disclosure';
import {
  disclosureClasses,
  disclosureTriggerClasses,
  disclosureContentClasses,
} from '@kovojs/ui/disclosure';

const ROOT_CLASS = disclosureClasses.join(' ');
const TRIGGER_CLASS = disclosureTriggerClasses.join(' ');
const CONTENT_CLASS = disclosureContentClasses.join(' ');

export interface GalleryDisclosureDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryDisclosureDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryDisclosureDemoState) => (
    <section class={ROOT_CLASS} data-gallery-interactive="disclosure">
      <button
        aria-controls="gallery-interactive-disclosure-panel"
        aria-expanded={String(state.open)}
        class={TRIGGER_CLASS}
        data-state={state.open ? 'open' : 'closed'}
        onClick={() => {
          const result = _disclosureTriggerClick(Object(event), { open: state.open });
          if (!result) return;
          state.open = result.open;
        }}
        type="button"
      >
        Shipping rules
      </button>
      <div
        class={CONTENT_CLASS}
        data-state={state.open ? 'open' : 'closed'}
        hidden={!state.open}
        id="gallery-interactive-disclosure-panel"
      >
        Orders over $50 ship free.
      </div>
    </section>
  ),
});
