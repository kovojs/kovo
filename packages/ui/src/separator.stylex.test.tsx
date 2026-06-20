import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Separator, separatorStyles } from './separator.js';

describe('@kovojs/ui Separator StyleX styles', () => {
  it('matches default and semantic orientation output', () => {
    expect({
      classes: [
        style.attrs(separatorStyles.base.root, separatorStyles.orientations.horizontal).class ?? '',
        style.attrs(separatorStyles.orientations.vertical).class ?? '',
      ] as const,
      decorative: Separator.definition.render({}),
      semanticVertical: Separator.definition.render({
        decorative: false,
        orientation: 'vertical',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = style.create(
      {
        root: {
          backgroundColor: '#111827',
          width: 256,
        },
      },
      { namespace: 'appSeparator', source: 'app-separator.tsx' },
    );

    expect(Separator.definition.render({ style: overrides.root })).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      base: Object.keys(separatorStyles.base),
      baseMarkers: {
        root: separatorStyles.base.root.$$css,
      },
      orientationMarkers: {
        horizontal: separatorStyles.orientations.horizontal.$$css,
        vertical: separatorStyles.orientations.vertical.$$css,
      },
      orientations: Object.keys(separatorStyles.orientations),
    }).toMatchSnapshot();
  });
});
