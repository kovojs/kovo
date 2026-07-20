import { beforeAll, describe, expect, it } from 'vitest';

import {
  browserPostureManifestSchema,
  type BrowserPostureManifest,
} from '@kovojs/core/internal/security-operation-ir';

import {
  assertCrossOriginIsolationEligible,
  browserResponsePostureHeaders,
  renderBrowserPermissionsPolicy,
} from './browser-response-posture.js';
import { emptyCspInlineMetadata, renderDefaultDocumentCspFromManifest } from './csp.js';
import { renderRouteDocumentResponse } from './document-core.js';
import {
  registerGeneratedBrowserPostureManifest,
  snapshotBrowserPostureManifest,
} from './generated-browser-posture-registry.js';

// @kovo-security-classifier-corpus browser-posture

const emptyManifest = (): BrowserPostureManifest => ({
  externalOrigins: [],
  isolationBlockers: [],
  opaqueExternalUrls: [],
  operations: [],
  schema: browserPostureManifestSchema,
});

beforeAll(() => {
  registerGeneratedBrowserPostureManifest(emptyManifest());
});

describe('compiler-derived browser response posture (SPEC §6.6)', () => {
  it('auto-admits census origins and rejects unmatched hand-written origins', () => {
    const manifest: BrowserPostureManifest = {
      ...emptyManifest(),
      externalOrigins: [
        {
          directive: 'frame-src',
          fileName: 'app.tsx',
          origin: 'https://frames.example.test',
          site: 'iframe[src]',
          span: { end: 38, start: 20 },
        },
        {
          directive: 'img-src',
          fileName: 'app.tsx',
          origin: 'https://images.example.test',
          site: 'img[src]',
          span: { end: 90, start: 40 },
        },
      ],
    };

    const automatic = renderDefaultDocumentCspFromManifest(emptyCspInlineMetadata(), {}, manifest);
    expect(automatic).toContain("frame-src 'self' https://frames.example.test");
    expect(automatic).toContain("img-src 'self' data: https://images.example.test");
    expect(
      renderDefaultDocumentCspFromManifest(
        emptyCspInlineMetadata(),
        { allowlist: { imgSrc: ['https://images.example.test'] } },
        manifest,
      ),
    ).toBe(automatic);
    expect(() =>
      renderDefaultDocumentCspFromManifest(
        emptyCspInlineMetadata(),
        { allowlist: { imgSrc: ['https://unused.example.test'] } },
        manifest,
      ),
    ).toThrow(/absent from the compiler-derived browser posture census/);
  });

  it('accepts only an explicit non-empty rationale for an uncensused origin', () => {
    const policy = renderDefaultDocumentCspFromManifest(
      emptyCspInlineMetadata(),
      {
        allowlist: {
          connectSrc: [
            {
              origin: 'https://runtime-api.example.test',
              rationale: 'reviewed tenant API selected by signed configuration',
            },
          ],
        },
      },
      emptyManifest(),
    );
    expect(policy).toContain("connect-src 'self' https://runtime-api.example.test");
    expect(() =>
      renderDefaultDocumentCspFromManifest(
        emptyCspInlineMetadata(),
        {
          allowlist: {
            connectSrc: [{ origin: 'https://runtime-api.example.test', rationale: '   ' }],
          },
        },
        emptyManifest(),
      ),
    ).toThrow(/require string origin and rationale/);
  });

  it('rejects inherited/accessor carriers instead of consulting caller code', () => {
    let getterCalls = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'origin', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'https://forged.example.test';
      },
    });
    Object.defineProperty(accessor, 'rationale', {
      enumerable: true,
      value: 'forged',
    });
    expect(() =>
      renderDefaultDocumentCspFromManifest(
        emptyCspInlineMetadata(),
        { allowlist: { scriptSrc: [accessor as never] } },
        emptyManifest(),
      ),
    ).toThrow(/own data property/);
    expect(getterCalls).toBe(0);

    const inherited = Object.create({ origin: 'https://forged.example.test' }) as Record<
      string,
      unknown
    >;
    inherited.rationale = 'forged';
    expect(() =>
      renderDefaultDocumentCspFromManifest(
        emptyCspInlineMetadata(),
        { allowlist: { scriptSrc: [inherited as never] } },
        emptyManifest(),
      ),
    ).toThrow(/origin must be an own data property/);
  });

  it('owns normal/reporting Permissions-Policy bytes through one operation switch', () => {
    const manifest: BrowserPostureManifest = {
      ...emptyManifest(),
      operations: [
        'browser.dialog.open',
        'browser.form.submit',
        'browser.framework.call',
        'browser.timer.schedule',
      ],
    };
    expect(renderBrowserPermissionsPolicy(undefined, manifest)).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    expect(renderBrowserPermissionsPolicy('kovo-csp', manifest)).toBe(
      'camera=();report-to=kovo-csp, microphone=();report-to=kovo-csp, geolocation=();report-to=kovo-csp, payment=();report-to=kovo-csp, usb=();report-to=kovo-csp',
    );
  });

  it('emits the exact optional isolation posture only for a closed manifest', () => {
    expect(
      browserResponsePostureHeaders({
        crossOriginIsolation: true,
        manifest: emptyManifest(),
      }),
    ).toEqual({
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Origin-Agent-Cluster': '?1',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    });
    expect(browserResponsePostureHeaders({ manifest: emptyManifest() })).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Origin-Agent-Cluster': '?1',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    });
  });

  it('stamps exact isolation bytes on documents and rejects route-level weakening', () => {
    const isolated = renderRouteDocumentResponse(
      {
        body: '<main>isolated</main>',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
      { csp: { crossOriginIsolation: true, reporting: false } },
    );
    expect(isolated.headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(isolated.headers['Cross-Origin-Embedder-Policy']).toBe('require-corp');
    expect(isolated.headers['Cross-Origin-Resource-Policy']).toBe('same-origin');

    expect(() =>
      renderRouteDocumentResponse(
        {
          body: '<main>weakened</main>',
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cross-Origin-Opener-Policy': 'unsafe-none',
          },
          status: 200,
        },
        { csp: { crossOriginIsolation: true, reporting: false } },
      ),
    ).toThrow(/route response cannot weaken it/);

    expect(() =>
      renderRouteDocumentResponse(
        {
          body: '<main>weakened</main>',
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Permissions-Policy': 'camera=(self)',
          },
          status: 200,
        },
        { csp: { crossOriginIsolation: true, reporting: false } },
      ),
    ).toThrow(/crossOriginIsolation requires Permissions-Policy/);

    expect(() =>
      renderRouteDocumentResponse(
        {
          body: '<main>weakened</main>',
          headers: {
            'Content-Security-Policy': "default-src * 'unsafe-inline'",
            'Content-Type': 'text/html; charset=utf-8',
          },
          status: 200,
        },
        { csp: { crossOriginIsolation: true, reporting: false } },
      ),
    ).toThrow(/requires the compiler-derived Content-Security-Policy/);
  });

  it.each([
    ['stylesheet', { stylesheets: ['https://cdn.example.test/app.css'] }],
    ['modulepreload', { modulepreloads: ['https://cdn.example.test/app.js'] }],
    ['bootstrap script', { bootstrapScript: 'https://cdn.example.test/bootstrap.js' }],
  ] as const)('rejects an external %s page hint before isolation headers ship', (_label, hints) => {
    expect(() =>
      renderRouteDocumentResponse(
        {
          body: '<main>isolated</main>',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 200,
        },
        { csp: { crossOriginIsolation: true, reporting: false }, hints },
      ),
    ).toThrow(/crossOriginIsolation is not closed: external/);
  });

  it.each([
    ['OAuth popup', 'popup'],
    ['third-party embed', 'frame'],
    ['dynamic fetch/worker', 'dynamic-fetch-or-worker'],
    ['opaque reviewed resource', 'opaque-resource'],
    ['external static asset', 'external-resource'],
  ] as const)('rejects %s fixtures before cross-origin isolation', (_label, kind) => {
    const manifest: BrowserPostureManifest = {
      ...emptyManifest(),
      isolationBlockers: [{ fileName: 'app.tsx', kind, site: `fixture:${kind}` }],
    };
    expect(() => assertCrossOriginIsolationEligible(manifest)).toThrow(
      new RegExp(`crossOriginIsolation is not closed: ${kind}`),
    );
  });

  it('re-witnesses generated manifest arrays and rejects mutable accessor entries', () => {
    let getterCalls = 0;
    const entry: Record<string, unknown> = {
      directive: 'img-src',
      fileName: 'app.tsx',
      origin: 'https://images.example.test',
      site: 'img[src]',
      span: { end: 20, start: 10 },
    };
    Object.defineProperty(entry, 'origin', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'https://forged.example.test';
      },
    });
    expect(() =>
      snapshotBrowserPostureManifest({
        ...emptyManifest(),
        externalOrigins: [entry as never],
      }),
    ).toThrow(/stable own data property/);
    expect(getterCalls).toBe(0);

    expect(() =>
      snapshotBrowserPostureManifest({
        ...emptyManifest(),
        externalOrigins: [
          {
            directive: 'img-src',
            fileName: 'app.tsx',
            origin: "'unsafe-inline'",
            site: 'img[src]',
            span: { end: 20, start: 10 },
          },
        ],
      }),
    ).toThrow(/canonical HTTP\(S\) origin/);
  });

  it('rejects contradictory generated isolation evidence instead of trusting blocker omission', () => {
    const external: BrowserPostureManifest = {
      ...emptyManifest(),
      externalOrigins: [
        {
          directive: 'img-src',
          fileName: 'app.tsx',
          origin: 'https://images.example.test',
          site: 'img[src]',
          span: { end: 20, start: 10 },
        },
      ],
    };
    expect(() => assertCrossOriginIsolationEligible(external)).toThrow(/external-resource/);
    expect(() =>
      assertCrossOriginIsolationEligible({
        ...emptyManifest(),
        operations: ['browser.framework.call'],
      }),
    ).toThrow(/dynamic-fetch-or-worker/);
  });
});
