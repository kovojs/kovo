import { describe, expect, it } from 'vitest';

import {
  accept,
  assertInlineSafe,
  drainUnverifiedMimeFacts,
  InlineUnverifiedUploadError,
  mintStorageKey,
  sanitizeDownloadFilename,
  sniffUploadBytes,
} from './upload-sniff.js';

// KV428 (SPEC §6.6/§9.1): the deep byte sniffer is the server-truth content-type source and the
// inline-safety gate.
describe('upload byte sniffer (KV428)', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const pdf = new TextEncoder().encode('%PDF-1.7\n...');
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
  const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');

  it('mints a passive type from magic bytes and marks it inline-safe', () => {
    expect(sniffUploadBytes(png)).toEqual({ contentType: 'image/png', inlineSafe: true });
    expect(sniffUploadBytes(jpeg)).toEqual({ contentType: 'image/jpeg', inlineSafe: true });
    expect(sniffUploadBytes(pdf)).toEqual({ contentType: 'application/pdf', inlineSafe: true });
  });

  it('rejects SVG/HTML/XML as inline-safe (active content)', () => {
    expect(sniffUploadBytes(svg).inlineSafe).toBe(false);
    expect(sniffUploadBytes(html).inlineSafe).toBe(false);
    // Leading whitespace / BOM does not let markup slip past.
    expect(sniffUploadBytes(new TextEncoder().encode('   <svg/>')).inlineSafe).toBe(false);
  });

  it('rejects a polyglot: image magic bytes carrying embedded markup', () => {
    const polyglot = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38, // GIF8 header
      ...new TextEncoder().encode('<script>alert(1)</script>'),
    ]);
    const sniffed = sniffUploadBytes(polyglot);
    expect(sniffed.contentType).toBe('image/gif');
    expect(sniffed.inlineSafe).toBe(false); // recognised, but NOT inline-safe.
  });

  it('treats unrecognised bytes as octet-stream, never inline-safe', () => {
    expect(sniffUploadBytes(new Uint8Array([0, 1, 2, 3]))).toEqual({
      contentType: 'application/octet-stream',
      inlineSafe: false,
    });
  });

  it('assertInlineSafe throws KV428 for non-passive bytes and returns the type for passive bytes', () => {
    expect(assertInlineSafe(png).contentType).toBe('image/png');
    expect(() => assertInlineSafe(svg)).toThrow(InlineUnverifiedUploadError);
    expect(() => assertInlineSafe(svg)).toThrow(/KV428/u);
  });
});

describe('storage key + filename hygiene (KV428)', () => {
  it('mints opaque server keys; a traversal filename can never be the key', () => {
    const key = mintStorageKey('avatars');
    expect(key).toMatch(/^avatars\/[0-9a-f-]{36}$/u);
    expect(mintStorageKey()).toMatch(/^[0-9a-f-]{36}$/u);
    expect(mintStorageKey()).not.toBe(mintStorageKey()); // distinct.
  });

  it('sanitizes a path-traversal filename into a safe download name', () => {
    expect(sanitizeDownloadFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeDownloadFilename('C:\\Windows\\evil.exe')).toBe('evil.exe');
    expect(sanitizeDownloadFilename('..')).toBe('download');
    expect(sanitizeDownloadFilename('a"; rm -rf /'.trim())).not.toContain('"');
  });
});

describe('accept.unverified escape (KV428)', () => {
  it('records a capability fact and requires a justification', () => {
    drainUnverifiedMimeFacts(); // clear.
    const acceptance = accept.unverified(['application/zip'], 'legacy importer trusts client type');
    expect(acceptance).toMatchObject({ unverified: true, types: ['application/zip'] });

    const facts = drainUnverifiedMimeFacts();
    expect(facts).toEqual([
      { justification: 'legacy importer trusts client type', types: ['application/zip'] },
    ]);
    expect(drainUnverifiedMimeFacts()).toEqual([]); // drained.

    expect(() => accept.unverified(['x'], '')).toThrow(/justification/u);
  });

  it('plain accept(...) passes through the type allowlist', () => {
    expect(accept(['image/png', 'image/jpeg'])).toEqual(['image/png', 'image/jpeg']);
  });
});
