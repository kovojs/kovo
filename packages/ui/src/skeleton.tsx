/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

/**
 * Props for the skeleton component.
 *
 * @example
 * import type { SkeletonProps } from "@kovojs/ui/skeleton";
 * const props: SkeletonProps = {};
 */
export interface SkeletonProps {
  style?: style.StyleInput;
}

// Pulse the placeholder opacity so loading state reads as "in progress". The
// `style.keyframes` name is resolved by the StyleX extractor, which emits the
// matching `@keyframes` block into the served CSS asset (SPEC.md §13.1).
const pulse = style.keyframes(
  {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.5 },
  },
  { namespace: 'skeletonPulse', source: 'skeleton.tsx' },
);

/**
 * Style definitions used by the skeleton components.
 *
 * @example
 * import { skeletonStyles } from "@kovojs/ui/skeleton";
 * const styles = skeletonStyles;
 */
export const skeletonStyles = style.create({
  root: {
    // `border` (outlineVariant) is the M3 divider tone — distinctly darker than
    // the card surface, so placeholders are clearly visible. The old
    // `backgroundMuted` (surfaceContainerHighest) blended into the near-white card
    // and read as invisible.
    animationDuration: '2s',
    animationIterationCount: 'infinite',
    animationName: pulse,
    animationTimingFunction: 'cubic-bezier(0.4, 0, 0.6, 1)',
    backgroundColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
  },
});

/**
 * Renders the styled skeleton primitive.
 *
 * @example
 * import { Skeleton } from "@kovojs/ui/skeleton";
 * const component = Skeleton;
 */
export const Skeleton = component({
  render(props: SkeletonProps) {
    return <div {...style.attrs(skeletonStyles.root, props.style)} aria-hidden="true" />;
  },
});
