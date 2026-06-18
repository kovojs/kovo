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
} from '@kovojs/headless-ui/tooltip';
import { tooltipClasses, tooltipTriggerClasses, tooltipContentClasses } from '@kovojs/ui/tooltip';

const ROOT_CLASS = tooltipClasses.join(' ');
const TRIGGER_CLASS = tooltipTriggerClasses.join(' ');
const CONTENT_CLASS = tooltipContentClasses.join(' ');

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
