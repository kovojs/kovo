import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { component } from '@kovojs/core';

import { enhancedNavigationDocumentAcceptHeader } from '@kovojs/core/internal/document-protocol';

import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { appLiveTargetAttestationAudience } from './live-target-app-identity.js';
import { appRateLimitKeyCounts } from './app-load-shed.js';
import { handleAppStartupErrorResponse } from './app-request.js';
import { MAX_REQUEST_QUERY_ENTRIES } from './request-url-limits.js';
import { versionedClientModuleHref } from './client-modules.js';
import { KOVO_CSP_REPORT_ENDPOINT } from './csp.js';
import { csrfToken } from './csrf.js';
import { kovoSecurityReportSnapshot, resetKovoSecurityReportsForTest } from './reporting.js';
import { domain } from './domain.js';
import {
  endpoint,
  frameworkEndpoint,
  pinEndpointBrowserCredentialDelegation,
  type EndpointResponsePosture,
} from './endpoint.js';
import { registerGeneratedMutationTouchRegistry } from './generated-mutation-registry.js';
import { registerGeneratedQueryReadRegistry } from './generated-query-registry.js';
import { guards } from './guards.js';
import { mutation } from './mutation.js';
import { assignDerivedQueryKey, query } from './query.js';
import {
  registerGeneratedLiveTargetRenderer,
  runWithGeneratedLiveTargetRegistry,
} from './live-target-registry.js';
import { layout, route } from './route.js';
import { s, type Schema } from './schema.js';
import { stylesheet } from './hints.js';
import { assignDerivedTaskKey, task } from './task.js';
import { renderedHtml } from './html.js';
import { jsx } from './jsx-runtime.js';
import { createLiveTargetAttestation } from './mutation-wire.js';
import { respond } from './response.js';
import type { LiveTargetRenderer } from './mutation-wire.js';

function withCompilerLiveTargetRenderers<Result>(
  renderers: readonly LiveTargetRenderer<any>[],
  action: () => Result,
): Result {
  return runWithGeneratedLiveTargetRegistry(() => {
    for (const renderer of renderers) registerGeneratedLiveTargetRenderer(renderer);
    return action();
  });
}

function attestedLiveTargetHeader(
  target: string,
  component: string,
  buildToken: string,
  props: Record<string, unknown> = {},
  csrf?: { secret: string; sessionId: (request: unknown) => string | undefined },
  sourceUrl?: string,
  principal?: string,
): string {
  // SPEC §9.3: the live-target attestation is bound to the CSRF secret + session principal, so an
  // app configured with `csrf` must mint the test attestation under the same keyring/principal.
  const token = createLiveTargetAttestation(
    { component, props, target },
    {
      buildToken,
      ...(csrf === undefined ? {} : { csrf }),
      request: principal === undefined ? {} : { session: { user: { id: principal } } },
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
    },
  );
  return `${target}#${component}@${token}:${JSON.stringify(props)}`;
}

const rawTextResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

const rawJsonResponse = {
  appOwnedSafety: true,
  body: 'json',
  cache: 'no-store',
} satisfies EndpointResponsePosture;

function expectReservedSystemResponsePosture(response: Response, buildToken: string): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('vary')).toBe('Cookie');
  expect(response.headers.get('kovo-build')).toBe(buildToken);
}

describe('framework-owned CSP reporting endpoint (OPP-14)', () => {
  it('accepts browser CSP reports on the reserved framework endpoint', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    const response = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify([{ type: 'csp-violation', body: { blockedURL: 'inline' } }]),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(kovoSecurityReportSnapshot(app).aggregates).toMatchObject([
      { count: 1, report: { blocked: 'inline', type: 'csp-violation' } },
    ]);
  });

  it('accepts CSP reports even when the app body-size cap is smaller than the report', async () => {
    const handler = createRequestHandler(createApp({ requestLimits: { maxBodyBytes: 1 } }));
    const response = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify({ type: 'csp-violation', body: { blockedURL: 'inline' } }),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
  });

  it.each(['never settles', 'rejects'] as const)(
    'does not wait when oversized CSP report stream cancellation %s',
    async (behavior) => {
      let cancelCalls = 0;
      const app = createApp();
      const handler = createRequestHandler(app);
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelCalls += 1;
          return behavior === 'never settles'
            ? new Promise<void>(() => undefined)
            : Promise.reject(new Error('cancel trap'));
        },
        start(controller) {
          controller.enqueue(new Uint8Array(70_000));
        },
      });

      const response = await handler(
        new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
          body,
          headers: { 'Content-Type': 'application/reports+json' },
          method: 'POST',
          duplex: 'half',
        } as RequestInit),
      );

      expect(response.status).toBe(204);
      expect(cancelCalls).toBe(1);
      expect(kovoSecurityReportSnapshot(app).dropped).toBeGreaterThan(0);
    },
  );

  it('redacts report URLs and aggregates repeated report fingerprints', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    const body = [
      {
        body: {
          blockedURL: 'https://cdn.example.test/script.js?token=secret#hash',
          documentURL: 'https://app.example.test/orders?session=secret',
          effectiveDirective: 'script-src',
          sample: 'do not store attacker-controlled source samples',
        },
        type: 'csp-violation',
        url: 'https://app.example.test/fallback?secret=1',
        user_agent: 'do not store user agents',
      },
      {
        body: {
          blockedURL: 'https://cdn.example.test/script.js?other=secret',
          documentURL: 'https://app.example.test/orders?other=secret',
          effectiveDirective: 'script-src',
        },
        type: 'csp-violation',
      },
    ];

    const response = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
    expect(kovoSecurityReportSnapshot(app)).toMatchObject({
      aggregates: [
        {
          count: 2,
          report: {
            // L14 (SPEC §6.6): redaction now keeps only the origin (path/query/fragment
            // dropped) so a path-embedded secret can never persist in the "redacted" aggregate.
            blocked: 'https://cdn.example.test',
            document: 'https://app.example.test',
            type: 'csp-violation',
            violatedDirective: 'script-src',
          },
        },
      ],
      dropped: 0,
    });
  });

  // L14 (SPEC §6.6): redaction must strip secrets carried in URL *path* segments
  // (reset/magic-link/capability tokens), not only the query/fragment. The stored
  // aggregate the framework labels "redacted" must keep only the origin.
  it('redacts secrets embedded in CSP report URL path segments', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    const response = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify({
          'csp-report': {
            'blocked-uri': 'https://evil.example.test/exfil/PATHSECRET-blocked-9f3a1c',
            'document-uri':
              'https://app.example.test/reset-password/PATHSECRET-9f3a1c?token=QUERYSECRET#QUERYSECRET',
            'violated-directive': 'img-src',
          },
        }),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(204);
    const snapshot = kovoSecurityReportSnapshot(app);
    expect(snapshot.aggregates[0]?.report).toMatchObject({
      blocked: 'https://evil.example.test',
      document: 'https://app.example.test',
      type: 'csp-violation',
      violatedDirective: 'img-src',
    });
    // The path/query/fragment secrets must not survive anywhere in the stored aggregate.
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('PATHSECRET-9f3a1c');
    expect(serialized).not.toContain('PATHSECRET-blocked-9f3a1c');
    expect(serialized).not.toContain('QUERYSECRET');
  });

  it('normalizes legacy CSP, COOP, and Permissions Policy reports without storing raw samples', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify([
          {
            'csp-report': {
              'blocked-uri': 'data:text/html,secret',
              'document-uri': 'https://app.example.test/account?secret=1',
              'violated-directive': 'img-src',
            },
          },
          {
            body: {
              disposition: 'enforce',
              effectivePolicy: 'same-origin-allow-popups',
              openerURL: 'https://opener.example.test/path?secret=1',
            },
            type: 'coop',
          },
          {
            body: {
              disposition: 'enforce',
              featureId: 'camera',
              sourceFile: 'https://app.example.test/app.js?secret=1',
            },
            type: 'permissions-policy-violation',
          },
        ]),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(kovoSecurityReportSnapshot(app).aggregates).toMatchObject([
      {
        report: {
          blocked: 'data:',
          // L14 (SPEC §6.6): origin-only redaction drops the `/account` path segment.
          document: 'https://app.example.test',
          type: 'csp-violation',
          violatedDirective: 'img-src',
        },
      },
      {
        report: {
          disposition: 'enforce',
          effectivePolicy: 'same-origin-allow-popups',
          type: 'coop',
        },
      },
      {
        report: {
          disposition: 'enforce',
          feature: 'camera',
          type: 'permissions-policy-violation',
        },
      },
    ]);
  });

  it('bounds per-request report items and drops malformed oversized input quietly', async () => {
    const app = createApp();
    const handler = createRequestHandler(app);
    // Vary by ORIGIN, not path: L14 redaction keeps only the origin, so distinct reports
    // must differ by origin to remain distinct aggregates after redaction.
    const reports = Array.from({ length: 25 }, (_unused, index) => ({
      body: { blockedURL: `https://cdn-${index}.example.test/script.js` },
      type: 'csp-violation',
    }));

    const many = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: JSON.stringify(reports),
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );
    const oversized = await handler(
      new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`, {
        body: `{"type":"csp-violation","body":{"blockedURL":"${'x'.repeat(70_000)}"}}`,
        headers: { 'Content-Type': 'application/reports+json' },
        method: 'POST',
      }),
    );

    expect(many.status).toBe(204);
    expect(oversized.status).toBe(204);
    expect(kovoSecurityReportSnapshot(app).aggregates).toHaveLength(20);
    expect(kovoSecurityReportSnapshot(app).dropped).toBeGreaterThanOrEqual(6);
    resetKovoSecurityReportsForTest(app);
    expect(kovoSecurityReportSnapshot(app)).toEqual({ aggregates: [], dropped: 0 });
  });

  it('rejects non-POST CSP report requests without falling through to app routes', async () => {
    const appRoute = route(KOVO_CSP_REPORT_ENDPOINT, {
      page: () => trustedHtml('<main>app route should not win</main>'),
    });
    const handler = createRequestHandler(createApp({ routes: [appRoute] }));
    const response = await handler(new Request(`https://example.test${KOVO_CSP_REPORT_ENDPOINT}`));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.text()).toBe('');
  });
});

