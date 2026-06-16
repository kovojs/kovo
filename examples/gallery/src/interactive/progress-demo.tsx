/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { progressRootAttributes } from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/progress.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
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
export const GalleryProgressDemo = component('gallery-progress-demo', {
  state: () => ({ value: 40 }),
  render: (_queries: Record<string, never>, state: GalleryProgressDemoState) => {
    const valueText = state.value === null ? 'Upload pending' : `${state.value} percent uploaded`;

    return (
      <section class={ROOT_CLASS} data-gallery-interactive="progress">
        <label for="gallery-progress-value">Upload progress</label>
        <progress
          {...progressRootAttributes({ max: 100, value: state.value, valueText })}
          aria-valuetext={
            state.value === null ? 'Upload pending' : `${state.value} percent uploaded`
          }
          class={PROGRESS_CLASS}
          data-state={
            state.value === null ? 'indeterminate' : state.value === 100 ? 'complete' : 'loading'
          }
          data-value={state.value === null ? undefined : String(state.value)}
          id="gallery-progress-value"
          value={state.value === null ? undefined : state.value}
        />
        <div class="inline-flex gap-2">
          <button
            type="button"
            class={BUTTON_CLASS}
            onClick={() => {
              state.value = state.value === 100 ? 40 : 100;
            }}
          >
            Complete upload
          </button>
          <button
            type="button"
            class={BUTTON_CLASS}
            onClick={() => {
              state.value = null;
            }}
          >
            Mark pending
          </button>
        </div>
        <output data-demo-state="progress-value">
          {state.value === null ? 'pending' : `${state.value}%`}
        </output>
      </section>
    );
  },
});
