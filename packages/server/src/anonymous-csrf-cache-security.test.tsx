/** @jsxImportSource @kovojs/server */
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { customVerifier } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { csrfToken, mintCsrfField, mintCsrfToken, validateCsrfToken } from './csrf.js';
import { Defer } from './deferred-region.js';
import {
  endpoint,
  pinEndpointBrowserCredentialDelegation,
  type EndpointResponsePosture,
} from './endpoint.js';
import { mutation } from './mutation.js';
import { query } from './query.js';
import { guard } from './guards.js';
import { resolveLifecycleRequest } from './guards.js';
import { toNodeHandler } from './node.js';
import { respond } from './response.js';
import { notFound, route } from './route.js';
import { s } from './schema.js';

const csrf = {
  secret: 'anonymous-cache-security-csrf-secret-0123456789abcdef',
  sessionId: () => undefined,
};

function anonymousFormApp(onSubmit: () => void) {
  const submit = mutation('account/request-link', {
    input: s.object({ email: s.string() }),
    handler(input) {
      onSubmit();
      return input;
    },
  });
  const login = route('/login', {
    page: () => (
      <main>
        <form mutation={submit}>
          <input name="email" type="email" />
          <button type="submit">Continue</button>
        </form>
      </main>
    ),
  });
  return createApp({
    csrf,
    egress: { enabled: false, justification: 'cache-security fixture performs no outbound I/O' },
    mutations: [submit],
    routes: [login],
  });
}

function hiddenValue(html: string, name: string): string {
  const match = new RegExp(`name="${name}" value="([^"]+)"`, 'u').exec(html);
  if (!match?.[1]) throw new Error(`expected ${name} in ${html}`);
  return match[1];
}

function formHiddenValue(html: string, formId: string, name: string): string {
  const form = new RegExp(`<form[^>]*id="${formId}"[\\s\\S]*?<\\/form>`, 'u').exec(html)?.[0];
  if (form === undefined) throw new Error(`expected form ${formId} in ${html}`);
  return hiddenValue(form, name);
}

function cookieHeader(binding: string): string {
  return `__Host-kovo_csrf=${binding}`;
}

async function selectCachedOrFreshHtml(
  handler: ReturnType<typeof createRequestHandler>,
  primed: Response,
  primedHtml: string,
  victimBinding: string,
): Promise<string> {
  const cacheControl = primed.headers.get('cache-control') ?? '';
  const vary = primed.headers.get('vary') ?? '';
  if (!/\bno-store\b/iu.test(cacheControl) && !/(?:^|,)\s*Cookie\s*(?:,|$)/iu.test(vary)) {
    return primedHtml;
  }
  const fresh = await handler(
    new Request('https://shop.example.test/login', {
      headers: { Cookie: cookieHeader(victimBinding) },
    }),
  );
  return fresh.text();
}

