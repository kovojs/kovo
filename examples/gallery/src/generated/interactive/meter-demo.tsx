// @kovojs-ir - lowered from examples/gallery/src/interactive/meter-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

export const GalleryMeterDemo$meter_aria_valuetext_derive = derive(
  ['state'],
  (state: any) => `${state.value} percent capacity`,
);
export const GalleryMeterDemo$meter_data_state_derive = derive(
  ['state'],
  (state: any) => state.dataState,
);
export const GalleryMeterDemo$meter_data_value_derive = derive(['state'], (state: any) =>
  String(state.value),
);
export const GalleryMeterDemo$meter_value_derive = derive(['state'], (state: any) => state.value);
export const GalleryMeterDemo$output_text_derive = derive(['state'], (state: any) =>
  String(state.value),
);

import { component } from '@kovojs/core';
import {
  meterRootAttributes,
  meterValueState as _meterValueState,
  type MeterDataState,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/meter.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
// METER_CLASS is the styled gauge; the wrapper/label/button have no @kovojs/ui
// counterpart, so they use the @kovojs/ui button base (packages/ui/src/button.tsx)
// and sensible layout utilities.
const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950';
const METER_CLASS =
  'h-2 w-full accent-emerald-600 data-[state=suboptimum]:accent-amber-500 data-[state=even-less-good]:accent-red-600';
const BUTTON_CLASS =
  'inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none disabled:opacity-50';

export interface GalleryMeterDemoState {
  dataState: MeterDataState;
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryMeterDemo = component({
  state: () => ({ dataState: 'suboptimum' as MeterDataState, value: 72 }),
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
        kovo-c="gallery-meter-demo"
        kovo-state='{"dataState":"suboptimum","value":72}'
      >
        <label for="gallery-meter-value">Storage capacity</label>
        <meter
          {...meterRootAttributes(meterState)}
          aria-valuetext={`${state.value} percent capacity`}
          data-bind:aria-valuetext="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=6a787584#GalleryMeterDemo$meter_aria_valuetext_derive"
          class={METER_CLASS}
          data-state={state.dataState}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=6a787584#GalleryMeterDemo$meter_data_state_derive"
          data-value={String(state.value)}
          data-bind:data-value="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=6a787584#GalleryMeterDemo$meter_data_value_derive"
          id="gallery-meter-value"
          value={state.value}
          data-bind:value="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=6a787584#GalleryMeterDemo$meter_value_derive"
        />
        <button
          type="button"
          class={BUTTON_CLASS}
          on:click="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=6a787584#GalleryMeterDemo$button_click"
        >
          Optimize capacity
        </button>
        <output
          data-demo-state="meter-value"
          data-bind="/c/examples/gallery/src/generated/interactive/meter-demo.client.js?v=6a787584#GalleryMeterDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </section>
    );
  },
});
