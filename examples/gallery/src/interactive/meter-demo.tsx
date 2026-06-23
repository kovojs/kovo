/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Button } from '@kovojs/ui/button';
import { Meter } from '@kovojs/ui/meter';

export interface GalleryMeterDemoState {
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryMeterDemo = component({
  state: () => ({ value: 72 }),
  render: (_queries: Record<string, never>, state: GalleryMeterDemoState) => {
    // Thresholds chosen so the default 72% lands in the same region as `optimum`
    // (both in the [low, high] middle band) → state `optimum` → green/success
    // hue, reading as a healthy filled gauge instead of the alarming brown the
    // old optimum=90 produced. Dropping below `low` (40) flips to suboptimum.
    const valueText = `${state.value} percent capacity`;

    return (
      <section
        style="display:grid;gap:0.5rem;font-size:0.875rem;color:#0a0a0a"
        data-gallery-interactive="meter"
      >
        <label for="gallery-meter-value">Storage capacity</label>
        <Meter
          aria-valuetext={`${state.value} percent capacity`}
          high={85}
          id="gallery-meter-value"
          low={40}
          max={100}
          min={0}
          optimum={70}
          value={state.value}
          valueText={valueText}
        >
          Storage capacity
        </Meter>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            state.value = state.value === 30 ? 72 : 30;
          }}
        >
          Optimize capacity
        </Button>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="meter-value"
        >
          {String(state.value)}
        </output>
      </section>
    );
  },
});
