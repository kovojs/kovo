/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';
import { progressRootAttributes } from '@kovojs/headless-ui/progress';

import { uiTheme } from './theme.js';

/** Style override slots for the progress primitive. */
export interface ProgressStyleOverrides {
  indicator?: style.StyleInput;
  native?: style.StyleInput;
  root?: style.StyleInput;
}

export interface ProgressProps {
  children?: string;
  max?: number;
  style?: style.StyleInput;
  styles?: ProgressStyleOverrides;
  value?: number | null;
  valueText?: string;
}

const indeterminateSlide = style.keyframes(
  {
    '0%': { transform: 'translateX(-100%)' },
    '100%': { transform: 'translateX(250%)' },
  },
  { namespace: 'progressSlide' },
);

export const progressStyles = style.create(
  {
    // Custom indicator filled by value ratio (set inline). Slides when
    // indeterminate (no resolved value).
    indicator: {
      backgroundColor: uiTheme.color.accent,
      borderRadius: uiTheme.radius.full,
      display: 'block',
      height: '100%',
      transitionDuration: '0.3s',
      transitionProperty: 'width, transform',
      width: '100%',
      '[data-state=complete]': {
        backgroundColor: uiTheme.color.success.border,
      },
      '[data-state=indeterminate]': {
        animationDuration: '1.5s',
        animationIterationCount: 'infinite',
        animationName: indeterminateSlide,
        animationTimingFunction: 'cubic-bezier(0.4, 0, 0.6, 1)',
        width: '40%',
      },
    },
    // Native <progress> kept for semantics but visually removed from layout.
    native: {
      borderStyle: 'none',
      height: 1,
      margin: -1,
      overflow: 'hidden',
      padding: 0,
      position: 'absolute',
      width: 1,
    },
    // Visible track.
    root: {
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
      borderRadius: uiTheme.radius.full,
      display: 'block',
      height: 8,
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
    },
  },
  { namespace: 'progress', source: 'progress.tsx' },
);

export const progressClasses = [style.attrs(progressStyles.root).class ?? ''] as const;
/** CSS class tuple for the visual progress indicator slot. */
export const progressIndicatorClasses = [
  style.attrs(progressStyles.indicator).class ?? '',
] as const;
/** CSS class tuple for the native semantic progress slot. */
export const progressNativeClasses = [style.attrs(progressStyles.native).class ?? ''] as const;

function fillStyle(value: string | undefined, max: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsedValue = Number(value);
  const parsedMax = Number(max);
  if (!Number.isFinite(parsedValue) || !Number.isFinite(parsedMax) || parsedMax <= 0) {
    return undefined;
  }
  const ratio = Math.min(1, Math.max(0, parsedValue / parsedMax));
  return `${(ratio * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}

export const Progress = component({
  render(props: ProgressProps) {
    const attrs = progressRootAttributes({
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.valueText === undefined ? {} : { valueText: props.valueText }),
    });
    const slots = props.styles;
    const rootOverride = props.style;
    const rootStyleAttrs = style.attrs(progressStyles.root, slots?.root, rootOverride);
    const nativeStyleAttrs = style.attrs(progressStyles.native, slots?.native);
    const indicatorStyleAttrs = style.attrs(progressStyles.indicator, slots?.indicator);
    const indicatorWidth = fillStyle(attrs['data-value'], attrs['data-max']);

    return (
      <div {...rootStyleAttrs} data-state={attrs['data-state']}>
        <progress
          {...nativeStyleAttrs}
          {...passThroughProps(props)}
          aria-valuetext={attrs['aria-valuetext']}
          data-max={attrs['data-max']}
          data-state={attrs['data-state']}
          data-value={attrs['data-value']}
          max={attrs.max}
          value={attrs.value}
        >
          {props.children}
        </progress>
        <span
          {...indicatorStyleAttrs}
          aria-hidden="true"
          data-state={attrs['data-state']}
          style={{ width: indicatorWidth }}
        />
      </div>
    );
  },
});