describe('server createApp request shell', () => {
  it('registers an endpoint with a concrete DB context without widening it to unknown', () => {
    interface TypedEndpointDb {
      select(): { from(table: unknown): Promise<unknown[]> };
    }

    const typedEndpoint = endpoint<'/typed-endpoint-db', 'GET', 'exact', TypedEndpointDb>(
      '/typed-endpoint-db',
      {
        db: true,
        async handler(_request, context) {
          const scoped = await context.actAs('typed-principal');
          void scoped.db.read.select;
          return Response.json({ ok: true });
        },
        method: 'GET',
        reason: 'type-level concrete endpoint DB registration proof',
        response: rawJsonResponse,
      },
    );

    const app = createApp({ endpoints: [typedEndpoint] });
    expect(app.endpoints).toHaveLength(1);
  });

  it('keeps guarded file 200/304 responses private across route and parent-layout access graphs', async () => {
    const allowVictim = (request: Request) =>
      request.headers.get('x-principal') === 'victim' ? true : ({ kind: 'forbidden' } as const);
    const filePage = () =>
      respond.file('PRIVATE:victim', {
        contentType: 'text/plain; charset=utf-8',
        etag: '"private-v1"',
        filename: 'private.txt',
      });

    const directAccessLayout = layout({ access: [allowVictim] });
    const parentAccessLayout = layout({ access: [allowVictim] });
    const childOfAccessLayout = layout({ parent: parentAccessLayout });
    const directLegacyGuardLayout = layout({ guard: allowVictim });
    const parentLegacyGuardLayout = layout({ guard: allowVictim });
    const childOfLegacyGuardLayout = layout({ parent: parentLegacyGuardLayout });
    const guardedRoutes = [
      route('/private-route-access', { access: [allowVictim], page: filePage }),
      route('/private-route-guard', { guard: allowVictim, page: filePage }),
      route('/private-layout-access', { layout: directAccessLayout, page: filePage }),
      route('/private-parent-layout-access', { layout: childOfAccessLayout, page: filePage }),
      route('/private-layout-guard', { layout: directLegacyGuardLayout, page: filePage }),
      route('/private-parent-layout-guard', {
        layout: childOfLegacyGuardLayout,
        page: filePage,
      }),
    ];
    const explicitPublic = route('/explicit-public-file', {
      access: publicAccess('public cache-floor control'),
      // An explicit access decision suppresses the legacy fallback. Cache posture must mirror that
      // exact enforcement rule rather than treating property presence as authority.
      guard: allowVictim,
      page: () =>
        respond.file('PUBLIC', {
          contentType: 'text/plain; charset=utf-8',
          etag: '"public-v1"',
          filename: 'public.txt',
        }),
    });
    const handler = createRequestHandler(createApp({ routes: [...guardedRoutes, explicitPublic] }));

    for (let index = 0; index < guardedRoutes.length; index += 1) {
      const path = guardedRoutes[index]!.path;
      const unauthorized = await handler(new Request(`https://example.test${path}`));
      expect(unauthorized.status, path).toBe(403);
      await expect(unauthorized.text()).resolves.not.toContain('PRIVATE:victim');

      const authorized = await handler(
        new Request(`https://example.test${path}`, {
          headers: { 'x-principal': 'victim' },
        }),
      );
      expect(authorized.status, path).toBe(200);
      expect(authorized.headers.get('cache-control'), path).toBe('no-store');
      expect(authorized.headers.get('vary'), path).toContain('Cookie');
      await expect(authorized.text()).resolves.toBe('PRIVATE:victim');

      const notModified = await handler(
        new Request(`https://example.test${path}`, {
          headers: {
            'if-none-match': '"private-v1"',
            'x-principal': 'victim',
          },
        }),
      );
      expect(notModified.status, path).toBe(304);
      expect(notModified.headers.get('cache-control'), path).toBe('no-store');
      expect(notModified.headers.get('vary'), path).toContain('Cookie');
      await expect(notModified.text()).resolves.toBe('');
    }

    for (const headers of [undefined, { 'if-none-match': '"public-v1"' }]) {
      const response = await handler(
        new Request('https://example.test/explicit-public-file', { headers }),
      );
      expect(response.status).toBe(headers === undefined ? 200 : 304);
      expect(response.headers.get('cache-control')).toBeNull();
      expect(response.headers.get('vary')).toBeNull();
    }
  });

  it('ignores late Object.prototype policy when a pinned file outcome reaches the full handler', async () => {
    const outcome = respond.file('PINNED_BODY', {
      contentType: 'text/plain; charset=utf-8',
      filename: 'safe.txt',
    });
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/prototype-safe-file', {
            access: publicAccess('prototype snapshot regression'),
            page: () => outcome,
          }),
        ],
      }),
    );
    const previousEtag = Object.getOwnPropertyDescriptor(Object.prototype, 'etag');
    const previousHeaders = Object.getOwnPropertyDescriptor(Object.prototype, 'headers');
    let response: Response | undefined;

    try {
      Object.defineProperty(Object.prototype, 'etag', {
        configurable: true,
        value: '"inherited-forgery"',
        writable: true,
      });
      Object.defineProperty(Object.prototype, 'headers', {
        configurable: true,
        value: {
          'Cache-Control': 'public, max-age=86400',
          'X-Inherited-Forgery': 'reached-sink',
        },
        writable: true,
      });
      response = await handler(
        new Request('https://example.test/prototype-safe-file', {
          headers: { 'If-None-Match': '"inherited-forgery"' },
        }),
      );
    } finally {
      if (previousEtag === undefined) delete (Object.prototype as { etag?: unknown }).etag;
      else Object.defineProperty(Object.prototype, 'etag', previousEtag);
      if (previousHeaders === undefined) {
        delete (Object.prototype as { headers?: unknown }).headers;
      } else {
        Object.defineProperty(Object.prototype, 'headers', previousHeaders);
      }
    }

    expect(response).toBeDefined();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('etag')).toBeNull();
    expect(response!.headers.get('cache-control')).toBeNull();
    expect(response!.headers.get('x-inherited-forgery')).toBeNull();
    await expect(response!.text()).resolves.toBe('PINNED_BODY');
  });

  it('emits Kovo-Warn when SSR component query hydration caps a primary list read', async () => {
    const contactsQuery = query('contacts', {
      load: () => ({ items: Array.from({ length: 105 }, (_, index) => ({ id: index })) }),
      reads: [],
    });
    const Contacts = component({
      queries: { contacts: contactsQuery },
      render: ({ contacts }) =>
        jsx('main', {
          children: String((contacts as { items: unknown[] }).items.length),
        }),
    });
    const app = createApp({
      requestLimits: { maxQueryListItems: 100 },
      routes: [route('/', { page: () => jsx(Contacts, {}) })],
    });
    const response = await createRequestHandler(app)(new Request('https://example.test/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('kovo-warn')).toBe('QUERY_LIST_LIMIT $.items;limit=100');
    expect(await response.text()).toContain('<main>100</main>');
  });

  it('emits Kovo-Warn when a layout query caps a primary list read', async () => {
    const contactsQuery = query('layoutContacts', {
      load: () => ({ items: Array.from({ length: 4 }, (_, index) => ({ id: index })) }),
      reads: [],
    });
    const Shell = layout({
      queries: { contacts: contactsQuery },
      render({ contacts }, _state, slots) {
        return jsx('main', {
          children: [
            jsx('span', {
              children: String((contacts as { items: unknown[] }).items.length),
            }),
            slots.children,
          ],
        });
      },
    });
    const app = createApp({
      requestLimits: { maxQueryListItems: 2 },
      routes: [route('/', { layout: Shell, page: () => jsx('strong', { children: 'ready' }) })],
    });
    const response = await createRequestHandler(app)(new Request('https://example.test/'));

    expect(response.status).toBe(200);
    expect(response.headers.get('kovo-warn')).toBe('QUERY_LIST_LIMIT $.items;limit=2');
    expect(await response.text()).toContain('<span>2</span>');
  });

  it('derives the document BroadcastChannel fingerprint from the stable CSRF signing secret', async () => {
    const csrf = {
      secret: 'stable-session-fingerprint-secret-012345',
      sessionId: () => 'session-1',
    };
    const makeApp = () =>
      createApp({
        csrf,
        routes: [route('/', { page: () => renderedHtml('<main>Account</main>') })],
        sessionProvider: () => ({ user: { id: 'session-1' } }),
      });
    const first = await createRequestHandler(makeApp())(new Request('https://example.test/'));
    const second = await createRequestHandler(makeApp())(new Request('https://example.test/'));
    const differentSecret = await createRequestHandler(
      createApp({
        csrf: {
          ...csrf,
          secret: 'different-session-fingerprint-secret-012',
        },
        routes: [route('/', { page: () => renderedHtml('<main>Account</main>') })],
        sessionProvider: () => ({ user: { id: 'session-1' } }),
      }),
    )(new Request('https://example.test/'));

    const firstFingerprint = (await first.text()).match(
      /<meta name="kovo-session" content="([^"]+)">/,
    )?.[1];
    const secondFingerprint = (await second.text()).match(
      /<meta name="kovo-session" content="([^"]+)">/,
    )?.[1];
    const differentFingerprint = (await differentSecret.text()).match(
      /<meta name="kovo-session" content="([^"]+)">/,
    )?.[1];

    expect(firstFingerprint).toBeDefined();
    expect(secondFingerprint).toBe(firstFingerprint);
    expect(differentFingerprint).toBeDefined();
    expect(differentFingerprint).not.toBe(firstFingerprint);
    expect(firstFingerprint).not.toContain('session-1');
  });

  it('stores the closed app registries and options without adding middleware', () => {
    const productRoute = route('/products/:id', {});
    const statusEndpoint = endpoint('/status', {
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'status endpoint registry test',
      response: rawTextResponse,
    });
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const sessionProvider = () => ({ user: { id: 'u1' } });
    const appStylesheet = stylesheet('./styles.css');

    const app = createApp({
      endpoints: [statusEndpoint],
      queries: [productQuery],
      routes: [productRoute],
      sessionProvider,
      stylesheets: [appStylesheet],
    });

    expect(app.routes).toEqual([productRoute]);
    expect(app.endpoints).toEqual([statusEndpoint]);
    expect(app.queries).toEqual([productQuery]);
    expect(app.mutations).toEqual([]);
    expect(app.stylesheets).toEqual([appStylesheet]);
    expect(app.diagnostics).toEqual([]);
    expect(app.sessionProvider).toBe(sessionProvider);
    expect(app.requestLimits.maxBodyBytes).toBeGreaterThan(0);
    expect(app.requestLimits.maxQueryListItems).toBe(100);
    expect(app.requestLimits.perIp).toMatchObject({ max: expect.any(Number), windowMs: 60_000 });
    expect(app.requestLimits.perIp).toMatchObject({ maxKeys: expect.any(Number) });
    expect(app.requestLimits.mutations.perIp).toMatchObject({
      max: expect.any(Number),
      maxKeys: expect.any(Number),
      windowMs: 60_000,
    });
    expect('use' in app).toBe(false);
  });

  it('descriptor-snapshots mutable app security and runtime configuration', async () => {
    const originalNotFound = () => renderedHtml('<main>original-not-found</main>');
    const errorShells = { notFound: originalNotFound };
    const anonymousCookie = { name: 'original-csrf', sameSite: 'strict' as const };
    const trustedOrigins = ['https://trusted.example'];
    const csrf = {
      anonymousCookie,
      field: 'original-csrf-field',
      secret: 'original-app-snapshot-secret-0123456789',
      sessionId: () => 'original-session',
      trustedOrigins,
    };
    const retry = { backoff: 'linear' as const, maxAttempts: 2 };
    const cronArgs = { account: { id: 'original-account' } };
    const recurring = task('snapshot/recurring', {
      cron: '0 * * * *',
      cronArgs,
      input: s.object({ account: s.object({ id: s.string() }) }),
      retry,
      run: () => undefined,
    });
    const appStylesheet = stylesheet({ href: '/original.css', preload: true });
    const app = createApp({
      csrf,
      errorShells,
      routes: [route('/', { page: () => renderedHtml('<main>home</main>') })],
      stylesheets: [appStylesheet],
    });
    const taskApp = createApp({ tasks: [recurring] });

    errorShells.notFound = () => renderedHtml('<main>mutated-not-found</main>');
    csrf.field = 'mutated-field';
    csrf.secret = 'mutated-app-snapshot-secret-0123456789';
    csrf.sessionId = () => 'mutated-session';
    anonymousCookie.name = 'mutated-csrf';
    trustedOrigins[0] = 'https://attacker.example';
    retry.maxAttempts = 99;
    cronArgs.account.id = 'mutated-account';
    appStylesheet.href = '/mutated.css';

    expect(Object.isFrozen(app.csrf)).toBe(true);
    expect(Object.isFrozen(app.csrf?.anonymousCookie)).toBe(true);
    expect(app.csrf?.field).toBe('original-csrf-field');
    expect(app.csrf?.sessionId({})).toBe('original-session');
    expect(app.csrf?.trustedOrigins).toEqual(['https://trusted.example']);
    expect(Object.isFrozen(app.errorShells)).toBe(true);
    expect(taskApp.tasks[0]?.retry).toEqual({ backoff: 'linear', maxAttempts: 2 });
    expect(taskApp.tasks[0]?.cronArgs).toEqual({ account: { id: 'original-account' } });
    expect(Object.isFrozen(taskApp.tasks[0]?.cronArgs)).toBe(true);
    expect(Object.isFrozen((taskApp.tasks[0]?.cronArgs as { account: object }).account)).toBe(true);
    expect(app.stylesheets).toEqual([{ href: '/original.css', preload: true }]);
    expect(Object.isFrozen(app.stylesheets[0])).toBe(true);

    const handler = createRequestHandler(app);
    const missing = await handler(new Request('https://example.test/missing'));
    await expect(missing.text()).resolves.toContain('original-not-found');
    const home = await handler(new Request('https://example.test/'));
    const html = await home.text();
    expect(html).toContain('/original.css');
    expect(html).not.toContain('/mutated.css');
  });

  it.each(['_charset_', '_ChArSeT_'])(
    'rejects browser-reserved app CSRF field %s during app construction',
    (field) => {
      expect(() =>
        createApp({
          csrf: {
            field,
            secret: 'app-csrf-field-secret-0123456789abcdef',
            sessionId: () => 'session-1',
          },
        }),
      ).toThrow(/KV236.*_charset_.*SPEC §13\.2.*SPEC §6\.6/u);
    },
  );

  it('cannot substitute a validated CSRF trusted origin through an inherited array setter', () => {
    const nativeDefineProperty = Object.defineProperty;
    const previous = nativeDefineProperty
      ? Object.getOwnPropertyDescriptor(Array.prototype, '0')
      : undefined;
    const routes = [route('/', { page: () => renderedHtml('<main>home</main>') })];
    let poisonHits = 0;
    let app: ReturnType<typeof createApp> | undefined;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === 'https://trusted.example') {
            poisonHits += 1;
            nativeDefineProperty(this, '0', {
              configurable: true,
              enumerable: true,
              value: 'https://attacker.example',
              writable: true,
            });
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      app = createApp({
        csrf: {
          secret: 'trusted-origin-snapshot-secret-0123456789',
          sessionId: () => 'session',
          trustedOrigins: ['https://trusted.example'],
        },
        routes,
      });
    } finally {
      if (previous === undefined) delete (Array.prototype as { 0?: unknown })[0];
      else nativeDefineProperty(Array.prototype, '0', previous);
    }

    expect(poisonHits).toBe(0);
    expect(app?.csrf?.trustedOrigins).toEqual(['https://trusted.example']);
  });

  it('rejects a forged victim-session CSRF token after the authoring config is mutated', async () => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const csrf = {
      secret: 'victim-app-csrf-secret-012345678901234',
      sessionId(request: { headers?: Headers }) {
        return request.headers?.get('cookie')?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
      },
    };
    const app = createApp({
      csrf,
      mutations: [
        mutation('account/delete', {
          input: s.object({}),
          handler: mutationHandler,
        }),
      ],
    });
    const handler = createRequestHandler(app);

    csrf.secret = 'attacker-controlled-secret-0123456789012';
    csrf.sessionId = () => 'victim';
    const forged = csrfToken({}, csrf, { audience: 'account/delete' });
    const form = new FormData();
    form.set('kovo-csrf', forged);
    const response = await handler(
      new Request('https://example.test/_m/account/delete', {
        body: form,
        headers: { Cookie: 'sid=victim', Origin: 'https://example.test' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(422);
    expect(mutationHandler).not.toHaveBeenCalled();
  });

  it('pins retained opaque CSRF key-ring methods against a forged victim token', async () => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const originalSignature = Buffer.alloc(32, 0x11).toString('base64url');
    const attackerSignature = Buffer.alloc(32, 0x22).toString('base64url');
    const ring = {
      currentKeyId: 'original',
      sign: () => ({ keyId: 'original', signature: originalSignature }),
      verify: (input: { signature: string }) =>
        input.signature === originalSignature
          ? ({ keyId: 'original', ok: true } as const)
          : ({ ok: false, reason: 'bad-signature' } as const),
    };
    const csrf = { secret: ring, sessionId: () => 'victim' };
    const handler = createRequestHandler(
      createApp({
        csrf,
        mutations: [
          mutation('account/keyring-delete', {
            input: s.object({}),
            handler: mutationHandler,
          }),
        ],
      }),
    );

    ring.currentKeyId = 'attacker';
    ring.sign = () => ({ keyId: 'attacker', signature: attackerSignature });
    ring.verify = () => ({ keyId: 'attacker', ok: true }) as const;
    const forged = csrfToken({}, csrf, { audience: 'account/keyring-delete' });
    const form = new FormData();
    form.set('kovo-csrf', forged);
    const response = await handler(
      new Request('https://example.test/_m/account/keyring-delete', {
        body: form,
        headers: { Origin: 'https://example.test' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(422);
    expect(mutationHandler).not.toHaveBeenCalled();
  });

  it('pins a top-level custom mutation schema parse identity after createApp', async () => {
    const mutableSchema: Schema<Record<string, never>> = {
      parse() {
        throw new TypeError('strict schema rejects this request');
      },
    };
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const handler = createRequestHandler(
      createApp({
        mutations: [
          mutation('account/schema-boundary', {
            csrf: false,
            csrfJustification: 'test fixture uses a non-browser caller',
            input: mutableSchema,
            handler: mutationHandler,
          }),
        ],
      }),
    );

    mutableSchema.parse = () => ({});
    const response = await handler(
      new Request('https://example.test/_m/account/schema-boundary', {
        body: new FormData(),
        method: 'POST',
      }),
    );

    expect(response.status).not.toBe(200);
    expect(mutationHandler).not.toHaveBeenCalled();
  });

  it('assembles the closed app through captured array and Object traversal controls', () => {
    const originalIsArray = Array.isArray;
    const originalKeys = Object.keys;
    let app: ReturnType<typeof createApp>;
    try {
      Array.isArray = () => false;
      Object.keys = () => [];
      app = createApp({
        stylesheets: [{ href: '/captured.css' }],
        tasks: [task('captured/task', { input: s.object({}), run: () => undefined })],
      });
    } finally {
      Array.isArray = originalIsArray;
      Object.keys = originalKeys;
    }
    expect(app!.stylesheets).toEqual([{ href: '/captured.css' }]);
    expect(app!.tasks[0]?.key).toBe('captured/task');
    expect(Object.isFrozen(app!)).toBe(true);
  });

  it('uses only compiler-registered live target renderers', () => {
    const renderer = {
      component: 'test/create-app-registered-live-target',
      mutationKeys: [],
      queries: ['cart'],
      render: () => '<cart-badge>1</cart-badge>',
    };
    const app = withCompilerLiveTargetRenderers([renderer], () => createApp());
    expect(
      app.liveTargetRenderers.filter((candidate) => candidate.component === renderer.component),
    ).toEqual([renderer]);
    expect(() => createApp({ liveTargetRenderers: [] } as never)).toThrow(
      'createApp({ liveTargetRenderers }) is forbidden',
    );
  });

  it('rejects an accessor-backed liveTargetRenderers option without invoking it', () => {
    let reads = 0;
    const options = Object.defineProperty({}, 'liveTargetRenderers', {
      enumerable: true,
      get() {
        reads += 1;
        return [];
      },
    });

    expect(() => createApp(options)).toThrow('createApp({ liveTargetRenderers }) is forbidden');
    expect(reads).toBe(0);
  });

  it('keeps the compiler-registered renderer inventory under late Map.values replacement', () => {
    const renderer = {
      component: 'test/create-app-map-values-registered-live-target',
      mutationKeys: [],
      queries: ['cart'],
      render: () => '<cart-badge>safe</cart-badge>',
    };
    const forged = {
      component: renderer.component,
      mutationKeys: [],
      queries: ['cart'],
      render: () => '<img src=x onerror="globalThis.kovoRegistryMapXss=true">',
    };
    const originalValues = Map.prototype.values;
    let poisonedCalls = 0;
    Map.prototype.values = function () {
      poisonedCalls += 1;
      return [forged][Symbol.iterator]();
    } as typeof Map.prototype.values;

    let app: ReturnType<typeof createApp>;
    try {
      app = withCompilerLiveTargetRenderers([renderer], () => createApp());
    } finally {
      Map.prototype.values = originalValues;
    }

    expect(poisonedCalls).toBe(0);
    expect(
      app.liveTargetRenderers.filter((candidate) => candidate.component === renderer.component),
    ).toEqual([renderer]);
    expect(app.liveTargetRenderers).not.toContain(forged);
  });

  it('derives the app query registry from generated live target renderers and layouts', () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const productQuery = query('product', {
      load: () => ({ id: 'p1' }),
      reads: [],
    });
    const profileQuery = query('profile', {
      load: () => ({ name: 'Ada' }),
      reads: [],
    });
    const accountLayout = layout({
      queries: { profile: profileQuery },
      render: ({ profile }, _state, { children }) =>
        trustedHtml(`<main data-profile="${profile.name}">${String(children)}</main>`),
    });

    const renderer = {
      component: 'components/cart/badge',
      mutationKeys: [],
      queries: ['cart', 'product'],
      queryDefinitions: [cartQuery, productQuery],
      render: () => '<cart-badge>1</cart-badge>',
    };
    const app = withCompilerLiveTargetRenderers([renderer], () =>
      createApp({
        queries: [cartQuery],
        routes: [
          route('/account', {
            layout: accountLayout,
            page: () => trustedHtml('<section>Account</section>'),
          }),
        ],
      }),
    );

    expect(app.queries).toEqual([cartQuery, productQuery, profileQuery]);
  });

  it('accepts source-derived query keys assigned by generated modules', () => {
    const cartQuery = assignDerivedQueryKey(
      query({
        load: () => ({ count: 1 }),
        reads: [],
      }),
      'queries/cart/cart',
    );

    const app = createApp({ queries: [cartQuery] });

    expect(app.queries.map((candidate) => candidate.key)).toEqual(['queries/cart/cart']);
  });

  it('rejects query declarations whose source-derived key was not assigned', () => {
    const cartQuery = query({
      load: () => ({ count: 1 }),
      reads: [],
    });

    expect(() => createApp({ queries: [cartQuery] })).toThrow(
      /received query\(\{ \.\.\. \}\) before the compiler assigned its source-derived key/,
    );
  });

  it('rejects duplicate source-derived query keys at createApp build time', () => {
    const firstCart = assignDerivedQueryKey(
      query({
        load: () => ({ count: 1 }),
        reads: [],
      }),
      'queries/cart/cart',
    );
    const secondCart = assignDerivedQueryKey(
      query({
        load: () => ({ count: 2 }),
        reads: [],
      }),
      'queries/cart/cart',
    );

    expect(() => createApp({ queries: [firstCart, secondCart] })).toThrow(
      /two queries with the same key "queries\/cart\/cart"/,
    );
  });

  it('injects compiler-registered mutation touch sites into app mutations', () => {
    const cart = domain('generated-cart-fallback');
    const addToCart = mutation('generated/cart/add-app', {
      input: s.object({ productId: s.string() }),
      registry: { touches: [cart] },
      handler: (input) => input,
    });

    registerGeneratedMutationTouchRegistry({
      'generated/cart/add-app': [{ domain: 'generated-product', keys: 'arg:productId' }],
    });

    const app = createApp({ mutations: [addToCart] });

    expect(app.mutations[0]?.registry).toMatchObject({
      inferredTouches: [{ domain: 'generated-product', keys: 'arg:productId' }],
      touches: [cart],
    });
  });

  // H1 (SPEC §6.1 key-addressed mutation registry / §9.5 single keyed dispatch): two same-key
  // mutations make the second handler unreachable (app-mutation-request resolves with .find,
  // first-match-wins) while the compile-time invalidation registry last-write-wins the other
  // declaration. createApp must fail closed rather than silently shadow the second handler.
  it('rejects duplicate mutation keys at createApp build time (KV421 runtime sibling)', () => {
    const firstAdd = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });
    const secondAdd = mutation('cart/add', {
      input: s.object({ orderId: s.string() }),
      handler: (input) => input,
    });

    expect(() => createApp({ mutations: [firstAdd, secondAdd] })).toThrow(
      /two mutations with the same key "cart\/add"/,
    );
  });

  it('cannot erase duplicate mutation dispatch ambiguity with late Set poison', () => {
    const first = mutation('cart/poisoned-duplicate', {
      handler: (input) => input,
      input: s.object({ value: s.string() }),
    });
    const second = mutation('cart/poisoned-duplicate', {
      handler: (input) => input,
      input: s.object({ other: s.string() }),
    });
    const originalAdd = Set.prototype.add;
    const originalHas = Set.prototype.has;
    let failure: unknown;
    try {
      Set.prototype.add = function () {
        return this;
      };
      Set.prototype.has = () => false;
      try {
        createApp({ mutations: [first, second] });
      } catch (error) {
        failure = error;
      }
    } finally {
      Set.prototype.add = originalAdd;
      Set.prototype.has = originalHas;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/two mutations with the same key/);
  });

  it('cannot erase duplicate durable task dispatch ambiguity with late Set poison', () => {
    const first = task('tasks/poisoned-duplicate', {
      input: s.object({ value: s.string() }),
      run: (input) => input.value,
    });
    const second = task('tasks/poisoned-duplicate', {
      input: s.object({ other: s.string() }),
      run: (input) => input.other,
    });
    const originalAdd = Set.prototype.add;
    const originalHas = Set.prototype.has;
    let failure: unknown;
    try {
      Set.prototype.add = function () {
        return this;
      };
      Set.prototype.has = () => false;
      try {
        createApp({ tasks: [first, second] });
      } catch (error) {
        failure = error;
      }
    } finally {
      Set.prototype.add = originalAdd;
      Set.prototype.has = originalHas;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/two tasks with the same key/);
  });

  it('rejects object-form mutations before compiler-derived key metadata is attached', () => {
    const addToCart = mutation({
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    expect(() => createApp({ mutations: [addToCart] })).toThrow(/without a derived key/);
  });

  it('accepts object-form tasks after compiler-derived key metadata is attached', () => {
    const sendReceipt = assignDerivedTaskKey(
      task({
        input: s.object({ orderId: s.string() }),
        run(input) {
          return input.orderId;
        },
      }),
      'tasks/send-receipt',
    );

    const app = createApp({ tasks: [sendReceipt] });

    expect(app.tasks.map((entry) => entry.key)).toEqual(['tasks/send-receipt']);
  });

  it('accepts distinct mutation keys at createApp build time', () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });
    const removeFromCart = mutation('cart/remove', {
      input: s.object({ productId: s.string() }),
      handler: (input) => input,
    });

    const app = createApp({ mutations: [addToCart, removeFromCart] });
    expect(app.mutations.map((candidate) => candidate.key)).toEqual(['cart/add', 'cart/remove']);
  });

  it('cannot cross-bind a protected mutation to a public sibling through poisoned Array.find', async () => {
    const publicHandler = vi.fn((input) => input);
    const protectedHandler = vi.fn((input) => input);
    const publicMutation = mutation('registry/public-write', {
      access: publicAccess('public sibling used by registry poisoning regression'),
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      handler: publicHandler,
      input: s.object({ value: s.string() }),
    });
    const protectedMutation = mutation('registry/protected-write', {
      access: [() => false],
      handler: protectedHandler,
      input: s.object({ value: s.string() }),
    });
    const app = createApp({ mutations: [publicMutation, protectedMutation] });
    const handler = createRequestHandler(app);
    const originalFind = Array.prototype.find;
    Array.prototype.find = function (predicate, thisArg) {
      if (this === app.mutations) return publicMutation;
      return originalFind.call(this, predicate, thisArg);
    } as typeof Array.prototype.find;
    try {
      const response = await handler(
        new Request('https://example.test/_m/registry/protected-write', {
          body: JSON.stringify({ value: 'must-not-dispatch' }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(422);
      expect(publicHandler).not.toHaveBeenCalled();
      expect(protectedHandler).not.toHaveBeenCalled();
    } finally {
      Array.prototype.find = originalFind;
    }
  });

  it('rejects percent-spelled mutation keys after String.includes poisoning', async () => {
    const mutationHandler = vi.fn((input) => input);
    const handler = createRequestHandler(
      createApp({
        mutations: [
          mutation('%61', {
            csrf: false,
            csrfJustification: 'test fixture uses a non-browser caller',
            handler: mutationHandler,
            input: s.object({}),
          }),
        ],
      }),
    );
    const originalIncludes = String.prototype.includes;
    String.prototype.includes = () => false;
    try {
      const response = await handler(
        new Request('https://example.test/_m/%61', {
          body: new FormData(),
          method: 'POST',
        }),
      );
      expect(response.status).toBe(404);
      expect(mutationHandler).not.toHaveBeenCalled();
    } finally {
      String.prototype.includes = originalIncludes;
    }
  });

  it('injects compiler-registered query reads into app queries', () => {
    const catalogQuery = query('generatedCatalog', {
      load: () => ({ items: [] as string[] }),
    });

    registerGeneratedQueryReadRegistry([
      { domains: ['generated-catalog'], query: 'generatedCatalog' },
    ]);

    const app = createApp({ queries: [catalogQuery] });

    expect(app.queries[0]?.reads).toEqual([{ key: 'generated-catalog' }]);
  });

  it('rejects malformed compiler-registered query reads', () => {
    expect(() =>
      registerGeneratedQueryReadRegistry([
        { domains: ['cart', 1], query: 'generatedBadQuery' },
      ] as unknown as [{ domains: string[]; query: string }]),
    ).toThrow('Generated query read registry received an invalid registry.');
  });

  it('rejects malformed compiler-registered mutation touch sites', () => {
    expect(() =>
      registerGeneratedMutationTouchRegistry({
        'generated/cart/bad': [{ domain: 'cart', keys: 1 }] as unknown as [
          { domain: string; keys: string },
        ],
      }),
    ).toThrow('Generated mutation touch registry received an invalid registry.');
  });

  it('rejects malformed compatibility shells before request dispatch', () => {
    const app = createApp({ routes: [route('/products/:id', {})] });
    const rawHandler = async () => new Response('<main>compat</main>');

    expect(() =>
      createRequestHandler(rawHandler as unknown as Parameters<typeof createRequestHandler>[0]),
    ).toThrow(
      'createRequestHandler() requires a Kovo app aggregate. SPEC §9.5 request dispatch must start from createApp(), not a raw request handler or compatibility shell.',
    );
    expect(() =>
      createRequestHandler({
        ...app,
        renderRoute: '<main>compat</main>',
      } as unknown as Parameters<typeof createRequestHandler>[0]),
    ).toThrow('createRequestHandler() requires a Kovo app aggregate.');
  });

  it('rejects a shallow app clone before its audited query registry can be replaced', () => {
    const privateQuery = query('probe-secret', {
      access: [guards.authed()],
      load: () => ({ secret: 'private' }),
    });
    const replacement = query('probe-secret', {
      access: publicAccess('adversarial aggregate replacement'),
      load: () => ({ secret: 'leaked' }),
    });
    const app = createApp({ queries: [privateQuery] });
    const clone = { ...app };

    expect(() => createRequestHandler(clone as Parameters<typeof createRequestHandler>[0])).toThrow(
      'createRequestHandler() requires a Kovo app aggregate.',
    );
    clone.queries = [replacement];
    expect(() => createRequestHandler(clone as Parameters<typeof createRequestHandler>[0])).toThrow(
      'createRequestHandler() requires a Kovo app aggregate.',
    );
  });

  it('rejects malformed declaration entries before request dispatch', () => {
    const app = createApp({
      endpoints: [
        endpoint('/status', {
          handler: () => new Response('ok'),
          method: 'GET',
          reason: 'status endpoint registry test',
          response: rawTextResponse,
        }),
      ],
      mutations: [
        mutation('cart/add', {
          handler: () => ({ ok: true }),
          input: s.object({ productId: s.string() }),
        }),
      ],
      queries: [query('cart', { reads: [domain('cart')] })],
      routes: [route('/cart', { page: () => trustedHtml('<main>Cart</main>') })],
    });

    for (const malformedApp of [
      { ...app, endpoints: [{ path: '/status' }] },
      { ...app, mutations: [{ key: 'cart/add', handler: () => ({ ok: true }) }] },
      { ...app, queries: [{ key: 'cart', reads: [{ name: 'cart' }] }] },
      { ...app, routes: [{ page: () => trustedHtml('<main>Cart</main>') }] },
    ]) {
      expect(() =>
        createRequestHandler(malformedApp as unknown as Parameters<typeof createRequestHandler>[0]),
      ).toThrow('createRequestHandler() requires a Kovo app aggregate.');
    }
  });

  it('dispatches a matched route through Request to document Response', async () => {
    const productRoute = route('/products/:id', {
      meta: { title: 'Product' },
      page({ params, search }) {
        return renderedHtml(`<main>${params.id}:${search.tab}</main>`);
      },
      search: s.object({ tab: s.string() }),
    });
    const handler = createRequestHandler(createApp({ routes: [productRoute] }));

    const response = await handler(new Request('https://example.test/products/p1?tab=details'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toContain('<main>p1:details</main>');
  });

  it('serves enhanced navigation documents without resending the inline loader', async () => {
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/products/:id', {
            meta: { title: 'Product' },
            params: s.object({ id: s.string() }),
            page({ params }) {
              return renderedHtml(
                `<main kovo-nav-segment="page:/products/:id">${params.id}</main>`,
              );
            },
          }),
        ],
      }),
    );

    const full = await handler(new Request('https://example.test/products/p1'));
    const enhanced = await handler(
      new Request('https://example.test/products/p1', {
        headers: { Accept: enhancedNavigationDocumentAcceptHeader },
      }),
    );

    expect(full.status).toBe(200);
    expect(enhanced.status).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(enhanced.headers.get('vary')).toBe('Accept');

    const fullBody = await full.text();
    const enhancedBody = await enhanced.text();
    expect(fullBody).toContain('installInlineKovoBootstrap');
    expect(fullBody).toContain('/c/__v/');
    expect(fullBody).toContain('/kovo-runtime.client.js');
    expect(fullBody).toMatch(
      /\)\("\/c\/__v\/[^"]+\/kovo-runtime\.client\.js",\(url\)=>import\(url\)\);/,
    );
    expect(enhancedBody).not.toContain('installInlineKovoBootstrap');
    expect(enhancedBody).not.toContain('installInlineKovoLoader');
    expect(enhancedBody).toContain('<title>Product</title>');
    expect(enhancedBody).toContain('<meta name="kovo-build"');
    expect(enhancedBody).toContain('<main kovo-nav-segment="page:/products/:id">p1</main>');
  });

  it('normalizes trailing slashes before dispatching routes', async () => {
    const handler = createRequestHandler(createApp({ routes: [route('/products/:id', {})] }));

    const response = await handler(new Request('https://example.test/products/p1/?tab=details'));

    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/products/p1?tab=details');
    await expect(response.text()).resolves.toBe('');
  });

  it('returns stable 404 and page-method responses', async () => {
    const handler = createRequestHandler(createApp({ routes: [route('/products/:id', {})] }));

    const missing = await handler(new Request('https://example.test/missing'));
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toContain('<h1>Not Found</h1>');

    const method = await handler(
      new Request('https://example.test/products/p1', { method: 'POST' }),
    );
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET, HEAD');
    await expect(method.text()).resolves.toBe('Method Not Allowed');
  });

  it('blocks ambiguous route tables with KV228 before declaration-order dispatch', async () => {
    const app = createApp({
      routes: [
        route('/products/:id', { page: () => trustedHtml('<main>Param</main>') }),
        route('/products/new', { page: () => trustedHtml('<main>New</main>') }),
      ],
    });

    expect(app.diagnostics).toEqual([
      {
        code: 'KV228',
        fileName: '/products/:id <-> /products/new',
        help: expect.stringContaining('SPEC §9.5'),
        message:
          "Ambiguous route table: '/products/:id' and '/products/new' can both match canonical request path '/products/new'.",
      },
    ]);

    const response = await createRequestHandler(app)(
      new Request('https://example.test/products/new'),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('<p class="kovo-diagnostic-code">KV228</p>');
    expect(body).toContain('/products/:id &lt;-&gt; /products/new');
    expect(body).not.toContain('<main>New</main>');
  });

  it('keeps blocking route diagnostics when late Array iteration is poisoned', async () => {
    const originalIterator = Array.prototype[Symbol.iterator];
    let app: ReturnType<typeof createApp> | undefined;
    Array.prototype[Symbol.iterator] = function () {
      const first = Object.getOwnPropertyDescriptor(this, 0);
      if (first !== undefined && 'value' in first && first.value?.code === 'KV228') {
        return originalIterator.call([]);
      }
      return originalIterator.call(this);
    };
    try {
      app = createApp({
        routes: [
          route('/diagnostic/:id', { page: () => trustedHtml('<main>Param</main>') }),
          route('/diagnostic/fixed', { page: () => trustedHtml('<main>Fixed</main>') }),
        ],
      });
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    expect(app?.diagnostics[0]?.code).toBe('KV228');
    const response = await createRequestHandler(app!)(
      new Request('https://example.test/diagnostic/fixed'),
    );
    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('KV228');
  });

  it('pins blocking diagnostics against entry mutation and late collection replacement', async () => {
    const app = createApp({
      routes: [
        route('/admin/:section', { page: () => trustedHtml('<main>Public parameter</main>') }),
        route('/admin/settings', {
          guard: guards.authed,
          page: () => trustedHtml('<main>Private settings</main>'),
        }),
      ],
    });
    expect(app.diagnostics[0]?.code).toBe('KV228');
    expect(() => {
      (app.diagnostics[0] as { code: string }).code = 'KV210';
    }).toThrow(TypeError);

    const nativeFilter = Array.prototype.filter;
    Array.prototype.filter = function (callback, thisArg) {
      if (this === app.diagnostics) return [];
      return nativeFilter.call(this, callback, thisArg);
    };
    try {
      const response = await createRequestHandler(app)(
        new Request('https://example.test/admin/settings'),
      );
      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toContain('KV228');
    } finally {
      Array.prototype.filter = nativeFilter;
    }
  });

  it('renders configured error shells through the app request boundary', async () => {
    const handler = createRequestHandler(
      createApp({
        errorShells: {
          forbidden({ status }) {
            return trustedHtml(`<main>${status}:forbidden</main>`);
          },
          notFound({ request, status }) {
            const url = new URL(request.url);
            return {
              body: trustedHtml(`<main>${status}:${url.pathname}</main>`),
              status,
            };
          },
        },
      }),
    );

    const response = await handler(new Request('https://example.test/missing'));
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain('<!doctype html>');
    expect(body).toContain('<main>404:/missing</main>');
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('keeps unverified mutation error-shell requests free of ambient credentials and bodies', async () => {
    const shellViews: Array<{
      authorization: string | null;
      body: ReadableStream<Uint8Array> | null;
      cookie: string | null;
      signature: string | null;
    }> = [];
    const handler = createRequestHandler(
      createApp({
        errorShells: {
          notFound({ request }) {
            shellViews.push({
              authorization: request.headers.get('authorization'),
              body: request.body,
              cookie: request.headers.get('cookie'),
              signature: request.headers.get('x-machine-signature'),
            });
            return {
              body: trustedHtml('<main>missing mutation</main>'),
              headers: {
                'Clear-Site-Data': '"cookies"',
                'Set-Cookie': 'sid=attacker; Path=/',
              } as never,
            };
          },
        },
      }),
    );

    const response = await handler(
      new Request('https://example.test/_m/not/declared', {
        body: new URLSearchParams({ value: 'secret-body' }),
        headers: {
          Authorization: 'Basic victim-browser-credential',
          Cookie: 'sid=victim',
          'X-Machine-Signature': 'kept',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('clear-site-data')).toBeNull();
    expect(shellViews).toEqual([
      { authorization: null, body: null, cookie: null, signature: null },
    ]);
  });

  it('neutralizes csrf-exempt mutation requests before rendering a 500 shell', async () => {
    const shellViews: Array<[string | null, string | null]> = [];
    const dbError = new Error('db failed');
    const handler = createRequestHandler(
      createApp({
        db() {
          throw dbError;
        },
        errorShells: {
          serverError({ request }) {
            shellViews.push([
              request.headers.get('cookie'),
              request.headers.get('x-machine-signature'),
            ]);
            return {
              body: trustedHtml('<main>server error</main>'),
              headers: {
                'Clear-Site-Data': '"cookies"',
                'Set-Cookie': 'sid=attacker; Path=/',
              } as never,
            };
          },
        },
        mutations: [
          mutation('machine/fail', {
            csrf: false,
            csrfJustification: 'test fixture uses a non-browser caller',
            input: s.object({ value: s.string() }),
            handler: (input) => input,
          }),
        ],
      }),
    );

    const response = await handler(
      new Request('https://example.test/_m/machine/fail', {
        body: new URLSearchParams({ value: 'x' }),
        headers: { Cookie: 'sid=victim', 'X-Machine-Signature': 'kept' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('clear-site-data')).toBeNull();
    expect(shellViews).toEqual([[null, null]]);
  });

  it('strips browser-state output from mutation startup error shells', async () => {
    const app = createApp({
      errorShells: {
        serverError() {
          return {
            body: trustedHtml('<main>startup error</main>'),
            headers: {
              'Clear-Site-Data': '"cookies"',
              'Set-Cookie': 'sid=attacker; Path=/',
            } as never,
          };
        },
      },
      mutations: [
        mutation('machine/startup', {
          csrf: false,
          csrfJustification: 'test fixture uses a non-browser caller',
          handler: () => ({ ok: true }),
          input: s.object({}),
        }),
      ],
    });

    const response = await handleAppStartupErrorResponse(
      app,
      new Request('https://example.test/_m/machine/startup', { method: 'POST' }),
      new Error('startup failed'),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('clear-site-data')).toBeNull();
    const body = await response.text();
    expect(body).not.toContain('<main>startup error</main>');
    expect(body).toContain('Server Error');
  });

  it('reports failing error shells and falls back to stable no-internals documents', async () => {
    const shellError = new Error('private shell detail');
    const onError = vi.fn();
    const handler = createRequestHandler(
      createApp({
        errorShells: {
          notFound() {
            throw shellError;
          },
        },
        onError,
      }),
    );
    const request = new Request('https://example.test/missing?from=test');

    const response = await handler(request);

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain('<h1>Not Found</h1>');
    expect(body).not.toContain('private shell detail');
    expect(onError).toHaveBeenCalledWith(shellError, {
      operation: 'error-shell',
      request: expect.any(Request),
      status: 404,
      url: '/missing?from',
    });
  });

  it('keeps the stable error fallback when a shell poisons the public request URL accessor', async () => {
    const shellError = new Error('private poisoned shell detail');
    const onError = vi.fn();
    let getterReads = 0;
    const handler = createRequestHandler(
      createApp({
        errorShells: {
          notFound({ request }) {
            for (const property of [
              'body',
              'clone',
              'constructor',
              'headers',
              'method',
              'referrer',
              'signal',
              'url',
            ]) {
              Object.defineProperty(request, property, {
                configurable: true,
                get() {
                  getterReads += 1;
                  throw new Error(`${property} getter trap`);
                },
              });
            }
            throw shellError;
          },
        },
        onError,
      }),
    );

    const response = await handler(
      new Request('https://example.test/missing?token=POISONED_URL_SECRET'),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain('<h1>Not Found</h1>');
    expect(getterReads).toBe(0);
    expect(onError).toHaveBeenCalledWith(
      shellError,
      expect.objectContaining({ operation: 'error-shell', url: '/missing?token' }),
    );
  });

  it('keeps app request failures private when the configured 500 shell also fails', async () => {
    const endpointError = new Error('private endpoint detail');
    const shellError = new Error('private 500 shell detail');
    const onError = vi.fn();
    const statusEndpoint = endpoint('/status', {
      handler() {
        throw endpointError;
      },
      method: 'GET',
      reason: 'failing status endpoint',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [statusEndpoint],
        errorShells: {
          serverError() {
            throw shellError;
          },
        },
        onError,
      }),
    );
    const request = new Request('https://example.test/status');

    const response = await handler(request);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('Server Error');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(body).not.toContain('private endpoint detail');
    expect(body).not.toContain('private 500 shell detail');
    expect(onError).toHaveBeenCalledWith(
      endpointError,
      expect.objectContaining({
        operation: 'app-request',
        request: expect.any(Request),
        url: '/status',
      }),
    );
    const diagnosticRequest = onError.mock.calls[0]?.[1].request as Request;
    expect(diagnosticRequest).not.toBe(request);
    expect(diagnosticRequest.body).toBeNull();
    expect(onError).not.toHaveBeenCalledWith(shellError, expect.anything());
  });

  // SPEC §9.5: the request shell owns the pre-dispatch body-size gate because
  // there is no user middleware chain. It must reject before endpoint raw-body
  // handlers can read or parse the request.
  it('rejects oversized requests with 413 before endpoint dispatch', async () => {
    const endpointHandler = vi.fn(() => new Response('ok'));
    const handler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/upload', {
            csrf: false,
            csrfJustification: 'test machine endpoint',
            handler: endpointHandler,
            method: 'POST',
            reason: 'oversized upload endpoint gate',
            response: rawTextResponse,
          }),
        ],
        requestLimits: {
          maxBodyBytes: 4,
          queries: {},
          mutations: {},
        },
      }),
    );

    const response = await handler(
      new Request('https://example.test/upload', {
        body: '12345',
        headers: { 'Content-Length': '5' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(response.headers.get('vary')).toBeNull();
    expect(response.headers.get('kovo-build')).toBeNull();
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(endpointHandler).not.toHaveBeenCalled();
  });

  it('pins normalized request-limit authority after app assembly', async () => {
    const endpointHandler = vi.fn(() => new Response('ok'));
    const app = createApp({
      endpoints: [
        endpoint('/pinned-limits', {
          csrf: false,
          csrfJustification: 'test machine endpoint',
          handler: endpointHandler,
          method: 'POST',
          reason: 'request-limit snapshot regression',
          response: rawTextResponse,
        }),
      ],
      requestLimits: {
        global: { max: 1, windowMs: 60_000 },
        maxBodyBytes: 4,
        mutations: {
          global: { max: 2, windowMs: 60_000 },
          perIp: { max: 2, windowMs: 60_000 },
        },
        perIp: { max: 2, windowMs: 60_000 },
        queries: {
          global: { max: 2, windowMs: 60_000 },
          perIp: { max: 2, windowMs: 60_000 },
        },
      },
    });

    expect(() => {
      (app.requestLimits as { maxBodyBytes: number | false }).maxBodyBytes = false;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits as { global: unknown }).global = false;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits.global as { max: number }).max = 100;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits.perIp as { max: number }).max = 100;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits.mutations as { global: unknown }).global = false;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits.mutations.global as { max: number }).max = 100;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits.mutations.perIp as { max: number }).max = 100;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits.queries as { perIp: unknown }).perIp = false;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits.queries.global as { max: number }).max = 100;
    }).toThrow(TypeError);
    expect(() => {
      (app.requestLimits.queries.perIp as { max: number }).max = 100;
    }).toThrow(TypeError);

    const oversized = await createRequestHandler(app)(
      new Request('https://example.test/pinned-limits', {
        body: '12345',
        headers: { 'Content-Length': '5' },
        method: 'POST',
      }),
    );
    expect(oversized.status).toBe(413);
    expect(endpointHandler).not.toHaveBeenCalled();

    const first = await createRequestHandler(app)(new Request('https://example.test/missing'));
    const second = await createRequestHandler(app)(new Request('https://example.test/missing'));
    expect(first.status).toBe(404);
    expect(second.status).toBe(429);
  });

  it.each([
    ['the whole posture', false, 'requestLimits }) cannot be false'],
    [
      'the body budget',
      { maxBodyBytes: false },
      'requestLimits.maxBodyBytes }) must be an integer',
    ],
    ['the base global rate', { global: false }, 'requestLimits.global }) cannot be false'],
    ['the base per-IP rate', { perIp: false }, 'requestLimits.perIp }) cannot be false'],
    ['the mutation posture', { mutations: false }, 'requestLimits.mutations }) must be'],
    [
      'the mutation global rate',
      { mutations: { global: false } },
      'requestLimits.mutations.global }) cannot be false',
    ],
    [
      'the mutation per-IP rate',
      { mutations: { perIp: false } },
      'requestLimits.mutations.perIp }) cannot be false',
    ],
    ['the query posture', { queries: false }, 'requestLimits.queries }) must be'],
    [
      'the query global rate',
      { queries: { global: false } },
      'requestLimits.queries.global }) cannot be false',
    ],
    [
      'the query per-IP rate',
      { queries: { perIp: false } },
      'requestLimits.queries.perIp }) cannot be false',
    ],
  ] as const)('rejects false for %s', (_label, requestLimits, message) => {
    expect(() => createApp({ requestLimits: requestLimits as never })).toThrow(message);
  });

  it('makes every request-limit false posture unrepresentable in the public types', () => {
    if (false) {
      // @ts-expect-error SPEC §9.5: the complete pre-dispatch posture is mandatory.
      createApp({ requestLimits: false });
      // @ts-expect-error SPEC §9.5: the coarse body budget cannot be disabled.
      createApp({ requestLimits: { maxBodyBytes: false } });
      // @ts-expect-error SPEC §9.5: base rates are mandatory finite budgets.
      createApp({ requestLimits: { global: false } });
      // @ts-expect-error SPEC §9.5: per-surface rates are mandatory finite budgets.
      createApp({ requestLimits: { mutations: { perIp: false } } });
      // @ts-expect-error SPEC §9.5: per-surface rate postures are objects, not opt-outs.
      createApp({ requestLimits: { queries: false } });
    }
    expect(true).toBe(true);
  });

  it.each([
    [
      'body bytes',
      { maxBodyBytes: 67_108_865 },
      'requestLimits.maxBodyBytes }) must be an integer between 0 and 67108864',
    ],
    [
      'query/list items',
      { maxQueryListItems: 100_001 },
      'requestLimits.maxQueryListItems }) must be an integer between 1 and 100000',
    ],
    [
      'requests per window',
      { global: { max: 1_000_001 } },
      'requestLimits.*.max }) must be an integer between 1 and 1000000',
    ],
    [
      'retained rate keys',
      { global: { max: 1, maxKeys: 100_001 } },
      'requestLimits.*.maxKeys }) must be an integer between 1 and 100000',
    ],
    [
      'rate window duration',
      { global: { max: 1, windowMs: 86_400_001 } },
      'requestLimits.*.windowMs }) must be an integer between 1 and 86400000',
    ],
  ] as const)('rejects an unbounded %s maximum', (_label, requestLimits, message) => {
    expect(() => createApp({ requestLimits })).toThrow(message);
  });

  it('accepts the exact finite request-limit maxima', () => {
    const app = createApp({
      requestLimits: {
        global: { max: 1_000_000, maxKeys: 100_000, windowMs: 86_400_000 },
        maxBodyBytes: 67_108_864,
        maxQueryListItems: 100_000,
      },
    });

    expect(app.requestLimits).toMatchObject({
      global: { max: 1_000_000, maxKeys: 100_000, windowMs: 86_400_000 },
      maxBodyBytes: 67_108_864,
      maxQueryListItems: 100_000,
    });
  });

  it('rejects accessor-backed request-limit authority instead of cross-binding reads', () => {
    let maxBodyReads = 0;
    const requestLimits = {
      get maxBodyBytes() {
        maxBodyReads += 1;
        return maxBodyReads === 1 ? 4 : (false as const);
      },
    };

    expect(() => createApp({ requestLimits })).toThrow(
      'createApp({ requestLimits.maxBodyBytes }) must be a stable own data property.',
    );
    expect(maxBodyReads).toBe(0);

    const nested = {
      mutations: {
        get global() {
          return false as const;
        },
      },
    };
    expect(() => createApp({ requestLimits: nested })).toThrow(
      'createApp({ requestLimits.mutations.global }) must be a stable own data property.',
    );
  });

  it.each([
    ['route', '/limited-route', 'GET'],
    ['query', '/_q/limited-query', 'GET'],
    ['mutation', '/_m/limited-mutation', 'POST'],
    ['endpoint', '/limited-endpoint', 'GET'],
    ['not-found', '/limited-missing', 'GET'],
  ] as const)(
    'rejects an over-breadth URL with 414 before %s dispatch',
    async (_surface, pathname, method) => {
      const routeRender = vi.fn(() => renderedHtml('<main>route</main>'));
      const queryLoad = vi.fn(() => ({ ok: true }));
      const mutationHandler = vi.fn(() => ({ ok: true }));
      const endpointHandler = vi.fn(() => new Response('endpoint'));
      const app = createApp({
        endpoints: [
          endpoint('/limited-endpoint', {
            handler: endpointHandler,
            method: 'GET',
            reason: 'request-target resource preflight regression',
            response: rawTextResponse,
          }),
        ],
        mutations: [
          mutation('limited-mutation', {
            csrf: false,
            csrfJustification: 'test fixture uses a non-browser caller',
            handler: mutationHandler,
            input: s.object({}),
          }),
        ],
        queries: [query('limited-query', { load: queryLoad, reads: [] })],
        routes: [route('/limited-route', { page: routeRender })],
      });
      const queryString = `${'a&'.repeat(MAX_REQUEST_QUERY_ENTRIES)}a`;

      const response = await createRequestHandler(app)(
        new Request(`https://example.test${pathname}?${queryString}`, { method }),
      );

      expect(response.status).toBe(414);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      await expect(response.text()).resolves.toBe('URI Too Long');
      expect(routeRender).not.toHaveBeenCalled();
      expect(queryLoad).not.toHaveBeenCalled();
      expect(mutationHandler).not.toHaveBeenCalled();
      expect(endpointHandler).not.toHaveBeenCalled();
    },
  );

  it('enforces the default request body cap before endpoint dispatch', async () => {
    const endpointHandler = vi.fn(() => new Response('ok'));
    const handler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/default-upload-cap', {
            csrf: false,
            csrfJustification: 'test machine endpoint',
            handler: endpointHandler,
            method: 'POST',
            reason: 'default request body cap',
            response: rawTextResponse,
          }),
        ],
      }),
    );

    const response = await handler(
      new Request('https://example.test/default-upload-cap', {
        body: '',
        headers: { 'Content-Length': String(1_048_577) },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(endpointHandler).not.toHaveBeenCalled();
  });

  // SPEC §9.1.1/§9.4: framework-owned pre-dispatch system responses for
  // reserved mutation/query endpoints carry the same private cache posture and
  // build-token skew signal as dispatched mutation/query responses.
  it.each([
    ['mutation', 'https://example.test/_m/cart/oversized', 'POST'],
    ['query', 'https://example.test/_q/cart-oversized', 'POST'],
  ] as const)('stamps reserved %s 413 responses before dispatch', async (_surface, url, method) => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const queryLoad = vi.fn(() => ({ count: 1 }));
    const app = createApp({
      mutations: [
        mutation('cart/oversized', {
          csrf: false,
          csrfJustification: 'test fixture uses a non-browser caller',
          handler: mutationHandler,
          input: s.object({}),
        }),
      ],
      queries: [
        query('cart-oversized', {
          load: queryLoad,
          reads: [],
        }),
      ],
      requestLimits: {
        maxBodyBytes: 4,
        mutations: {},
        queries: {},
      },
    });
    const handler = createRequestHandler(app);

    const response = await handler(
      new Request(url, {
        body: '12345',
        headers: { 'Content-Length': '5' },
        method,
      }),
    );

    expect(response.status).toBe(413);
    expectReservedSystemResponsePosture(response, app.clientModules.buildToken());
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(mutationHandler).not.toHaveBeenCalled();
    expect(queryLoad).not.toHaveBeenCalled();
  });

  it('lets s.file().maxBytes raise the effective mutation body cap and return typed 422', async () => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const upload = mutation('upload/avatar', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      handler: mutationHandler,
      input: s.object({
        avatar: s.file().maxBytes(8),
      }),
    });
    const handler = createRequestHandler(
      createApp({
        mutations: [upload],
        requestLimits: {
          maxBodyBytes: 1,
          mutations: {},
          queries: {},
        },
      }),
    );
    const request = (body: string) => {
      const form = new FormData();
      form.set('avatar', new File([body], 'avatar.txt', { type: 'text/plain' }));
      return new Request('https://example.test/_m/upload/avatar', {
        body: form,
        method: 'POST',
      });
    };

    const accepted = await handler(request('12345'));
    expect(accepted.status).toBe(303);
    expect(mutationHandler).toHaveBeenCalledTimes(1);

    const rejected = await handler(request('123456789'));

    expect(rejected.status).toBe(422);
    await expect(rejected.text()).resolves.toContain('Expected file &lt;= 8 bytes');
    expect(mutationHandler).toHaveBeenCalledTimes(1);
  });

  it('keeps the file-aware mutation body cap finite after Math.max poisoning', async () => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const handler = createRequestHandler(
      createApp({
        mutations: [
          mutation('upload/poisoned-cap', {
            csrf: false,
            csrfJustification: 'test fixture uses a non-browser caller',
            handler: mutationHandler,
            input: s.object({ avatar: s.file().maxBytes(8) }),
          }),
        ],
        requestLimits: {
          maxBodyBytes: 1,
          mutations: {},
          queries: {},
        },
      }),
    );
    let pulls = 0;
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellations += 1;
      },
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array(1_048_585));
        else controller.close();
      },
    });
    const originalMax = Math.max;
    Math.max = () => 1 / 0;
    try {
      const response = await handler(
        new Request('https://example.test/_m/upload/poisoned-cap', {
          body,
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          duplex: 'half',
        } as RequestInit),
      );
      expect(response.status).toBe(413);
      expect(cancellations).toBe(1);
      expect(mutationHandler).not.toHaveBeenCalled();
    } finally {
      Math.max = originalMax;
    }
  });

  it('rejects oversized streamed endpoint bodies before dispatch', async () => {
    let sideEffects = 0;
    const endpointHandler = vi.fn(async (request: Request) => {
      sideEffects += 1;
      return new Response(await request.text());
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/stream-upload', {
            csrf: false,
            csrfJustification: 'test machine endpoint',
            handler: endpointHandler,
            method: 'POST',
            reason: 'streamed upload body cap',
            response: rawTextResponse,
          }),
        ],
        requestLimits: {
          maxBodyBytes: 4,
          mutations: {},
          queries: {},
        },
      }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12'));
        controller.enqueue(new TextEncoder().encode('345'));
        controller.close();
      },
    });

    const response = await handler(
      new Request('https://example.test/stream-upload', {
        body,
        method: 'POST',
        // Node/fetch requires duplex when a ReadableStream body is supplied.
        duplex: 'half',
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(endpointHandler).not.toHaveBeenCalled();
    expect(sideEffects).toBe(0);
  });

  it('does not wait for a hostile stream cancellation promise after body overflow', async () => {
    let cancelCalls = 0;
    const endpointHandler = vi.fn(() => new Response('unreachable'));
    const handler = createRequestHandler(
      createApp({
        endpoints: [
          endpoint('/cancel-trap', {
            csrf: false,
            csrfJustification: 'test machine endpoint',
            handler: endpointHandler,
            method: 'POST',
            reason: 'hostile cancellation fixture',
            response: rawTextResponse,
          }),
        ],
        requestLimits: {
          maxBodyBytes: 4,
          mutations: {},
          queries: {},
        },
      }),
    );
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCalls += 1;
        return new Promise<void>(() => undefined);
      },
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
      },
    });

    const response = await handler(
      new Request('https://example.test/cancel-trap', {
        body,
        method: 'POST',
        duplex: 'half',
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    expect(cancelCalls).toBe(1);
    expect(endpointHandler).not.toHaveBeenCalled();
  });

  it('rejects oversized streamed mutation bodies before lifecycle providers or dispatch', async () => {
    const db = vi.fn(() => ({}));
    const mutationHandler = vi.fn((input) => input);
    const handler = createRequestHandler(
      createApp({
        db,
        mutations: [
          mutation('machine/stream-write', {
            csrf: false,
            csrfJustification: 'test fixture uses a non-browser caller',
            input: s.object({ value: s.string() }),
            handler: mutationHandler,
          }),
        ],
        requestLimits: {
          maxBodyBytes: 4,
          mutations: {},
          queries: {},
        },
      }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":'));
        controller.enqueue(new TextEncoder().encode('"oversized"}'));
        controller.close();
      },
    });

    const response = await handler(
      new Request('https://example.test/_m/machine/stream-write', {
        body,
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        duplex: 'half',
      } as RequestInit),
    );

    expect(response.status).toBe(413);
    await expect(response.text()).resolves.toBe('Payload Too Large');
    expect(db).not.toHaveBeenCalled();
    expect(mutationHandler).not.toHaveBeenCalled();
  });

  it('drops arbitrary request authority extensions after endpoint body-limit preflight', async () => {
    const upload = endpoint('/extension-upload', {
      csrf: false,
      csrfJustification: 'test endpoint uses a non-browser caller',
      handler(request) {
        const typed = request as Request & { db?: string; session?: { userId: string } };
        return Response.json({
          db: typed.db ?? null,
          hasDb: 'db' in typed,
          hasSession: 'session' in typed,
          session: typed.session ?? null,
        });
      },
      method: 'POST',
      reason: 'request extension preservation test',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(createApp({ endpoints: [upload] }));
    const request = new Request('https://example.test/extension-upload', {
      body: 'ok',
      method: 'POST',
    });
    Object.defineProperty(request, 'db', {
      configurable: true,
      value: 'fixture-db',
    });
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { userId: 'victim' },
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      db: null,
      hasDb: false,
      hasSession: false,
      session: null,
    });
  });

  // SPEC §9.5 / §10.3: coarse per-IP mutation limiting runs before replay, parse,
  // and guards, so the second request cannot execute the mutation handler.
  it('rate-limits mutation requests before parsing or running the handler', async () => {
    const mutationHandler = vi.fn(() => ({ ok: true }));
    const addToCart = mutation('cart/add-rate-limited', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ quantity: s.number().default(1) }),
      handler: mutationHandler,
    });
    const app = createApp({
      mutations: [addToCart],
      requestLimits: {
        clientIp: (request) => request.headers.get('x-kovo-client-ip') ?? undefined,
        queries: {},
        mutations: { perIp: { max: 1, windowMs: 60_000 } },
      },
    });
    const handler = createRequestHandler(app);
    const request = () =>
      new Request('https://example.test/_m/cart/add-rate-limited', {
        body: new URLSearchParams({ quantity: '2' }),
        headers: { 'X-Kovo-Client-Ip': '203.0.113.9' },
        method: 'POST',
      });

    expect((await handler(request())).status).toBe(303);

    const limited = await handler(request());

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expectReservedSystemResponsePosture(limited, app.clientModules.buildToken());
    expect(limited.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(limited.text()).resolves.toBe('Too Many Requests');
    expect(mutationHandler).toHaveBeenCalledTimes(1);
  });

  it('maps throwing pre-dispatch client-IP policy to stable surface-specific 500 responses', async () => {
    const onError = vi.fn();
    const app = createApp({
      endpoints: [
        endpoint('/machine', {
          csrf: false,
          csrfJustification: 'signed machine fixture',
          handler: () => Response.json({ ok: true }),
          method: 'POST',
          reason: 'predispatch failure fixture',
          response: rawJsonResponse,
        }),
      ],
      errorShells: {
        serverError: () => trustedHtml('<main>stable shell</main>'),
      },
      mutations: [
        mutation('machine/run', {
          csrf: false,
          csrfJustification: 'test fixture uses a non-browser caller',
          handler: () => ({ ok: true }),
          input: s.object({}),
        }),
      ],
      onError,
      queries: [query('catalog', { load: () => [], reads: [] })],
      requestLimits: {
        clientIp() {
          throw new Error('clientIp trap');
        },
      },
      routes: [route('/', { page: () => trustedHtml('<main>home</main>') })],
    });
    const handler = createRequestHandler(app);

    const queryResponse = await handler(new Request('https://example.test/_q/catalog'));
    expect(queryResponse.status).toBe(500);
    expect(queryResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(queryResponse.headers.get('content-type')).toBe('application/json; charset=utf-8');
    await expect(queryResponse.json()).resolves.toEqual({ code: 'SERVER_ERROR', payload: {} });

    const endpointResponse = await handler(
      new Request('https://example.test/machine', { method: 'POST' }),
    );
    expect(endpointResponse.status).toBe(500);
    expect(endpointResponse.headers.get('content-type')).toBe('application/json');
    await expect(endpointResponse.json()).resolves.toEqual({ code: 'SERVER_ERROR', payload: {} });

    const mutationResponse = await handler(
      new Request('https://example.test/_m/machine/run', {
        body: new URLSearchParams(),
        method: 'POST',
      }),
    );
    expect(mutationResponse.status).toBe(500);
    await expect(mutationResponse.text()).resolves.toContain('<main>stable shell</main>');

    const routeResponse = await handler(new Request('https://example.test/'));
    expect(routeResponse.status).toBe(500);
    await expect(routeResponse.text()).resolves.toContain('<main>stable shell</main>');
    expect(onError).toHaveBeenCalledTimes(4);
  });

  it('does not let poisoned URI decoding redirect a query to another registry key', async () => {
    const nativeDecodeURIComponent = globalThis.decodeURIComponent;
    const app = createApp({
      queries: [
        query('public', { load: () => ({ value: 'public' }), reads: [] }),
        query('private', {
          load(_input, context?: { request: Request & { session?: { secret: string } } }) {
            return { value: context?.request.session?.secret };
          },
          reads: [],
        }),
      ],
      sessionProvider: () => ({ secret: 'PRIVATE_QUERY_VALUE' }),
    });
    const handler = createRequestHandler(app);

    let response: Response | undefined;
    globalThis.decodeURIComponent = (value) =>
      value === 'public' ? 'private' : nativeDecodeURIComponent(value);
    try {
      response = await handler(new Request('https://example.test/_q/public'));
    } finally {
      globalThis.decodeURIComponent = nativeDecodeURIComponent;
    }

    expect(response?.status).toBe(200);
    const body = await response?.text();
    expect(body).toContain('{"value":"public"}');
    expect(body).not.toContain('PRIVATE_QUERY_VALUE');
  });

  it('preserves credentials across the app shell only for a pinned protocol adapter', async () => {
    let received:
      | { authorization: string | null; cookie: string | null; session: boolean }
      | undefined;
    const authAdapter = frameworkEndpoint(
      '/auth',
      {
        auth: { kind: 'custom', name: 'framework-auth-adapter' },
        csrf: false,
        csrfJustification: 'adapter verifies OAuth state and session credentials internally',
        handler(request) {
          received = {
            authorization: request.headers.get('authorization'),
            cookie: request.headers.get('cookie'),
            session: 'session' in request,
          };
          return new Response('delegated', {
            headers: {
              'Cache-Control': 'no-store',
              'Set-Cookie': 'sid=rotated; Path=/; Secure; HttpOnly; SameSite=Lax',
            },
          });
        },
        method: 'GET',
        mount: 'prefix',
        mountJustification: 'adapter owns callback routes',
        reason: 'framework self-verifying auth adapter',
        response: {
          appOwnedSafety: true,
          body: 'text',
          cache: 'no-store',
          reservedHeaders: ['Set-Cookie'],
        },
      },
      (declaration) => {
        pinEndpointBrowserCredentialDelegation(declaration);
      },
    );
    const handler = createRequestHandler(createApp({ endpoints: [authAdapter] }));
    const request = new Request('https://example.test/auth/callback/provider', {
      headers: {
        Authorization: 'Bearer callback-token',
        Cookie: 'oauth_state=secret; sid=old',
      },
    });
    Object.defineProperty(request, 'session', {
      configurable: true,
      value: { id: 'ambient-kovo-session' },
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(received).toEqual({
      authorization: 'Bearer callback-token',
      cookie: 'oauth_state=secret; sid=old',
      session: false,
    });
    expect(response.headers.get('set-cookie')).toContain('sid=rotated');
  });

  it('rejects percent-encoded mutation aliases before policy callbacks or dispatch', async () => {
    const clientIp = vi.fn(() => '203.0.113.7');
    const protectedHandler = vi.fn(() => ({ protected: true }));
    const exemptHandler = vi.fn(() => ({ exempt: true }));
    const handler = createRequestHandler(
      createApp({
        mutations: [
          mutation('a', {
            csrf: false,
            csrfJustification: 'test fixture uses a non-browser caller',
            handler: exemptHandler,
            input: s.object({}),
          }),
          mutation('%61', {
            handler: protectedHandler,
            input: s.object({}),
          }),
        ],
        requestLimits: { clientIp },
      }),
    );

    const response = await handler(
      new Request('https://example.test/_m/%61', {
        body: new URLSearchParams(),
        headers: { Cookie: 'sid=victim' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(404);
    expect(clientIp).not.toHaveBeenCalled();
    expect(protectedHandler).not.toHaveBeenCalled();
    expect(exemptHandler).not.toHaveBeenCalled();
  });

  it('ignores spoofed forwarded IP headers unless trustedProxy is enabled', async () => {
    const makeHandler = (trustedProxy = false) =>
      createRequestHandler(
        createApp({
          mutations: [
            mutation(`cart/proxy-${trustedProxy ? 'trusted' : 'untrusted'}`, {
              csrf: false,
              csrfJustification: 'test fixture uses a non-browser caller',
              handler: () => ({ ok: true }),
              input: s.object({}),
            }),
          ],
          requestLimits: {
            mutations: { perIp: { max: 1, windowMs: 60_000 } },
            queries: {},
            trustedProxy,
          },
        }),
      );
    const request = (key: string, forwardedFor: string) =>
      new Request(`https://example.test/_m/${key}`, {
        body: new URLSearchParams(),
        headers: { 'X-Forwarded-For': forwardedFor },
        method: 'POST',
      });

    const untrusted = makeHandler(false);
    expect((await untrusted(request('cart/proxy-untrusted', '203.0.113.1'))).status).toBe(303);
    expect((await untrusted(request('cart/proxy-untrusted', '203.0.113.2'))).status).toBe(303);

    const trusted = makeHandler(true);
    expect((await trusted(request('cart/proxy-trusted', '203.0.113.1'))).status).toBe(303);
    expect((await trusted(request('cart/proxy-trusted', '203.0.113.2'))).status).toBe(303);
  });

  it('disables per-ip pre-dispatch limiting when no trustworthy client key is available', async () => {
    const addToCart = mutation('cart/no-client-ip-key', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      handler: () => ({ ok: true }),
      input: s.object({}),
    });
    const app = createApp({
      mutations: [addToCart],
      requestLimits: {
        mutations: { perIp: { max: 1, windowMs: 60_000 } },
        queries: {},
      },
    });
    const handler = createRequestHandler(app);
    const request = () =>
      new Request('https://example.test/_m/cart/no-client-ip-key', {
        body: new URLSearchParams(),
        method: 'POST',
      });

    expect((await handler(request())).status).toBe(303);
    expect((await handler(request())).status).toBe(303);
    expect(appRateLimitKeyCounts(app).perIp).toBe(0);
  });

  it('uses the rightmost forwarded IP behind a trusted proxy', async () => {
    const addToCart = mutation('cart/rightmost-forwarded-ip', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      handler: () => ({ ok: true }),
      input: s.object({}),
    });
    const app = createApp({
      mutations: [addToCart],
      requestLimits: {
        mutations: { perIp: { max: 1, windowMs: 60_000 } },
        queries: {},
        trustedProxy: true,
      },
    });
    const handler = createRequestHandler(app);
    const request = (forwardedFor: string) =>
      new Request('https://example.test/_m/cart/rightmost-forwarded-ip', {
        body: new URLSearchParams(),
        headers: { 'X-Forwarded-For': forwardedFor },
        method: 'POST',
      });

    expect((await handler(request('198.51.100.10, 203.0.113.99'))).status).toBe(303);
    expect((await handler(request('198.51.100.11, 203.0.113.99'))).status).toBe(429);
    expect((await handler(request('198.51.100.12, 203.0.113.100'))).status).toBe(303);
  });

  it('fails closed under app request-limit key churn without evicting active windows', async () => {
    const addToCart = mutation('cart/bounded-rate-keys', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({}),
      handler: () => ({ ok: true }),
    });
    const app = createApp({
      mutations: [addToCart],
      requestLimits: {
        mutations: { perIp: { max: 1, maxKeys: 8, windowMs: 60_000 } },
        perIp: { max: 1_000, maxKeys: 8, windowMs: 60_000 },
        queries: {},
        trustedProxy: true,
      },
    });
    const handler = createRequestHandler(app);
    const request = (index: number) =>
      new Request('https://example.test/_m/cart/bounded-rate-keys', {
        body: new URLSearchParams(),
        headers: { 'X-Forwarded-For': `203.0.${Math.floor(index / 255)}.${index % 255}` },
        method: 'POST',
      });
    const expectActiveWindowRetryAfter = (response: Response) => {
      const retryAfter = Number(response.headers.get('retry-after'));
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    };

    for (let index = 0; index < 8; index += 1) {
      expect((await handler(request(index))).status).toBe(303);
      expect(appRateLimitKeyCounts(app).perIp).toBe((index + 1) * 2);
    }

    for (let index = 8; index < 2_048; index += 1) {
      const saturated = await handler(request(index));
      expect(saturated.status).toBe(429);
      expectActiveWindowRetryAfter(saturated);
      expect(appRateLimitKeyCounts(app).perIp).toBe(16);
    }

    const activeOldest = await handler(request(0));
    expect(activeOldest.status).toBe(429);
    expectActiveWindowRetryAfter(activeOldest);
    expect(appRateLimitKeyCounts(app).perIp).toBe(16);
  });

  it("does not let one rate-limit check evict another check's window", async () => {
    const cartQuery = query('cart-rate-window-isolated', {
      load: () => ({ count: 1 }),
      reads: [],
    });
    const app = createApp({
      queries: [cartQuery],
      requestLimits: {
        mutations: {},
        perIp: { max: 1_000, windowMs: 5 },
        queries: { perIp: { max: 2, windowMs: 60_000 } },
        trustedProxy: true,
      },
    });
    const handler = createRequestHandler(app);
    const request = () =>
      new Request('https://example.test/_q/cart-rate-window-isolated', {
        headers: { 'X-Forwarded-For': '203.0.113.77' },
      });

    expect((await handler(request())).status).toBe(200);
    expect((await handler(request())).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const limited = await handler(request());

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  // SPEC §9.5 / §9.4: typed reads also pass through the shell's anonymous-flood
  // limiter before args parsing or query loading.
  it('rate-limits query requests before loading the query', async () => {
    const queryLoad = vi.fn(() => ({ count: 1 }));
    const cartQuery = query('cart-rate-limited', {
      load: queryLoad,
      reads: [],
    });
    const app = createApp({
      queries: [cartQuery],
      requestLimits: {
        mutations: {},
        queries: { global: { max: 1, windowMs: 60_000 } },
      },
    });
    const handler = createRequestHandler(app);

    expect((await handler(new Request('https://example.test/_q/cart-rate-limited'))).status).toBe(
      200,
    );

    const limited = await handler(new Request('https://example.test/_q/cart-rate-limited'));

    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expectReservedSystemResponsePosture(limited, app.clientModules.buildToken());
    expect(limited.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(limited.text()).resolves.toBe('Too Many Requests');
    expect(queryLoad).toHaveBeenCalledTimes(1);
  });

  it("threads trusted client IPs into query and route guards.rateLimit({ per: 'ip' })", async () => {
    const rateLimitedQuery = query('query-guard-per-ip', {
      guard: guards.rateLimit<{ clientIp?: string }>({ max: 1, per: 'ip', windowMs: 60_000 }),
      load: () => ({ ok: true }),
      reads: [],
    });
    const rateLimitedRoute = route('/route-guard-per-ip', {
      guard: guards.rateLimit<{ clientIp?: string }>({ max: 1, per: 'ip', windowMs: 60_000 }),
      page: () => trustedHtml('<main>ok</main>'),
    });
    const app = createApp({
      queries: [rateLimitedQuery],
      requestLimits: {
        mutations: {},
        queries: {},
        trustedProxy: true,
      },
      routes: [rateLimitedRoute],
    });
    const handler = createRequestHandler(app);
    const headers = { 'X-Forwarded-For': '203.0.113.44' };

    expect(
      (await handler(new Request('https://example.test/_q/query-guard-per-ip', { headers })))
        .status,
    ).toBe(200);
    expect(
      (await handler(new Request('https://example.test/_q/query-guard-per-ip', { headers })))
        .status,
    ).toBe(429);

    expect(
      (await handler(new Request('https://example.test/route-guard-per-ip', { headers }))).status,
    ).toBe(200);
    expect(
      (await handler(new Request('https://example.test/route-guard-per-ip', { headers }))).status,
    ).toBe(429);
  });

  it('opts up the query list result ceiling for explicit large reads', async () => {
    const catalogQuery = query('catalog-large-read', {
      load: () => ({ rows: Array.from({ length: 4 }, (_, id) => ({ id })) }),
      reads: [],
    });
    const handler = createRequestHandler(
      createApp({
        queries: [catalogQuery],
        requestLimits: {
          maxQueryListItems: 4,
          mutations: {},
          queries: {},
        },
      }),
    );

    const response = await handler(new Request('https://example.test/_q/catalog-large-read'));

    expect(response.status).toBe(200);
    expect(response.headers.get('kovo-warn')).toBeNull();
    await expect(response.text()).resolves.toContain(
      '"rows":[{"id":0},{"id":1},{"id":2},{"id":3}]',
    );
  });

  it('stamps reserved normalization redirects without changing route redirect caching', async () => {
    const reservedApp = createApp({
      queries: [
        query('cart-normalized', {
          load: () => ({ count: 1 }),
          reads: [],
        }),
      ],
    });
    const reservedHandler = createRequestHandler(reservedApp);

    const reservedRedirect = await reservedHandler(
      new Request('https://example.test//_q/cart-normalized'),
    );

    expect(reservedRedirect.status).toBe(308);
    expect(reservedRedirect.headers.get('location')).toBe('/_q/cart-normalized');
    expectReservedSystemResponsePosture(reservedRedirect, reservedApp.clientModules.buildToken());
    expect(reservedRedirect.headers.get('x-content-type-options')).toBeNull();

    const routeHandler = createRequestHandler(
      createApp({
        routes: [route('/docs', { page: () => trustedHtml('<main>Docs</main>') })],
      }),
    );
    const routeRedirect = await routeHandler(new Request('https://example.test//docs'));

    expect(routeRedirect.status).toBe(308);
    expect(routeRedirect.headers.get('location')).toBe('/docs');
    expect(routeRedirect.headers.get('cache-control')).toBeNull();
    expect(routeRedirect.headers.get('vary')).toBeNull();
    expect(routeRedirect.headers.get('kovo-build')).toBeNull();
  });

  it('dispatches endpoints before routes and strips ambient session from endpoint requests', async () => {
    const clientIpCookies: Array<string | null> = [];
    const statusEndpoint = endpoint('/status', {
      handler(request) {
        expect('session' in request).toBe(false);
        return new Response('endpoint');
      },
      method: 'GET',
      reason: 'endpoint-before-route dispatch test',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(
      createApp({
        endpoints: [statusEndpoint],
        requestLimits: {
          clientIp(request) {
            clientIpCookies.push(request.headers.get('cookie'));
            return '203.0.113.10';
          },
        },
        routes: [route('/status', { page: () => trustedHtml('route') })],
        sessionProvider: () => ({ user: { id: 'u1' } }),
      }),
    );

    const response = await handler(
      new Request('https://example.test/status', { headers: { Cookie: 'sid=victim' } }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('endpoint');
    expect(clientIpCookies.length).toBeGreaterThan(0);
    expect(clientIpCookies.every((cookie) => cookie === null)).toBe(true);
  });

  it('reports endpoint exceptions without leaking internals or rendering the route shell', async () => {
    const thrown = new Error('private endpoint detail');
    const onError = vi.fn();
    const statusEndpoint = endpoint('/status', {
      handler() {
        throw thrown;
      },
      method: 'GET',
      reason: 'failing endpoint error reporting',
      response: rawTextResponse,
    });
    const handler = createRequestHandler(createApp({ endpoints: [statusEndpoint], onError }));
    const request = new Request('https://example.test/status?check=true');

    const response = await handler(request);

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe('Server Error');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(body).not.toContain('private endpoint detail');
    expect(onError).toHaveBeenCalledWith(thrown, {
      operation: 'app-request',
      request: expect.any(Request),
      url: '/status?check',
    });
    expect(onError.mock.calls[0]?.[1].request.url).toBe('https://example.test/status?check');
  });

  it('D1: logs default-config endpoint exceptions to stderr without changing the stable 500', async () => {
    const thrown = new Error('private endpoint detail');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const statusEndpoint = endpoint('/status', {
      handler() {
        throw thrown;
      },
      method: 'GET',
      reason: 'default endpoint error logging',
      response: rawJsonResponse,
    });
    const handler = createRequestHandler(createApp({ endpoints: [statusEndpoint] }));

    try {
      const response = await handler(new Request('https://example.test/status?check=true'));

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ code: 'SERVER_ERROR', payload: {} });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[kovo] app-request failed url=/status?check'),
        'Error: private endpoint detail',
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('reports thrown JSON endpoint exceptions as stable JSON 500 responses', async () => {
    const thrown = new Error('private JSON endpoint detail');
    const onError = vi.fn();
    const statusEndpoint = endpoint('/status.json', {
      handler() {
        throw thrown;
      },
      method: 'GET',
      reason: 'failing JSON endpoint error reporting',
      response: rawJsonResponse,
    });
    const handler = createRequestHandler(createApp({ endpoints: [statusEndpoint], onError }));
    const request = new Request('https://example.test/status.json?check=true');

    const response = await handler(request);

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ code: 'SERVER_ERROR', payload: {} });
    expect(onError).toHaveBeenCalledWith(thrown, {
      operation: 'app-request',
      request: expect.any(Request),
      url: '/status.json?check',
    });
    expect(onError.mock.calls[0]?.[1].request.url).toBe('https://example.test/status.json?check');
  });

  it('resolves session once for a guarded route request', async () => {
    let sessionReads = 0;
    const adminRoute = route('/admin', {
      guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
      page(_context, request) {
        return renderedHtml(`admin:${request.session.user.id}`);
      },
    });
    const handler = createRequestHandler(
      createApp({
        routes: [adminRoute],
        sessionProvider() {
          sessionReads += 1;
          return { user: { id: 'u1' } };
        },
      }),
    );

    const response = await handler(new Request('https://example.test/admin'));

    expect(sessionReads).toBe(1);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('admin:u1');
  });

  it('provisions db and session through createApp for routes, queries, and enhanced refresh', async () => {
    interface AppDb {
      reads: string[];
      select(userId?: string): { count: number };
      state: { count: number; lastWriter: string };
      transaction<Result>(callback: (db: AppDb) => Promise<Result>): Promise<Result>;
      update(table: string): { set(value: { count: number; lastWriter: string }): void };
    }

    type AppRequest = Request & {
      db: AppDb;
      session: { user: { id: string } } | null;
    };

    const state = Object.create(null) as AppDb['state'];
    state.count = 1;
    state.lastWriter = '';
    const db: AppDb = {
      reads: [],
      select(userId?: string) {
        if (userId) this.reads.push(userId);
        return { count: this.state.count };
      },
      state,
      async transaction<Result>(callback: (transactionDb: AppDb) => Promise<Result>) {
        return await callback(this);
      },
      update() {
        return {
          set(value) {
            state.count = value.count;
            state.lastWriter = value.lastWriter;
          },
        };
      },
    };
    const cart = domain('cart');
    // SPEC §6.6/§9.1: a session-authenticated mutation must stay CSRF-checked (KV418 forbids the
    // `csrf: false` + session combination), so the cart mutation is protected by a synchronizer
    // token bound to the app session id.
    const csrf = { secret: 'provision-db-session-secret-key-0123456789', sessionId: () => 's1' };
    const cartQuery = query('cart', {
      load(_input, context?: { request: AppRequest }) {
        return {
          count:
            context?.request.db.select(context.request.session?.user.id ?? 'anonymous').count ?? 0,
        };
      },
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ quantity: s.number().int().min(1).default(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, request: AppRequest) {
        const count = request.db.select().count + input.quantity;
        request.db.update('cart_state').set({
          count,
          lastWriter: request.session?.user.id ?? 'anonymous',
        });
        return { count };
      },
    });
    const cartRenderer = {
      component: 'components/cart/badge',
      mutationKeys: [],
      queries: ['cart'],
      render({ request }: { request: AppRequest }) {
        return `<cart-badge>${request.db.select().count}:${request.session?.user.id}</cart-badge>`;
      },
    };
    const app = withCompilerLiveTargetRenderers([cartRenderer], () =>
      createApp({
        csrf,
        db: () => db,
        endpoints: [
          endpoint('/webhook', {
            csrf: false,
            csrfJustification: 'signed provider test endpoint',
            handler(request) {
              expect('session' in request).toBe(false);
              return new Response(`endpoint-db:${'db' in request}`);
            },
            method: 'POST',
            reason: 'provider webhook db wiring test',
            response: rawTextResponse,
          }),
        ],
        mutations: [addToCart],
        queries: [cartQuery],
        routes: [
          route('/cart', {
            page(_context, request: AppRequest) {
              return renderedHtml(
                `<main>${request.db.select().count}:${request.session?.user.id}</main>`,
              );
            },
          }),
        ],
        sessionProvider: () => ({ user: { id: 'u1' } }),
      }),
    );
    const handler = createRequestHandler(app);

    const routeResponse = await handler(new Request('https://example.test/cart'));
    expect(routeResponse.status).toBe(200);
    await expect(routeResponse.text()).resolves.toContain('<main>1:u1</main>');

    const queryResponse = await handler(new Request('https://example.test/_q/cart'));
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.text()).resolves.toContain(
      '<kovo-query name="cart">{"count":1}</kovo-query>',
    );

    const form = new FormData();
    form.set('quantity', '2');
    form.set('kovo-csrf', csrfToken({}, csrf, { audience: 'cart/add' }));
    const mutationResponse = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: form,
        headers: {
          'Kovo-Current-Url': 'https://example.test/cart',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart', 'components/cart/badge', appLiveTargetAttestationAudience(app), {}, csrf, 'https://example.test/cart', 'u1')}`,
          'Kovo-Targets': 'cart=cart',
          origin: 'https://example.test',
        },
        method: 'POST',
      }),
    );

    expect(mutationResponse.status).toBe(200);
    await expect(mutationResponse.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":3}</kovo-query>',
        '<kovo-fragment target="cart"><cart-badge>3:u1</cart-badge></kovo-fragment>',
      ].join('\n'),
    );
    expect(db.reads).toEqual(['u1', 'u1']);
    expect(db.state.lastWriter).toBe('u1');

    const endpointResponse = await handler(
      new Request('https://example.test/webhook', { method: 'POST' }),
    );
    expect(endpointResponse.status).toBe(200);
    await expect(endpointResponse.text()).resolves.toBe('endpoint-db:false');
    expect(db.state.lastWriter).toBe('u1');
  });

  it('reruns layout query chunks from generated layout live-target stamps', async () => {
    const cart = domain('cart');
    const db = { count: 1 };
    const cartQuery = query('cart', {
      load: () => ({ count: db.count }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({}),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler() {
        db.count += 1;
        return { count: db.count };
      },
    });
    const CartLayout = layout({
      queries: { cart: cartQuery },
      render: ({ cart }, _state, { children }) =>
        trustedHtml(
          `<main><output data-bind="cart.count">${cart.count}</output>${String(children)}</main>`,
        ),
    });
    const handler = createRequestHandler(
      createApp({
        mutations: [addToCart],
        queries: [cartQuery],
        routes: [
          route('/cart', {
            layout: CartLayout,
            page: () => trustedHtml('<section>Cart</section>'),
          }),
        ],
      }),
    );

    const routeResponse = await handler(new Request('https://example.test/cart'));
    const routeHtml = await routeResponse.text();
    const layoutOpening = /<main[^>]*>/.exec(routeHtml)?.[0] ?? '';
    const layoutTarget = /kovo-fragment-target="([^"]+)"/.exec(layoutOpening)?.[1];
    const layoutComponent = /kovo-live-component="([^"]+)"/.exec(layoutOpening)?.[1];
    const layoutToken = /kovo-live-token="([^"]+)"/.exec(layoutOpening)?.[1];
    expect(layoutTarget).toMatch(/^kovo-layout-/);
    expect(layoutComponent).toBe(`kovo-layout-plan/${layoutTarget}`);
    expect(layoutToken).toBeTruthy();
    expect(routeHtml).toContain('kovo-deps="cart"');

    const forgedMutationResponse = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: new FormData(),
        headers: {
          'Kovo-Current-Url': 'https://example.test/cart',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${layoutTarget}#${layoutComponent}@forged:{}`,
          'Kovo-Targets': `${layoutTarget}=cart`,
        },
        method: 'POST',
      }),
    );
    expect(forgedMutationResponse.status).toBe(200);
    await expect(forgedMutationResponse.text()).resolves.toBe('');

    const mutationResponse = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: new FormData(),
        headers: {
          'Kovo-Current-Url': 'https://example.test/cart',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${layoutTarget}#${layoutComponent}@${layoutToken}:{}`,
          'Kovo-Targets': `${layoutTarget}=cart`,
        },
        method: 'POST',
      }),
    );

    expect(mutationResponse.status).toBe(200);
    await expect(mutationResponse.text()).resolves.toBe(
      '<kovo-query name="cart">{"count":3}</kovo-query>',
    );
  });

  it('dispatches stored query and client-module registries through web Responses', async () => {
    const app = createApp({
      queries: [
        query('cart', {
          args: s.object({ id: s.string() }),
          load: (input: { id: string }) => ({ id: input.id, total: 42 }),
          reads: [],
        }),
      ],
    });
    const href = app.clientModules.put({
      path: '/c/cart.client.js',
      source: 'export const ok = true;',
      version: 'v1',
    });
    expect(href).toBe(versionedClientModuleHref('/c/cart.client.js', 'v1'));

    const handler = createRequestHandler(app);

    const queryResponse = await handler(new Request('https://example.test/_q/cart?id=c1'));
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.text()).resolves.toContain(
      '<kovo-query name="cart">{"id":"c1","total":42}</kovo-query>',
    );

    const moduleResponse = await handler(new Request(`https://example.test${href}`));
    expect(moduleResponse.status).toBe(200);
    expect(moduleResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    await expect(moduleResponse.text()).resolves.toBe('export const ok = true;');
  });

  it('dispatches mutation POSTs through the reserved app shell path', async () => {
    const clientIpCookies: Array<string | null> = [];
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1).default(1) }),
      redirectTo: '/cart',
      registry: {
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const cartRenderer = {
      component: 'components/cart/badge',
      mutationKeys: [],
      queries: ['cart'],
      queryDefinitions: [cartQuery],
      render: () => '<cart-badge>1</cart-badge>',
    };
    const app = withCompilerLiveTargetRenderers([cartRenderer], () =>
      createApp({
        mutations: [addToCart],
        requestLimits: {
          clientIp(request) {
            clientIpCookies.push(request.headers.get('cookie'));
            return '203.0.113.11';
          },
        },
        routes: [route('/', { page: () => renderedHtml('<main>Cart</main>') })],
      }),
    );
    const handler = createRequestHandler(app);
    const enhancedForm = new FormData();
    enhancedForm.set('productId', 'p1');
    enhancedForm.set('quantity', '1');

    const enhanced = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: enhancedForm,
        headers: {
          Cookie: 'sid=victim',
          'Kovo-Current-Url': 'https://example.test/',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart', 'components/cart/badge', appLiveTargetAttestationAudience(app), {}, undefined, 'https://example.test/')}`,
          'Kovo-Targets': 'cart=cart',
        },
        method: 'POST',
      }),
    );
    expect(enhanced.status).toBe(200);
    expect(enhanced.headers.get('content-type')).toBe('text/vnd.kovo.fragment+html; charset=utf-8');
    await expect(enhanced.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-fragment target="cart"><cart-badge>1</cart-badge></kovo-fragment>',
      ].join('\n'),
    );

    const noJsForm = new FormData();
    noJsForm.set('productId', 'p1');
    const noJs = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: noJsForm,
        headers: { Cookie: 'sid=victim' },
        method: 'POST',
      }),
    );
    expect(noJs.status).toBe(303);
    expect(noJs.headers.get('location')).toBe('/cart');
    await expect(noJs.text()).resolves.toBe('');
    expect(clientIpCookies.length).toBeGreaterThan(0);
    expect(clientIpCookies.every((cookie) => cookie === null)).toBe(true);
  });

  it('dispatches enhanced mutation fragments through app live target renderers', async () => {
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: 1 }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ productId: s.string() }),
      registry: {
        touches: [cart],
      },
      handler(input) {
        return input;
      },
    });
    const renderCartPanel = vi.fn(({ props }: { props: Record<string, unknown> }) => {
      return `<cart-panel>${String(props.cartId)}</cart-panel>`;
    });
    const cartRenderer = {
      component: 'components/cart/panel',
      mutationKeys: [],
      queries: ['cart'],
      queryDefinitions: [cartQuery],
      render: renderCartPanel,
    };
    const app = withCompilerLiveTargetRenderers([cartRenderer], () =>
      createApp({
        mutations: [addToCart],
        queries: [cartQuery],
        routes: [route('/', { page: () => renderedHtml('<main>Cart</main>') })],
      }),
    );
    const handler = createRequestHandler(app);
    const form = new FormData();
    form.set('productId', 'p1');

    const response = await handler(
      new Request('https://example.test/_m/cart/add', {
        body: form,
        headers: {
          'Kovo-Current-Url': 'https://example.test/',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': `${attestedLiveTargetHeader('cart-panel', 'components/cart/panel', appLiveTargetAttestationAudience(app), { cartId: 'c1' }, undefined, 'https://example.test/')}`,
          'Kovo-Targets': 'cart-panel=cart',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(
      [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-fragment target="cart-panel"><cart-panel>c1</cart-panel></kovo-fragment>',
      ].join('\n'),
    );
    expect(renderCartPanel).toHaveBeenCalledOnce();
  });

  it('normalizes runtime registry facts across query, enhanced mutation, and no-JS failure paths', async () => {
    const cart = domain('runtime-registry-cart');
    let count = 1;
    const cartQuery = query('runtimeRegistryCart', {
      load: () => ({ count }),
      reads: [cart],
    });
    const conflictingCartQuery = query('runtimeRegistryCart', {
      load: () => ({ count: 999 }),
      reads: [cart],
    });

    const conflictingRenderer = {
      component: 'components/runtime-registry/cart-panel-conflict',
      mutationKeys: [],
      queryDefinitions: [conflictingCartQuery],
      queries: ['runtimeRegistryCart'],
      render: () => '<cart-panel>conflict</cart-panel>',
    };
    expect(() =>
      withCompilerLiveTargetRenderers([conflictingRenderer], () =>
        createApp({ queries: [cartQuery] }),
      ),
    ).toThrow(/two queries with the same key "runtimeRegistryCart"/);

    const addToCart = mutation('runtime-registry/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({}),
      handler() {
        count += 1;
        return { count };
      },
    });
    const failCart = mutation('runtime-registry/fail', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      errors: { NOPE: s.object({}) },
      input: s.object({}),
      handler(_input, _request, context) {
        return context.fail('NOPE', {});
      },
    });
    const CartLayout = layout({
      queries: { cart: cartQuery },
      render: ({ cart: cartData }, _state, { children }) =>
        trustedHtml(
          `<main><output data-bind="runtimeRegistryCart.count">${cartData.count}</output>` +
            `${String(children)}</main>`,
        ),
    });
    registerGeneratedMutationTouchRegistry({
      'runtime-registry/add': [{ domain: 'runtime-registry-cart', keys: null }],
    });

    const cartPanelRenderer = {
      component: 'components/runtime-registry/cart-panel',
      mutationKeys: [],
      queryDefinitions: [cartQuery],
      queries: ['runtimeRegistryCart'],
      render: () => `<cart-panel>${count}</cart-panel>`,
    };
    const app = withCompilerLiveTargetRenderers([cartPanelRenderer], () =>
      createApp({
        mutations: [addToCart, failCart],
        routes: [
          route('/cart', {
            layout: CartLayout,
            page: () => trustedHtml('<section>Cart</section>'),
          }),
        ],
      }),
    );
    const handler = createRequestHandler(app);

    const queryResponse = await handler(new Request('https://example.test/_q/runtimeRegistryCart'));
    expect(queryResponse.status).toBe(200);
    await expect(queryResponse.text()).resolves.toContain(
      '<kovo-query name="runtimeRegistryCart">{"count":1}</kovo-query>',
    );

    const enhanced = await handler(
      new Request('https://example.test/_m/runtime-registry/add', {
        body: new FormData(),
        headers: {
          'Kovo-Current-Url': 'https://example.test/cart',
          'Kovo-Fragment': 'true',
          'Kovo-Live-Targets': attestedLiveTargetHeader(
            'cart-panel',
            'components/runtime-registry/cart-panel',
            appLiveTargetAttestationAudience(app),
            {},
            undefined,
            'https://example.test/cart',
          ),
          'Kovo-Targets': 'cart-panel=runtimeRegistryCart',
        },
        method: 'POST',
      }),
    );
    expect(enhanced.status).toBe(200);
    await expect(enhanced.text()).resolves.toBe(
      [
        '<kovo-query name="runtimeRegistryCart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-panel"><cart-panel>2</cart-panel></kovo-fragment>',
      ].join('\n'),
    );

    const noJsFailure = await handler(
      new Request('https://example.test/_m/runtime-registry/fail', {
        body: new FormData(),
        headers: { Referer: 'https://example.test/cart' },
        method: 'POST',
      }),
    );
    expect(noJsFailure.status).toBe(422);
    const failureBody = await noJsFailure.text();
    expect(failureBody).toContain('<output data-bind="runtimeRegistryCart.count">2</output>');
    expect(failureBody).toContain('>Cart</section>');
  });
});
