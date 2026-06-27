import { describe, expect, it } from 'vitest';

import {
  emptyCspInlineMetadata,
  renderCspReportingHeaders,
  renderContentSecurityPolicy,
  renderDefaultDocumentCsp,
} from './csp.js';

describe('CSP source-list value validation (bugz-3 L18, SPEC §6.6)', () => {
  // bugz-3 L18: `directive()` joins source-list values with spaces and the directives with
  // `; `. A value carrying `;`/whitespace/newline can smuggle a NEW directive that, by CSP
  // first-occurrence-wins, overrides the supposedly NON-overridable hardening directives
  // (`base-uri`/`object-src`/`form-action`/`frame-ancestors`). Before the fix the crafted
  // value flowed verbatim into the joined string; now it is rejected fail-closed.
  it('rejects an allowlist value that smuggles a second directive via ";"', () => {
    const smuggled = "evil.com; script-src 'unsafe-inline'";

    expect(() =>
      renderDefaultDocumentCsp(emptyCspInlineMetadata(), {
        allowlist: { scriptSrc: [smuggled] },
      }),
    ).toThrow(/directive separator/);

    // The exploit is gone: no assembled policy string is ever produced that contains the
    // smuggled `script-src 'unsafe-inline'` override — the builder throws instead.
    let assembled: string | undefined;
    try {
      assembled = renderDefaultDocumentCsp(emptyCspInlineMetadata(), {
        allowlist: { scriptSrc: [smuggled] },
      });
    } catch {
      assembled = undefined;
    }
    expect(assembled).toBeUndefined();
  });

  it('rejects whitespace, newline, comma, and control characters in source-list values', () => {
    const metadata = emptyCspInlineMetadata();
    for (const bad of [
      'evil.com extra-token',
      'evil.com\nscript-src *',
      'evil.com,object-src *',
      'evil\tcom',
      'evil.com\x00',
    ]) {
      expect(() => renderContentSecurityPolicy(metadata, { connectSrc: ["'self'", bad] })).toThrow(
        /Content-Security-Policy/,
      );
    }
  });

  it('still rejects smuggling through other allowlisted per-fetch directives', () => {
    const metadata = emptyCspInlineMetadata();
    expect(() =>
      renderDefaultDocumentCsp(metadata, {
        allowlist: { connectSrc: ['https://api.example.com; base-uri https://evil.example'] },
      }),
    ).toThrow(/directive separator/);
  });

  it('accepts legitimate single source expressions (no false positives)', () => {
    const policy = renderDefaultDocumentCsp(emptyCspInlineMetadata(), {
      allowlist: {
        connectSrc: ['https://api.example.com'],
        imgSrc: ['https://cdn.example.com'],
        scriptSrc: ['https://js.stripe.com'],
        styleSrc: ['https://fonts.example.com'],
      },
    });

    expect(policy).toContain("script-src 'self' https://js.stripe.com");
    expect(policy).toContain('connect-src');
    // The non-overridable hardening directives survive intact with their secure defaults.
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it('accepts framework-generated hashes containing base64 "+"/"/"/"=" tokens', () => {
    const policy = renderContentSecurityPolicy({
      scripts: ['sha256-AB+cd/ef12345678901234567890123456789012345='],
      styles: [],
    });
    expect(policy).toContain(
      "script-src 'self' 'sha256-AB+cd/ef12345678901234567890123456789012345='",
    );
  });

  it('keeps reporting endpoints relative instead of using the request Host origin', () => {
    const headers = renderCspReportingHeaders({}, { endpointOrigin: 'https://attacker.example' });

    expect(headers?.['Report-To']).toBe(
      '{"endpoints":[{"url":"/_kovo/reports/csp"}],"group":"kovo-csp","max_age":10886400}',
    );
    expect(headers?.['Reporting-Endpoints']).toBe('kovo-csp="/_kovo/reports/csp"');
  });
});
