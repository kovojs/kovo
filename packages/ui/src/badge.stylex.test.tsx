import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Badge, badgeClasses, badgeStyles } from './badge.js';

describe('@kovojs/ui Badge StyleX styles', () => {
  it('renders default and variant StyleX classes', () => {
    const neutral = Badge.definition.render({ children: 'Draft' }) as string;
    const success = Badge.definition.render({ children: 'Live', variant: 'success' }) as string;
    const warning = Badge.definition.render({
      children: 'Needs review',
      variant: 'warning',
    }) as string;

    expect(neutral).toContain('<span class="kv-badge-align-');
    expect(neutral).toContain('data-style-src="badge.tsx#root; badge.tsx#neutral"');
    expect(success).toContain('kv-badge-variant-bg-');
    expect(success).toContain('badge.tsx#root; badge.tsx#success');
    expect(warning).toContain('badge.tsx#root; badge.tsx#warning');
    expect(badgeClasses.join(' ')).toContain('kv-badge-align-');
    expect(badgeClasses.join(' ')).toContain('kv-badge-variant-bg-');
  });

  it('accepts author-last StyleX overrides', () => {
    const overrides = style.create(
      {
        root: {
          backgroundColor: '#1d4ed8',
          color: '#ffffff',
        },
      },
      { namespace: 'appBadge', source: 'app-badge.tsx' },
    );

    const rendered = Badge.definition.render({
      children: 'Custom',
      style: overrides.root,
      variant: 'success',
    }) as string;

    expect(rendered).toContain('kv-app-badge-bg-');
    expect(rendered).toContain('kv-app-badge-fg-');
    expect(rendered).toContain('app-badge.tsx#root');
    expect(rendered).not.toContain('kv-badge-variant-bg-');
  });

  it('exports StyleX style groups instead of variant helpers', () => {
    expect(badgeStyles.base.root.$$css).toBe(true);
    expect(badgeStyles.variants.neutral.$$css).toBe(true);
    expect(badgeStyles.variants.success.$$css).toBe(true);
    expect(badgeStyles.variants.warning.$$css).toBe(true);
  });
});
