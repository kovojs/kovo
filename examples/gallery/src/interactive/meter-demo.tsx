/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Button } from '@kovojs/ui/button';
import {
  Meter,
  meterValueState as _meterValueState,
  type MeterDataState,
} from '@kovojs/ui/meter';

const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950';

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
      <section class={ROOT_CLASS} data-gallery-interactive="meter">
        <label for="gallery-meter-value">Storage capacity</label>
        <Meter
          aria-valuetext={`${state.value} percent capacity`}
          data-state={state.dataState}
          high={meterState.high}
          id="gallery-meter-value"
          low={meterState.low}
          max={meterState.max}
          min={meterState.min}
          optimum={meterState.optimum}
          value={state.value}
          valueText={meterState.valueText}
        >
          Storage capacity
        </Meter>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const value = state.value === 92 ? 72 : 92;
            state.value = value;
            state.dataState = _meterValueState({
              high: 80,
              low: 40,
              max: 100,
              min: 0,
              optimum: 90,
              value,
            }).state;
          }}
        >
          Optimize capacity
        </Button>
        <output data-demo-state="meter-value">{String(state.value)}</output>
      </section>
    );
  },
});
