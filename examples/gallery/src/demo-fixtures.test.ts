import { describe, expect, it } from 'vitest';

import { galleryFixtures, galleryRoutes } from './demo-fixtures.js';

describe('gallery demo fixtures', () => {
  it('renders one route fixture for each foundation demo', () => {
    expect(galleryRoutes.map((route) => route.path)).toEqual([
      '/components/dialog',
      '/components/toggle',
      '/components/progress',
    ]);

    expect(galleryFixtures()).toHaveLength(galleryRoutes.length);
  });

  it('keeps rendered demos as the test fixture surface', () => {
    for (const fixture of galleryFixtures()) {
      expect(fixture.html).toContain(`data-gallery-route="${fixture.path}"`);
      expect(fixture.html).toContain(`data-gallery-demo="${fixture.component}"`);
      expect(fixture.html).toContain('data-gallery-contract');
      expect(fixture.html).toContain('data-demo-summary="no-js"');
    }
  });

  it('renders dialog fixture with native invoker and IDREF wiring', () => {
    const dialog = findFixture('/components/dialog');

    expect(dialog.html).toContain('command="show-modal"');
    expect(dialog.html).toContain('commandfor="gallery-dialog-content"');
    expect(dialog.html).toContain('aria-controls="gallery-dialog-content"');
    expect(dialog.html).toContain('aria-labelledby="gallery-dialog-title"');
    expect(dialog.html).toContain('aria-describedby="gallery-dialog-description"');
    expect(dialog.html).toContain('open');
  });

  it('renders toggle fixture states through headless-ui attributes', () => {
    const toggle = findFixture('/components/toggle');

    expect(toggle.html).toContain('data-fixture-state="pressed"');
    expect(toggle.html).toContain('data-state="pressed"');
    expect(toggle.html).toContain('aria-pressed="true"');
    expect(toggle.html).toContain('data-fixture-state="disabled"');
    expect(toggle.html).toContain('data-disabled');
    expect(toggle.html).toContain('disabled');
  });

  it('renders progress fixture states through native progress attributes', () => {
    const progress = findFixture('/components/progress');

    expect(progress.html).toContain('data-state="loading"');
    expect(progress.html).toContain('data-value="42"');
    expect(progress.html).toContain('aria-valuetext="42 of 100 tasks complete"');
    expect(progress.html).toContain('data-state="complete"');
    expect(progress.html).toContain('data-state="indeterminate"');
  });
});

function findFixture(path: (typeof galleryRoutes)[number]['path']) {
  const fixture = galleryFixtures().find((candidate) => candidate.path === path);

  if (!fixture) {
    throw new Error(`Missing gallery fixture for ${path}`);
  }

  return fixture;
}
