/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  cn,
  defineVariants,
  sliderInputAttributes,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
  type ClassValue,
  type SliderOrientation,
} from '@kovojs/headless-ui';

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
  class?: ClassValue;
  id?: string;
}

export interface SliderInputProps extends SliderStateProps {
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  form?: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  valueText?: string;
}

export interface SliderPartProps extends SliderStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface SliderThumbProps extends SliderPartProps {
  descriptionId?: string;
  errorId?: string;
  label?: string;
  labelledBy?: string;
  valueText?: string;
}

export const sliderClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950 data-[orientation=vertical]:inline-grid',
  variants: {},
});

export const sliderInputClassNames = defineVariants({
  base: 'h-2 w-full accent-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-2',
  variants: {},
});

export const sliderTrackClassNames = defineVariants({
  base: 'relative h-2 w-full overflow-hidden rounded-full bg-neutral-200 data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-2',
  variants: {},
});

export const sliderRangeClassNames = defineVariants({
  base: 'block h-full rounded-full bg-neutral-950 data-[orientation=vertical]:w-full',
  variants: {},
});

export const sliderThumbClassNames = defineVariants({
  base: 'block h-4 w-4 rounded-full border border-neutral-300 bg-white shadow-sm data-[disabled]:opacity-50',
  variants: {},
});

export const sliderClasses = sliderClassNames.classes;
export const sliderInputClasses = sliderInputClassNames.classes;
export const sliderTrackClasses = sliderTrackClassNames.classes;
export const sliderRangeClasses = sliderRangeClassNames.classes;
export const sliderThumbClasses = sliderThumbClassNames.classes;

export const Slider = component('slider', {
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

    return (
      <div
        class={cn(sliderClassNames(), props.class)}
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

export const SliderInput = component('slider-input', {
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

    return (
      <input
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        aria-label={attrs['aria-label']}
        aria-labelledby={attrs['aria-labelledby']}
        aria-orientation={attrs['aria-orientation']}
        aria-valuetext={attrs['aria-valuetext']}
        class={cn(sliderInputClassNames(), props.class)}
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

export const SliderTrack = component('slider-track', {
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

    return (
      <div
        aria-hidden={attrs['aria-hidden']}
        class={cn(sliderTrackClassNames(), props.class)}
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

export const SliderRange = component('slider-range', {
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

    return (
      <span
        aria-hidden={attrs['aria-hidden']}
        class={cn(sliderRangeClassNames(), props.class)}
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

export const SliderThumb = component('slider-thumb', {
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

    return (
      <span
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
        class={cn(sliderThumbClassNames(), props.class)}
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
