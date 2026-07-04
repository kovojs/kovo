import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Separator } from './separator.js';

describe('@kovojs/ui Separator StyleX styles', () => {
  it('matches default and semantic orientation output', () => {
    expect({
      decorative: Separator.definition.render({}),
      semanticVertical: Separator.definition.render({
        decorative: false,
        orientation: 'vertical',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = style.create({
      root: {
        backgroundColor: '#111827',
        width: 256,
      },
    });

    expect(Separator.definition.render({ style: overrides.root })).toMatchSnapshot();
  });
});
