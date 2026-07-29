import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Separator } from './separator.js';

describe('@kovojs/ui Separator StyleX styles', () => {
  it('matches default and semantic orientation output', () => {
    expect({
      decorative: renderUiComponent(Separator, {}),
      semanticVertical: renderUiComponent(Separator, {
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

    expect(renderUiComponent(Separator, { style: overrides.root })).toMatchSnapshot();
  });
});
