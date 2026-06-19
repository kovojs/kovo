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
      style="display:grid;gap:0.5rem;font-size:0.875rem;color:#0a0a0a"
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
        style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
        data-demo-state="pressed"
      >
        {state.pressed ? 'pressed' : 'off'}
      </output>
    </section>
  ),
});
