/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  hoverCardContentAttributes,
  hoverCardContentPointerEnter as _hoverCardContentPointerEnter,
  hoverCardContentPointerLeave as _hoverCardContentPointerLeave,
  hoverCardEscapeKeyDown as _hoverCardEscapeKeyDown,
  hoverCardRootAttributes,
  hoverCardTriggerBlur as _hoverCardTriggerBlur,
  hoverCardTriggerFocus as _hoverCardTriggerFocus,
  hoverCardTriggerAttributes,
  hoverCardTriggerPointerEnter as _hoverCardTriggerPointerEnter,
  hoverCardTriggerPointerLeave as _hoverCardTriggerPointerLeave,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/hover-card.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
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
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryHoverCardDemo = component({
  state: () => ({ open: false }),
  render: (_queries: Record<string, never>, state: GalleryHoverCardDemoState) => {
    const contentId = 'gallery-hover-card-content';

    return (
      <section
        {...hoverCardRootAttributes({ open: state.open })}
        class={ROOT_CLASS}
        data-gallery-interactive="hover-card"
        data-state={state.open ? 'open' : 'closed'}
      >
        <a
          {...hoverCardTriggerAttributes({ contentId, open: state.open })}
          class={TRIGGER_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          href="#hover-card-demo"
          onBlur={() => {
            const result = _hoverCardTriggerBlur(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onFocus={() => {
            const result = _hoverCardTriggerFocus(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onKeyDown={() => {
            const result = _hoverCardEscapeKeyDown(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerEnter={() => {
            const result = _hoverCardTriggerPointerEnter(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerLeave={() => {
            return new Promise((resolve) => {
              setTimeout(() => {
                const result = _hoverCardTriggerPointerLeave(Object(event), { open: state.open });
                if (result) state.open = result.open;
                resolve(undefined);
              }, 150);
            });
          }}
        >
          Ada Lovelace
        </a>
        <aside
          {...hoverCardContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
          onPointerEnter={() => {
            const result = _hoverCardContentPointerEnter(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerLeave={() => {
            const result = _hoverCardContentPointerLeave(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
        >
          First programmer and analytical engine collaborator.
        </aside>
        <output data-demo-state="hover-card-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
