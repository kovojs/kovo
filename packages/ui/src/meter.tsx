/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';
import { meterRootAttributes } from '@kovojs/headless-ui/meter';

import { uiTheme } from './theme.js';

export interface MeterProps {
  children?: string;
  high?: number;
  low?: number;
  max?: number;
  min?: number;
  optimum?: number;
  style?: style.StyleInput;
  value?: number;
  valueText?: string;
}

export const meterStyles = style.create(
  {
    root: {
      accentColor: uiTheme.color.success.border,
      height: 8,
      width: '100%',
      '[data-state=suboptimum]': {
        accentColor: uiTheme.color.warning.border,
      },
      '[data-state=even-less-good]': {
        accentColor: uiTheme.color.danger.border,
      },
    },
  },
  { namespace: 'meter', source: 'meter.tsx' },
);

export const meterClasses = [style.attrs(meterStyles.root).class ?? ''] as const;

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
    const styleAttrs = style.attrs(meterStyles.root, props.style);

    return (
      <meter
        {...styleAttrs}
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
    );
  },
});

export * from '@kovojs/headless-ui/meter';
