// @jiso-ir - lowered from examples/gallery/src/interactive/meter-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { meterRootAttributes } from '@jiso/headless-ui/primitives';

export interface GalleryMeterDemoState {
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryMeterDemo = component('gallery-meter-demo', {
  state: () => ({ value: 72 }),
  render: (_queries: Record<string, never>, state: GalleryMeterDemoState) => {
    const meterState = {
      high: 80,
      low: 40,
      max: 100,
      min: 0,
      optimum: 90,
      value: state.value,
      valueText: `${state.value} percent capacity`,
    };

    return (
      <section
        class="grid gap-2"
        data-gallery-interactive="meter"
        fw-c="gallery-meter-demo"
        fw-state='{"value":72}'
      >
        <label for="gallery-meter-value">Storage capacity</label>
        <meter {...meterRootAttributes(meterState)} id="gallery-meter-value" />
        <button
          type="button"
          on:click="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=b474bee1#GalleryMeterDemo$button_click"
        >
          Optimize capacity
        </button>
        <output data-demo-state="meter-value">{String(state.value)}</output>
      </section>
    );
  },
});
