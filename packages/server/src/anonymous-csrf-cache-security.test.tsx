/** @jsxImportSource @kovojs/server */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { mintCsrfField } from './csrf.js';
import { Defer } from './deferred-region.js';
import {
  endpoint,
  pinEndpointBrowserCredentialDelegation,
  type EndpointResponsePosture,
} from './endpoint.js';
import { mutation } from './mutation.js';
import { toNodeHandler } from './node.js';
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
    const victimHtml = await selectCachedOrFreshHtml(
      handler,
      primed,
      primedHtml,
      victimBinding,
    );

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
    const victimHtml = await selectCachedOrFreshHtml(
      handler,
      primed,
      primedHtml,
      victimBinding,
    );
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
        csrf,
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
});

describe('raw endpoint anonymous CSRF bootstrap cache posture', () => {
  const publicHtmlResponse = {
    appOwnedSafety: true,
    body: 'html',
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

  it('leaves an unrelated public raw response cacheable even on the credential-delegating path', async () => {
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

    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('vary')).toBeNull();
  });
});
