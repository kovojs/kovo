import { describe, expect, it } from 'vitest';
import * as style from '@kovojs/style';
import { Badge } from './badge.js';
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
      String(Badge.definition.render({ children: 'Draft', variant: 'destructive' })),
    ).toContain('badge.tsx#root; badge.tsx#destructive');
    expect(String(Badge.definition.render({ children: 'Draft', variant: 'outline' }))).toContain(
      'badge.tsx#root; badge.tsx#outline',
    );
  });
  it('accepts author-last StyleX overrides', () => {
    const overrides = style.create({
      root: {
        backgroundColor: '#1d4ed8',
        color: '#ffffff',
      },
    });
    const rendered = String(
      Badge.definition.render({
        children: 'Custom',
        style: overrides.root,
        variant: 'success',
      }),
    );
    expect(rendered).toContain('kv-badge-stylex-test-bg-');
    expect(rendered).toContain('kv-badge-stylex-test-fg-');
    expect(rendered).toContain('badge.stylex.test.tsx#root');
    expect(rendered).not.toContain('kv-badge-variant-bg-');
  });
});
