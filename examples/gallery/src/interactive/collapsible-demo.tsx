/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  collapsibleContentAttributes,
  collapsibleRootAttributes,
  collapsibleTriggerClick as _collapsibleTriggerClick,
  collapsibleTriggerAttributes,
} from '@kovojs/headless-ui/collapsible';
import {
  collapsibleClasses,
  collapsibleTriggerClasses,
  collapsibleContentClasses,
} from '@kovojs/ui/collapsible';

const ROOT_CLASS = collapsibleClasses.join(' ');
const TRIGGER_CLASS = collapsibleTriggerClasses.join(' ');
const CONTENT_CLASS = collapsibleContentClasses.join(' ');

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
      <details
        {...collapsibleRootAttributes({ open: state.open })}
        class={ROOT_CLASS}
        data-gallery-interactive="collapsible"
        data-state={state.open ? 'open' : 'closed'}
        open={state.open}
      >
        <summary
          {...collapsibleTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={String(state.open)}
          class={TRIGGER_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          onClick={() => {
            const result = _collapsibleTriggerClick(Object(event), { open: state.open });
            if (!result) return;
            Object(event)['preventDefault']?.call(event);
            state.open = result.open;
          }}
        >
          Release notes
        </summary>
        <div
          {...collapsibleContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
        >
          Added browser-backed compiled coverage.
        </div>
      </details>
    );
  },
});
