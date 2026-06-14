/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  sliderInputAttributes,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/slider.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950 data-[orientation=vertical]:inline-grid';
const INPUT_CLASS =
  'h-2 w-full accent-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-2';
const TRACK_CLASS =
  'relative h-2 w-full overflow-hidden rounded-full bg-neutral-200 data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-2';
const RANGE_CLASS = 'block h-full rounded-full bg-neutral-950 data-[orientation=vertical]:w-full';
const THUMB_CLASS =
  'block h-4 w-4 rounded-full border border-neutral-300 bg-white shadow-sm data-[disabled]:opacity-50';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';
const OUTPUT_CLASS = 'text-xs text-neutral-500';

export interface GallerySliderDemoState {
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GallerySliderDemo = component('gallery-slider-demo', {
  state: () => ({ value: 25 }),
  render: (_queries: Record<string, never>, state: GallerySliderDemoState) => {
    const sliderState = {
      form: 'gallery-slider-form',
      label: 'Completion',
      max: 100,
      min: 0,
      name: 'gallery-completion',
      step: 25,
      value: state.value,
      valueText: `${state.value} percent`,
    };

    return (
      <section
        {...sliderRootAttributes(sliderState)}
        class={ROOT_CLASS}
        data-gallery-interactive="slider"
      >
        <form id="gallery-slider-form" data-gallery-form="slider" />
        <label for="gallery-slider-input" class={LABEL_CLASS}>
          Completion
        </label>
        <input
          {...sliderInputAttributes(sliderState)}
          id="gallery-slider-input"
          class={INPUT_CLASS}
          onInput={() => {
            const doc = Reflect['get'](globalThis, 'document');
            const delegatedEvent = event;
            const eventTarget =
              delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'target');
            const eventValue =
              eventTarget === null || eventTarget === undefined
                ? state.value
                : +Reflect['get'](Object(eventTarget), 'value');
            const nextValue = eventValue === eventValue ? eventValue : state.value;
            state.value =
              nextValue <= 12.5
                ? 0
                : nextValue <= 37.5
                  ? 25
                  : nextValue <= 62.5
                    ? 50
                    : nextValue <= 87.5
                      ? 75
                      : 100;
            const root = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-gallery-interactive="slider"]')
              : undefined;
            const input = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-slider-input')
              : undefined;
            const track = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-part="track"]')
              : undefined;
            const range = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-part="range"]')
              : undefined;
            const thumb = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-part="thumb"]')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="slider-value"]')
              : undefined;
            const ratio = String(state.value / 100);

            if (root) Object(root)['setAttribute']?.call(root, 'data-value', String(state.value));
            if (input) {
              input['value'] = String(state.value);
              Object(input)['setAttribute']?.call(
                input,
                'aria-valuetext',
                `${state.value} percent`,
              );
              Object(input)['setAttribute']?.call(input, 'data-value', String(state.value));
            }
            if (track) {
              Object(track)['setAttribute']?.call(track, 'data-value', String(state.value));
              Object(track)['setAttribute']?.call(track, 'data-value-ratio', ratio);
            }
            if (range) {
              Object(range)['setAttribute']?.call(range, 'data-value', String(state.value));
              Object(range)['setAttribute']?.call(range, 'data-value-ratio', ratio);
            }
            if (thumb) {
              Object(thumb)['setAttribute']?.call(thumb, 'data-value', String(state.value));
              Object(thumb)['setAttribute']?.call(thumb, 'data-value-ratio', ratio);
            }
            if (output) output['textContent'] = String(state.value);
          }}
        />
        <div {...sliderTrackAttributes(sliderState)} class={TRACK_CLASS}>
          <span {...sliderRangeAttributes(sliderState)} class={RANGE_CLASS} />
          <span {...sliderThumbAttributes(sliderState)} class={THUMB_CLASS} />
        </div>
        <output data-demo-state="slider-value" class={OUTPUT_CLASS}>
          {String(state.value)}
        </output>
      </section>
    );
  },
});
