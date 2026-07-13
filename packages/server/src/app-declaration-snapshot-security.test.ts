import { trustedHtml } from '@kovojs/browser';
import { customVerifier } from '@kovojs/core';
import { describe, expect, it, vi } from 'vitest';

import { publicAccess } from './access.js';
import { createApp, createRequestHandler } from './app.js';
import { createAppDeclarationSnapshotContext, snapshotAppEndpoint } from './app-snapshot.js';
import { createMemoryVersionedClientModuleRegistry } from './client-modules.js';
import { csrfToken, type CsrfOptions } from './csrf.js';
import { domain } from './domain.js';
import { endpoint } from './endpoint.js';
import { guards } from './guards.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { layout, route } from './route.js';
import { SchemaValidationError, s, type Schema } from './schema.js';
import type { WebhookDeclaration } from './webhook.js';

describe('closed app declaration semantics', () => {
  it('fails closed when the app webhook verifier snapshot receives a truthy non-boolean result', async () => {
    const source = {
      csrf: { exempt: true, justification: 'app webhook snapshot verifier regression' },
      handler: () => new Response('unreachable'),
      method: 'POST',
      mount: 'exact',
      name: '/app-snapshot/truthy-webhook',
      path: '/app-snapshot/truthy-webhook',
      reason: 'app webhook snapshot verifier regression',
      response: { appOwnedSafety: false, body: 'text', cache: 'no-store' },
      webhook: true,
      webhookDefinition: {
        handler: () => undefined,
        input: s.object({ id: s.string() }),
        verify: customVerifier('app-snapshot-truthy-webhook', async () => ({ ok: false }) as never),
      },
    };
    const snapshot = snapshotAppEndpoint(
      source as never,
      createAppDeclarationSnapshotContext(),
    ) as WebhookDeclaration;
    const verifier = snapshot.webhookDefinition.verify;

    expect(verifier).not.toBe('none');
    if (verifier === 'none') throw new Error('expected an executable app webhook verifier');
    await expect(
      verifier.verify({ headers: new Headers(), payload: new Uint8Array() }),
    ).resolves.toBe(false);
  });

  it('pins route parameter schema methods before request dispatch', async () => {
    const params: Schema<{ id: string }> = {
      parse() {
        throw new SchemaValidationError([{ message: 'route parameter denied', path: ['id'] }]);
      },
    };
    const page = vi.fn(({ params: parsed }: { params: { id: string } }) =>
      trustedHtml(`<main>${parsed.id}-private-profile</main>`),
    );
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/accounts/:id', {
            page,
            params,
          }),
        ],
      }),
    );

    params.parse = () => ({ id: 'victim' });
    const response = await handler(new Request('https://example.test/accounts/attacker'));

    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain('victim-private-profile');
    expect(page).not.toHaveBeenCalled();
  });

  it('pins route search schema methods before request dispatch', async () => {
    const search: Schema<{ account: string }> = {
      parse() {
        throw new SchemaValidationError([{ message: 'route search denied', path: ['account'] }]);
      },
    };
    const page = vi.fn(({ search: parsed }: { search: { account: string } }) =>
      trustedHtml(`<main>${parsed.account}-private-profile</main>`),
    );
    const handler = createRequestHandler(
      createApp({ routes: [route('/search', { page, search })] }),
    );

    search.parse = () => ({ account: 'victim' });
    const response = await handler(new Request('https://example.test/search?account=attacker'));

    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain('victim-private-profile');
    expect(page).not.toHaveBeenCalled();
  });

  it('pins route region renderer identities before request dispatch', async () => {
    const regions = {
      page: () => trustedHtml('<main>safe-region</main>'),
    };
    const handler = createRequestHandler(createApp({ routes: [route('/regions', { regions })] }));

    regions.page = () => trustedHtml('<main>victim-region-secret</main>');
    const response = await handler(new Request('https://example.test/regions'));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('safe-region');
    expect(body).not.toContain('victim-region-secret');
  });

  it('pins route boundary renderer identities before denied requests resolve', async () => {
    const boundaries = {
      unauthorized: () => trustedHtml('<main>safe-forbidden</main>'),
    };
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/admin', {
            boundaries,
            guard: () => ({ kind: 'forbidden' as const }),
            page: () => trustedHtml('<main>admin-secret</main>'),
          }),
        ],
      }),
    );

    boundaries.unauthorized = () => trustedHtml('<main>victim-session-secret</main>');
    const response = await handler(new Request('https://example.test/admin'));
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).toContain('safe-forbidden');
    expect(body).not.toContain('victim-session-secret');
  });

  it('pins layout boundary renderer identities before denied requests resolve', async () => {
    const boundaries = {
      unauthorized: () => trustedHtml('<main>safe-layout-forbidden</main>'),
    };
    const AdminLayout = layout({
      boundaries,
      guard: () => ({ kind: 'forbidden' as const }),
      render: (_queries, _state, { children }) => children,
    });
    const handler = createRequestHandler(
      createApp({
        routes: [
          route('/layout-admin', {
            layout: AdminLayout,
            page: () => trustedHtml('<main>admin-secret</main>'),
          }),
        ],
      }),
    );

    boundaries.unauthorized = () => trustedHtml('<main>victim-layout-secret</main>');
    const response = await handler(new Request('https://example.test/layout-admin'));
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).toContain('safe-layout-forbidden');
    expect(body).not.toContain('victim-layout-secret');
  });

  it('pins query output schema methods before values reach the wire', async () => {
    const output: Schema<{ public: string }> = {
      parse() {
        throw new SchemaValidationError([
          { message: 'secret projection denied', path: ['secret'] },
        ]);
      },
    };
    const definition = query('accounts/private-projection', {
      access: publicAccess('schema snapshot regression'),
      load: () => ({ public: 'safe', secret: 'victim-secret' }),
      output,
      reads: [],
    });
    const handler = createRequestHandler(createApp({ queries: [definition] }));

    output.parse = (value) => value as { public: string };
    const response = await handler(
      new Request('https://example.test/_q/accounts/private-projection'),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('victim-secret');
  });

  it('pins the source schema behind callable query args bindings', async () => {
    const args: Schema<{ account: string }> = {
      parse() {
        throw new SchemaValidationError([{ message: 'query account denied', path: ['account'] }]);
      },
    };
    const load = vi.fn((input: { account: string }) => ({ account: input.account }));
    const definition = query('accounts/by-id', {
      access: publicAccess('query args schema snapshot regression'),
      args,
      load,
      reads: [],
    });
    const handler = createRequestHandler(createApp({ queries: [definition] }));

    args.parse = () => ({ account: 'victim' });
    const response = await handler(
      new Request('https://example.test/_q/accounts/by-id?account=attacker'),
    );

    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain('victim');
    expect(load).not.toHaveBeenCalled();
  });

  it('pins mutation-local CSRF signing and session authority before dispatch', async () => {
    const csrf: CsrfOptions<Request> = {
      secret: 'operator-owned-csrf-secret-0123456789abcdef',
      sessionId: () => 'victim-session',
    };
    const run = vi.fn(() => ({ deleted: true }));
    const definition = mutation('accounts/delete', {
      access: publicAccess('CSRF-protected account action'),
      csrf,
      handler: run,
      input: s.object({}),
    });
    const handler = createRequestHandler(createApp({ mutations: [definition] }));

    csrf.secret = 'attacker-known-csrf-secret-0123456789abcdef';
    csrf.sessionId = () => 'attacker-session';
    const attackerToken = csrfToken(new Request('https://example.test'), csrf, {
      audience: definition.key,
    });
    const body = new FormData();
    body.set('kovo-csrf', attackerToken);
    const response = await handler(
      new Request('https://example.test/_m/accounts/delete', {
        body,
        headers: { Origin: 'https://example.test' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(422);
    expect(run).not.toHaveBeenCalled();
  });

  it('pins nested query and mutation registry facts used by runtime policy', () => {
    const readDomain = domain('safe-read');
    const touchDomain = domain('safe-touch');
    const delta = { domain: 'safe-read', key: 'id', path: 'items' };
    const inferredTouch = {
      domain: 'safe-touch',
      keys: 'arg:id',
      via: 'safe_table',
    };
    const queryDefinition = query('registry/read', {
      access: publicAccess('registry snapshot regression'),
      delta: [delta],
      load: () => ({ items: [] }),
      reads: [readDomain],
    });
    const mutationDefinition = mutation('registry/write', {
      access: publicAccess('registry snapshot regression'),
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      handler: () => ({ ok: true }),
      input: s.object({ id: s.string() }),
      registry: {
        inferredTouches: [inferredTouch],
        tables: ['safe_table'],
        touches: [touchDomain],
      },
    });
    const app = createApp({ mutations: [mutationDefinition], queries: [queryDefinition] });

    readDomain.key = 'attacker-read';
    touchDomain.key = 'attacker-touch';
    delta.domain = 'attacker-read';
    delta.path = 'secret';
    inferredTouch.domain = 'attacker-touch';
    inferredTouch.keys = null as unknown as string;
    inferredTouch.via = 'attacker_table';

    expect(app.queries[0]?.reads?.[0]).toEqual({ key: 'safe-read' });
    expect(app.queries[0]?.delta?.[0]).toEqual({
      domain: 'safe-read',
      key: 'id',
      path: 'items',
    });
    expect(app.mutations[0]?.registry?.touches?.[0]).toEqual({ key: 'safe-touch' });
    expect(app.mutations[0]?.registry?.inferredTouches?.[0]).toEqual({
      domain: 'safe-touch',
      keys: 'arg:id',
      via: 'safe_table',
    });
    expect(Object.isFrozen(app.queries[0]?.delta?.[0])).toBe(true);
    expect(Object.isFrozen(app.mutations[0]?.registry?.inferredTouches?.[0])).toBe(true);
  });

  it('pins endpoint redirect allowlist entries before the Location sink', async () => {
    const allowed = {
      origin: 'https://accounts.example.test',
      reason: 'documented identity-provider handoff',
    };
    const redirect = endpoint('/leave', {
      access: publicAccess('redirect allowlist snapshot regression'),
      csrf: false,
      csrfJustification: 'read-only redirect',
      handler: () => Response.redirect('https://evil.example.test/phish', 302),
      method: 'GET',
      reason: 'redirect allowlist snapshot regression',
      response: {
        appOwnedSafety: true,
        body: 'redirect',
        cache: 'no-store',
        redirectAllowlist: [allowed],
      },
    });
    const handler = createRequestHandler(createApp({ endpoints: [redirect] }));

    allowed.origin = 'https://evil.example.test';
    allowed.reason = 'attacker replacement';
    const response = await handler(new Request('https://example.test/leave'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
  });

  it('pins injected client-module registry methods before immutable JavaScript dispatch', async () => {
    const backing = createMemoryVersionedClientModuleRegistry();
    const registry = {
      buildToken: () => backing.buildToken(),
      entries: () => backing.entries(),
      put: (module: Parameters<typeof backing.put>[0]) => backing.put(module),
      resolve: (href: string) => backing.resolve(href),
      setRenderPlanFingerprint: (fingerprint: string) =>
        backing.setRenderPlanFingerprint?.(fingerprint),
    };
    const app = createApp({ clientModules: registry });
    const href = app.clientModules.put({
      path: '/c/account.client.js',
      source: 'export const account = "safe";',
      version: 'safe-v1',
    });
    const handler = createRequestHandler(app);

    registry.resolve = () => ({
      body: 'globalThis.account = "attacker";',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
      status: 200,
    });
    const response = await handler(new Request(`https://example.test${href}`));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('account = "safe"');
    expect(body).not.toContain('account = "attacker"');
  });

  it('pins top-level session authority before declaration callbacks execute', async () => {
    let options: Parameters<typeof createApp>[0];
    options = {
      routes: ({ route: appRoute }) => {
        options.sessionProvider = async () => ({
          user: { id: 'attacker', roles: ['admin'] },
        });
        return [
          appRoute('/admin', {
            guard: guards.role('admin'),
            page: () => trustedHtml('<main>victim-admin-secret</main>'),
          }),
        ];
      },
      sessionProvider: async () => null,
    };
    const handler = createRequestHandler(createApp(options));

    const response = await handler(new Request('https://example.test/admin'));
    const body = await response.text();

    expect(response.status).toBe(303);
    expect(body).not.toContain('victim-admin-secret');
  });
});
