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
      <section class="grid gap-2" data-gallery-interactive="meter">
        <label for="gallery-meter-value">Storage capacity</label>
        <meter {...meterRootAttributes(meterState)} id="gallery-meter-value" />
        <button
          type="button"
          onClick={() => {
            state.value = state.value === 92 ? 72 : 92;
            const doc = Reflect['get'](globalThis, 'document');
            const meter = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-meter-value')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="meter-value"]')
              : undefined;

            if (meter) {
              meter['value'] = state.value;
              Object(meter)['setAttribute']?.call(meter, 'value', String(state.value));
              Object(meter)['setAttribute']?.call(meter, 'data-value', String(state.value));
              Object(meter)['setAttribute']?.call(
                meter,
                'data-state',
                state.value === 92 ? 'optimum' : 'suboptimum',
              );
              Object(meter)['setAttribute']?.call(
                meter,
                'aria-valuetext',
                `${state.value} percent capacity`,
              );
            }
            if (output) output['textContent'] = String(state.value);
          }}
        >
          Optimize capacity
        </button>
        <output data-demo-state="meter-value">{String(state.value)}</output>
      </section>
    );
  },
});
