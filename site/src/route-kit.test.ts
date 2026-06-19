import { describe, expect, it } from 'vitest';

import { siteStylesheets } from './route-kit.js';

describe('site route stylesheet hints', () => {
  it('defines Kovo UI theme variables in critical CSS', () => {
    const [siteStylesheet] = siteStylesheets;

    // SPEC §13.1: gallery pages render @kovojs/ui classes in the document body,
    // so critical CSS must define the theme variables those classes consume.
    expect(siteStylesheet?.criticalCss).toContain('--kovo-theme-sys-color-on-surface:');
    expect(siteStylesheet?.criticalCss).toContain('html.dark');
  });
});
