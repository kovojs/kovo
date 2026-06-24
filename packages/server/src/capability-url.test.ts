import { describe, expect, it } from 'vitest';

import { signCapabilityUrl, verifyCapabilityUrl } from './capability-url.js';

const secret = 'capability-url-test-secret';
const now = Date.UTC(2026, 5, 24, 12, 0, 0);

describe('capability URL primitive', () => {
  it('signs and verifies method, key, expiry, and default exact scope', () => {
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      key: '/invoices/2026/receipt.pdf',
      method: 'get',
      now,
      secret,
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('kovo-cap-method')).toBe('GET');
    expect(parsed.searchParams.get('kovo-cap-key')).toBe('invoices/2026/receipt.pdf');
    expect(parsed.searchParams.get('kovo-cap-scope')).toBe('key:invoices/2026/receipt.pdf');

    expect(
      verifyCapabilityUrl(url, {
        key: 'invoices/2026/receipt.pdf',
        method: 'GET',
        now: now + 299_000,
        secret,
      }),
    ).toMatchObject({
      key: 'invoices/2026/receipt.pdf',
      method: 'GET',
      ok: true,
      scope: 'key:invoices/2026/receipt.pdf',
    });
  });

  it('rejects tampered method, key, scope, expiry, and signature bytes', () => {
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      expiresIn: 60,
      key: 'exports/report.csv',
      method: 'GET',
      now,
      secret,
    });

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'POST',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'method-mismatch' });

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/other.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'key-mismatch' });

    const scoped = new URL(url);
    scoped.searchParams.set('kovo-cap-scope', 'prefix:exports');
    expect(
      verifyCapabilityUrl(scoped, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'scope-mismatch' });

    const expiryTampered = new URL(url);
    expiryTampered.searchParams.set('kovo-cap-exp', String(Math.floor(now / 1000) + 600));
    expect(
      verifyCapabilityUrl(expiryTampered, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'invalid' });

    const signatureTampered = new URL(url);
    signatureTampered.searchParams.set('kovo-cap-sig', 'not-the-signature');
    expect(
      verifyCapabilityUrl(signatureTampered, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('enforces expiry before the sink reads the keyed object', () => {
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      expiresIn: 10,
      key: 'exports/report.csv',
      method: 'GET',
      now,
      secret,
    });

    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'GET',
        now: now + 10_000,
        secret,
      }),
    ).toMatchObject({ ok: true });
    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/report.csv',
        method: 'GET',
        now: now + 11_000,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('supports explicit prefix scope only when it contains the signed key', () => {
    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      key: 'exports/2026/report.csv',
      method: 'GET',
      now,
      scope: { kind: 'prefix', prefix: '/exports/2026' },
      secret,
    });

    expect(new URL(url).searchParams.get('kovo-cap-scope')).toBe('prefix:exports/2026');
    expect(
      verifyCapabilityUrl(url, {
        key: 'exports/2026/report.csv',
        method: 'GET',
        now,
        scope: { kind: 'prefix', prefix: 'exports/2026' },
        secret,
      }),
    ).toMatchObject({ ok: true, scope: 'prefix:exports/2026' });
    expect(() =>
      signCapabilityUrl({
        baseUrl: 'https://cdn.example.test/_cap/download',
        key: 'exports/2026/report.csv',
        method: 'GET',
        scope: { kind: 'prefix', prefix: 'private' },
        secret,
      }),
    ).toThrow(/prefix scope/iu);
  });

  it('rejects backslash, double-slash, and dot-segment key reopenings', () => {
    for (const key of ['exports\\report.csv', 'exports//report.csv', 'exports/./report.csv']) {
      expect(() =>
        signCapabilityUrl({
          baseUrl: 'https://cdn.example.test/_cap/download',
          key,
          method: 'GET',
          now,
          secret,
        }),
      ).toThrow(/Capability URL key/iu);
    }

    const url = signCapabilityUrl({
      baseUrl: 'https://cdn.example.test/_cap/download',
      key: 'exports/report.csv',
      method: 'GET',
      now,
      secret,
    });
    const reopened = new URL(url);
    reopened.searchParams.set('kovo-cap-key', 'exports//report.csv');

    expect(
      verifyCapabilityUrl(reopened, {
        key: 'exports/report.csv',
        method: 'GET',
        now,
        secret,
      }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });
});
