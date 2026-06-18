// @kovojs-ir - lowered from examples/gallery/src/interactive/progress-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryProgressDemo$progress_aria_valuetext_derive = derive(['state'], (state: any) =>
  state.value === null ? 'Upload pending' : `${state.value} percent uploaded`,
);
export const GalleryProgressDemo$progress_data_state_derive = derive(['state'], (state: any) =>
  state.value === null ? 'indeterminate' : state.value === 100 ? 'complete' : 'loading',
);
export const GalleryProgressDemo$progress_data_value_derive = derive(['state'], (state: any) =>
  state.value === null ? undefined : String(state.value),
);
export const GalleryProgressDemo$progress_value_derive = derive(['state'], (state: any) =>
  state.value === null ? undefined : state.value,
);
export const GalleryProgressDemo$output_text_derive = derive(['state'], (state: any) =>
  state.value === null ? 'pending' : `${state.value}%`,
);

import { component } from '@kovojs/core';
import { progressRootAttributes } from '@kovojs/headless-ui/progress';
import { progressClasses } from '@kovojs/ui/progress';

// PROGRESS_CLASS comes from @kovojs/ui/progress; the wrapper and control buttons
// keep local demo layout classes because they are not the progress component surface.
const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950';
const PROGRESS_CLASS = progressClasses.join(' ');
const BUTTON_CLASS =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-950 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 disabled:pointer-events-none disabled:opacity-50';

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
        class={ROOT_CLASS}
        data-gallery-interactive="progress"
        kovo-c="gallery-progress-demo"
        kovo-state='{"value":40}'
      >
        <label for="gallery-progress-value">Upload progress</label>
        <progress
          class={PROGRESS_CLASS}
          id="gallery-progress-value"
          {...progressRootAttributes({ max: 100, value: state.value, valueText })}
          aria-valuetext={
            state.value === null ? 'Upload pending' : `${state.value} percent uploaded`
          }
          data-bind:aria-valuetext="/c/__v/cce5b0f8/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$progress_aria_valuetext_derive"
          data-state={
            state.value === null ? 'indeterminate' : state.value === 100 ? 'complete' : 'loading'
          }
          data-bind:data-state="/c/__v/cce5b0f8/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$progress_data_state_derive"
          data-value={state.value === null ? undefined : String(state.value)}
          data-bind:data-value="/c/__v/cce5b0f8/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$progress_data_value_derive"
          value={state.value === null ? undefined : state.value}
          data-bind:value="/c/__v/cce5b0f8/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$progress_value_derive"
        />
        <div class="inline-flex gap-2">
          <button
            type="button"
            class={BUTTON_CLASS}
            on:click="/c/__v/cce5b0f8/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$button_click"
          >
            Complete upload
          </button>
          <button
            type="button"
            class={BUTTON_CLASS}
            on:click="/c/__v/cce5b0f8/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$button_click_2"
          >
            Mark pending
          </button>
        </div>
        <output
          data-demo-state="progress-value"
          data-bind="/c/__v/cce5b0f8/examples/gallery/src/generated/interactive/progress-demo.client.js#GalleryProgressDemo$output_text_derive"
        >
          {state.value === null ? 'pending' : `${state.value}%`}
        </output>
      </section>
    );
  },
});
GalleryProgressDemo.name = 'generated/interactive/progress-demo/gallery-progress-demo';
