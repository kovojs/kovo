// @jiso-ir - lowered from examples/gallery/src/interactive/progress-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { progressRootAttributes } from '@jiso/headless-ui/primitives';

export interface GalleryProgressDemoState {
  value: number | null;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryProgressDemo = component('gallery-progress-demo', {
  state: () => ({ value: 40 }),
  render: (_queries: Record<string, never>, state: GalleryProgressDemoState) => {
    const valueText = state.value === null ? 'Upload pending' : `${state.value} percent uploaded`;

    return (
      <section
        class="grid gap-2"
        data-gallery-interactive="progress"
        fw-c="gallery-progress-demo"
        fw-state='{"value":40}'
      >
        <label for="gallery-progress-value">Upload progress</label>
        <progress
          {...progressRootAttributes({ max: 100, value: state.value, valueText })}
          id="gallery-progress-value"
        />
        <div class="inline-flex gap-2">
          <button
            type="button"
            on:click="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=a4ef39ea#GalleryProgressDemo$button_click"
          >
            Complete upload
          </button>
          <button
            type="button"
            on:click="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=a4ef39ea#GalleryProgressDemo$button_click_2"
          >
            Mark pending
          </button>
        </div>
        <output data-demo-state="progress-value">
          {state.value === null ? 'pending' : `${state.value}%`}
        </output>
      </section>
    );
  },
});
