import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { generatedFragmentHtml } from './html.js';
import { renderDeferredStream, renderDeferredStreamingResponse } from './deferred-stream.js';
import { renderPageHints } from './hints.js';
import { redirectLocationHeader, respond } from './response.js';

const originalArrayJoin = Array.prototype.join;
const originalArraySome = Array.prototype.some;
const originalSetHas = Set.prototype.has;
const originalStringStartsWith = String.prototype.startsWith;
const intrinsicModuleUrl = new URL('./response-security-intrinsics.ts', import.meta.url).href;

afterEach(() => {
  Array.prototype.join = originalArrayJoin;
  Set.prototype.has = originalSetHas;
  String.prototype.startsWith = originalStringStartsWith;
});

describe('response output intrinsic closure', () => {
  it('keeps app Set-Cookie outside respond.file when Set.has lies', () => {
    Set.prototype.has = function () {
      return false;
    };
    expect(() =>
      respond.file('safe', {
        contentType: 'text/plain',
        // @ts-expect-error Cookies use the typed mutation cookie builder (SPEC §9.1.1; KV415).
        headers: { 'Set-Cookie': 'sid=attacker; Path=/' },
      }),
    ).toThrow(/KV415.*Set-Cookie.*typed mutation cookie builder/u);
  });

  it('neutralizes a protocol-relative redirect when String.startsWith lies selectively', () => {
    String.prototype.startsWith = function (search: string, position?: number) {
      if (String(this) === '//evil.example/phish' && search === '//') return false;
      return originalStringStartsWith.call(this, search, position);
    };
    expect(redirectLocationHeader('//evil.example/phish')).toBe('/');
  });

  it('keeps the complete deferred document pinned through the final Array.join', () => {
    Array.prototype.join = function (separator?: string) {
      if (
        originalArraySome.call(
          this,
          (value: unknown) => typeof value === 'string' && value === '<main>safe</main>',
        )
      ) {
        return '<!doctype html><img src=x onerror=attacker()>';
      }
      return originalArrayJoin.call(this, separator);
    };
    const response = renderDeferredStream({
      shell: '<main>safe</main>',
      closeHtml: '</body></html>',
      chunks: [
        {
          fragments: [{ html: generatedFragmentHtml('<p>safe</p>'), target: 'result' }],
        },
      ],
    });
    expect(response.body).toContain('<main>safe</main>');
    expect(response.body).toContain('<kovo-fragment target="result"><p>safe</p></kovo-fragment>');
    expect(response.body).not.toContain('onerror=attacker');
  });

  it('keeps safe hint HTML and metadata paired through the final Array.join', () => {
    Array.prototype.join = function (separator?: string) {
      if (
        originalArraySome.call(
          this,
          (value: unknown) => typeof value === 'string' && value.includes('rel="modulepreload"'),
        )
      ) {
        return '<script src="/attacker.js"></script>';
      }
      return originalArrayJoin.call(this, separator);
    };
    const hints = renderPageHints({ modulepreloads: ['/c/public.client.js@v1'] });
    expect(hints.html).toBe(
      '<link rel="modulepreload" href="/c/public.client.js@v1" data-kovo-module-allowlist>',
    );
    expect(hints.html).not.toContain('/attacker.js');
    expect(hints.csp).toBeUndefined();
  });

  it('pins promise, encoder, and stream controller controls for live deferred output', async () => {
    const originalPromiseRace = Promise.race;
    const originalPromiseResolve = Promise.resolve;
    const originalPromiseThen = Promise.prototype.then;
    const originalEncode = TextEncoder.prototype.encode;
    const originalEnqueue = ReadableStreamDefaultController.prototype.enqueue;
    const originalClose = ReadableStreamDefaultController.prototype.close;
    const originalError = ReadableStreamDefaultController.prototype.error;
    const chunkPromise = originalPromiseResolve.call(Promise, {
      fragments: [{ html: generatedFragmentHtml('<p>safe</p>'), target: 'result' }],
    });
    try {
      Promise.race = function poisonedRace(values) {
        if ((values as readonly unknown[])[0] === chunkPromise) {
          return originalPromiseResolve.call(Promise, {
            index: 0,
            value: { fragments: [{ html: '<script>attacker()</script>', target: 'result' }] },
          }) as never;
        }
        return originalPromiseRace.call(Promise, values);
      };
      Promise.resolve = function poisonedResolve(value) {
        if (value === chunkPromise) {
          return originalPromiseResolve.call(Promise, {
            fragments: [{ html: '<script>attacker()</script>', target: 'result' }],
          }) as never;
        }
        return originalPromiseResolve.call(Promise, value) as never;
      };
      Promise.prototype.then = function poisonedThen(onFulfilled, onRejected) {
        if (this === chunkPromise) {
          return originalPromiseResolve.call(Promise, {
            fragments: [{ html: '<script>attacker()</script>', target: 'result' }],
          }) as never;
        }
        return originalPromiseThen.call(this, onFulfilled, onRejected);
      };
      TextEncoder.prototype.encode = () => new Uint8Array([0x58, 0x53, 0x53]);
      ReadableStreamDefaultController.prototype.enqueue = () => {
        throw new Error('ambient controller.enqueue reached');
      };
      ReadableStreamDefaultController.prototype.close = () => {
        throw new Error('ambient controller.close reached');
      };
      ReadableStreamDefaultController.prototype.error = () => {
        throw new Error('ambient controller.error reached');
      };

      const response = renderDeferredStreamingResponse({
        chunks: [chunkPromise],
        closeHtml: '</body></html>',
        shell: '<main>safe</main>',
      });
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      expect(body).toContain('<main>safe</main>');
      expect(body).toContain('<kovo-fragment target="result"><p>safe</p></kovo-fragment>');
      expect(body).not.toContain('XSS');
    } finally {
      Promise.race = originalPromiseRace;
      Promise.resolve = originalPromiseResolve;
      Promise.prototype.then = originalPromiseThen;
      TextEncoder.prototype.encode = originalEncode;
      ReadableStreamDefaultController.prototype.enqueue = originalEnqueue;
      ReadableStreamDefaultController.prototype.close = originalClose;
      ReadableStreamDefaultController.prototype.error = originalError;
    }
  });

  it('fails closed when response controls are poisoned before framework import', () => {
    const script = `
      void Headers;
      void URL;
      void ReadableStream;
      Set.prototype.has = () => false;
      const nativeStartsWith = String.prototype.startsWith;
      String.prototype.startsWith = function poisonedStartsWith(search, position) {
        if (String(this) === '//evil.example/phish' && search === '//') return false;
        return Reflect.apply(nativeStartsWith, this, [search, position]);
      };
      const controls = await import(${JSON.stringify(`${intrinsicModuleUrl}?preimport-poison`)});
      try {
        controls.assertResponseSecurityIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
