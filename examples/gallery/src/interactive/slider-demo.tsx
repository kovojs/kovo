/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  sliderHiddenInputAttributes,
  sliderKeyDown as _sliderKeyDown,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbDrag as _sliderThumbDrag,
  sliderThumbDragStart as _sliderThumbDragStart,
  sliderThumbAttributes,
  sliderTrackPointerDown as _sliderTrackPointerDown,
  sliderTrackAttributes,
} from '@kovojs/headless-ui/slider';
import {
  sliderClasses,
  sliderTrackClasses,
  sliderRangeClasses,
  sliderThumbClasses,
} from '@kovojs/ui/slider';

const ROOT_CLASS = sliderClasses.join(' ');
const TRACK_CLASS = sliderTrackClasses.join(' ');
const RANGE_CLASS = sliderRangeClasses.join(' ');
const THUMB_CLASS = sliderThumbClasses.join(' ');
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';
const OUTPUT_CLASS = 'text-xs text-neutral-500';

export interface GallerySliderDemoState {
  dragging: boolean;
  dragPointerStart: number;
  dragValueStart: number;
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySliderDemo = component({
  state: () => ({
    dragging: false,
    dragPointerStart: 0,
    dragValueStart: 25,
    value: 25,
  }),
  render: (_queries: Record<string, never>, state: GallerySliderDemoState) => {
    const sliderState = {
      form: 'gallery-slider-form',
      labelledBy: 'gallery-slider-label',
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
        data-value={String(state.value)}
      >
        <form id="gallery-slider-form" data-gallery-form="slider" />
        <label id="gallery-slider-label" class={LABEL_CLASS}>
          Completion
        </label>
        <input
          {...sliderHiddenInputAttributes(sliderState)}
          id="gallery-slider-input"
          value={state.value}
        />
        <div
          {...sliderTrackAttributes(sliderState)}
          class={TRACK_CLASS}
          data-value={String(state.value)}
          data-value-ratio={String(state.value / 100)}
          onPointerDown={() => {
            const result = _sliderTrackPointerDown(Object(event), {
              max: 100,
              min: 0,
              step: 25,
              value: state.value,
            });
            if (!result?.changed) return;
            state.value = result.value;
          }}
        >
          <span
            {...sliderRangeAttributes(sliderState)}
            class={RANGE_CLASS}
            data-value={String(state.value)}
            data-value-ratio={String(state.value / 100)}
            style={{ width: `${state.value}%` }}
          />
          <span
            {...sliderThumbAttributes(sliderState)}
            class={THUMB_CLASS}
            aria-valuenow={state.value}
            aria-valuetext={`${state.value} percent`}
            data-dragging={state.dragging ? '' : null}
            data-value={String(state.value)}
            data-value-ratio={String(state.value / 100)}
            style={{
              left: `${state.value}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            onKeyDown={() => {
              const result = _sliderKeyDown(Object(event), {
                max: 100,
                min: 0,
                step: 25,
                value: state.value,
              });
              if (!result?.changed) return;
              state.value = result.value;
            }}
            onPointerDown={() => {
              const result = _sliderThumbDragStart(Object(event), {
                max: 100,
                min: 0,
                step: 25,
                value: state.value,
              });
              if (!result) return;
              state.dragging = true;
              state.dragPointerStart = result.pointerStart;
              state.dragValueStart = result.valueStart;
            }}
            onPointerMove={() => {
              if (!state.dragging) return;
              const result = _sliderThumbDrag(
                Object(event),
                {
                  max: 100,
                  min: 0,
                  step: 25,
                  value: state.value,
                },
                {
                  pointerStart: state.dragPointerStart,
                  valueStart: state.dragValueStart,
                },
              );
              if (!result?.changed) return;
              state.value = result.value;
            }}
            onPointerUp={() => {
              state.dragging = false;
            }}
          />
        </div>
        <output data-demo-state="slider-value" class={OUTPUT_CLASS}>
          {String(state.value)}
        </output>
      </section>
    );
  },
});
