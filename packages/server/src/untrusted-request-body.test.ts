import { describe, expect, it } from 'vitest';

import { parseUntrustedJsonBodyBytes } from './untrusted-request-body.js';

describe('untrusted request body parser', () => {
  it('decodes webhook raw JSON bytes only through the parser choke', () => {
    const body = new TextEncoder().encode('{"id":"evt_1","nested":{"ok":true}}');

    expect(parseUntrustedJsonBodyBytes(body)).toEqual({
      ok: true,
      value: { id: 'evt_1', nested: { ok: true } },
    });
  });

  it('treats empty raw JSON bodies as an empty schema input object', () => {
    expect(parseUntrustedJsonBodyBytes(new Uint8Array())).toEqual({
      ok: true,
      value: {},
    });
  });

  it('returns typed failure for malformed raw JSON bytes', () => {
    const body = new TextEncoder().encode('{ not json');

    expect(parseUntrustedJsonBodyBytes(body)).toEqual({
      ok: false,
      reason: 'invalid-json',
    });
  });
});
