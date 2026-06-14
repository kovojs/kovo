/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/tooltip.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'mt-2 w-max max-w-64 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs text-white shadow-md data-[state=closed]:hidden';

export interface GalleryTooltipDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryTooltipDemo = component('gallery-tooltip-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryTooltipDemoState) => {
    const contentId = 'gallery-tooltip-content';

    return (
      <section
        {...tooltipRootAttributes({ open: state.open })}
        class={ROOT_CLASS}
        data-gallery-interactive="tooltip"
      >
        <button
          {...tooltipTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          onBlur={() => {
            state.open = false;
            const doc = Reflect['get'](globalThis, 'document');
            const target = event ? Reflect['get'](event, 'target') : undefined;
            const trigger = target
              ? Object(target)['closest']?.call(target, '[jiso-tooltip]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
              Object(trigger)['removeAttribute']?.call(trigger, 'aria-describedby');
            }
            if (content) {
              Object(content)['hidePopover']?.call(content);
              content['hidden'] = true;
              Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
            }
            if (output) output['textContent'] = 'closed';
          }}
          onFocus={() => {
            state.open = true;
            const doc = Reflect['get'](globalThis, 'document');
            const target = event ? Reflect['get'](event, 'target') : undefined;
            const trigger = target
              ? Object(target)['closest']?.call(target, '[jiso-tooltip]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'open');
              Object(trigger)['setAttribute']?.call(
                trigger,
                'aria-describedby',
                'gallery-tooltip-content',
              );
            }
            if (content) {
              content['hidden'] = false;
              Object(content)['setAttribute']?.call(content, 'data-state', 'open');
              Object(content)['showPopover']?.call(content);
            }
            if (output) output['textContent'] = 'open';
          }}
          onKeyDown={() => {
            if (!event || Reflect['get'](event, 'key') !== 'Escape') return;

            state.open = false;
            const doc = Reflect['get'](globalThis, 'document');
            const target = Reflect['get'](event, 'target');
            const trigger = target
              ? Object(target)['closest']?.call(target, '[jiso-tooltip]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
              Object(trigger)['removeAttribute']?.call(trigger, 'aria-describedby');
            }
            if (content) {
              Object(content)['hidePopover']?.call(content);
              content['hidden'] = true;
              Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
            }
            if (output) output['textContent'] = 'closed';
          }}
          onPointerEnter={() => {
            state.open = true;
            const doc = Reflect['get'](globalThis, 'document');
            const target = event ? Reflect['get'](event, 'target') : undefined;
            const trigger = target
              ? Object(target)['closest']?.call(target, '[jiso-tooltip]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'open');
              Object(trigger)['setAttribute']?.call(
                trigger,
                'aria-describedby',
                'gallery-tooltip-content',
              );
            }
            if (content) {
              content['hidden'] = false;
              Object(content)['setAttribute']?.call(content, 'data-state', 'open');
              Object(content)['showPopover']?.call(content);
            }
            if (output) output['textContent'] = 'open';
          }}
          onPointerLeave={() => {
            state.open = false;
            const doc = Reflect['get'](globalThis, 'document');
            const target = event ? Reflect['get'](event, 'target') : undefined;
            const trigger = target
              ? Object(target)['closest']?.call(target, '[jiso-tooltip]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-tooltip-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="tooltip-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
              Object(trigger)['removeAttribute']?.call(trigger, 'aria-describedby');
            }
            if (content) {
              Object(content)['hidePopover']?.call(content);
              content['hidden'] = true;
              Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
            }
            if (output) output['textContent'] = 'closed';
          }}
        >
          Shipping code
        </button>
        <span {...tooltipContentAttributes({ contentId, open: state.open })} class={CONTENT_CLASS}>
          Use the code printed on the packing slip.
        </span>
        <output data-demo-state="tooltip-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
