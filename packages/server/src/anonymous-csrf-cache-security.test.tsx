/** @jsxImportSource @kovojs/server */
import { describe, expect, it } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { mutation } from './mutation.js';
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
    const cacheControl = primed.headers.get('cache-control') ?? '';
    const vary = primed.headers.get('vary') ?? '';
    let victimHtml = primedHtml;
    if (/\bno-store\b/iu.test(cacheControl) || /(?:^|,)\s*Cookie\s*(?:,|$)/iu.test(vary)) {
      const fresh = await handler(
        new Request('https://shop.example.test/login', {
          headers: { Cookie: cookieHeader(victimBinding) },
        }),
      );
      victimHtml = await fresh.text();
    }

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
});
