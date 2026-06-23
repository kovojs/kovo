/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { toggleTriggerClick as _toggleTriggerClick } from '@kovojs/headless-ui/toggle';
import { Toggle } from '@kovojs/ui/toggle';

export interface GalleryToggleDemoState {
  pressed: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. The emitted lowered TSX and
// emitted client modules are compiler artifacts.
export const GalleryToggleDemo = component({
  state: () => ({ pressed: false }),
  render: (_queries: Record<string, never>, state: GalleryToggleDemoState) => (
    <section
      style="display:flex;flex-direction:column;align-items:flex-start;gap:0.5rem;font-size:0.875rem;color:var(--ink,#0a0a0a)"
      data-gallery-interactive="toggle"
    >
      <Toggle
        aria-label="Toggle gallery density"
        onClick={() => {
          const result = _toggleTriggerClick(Object(event), { pressed: state.pressed });
          if (!result) return;
          state.pressed = result.pressed;
        }}
        pressed={state.pressed}
      >
        Dense rows
      </Toggle>
      <output
        style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
        data-demo-state="pressed"
      >
        {state.pressed ? 'pressed' : 'off'}
      </output>
    </section>
  ),
});
