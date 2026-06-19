/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  sliderInputAttributes,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
  type SliderOrientation,
} from '@kovojs/headless-ui/slider';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface SliderStyleOverrides {
  input?: style.StyleInput;
  range?: style.StyleInput;
  root?: style.StyleInput;
  thumb?: style.StyleInput;
  track?: style.StyleInput;
}

export interface SliderStateProps {
  disabled?: boolean;
  invalid?: boolean;
  max?: number;
  min?: number;
  name?: string;
  orientation?: SliderOrientation;
  required?: boolean;
  step?: number;
  value?: number;
}

export interface SliderProps extends SliderStateProps {
  children?: string;
  id?: string;
  styles?: SliderStyleOverrides;
}

export interface SliderInputProps extends SliderStateProps {
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  styles?: SliderStyleOverrides;
  valueText?: string;
}

export interface SliderPartProps extends SliderStateProps {
  children?: string;
  id?: string;
  styles?: SliderStyleOverrides;
}

export interface SliderThumbProps extends SliderPartProps {
  descriptionId?: string;
  errorId?: string;
  label?: string;
  labelledBy?: string;
  valueText?: string;
}

export const sliderStyles = style.create(
  {
    // Native range kept for keyboard/form/validation; visually hidden but
    // stretched over the track so it stays the pointer/focus target.
    input: {
      cursor: 'pointer',
      height: '100%',
      left: 0,
      margin: 0,
      opacity: 0,
      position: 'absolute',
      top: 0,
      width: '100%',
      zIndex: 2,
      ':disabled': {
        cursor: 'not-allowed',
      },
    },
    // Filled portion. Width/height set inline from the value ratio.
    range: {
      backgroundColor: uiTheme.color.accent,
      borderRadius: uiTheme.radius.full,
      display: 'block',
      height: '100%',
      left: 0,
      position: 'absolute',
      top: 0,
      '[data-orientation=vertical]': {
        bottom: 0,
        height: 'auto',
        top: 'auto',
        width: '100%',
      },
    },
    // Anchor box: positions the track + overlaid input + thumb on one line.
    root: {
      alignItems: 'center',
      color: uiTheme.color.foreground,
      display: 'flex',
      fontSize: 14,
      minHeight: 20,
      position: 'relative',
      touchAction: 'none',
      width: '100%',
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-invalid]': {
        color: uiTheme.color.danger.foreground,
      },
      '[data-orientation=vertical]': {
        display: 'inline-flex',
        height: 160,
        minHeight: 0,
        width: 20,
      },
    },
    // Knob. left/top set inline from the value ratio.
    thumb: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.accent,
      borderRadius: uiTheme.radius.full,
      borderStyle: 'solid',
      borderWidth: 2,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.2)',
      boxSizing: 'border-box',
      display: 'block',
      height: 16,
      marginLeft: -8,
      pointerEvents: 'none',
      position: 'absolute',
      top: '50%',
      transform: 'translateY(-50%)',
      width: 16,
      zIndex: 3,
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-orientation=vertical]': {
        left: '50%',
        marginLeft: 0,
        marginTop: -8,
        top: 'auto',
        transform: 'translateX(-50%)',
      },
    },
    track: {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
      borderRadius: uiTheme.radius.full,
      height: 6,
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
      '[data-orientation=vertical]': {
        height: '100%',
        width: 6,
      },
    },
  },
  { namespace: 'slider', source: 'slider.tsx' },
);

