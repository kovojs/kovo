/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { progressRootAttributes } from '@jiso/headless-ui/primitives';

export interface GalleryProgressDemoState {
  value: number | null;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryProgressDemo = component('gallery-progress-demo', {
  state: () => ({ value: 40 }),
  render: (_queries: Record<string, never>, state: GalleryProgressDemoState) => {
    const valueText = state.value === null ? 'Upload pending' : `${state.value} percent uploaded`;

    return (
      <section class="grid gap-2" data-gallery-interactive="progress">
        <label for="gallery-progress-value">Upload progress</label>
        <progress
          {...progressRootAttributes({ max: 100, value: state.value, valueText })}
          id="gallery-progress-value"
        />
        <div class="inline-flex gap-2">
          <button
            type="button"
            onClick={() => {
              state.value = state.value === 100 ? 40 : 100;
              const doc = Reflect['get'](globalThis, 'document');
              const progress = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-progress-value')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="progress-value"]')
                : undefined;
              const text = `${state.value} percent uploaded`;

              if (progress) {
                progress['value'] = state.value;
                Object(progress)['setAttribute']?.call(progress, 'value', String(state.value));
                Object(progress)['setAttribute']?.call(progress, 'data-value', String(state.value));
                Object(progress)['setAttribute']?.call(
                  progress,
                  'data-state',
                  state.value === 100 ? 'complete' : 'loading',
                );
                Object(progress)['setAttribute']?.call(progress, 'aria-valuetext', text);
              }
              if (output) output['textContent'] = `${state.value}%`;
            }}
          >
            Complete upload
          </button>
          <button
            type="button"
            onClick={() => {
              state.value = null;
              const doc = Reflect['get'](globalThis, 'document');
              const progress = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-progress-value')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="progress-value"]')
                : undefined;

              if (progress) {
                Object(progress)['removeAttribute']?.call(progress, 'value');
                Object(progress)['removeAttribute']?.call(progress, 'data-value');
                Object(progress)['setAttribute']?.call(progress, 'data-state', 'indeterminate');
                Object(progress)['setAttribute']?.call(
                  progress,
                  'aria-valuetext',
                  'Upload pending',
                );
              }
              if (output) output['textContent'] = 'pending';
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
