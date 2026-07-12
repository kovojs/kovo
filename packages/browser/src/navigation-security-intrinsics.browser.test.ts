import { describe, expect, it } from 'vitest';

import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';

describe('browser navigation security controls', () => {
  it('pins the PageTransitionEvent persisted getter after late replacement', () => {
    const controls = createBrowserNavigationSecurityControls();
    const descriptor = Object.getOwnPropertyDescriptor(PageTransitionEvent.prototype, 'persisted');
    if (!descriptor?.get) throw new Error('PageTransitionEvent.persisted getter unavailable');
    const restored = new PageTransitionEvent('pageshow', { persisted: true });
    const ordinary = new PageTransitionEvent('pageshow', { persisted: false });
    let poisonCalls = 0;

    Object.defineProperty(PageTransitionEvent.prototype, 'persisted', {
      ...descriptor,
      get: () => {
        poisonCalls += 1;
        return false;
      },
    });
    try {
      expect(controls.readPageTransitionPersisted(restored)).toBe(true);
      expect(controls.readPageTransitionPersisted(ordinary)).toBe(false);
      expect(controls.readPageTransitionPersisted(new Event('pageshow'))).toBe(true);
      expect(poisonCalls).toBe(0);
    } finally {
      Object.defineProperty(PageTransitionEvent.prototype, 'persisted', descriptor);
    }
  });

  it('pins reader read, cancel, release, lock posture, and byte snapshots after late replacement', async () => {
    const controls = createBrowserNavigationSecurityControls();
    const lockedDescriptor = Object.getOwnPropertyDescriptor(ReadableStream.prototype, 'locked')!;
    const nativeRead = ReadableStreamDefaultReader.prototype.read;
    const nativeCancel = ReadableStreamDefaultReader.prototype.cancel;
    const nativeReleaseLock = ReadableStreamDefaultReader.prototype.releaseLock;
    const nativeStreamCancel = ReadableStream.prototype.cancel;
    const serverBytes = new TextEncoder().encode('SERVER-SAFE');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(serverBytes);
        controller.close();
      },
    });
    const plan = await controls.acquireStreamReader(stream);
    let readPoisonCalls = 0;
    let cancelPoisonCalls = 0;
    let releasePoisonCalls = 0;

    ReadableStreamDefaultReader.prototype.read = async function poisonedRead() {
      readPoisonCalls += 1;
      return { done: false, value: new TextEncoder().encode('ATTACKER') };
    } as typeof ReadableStreamDefaultReader.prototype.read;
    Object.defineProperty(ReadableStream.prototype, 'locked', {
      configurable: true,
      get: () => false,
    });
    try {
      const read = await controls.readStreamChunk(plan);
      expect(read.done).toBe(false);
      if (read.done) throw new Error('missing stream witness bytes');
      serverBytes.fill(0x41);
      expect(new TextDecoder().decode(read.value)).toBe('SERVER-SAFE');
      expect(readPoisonCalls).toBe(0);
    } finally {
      ReadableStreamDefaultReader.prototype.read = nativeRead;
      Object.defineProperty(ReadableStream.prototype, 'locked', lockedDescriptor);
      controls.releaseStreamReader(plan);
    }

    const cancelStream = new ReadableStream<Uint8Array>();
    const cancelPlan = await controls.acquireStreamReader(cancelStream);
    ReadableStreamDefaultReader.prototype.cancel = async function poisonedCancel() {
      cancelPoisonCalls += 1;
    };
    ReadableStreamDefaultReader.prototype.releaseLock = function poisonedRelease(): void {
      releasePoisonCalls += 1;
    };
    Object.defineProperty(ReadableStream.prototype, 'locked', {
      configurable: true,
      get: () => false,
    });
    try {
      await controls.cancelStreamReader(cancelPlan);
      controls.releaseStreamReader(cancelPlan);
      expect(cancelPoisonCalls).toBe(0);
      expect(releasePoisonCalls).toBe(0);
      expect(Reflect.apply(lockedDescriptor.get!, cancelStream, [])).toBe(false);
    } finally {
      ReadableStreamDefaultReader.prototype.cancel = nativeCancel;
      ReadableStreamDefaultReader.prototype.releaseLock = nativeReleaseLock;
      Object.defineProperty(ReadableStream.prototype, 'locked', lockedDescriptor);
    }

    let underlyingCancelCalls = 0;
    let streamCancelPoisonCalls = 0;
    const directCancelStream = new ReadableStream<Uint8Array>({
      cancel() {
        underlyingCancelCalls += 1;
      },
    });
    ReadableStream.prototype.cancel = async function poisonedStreamCancel() {
      streamCancelPoisonCalls += 1;
    };
    try {
      await controls.cancelReadableStream(directCancelStream);
      expect(underlyingCancelCalls).toBe(1);
      expect(streamCancelPoisonCalls).toBe(0);
    } finally {
      ReadableStream.prototype.cancel = nativeStreamCancel;
    }
  });

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

  it('fails closed when stream acquisition or reader semantics were poisoned before capture', async () => {
    const nativeGetReader = ReadableStream.prototype.getReader;
    const nativeStreamCancel = ReadableStream.prototype.cancel;
    const nativeRead = ReadableStreamDefaultReader.prototype.read;
    const nativeCancel = ReadableStreamDefaultReader.prototype.cancel;

    ReadableStream.prototype.getReader = function poisonedGetReader() {
      return {} as ReadableStreamDefaultReader<unknown>;
    };
    try {
      expect(() => createBrowserNavigationSecurityControls()).toThrow(
        /realm intrinsics were modified before runtime initialization/,
      );
    } finally {
      ReadableStream.prototype.getReader = nativeGetReader;
    }

    for (const poison of ['read', 'reader-cancel', 'stream-cancel'] as const) {
      if (poison === 'read') {
        ReadableStreamDefaultReader.prototype.read = async function poisonedRead() {
          return { done: true, value: undefined };
        } as typeof ReadableStreamDefaultReader.prototype.read;
      } else if (poison === 'reader-cancel') {
        ReadableStreamDefaultReader.prototype.cancel = async function poisonedCancel() {};
      } else {
        ReadableStream.prototype.cancel = async function poisonedStreamCancel() {};
      }
      try {
        const controls = createBrowserNavigationSecurityControls();
        await expect(
          controls.acquireStreamReader(new ReadableStream<Uint8Array>()),
        ).rejects.toThrow(/witness/);
      } finally {
        ReadableStreamDefaultReader.prototype.read = nativeRead;
        ReadableStreamDefaultReader.prototype.cancel = nativeCancel;
        ReadableStream.prototype.cancel = nativeStreamCancel;
      }
    }
  });

  it('fails closed when PageTransitionEvent persisted was poisoned before capture', () => {
    const descriptor = Object.getOwnPropertyDescriptor(PageTransitionEvent.prototype, 'persisted');
    if (!descriptor?.get) throw new Error('PageTransitionEvent.persisted getter unavailable');
    Object.defineProperty(PageTransitionEvent.prototype, 'persisted', {
      ...descriptor,
      get: () => false,
    });
    try {
      expect(() => createBrowserNavigationSecurityControls()).toThrow(
        /realm intrinsics were modified before runtime initialization/,
      );
    } finally {
      Object.defineProperty(PageTransitionEvent.prototype, 'persisted', descriptor);
    }
  });
});
