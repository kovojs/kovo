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
      <section style="display:grid;gap:0.5rem;font-size:0.875rem;color:#0a0a0a" data-gallery-interactive="progress">
        <label for="gallery-progress-value">Upload progress</label>
        <Progress
          aria-valuetext={
            state.value === null ? 'Upload pending' : `${state.value} percent uploaded`
          }
          id="gallery-progress-value"
          max={100}
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
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="progress-value"
        >
          {state.value === null ? 'pending' : `${state.value}%`}
        </output>
      </section>
    );
  },
});
