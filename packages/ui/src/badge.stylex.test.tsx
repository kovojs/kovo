import { describe, expect, it } from 'vitest';
import * as style from '@kovojs/style';
import { Badge, badgeStyles } from './badge.js';
describe('@kovojs/ui Badge StyleX styles', () => {
  it('renders default and variant StyleX classes', () => {
    const neutral = String(Badge.definition.render({ children: 'Draft' }));
    const success = String(Badge.definition.render({ children: 'Live', variant: 'success' }));
    const warning = String(
      Badge.definition.render({
        children: 'Needs review',
        variant: 'warning',
      }),
    );
    expect(neutral).toContain('<span class="kv-badge-align-');
    expect(neutral).toContain('data-style-src="badge.tsx#root; badge.tsx#neutral"');
    expect(success).toContain('kv-badge-variant-bg-');
    expect(success).toContain('badge.tsx#root; badge.tsx#success');
    expect(warning).toContain('badge.tsx#root; badge.tsx#warning');
    expect(
      (
        [
          style.attrs(badgeStyles.base.root, badgeStyles.variants.neutral).class ?? '',
          style.attrs(badgeStyles.variants.success).class ?? '',
          style.attrs(badgeStyles.variants.warning).class ?? '',
          style.attrs(badgeStyles.variants.destructive).class ?? '',
          style.attrs(badgeStyles.variants.outline).class ?? '',
        ] as const
      ).join(' '),
    ).toContain('kv-badge-align-');
    expect(
      (
        [
          style.attrs(badgeStyles.base.root, badgeStyles.variants.neutral).class ?? '',
          style.attrs(badgeStyles.variants.success).class ?? '',
          style.attrs(badgeStyles.variants.warning).class ?? '',
          style.attrs(badgeStyles.variants.destructive).class ?? '',
          style.attrs(badgeStyles.variants.outline).class ?? '',
        ] as const
      ).join(' '),
    ).toContain('kv-badge-variant-bg-');
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
    const rendered = String(
      Badge.definition.render({
        children: 'Custom',
        style: overrides.root,
        variant: 'success',
      }),
    );
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
