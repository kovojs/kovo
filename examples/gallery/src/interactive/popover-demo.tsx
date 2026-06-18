/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  popoverBeforeToggle as _popoverBeforeToggle,
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
} from '@kovojs/headless-ui/popover';
import {
  popoverClasses,
  popoverTriggerClasses,
  popoverContentClasses,
} from '@kovojs/ui/popover';

const ROOT_CLASS = popoverClasses.join(' ');
const TRIGGER_CLASS = popoverTriggerClasses.join(' ');
const CONTENT_CLASS = popoverContentClasses.join(' ');

export interface GalleryPopoverDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryPopoverDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryPopoverDemoState) => {
    const contentId = 'gallery-popover-content';

    return (
      <section
        {...popoverRootAttributes({ open: state.open })}
        class={ROOT_CLASS}
        data-gallery-interactive="popover"
        data-state={state.open ? 'open' : 'closed'}
      >
        <button
          {...popoverTriggerAttributes({ contentId, open: state.open })}
          aria-expanded={state.open ? 'true' : 'false'}
          class={TRIGGER_CLASS}
          data-state={state.open ? 'open' : 'closed'}
        >
          Delivery window
        </button>
        <div
          {...popoverContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          onBeforeToggle={() => {
            const result = _popoverBeforeToggle(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
        >
          Weekday arrivals are available from 9 AM to 5 PM.
        </div>
        <output data-demo-state="popover-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
