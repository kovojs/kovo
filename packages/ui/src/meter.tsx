/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { cn, defineVariants, meterRootAttributes, type ClassValue } from '@kovojs/headless-ui';

export interface MeterProps {
  children?: string;
  class?: ClassValue;
  high?: number;
  low?: number;
  max?: number;
  min?: number;
  optimum?: number;
  value?: number;
  valueText?: string;
}

export const meterClassNames = defineVariants({
  base: 'h-2 w-full accent-emerald-600 data-[state=suboptimum]:accent-amber-500 data-[state=even-less-good]:accent-red-600',
  variants: {},
});

export const meterClasses = meterClassNames.classes;

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

    return (
      <meter
        aria-valuetext={attrs['aria-valuetext']}
        class={cn(meterClassNames(), props.class)}
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
