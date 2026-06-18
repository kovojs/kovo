/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface SkeletonProps {
  style?: style.StyleInput;
}

const pulse = style.keyframes(
  {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.5 },
  },
  { namespace: 'skeletonPulse', source: 'skeleton.tsx' },
);

export const skeletonStyles = style.create(
  {
    root: {
      animationDuration: '2s',
      animationIterationCount: 'infinite',
      animationName: pulse,
      animationTimingFunction: 'cubic-bezier(0.4, 0, 0.6, 1)',
      backgroundColor: uiTheme.color.backgroundSubtleHigh,
      borderRadius: uiTheme.radius.md,
    },
  },
  { namespace: 'skeleton', source: 'skeleton.tsx' },
);

export const skeletonClasses = [style.attrs(skeletonStyles.root).class ?? ''] as const;

export const Skeleton = component({
  render(props: SkeletonProps) {
    return <div {...style.attrs(skeletonStyles.root, props.style)} aria-hidden="true" />;
  },
});
