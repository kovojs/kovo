/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  popoverContentAttributes,
  popoverRootAttributes,
  popoverTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/popover.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-9 items-center justify-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'mt-2 w-64 rounded-md border border-neutral-200 bg-white p-3 text-sm text-neutral-700 shadow-md data-[state=closed]:hidden';

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
        class={ROOT_CLASS}
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
          class={TRIGGER_CLASS}
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
        <div {...popoverContentAttributes({ contentId, open: state.open })} class={CONTENT_CLASS}>
          Weekday arrivals are available from 9 AM to 5 PM.
        </div>
        <output data-demo-state="popover-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
