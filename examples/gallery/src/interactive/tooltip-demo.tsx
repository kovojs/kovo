/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  tooltipContentAttributes,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
} from '@jiso/headless-ui/primitives';

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
        class="inline-grid gap-2"
        data-gallery-interactive="tooltip"
      >
        <button
          {...tooltipTriggerAttributes({ contentId, open: state.open })}
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
        <span {...tooltipContentAttributes({ contentId, open: state.open })}>
          Use the code printed on the packing slip.
        </span>
        <output data-demo-state="tooltip-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
