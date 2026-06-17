/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';
import { separatorRootAttributes, type SeparatorOrientation } from '@kovojs/headless-ui';

export interface SeparatorProps {
  decorative?: boolean;
  orientation?: SeparatorOrientation;
  style?: style.StyleInput;
}

const base = style.create(
  {
    root: {
      backgroundColor: '#e5e5e5',
      flexShrink: 0,
    },
  },
  { namespace: 'separator', source: 'separator.tsx' },
);

const orientations = style.create(
  {
    horizontal: {
      height: 1,
      width: '100%',
    },
    vertical: {
      height: '100%',
      width: 1,
    },
  },
  { namespace: 'separatorOrientation', source: 'separator.tsx' },
);

export const separatorStyles = {
  base,
  orientations,
} as const;

export const separatorClasses = [
  style.attrs(base.root, orientations.horizontal).class ?? '',
  style.attrs(orientations.vertical).class ?? '',
] as const;

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
        aria-orientation={attrs['aria-orientation']}
        data-orientation={attrs['data-orientation']}
        role={attrs.role}
      />
    );
  },
});
