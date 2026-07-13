import { describe, expect, it } from 'vitest';

import {
  escapeCssString,
  findFragmentTargetElement,
  type FragmentTargetRoot,
} from './fragment-targets.js';

describe('fragment target lookup', () => {
  it('falls back to kovo-defer target hosts for initial deferred streams', () => {
    const target = { kind: 'defer' } as unknown as Element;
    const selectors: string[] = [];
    const root = {
      getElementById() {
        return null;
      },
      querySelector(selector: string) {
        selectors.push(selector);
        return selector === 'kovo-defer[target="reviews:p1"]' ? target : null;
      },
    } as unknown as FragmentTargetRoot;

    // SPEC.md §8/§13.3: initial deferred streams morph the fallback-bearing
    // <kovo-defer> host when the fragment protocol delivers the real subtree.
    expect(findFragmentTargetElement(root, 'reviews:p1')).toBe(target);
    expect(selectors).toEqual([
      '[kovo-fragment-target="reviews:p1"]',
      '[id="reviews:p1"]',
      '[kovo-c="reviews:p1"]',
      'kovo-defer[target="reviews:p1"]',
    ]);
  });

  it('escapes selector identities after late String.replace poisoning', () => {
    // SPEC §6.6/§9.1: app code cannot redirect a fragment commit by replacing a
    // mutable String prototype method after the target helper is imported.
    const originalReplace = String.prototype.replace;
    try {
      String.prototype.replace = (() => 'attacker-target') as typeof String.prototype.replace;
      expect(escapeCssString('target"bad\\id')).toBe('target\\"bad\\\\id');
    } finally {
      String.prototype.replace = originalReplace;
    }
  });
});
