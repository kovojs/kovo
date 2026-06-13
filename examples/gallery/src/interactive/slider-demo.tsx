/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  sliderInputAttributes,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
} from '@jiso/headless-ui/primitives';

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
        class="grid gap-2"
        data-gallery-interactive="slider"
      >
        <form id="gallery-slider-form" data-gallery-form="slider" />
        <label for="gallery-slider-input">Completion</label>
        <input
          {...sliderInputAttributes(sliderState)}
          id="gallery-slider-input"
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
        <div {...sliderTrackAttributes(sliderState)}>
          <span {...sliderRangeAttributes(sliderState)} />
          <span {...sliderThumbAttributes(sliderState)} />
        </div>
        <output data-demo-state="slider-value">{String(state.value)}</output>
      </section>
    );
  },
});
