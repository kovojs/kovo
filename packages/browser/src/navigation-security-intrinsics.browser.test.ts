import { describe, expect, it } from 'vitest';

import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

describe('browser navigation security controls', () => {
  it('pins mutation decoding and DOM commits after late intrinsic replacement', () => {
    const controls = createBrowserNavigationSecurityControls();
    const nativeDecode = TextDecoder.prototype.decode;
    const nativeReplaceWith = Element.prototype.replaceWith;
    const current = document.createElement('main');
    const next = document.createElement('section');
    current.setAttribute('kovo-fragment-target', 'late-control');
    document.body.append(current);

    TextDecoder.prototype.decode = () => 'ATTACKER-SUBSTITUTED';
    Element.prototype.replaceWith = function () {};
    try {
      const decoder = controls.createTextDecoder();
      expect(controls.decodeText(decoder, new TextEncoder().encode('SERVER-SAFE'))).toBe(
        'SERVER-SAFE',
      );
      controls.replaceElement(current, next);
      expect(document.body.firstElementChild).toBe(next);
    } finally {
      TextDecoder.prototype.decode = nativeDecode;
      Element.prototype.replaceWith = nativeReplaceWith;
      document.body.replaceChildren();
    }
  });

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

  it('fails closed on pre-initialization snapshot controls selectively forged for Kovo DOM authority', () => {
    const outerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML')!;
    const cloneNodeDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'cloneNode')!;
    const nativeOuterHtml = outerHtmlDescriptor.get!;
    const nativeCloneNode = cloneNodeDescriptor.value as (deep?: boolean) => Node;

    for (const authorityAttribute of ['kovo-nav-segment', 'kovo-fragment-target']) {
      Object.defineProperty(Element.prototype, 'outerHTML', {
        ...outerHtmlDescriptor,
        get(this: Element) {
          if (this.hasAttribute(authorityAttribute)) {
            return '<section data-selectively-forged="true"></section>';
          }
          return Reflect.apply(nativeOuterHtml, this, []);
        },
      });
      try {
        expect(() => createBrowserNavigationSecurityControls()).toThrow(
          /realm intrinsics were modified before runtime initialization/,
        );
      } finally {
        Object.defineProperty(Element.prototype, 'outerHTML', outerHtmlDescriptor);
      }
    }

    Object.defineProperty(Node.prototype, 'cloneNode', {
      ...cloneNodeDescriptor,
      value(this: Node, deep?: boolean) {
        if (this instanceof Element && this.hasAttribute('kovo-nav-segment')) {
          return document.createElement('section');
        }
        return Reflect.apply(nativeCloneNode, this, [deep]);
      },
    });
    try {
      expect(() => createBrowserNavigationSecurityControls()).toThrow(
        /realm intrinsics were modified before runtime initialization/,
      );
    } finally {
      Object.defineProperty(Node.prototype, 'cloneNode', cloneNodeDescriptor);
    }
  });

  it('fails closed when mutation decoder or exact DOM commit methods were poisoned before capture', () => {
    const nativeDecode = TextDecoder.prototype.decode;
    const nativeReplaceWith = Element.prototype.replaceWith;

    TextDecoder.prototype.decode = function poisonedDecode(
      input?: AllowSharedBufferSource,
    ): string {
      return input === undefined ? '' : 'ATTACKER-SUBSTITUTED';
    } as typeof TextDecoder.prototype.decode;
    try {
      expect(() => createBrowserNavigationSecurityControls()).toThrow(
        /realm intrinsics were modified before runtime initialization/,
      );
    } finally {
      TextDecoder.prototype.decode = nativeDecode;
    }

    Element.prototype.replaceWith = function poisonedReplaceWith(): void {};
    try {
      expect(() => createBrowserNavigationSecurityControls()).toThrow(
        /realm intrinsics were modified before runtime initialization/,
      );
    } finally {
      Element.prototype.replaceWith = nativeReplaceWith;
    }
  });
});
