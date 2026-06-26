/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { bindingProps, passThroughProps } from './pass-through.js';
import { progressRootAttributes } from '@kovojs/headless-ui/progress';

import { uiTheme } from './theme.js';

/** Style override slots for the progress primitive. */
/**
 * Style override slots accepted by the progress components.
 *
 * @example
 * import type { ProgressStyleOverrides } from "@kovojs/ui/progress";
 * const styles: ProgressStyleOverrides = {};
 */
export interface ProgressStyleOverrides {
  indicator?: style.StyleInput;
  native?: style.StyleInput;
  root?: style.StyleInput;
}

/**
 * Props for the progress component.
 *
 * @example
 * import type { ProgressProps } from "@kovojs/ui/progress";
 * const props: ProgressProps = { children: 'Content' };
 */
export interface ProgressProps {
  children?: string;
  max?: number;
  style?: style.StyleInput;
  styles?: ProgressStyleOverrides;
  value?: number | null;
  valueText?: string;
}

// Indeterminate slide: a partial-width bar sweeps across the track when progress
// has no known value. The `style.keyframes` name is resolved by the StyleX
// extractor, which emits the `@keyframes` block into the served CSS (SPEC.md §13.1).
const indeterminateSlide = style.keyframes(
  {
    '0%': { transform: 'translateX(-100%)' },
    '100%': { transform: 'translateX(250%)' },
  },
  { namespace: 'progressIndeterminate', source: 'progress.tsx' },
);

/**
 * Style definitions used by the progress components.
 *
 * @example
 * import { progressStyles } from "@kovojs/ui/progress";
 * const styles = progressStyles;
 */
export const progressStyles = style.create({
  // Custom indicator filled by value ratio (set inline). In the indeterminate
  // state a partial-width bar slides across the track.
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
      animationTimingFunction: 'ease-in-out',
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
});

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

/**
 * Renders the styled progress primitive.
 *
 * @example
 * import { Progress } from "@kovojs/ui/progress";
 * const component = Progress;
 */
export const Progress = component({
  render(props: ProgressProps) {
    const attrs = progressRootAttributes({
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.valueText === undefined ? {} : { valueText: props.valueText }),
    });
    const slots = props.styles;
    // The `style` prop is NOT applied to the root track: a call-site reactive
    // `style={{ width }}` (the only way to emit a `data-bind:style`) would
    // otherwise shrink the whole track. It is forwarded as the indicator fill
    // binding below (see bindingProps) so the visible bar can animate client-side.
    const rootStyleAttrs = style.attrs(progressStyles.root, slots?.root);
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
          {...bindingProps(props, ['style', 'data-state'])}
          aria-hidden="true"
          data-state={attrs['data-state']}
          style={{ width: indicatorWidth }}
        />
      </div>
    );
  },
});
