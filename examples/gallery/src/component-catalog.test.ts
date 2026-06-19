import { describe, expect, it } from 'vitest';

import { galleryComponentCatalog } from './component-catalog.js';
import { galleryRoutes } from './demo-fixtures.js';

// The catalog owns the prose one-liners; galleryRoutes owns the route set. Keep
// them 1:1 so a new fixture cannot ship without a summary (and a removed fixture
// cannot leave a dangling entry the agent layer would still surface).
describe('gallery component catalog', () => {
  it('matches galleryRoutes 1:1 by component and title, in order', () => {
    expect(galleryComponentCatalog.map((entry) => entry.component)).toEqual(
      galleryRoutes.map((route) => route.component),
    );
    expect(galleryComponentCatalog.map((entry) => entry.title)).toEqual(
      galleryRoutes.map((route) => route.title),
    );
  });

  it('gives every component a non-empty, single-sentence summary', () => {
    for (const entry of galleryComponentCatalog) {
      expect(entry.summary.trim(), entry.component).not.toBe('');
      expect(entry.summary.trim().endsWith('.'), entry.component).toBe(true);
    }
  });
});
