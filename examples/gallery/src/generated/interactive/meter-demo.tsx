// @jiso-ir - lowered from examples/gallery/src/interactive/meter-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryMeterDemo$output_text_derive = derive(['state'], (state: any) =>
  String(state.value),
);

import { component } from '@jiso/core';
import { meterRootAttributes } from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/meter.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
// METER_CLASS is the styled gauge; the wrapper/label/button have no @jiso/ui
// counterpart, so they use the @jiso/ui button base (packages/ui/src/button.tsx)
// and sensible layout utilities.
const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950';
const METER_CLASS =
  'h-2 w-full accent-emerald-600 data-[state=suboptimum]:accent-amber-500 data-[state=even-less-good]:accent-red-600';
const BUTTON_CLASS =
  'inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none disabled:opacity-50';

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
        class={ROOT_CLASS}
        data-gallery-interactive="meter"
        fw-c="gallery-meter-demo"
        fw-state='{"value":72}'
      >
        <label for="gallery-meter-value">Storage capacity</label>
        <meter {...meterRootAttributes(meterState)} class={METER_CLASS} id="gallery-meter-value" />
        <button
          type="button"
          class={BUTTON_CLASS}
          on:click="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=c7496eb3#GalleryMeterDemo$button_click"
        >
          Optimize capacity
        </button>
        <output
          data-demo-state="meter-value"
          data-bind="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=c7496eb3#GalleryMeterDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </section>
    );
  },
});
