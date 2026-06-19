/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
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
      step: 25,
      value: state.value,
      valueText: `${state.value} percent`,
    };

    return (
      <Slider {...sliderState} data-gallery-interactive="slider" data-value={String(state.value)}>
        <form id="gallery-slider-form" data-gallery-form="slider" />
        <label
          id="gallery-slider-label"
          style="font-size:0.875rem;font-weight:500;line-height:1;color:#171717"
        >
          Completion
        </label>
        <SliderInput {...sliderState} id="gallery-slider-input" value={state.value} />
        <SliderTrack
          {...sliderState}
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
        </SliderTrack>
        <output
          data-demo-state="slider-value"
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
        >
          {String(state.value)}
        </output>
      </Slider>
    );
  },
});
