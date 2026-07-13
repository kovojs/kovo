import { describe, expect, it } from 'vitest';

import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { sanitizeReauthDirective } from './reauth-directive.js';

describe('browser navigation security intrinsics', () => {
  it('keeps keyed reconciliation maps pinned after late Map prototype replacement', () => {
    const controls = createBrowserNavigationSecurityControls();
    const originalGet = Map.prototype.get;
    const originalHas = Map.prototype.has;
    const originalSet = Map.prototype.set;
    let present = false;
    let value: object | undefined;
    try {
      Map.prototype.get = () => ({ forged: true });
      Map.prototype.has = () => false;
      Map.prototype.set = function () {
        return this;
      };
      const map = controls.createSecurityMap<string, object>();
      const expected = { server: true };
      controls.setSecurityMapValue(map, 'row-1', expected);
      present = controls.hasSecurityMapValue(map, 'row-1');
      value = controls.getSecurityMapValue(map, 'row-1');
    } finally {
      Map.prototype.get = originalGet;
      Map.prototype.has = originalHas;
      Map.prototype.set = originalSet;
    }
    expect(present).toBe(true);
    expect(value).toEqual({ server: true });
  });

  it('keeps URL and path decisions pinned after late prototype/global replacement', () => {
    const controls = createBrowserNavigationSecurityControls();
    const originDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'origin')!;
    const originalStartsWith = String.prototype.startsWith;
    const originalDecodeURIComponent = globalThis.decodeURIComponent;

    Object.defineProperty(URL.prototype, 'origin', {
      configurable: true,
      get() {
        return 'https://app.example';
      },
    });
    String.prototype.startsWith = function (search: string, position?: number) {
      if (this.valueOf() === '//evil.example/phish') return search === '/';
      return Reflect.apply(originalStartsWith, this, [search, position]);
    };
    Object.defineProperty(globalThis, 'decodeURIComponent', {
      configurable: true,
      value: () => '/',
    });
    try {
      expect(controls.parseUrl('https://evil.example/phish')?.origin).toBe('https://evil.example');
      expect(controls.safeSameOriginPath('//evil.example/phish')).toBeUndefined();
      expect(controls.safeSameOriginPath('/\\evil.example/phish')).toBeUndefined();
      expect(sanitizeReauthDirective('//evil.example/phish')).toBe('/');
    } finally {
      Object.defineProperty(URL.prototype, 'origin', originDescriptor);
      String.prototype.startsWith = originalStartsWith;
      Object.defineProperty(globalThis, 'decodeURIComponent', {
        configurable: true,
        value: originalDecodeURIComponent,
      });
    }
  });

  it('fails closed when URL controls were already replaced before initialization', () => {
    const originDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'origin')!;
    Object.defineProperty(URL.prototype, 'origin', {
      configurable: true,
      get() {
        return 'https://app.example';
      },
    });
    try {
      expect(() => createBrowserNavigationSecurityControls()).toThrow(
        /realm intrinsics were modified before runtime initialization/,
      );
    } finally {
      Object.defineProperty(URL.prototype, 'origin', originDescriptor);
    }
  });
});
