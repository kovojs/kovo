/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { toggleTriggerClick as _toggleTriggerClick } from '@kovojs/headless-ui/toggle';
import { toggleClasses } from '@kovojs/ui/toggle';

const BUTTON_CLASS = toggleClasses[0];

export interface GalleryToggleDemoState {
  pressed: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. The emitted lowered TSX and
// client module under src/generated/interactive are compiler artifacts.
export const GalleryToggleDemo = component({
  state: () => ({ pressed: false }),
  render: (_queries: Record<string, never>, state: GalleryToggleDemoState) => (
    <section class="grid gap-2 text-sm text-neutral-950" data-gallery-interactive="toggle">
      <button
        aria-label="Toggle gallery density"
        aria-pressed={String(state.pressed)}
        class={BUTTON_CLASS}
        data-state={state.pressed ? 'pressed' : 'off'}
        onClick={() => {
          const result = _toggleTriggerClick(Object(event), { pressed: state.pressed });
          if (!result) return;
          state.pressed = result.pressed;
        }}
        type="button"
      >
        Dense rows
      </button>
      <output class="text-xs text-neutral-500" data-demo-state="pressed">
        {state.pressed ? 'pressed' : 'off'}
      </output>
    </section>
  ),
});
