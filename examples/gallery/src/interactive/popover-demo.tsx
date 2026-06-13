/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryPopoverDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryPopoverDemo = component('gallery-popover-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryPopoverDemoState) => {
    const contentId = 'gallery-popover-content';

    return (
      <section
        {...popoverRootAttributes({ open: state.open })}
        class="grid gap-2"
        data-gallery-interactive="popover"
        onKeyDown={() => {
          if (!event || Reflect['get'](event, 'key') !== 'Escape') return;
          state.open = false;
          const doc = Reflect['get'](globalThis, 'document');
          const content = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-popover-content')
            : undefined;
          const output = doc
            ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="popover-open"]')
            : undefined;

          if (content) Object(content)['hidePopover']?.call(content);
          if (output) output['textContent'] = 'closed';
        }}
      >
        <button
          {...popoverTriggerAttributes({ contentId, open: state.open })}
          onClick={() => {
            state.open = !state.open;
            const doc = Reflect['get'](globalThis, 'document');
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="popover-open"]')
              : undefined;

            if (output) output['textContent'] = state.open ? 'open' : 'closed';
          }}
        >
          Delivery window
        </button>
        <div {...popoverContentAttributes({ contentId, open: state.open })}>
          Weekday arrivals are available from 9 AM to 5 PM.
        </div>
        <output data-demo-state="popover-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
