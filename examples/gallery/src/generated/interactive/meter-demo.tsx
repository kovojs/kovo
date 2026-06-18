// @kovojs-ir - lowered from examples/gallery/src/interactive/meter-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

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
import { meterRootAttributes, type MeterDataState } from '@kovojs/headless-ui/meter';
import { meterClasses } from '@kovojs/ui/meter';

// METER_CLASS comes from @kovojs/ui/meter; the wrapper and control button keep
// local demo layout classes because they are not the meter component surface.
const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950';
const METER_CLASS = meterClasses.join(' ');
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
          class={METER_CLASS}
          id="gallery-meter-value"
          {...meterRootAttributes(meterState)}
          aria-valuetext={`${state.value} percent capacity`}
          data-bind:aria-valuetext="/c/__v/683e2539/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$meter_aria_valuetext_derive"
          data-state={state.dataState}
          data-bind:data-state="/c/__v/683e2539/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$meter_data_state_derive"
          data-value={String(state.value)}
          data-bind:data-value="/c/__v/683e2539/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$meter_data_value_derive"
          value={state.value}
          data-bind:value="/c/__v/683e2539/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$meter_value_derive"
        />
        <button
          type="button"
          class={BUTTON_CLASS}
          on:click="/c/__v/683e2539/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$button_click"
        >
          Optimize capacity
        </button>
        <output
          data-demo-state="meter-value"
          data-bind="/c/__v/683e2539/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </section>
    );
  },
});
GalleryMeterDemo.name = 'generated/interactive/meter-demo/gallery-meter-demo';
