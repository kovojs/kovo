/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  hoverCardContentAttributes,
  hoverCardRootAttributes,
  hoverCardTriggerAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/hover-card.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex items-center rounded-md text-sm font-medium text-neutral-950 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:underline';
const CONTENT_CLASS =
  'mt-2 w-72 rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-md data-[state=closed]:hidden';

export interface GalleryHoverCardDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryHoverCardDemo = component('gallery-hover-card-demo', {
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryHoverCardDemoState) => {
    const contentId = 'gallery-hover-card-content';

    return (
      <section
        {...hoverCardRootAttributes({ open: state.open })}
        class={ROOT_CLASS}
        data-gallery-interactive="hover-card"
      >
        <a
          {...hoverCardTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          href="#hover-card-demo"
          onBlur={() => {
            state.open = false;
            const doc = Reflect['get'](globalThis, 'document');
            const target = event ? Reflect['get'](event, 'target') : undefined;
            const trigger = target
              ? Object(target)['closest']?.call(target, '[jiso-hover-card]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
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
              ? Object(target)['closest']?.call(target, '[jiso-hover-card]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'open');
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
              ? Object(target)['closest']?.call(target, '[jiso-hover-card]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
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
              ? Object(target)['closest']?.call(target, '[jiso-hover-card]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'open');
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
              ? Object(target)['closest']?.call(target, '[jiso-hover-card]')
              : undefined;
            const content = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-hover-card-content')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="hover-card-open"]')
              : undefined;

            if (trigger) {
              Object(trigger)['setAttribute']?.call(trigger, 'data-state', 'closed');
            }
            if (content) {
              Object(content)['hidePopover']?.call(content);
              content['hidden'] = true;
              Object(content)['setAttribute']?.call(content, 'data-state', 'closed');
            }
            if (output) output['textContent'] = 'closed';
          }}
        >
          Ada Lovelace
        </a>
        <aside
          {...hoverCardContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
        >
          First programmer and analytical engine collaborator.
        </aside>
        <output data-demo-state="hover-card-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
