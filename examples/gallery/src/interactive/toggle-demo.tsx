/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { toggleRootAttributes } from '@jiso/headless-ui/primitives';

export interface GalleryToggleDemoState {
  pressed: boolean;
}

// SPEC.md section 5.2: this is app-authored TSX. The emitted lowered TSX and
// client module under src/generated/interactive are compiler artifacts.
export const GalleryToggleDemo = component('gallery-toggle-demo', {
  state: () => ({ pressed: false }),
  render: (_queries: Record<string, never>, state: GalleryToggleDemoState) => {
    const attrs = toggleRootAttributes({ pressed: state.pressed });

    return (
      <section class="grid gap-2" data-gallery-interactive="toggle">
        <button
          {...attrs}
          aria-label="Toggle gallery density"
          onClick={() => {
            state.pressed = !state.pressed;
          }}
        >
          Dense rows
        </button>
        <output data-demo-state="pressed">{state.pressed ? 'pressed' : 'off'}</output>
      </section>
    );
  },
});
