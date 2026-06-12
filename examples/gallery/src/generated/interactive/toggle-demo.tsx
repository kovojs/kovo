// @jiso-ir - lowered from examples/gallery/src/interactive/toggle-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
      <section
        class="grid gap-2"
        data-gallery-interactive="toggle"
        fw-c="gallery-toggle-demo"
        fw-state='{"pressed":false}'
      >
        <button
          {...attrs}
          aria-label="Toggle gallery density"
          on:click="/c/examples/gallery/src/generated/interactive/toggle-demo.client.js?v=359e44f6#GalleryToggleDemo$button_click"
        >
          Dense rows
        </button>
        <output data-demo-state="pressed">{state.pressed ? 'pressed' : 'off'}</output>
      </section>
    );
  },
});