function valuePercent(ratio: string | undefined): string {
  const parsed = Number(ratio);
  const clamped = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
  return `${(clamped * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}

// Inline fill size for the range (filled portion grows from the start edge).
function rangeFillStyle(ratio: string | undefined, vertical: boolean): string {
  const pct = valuePercent(ratio);
  return vertical ? `height: ${pct}` : `width: ${pct}`;
}

// Inline thumb offset along the track (value-driven; updates on re-render).
function thumbOffsetStyle(ratio: string | undefined, vertical: boolean): string {
  const pct = valuePercent(ratio);
  return vertical ? `bottom: ${pct}; top: auto` : `left: ${pct}`;
}

export const sliderClasses = [style.attrs(sliderStyles.root).class ?? ''] as const;
export const sliderInputClasses = [style.attrs(sliderStyles.input).class ?? ''] as const;
export const sliderTrackClasses = [style.attrs(sliderStyles.track).class ?? ''] as const;
export const sliderRangeClasses = [style.attrs(sliderStyles.range).class ?? ''] as const;
export const sliderThumbClasses = [style.attrs(sliderStyles.thumb).class ?? ''] as const;

export const Slider = component({
  render(props: SliderProps) {
    const attrs = sliderRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(sliderStyles.root, props.styles?.root);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-max={attrs['data-max']}
        data-min={attrs['data-min']}
        data-orientation={attrs['data-orientation']}
        data-required={attrs['data-required']}
        data-value={attrs['data-value']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const SliderInput = component({
  render(props: SliderInputProps) {
    const attrs = sliderInputAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.form === undefined ? {} : { form: props.form }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.valueText === undefined ? {} : { valueText: props.valueText }),
    });
    const styleAttrs = style.attrs(sliderStyles.input, props.styles?.input);

    return (
      <input
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        aria-valuetext={attrs['aria-valuetext']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-max={attrs['data-max']}
        data-min={attrs['data-min']}
        data-orientation={attrs['data-orientation']}
        data-required={attrs['data-required']}
        data-value={attrs['data-value']}
        disabled={attrs.disabled}
        form={attrs.form}
        id={attrs.id}
        max={attrs.max}
        min={attrs.min}
        name={attrs.name}
        required={attrs.required}
        step={attrs.step}
        type={attrs.type}
        value={attrs.value}
      />
    );
  },
});

export const SliderTrack = component({
  render(props: SliderPartProps) {
    const attrs = sliderTrackAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(sliderStyles.track, props.styles?.track);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-hidden={attrs['aria-hidden']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-max={attrs['data-max']}
        data-min={attrs['data-min']}
        data-orientation={attrs['data-orientation']}
        data-part={attrs['data-part']}
        data-required={attrs['data-required']}
        data-value={attrs['data-value']}
        data-value-ratio={attrs['data-value-ratio']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const SliderRange = component({
  render(props: SliderPartProps) {
    const attrs = sliderRangeAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
    });
    const styleAttrs = style.attrs(sliderStyles.range, props.styles?.range);
    const authorStyle = (props as { style?: string }).style;
    const fill = rangeFillStyle(
      attrs['data-value-ratio'],
      attrs['data-orientation'] === 'vertical',
    );
    const inlineStyle = authorStyle ? `${fill}; ${authorStyle}` : fill;

    return (
      <span
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-hidden={attrs['aria-hidden']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-max={attrs['data-max']}
        data-min={attrs['data-min']}
        data-orientation={attrs['data-orientation']}
        data-part={attrs['data-part']}
        data-required={attrs['data-required']}
        data-value={attrs['data-value']}
        data-value-ratio={attrs['data-value-ratio']}
        id={attrs.id}
        style={inlineStyle}
      >
        {props.children}
      </span>
    );
  },
});

export const SliderThumb = component({
  render(props: SliderThumbProps) {
    const attrs = sliderThumbAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.label === undefined ? {} : { label: props.label }),
      ...(props.labelledBy === undefined ? {} : { labelledBy: props.labelledBy }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.orientation === undefined ? {} : { orientation: props.orientation }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.step === undefined ? {} : { step: props.step }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.valueText === undefined ? {} : { valueText: props.valueText }),
    });
    const styleAttrs = style.attrs(sliderStyles.thumb, props.styles?.thumb);
    const authorStyle = (props as { style?: string }).style;
    const offset = thumbOffsetStyle(
      attrs['data-value-ratio'],
      attrs['data-orientation'] === 'vertical',
    );
    const inlineStyle = authorStyle ? `${offset}; ${authorStyle}` : offset;

    return (
      <span
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-describedby={attrs['aria-describedby']}
        aria-disabled={attrs['aria-disabled']}
        aria-invalid={attrs['aria-invalid']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        aria-valuemax={attrs['aria-valuemax']}
        aria-valuemin={attrs['aria-valuemin']}
        aria-valuenow={attrs['aria-valuenow']}
        aria-valuetext={attrs['aria-valuetext']}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-max={attrs['data-max']}
        data-min={attrs['data-min']}
        data-orientation={attrs['data-orientation']}
        data-part={attrs['data-part']}
        data-required={attrs['data-required']}
        data-value={attrs['data-value']}
        data-value-ratio={attrs['data-value-ratio']}
        id={attrs.id}
        role={attrs.role}
        style={inlineStyle}
        tabIndex={attrs.tabIndex}
      />
    );
  },
});

export * from '@kovojs/headless-ui/slider';
