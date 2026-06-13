/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  hoverCardContentAttributes,
  hoverCardRootAttributes,
  hoverCardTriggerAttributes,
} from '@jiso/headless-ui/primitives';

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
        class="inline-grid gap-2"
        data-gallery-interactive="hover-card"
      >
        <a
          {...hoverCardTriggerAttributes({ contentId, open: state.open })}
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
              Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'false');
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
              Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'true');
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
              Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'false');
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
              Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'true');
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
              Object(trigger)['setAttribute']?.call(trigger, 'aria-expanded', 'false');
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
        <aside {...hoverCardContentAttributes({ contentId, open: state.open })}>
          First programmer and analytical engine collaborator.
        </aside>
        <output data-demo-state="hover-card-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
