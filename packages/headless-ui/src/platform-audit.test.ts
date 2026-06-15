import { describe, expect, it } from 'vitest';

import {
  getPrimitivePlatformAudit,
  h1HeadlessUiPrimitives,
  h1PlatformAudit,
  primitivesRequiringLazyFallback,
  primitiveUsesNativeMechanism,
} from './platform-audit.js';

describe('headless-ui F5 platform audit', () => {
  it('covers the H1 primitive set with executable F5 decisions', () => {
    expect(Object.keys(h1PlatformAudit).sort()).toEqual([...h1HeadlessUiPrimitives].sort());

    for (const primitive of h1HeadlessUiPrimitives) {
      const audit = getPrimitivePlatformAudit(primitive);

      expect(audit.primitive).toBe(primitive);
      expect(audit.concerns.length).toBeGreaterThan(0);
      expect(audit.specSections).toContain('SPEC.md §1.3');
    }
  });

  it('keeps native dialog, popover, and details substitutions visible for H1', () => {
    expect(primitiveUsesNativeMechanism('dialog', 'html-dialog')).toBe(true);
    expect(primitiveUsesNativeMechanism('alert-dialog', 'html-dialog')).toBe(true);
    expect(primitiveUsesNativeMechanism('dialog', 'invoker-command')).toBe(true);
    expect(primitiveUsesNativeMechanism('alert-dialog', 'invoker-command')).toBe(true);

    expect(primitiveUsesNativeMechanism('popover', 'html-popover')).toBe(true);
    expect(primitiveUsesNativeMechanism('tooltip', 'html-popover')).toBe(false);
    expect(primitiveUsesNativeMechanism('hover-card', 'html-popover')).toBe(true);

    expect(primitiveUsesNativeMechanism('collapsible', 'html-details')).toBe(true);
    expect(primitiveUsesNativeMechanism('accordion', 'html-details')).toBe(true);
  });

  it('loads the floating fallback lazily only for anchored floating H1 surfaces', () => {
    expect(primitivesRequiringLazyFallback('floating-positioning')).toEqual([
      'hover-card',
      'popover',
      'tooltip',
    ]);

    for (const primitive of primitivesRequiringLazyFallback('floating-positioning')) {
      const floatingConcern = getPrimitivePlatformAudit(primitive).concerns.find(
        (concern) => concern.concern === 'floating-position',
      );

      expect(floatingConcern).toMatchObject({
        decision: 'native-enhancement',
        lazyFallbackLoad: 'first-trigger-interaction',
        lazyFallbackModule: 'floating-positioning',
        nativeMechanisms: ['css-anchor-positioning'],
      });
    }
  });

  it('treats discrete transition support as an enhancement, not an eager runtime dependency', () => {
    for (const primitive of [
      'dialog',
      'alert-dialog',
      'popover',
      'tooltip',
      'hover-card',
    ] as const) {
      const transitionConcern = getPrimitivePlatformAudit(primitive).concerns.find(
        (concern) => concern.concern === 'exit-animation',
      );

      expect(transitionConcern).toMatchObject({
        decision: 'native-enhancement',
        nativeMechanisms: ['css-starting-style', 'css-transition-behavior-allow-discrete'],
      });
      expect(transitionConcern?.lazyFallbackModule).toBeUndefined();
    }
  });

  it('keeps non-floating primitives out of the lazy positioning module', () => {
    const fallbackPrimitives = new Set(primitivesRequiringLazyFallback('floating-positioning'));

    for (const primitive of h1HeadlessUiPrimitives) {
      const hasFloatingFallback = fallbackPrimitives.has(primitive);
      const hasLazyConcern = getPrimitivePlatformAudit(primitive).concerns.some(
        (concern) => concern.lazyFallbackModule === 'floating-positioning',
      );

      expect(hasLazyConcern).toBe(hasFloatingFallback);
    }
  });
});
