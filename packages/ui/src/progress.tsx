/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';
import { progressRootAttributes } from '@kovojs/headless-ui/progress';

import { uiTheme } from './theme.js';

export interface ProgressProps {
  children?: string;
  max?: number;
  style?: style.StyleInput;
  value?: number | null;
  valueText?: string;
}

const pulse = style.keyframes(
  {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.5 },
  },
  { namespace: 'progressPulse' },
);

export const progressStyles = style.create(
  {
    root: {
      accentColor: uiTheme.color.accent,
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
      borderRadius: uiTheme.radius.full,
      height: 8,
      overflow: 'hidden',
      width: '100%',
      '[data-state=complete]': {
        accentColor: uiTheme.color.success.border,
      },
      '[data-state=indeterminate]': {
        animationDuration: '2s',
        animationIterationCount: 'infinite',
        animationName: pulse,
        animationTimingFunction: 'cubic-bezier(0.4, 0, 0.6, 1)',
      },
    },
  },
  { namespace: 'progress', source: 'progress.tsx' },
);

export const progressClasses = [style.attrs(progressStyles.root).class ?? ''] as const;

export const Progress = component({
  render(props: ProgressProps) {
    const attrs = progressRootAttributes({
      ...(props.max === undefined ? {} : { max: props.max }),
      ...(props.value === undefined ? {} : { value: props.value }),
      ...(props.valueText === undefined ? {} : { valueText: props.valueText }),
    });
    const styleAttrs = style.attrs(progressStyles.root, props.style);

    return (
      <progress
        {...styleAttrs}
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
    );
  },
});
