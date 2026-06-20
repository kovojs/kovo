/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

export interface SkeletonProps {
  style?: style.StyleInput;
}

export const skeletonStyles = style.create({
  root: {
    // `border` (outlineVariant) is the M3 divider tone — distinctly darker than
    // the card surface, so placeholders are clearly visible. The old
    // `backgroundMuted` (surfaceContainerHighest) blended into the near-white card
    // and read as invisible. (A keyframe pulse isn't used: a keyframes name
    // referenced by variable isn't statically extractable by the package-css /
    // vendored-compile StyleX extractor — KV236 — so it is left as a follow-up.)
    backgroundColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
  },
});

export const Skeleton = component({
  render(props: SkeletonProps) {
    return <div {...style.attrs(skeletonStyles.root, props.style)} aria-hidden="true" />;
  },
});
