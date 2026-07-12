import { describe, expect, it } from 'vitest';

import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

describe('browser navigation security controls in Chromium', () => {
  it('keeps URL, Headers, and DOMParser decisions pinned after late replacement', () => {
    const controls = createBrowserNavigationSecurityControls();
    const originDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'origin')!;
    const originalHeadersGet = Headers.prototype.get;
    const originalParseFromString = DOMParser.prototype.parseFromString;
    const response = new Response('<!doctype html><html><body>safe</body></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    Object.defineProperty(URL.prototype, 'origin', {
      configurable: true,
      get() {
        return location.origin;
      },
    });
    Headers.prototype.get = () => 'text/plain';
    DOMParser.prototype.parseFromString = function () {
      return document.implementation.createHTMLDocument('attacker');
    };
    try {
      expect(controls.parseUrl('https://evil.example/phish')?.origin).toBe('https://evil.example');
      expect(controls.readHeader(response, 'content-type')).toBe('text/html; charset=utf-8');
      expect(
        controls.parseHtmlDocument('<!doctype html><html><body>safe</body></html>')?.body
          .textContent,
      ).toBe('safe');
    } finally {
      Object.defineProperty(URL.prototype, 'origin', originDescriptor);
      Headers.prototype.get = originalHeadersGet;
      DOMParser.prototype.parseFromString = originalParseFromString;
    }
  });
});
