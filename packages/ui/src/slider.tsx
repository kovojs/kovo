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
    input: {
      accentColor: uiTheme.color.accent,
      height: 8,
      width: '100%',
      '[data-orientation=vertical]': {
        height: 160,
        width: 8,
      },
      ':disabled': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
    range: {
      backgroundColor: uiTheme.color.accent,
      borderRadius: uiTheme.radius.full,
      display: 'block',
      height: '100%',
      '[data-orientation=vertical]': {
        width: '100%',
      },
    },
    root: {
      color: uiTheme.color.foreground,
      display: 'grid',
      fontSize: 14,
      rowGap: 8,
      '[data-disabled]': {
        opacity: 0.5,
      },
      '[data-invalid]': {
        color: uiTheme.color.danger.foreground,
      },
      '[data-orientation=vertical]': {
        display: 'inline-grid',
      },
    },
    thumb: {
      backgroundColor: uiTheme.color.background,
      borderColor: uiTheme.color.border,
      borderRadius: uiTheme.radius.full,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px rgb(0 0 0 / 0.05)',
      display: 'block',
      height: 16,
      width: 16,
      '[data-disabled]': {
        opacity: 0.5,
      },
    },
    track: {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
      borderRadius: uiTheme.radius.full,
      height: 8,
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
      '[data-orientation=vertical]': {
        height: 160,
        width: 8,
      },
    },
  },
  { namespace: 'slider', source: 'slider.tsx' },
);

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

    return (
      <span
        {...styleAttrs}
        {...passThroughProps(props, { style: true })}
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

    return (
      <span
        {...styleAttrs}
        {...passThroughProps(props, { style: true })}
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
        tabIndex={attrs.tabIndex}
      />
    );
  },
});

export * from '@kovojs/headless-ui/slider';
