// @kovojs-ir - lowered from examples/gallery/src/interactive/progress-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryProgressDemo$Progress_aria_valuetext_derive = derive(['state'], (state: any) =>
  state.value === null ? 'Upload pending' : `${state.value} percent uploaded`,
);
export const GalleryProgressDemo$Progress_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryProgressDemo$output_text_derive = derive(['state'], (state: any) =>
  state.value === null ? 'pending' : `${state.value}%`,
);

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
        style="display:grid;gap:0.5rem;font-size:0.875rem;color:#0a0a0a"
        data-gallery-interactive="progress"
        kovo-c="gallery-progress-demo"
        kovo-state='{"value":40}'
      >
        <label for="gallery-progress-value">Upload progress</label>
        <Progress
          id="gallery-progress-value"
          max={100}
          valueText={valueText}
          aria-valuetext={
            state.value === null ? 'Upload pending' : `${state.value} percent uploaded`
          }
          data-bind:aria-valuetext="/c/__v/fb6e5dee/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$Progress_aria_valuetext_derive"
          value={state.value}
          data-bind:value="/c/__v/fb6e5dee/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$Progress_value_derive"
        >
          Upload progress
        </Progress>
        <div style="display:inline-flex;gap:0.5rem">
          <Button
            type="button"
            variant="secondary"
            on:click="/c/__v/fb6e5dee/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$Button_click"
          >
            Complete upload
          </Button>
          <Button
            type="button"
            variant="secondary"
            on:click="/c/__v/fb6e5dee/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$Button_click_2"
          >
            Mark pending
          </Button>
        </div>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="progress-value"
          data-bind="/c/__v/fb6e5dee/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$output_text_derive"
        >
          {state.value === null ? 'pending' : `${state.value}%`}
        </output>
      </section>
    );
  },
});
GalleryProgressDemo.name = 'generated/interactive/progress-demo/gallery-progress-demo';
