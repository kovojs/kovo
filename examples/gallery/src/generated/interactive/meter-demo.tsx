// @kovojs-ir - lowered from examples/gallery/src/interactive/meter-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryMeterDemo$Meter_aria_valuetext_derive = derive(
  ['state'],
  (state: any) => `${state.value} percent capacity`,
);
export const GalleryMeterDemo$Meter_data_state_derive = derive(
  ['state'],
  (state: any) => state.dataState,
);
export const GalleryMeterDemo$Meter_value_derive = derive(['state'], (state: any) => state.value);
export const GalleryMeterDemo$output_text_derive = derive(['state'], (state: any) =>
  String(state.value),
);

import { component } from '@kovojs/core';
import { Button } from '@kovojs/ui/button';
import { type MeterDataState } from '@kovojs/headless-ui/meter';
import { Meter } from '@kovojs/ui/meter';

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
        style="display:grid;gap:0.5rem;font-size:0.875rem;color:#0a0a0a"
        data-gallery-interactive="meter"
        kovo-c="gallery-meter-demo"
        kovo-state='{"dataState":"suboptimum","value":72}'
      >
        <label for="gallery-meter-value">Storage capacity</label>
        <Meter
          high={meterState.high}
          id="gallery-meter-value"
          low={meterState.low}
          max={meterState.max}
          min={meterState.min}
          optimum={meterState.optimum}
          valueText={meterState.valueText}
          aria-valuetext={`${state.value} percent capacity`}
          data-bind:aria-valuetext="/c/__v/aa2f4d9a/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$Meter_aria_valuetext_derive"
          data-state={state.dataState}
          data-bind:data-state="/c/__v/aa2f4d9a/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$Meter_data_state_derive"
          value={state.value}
          data-bind:value="/c/__v/aa2f4d9a/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$Meter_value_derive"
        >
          Storage capacity
        </Meter>
        <Button
          type="button"
          variant="secondary"
          on:click="/c/__v/aa2f4d9a/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$Button_click"
        >
          Optimize capacity
        </Button>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="meter-value"
          data-bind="/c/__v/aa2f4d9a/examples/gallery/src/generated/interactive/meter-demo.client.js#GalleryMeterDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </section>
    );
  },
});
GalleryMeterDemo.name = 'generated/interactive/meter-demo/gallery-meter-demo';