describe('anonymous mutation-form document cache posture', () => {
  it('marks an existing-cookie CSRF document variant private and cookie-varying', async () => {
    const handler = createRequestHandler(anonymousFormApp(() => undefined));
    const attackerBinding = 'A'.repeat(43);
    const victimBinding = 'B'.repeat(43);

    // A remote cache-primer can supply any syntactically valid anonymous binding on a public GET.
    // The rendered token is consequently specific to that cookie value.
    const primed = await handler(
      new Request('https://shop.example.test/login', {
        headers: { Cookie: cookieHeader(attackerBinding) },
      }),
    );
    const primedHtml = await primed.text();
    const primedToken = hiddenValue(primedHtml, 'kovo-csrf');

    const victim = await handler(
      new Request('https://shop.example.test/login', {
        headers: { Cookie: cookieHeader(victimBinding) },
      }),
    );
    const victimHtml = await victim.text();
    expect(hiddenValue(victimHtml, 'kovo-csrf')).not.toBe(primedToken);

    // This is the required contract: a body carrying per-cookie CSRF authority must never be a
    // reusable public representation. These assertions are intentionally red at the audited tip.
    expect({
      cacheControl: primed.headers.get('cache-control'),
      vary: primed.headers.get('vary'),
    }).toEqual({ cacheControl: 'private, no-store', vary: 'Cookie' });
  });

  it('does not reject a victim submit after a shared cache reuses an attacker-cookie variant', async () => {
    let submissions = 0;
    const handler = createRequestHandler(anonymousFormApp(() => submissions++));
    const attackerBinding = 'A'.repeat(43);
    const victimBinding = 'B'.repeat(43);
    const primed = await handler(
      new Request('https://shop.example.test/login', {
        headers: { Cookie: cookieHeader(attackerBinding) },
      }),
    );
    const primedHtml = await primed.text();
    const primedToken = hiddenValue(primedHtml, 'kovo-csrf');
    const primedIdem = hiddenValue(primedHtml, 'Kovo-Idem');

    const attackerControl = await handler(
      new Request('https://shop.example.test/_m/account/request-link', {
        body: new URLSearchParams({
          'Kovo-Idem': primedIdem,
          email: 'attacker@example.test',
          'kovo-csrf': primedToken,
        }),
        headers: {
          Cookie: cookieHeader(attackerBinding),
          Origin: 'https://shop.example.test',
        },
        method: 'POST',
      }),
    );
    expect(attackerControl.status).toBe(303);
    expect(submissions).toBe(1);

    // A conforming shared cache reuses the primed representation only when Kovo omitted both
    // no-store and Cookie variance. With either floor present it performs the victim's own GET.
    const victimHtml = await selectCachedOrFreshHtml(handler, primed, primedHtml, victimBinding);

    // Model the shared-cache replay exactly: victim receives the attacker's cached HTML, keeps the
    // victim cookie, and submits the otherwise ordinary no-JS form values from that document.
    const cachedBody = new URLSearchParams({
      'Kovo-Idem': hiddenValue(victimHtml, 'Kovo-Idem'),
      email: 'victim@example.test',
      'kovo-csrf': hiddenValue(victimHtml, 'kovo-csrf'),
    });
    const poisonedSubmit = await handler(
      new Request('https://shop.example.test/_m/account/request-link', {
        body: cachedBody,
        headers: {
          Cookie: cookieHeader(victimBinding),
          Origin: 'https://shop.example.test',
        },
        method: 'POST',
      }),
    );
    expect(poisonedSubmit.status).toBe(303);
    expect(submissions).toBe(2);
  });

  it('keeps the first anonymous render private when it mints the binding cookie (control)', async () => {
    const handler = createRequestHandler(anonymousFormApp(() => undefined));
    const response = await handler(new Request('https://shop.example.test/login'));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('keeps the enhanced-submit path usable after the same conforming-cache selection', async () => {
    let submissions = 0;
    const handler = createRequestHandler(anonymousFormApp(() => submissions++));
    const attackerBinding = 'A'.repeat(43);
    const victimBinding = 'B'.repeat(43);
    const primed = await handler(
      new Request('https://shop.example.test/login', {
        headers: { Cookie: cookieHeader(attackerBinding) },
      }),
    );
    const primedHtml = await primed.text();
    const victimHtml = await selectCachedOrFreshHtml(handler, primed, primedHtml, victimBinding);
    const idem = hiddenValue(victimHtml, 'Kovo-Idem');
    const response = await handler(
      new Request('https://shop.example.test/_m/account/request-link', {
        body: new URLSearchParams({
          'Kovo-Idem': idem,
          email: 'victim@example.test',
          'kovo-csrf': hiddenValue(victimHtml, 'kovo-csrf'),
        }),
        headers: {
          Cookie: cookieHeader(victimBinding),
          'Kovo-Current-Url': 'https://shop.example.test/login',
          'Kovo-Fragment': 'true',
          'Kovo-Idem': idem,
          Origin: 'https://shop.example.test',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    expect(submissions).toBe(1);
  });

  it('keeps unrelated public HTML cacheable merely because the request carries a Cookie', async () => {
    const about = route('/about', { page: () => <main>Public information</main> });
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [about],
      }),
    );
    const response = await handler(
      new Request('https://shop.example.test/about', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBeNull();
    expect(response.headers.get('vary')).toBeNull();
  });

  it('selects the private posture before a deferred region can emit anonymous CSRF authority', async () => {
    let releaseRegion!: () => void;
    const regionGate = new Promise<void>((resolve) => {
      releaseRegion = resolve;
    });
    const submit = mutation('account/deferred-request-link', {
      csrf,
      input: s.object({ email: s.string() }),
      handler: (input) => input,
    });
    const deferred = route('/deferred-login', {
      page: () => (
        <main>
          <Defer
            fallback={<p>Loading form</p>}
            priority="after-paint"
            render={async () => {
              await regionGate;
              return (
                <form mutation={submit}>
                  <input name="email" />
                </form>
              );
            }}
            target="login-form"
          />
        </main>
      ),
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        mutations: [submit],
        routes: [deferred],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/deferred-login', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    releaseRegion();
    await expect(response.text()).resolves.toContain('name="kovo-csrf"');
  });

  it('pre-delivers the binding cookie when a first-time deferred form owns local CSRF', async () => {
    let releaseRegion!: () => void;
    const regionGate = new Promise<void>((resolve) => {
      releaseRegion = resolve;
    });
    let submissions = 0;
    const submit = mutation('account/first-deferred-request-link', {
      csrf,
      input: s.object({ email: s.string() }),
      handler(input) {
        submissions += 1;
        return input;
      },
    });
    const deferred = route('/first-deferred-login', {
      page: () => (
        <main>
          <Defer
            fallback={<p>Loading form</p>}
            priority="after-paint"
            render={async () => {
              await regionGate;
              return (
                <form mutation={submit}>
                  <input name="email" />
                </form>
              );
            }}
            target="first-login-form"
          />
        </main>
      ),
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        mutations: [submit],
        routes: [deferred],
      }),
    );

    const response = await handler(new Request('https://shop.example.test/first-deferred-login'));
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    releaseRegion();
    const html = await response.text();
    const cookiePair = setCookies[0]?.split(';')[0];
    if (cookiePair === undefined) throw new Error('expected deferred anonymous binding cookie');
    const result = await handler(
      new Request('https://shop.example.test/_m/account/first-deferred-request-link', {
        body: new URLSearchParams({
          'Kovo-Idem': hiddenValue(html, 'Kovo-Idem'),
          email: 'visitor@example.test',
          'kovo-csrf': hiddenValue(html, 'kovo-csrf'),
        }),
        headers: { Cookie: cookiePair, Origin: 'https://shop.example.test' },
        method: 'POST',
      }),
    );

    expect(result.status).toBe(303);
    expect(submissions).toBe(1);
  });

  it('does not invoke an unrelated mutation session extractor during deferred preflight', async () => {
    let sessionIdCalls = 0;
    const unrelated = mutation('account/unrelated-deferred-mutation', {
      csrf: {
        ...csrf,
        sessionId() {
          sessionIdCalls += 1;
          throw new Error('unrelated mutation session extractor ran');
        },
      },
      input: s.object({ value: s.string() }),
      handler: (input) => input,
    });
    const deferred = route('/deferred-public-copy', {
      page: () => (
        <main>
          <Defer
            fallback={<p>Loading public copy</p>}
            priority="after-paint"
            render={async () => <p>Public copy ready</p>}
            target="public-copy"
          />
        </main>
      ),
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        mutations: [unrelated],
        routes: [deferred],
      }),
    );

    const response = await handler(new Request('https://shop.example.test/deferred-public-copy'));

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('Public copy ready');
    expect(sessionIdCalls).toBe(0);
  });

  it('preserves the private posture through the live Node adapter', async () => {
    const nodeServer = createServer(
      toNodeHandler(createRequestHandler(anonymousFormApp(() => undefined)), {
        origin: 'https://shop.example.test',
      }),
    );
    await new Promise<void>((resolve, reject) => {
      nodeServer.once('error', reject);
      nodeServer.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = nodeServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/login`, {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      });
      await response.text();
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('vary')).toContain('Cookie');
    } finally {
      await new Promise<void>((resolve, reject) => {
        nodeServer.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });

  it('captures a first-anonymous cookie minted by an immediate route stream pull', async () => {
    const audience = 'endpoint:/immediate-route-token-submit';
    const download = route('/immediate-route-token', {
      page(_context, request) {
        return respond.stream(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              const token = mintCsrfToken(request, csrf, { audience }).token;
              controller.enqueue(new TextEncoder().encode(token));
              controller.close();
            },
          }),
          {
            contentType: 'text/plain',
            headers: { 'Cache-Control': 'public, max-age=60' },
          },
        );
      },
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [download],
      }),
    );

    const response = await handler(new Request('https://shop.example.test/immediate-route-token'));
    const token = await response.text();
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    const cookie = setCookies[0]!.split(';', 1)[0]!;
    expect(
      validateCsrfToken(
        { 'kovo-csrf': token },
        new Request('https://shop.example.test/_m/immediate-route-token-submit', {
          headers: { cookie, origin: 'https://shop.example.test' },
          method: 'POST',
        }),
        csrf,
        { audience },
      ),
    ).toBe(true);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('fails closed when a route mints competing framework and standalone cookie bindings', async () => {
    const submit = mutation('route-cookie-conflict', {
      input: s.object({ value: s.string() }),
      handler: (input) => input,
    });
    const conflicting = route('/route-cookie-conflict', {
      page(_context, request) {
        const token = mintCsrfToken(request, csrf, { mutation: submit }).token;
        return (
          <main>
            <p>{token}</p>
            <form mutation={submit}>
              <input name="value" />
            </form>
          </main>
        );
      },
    });
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        mutations: [submit],
        onError: () => undefined,
        routes: [conflicting],
      }),
    );

    const response = await handler(new Request('https://shop.example.test/route-cookie-conflict'));

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('selects the private posture before a live route stream can mint from pull()', async () => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const download = route('/late-route-token', {
      page(_context, request) {
        const lazyRequest = new Request(request.url);
        return respond.stream(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              await streamGate;
              const minted = mintCsrfToken(lazyRequest, csrf, {
                audience: 'endpoint:/late-route-token-submit',
              });
              if (minted.setCookie !== undefined) {
                throw new Error(
                  'derived late request did not reuse the canonical anonymous cookie',
                );
              }
              controller.enqueue(new TextEncoder().encode(minted.token));
              controller.close();
            },
          }),
          {
            contentType: 'text/plain',
            headers: { 'Cache-Control': 'public, max-age=60' },
          },
        );
      },
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [download],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/late-route-token', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    releaseStream();
    await expect(response.text()).resolves.not.toBe('');
  });

  it('fails closed when a route stream first mints anonymous authority after headers commit', async () => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const download = route('/late-first-anonymous-route-token/:id', {
      params: s.object({ id: s.string() }),
      page(_context, request) {
        const lazyRequest = new Request(request.url, { headers: request.headers });
        return respond.stream(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              await streamGate;
              const token = mintCsrfToken(lazyRequest, csrf, {
                audience: 'endpoint:/late-first-anonymous-route-token-submit',
              }).token;
              controller.enqueue(new TextEncoder().encode(token));
              controller.close();
            },
          }),
          { contentType: 'text/plain' },
        );
      },
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [download],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/late-first-anonymous-route-token/report-1'),
    );
    releaseStream();

    await expect(response.text()).rejects.toThrow(/after response headers were committed/u);
  });

  it('retains a parameterized handler request across an external event after header commit', async () => {
    const events = new EventEmitter();
    const download = route('/event-token/:id', {
      params: s.object({ id: s.string() }),
      page(_context, request) {
        return respond.stream(
          new ReadableStream<Uint8Array>({
            start(controller) {
              events.once('ready', () => {
                try {
                  const token = mintCsrfToken(request, csrf, {
                    audience: 'endpoint:/event-token-submit',
                  }).token;
                  controller.enqueue(new TextEncoder().encode(token));
                  controller.close();
                } catch (error) {
                  controller.error(error);
                }
              });
            },
          }),
          { contentType: 'text/plain' },
        );
      },
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [download],
      }),
    );

    const response = await handler(new Request('https://shop.example.test/event-token/report-1'));
    events.emit('ready');

    await expect(response.text()).rejects.toThrow(/after response headers were committed/u);
  });

  it('rejects a detached reconstructed request in an external event after header commit', async () => {
    const events = new EventEmitter();
    const download = route('/event-derived-token/:id', {
      params: s.object({ id: s.string() }),
      page(_context, request) {
        const reconstructed = new Request(request.url, { headers: request.headers });
        return respond.stream(
          new ReadableStream<Uint8Array>({
            start(controller) {
              events.once('ready', () => {
                try {
                  const token = mintCsrfToken(reconstructed, csrf, {
                    audience: 'endpoint:/event-derived-token-submit',
                  }).token;
                  controller.enqueue(new TextEncoder().encode(token));
                  controller.close();
                } catch (error) {
                  controller.error(error);
                }
              });
            },
          }),
          { contentType: 'text/plain' },
        );
      },
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [download],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/event-derived-token/report-1'),
    );
    events.emit('ready');

    await expect(response.text()).rejects.toThrow(/without a framework response lifecycle/u);
  });

  it('seals a no-boundary notFound route before returning the replacement error document', async () => {
    const events = new EventEmitter();
    let listenerError: unknown;
    const missingRoute = route('/event-missing/:id', {
      params: s.object({ id: s.string() }),
      page(_context, request) {
        events.once('ready', () => {
          try {
            mintCsrfToken(request, csrf, {
              audience: 'endpoint:/event-missing-submit',
            });
          } catch (error) {
            listenerError = error;
          }
        });
        return notFound();
      },
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [missingRoute],
      }),
    );

    const response = await handler(new Request('https://shop.example.test/event-missing/report-1'));
    expect(response.status).toBe(404);
    events.emit('ready');

    expect(listenerError).toBeInstanceOf(Error);
    expect((listenerError as Error).message).toMatch(/after response headers were committed/u);
  });

  it('seals the route lifecycle when a notFound boundary throws', async () => {
    const events = new EventEmitter();
    let listenerError: unknown;
    const missingRoute = route('/throwing-boundary-token', {
      boundaries: {
        notFound({ request }) {
          events.once('ready', () => {
            try {
              mintCsrfToken(request, csrf, {
                audience: 'endpoint:/throwing-boundary-token-submit',
              });
            } catch (error) {
              listenerError = error;
            }
          });
          throw new Error('boundary render failed');
        },
      },
      page: () => notFound(),
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        onError: () => undefined,
        routes: [missingRoute],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/throwing-boundary-token'),
    );
    expect(response.status).toBe(500);
    events.emit('ready');

    expect(listenerError).toBeInstanceOf(Error);
    expect((listenerError as Error).message).toMatch(/after response headers were committed/u);
  });

  it('keeps eager existing-cookie authority private on a parameterized route', async () => {
    const tokenRoute = route('/parameterized-token/:id', {
      params: s.object({ id: s.string() }),
      page(_context, request) {
        const derived = new Request(request.url);
        return mintCsrfToken(derived, csrf, {
          audience: 'endpoint:/parameterized-token-submit',
        }).token;
      },
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [tokenRoute],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/parameterized-token/report-1', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    await expect(response.text()).resolves.not.toBe('');
  });

  it('keeps csrfToken on a recursive route clone bound to the canonical proven session', async () => {
    const sessionCsrf = {
      secret: 'route-clone-session-csrf-secret-0123456789abcdef',
      sessionId(request: { session?: { user?: { id?: string } | null } | null }) {
        return request.session?.user?.id;
      },
    };
    const download = route('/session-clone-token', {
      page(_context, request) {
        const token = csrfToken(request.clone().clone(), sessionCsrf, {
          audience: 'endpoint:/session-clone-token-submit',
        });
        return respond.stream(token, { contentType: 'text/plain' });
      },
    });
    const sessionProvider = () => ({ user: { id: 'u1' } });
    const handler = createRequestHandler(
      createApp({
        csrf: sessionCsrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [download],
        sessionProvider,
      }),
    );

    const response = await handler(new Request('https://shop.example.test/session-clone-token'));
    const token = await response.text();
    const submission = await resolveLifecycleRequest(
      new Request('https://shop.example.test/_m/session-clone-token-submit', {
        headers: { origin: 'https://shop.example.test' },
        method: 'POST',
      }),
      { sessionProvider },
    );
    expect(
      validateCsrfToken({ 'kovo-csrf': token }, submission, sessionCsrf, {
        audience: 'endpoint:/session-clone-token-submit',
      }),
    ).toBe(true);
  });

  it('keeps custom renderRoute clone authority private inside the complete route frame', async () => {
    const tokenRoute = route('/custom-render-token', {
      page: () => 'render this token',
    });
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        renderRoute(_value, context) {
          return csrfToken(context.request.clone().clone(), csrf, {
            audience: 'endpoint:/custom-render-token-submit',
          });
        },
        routes: [tokenRoute],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/custom-render-token', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(response.text()).resolves.not.toBe('');
  });

  it('keeps a reconstructed notFound boundary token private inside the complete route frame', async () => {
    const missingRoute = route('/missing-boundary-token', {
      boundaries: {
        notFound({ request }) {
          const reconstructed = new Request((request as Request).url, {
            headers: (request as Request).headers,
          });
          return csrfToken(reconstructed, csrf, {
            audience: 'endpoint:/missing-boundary-token-submit',
          });
        },
      },
      page: () => notFound(),
    });
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [missingRoute],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/missing-boundary-token', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(response.text()).resolves.not.toBe('');
  });

  it('keeps an eager route stream helper body eligible for its authored public cache policy', async () => {
    const download = route('/eager-route-body', {
      page: () =>
        respond.stream('public report', {
          contentType: 'text/plain',
          headers: { 'Cache-Control': 'public, max-age=60' },
        }),
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        routes: [download],
      }),
    );

    const response = await handler(new Request('https://shop.example.test/eager-route-body'));
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('vary')).toBeNull();
    await expect(response.text()).resolves.toBe('public report');
  });
});

describe('anonymous CSRF cookie aggregate posture', () => {
  it('rejects conflicting mutation-local cookie attributes before a direct form can render', () => {
    const first = mutation('collision/direct-first', {
      csrf: {
        anonymousCookie: { name: 'shared_csrf', path: '/', sameSite: 'lax' },
        secret: 'direct-first-collision-secret-0123456789abcdef',
        sessionId: () => undefined,
      },
      input: s.object({ value: s.string() }),
      handler: (input) => input,
    });
    const second = mutation('collision/direct-second', {
      csrf: {
        anonymousCookie: { name: 'shared_csrf', path: '/', sameSite: 'strict' },
        secret: 'direct-second-collision-secret-0123456789abcdef',
        sessionId: () => undefined,
      },
      input: s.object({ value: s.string() }),
      handler: (input) => input,
    });
    const direct = route('/collision-direct', {
      page: () => (
        <main>
          <form mutation={first} />
          <form mutation={second} />
        </main>
      ),
    });

    expect(() =>
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        mutations: [first, second],
        routes: [direct],
      }),
    ).toThrow(/conflicting browser attribute postures/u);
  });

  it('rejects an app/local conflict before a deferred form can commit ambiguous cookies', () => {
    const appCsrf = {
      anonymousCookie: { maxAge: 3600, name: 'deferred_shared_csrf', path: '/' },
      secret: 'deferred-app-collision-secret-0123456789abcdef',
      sessionId: () => undefined,
    };
    const submit = mutation('collision/deferred-local', {
      csrf: {
        ...appCsrf,
        anonymousCookie: { maxAge: 7200, name: 'deferred_shared_csrf', path: '/' },
      },
      input: s.object({ value: s.string() }),
      handler: (input) => input,
    });
    const deferred = route('/collision-deferred', {
      page: () => (
        <Defer
          priority="after-paint"
          render={() => <form mutation={submit} />}
          target="collision-form"
        />
      ),
    });

    expect(() =>
      createApp({
        csrf: appCsrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        mutations: [submit],
        routes: [deferred],
      }),
    ).toThrow(/one Path, Max-Age, SameSite, and Secure posture/u);
  });

  it('shares one binding across compatible direct and deferred local configurations', async () => {
    let releaseRegion!: () => void;
    const regionGate = new Promise<void>((resolve) => {
      releaseRegion = resolve;
    });
    let firstRuns = 0;
    let secondRuns = 0;
    const cookie = {
      maxAge: 3600,
      name: 'compatible_shared_csrf',
      path: '/',
      sameSite: 'strict' as const,
    };
    const first = mutation('compatible/direct', {
      csrf: {
        anonymousCookie: { ...cookie },
        secret: 'compatible-direct-secret-0123456789abcdef012345',
        sessionId: () => undefined,
      },
      input: s.object({ value: s.string() }),
      handler(input) {
        firstRuns += 1;
        return input;
      },
    });
    const second = mutation('compatible/deferred', {
      csrf: {
        anonymousCookie: { ...cookie },
        secret: 'compatible-deferred-secret-0123456789abcdef0123',
        sessionId: () => undefined,
      },
      input: s.object({ value: s.string() }),
      handler(input) {
        secondRuns += 1;
        return input;
      },
    });
    const page = route('/compatible-cookie-postures', {
      page: () => (
        <main>
          <form id="direct-compatible" mutation={first}>
            <input name="value" />
          </form>
          <Defer
            priority="after-paint"
            render={async () => {
              await regionGate;
              return (
                <form id="deferred-compatible" mutation={second}>
                  <input name="value" />
                </form>
              );
            }}
            target="compatible-deferred-form"
          />
        </main>
      ),
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        mutations: [first, second],
        routes: [page],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/compatible-cookie-postures'),
    );
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    releaseRegion();
    const html = await response.text();
    const cookiePair = setCookies[0]?.split(';')[0];
    if (cookiePair === undefined) throw new Error('expected compatible anonymous binding cookie');

    for (const submission of [
      { formId: 'direct-compatible', key: 'compatible/direct', value: 'one' },
      { formId: 'deferred-compatible', key: 'compatible/deferred', value: 'two' },
    ]) {
      const result = await handler(
        new Request(`https://shop.example.test/_m/${submission.key}`, {
          body: new URLSearchParams({
            'Kovo-Idem': formHiddenValue(html, submission.formId, 'Kovo-Idem'),
            'kovo-csrf': formHiddenValue(html, submission.formId, 'kovo-csrf'),
            value: submission.value,
          }),
          headers: { Cookie: cookiePair, Origin: 'https://shop.example.test' },
          method: 'POST',
        }),
      );
      expect(result.status).toBe(303);
    }
    expect({ firstRuns, secondRuns }).toEqual({ firstRuns: 1, secondRuns: 1 });
  });

  it('rejects prefixed, malformed, and accessor-backed cookie declarations without invoking getters', () => {
    const prefixed = {
      anonymousCookie: { name: '__Host-owned_by_framework' },
      secret: 'prefixed-cookie-posture-secret-0123456789abcdef',
      sessionId: () => undefined,
    };
    expect(() => createApp({ csrf: prefixed })).toThrow(/must be an unprefixed logical name/u);

    const malformed = {
      anonymousCookie: { name: 'malformed_csrf', path: '/; injected=1' },
      secret: 'malformed-cookie-posture-secret-0123456789abcdef',
      sessionId: () => undefined,
    };
    expect(() => createApp({ csrf: malformed })).toThrow(/cookie path/u);

    let getterCalls = 0;
    const accessorCookie = {};
    Object.defineProperty(accessorCookie, 'name', {
      get() {
        getterCalls += 1;
        return 'getter_csrf';
      },
    });
    expect(() =>
      createApp({
        csrf: {
          anonymousCookie: accessorCookie,
          secret: 'accessor-cookie-posture-secret-0123456789abcdef',
          sessionId: () => undefined,
        },
      }),
    ).toThrow(/own data property/u);
    expect(getterCalls).toBe(0);
  });
});

describe('raw endpoint anonymous CSRF bootstrap cache posture', () => {
  const publicHtmlResponse = {
    appOwnedSafety: true,
    body: 'html',
    cache: 'public',
  } satisfies EndpointResponsePosture;
  const publicJsonResponse = {
    appOwnedSafety: true,
    body: 'json',
    cache: 'public',
  } satisfies EndpointResponsePosture;

  it('seals an endpoint lifecycle when its handler throws before returning a response', async () => {
    const events = new EventEmitter();
    let listenerError: unknown;
    const failing = pinEndpointBrowserCredentialDelegation(
      endpoint('/throwing-endpoint-token', {
        auth: { kind: 'custom', name: 'framework-throwing-endpoint-token' },
        handler(request) {
          events.once('ready', () => {
            try {
              mintCsrfToken(request, csrf, {
                audience: 'endpoint:/throwing-endpoint-token-submit',
              });
            } catch (error) {
              listenerError = error;
            }
          });
          throw new Error('endpoint handler failed');
        },
        method: 'GET',
        reason: 'framework-owned throwing endpoint lifecycle fixture',
        response: publicJsonResponse,
      }),
    );
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [failing],
        onError: () => undefined,
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/throwing-endpoint-token'),
    );
    expect(response.status).toBe(500);
    events.emit('ready');

    expect(listenerError).toBeInstanceOf(Error);
    expect((listenerError as Error).message).toMatch(/after response headers were committed/u);
  });

  it('overrides a public raw response after a helper emits authority for its existing cookie', async () => {
    let sawCookie: string | null = null;
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/csrf-bootstrap', {
        auth: { kind: 'custom', name: 'framework-csrf-bootstrap' },
        handler(request) {
          sawCookie = request.headers.get('cookie');
          const minted = mintCsrfField(request, {
            ...csrf,
            audience: 'endpoint:/csrf-bootstrap-submit',
          });
          if (minted.setCookie !== undefined) {
            throw new Error('preexisting anonymous binding unexpectedly rotated');
          }
          return new Response(`<form>${minted.html}</form>`, {
            headers: {
              'Cache-Control': 'public, max-age=60',
              'Content-Type': 'text/html; charset=utf-8',
            },
          });
        },
        method: 'GET',
        reason: 'framework-owned browser CSRF bootstrap adapter',
        response: publicHtmlResponse,
      }),
    );
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const attacker = await handler(
      new Request('https://shop.example.test/csrf-bootstrap', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );
    const attackerHtml = await attacker.text();
    const victim = await handler(
      new Request('https://shop.example.test/csrf-bootstrap', {
        headers: { Cookie: cookieHeader('B'.repeat(43)) },
      }),
    );
    const victimHtml = await victim.text();

    expect(sawCookie).toBe(cookieHeader('B'.repeat(43)));
    expect(hiddenValue(attackerHtml, 'kovo-csrf')).not.toBe(hiddenValue(victimHtml, 'kovo-csrf'));
    expect(attacker.headers.get('cache-control')).toBe('private, no-store');
    expect(attacker.headers.get('vary')).toContain('Cookie');
  });

  it('does the same for mintCsrfToken JSON output from the exact endpoint request', async () => {
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/csrf-token-bootstrap', {
        auth: { kind: 'custom', name: 'framework-csrf-token-bootstrap' },
        handler(request) {
          // Passing the exact supported endpoint request is load-bearing: finalization consumes the
          // module-private identity witness set by this helper, not app-visible Cookie text.
          const minted = mintCsrfToken(request, csrf, {
            audience: 'endpoint:/csrf-token-bootstrap-submit',
          });
          if (minted.setCookie !== undefined) {
            throw new Error('preexisting anonymous binding unexpectedly rotated');
          }
          return Response.json(
            { token: minted.token },
            { headers: { 'Cache-Control': 'public, max-age=60' } },
          );
        },
        method: 'GET',
        reason: 'framework-owned browser CSRF token bootstrap adapter',
        response: publicJsonResponse,
      }),
    );
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const attacker = await handler(
      new Request('https://shop.example.test/csrf-token-bootstrap', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );
    const attackerToken = (await attacker.json()) as { token: string };
    const victim = await handler(
      new Request('https://shop.example.test/csrf-token-bootstrap', {
        headers: { Cookie: cookieHeader('B'.repeat(43)) },
      }),
    );
    const victimToken = (await victim.json()) as { token: string };

    expect(attackerToken.token).not.toBe(victimToken.token);
    expect(attacker.headers.get('cache-control')).toBe('private, no-store');
    expect(attacker.headers.get('vary')).toContain('Cookie');
  });

  it('allows an async raw handler to mint before returning and attach the binding cookie', async () => {
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/async-csrf-token-bootstrap', {
        auth: { kind: 'custom', name: 'framework-async-csrf-token-bootstrap' },
        async handler(request) {
          await Promise.resolve();
          const minted = mintCsrfToken(request, csrf, {
            audience: 'endpoint:/async-csrf-token-bootstrap-submit',
          });
          if (minted.setCookie === undefined) {
            throw new Error('first anonymous async mint did not return its binding cookie');
          }
          return Response.json(
            { token: minted.token },
            {
              headers: {
                'Cache-Control': 'public, max-age=60',
                'Set-Cookie': minted.setCookie,
              },
            },
          );
        },
        method: 'GET',
        reason: 'framework-owned async browser CSRF bootstrap adapter',
        response: publicJsonResponse,
      }),
    );
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/async-csrf-token-bootstrap'),
    );

    expect(response.headers.get('set-cookie')).toContain('kovo_csrf=');
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    await expect(response.json()).resolves.toHaveProperty('token');
  });

  it('allows ReadableStream.start() to mint while the handler can attach its cookie', async () => {
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/start-csrf-token-bootstrap', {
        auth: { kind: 'custom', name: 'framework-start-csrf-token-bootstrap' },
        handler(request) {
          let setCookie: string | undefined;
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              const minted = mintCsrfToken(request, csrf, {
                audience: 'endpoint:/start-csrf-token-bootstrap-submit',
              });
              setCookie = minted.setCookie;
              controller.enqueue(new TextEncoder().encode(minted.token));
              controller.close();
            },
          });
          if (setCookie === undefined) {
            throw new Error('first anonymous stream start did not return its binding cookie');
          }
          return new Response(body, {
            headers: {
              'Cache-Control': 'public, max-age=60',
              'Content-Type': 'text/plain',
              'Set-Cookie': setCookie,
            },
          });
        },
        method: 'GET',
        reason: 'framework-owned synchronous stream browser CSRF bootstrap adapter',
        response: {
          appOwnedSafety: true,
          body: 'stream',
          cache: 'public',
        },
      }),
    );
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/start-csrf-token-bootstrap'),
    );

    expect(response.headers.get('set-cookie')).toContain('kovo_csrf=');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    await expect(response.text()).resolves.not.toBe('');
  });

  it('auto-delivers a first-anonymous cookie from a verified safe endpoint stream pull', async () => {
    const audience = 'endpoint:/immediate-raw-token-bootstrap-submit';
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/immediate-raw-token-bootstrap', {
        auth: { kind: 'custom', name: 'framework-immediate-raw-token-bootstrap' },
        handler(request) {
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                const token = mintCsrfToken(request, csrf, { audience }).token;
                controller.enqueue(new TextEncoder().encode(token));
                controller.close();
              },
            }),
            {
              headers: {
                'Cache-Control': 'public, max-age=60',
                'Content-Type': 'text/plain',
              },
              status: 201,
              statusText: 'CSRF Ready',
            },
          );
        },
        method: 'GET',
        reason: 'verified framework-owned CSRF bootstrap stream',
        response: {
          appOwnedSafety: true,
          body: 'stream',
          cache: 'public',
        },
      }),
    );
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/immediate-raw-token-bootstrap'),
    );
    const token = await response.text();
    const setCookies = response.headers.getSetCookie();
    expect(response.status).toBe(201);
    expect(response.statusText).toBe('CSRF Ready');
    expect(setCookies).toHaveLength(1);
    const cookie = setCookies[0]!.split(';', 1)[0]!;
    expect(
      validateCsrfToken(
        { 'kovo-csrf': token },
        new Request('https://shop.example.test/_m/immediate-raw-token-bootstrap-submit', {
          headers: { cookie, origin: 'https://shop.example.test' },
          method: 'POST',
        }),
        csrf,
        { audience },
      ),
    ).toBe(true);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('captures a queued raw token header and delivers its matching cookie', async () => {
    const audience = 'endpoint:/microtask-raw-token-bootstrap-submit';
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/microtask-raw-token-bootstrap', {
        auth: { kind: 'custom', name: 'framework-microtask-raw-token-bootstrap' },
        handler(request) {
          const response = new Response('ready', {
            headers: {
              'Cache-Control': 'public, max-age=60',
              'Content-Type': 'text/plain',
            },
          });
          queueMicrotask(() => {
            const token = mintCsrfToken(request, csrf, { audience }).token;
            response.headers.set('X-CSRF-Token', token);
          });
          return response;
        },
        method: 'GET',
        reason: 'verified framework-owned queued CSRF bootstrap',
        response: {
          appOwnedSafety: true,
          body: 'text',
          cache: 'public',
        },
      }),
    );
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/microtask-raw-token-bootstrap'),
    );
    const token = response.headers.get('x-csrf-token');
    const setCookies = response.headers.getSetCookie();
    expect(token).not.toBeNull();
    expect(setCookies).toHaveLength(1);
    const cookie = setCookies[0]!.split(';', 1)[0]!;
    expect(
      validateCsrfToken(
        { 'kovo-csrf': token! },
        new Request('https://shop.example.test/_m/microtask-raw-token-bootstrap-submit', {
          headers: { cookie, origin: 'https://shop.example.test' },
          method: 'POST',
        }),
        csrf,
        { audience },
      ),
    ).toBe(true);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('keeps app-authored browser state forbidden on an unverified safe endpoint', async () => {
    const bootstrap = endpoint('/authored-safe-cookie', {
      auth: { kind: 'none', justification: 'public endpoint has no browser-state verifier' },
      handler: () =>
        new Response('unsafe', {
          headers: { 'Set-Cookie': 'kovo_csrf=authored; Path=/' },
        }),
      method: 'GET',
      reason: 'negative safe endpoint browser-state fixture',
      response: {
        appOwnedSafety: true,
        body: 'text',
        cache: 'custom',
        reservedHeaders: ['Set-Cookie'],
      },
    });
    const handler = createRequestHandler(
      createApp({ endpoints: [bootstrap], onError: () => undefined }),
    );

    const response = await handler(new Request('https://shop.example.test/authored-safe-cookie'));

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a captured CSRF cookie from an unverified safe endpoint', async () => {
    const bootstrap = endpoint('/unverified-safe-csrf-bootstrap', {
      auth: { kind: 'none', justification: 'negative public endpoint fixture' },
      handler(request) {
        return new Response(
          mintCsrfToken(request, csrf, {
            audience: 'endpoint:/unverified-safe-csrf-bootstrap-submit',
          }).token,
        );
      },
      method: 'GET',
      reason: 'negative safe-method browser-state fixture',
      response: {
        appOwnedSafety: true,
        body: 'text',
        cache: 'custom',
      },
    });
    const handler = createRequestHandler(
      createApp({ endpoints: [bootstrap], onError: () => undefined }),
    );

    const response = await handler(
      new Request('https://shop.example.test/unverified-safe-csrf-bootstrap'),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a captured CSRF cookie from an unverified csrf:false unsafe endpoint', async () => {
    const bootstrap = endpoint('/unsafe-exempt-csrf-bootstrap', {
      auth: { kind: 'none', justification: 'negative machine endpoint fixture' },
      csrf: false,
      csrfJustification: 'negative fixture exercises the browser-state proof gate',
      handler(request) {
        return new Response(
          mintCsrfToken(request, csrf, {
            audience: 'endpoint:/unsafe-exempt-csrf-bootstrap-submit',
          }).token,
        );
      },
      method: 'POST',
      reason: 'negative csrf-exempt browser-state fixture',
      response: {
        appOwnedSafety: true,
        body: 'text',
        cache: 'custom',
      },
    });
    const handler = createRequestHandler(
      createApp({ endpoints: [bootstrap], onError: () => undefined }),
    );

    const response = await handler(
      new Request('https://shop.example.test/unsafe-exempt-csrf-bootstrap', { method: 'POST' }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('allows a captured CSRF cookie on a privately self-verifying csrf:false endpoint', async () => {
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/verified-unsafe-exempt-csrf-bootstrap', {
        auth: { kind: 'custom', name: 'framework-verified-csrf-bootstrap' },
        csrf: false,
        csrfJustification: 'framework adapter performs its private verification',
        handler(request) {
          return new Response(
            mintCsrfToken(request, csrf, {
              audience: 'endpoint:/verified-unsafe-exempt-csrf-bootstrap-submit',
            }).token,
            { headers: { 'Cache-Control': 'public, max-age=60' } },
          );
        },
        method: 'POST',
        reason: 'framework-owned verified CSRF bootstrap adapter',
        response: {
          appOwnedSafety: true,
          body: 'text',
          cache: 'public',
        },
      }),
    );
    const handler = createRequestHandler(createApp({ endpoints: [bootstrap] }));

    const response = await handler(
      new Request('https://shop.example.test/verified-unsafe-exempt-csrf-bootstrap', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('keeps a nested route dispatch isolated from its ambient outer endpoint lifecycle', async () => {
    const innerAudience = 'endpoint:/nested-inner-submit';
    const innerRoute = route('/nested-inner', {
      page(_context, request) {
        return respond.stream(mintCsrfToken(request, csrf, { audience: innerAudience }).token, {
          contentType: 'text/plain',
        });
      },
    });
    const innerHandler = createRequestHandler(
      createApp({
        egress: {
          enabled: false,
          justification: 'nested dispatch fixture performs no outbound I/O',
        },
        routes: [innerRoute],
      }),
    );
    const outerAudience = 'endpoint:/nested-outer-submit';
    const outerEndpoint = pinEndpointBrowserCredentialDelegation(
      endpoint('/nested-outer', {
        auth: { kind: 'custom', name: 'framework-nested-outer' },
        async handler(request) {
          const innerResponse = await innerHandler(
            new Request('https://shop.example.test/nested-inner', {
              headers: { Cookie: cookieHeader('B'.repeat(43)) },
            }),
          );
          const innerToken = await innerResponse.text();
          const outerToken = mintCsrfToken(request, csrf, { audience: outerAudience }).token;
          return Response.json(
            {
              innerCacheControl: innerResponse.headers.get('cache-control'),
              innerSetCookie: innerResponse.headers.get('set-cookie'),
              innerToken,
              innerVary: innerResponse.headers.get('vary'),
              outerToken,
            },
            { headers: { 'Cache-Control': 'public, max-age=60' } },
          );
        },
        method: 'GET',
        reason: 'framework-owned nested response lifecycle fixture',
        response: publicJsonResponse,
      }),
    );
    const outerHandler = createRequestHandler(
      createApp({
        egress: {
          enabled: false,
          justification: 'nested dispatch fixture performs no outbound I/O',
        },
        endpoints: [outerEndpoint],
      }),
    );

    const response = await outerHandler(new Request('https://shop.example.test/nested-outer'));
    const body = (await response.json()) as {
      innerCacheControl: string | null;
      innerSetCookie: string | null;
      innerToken: string;
      innerVary: string | null;
      outerToken: string;
    };
    expect(body.innerCacheControl).toBe('private, no-store');
    expect(body.innerVary).toContain('Cookie');
    expect(body.innerSetCookie).toBeNull();
    expect(
      validateCsrfToken(
        { 'kovo-csrf': body.innerToken },
        new Request('https://shop.example.test/_m/nested-inner-submit', {
          headers: {
            Cookie: cookieHeader('B'.repeat(43)),
            Origin: 'https://shop.example.test',
          },
          method: 'POST',
        }),
        csrf,
        { audience: innerAudience },
      ),
    ).toBe(true);
    const outerSetCookies = response.headers.getSetCookie();
    expect(outerSetCookies).toHaveLength(1);
    const outerCookie = outerSetCookies[0]!.split(';', 1)[0]!;
    expect(
      validateCsrfToken(
        { 'kovo-csrf': body.outerToken },
        new Request('https://shop.example.test/_m/nested-outer-submit', {
          headers: { Cookie: outerCookie, Origin: 'https://shop.example.test' },
          method: 'POST',
        }),
        csrf,
        { audience: outerAudience },
      ),
    ).toBe(true);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('keeps nested endpoint early returns from sealing their ambient outer lifecycle', async () => {
    const authDenied = endpoint('/nested-early-auth', {
      auth: {
        kind: 'custom',
        name: 'nested-early-auth-deny',
        verify: customVerifier('nested-early-auth-deny', () => false),
      },
      handler: () => new Response('unreachable'),
      method: 'GET',
      reason: 'nested early-auth lifecycle isolation fixture',
      response: publicHtmlResponse,
    });
    const csrfDenied = endpoint('/nested-early-csrf', {
      handler: () => new Response('unreachable'),
      method: 'POST',
      reason: 'nested early-CSRF lifecycle isolation fixture',
      response: publicHtmlResponse,
    });
    const accessDenied = endpoint('/nested-early-access', {
      access: [guard('nested-early-access-deny', () => ({ kind: 'forbidden' as const }))],
      handler: () => new Response('unreachable'),
      method: 'GET',
      reason: 'nested early-access lifecycle isolation fixture',
      response: publicHtmlResponse,
    });
    const methodControl = endpoint('/nested-early-method', {
      handler: () => new Response('unreachable'),
      method: 'GET',
      reason: 'nested method-rejection lifecycle isolation control',
      response: publicHtmlResponse,
    });
    let nestedHandler!: ReturnType<typeof createRequestHandler>;
    const outerAudience = 'endpoint:/nested-early-outer-submit';
    const outer = pinEndpointBrowserCredentialDelegation(
      endpoint('/nested-early-outer', {
        auth: { kind: 'custom', name: 'framework-nested-early-outer' },
        async handler(request) {
          const statuses = await Promise.all([
            nestedHandler(new Request('https://shop.example.test/nested-early-auth')),
            nestedHandler(
              new Request('https://shop.example.test/nested-early-csrf', { method: 'POST' }),
            ),
            nestedHandler(new Request('https://shop.example.test/nested-early-access')),
            nestedHandler(
              new Request('https://shop.example.test/nested-early-method', { method: 'POST' }),
            ),
          ]).then((responses) => responses.map((response) => response.status));
          const token = mintCsrfToken(request, csrf, { audience: outerAudience }).token;
          return Response.json({ statuses, token });
        },
        method: 'GET',
        reason: 'framework-owned nested early-return lifecycle fixture',
        response: publicJsonResponse,
      }),
    );
    nestedHandler = createRequestHandler(
      createApp({
        csrf,
        egress: {
          enabled: false,
          justification: 'nested early-return fixture performs no outbound I/O',
        },
        endpoints: [authDenied, csrfDenied, accessDenied, methodControl, outer],
      }),
    );

    const response = await nestedHandler(
      new Request('https://shop.example.test/nested-early-outer'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { statuses: number[]; token: string };
    expect(body.statuses).toEqual([401, 422, 403, 405]);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    expect(
      validateCsrfToken(
        { 'kovo-csrf': body.token },
        new Request('https://shop.example.test/_m/nested-early-outer-submit', {
          headers: {
            Cookie: setCookies[0]!.split(';', 1)[0]!,
            Origin: 'https://shop.example.test',
          },
          method: 'POST',
        }),
        csrf,
        { audience: outerAudience },
      ),
    ).toBe(true);
  });

  it('clears ambient response authority before a new-Request nested dispatch runs preflight', async () => {
    let preflightError: unknown;
    const innerRoute = route('/nested-preflight-isolation', {
      page: () => <p>inner</p>,
    });
    const innerHandler = createRequestHandler(
      createApp({
        egress: {
          enabled: false,
          justification: 'nested preflight isolation fixture performs no outbound I/O',
        },
        routes: [innerRoute],
        sessionProvider(request) {
          try {
            mintCsrfToken(request, csrf, { audience: 'endpoint:/nested-preflight-inner' });
          } catch (error) {
            preflightError = error;
          }
          return null;
        },
      }),
    );
    const audience = 'endpoint:/nested-preflight-outer-submit';
    const outerEndpoint = endpoint('/nested-preflight-outer', {
      auth: {
        kind: 'custom',
        name: 'nested-preflight-outer-allow',
        verify: customVerifier('nested-preflight-outer-allow', () => true),
      },
      async handler(request) {
        const innerResponse = await innerHandler(
          new Request('https://shop.example.test/nested-preflight-isolation'),
        );
        const token = mintCsrfToken(request, csrf, { audience }).token;
        return Response.json({ innerStatus: innerResponse.status, token });
      },
      method: 'GET',
      reason: 'nested preflight outer lifecycle isolation fixture',
      response: publicJsonResponse,
    });
    const outerHandler = createRequestHandler(
      createApp({
        csrf,
        egress: {
          enabled: false,
          justification: 'nested preflight outer fixture performs no outbound I/O',
        },
        endpoints: [outerEndpoint],
      }),
    );

    const response = await outerHandler(
      new Request('https://shop.example.test/nested-preflight-outer'),
    );
    await expect(response.json()).resolves.toMatchObject({ innerStatus: 200 });
    expect(preflightError).toBeInstanceOf(Error);
    expect((preflightError as Error).message).toMatch(/without a framework response lifecycle/u);
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it('isolates a successful nested endpoint dispatch that reuses the exact handler Request', async () => {
    let outerRequest: Request | undefined;
    let innerRequest: Request | undefined;
    const innerEndpoint = endpoint('/nested-same-success', {
      auth: { kind: 'none', justification: 'nested same-request success control' },
      handler(request) {
        innerRequest = request;
        return Response.json({ inner: true });
      },
      method: 'GET',
      reason: 'nested same-request success lifecycle isolation fixture',
      response: publicJsonResponse,
    });
    const innerHandler = createRequestHandler(
      createApp({
        egress: {
          enabled: false,
          justification: 'nested same-request success fixture performs no outbound I/O',
        },
        endpoints: [innerEndpoint],
      }),
    );
    const audience = 'endpoint:/nested-same-success-submit';
    const outerEndpoint = endpoint('/nested-same-success', {
      auth: {
        kind: 'custom',
        name: 'nested-same-success-allow',
        verify: customVerifier('nested-same-success-allow', () => true),
      },
      async handler(request) {
        outerRequest = request;
        const innerResponse = await innerHandler(request);
        const token = mintCsrfToken(request, csrf, { audience }).token;
        return Response.json({ innerStatus: innerResponse.status, token });
      },
      method: 'GET',
      reason: 'nested same-request outer success lifecycle fixture',
      response: publicJsonResponse,
    });
    const outerHandler = createRequestHandler(
      createApp({
        csrf,
        egress: {
          enabled: false,
          justification: 'nested same-request outer fixture performs no outbound I/O',
        },
        endpoints: [outerEndpoint],
      }),
    );

    const response = await outerHandler(
      new Request('https://shop.example.test/nested-same-success'),
    );
    const body = (await response.json()) as { innerStatus: number; token: string };
    expect(body.innerStatus).toBe(200);
    expect(innerRequest).not.toBe(outerRequest);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(1);
    expect(
      validateCsrfToken(
        { 'kovo-csrf': body.token },
        new Request('https://shop.example.test/_m/nested-same-success-submit', {
          headers: {
            cookie: setCookies[0]!.split(';', 1)[0]!,
            origin: 'https://shop.example.test',
          },
          method: 'POST',
        }),
        csrf,
        { audience },
      ),
    ).toBe(true);
  });

  it('preserves body bytes and abort propagation when rekeying a same-request nested dispatch', async () => {
    let markInnerEntered!: () => void;
    const innerEntered = new Promise<void>((resolve) => {
      markInnerEntered = resolve;
    });
    let releaseInner!: () => void;
    const innerGate = new Promise<void>((resolve) => {
      releaseInner = resolve;
    });
    const innerEndpoint = endpoint('/nested-same-body', {
      auth: { kind: 'none', justification: 'nested body/abort isolation control' },
      csrf: false,
      csrfJustification: 'nested fixture reads a machine JSON carrier',
      async handler(request) {
        markInnerEntered();
        await innerGate;
        return Response.json({
          aborted: request.signal.aborted,
          body: await request.text(),
        });
      },
      method: 'POST',
      reason: 'nested same-request body and abort lifecycle fixture',
      response: publicJsonResponse,
    });
    const innerHandler = createRequestHandler(
      createApp({
        egress: {
          enabled: false,
          justification: 'nested same-request body fixture performs no outbound I/O',
        },
        endpoints: [innerEndpoint],
      }),
    );
    const controller = new AbortController();
    const outerEndpoint = endpoint('/nested-same-body', {
      auth: {
        kind: 'custom',
        name: 'nested-same-body-allow',
        verify: customVerifier('nested-same-body-allow', () => true),
      },
      csrf: false,
      csrfJustification: 'outer fixture delegates a verified machine JSON carrier',
      async handler(request) {
        const innerResponsePromise = innerHandler(request);
        await innerEntered;
        controller.abort();
        releaseInner();
        const innerResponse = await innerResponsePromise;
        const innerBody = (await innerResponse.json()) as { aborted: boolean; body: string };
        const token = mintCsrfToken(request, csrf, {
          audience: 'endpoint:/nested-same-body-submit',
        }).token;
        return Response.json({ innerBody, innerStatus: innerResponse.status, token });
      },
      method: 'POST',
      reason: 'nested same-request outer body and abort fixture',
      response: publicJsonResponse,
    });
    const outerHandler = createRequestHandler(
      createApp({
        csrf,
        egress: {
          enabled: false,
          justification: 'nested same-request outer body fixture performs no outbound I/O',
        },
        endpoints: [outerEndpoint],
      }),
    );

    const response = await outerHandler(
      new Request('https://shop.example.test/nested-same-body', {
        body: '{"scope":"exact"}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: controller.signal,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      innerBody: { aborted: true, body: '{"scope":"exact"}' },
      innerStatus: 200,
    });
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it('keeps same-request nested auth denial from sealing the outer lifecycle', async () => {
    const denied = endpoint('/nested-same-auth', {
      auth: {
        kind: 'custom',
        name: 'nested-same-auth-deny',
        verify: customVerifier('nested-same-auth-deny', () => false),
      },
      handler: () => new Response('unreachable'),
      method: 'GET',
      reason: 'nested same-request auth-denial lifecycle fixture',
      response: publicHtmlResponse,
    });
    const innerHandler = createRequestHandler(
      createApp({
        egress: {
          enabled: false,
          justification: 'nested same-request auth fixture performs no outbound I/O',
        },
        endpoints: [denied],
      }),
    );
    const outerEndpoint = endpoint('/nested-same-auth', {
      auth: {
        kind: 'custom',
        name: 'nested-same-auth-allow',
        verify: customVerifier('nested-same-auth-allow', () => true),
      },
      async handler(request) {
        const innerResponse = await innerHandler(request);
        const token = mintCsrfToken(request, csrf, {
          audience: 'endpoint:/nested-same-auth-submit',
        }).token;
        return Response.json({ innerStatus: innerResponse.status, token });
      },
      method: 'GET',
      reason: 'nested same-request outer auth fixture',
      response: publicJsonResponse,
    });
    const outerHandler = createRequestHandler(
      createApp({
        csrf,
        egress: {
          enabled: false,
          justification: 'nested same-request outer auth fixture performs no outbound I/O',
        },
        endpoints: [outerEndpoint],
      }),
    );

    const response = await outerHandler(new Request('https://shop.example.test/nested-same-auth'));
    await expect(response.json()).resolves.toMatchObject({ innerStatus: 401 });
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it('keeps same-request nested access denial from sealing the outer lifecycle', async () => {
    const denied = endpoint('/nested-same-access', {
      access: [guard('nested-same-access-deny', () => ({ kind: 'forbidden' as const }))],
      auth: { kind: 'none', justification: 'nested same-request access-denial control' },
      handler: () => new Response('unreachable'),
      method: 'GET',
      reason: 'nested same-request access-denial lifecycle fixture',
      response: publicHtmlResponse,
    });
    const innerHandler = createRequestHandler(
      createApp({
        egress: {
          enabled: false,
          justification: 'nested same-request access fixture performs no outbound I/O',
        },
        endpoints: [denied],
      }),
    );
    const outerEndpoint = endpoint('/nested-same-access', {
      auth: {
        kind: 'custom',
        name: 'nested-same-access-allow',
        verify: customVerifier('nested-same-access-allow', () => true),
      },
      async handler(request) {
        const innerResponse = await innerHandler(request);
        const token = mintCsrfToken(request, csrf, {
          audience: 'endpoint:/nested-same-access-submit',
        }).token;
        return Response.json({ innerStatus: innerResponse.status, token });
      },
      method: 'GET',
      reason: 'nested same-request outer access fixture',
      response: publicJsonResponse,
    });
    const outerHandler = createRequestHandler(
      createApp({
        csrf,
        egress: {
          enabled: false,
          justification: 'nested same-request outer access fixture performs no outbound I/O',
        },
        endpoints: [outerEndpoint],
      }),
    );

    const response = await outerHandler(
      new Request('https://shop.example.test/nested-same-access'),
    );
    await expect(response.json()).resolves.toMatchObject({ innerStatus: 403 });
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it('keeps same-request nested CSRF denial from sealing the outer lifecycle', async () => {
    const denied = endpoint('/nested-same-csrf', {
      auth: { kind: 'none', justification: 'nested same-request CSRF-denial control' },
      handler: () => new Response('unreachable'),
      method: 'POST',
      reason: 'nested same-request CSRF-denial lifecycle fixture',
      response: publicHtmlResponse,
    });
    const innerHandler = createRequestHandler(
      createApp({
        csrf,
        egress: {
          enabled: false,
          justification: 'nested same-request CSRF fixture performs no outbound I/O',
        },
        endpoints: [denied],
      }),
    );
    const outerEndpoint = endpoint('/nested-same-csrf', {
      auth: {
        kind: 'custom',
        name: 'nested-same-csrf-allow',
        verify: customVerifier('nested-same-csrf-allow', () => true),
      },
      csrf: false,
      csrfJustification: 'outer fixture delegates the inner default-CSRF denial',
      async handler(request) {
        const innerResponse = await innerHandler(request);
        const token = mintCsrfToken(request, csrf, {
          audience: 'endpoint:/nested-same-csrf-submit',
        }).token;
        return Response.json({ innerStatus: innerResponse.status, token });
      },
      method: 'POST',
      reason: 'nested same-request outer CSRF fixture',
      response: publicJsonResponse,
    });
    const outerHandler = createRequestHandler(
      createApp({
        csrf,
        egress: {
          enabled: false,
          justification: 'nested same-request outer CSRF fixture performs no outbound I/O',
        },
        endpoints: [outerEndpoint],
      }),
    );

    const response = await outerHandler(
      new Request('https://shop.example.test/nested-same-csrf', { method: 'POST' }),
    );
    await expect(response.json()).resolves.toMatchObject({ innerStatus: 422 });
    expect(response.headers.getSetCookie()).toHaveLength(1);
  });

  it('rejects an authored plain-name alias of a captured prefixed CSRF cookie', async () => {
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/conflicting-csrf-cookie-alias', {
        auth: { kind: 'custom', name: 'framework-conflicting-csrf-cookie-alias' },
        handler(request) {
          const token = mintCsrfToken(request, csrf, {
            audience: 'endpoint:/conflicting-csrf-cookie-alias-submit',
          }).token;
          return new Response(token, {
            headers: { 'Set-Cookie': `kovo_csrf=${'A'.repeat(43)}; Path=/` },
          });
        },
        method: 'GET',
        reason: 'negative CSRF cookie alias collision fixture',
        response: {
          appOwnedSafety: true,
          body: 'text',
          cache: 'custom',
          reservedHeaders: ['Set-Cookie'],
        },
      }),
    );
    const handler = createRequestHandler(
      createApp({ endpoints: [bootstrap], onError: () => undefined }),
    );

    const response = await handler(
      new Request('https://shop.example.test/conflicting-csrf-cookie-alias'),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('delivers two distinct standalone CSRF cookie namespaces without collapsing either', async () => {
    const firstAudience = 'endpoint:/two-csrf-cookie-names-first';
    const secondAudience = 'endpoint:/two-csrf-cookie-names-second';
    const firstCsrf = { ...csrf, anonymousCookie: { name: 'first_csrf' } };
    const secondCsrf = { ...csrf, anonymousCookie: { name: 'second_csrf' } };
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/two-csrf-cookie-names', {
        auth: { kind: 'custom', name: 'framework-two-csrf-cookie-names' },
        handler(request) {
          return Response.json(
            {
              first: mintCsrfToken(request, firstCsrf, { audience: firstAudience }).token,
              second: mintCsrfToken(request, secondCsrf, { audience: secondAudience }).token,
            },
            { headers: { 'Cache-Control': 'public, max-age=60' } },
          );
        },
        method: 'GET',
        reason: 'framework-owned multiple CSRF namespace fixture',
        response: publicJsonResponse,
      }),
    );
    const handler = createRequestHandler(createApp({ endpoints: [bootstrap] }));

    const response = await handler(new Request('https://shop.example.test/two-csrf-cookie-names'));
    const body = (await response.json()) as { first: string; second: string };
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    const cookies = setCookies.map((setCookie) => setCookie.split(';', 1)[0]!).join('; ');
    const submit = new Request('https://shop.example.test/_m/two-csrf-cookie-names', {
      headers: { cookie: cookies, origin: 'https://shop.example.test' },
      method: 'POST',
    });
    expect(
      validateCsrfToken({ 'kovo-csrf': body.first }, submit, firstCsrf, {
        audience: firstAudience,
      }),
    ).toBe(true);
    expect(
      validateCsrfToken({ 'kovo-csrf': body.second }, submit, secondCsrf, {
        audience: secondAudience,
      }),
    ).toBe(true);
  });

  it('injects captured CSRF cookies by reconstructing an immutable raw Response', async () => {
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/immutable-csrf-response', {
        auth: { kind: 'custom', name: 'framework-immutable-csrf-response' },
        handler(request) {
          mintCsrfToken(request, csrf, { audience: 'endpoint:/immutable-csrf-response-submit' });
          return Response.redirect('https://shop.example.test/next', 302);
        },
        method: 'GET',
        reason: 'framework-owned immutable response CSRF fixture',
        response: {
          appOwnedSafety: true,
          body: 'redirect',
          cache: 'custom',
          reservedHeaders: ['Location'],
        },
      }),
    );
    const handler = createRequestHandler(createApp({ endpoints: [bootstrap] }));

    const response = await handler(
      new Request('https://shop.example.test/immutable-csrf-response'),
    );

    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('shares standalone binding and posture state with the native endpoint clone', async () => {
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/cloned-csrf-token-bootstrap', {
        auth: { kind: 'custom', name: 'framework-cloned-csrf-token-bootstrap' },
        handler(request) {
          const clone = request.clone().clone();
          const first = mintCsrfToken(request, csrf, {
            audience: 'endpoint:/cloned-csrf-token-bootstrap-first',
          });
          const second = mintCsrfToken(clone, csrf, {
            audience: 'endpoint:/cloned-csrf-token-bootstrap-second',
          });
          let conflictRejected = false;
          try {
            mintCsrfToken(
              clone,
              { ...csrf, anonymousCookie: { path: '/auth' } },
              { audience: 'endpoint:/cloned-csrf-token-bootstrap-conflict' },
            );
          } catch (error) {
            if (
              error instanceof TypeError &&
              /conflicting browser attribute postures/u.test(error.message)
            ) {
              conflictRejected = true;
            } else {
              throw error;
            }
          }
          if (first.setCookie === undefined) {
            throw new Error('first cloned endpoint mint did not return its binding cookie');
          }
          return Response.json(
            { conflictRejected, sameCookie: first.setCookie === second.setCookie },
            { headers: { 'Set-Cookie': first.setCookie } },
          );
        },
        method: 'GET',
        reason: 'framework-owned cloned browser CSRF bootstrap adapter',
        response: {
          appOwnedSafety: true,
          body: 'json',
          cache: 'private',
        },
      }),
    );
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/cloned-csrf-token-bootstrap'),
    );

    await expect(response.json()).resolves.toEqual({
      conflictRejected: true,
      sameCookie: true,
    });
    expect(response.headers.get('set-cookie')).toContain('kovo_csrf=');
  });

  it('selects the private posture before a delegated raw stream can mint from pull()', async () => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/late-csrf-token-bootstrap', {
        auth: { kind: 'custom', name: 'framework-late-csrf-token-bootstrap' },
        handler(request) {
          return new Response(
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                await streamGate;
                const token = mintCsrfToken(request, csrf, {
                  audience: 'endpoint:/late-csrf-token-bootstrap-submit',
                }).token;
                controller.enqueue(new TextEncoder().encode(token));
                controller.close();
              },
            }),
            {
              headers: {
                'Cache-Control': 'public, max-age=60',
                'Content-Type': 'text/plain',
              },
            },
          );
        },
        method: 'GET',
        reason: 'framework-owned lazy browser CSRF bootstrap adapter',
        response: {
          appOwnedSafety: true,
          body: 'stream',
          cache: 'public',
        },
      }),
    );
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/late-csrf-token-bootstrap', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    releaseStream();
    await expect(response.text()).resolves.not.toBe('');
  });

  it('fails closed when a raw stream reconstructed request first mints after headers commit', async () => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const bootstrap = pinEndpointBrowserCredentialDelegation(
      endpoint('/late-first-anonymous-csrf-token-bootstrap', {
        auth: { kind: 'custom', name: 'framework-late-first-anonymous-csrf-token-bootstrap' },
        handler(request) {
          const lazyRequest = new Request(request.url, { headers: request.headers });
          return new Response(
            new ReadableStream<Uint8Array>({
              async pull(controller) {
                await streamGate;
                const token = mintCsrfToken(lazyRequest, csrf, {
                  audience: 'endpoint:/late-first-anonymous-csrf-token-bootstrap-submit',
                }).token;
                controller.enqueue(new TextEncoder().encode(token));
                controller.close();
              },
            }),
            { headers: { 'Content-Type': 'text/plain' } },
          );
        },
        method: 'GET',
        reason: 'framework-owned lazy first-anonymous CSRF bootstrap adapter',
        response: {
          appOwnedSafety: true,
          body: 'stream',
          cache: 'private',
        },
      }),
    );
    const handler = createRequestHandler(
      createApp({
        csrf,
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [bootstrap],
      }),
    );

    const response = await handler(
      new Request('https://shop.example.test/late-first-anonymous-csrf-token-bootstrap'),
    );
    releaseStream();

    await expect(response.text()).rejects.toThrow(/after response headers were committed/u);
  });

  it('keeps an unrelated delegated raw response private because it can still vary by Cookie', async () => {
    const publicEndpoint = pinEndpointBrowserCredentialDelegation(
      endpoint('/public-bootstrap-metadata', {
        auth: { kind: 'custom', name: 'framework-public-bootstrap-metadata' },
        handler: () =>
          new Response('<p>Public metadata</p>', {
            headers: {
              'Cache-Control': 'public, max-age=60',
              'Content-Type': 'text/html; charset=utf-8',
            },
          }),
        method: 'GET',
        reason: 'framework-owned public metadata adapter control',
        response: publicHtmlResponse,
      }),
    );
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [publicEndpoint],
      }),
    );
    const response = await handler(
      new Request('https://shop.example.test/public-bootstrap-metadata', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
  });

  it('leaves a credential-neutral public raw response cacheable', async () => {
    const publicEndpoint = endpoint('/neutral-public-metadata', {
      auth: { kind: 'none', justification: 'public cache metadata has no browser authority' },
      handler: () =>
        new Response('<p>Public metadata</p>', {
          headers: {
            'Cache-Control': 'public, max-age=60',
            'Content-Type': 'text/html; charset=utf-8',
          },
        }),
      method: 'GET',
      reason: 'credential-neutral public metadata control',
      response: publicHtmlResponse,
    });
    const handler = createRequestHandler(
      createApp({
        egress: { enabled: false, justification: 'cache control fixture performs no outbound I/O' },
        endpoints: [publicEndpoint],
      }),
    );
    const response = await handler(
      new Request('https://shop.example.test/neutral-public-metadata', {
        headers: { Cookie: cookieHeader('A'.repeat(43)) },
      }),
    );

    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('vary')).toBeNull();
  });

  it('keeps the query channel read-only and unable to mint CSRF browser authority', async () => {
    const handler = createRequestHandler(
      createApp({
        csrf,
        queries: [query('public-metadata', { load: () => ({ ok: true }), reads: [] })],
      }),
    );

    const response = await handler(new Request('https://shop.example.test/_q/public-metadata'));

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(response.text()).resolves.toContain('{"ok":true}');
  });
});
