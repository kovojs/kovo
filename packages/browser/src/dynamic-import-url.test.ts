import { describe, expect, it } from 'vitest';

import { parseKovoModuleRef } from '@kovojs/core/internal/module-ref';

import {
  assertAllowedKovoDynamicImportUrl,
  isAllowedKovoDynamicImportRef,
  isAllowedKovoDynamicImportUrl,
} from './dynamic-import-url.js';

describe('Kovo dynamic import URL guard', () => {
  it('keeps origin, path, extension, and manifest checks pinned after prototype poisoning', () => {
    const originalStartsWith = String.prototype.startsWith;
    const originalExec = RegExp.prototype.exec;
    const originalTest = RegExp.prototype.test;
    const originalIterator = Array.prototype[Symbol.iterator];
    const originalUrl = globalThis.URL;
    const pathnameDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'pathname');
    const originDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'origin');
    const manifest = ['/c/allowed.client.js'];
    let localSourceAllowed = true;
    let missingManifestAllowed = true;
    let allowedControl = false;
    try {
      String.prototype.startsWith = () => true;
      RegExp.prototype.exec = () => ['.ts'] as unknown as RegExpExecArray;
      RegExp.prototype.test = () => true;
      Array.prototype[Symbol.iterator] = function () {
        return { next: () => ({ done: true, value: undefined }) } as ArrayIterator<unknown>;
      };
      Object.defineProperty(URL.prototype, 'pathname', {
        configurable: true,
        get: () => '/c/allowed.client.js',
      });
      Object.defineProperty(URL.prototype, 'origin', {
        configurable: true,
        get: () => 'http://localhost',
      });
      globalThis.URL = class ForgedURL {
        origin = 'http://localhost';
        pathname = '/c/allowed.client.js';
        search = '';
      } as unknown as typeof URL;

      localSourceAllowed = isAllowedKovoDynamicImportUrl('/admin/upload');
      missingManifestAllowed = isAllowedKovoDynamicImportUrl('/c/missing.client.js', {
        allowedModuleUrls: manifest,
      });
      allowedControl = isAllowedKovoDynamicImportUrl('/c/allowed.client.js', {
        allowedModuleUrls: manifest,
      });
    } finally {
      String.prototype.startsWith = originalStartsWith;
      RegExp.prototype.exec = originalExec;
      RegExp.prototype.test = originalTest;
      Array.prototype[Symbol.iterator] = originalIterator;
      globalThis.URL = originalUrl;
      if (pathnameDescriptor) Object.defineProperty(URL.prototype, 'pathname', pathnameDescriptor);
      if (originDescriptor) Object.defineProperty(URL.prototype, 'origin', originDescriptor);
    }

    expect(localSourceAllowed).toBe(false);
    expect(missingManifestAllowed).toBe(false);
    expect(allowedControl).toBe(true);
  });

  it('rejects URLs outside same-origin Kovo client modules', () => {
    expect(isAllowedKovoDynamicImportUrl('data:text/javascript,export{}')).toBe(false);
    expect(isAllowedKovoDynamicImportUrl('https://cdn.example.test/c/cart.client.js')).toBe(false);
    expect(isAllowedKovoDynamicImportUrl('/assets/cart.js')).toBe(false);
  });

  it('allows same-origin source modules only on local dev origins', () => {
    expect(isAllowedKovoDynamicImportUrl('/client.ts')).toBe(true);
    expect(isAllowedKovoDynamicImportUrl('/state-actions.ts?import')).toBe(true);

    const location = globalThis.location;
    Reflect.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://shop.example.test/', origin: 'https://shop.example.test' },
    });
    try {
      expect(isAllowedKovoDynamicImportUrl('/client.ts')).toBe(false);
    } finally {
      Reflect.defineProperty(globalThis, 'location', {
        configurable: true,
        value: location,
      });
    }
  });

  it('denies retained same-origin versioned modules when no compiler allowlist exists', () => {
    expect(
      isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/cart.client.js', { buildToken: 'cart-v1' }),
    ).toBe(false);
    expect(
      isAllowedKovoDynamicImportUrl('/c/__v/old/cart.client.js', { buildToken: 'cart-v1' }),
    ).toBe(false);
  });

  it('requires manifest membership when a compiler-emitted allowlist is present', () => {
    const options = {
      allowedModuleUrls: ['/c/__v/cart-v1/cart.client.js', '/c/__v/cart-v1/panel.client.js?hash=1'],
      buildToken: 'cart-v1',
    };

    expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/cart.client.js', options)).toBe(true);
    expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/panel.client.js?hash=1', options)).toBe(
      true,
    );
    expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/secret.client.js', options)).toBe(false);
    expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/panel.client.js?hash=2', options)).toBe(
      false,
    );
  });

  it('checks parsed Kovo module refs at the dynamic import boundary', () => {
    const ref = parseKovoModuleRef('/c/__v/cart-v1/cart.client.js#Cart$click', 'handler');
    expect(ref).toBeDefined();

    expect(
      isAllowedKovoDynamicImportRef(ref!, {
        allowedModuleUrls: ['/c/__v/cart-v1/cart.client.js'],
        buildToken: 'cart-v1',
      }),
    ).toBe(true);
  });

  it('treats compiler-marked controls/modulepreloads as an allowlist, never ordinary preloads', () => {
    withDocumentModulepreloads(
      { allowlistHrefs: [], modulepreloadHrefs: ['/c/__v/cart-v1/eager.client.js'] },
      () => {
        expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/lazy.client.js')).toBe(false);
      },
    );

    withDocumentModulepreloads(
      { allowlistHrefs: ['/c/__v/cart-v1/eager.client.js'], modulepreloadHrefs: [] },
      () => {
        expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/eager.client.js')).toBe(true);
        expect(isAllowedKovoDynamicImportUrl('/c/__v/cart-v1/lazy.client.js')).toBe(false);
      },
    );
  });

  it('fails closed before import when a manifest-listed build URL is missing', () => {
    expect(() =>
      assertAllowedKovoDynamicImportUrl('/c/__v/cart-v1/secret.client.js', {
        allowedModuleUrls: ['/c/__v/cart-v1/cart.client.js'],
        buildToken: 'cart-v1',
      }),
    ).toThrow('Disallowed Kovo dynamic import URL: /c/__v/cart-v1/secret.client.js');
  });
});

function withDocumentModulepreloads(
  options: { allowlistHrefs: readonly string[]; modulepreloadHrefs: readonly string[] },
  run: () => void,
): void {
  const document = globalThis.document;
  Reflect.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelectorAll(selector: string) {
        const hrefs =
          selector === '[data-kovo-module-allowlist]'
            ? options.allowlistHrefs
            : selector === 'link[rel~="modulepreload"][href]'
              ? options.modulepreloadHrefs
              : [];
        return hrefs.map((href) => ({
          getAttribute(name: string) {
            return name === 'data-kovo-module-allowlist' ? href : null;
          },
        }));
      },
    },
  });
  try {
    run();
  } finally {
    Reflect.defineProperty(globalThis, 'document', {
      configurable: true,
      value: document,
    });
  }
}
