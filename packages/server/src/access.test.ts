import { createHmac } from 'node:crypto';
import { hmacSignature, type HmacSignatureOptions, type HmacSignatureVerifier } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import {
  accessDecisionFor,
  isExecutableGuardAccessDecision,
  publicAccess,
  verifiedAccess,
  type AccessDecision,
} from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { deriveClosedKovoApp } from './app-snapshot.js';
import { domain } from './domain.js';
import { endpoint, runEndpoint, runEndpointAuth } from './endpoint.js';
import {
  explainGuard,
  guard,
  guardAuditName,
  guards,
  runAccessDecisionGuards,
  runGuardChain,
  type Guard,
} from './guards.js';
import { renderedHtml } from './html.js';
import { mutation, runMutation } from './mutation.js';
import { assignDerivedMutationKey } from './mutation/definition.js';
import { query, renderQueryEndpointResponse } from './query.js';
import { layout, renderRoutePageResponse, route } from './route.js';
import { s } from './schema.js';
import { webhook } from './webhook.js';

const textResponse = {
  appOwnedSafety: true,
  body: 'text',
  cache: 'no-store',
} as const;

const ACCESS_HMAC_SECRET = '202122232425262728292a2b2c2d2e2f';
const OLD_SNAPSHOT_HMAC_SECRET = '303132333435363738393a3b3c3d3e3f';
const NEW_SNAPSHOT_HMAC_SECRET = '404142434445464748494a4b4c4d4e4f';
const OFFICIAL_HMAC_SECRET = '505152535455565758595a5b5c5d5e5f';

function sign(body: string): string {
  return createHmac('sha256', ACCESS_HMAC_SECRET).update(body).digest('hex');
}

