/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';
import { separatorRootAttributes, type SeparatorOrientation } from '@kovojs/headless-ui/separator';

import { uiTheme } from './theme.js';

export interface SeparatorProps {
  decorative?: boolean;
  orientation?: SeparatorOrientation;
  style?: style.StyleInput;
}

const base = style.create({
  root: {
    backgroundColor: uiTheme.color.border,
    flexShrink: 0,
  },
});

const orientations = style.create({
  horizontal: {
    height: 1,
    width: '100%',
  },
  vertical: {
    height: '100%',
    width: 1,
  },
});

export const separatorStyles = {
  base,
  orientations,
} as const;

export const Separator = component({
  render(props: SeparatorProps) {
    const orientation = props.orientation ?? 'horizontal';
    const attrs = separatorRootAttributes({
      ...(props.decorative === undefined ? {} : { decorative: props.decorative }),
      orientation,
    });
    const styleAttrs = style.attrs(base.root, orientations[orientation], props.style);

    return (
      <div
        {...styleAttrs}
        {...passThroughProps(props)}
        aria-orientation={attrs['aria-orientation']}
        data-orientation={attrs['data-orientation']}
        role={attrs.role}
      />
    );
  },
});
