/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { Button } from '@kovojs/ui/button';
import { Progress } from '@kovojs/ui/progress';

export interface GalleryProgressDemoState {
  value: number | null;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryProgressDemo = component({
  state: () => ({ value: 40 }),
  render: (_queries: Record<string, never>, state: GalleryProgressDemoState) => {
    const valueText = state.value === null ? 'Upload pending' : `${state.value} percent uploaded`;

    return (
      <section
        style="display:grid;gap:0.5rem;font-size:0.875rem;color:var(--ink,#0a0a0a)"
        data-gallery-interactive="progress"
      >
        <label for="gallery-progress-value">Upload progress</label>
        <Progress
          aria-valuetext={
            state.value === null ? 'Upload pending' : `${state.value} percent uploaded`
          }
          // Reactive fill: written at the call site so the compiler emits
          // data-bind:style / data-bind:data-state, which the styled component
          // forwards to its visible indicator span (bindingProps). Without this
          // the bar is painted once at SSR and the buttons appear to do nothing.
          data-state={
            state.value === null ? 'indeterminate' : state.value >= 100 ? 'complete' : 'loading'
          }
          id="gallery-progress-value"
          max={100}
          style={{ width: state.value === null ? '40%' : `${state.value}%` }}
          value={state.value}
          valueText={valueText}
        >
          Upload progress
        </Progress>
        <div style="display:inline-flex;gap:0.5rem">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              state.value = state.value === 100 ? 40 : 100;
            }}
          >
            Complete upload
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              state.value = null;
            }}
          >
            Mark pending
          </Button>
        </div>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="progress-value"
        >
          {state.value === null ? 'pending' : `${state.value}%`}
        </output>
      </section>
    );
  },
});