describe('structured access metadata', () => {
  it('executes dense guard snapshots without mutable Array classifiers or iterators', async () => {
    // SPEC §6.6 C9/§10.2: the audited guard list and the enforced list are one exact object.
    // Mutable realm intrinsics cannot reinterpret that private list as empty/public after audit.
    const deny = guard('deny-hostile-array-intrinsics', () => ({ kind: 'forbidden' as const }));
    const all = guards.all(deny);
    const nativeIsArray = Array.isArray;
    const nativeIterator = Array.prototype[Symbol.iterator];
    let allResult: ReturnType<typeof all>;
    let chainResult: ReturnType<typeof runGuardChain>;
    let accessResult: ReturnType<typeof runAccessDecisionGuards>;

    try {
      Array.isArray = () => false;
      Array.prototype[Symbol.iterator] = function* () {};
      allResult = all({});
      chainResult = runGuardChain([deny], {});
      accessResult = runAccessDecisionGuards([deny], undefined, {});
    } finally {
      Array.isArray = nativeIsArray;
      Array.prototype[Symbol.iterator] = nativeIterator;
    }

    await expect(allResult).resolves.toMatchObject({ kind: 'forbidden' });
    await expect(chainResult).resolves.toMatchObject({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
    });
    await expect(accessResult).resolves.toMatchObject({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
    });
  });

  it('defines public, verified machine, and executable guard access decisions', () => {
    const publicDecision = publicAccess('marketing page');
    const machineDecision = verifiedAccess;
    const requireAdmin = guard(
      'admin-only',
      guards.role<{ session?: { user?: { roles: readonly string[] } } }>('admin'),
    );
    const guardChain = [requireAdmin] satisfies AccessDecision;

    expect(publicDecision).toEqual({ kind: 'public', reason: 'marketing page' });
    expect(machineDecision).toEqual({ kind: 'verified-machine-auth' });
    expect(guardChain.map((item) => guardAuditName(item))).toEqual(['admin-only']);
    expect(explainGuard(requireAdmin)[0]).toEqual({ kind: 'named', name: 'admin-only' });
  });

  it('rejects blank and control-bearing public audit reasons', () => {
    // SPEC §10.2 requires a human-readable, greppable justification for every public surface.
    for (const reason of [
      ' \t\n',
      'reviewed\nERROR KV436 forged',
      'reviewed\rSUMMARY total=0',
      'reviewed\u001b[2J',
      'reviewed\u007fhidden',
      'reviewed\u2028ENDPOINT forged',
      'reviewed\u2029ENDPOINT forged',
    ]) {
      expect(() => publicAccess(reason)).toThrow(/non-empty audit reason/u);
    }
  });

  it('carries access metadata through route, query, mutation, endpoint, and webhook declarations', () => {
    const access = publicAccess('status surface');
    const statusRoute = route('/status', {
      access,
      page: () => renderedHtml('ok'),
    });
    const statusQuery = query('status', {
      access,
      load: () => ({ ok: true }),
      reads: [domain('status')],
    });
    const statusMutation = mutation('status/touch', {
      access,
      input: s.object({ id: s.string() }),
      handler: (input) => input,
    });
    const statusEndpoint = endpoint('/status.txt', {
      access,
      csrf: false,
      csrfJustification: 'read-only status endpoint',
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'read-only status endpoint',
      response: textResponse,
    });
    const statusWebhook = webhook('/webhooks/status', {
      access: verifiedAccess,
      handler: () => undefined,
      input: s.object({ id: s.string() }),
      verify: 'none',
      verifyJustification: 'test fixture',
    });

    expect(statusRoute.access).toBe(access);
    expect(statusQuery.access).toBe(access);
    expect(statusMutation.access).toBe(access);
    expect(statusEndpoint.access).toBe(access);
    expect(statusWebhook.access).toBe(verifiedAccess);
  });

  it('rejects ambiguous access and guard fields before either can win by precedence', () => {
    const access = publicAccess('dual access regression');
    const deny = guard('deny-dual-access', () => ({ kind: 'forbidden' as const }));
    const dualAccessError = /KV436: .* cannot declare both access and guard/u;

    expect(() => layout({ access, guard: deny } as any)).toThrow(dualAccessError);
    expect(() =>
      route('/dual-access', {
        access,
        guard: deny,
        page: () => renderedHtml('unreachable'),
      } as any),
    ).toThrow(dualAccessError);
    expect(() =>
      query('dual-access', {
        access,
        guard: deny,
        load: () => ({ secret: true }),
      } as any),
    ).toThrow(dualAccessError);
    expect(() =>
      mutation('dual-access', {
        access,
        guard: deny,
        handler: () => ({ secret: true }),
        input: s.object({}),
      } as any),
    ).toThrow(dualAccessError);

    // Descriptor authorship, not truthiness, owns the choice. Neither explicit undefined field
    // may turn a dual declaration into the historical "access wins" state.
    expect(() =>
      route('/undefined-access', {
        access: undefined,
        guard: deny,
        page: () => renderedHtml('unreachable'),
      } as any),
    ).toThrow(dualAccessError);
    expect(() =>
      query('undefined-guard', {
        access,
        guard: undefined,
        load: () => ({ secret: true }),
      } as any),
    ).toThrow(dualAccessError);

    expect(() =>
      endpoint('/unsupported-guard', {
        csrf: false,
        csrfJustification: 'unsupported guard regression',
        guard: deny,
        handler: () => new Response('unreachable'),
        method: 'GET',
        reason: 'unsupported guard regression',
        response: textResponse,
      } as any),
    ).toThrow(/KV436: endpoint\(\) definition does not support guard/u);
    expect(() =>
      webhook('/unsupported-guard', {
        guard: deny,
        handler: () => ({ secret: true }),
        input: s.object({}),
        verify: 'none',
        verifyJustification: 'unsupported guard regression',
      } as any),
    ).toThrow(/KV436: webhook\(\) definition does not support guard/u);
  });

  it('rejects ambiguous structural app declarations while preserving pinned guard-only resnapshots', () => {
    const access = publicAccess('structural dual access regression');
    const deny = guard('deny-structural-dual-access', () => ({ kind: 'forbidden' as const }));
    const dualAccessError = /KV436: .* cannot declare both access and guard/u;
    const structuralApps = [
      {
        queries: [
          {
            access,
            guard: deny,
            key: 'structural-query',
            load: () => ({ secret: true }),
            reads: [],
          },
        ],
      },
      {
        mutations: [
          {
            access,
            guard: deny,
            handler: () => ({ secret: true }),
            input: s.object({}),
            key: 'structural-mutation',
          },
        ],
      },
      {
        routes: [
          {
            access,
            guard: deny,
            page: () => renderedHtml('unreachable'),
            path: '/structural-route',
          },
        ],
      },
      {
        routes: [
          {
            layout: { access, guard: deny },
            page: () => renderedHtml('unreachable'),
            path: '/structural-layout',
          },
        ],
      },
    ];

    for (let index = 0; index < structuralApps.length; index += 1) {
      expect(() => createApp(structuralApps[index] as any)).toThrow(dualAccessError);
    }

    expect(() => createApp({ endpoints: [{ guard: deny }] } as any)).toThrow(
      /KV436: endpoint declaration does not support guard/u,
    );
    const canonicalWebhook = webhook('/structural-webhook-guard', {
      handler: () => ({ secret: true }),
      input: s.object({}),
      verify: 'none',
      verifyJustification: 'structural webhook guard regression',
    });
    expect(() =>
      createApp({
        endpoints: [
          {
            ...canonicalWebhook,
            webhookDefinition: { ...canonicalWebhook.webhookDefinition, guard: deny },
          },
        ],
      } as any),
    ).toThrow(/KV436: webhook definition does not support guard/u);

    const pending = mutation({
      guard: deny,
      handler: () => ({ secret: true }),
      input: s.object({}),
    });
    expect(Object.getOwnPropertyDescriptor(pending, 'access')).toMatchObject({
      enumerable: false,
      value: undefined,
    });
    const derived = assignDerivedMutationKey(pending, 'derived/guard-only');
    expect(derived.guard).toBe(deny);
    expect(accessDecisionFor(derived)).toBeUndefined();
  });

  it('keeps legacy guard call shapes typed while rejecting dual authoring shapes', () => {
    interface OptionalSessionRequest {
      session?: { user?: { id: string } | null } | null;
    }

    const legacyAuthed = guards.authed<OptionalSessionRequest>();
    const legacyMutation = mutation('legacy-guard-inference', {
      guard: legacyAuthed,
      handler(_input, request) {
        const userId: string = request.session.user.id;
        return userId;
      },
      input: s.object({}),
    });
    const legacyRoute = route('/legacy-guard-inference', {
      guard: legacyAuthed,
      page(_context, request) {
        const userId: string = request.session.user.id;
        return renderedHtml(userId);
      },
    });
    const legacyLayout = layout<OptionalSessionRequest>({ guard: legacyAuthed });
    const legacyQuery = query('legacy-guard-inference', {
      guard(request: OptionalSessionRequest) {
        return request.session?.user ? true : { kind: 'unauthenticated' as const };
      },
      load: () => ({ ok: true }),
    });
    expect([
      legacyMutation.guard,
      legacyRoute.guard,
      legacyLayout.guard,
      legacyQuery.guard,
    ]).toEqual([legacyAuthed, legacyAuthed, legacyAuthed, legacyQuery.guard]);

    if (false) {
      const dual = {
        access: publicAccess('type-only dual declaration'),
        guard: legacyAuthed,
      };

      // @ts-expect-error SPEC §10.2: query() accepts exactly one access posture.
      query('type-dual-query', { ...dual, load: () => ({ ok: true }) });
      // @ts-expect-error SPEC §10.2: mutation() accepts exactly one access posture.
      mutation('type-dual-mutation', { ...dual, handler: () => true, input: s.object({}) });
      // @ts-expect-error SPEC §10.2: route() accepts exactly one access posture.
      route('/type-dual-route', { ...dual, page: () => renderedHtml('unreachable') });
      // @ts-expect-error SPEC §10.2: layout() accepts exactly one access posture.
      layout(dual);

      endpoint('/type-endpoint-guard', {
        access: publicAccess('type-only endpoint guard'),
        csrf: false,
        csrfJustification: 'type-only endpoint guard',
        // @ts-expect-error endpoints do not accept the legacy guard field.
        guard: legacyAuthed,
        handler: () => new Response('unreachable'),
        method: 'GET',
        reason: 'type-only endpoint guard',
        response: textResponse,
      });
      webhook('/type-webhook-guard', {
        access: publicAccess('type-only webhook guard'),
        // @ts-expect-error webhooks do not accept the legacy guard field.
        guard: legacyAuthed,
        handler: () => true,
        input: s.object({}),
        verify: 'none',
        verifyJustification: 'type-only webhook guard',
      });
    }
  });

  it('runs access guards for route, query, mutation, and endpoint enforcement', async () => {
    type AppRequest = { session?: { user?: { roles: readonly string[] } | null } | null };
    const access = [guard('admin-only', guards.role<AppRequest>('admin'))];
    const guardedRoute = route('/admin', {
      access,
      page: () => renderedHtml('admin'),
    });
    const guardedLayoutRoute = route('/layout-admin', {
      layout: layout({
        access: [guard('layout-admin-only', () => ({ kind: 'forbidden' as const }))],
      }),
      page: () => renderedHtml('layout admin'),
    });
    const guardedQuery = query('adminStats', {
      access,
      reads: [domain('admin')],
    });
    const guardedMutation = mutation('admin/touch', {
      access,
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      input: s.object({ id: s.string() }),
      handler: () => 'ok',
    });
    const guardedEndpoint = endpoint('/admin/raw', {
      access: [guard('endpoint-admin-only', () => ({ kind: 'forbidden' as const, payload: {} }))],
      csrf: false,
      csrfJustification: 'raw access guard test',
      handler: () => new Response('ok'),
      method: 'GET',
      reason: 'raw access guard test',
      response: textResponse,
    });
    const guardedWebhook = webhook('/admin/hook', {
      access: [guard('webhook-admin-only', () => ({ kind: 'forbidden' as const }))],
      handler: () => ({ ok: true }),
      input: s.object({}),
      verify: 'none',
      verifyJustification: 'raw access guard test',
    });
    const request = { session: { user: { id: 'u1', roles: ['staff'] } } };

    const routeForbidden = await renderRoutePageResponse(guardedRoute, {}, request, String, {
      renderForbidden: () => '<main>Forbidden</main>',
    });
    expect(routeForbidden).toMatchObject({
      body: '<main>Forbidden</main>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
      status: 403,
    });
    const layoutForbidden = await renderRoutePageResponse(guardedLayoutRoute, {}, request, String, {
      renderForbidden: () => '<main>Layout forbidden</main>',
    });
    expect(layoutForbidden.status).toBe(403);
    const queryForbidden = await renderQueryEndpointResponse(guardedQuery, {
      renderForbidden: () => '<main>Query forbidden</main>',
      request,
    });
    expect(queryForbidden).toMatchObject({
      body: '<main>Query forbidden</main>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
      status: 403,
    });
    await expect(runMutation(guardedMutation, { id: '1' }, request)).resolves.toEqual({
      auth: 'unauthorized',
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 403,
    });
    const endpointForbidden = await runEndpoint(
      guardedEndpoint,
      new Request('https://example.test/admin/raw'),
    );
    expect(endpointForbidden.status).toBe(403);
    const webhookForbidden = await runEndpoint(
      guardedWebhook,
      new Request('https://example.test/admin/hook', {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(webhookForbidden.status).toBe(403);
  });

  it('runs webhook access guards through the actual app-shell special dispatch branch', async () => {
    let handlerCalls = 0;
    const guardedWebhook = webhook('/guarded-hook', {
      access: [guard('webhook-shell-deny', () => ({ kind: 'forbidden' as const }))],
      handler: () => {
        handlerCalls += 1;
        return { leaked: true };
      },
      input: s.object({}),
      verify: 'none',
      verifyJustification: 'guarded webhook shell regression',
    });
    const app = createApp({ endpoints: [guardedWebhook] });

    const response = await createRequestHandler(app)(
      new Request('https://example.test/guarded-hook', {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(403);
    expect(handlerCalls).toBe(0);
  });

  it('rebinds a canonical webhook handler to its frozen webhook definition', async () => {
    let originalCalls = 0;
    let replacementCalls = 0;
    const definition = {
      access: publicAccess('canonical webhook snapshot regression'),
      handler: () => {
        originalCalls += 1;
        return { source: 'original' };
      },
      input: s.object({}),
      verify: 'none' as const,
      verifyJustification: 'canonical webhook snapshot regression',
    };
    const declared = webhook('/canonical-hook', definition);
    const app = createApp({ endpoints: [declared] });
    definition.handler = () => {
      replacementCalls += 1;
      return { source: 'replacement' };
    };

    const response = await runEndpoint(
      app.endpoints[0]!,
      new Request('https://example.test/canonical-hook', {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
    expect(originalCalls).toBe(1);
    expect(replacementCalls).toBe(0);
  });

  it('pins a custom webhook verifier method and audit metadata when the app closes', async () => {
    let handlerCalls = 0;
    const verifier = {
      kind: 'custom' as const,
      name: 'deny',
      scheme: 'custom:deny',
      verify: async () => false,
    };
    const declared = webhook('/custom-verifier-snapshot', {
      handler: () => {
        handlerCalls += 1;
        return { leaked: true };
      },
      input: s.object({}),
      verify: verifier,
    });
    const app = createApp({ endpoints: [declared] });
    const handle = createRequestHandler(app);
    const request = () =>
      new Request('https://example.test/custom-verifier-snapshot', {
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

    expect((await handle(request())).status).toBe(401);
    verifier.name = 'allow';
    verifier.scheme = 'custom:allow';
    verifier.verify = async () => true;

    expect((await handle(request())).status).toBe(401);
    expect(handlerCalls).toBe(0);
    const canonical = app.endpoints[0]!.webhookDefinition.verify;
    expect(canonical).toMatchObject({ kind: 'custom', name: 'deny', scheme: 'custom:deny' });
    expect(Object.isFrozen(canonical)).toBe(true);
  });

  it('keeps official HMAC webhook authentication on its construction-time option snapshot', async () => {
    let handlerCalls = 0;
    const authoredSecret = new TextEncoder().encode(OLD_SNAPSHOT_HMAC_SECRET);
    const options: HmacSignatureOptions = {
      encoding: 'hex',
      header: 'x-signature',
      payload: ({ payload }) => payload,
      secret: authoredSecret,
    };
    const verifier = hmacSignature(options);
    // Public byte-shaped config is audit metadata, not the executable source of truth. Mutating
    // it before createApp() must not make canonicalization rebuild different authentication.
    (verifier.config.secret as Uint8Array).set(new TextEncoder().encode(NEW_SNAPSHOT_HMAC_SECRET));
    const declared = webhook('/hmac-verifier-snapshot', {
      handler: () => {
        handlerCalls += 1;
        return { leaked: true };
      },
      input: s.object({}),
      verify: verifier,
    });
    const app = createApp({ endpoints: [declared] });
    const derived = deriveClosedKovoApp(app, { routes: app.routes });
    expect((derived.endpoints[0] as typeof declared).webhookDefinition.verify).toBe(verifier);
    const handle = createRequestHandler(derived);
    const body = '{}';
    const signature = createHmac('sha256', NEW_SNAPSHOT_HMAC_SECRET).update(body).digest('hex');
    const request = () =>
      new Request('https://example.test/hmac-verifier-snapshot', {
        body,
        headers: { 'Content-Type': 'application/json', 'x-signature': signature },
        method: 'POST',
      });

    expect((await handle(request())).status).toBe(401);
    options.secret = NEW_SNAPSHOT_HMAC_SECRET;
    authoredSecret.set(new TextEncoder().encode(NEW_SNAPSHOT_HMAC_SECRET));

    expect((await handle(request())).status).toBe(401);
    expect(handlerCalls).toBe(0);
    expect(Object.isFrozen(verifier)).toBe(true);
    expect(Object.isFrozen(verifier.config)).toBe(true);
  });

  it('rejects a structural object that forges HMAC verifier audit metadata', () => {
    const official = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      payload: ({ payload }) => payload,
      secret: OFFICIAL_HMAC_SECRET,
    });
    const forged = {
      ...official,
      verify: async () => true,
    } as HmacSignatureVerifier;

    expect(() =>
      webhook('/forged-hmac', {
        handler: () => ({ leaked: true }),
        input: s.object({}),
        verify: forged,
      }),
    ).toThrow('HMAC verification must come from hmacSignature() or a framework preset');
  });

  it('snapshots valid guard chains at every declaration boundary', async () => {
    const original = [guard('deny-snapshot', () => ({ kind: 'forbidden' as const }))];
    const statusLayout = layout({ access: original });
    const statusRoute = route('/snapshot', { access: original, page: () => renderedHtml('no') });
    const statusQuery = query('snapshot', {
      access: original,
      load: () => ({ secret: true }),
      reads: [domain('snapshot')],
    });
    const statusMutation = mutation('snapshot/touch', {
      access: original,
      handler: () => ({ changed: true }),
      input: s.object({}),
    });
    const statusEndpoint = endpoint('/snapshot.txt', {
      access: original,
      csrf: false,
      csrfJustification: 'snapshot guard test',
      handler: () => new Response('no'),
      method: 'GET',
      reason: 'snapshot guard test',
      response: textResponse,
    });
    const statusWebhook = webhook('/snapshot-hook', {
      access: original,
      handler: () => ({ changed: true }),
      input: s.object({}),
      verify: 'none',
      verifyJustification: 'snapshot guard test',
    });

    original[0] = () => true;
    original.length = 0;

    for (const access of [
      statusLayout.access,
      statusRoute.access,
      statusQuery.access,
      statusMutation.access,
      statusEndpoint.access,
      statusWebhook.access,
    ]) {
      expect(access).not.toBe(original);
      expect(Object.isFrozen(access)).toBe(true);
      expect(isExecutableGuardAccessDecision(access)).toBe(true);
      await expect(runAccessDecisionGuards(access, undefined, {})).resolves.toMatchObject({
        auth: 'unauthorized',
        code: 'UNAUTHORIZED',
      });
    }
  });

  it('pins declaration access against assignment, deletion, and defineProperty drift', async () => {
    const deny = guard('deny-pinned', () => ({ kind: 'forbidden' as const }));
    const authored = [deny];
    const declarations: (object & { access?: AccessDecision })[] = [
      layout({ access: authored }),
      route('/pinned-route', { access: authored, page: () => renderedHtml('private') }),
      query('pinned-query', { access: authored, load: () => ({ private: true }) }),
      mutation('pinned-mutation', {
        access: authored,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
      mutation({
        access: authored,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
      endpoint('/pinned-endpoint', {
        access: authored,
        csrf: false,
        csrfJustification: 'pinned access test',
        handler: () => new Response('private'),
        method: 'GET',
        reason: 'pinned access test',
        response: textResponse,
      }),
      webhook('/pinned-webhook', {
        access: authored,
        handler: () => ({ private: true }),
        input: s.object({}),
        verify: 'none',
        verifyJustification: 'pinned access test',
      }),
    ];

    authored[0] = () => true;
    authored.length = 0;

    for (const declaration of declarations) {
      const pinned = accessDecisionFor(declaration);
      expect(Object.getOwnPropertyDescriptor(declaration, 'access')).toMatchObject({
        configurable: false,
        enumerable: true,
        value: pinned,
        writable: false,
      });
      expect(() => {
        declaration.access = undefined;
      }).toThrow(TypeError);
      expect(() => {
        delete declaration.access;
      }).toThrow(TypeError);
      expect(() =>
        Object.defineProperty(declaration, 'access', {
          configurable: true,
          value: publicAccess('attempted replacement'),
          writable: true,
        }),
      ).toThrow(TypeError);
      expect(accessDecisionFor(declaration)).toBe(pinned);
      await expect(runAccessDecisionGuards(pinned, undefined, {})).resolves.toMatchObject({
        auth: 'unauthorized',
        code: 'UNAUTHORIZED',
      });
    }
  });

  it('pins public, verified, and absent legacy decisions without changing guard fallback', async () => {
    const deny = guard('deny-legacy', () => ({ kind: 'forbidden' as const }));
    const publicRoute = route('/pinned-public', {
      access: publicAccess('pinned public route'),
      page: () => renderedHtml('public'),
    });
    const machineEndpoint = endpoint('/pinned-machine', {
      access: verifiedAccess,
      auth: { kind: 'custom', name: 'machine' },
      csrf: false,
      csrfJustification: 'pinned machine test',
      handler: () => new Response('machine'),
      method: 'GET',
      reason: 'pinned machine test',
      response: textResponse,
    });
    const legacyRoute = route('/pinned-legacy', {
      guard: deny,
      page: () => renderedHtml('private'),
    });

    for (const declaration of [publicRoute, machineEndpoint, legacyRoute]) {
      const access = accessDecisionFor(declaration);
      expect(Reflect.set(declaration, 'access', undefined)).toBe(false);
      expect(Reflect.deleteProperty(declaration, 'access')).toBe(false);
      expect(accessDecisionFor(declaration)).toBe(access);
    }
    expect(Object.getOwnPropertyDescriptor(legacyRoute, 'access')).toMatchObject({
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
    await expect(
      runAccessDecisionGuards(accessDecisionFor(legacyRoute), legacyRoute.guard, {}),
    ).resolves.toMatchObject({ auth: 'unauthorized', code: 'UNAUTHORIZED' });
  });

  it('executes descriptor-snapshotted guards instead of Proxy indexed reads', async () => {
    const deny = guard('deny-proxy', () => ({ kind: 'forbidden' as const }));
    let indexedReads = 0;
    const proxied = new Proxy([deny], {
      get(target, property, receiver) {
        if (property === '0') {
          indexedReads += 1;
          return () => true;
        }
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const definition = query('proxy-snapshot', {
      access: proxied,
      load: () => ({ private: true }),
    });

    expect(indexedReads).toBe(0);
    await expect(runAccessDecisionGuards(definition.access, undefined, {})).resolves.toMatchObject({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
    });
    await expect(runAccessDecisionGuards(proxied, undefined, {})).resolves.toMatchObject({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
    });
    expect(indexedReads).toBe(0);
  });

  it('uses the private snapshot for frozen structural declarations', async () => {
    const deny = guard('deny-frozen', () => ({ kind: 'forbidden' as const }));
    const sparse: Guard<object>[] = [];
    sparse.length = 1;
    const frozenValid = Object.freeze({ access: Object.freeze([deny]) });
    const frozenInvalid = Object.freeze({ access: Object.freeze(sparse) });

    await expect(
      runAccessDecisionGuards(accessDecisionFor(frozenValid), undefined, {}),
    ).resolves.toMatchObject({ auth: 'unauthorized', code: 'UNAUTHORIZED' });
    await expect(
      runAccessDecisionGuards(accessDecisionFor(frozenInvalid), undefined, {}),
    ).resolves.toEqual({
      auth: 'unauthorized',
      code: 'UNAUTHORIZED',
      payload: {},
      status: 422,
    });
  });

  it('fails closed on empty, sparse, non-guard, and accessor-backed access arrays', async () => {
    const sparse: Guard<object>[] = [];
    sparse.length = 1;
    const empty: Guard<object>[] = [];
    const nonGuard = [undefined] as unknown as Guard<object>[];
    const oversized: Guard<object>[] = [];
    oversized.length = 257;
    const oversizedProxy = new Proxy(oversized, {
      getOwnPropertyDescriptor(target, property) {
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    let getterReads = 0;
    const accessor: Guard<object>[] = [];
    Object.defineProperty(accessor, 0, {
      configurable: true,
      get() {
        getterReads += 1;
        return () => true;
      },
    });

    for (const [name, authored] of [
      ['empty', empty],
      ['sparse', sparse],
      ['non-guard', nonGuard],
      ['accessor', accessor],
      ['oversized', oversized],
      ['oversized-proxy', oversizedProxy],
    ] as const) {
      const definition = query(`invalid-${name}`, {
        access: authored,
        load: () => ({ secret: true }),
        reads: [domain(`invalid-${name}`)],
      });

      expect(definition.access).not.toBe(authored);
      expect(Object.isFrozen(definition.access)).toBe(true);
      expect(isExecutableGuardAccessDecision(definition.access)).toBe(false);
      await expect(runAccessDecisionGuards(definition.access, undefined, {})).resolves.toEqual({
        auth: 'unauthorized',
        code: 'UNAUTHORIZED',
        payload: {},
        status: 422,
      });
    }
    expect(getterReads).toBe(0);

    const sparseDeclarations: (object & { access?: AccessDecision })[] = [
      layout({ access: sparse }),
      route('/invalid-sparse-route', { access: sparse, page: () => renderedHtml('private') }),
      query('invalid-sparse-query-surface', { access: sparse, load: () => ({ private: true }) }),
      mutation('invalid-sparse-mutation', {
        access: sparse,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
      mutation({
        access: sparse,
        handler: () => ({ private: true }),
        input: s.object({}),
      }),
      endpoint('/invalid-sparse-endpoint', {
        access: sparse,
        csrf: false,
        csrfJustification: 'invalid sparse surface test',
        handler: () => new Response('private'),
        method: 'GET',
        reason: 'invalid sparse surface test',
        response: textResponse,
      }),
      webhook('/invalid-sparse-webhook', {
        access: sparse,
        handler: () => ({ private: true }),
        input: s.object({}),
        verify: 'none',
        verifyJustification: 'invalid sparse surface test',
      }),
    ];
    for (const declaration of sparseDeclarations) {
      await expect(
        runAccessDecisionGuards(accessDecisionFor(declaration), undefined, {}),
      ).resolves.toEqual({
        auth: 'unauthorized',
        code: 'UNAUTHORIZED',
        payload: {},
        status: 422,
      });
    }
  });

  it('does not change endpoint auth enforcement', async () => {
    const verifier = hmacSignature({
      encoding: 'hex',
      header: 'x-signature',
      name: 'access',
      payload: (request) => request.payload,
      scheme: 'access:v1:hmac-sha256',
      secret: ACCESS_HMAC_SECRET,
    });
    const guardedEndpoint = endpoint('/machine/access', {
      access: publicAccess('audit metadata only'),
      auth: { kind: 'verifier', name: verifier.resolved.scheme, verify: verifier },
      csrf: false,
      csrfJustification: 'machine auth test',
      handler: () => new Response('ok'),
      method: 'POST',
      reason: 'machine auth test',
      response: textResponse,
    });
    expect(Object.getOwnPropertyDescriptor(guardedEndpoint, 'auth')).toMatchObject({
      configurable: false,
      enumerable: true,
      writable: false,
    });
    expect(Reflect.set(guardedEndpoint, 'auth', undefined)).toBe(false);
    expect(Reflect.set(verifier, 'verify', async () => true)).toBe(false);

    const rejected = await runEndpointAuth(
      guardedEndpoint,
      new Request('https://example.test/machine/access', {
        body: '{"id":"1"}',
        headers: { 'x-signature': sign('{}') },
        method: 'POST',
      }),
    );
    expect(rejected?.status).toBe(401);

    const body = '{"id":"1"}';
    await expect(
      runEndpointAuth(
        guardedEndpoint,
        new Request('https://example.test/machine/access', {
          body,
          headers: { 'x-signature': sign(body) },
          method: 'POST',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
