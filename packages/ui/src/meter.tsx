/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';
import { meterRootAttributes } from '@kovojs/headless-ui/meter';

import { uiTheme } from './theme.js';

/** Style override slots for the meter primitive. */
export interface MeterStyleOverrides {
  indicator?: style.StyleInput;
  native?: style.StyleInput;
  root?: style.StyleInput;
}

export interface MeterProps {
  children?: string;
  high?: number;
  low?: number;
  max?: number;
  min?: number;
  optimum?: number;
  style?: style.StyleInput;
  styles?: MeterStyleOverrides;
  value?: number;
  valueText?: string;
}

export const meterStyles = style.create({
  // Custom indicator filled by value ratio (set inline). Color tracks the
  // optimum/suboptimum/even-less-good state.
  indicator: {
    backgroundColor: uiTheme.color.success.border,
    borderRadius: uiTheme.radius.full,
    display: 'block',
    height: '100%',
    transitionDuration: '0.3s',
    transitionProperty: 'width, background-color',
    width: '100%',
    '[data-state=suboptimum]': {
      backgroundColor: uiTheme.color.warning.border,
    },
    '[data-state=even-less-good]': {
      backgroundColor: uiTheme.color.danger.border,
    },
  },
  // Native <meter> kept for semantics but visually removed from layout.
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
});

function fillStyle(
  value: string | undefined,
  min: string | undefined,
  max: string | undefined,
): string | undefined {
  const parsedValue = Number(value);
  const parsedMin = Number(min);
  const parsedMax = Number(max);
  if (
    !Number.isFinite(parsedValue) ||
    !Number.isFinite(parsedMin) ||
    !Number.isFinite(parsedMax) ||
    parsedMax <= parsedMin
  ) {
    return undefined;
  }
  const ratio = Math.min(1, Math.max(0, (parsedValue - parsedMin) / (parsedMax - parsedMin)));
  return `${(ratio * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}

export const Meter = component({
  render(props: MeterProps) {
    const attrs = meterRootAttributes({
      ...(props.high === undefined ? {} : { high: props.high }),
      ...(props.low === undefined ? {} : { low: props.low }),
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.min === undefined ? {} : { min: props.min }),
      ...(props.optimum === undefined ? {} : { optimum: props.optimum }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.valueText === undefined ? {} : { valueText: props.valueText }),
    });
    const slots = props.styles;
    const rootOverride = props.style;
    const rootStyleAttrs = style.attrs(meterStyles.root, slots?.root, rootOverride);
    const nativeStyleAttrs = style.attrs(meterStyles.native, slots?.native);
    const indicatorStyleAttrs = style.attrs(meterStyles.indicator, slots?.indicator);
    const indicatorWidth = fillStyle(attrs['data-value'], attrs['data-min'], attrs['data-max']);

    return (
      <div {...rootStyleAttrs} data-state={attrs['data-state']}>
        <meter
          {...nativeStyleAttrs}
          {...passThroughProps(props)}
          aria-valuetext={attrs['aria-valuetext']}
          data-high={attrs['data-high']}
          data-low={attrs['data-low']}
          data-max={attrs['data-max']}
          data-min={attrs['data-min']}
          data-optimum={attrs['data-optimum']}
          data-state={attrs['data-state']}
          data-value={attrs['data-value']}
          high={attrs.high}
          low={attrs.low}
          max={attrs.max}
          min={attrs.min}
          optimum={attrs.optimum}
          value={attrs.value}
        >
          {props.children}
        </meter>
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
