/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  tooltipContentAttributes,
  tooltipEscapeKeyDown as _tooltipEscapeKeyDown,
  tooltipRootAttributes,
  tooltipTriggerAttributes,
  tooltipTriggerBlur as _tooltipTriggerBlur,
  tooltipTriggerFocus as _tooltipTriggerFocus,
  tooltipTriggerPointerEnter as _tooltipTriggerPointerEnter,
  tooltipTriggerPointerLeave as _tooltipTriggerPointerLeave,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/tooltip.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS = 'relative inline-block text-sm text-neutral-950 data-[disabled]:opacity-50';
const TRIGGER_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-neutral-300 bg-white px-2.5 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 data-[state=open]:bg-neutral-100';
const CONTENT_CLASS =
  'mt-2 w-max max-w-64 rounded-md bg-neutral-950 px-2.5 py-1.5 text-xs text-white shadow-md data-[state=closed]:hidden';

export interface GalleryTooltipDemoState {
  open: boolean;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryTooltipDemo = component({
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
          aria-describedby={state.open ? 'gallery-tooltip-content' : null}
          data-state={state.open ? 'open' : 'closed'}
          onBlur={() => {
            const result = _tooltipTriggerBlur(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onFocus={() => {
            const result = _tooltipTriggerFocus(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onKeyDown={() => {
            const result = _tooltipEscapeKeyDown(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerEnter={() => {
            const result = _tooltipTriggerPointerEnter(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
          onPointerLeave={() => {
            const result = _tooltipTriggerPointerLeave(Object(event), { open: state.open });
            if (!result) return;
            state.open = result.open;
          }}
        >
          Shipping code
        </button>
        <span
          {...tooltipContentAttributes({ contentId, open: state.open })}
          class={CONTENT_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
        >
          Use the code printed on the packing slip.
        </span>
        <output data-demo-state="tooltip-open">{state.open ? 'open' : 'closed'}</output>
      </section>
    );
  },
});
