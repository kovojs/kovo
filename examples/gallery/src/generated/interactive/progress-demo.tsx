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

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/progress.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
// PROGRESS_CLASS is the styled bar; the wrapper/label/buttons have no @kovojs/ui
// counterpart, so they use the @kovojs/ui button base (packages/ui/src/button.tsx)
// and sensible layout utilities.
const ROOT_CLASS = 'grid gap-2 text-sm text-neutral-950';
const PROGRESS_CLASS =
  'h-2 w-full overflow-hidden rounded-full bg-neutral-200 accent-neutral-950 data-[state=complete]:accent-emerald-600 data-[state=indeterminate]:animate-pulse';
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
          data-bind:aria-valuetext="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=cce5b0f8#GalleryProgressDemo$progress_aria_valuetext_derive"
          data-state={
            state.value === null ? 'indeterminate' : state.value === 100 ? 'complete' : 'loading'
          }
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=cce5b0f8#GalleryProgressDemo$progress_data_state_derive"
          data-value={state.value === null ? undefined : String(state.value)}
          data-bind:data-value="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=cce5b0f8#GalleryProgressDemo$progress_data_value_derive"
          value={state.value === null ? undefined : state.value}
          data-bind:value="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=cce5b0f8#GalleryProgressDemo$progress_value_derive"
        />
        <div class="inline-flex gap-2">
          <button
            type="button"
            class={BUTTON_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=cce5b0f8#GalleryProgressDemo$button_click"
          >
            Complete upload
          </button>
          <button
            type="button"
            class={BUTTON_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=cce5b0f8#GalleryProgressDemo$button_click_2"
          >
            Mark pending
          </button>
        </div>
        <output
          data-demo-state="progress-value"
          data-bind="/c/examples/gallery/src/generated/interactive/progress-demo.client.js?v=cce5b0f8#GalleryProgressDemo$output_text_derive"
        >
          {state.value === null ? 'pending' : `${state.value}%`}
        </output>
      </section>
    );
  },
});
GalleryProgressDemo.name = 'generated/interactive/progress-demo/gallery-progress-demo';
