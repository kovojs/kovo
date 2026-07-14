import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isReviewedComponentEventBoundary,
  reviewedComponentEventBoundaries,
} from './component-event-boundary-registry.js';

const uiRegistry = JSON.parse(
  readFileSync(new URL('../../ui/registry.json', import.meta.url), 'utf8'),
) as {
  components: Array<{ exports: string[]; name: string }>;
};

describe('reviewed component event-boundary registry', () => {
  it('stays pinned to the generated @kovojs/ui component descriptors', () => {
    const expected = Object.fromEntries(
      uiRegistry.components.map((entry) => [`@kovojs/ui/${entry.name}`, entry.exports]),
    );

    expect(reviewedComponentEventBoundaries).toEqual(expected);
  });

  it('requires an exact reviewed module and export pair', () => {
    expect(isReviewedComponentEventBoundary('@kovojs/ui/button', 'Button')).toBe(true);
    expect(isReviewedComponentEventBoundary('@kovojs/ui/button', 'Anything')).toBe(false);
    expect(isReviewedComponentEventBoundary('@kovojs/ui/not-a-real-entry', 'Button')).toBe(false);
    expect(isReviewedComponentEventBoundary('@kovojs/ui/theme', 'uiTheme')).toBe(false);
  });

  it('cannot be mutated to widen or replace a reviewed decision', () => {
    expect(
      Reflect.set(reviewedComponentEventBoundaries, '@kovojs/ui/not-a-real-entry', ['Anything']),
    ).toBe(false);
    const buttonExports = reviewedComponentEventBoundaries['@kovojs/ui/button'] as string[];
    expect(() => buttonExports.push('Anything')).toThrow();
    expect(Reflect.set(buttonExports, 0, 'Anything')).toBe(false);

    expect(isReviewedComponentEventBoundary('@kovojs/ui/button', 'Button')).toBe(true);
    expect(isReviewedComponentEventBoundary('@kovojs/ui/button', 'Anything')).toBe(false);
    expect(isReviewedComponentEventBoundary('@kovojs/ui/not-a-real-entry', 'Anything')).toBe(false);
  });
});
