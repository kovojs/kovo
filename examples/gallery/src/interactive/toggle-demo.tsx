/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { toggleTriggerClick as _toggleTriggerClick } from '@kovojs/headless-ui/toggle';
import { Toggle } from '@kovojs/ui/toggle';

export interface GalleryToggleDemoState {
  pressed: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. The emitted lowered TSX and
// client module under src/generated/interactive are compiler artifacts.
export const GalleryToggleDemo = component({
  state: () => ({ pressed: false }),
  render: (_queries: Record<string, never>, state: GalleryToggleDemoState) => (
    <section class="grid gap-2 text-sm text-neutral-950" data-gallery-interactive="toggle">
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
      <output class="text-xs text-neutral-500" data-demo-state="pressed">
        {state.pressed ? 'pressed' : 'off'}
      </output>
    </section>
  ),
});
