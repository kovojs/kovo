import { describe, expect, it } from 'vitest';

import { componentSearchEntries } from './content.js';

describe('site component/icon catalog search', () => {
  it('indexes all 44 components and 1737 icons with task-specific destinations', () => {
    const entries = componentSearchEntries();
    const components = entries.filter((entry) => entry.kind === 'component');
    const icons = entries.filter((entry) => entry.kind === 'icon');

    expect(components).toHaveLength(44);
    expect(icons).toHaveLength(1_737);
    expect(components.find((entry) => entry.title === 'Card')).toEqual(
      expect.objectContaining({
        section: 'Components',
        url: '/components/card/',
      }),
    );
    expect(icons.find((entry) => entry.title === 'Arrow Right')).toEqual(
      expect.objectContaining({
        section: 'Icons',
        text: expect.stringContaining('@kovojs/icons/arrow-right'),
        url: '/guides/components/#icons',
      }),
    );
  });
});
