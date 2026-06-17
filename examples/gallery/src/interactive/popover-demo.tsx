/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  popoverBeforeToggle as _popoverBeforeToggle,
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/popover.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'mt-2 w-64 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 shadow-md data-[state=closed]:hidden';

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
