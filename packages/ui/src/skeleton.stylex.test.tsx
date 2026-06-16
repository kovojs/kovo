import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Skeleton, skeletonClasses, skeletonStyles } from './skeleton.js';

describe('@kovojs/ui Skeleton StyleX styles', () => {
  it('renders decorative skeleton markup with StyleX classes', () => {
    const rendered = Skeleton.definition.render({}) as string;

    expect(rendered).toContain('<div class="kv-skeleton-animation-');
    expect(rendered).toContain('data-style-src="skeleton.tsx#root"');
    expect(rendered).toContain('aria-hidden="true"');
    expect(skeletonClasses.join(' ')).toContain('kv-skeleton-bg-');
  });

  it('accepts author-last StyleX size overrides', () => {
    const overrides = style.create(
      {
        root: {
          height: 16,
          width: 160,
        },
      },
      { namespace: 'appSkeleton', source: 'app-skeleton.tsx' },
    );

    const rendered = Skeleton.definition.render({ style: overrides.root }) as string;

    expect(rendered).toContain('kv-app-skeleton-h-');
    expect(rendered).toContain('kv-app-skeleton-w-');
    expect(rendered).toContain('app-skeleton.tsx#root');
  });

  it('exports StyleX style objects instead of class strings', () => {
    expect(skeletonStyles.root.$$css).toBe(true);
  });
});
