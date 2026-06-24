/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  sliderInput as _sliderInput,
  sliderKeyDown as _sliderKeyDown,
  sliderThumbDrag as _sliderThumbDrag,
  sliderThumbDragStart as _sliderThumbDragStart,
  sliderTrackPointerDown as _sliderTrackPointerDown,
} from '@kovojs/headless-ui/slider';
import { Slider, SliderInput, SliderRange, SliderThumb, SliderTrack } from '@kovojs/ui/slider';

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
      step: 1,
      value: state.value,
      valueText: `${state.value} percent`,
    };

    return (
      <div
        data-gallery-interactive="slider"
        data-value={String(state.value)}
        style="display:grid;gap:0.5rem;width:min(22rem,100%)"
      >
        <form id="gallery-slider-form" data-gallery-form="slider" />
        <label
          id="gallery-slider-label"
          style="font-size:0.875rem;font-weight:500;line-height:1;color:var(--ink,#171717)"
        >
          Completion
        </label>
        <Slider {...sliderState}>
          <SliderInput
            {...sliderState}
            id="gallery-slider-input"
            styles={{ input: { pointerEvents: 'none' } }}
            value={state.value}
            onInput={() => {
              const result = _sliderInput(Object(event), {
                max: 100,
                min: 0,
                step: 1,
                value: state.value,
              });
              if (!result?.changed) return;
              state.value = result.value;
            }}
          />
          <SliderTrack
            {...sliderState}
            data-value={String(state.value)}
            data-value-ratio={String(state.value / 100)}
            onPointerDown={() => {
              const result = _sliderTrackPointerDown(Object(event), {
                max: 100,
                min: 0,
                step: 1,
                value: state.value,
              });
              if (!result?.changed) return;
              state.value = result.value;
            }}
          >
            <SliderRange
              {...sliderState}
              data-value={String(state.value)}
              data-value-ratio={String(state.value / 100)}
              style={{ width: `${state.value}%` }}
            />
            <SliderThumb
              {...sliderState}
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
                  step: 1,
                  value: state.value,
                });
                if (!result?.changed) return;
                state.value = result.value;
              }}
              onPointerDown={() => {
                const result = _sliderThumbDragStart(Object(event), {
                  max: 100,
                  min: 0,
                  step: 1,
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
                    step: 1,
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
          </SliderTrack>
          <output
            data-demo-state="slider-value"
            style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          >
            {String(state.value)}
          </output>
        </Slider>
      </div>
    );
  },
});
