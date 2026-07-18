/** @jsxImportSource @kovojs/server */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { mintCsrfField, mintCsrfToken } from './csrf.js';
import { Defer } from './deferred-region.js';
import {
  endpoint,
  pinEndpointBrowserCredentialDelegation,
  type EndpointResponsePosture,
} from './endpoint.js';
import { mutation } from './mutation.js';
import { toNodeHandler } from './node.js';
import { respond } from './response.js';
import { route } from './route.js';
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

  it('selects the private posture before a live route stream can mint from pull()', async () => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const download = route('/late-route-token', {
      page(_context, request) {
        return respond.stream(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              await streamGate;
              const token = mintCsrfToken(request, csrf, {
                audience: 'endpoint:/late-route-token-submit',
              }).token;
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
});
