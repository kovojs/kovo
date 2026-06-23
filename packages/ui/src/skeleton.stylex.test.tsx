import { describe, expect, it } from 'vitest';
import * as style from '@kovojs/style';
import { createKeyframes } from '@kovojs/style/internal';
import { Skeleton, skeletonStyles } from './skeleton.js';
describe('@kovojs/ui Skeleton StyleX styles', () => {
  it('renders decorative skeleton markup with StyleX classes', () => {
    const rendered = String(Skeleton.definition.render({}));
    // The pulse keyframe animation (`kv-skeleton-animation-`) is now statically
    // extractable: the compiler resolves the `style.keyframes` name and emits the
    // matching `@keyframes` block into the served CSS (SPEC.md §13.1).
    expect(rendered).toContain('class="kv-skeleton-animation-');
    expect(rendered).toContain('kv-skeleton-bg-');
    expect(rendered).toContain('data-style-src="skeleton.tsx#root"');
    expect(rendered).toContain('aria-hidden="true"');
    expect(([style.attrs(skeletonStyles.root).class ?? ''] as const).join(' ')).toContain(
      'kv-skeleton-bg-',
    );
  });
  it('extracts the pulse @keyframes block matching the animationName', () => {
    // The deterministic keyframes name the engine emits is the literal the
    // extractor binds to `animationName`; the served CSS carries the block.
    const pulse = createKeyframes(
      {
        '0%, 100%': { opacity: 1 },
        '50%': { opacity: 0.5 },
      },
      { namespace: 'skeletonPulse', source: 'skeleton.tsx' },
    );
    expect(pulse.name).toMatch(/^kv-skeleton-pulse-[a-z0-9]+$/);
    expect(pulse.css).toBe(`@keyframes ${pulse.name}{0%, 100%{opacity:1}50%{opacity:0.5}}`);
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
    const rendered = String(Skeleton.definition.render({ style: overrides.root }));
    expect(rendered).toContain('kv-app-skeleton-h-');
    expect(rendered).toContain('kv-app-skeleton-w-');
    expect(rendered).toContain('app-skeleton.tsx#root');
  });
  it('exports StyleX style objects instead of class strings', () => {
    expect(skeletonStyles.root.$$css).toBe(true);
  });
});
