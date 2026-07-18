import { describe, expect, it } from 'vitest';

import {
  anonymousCsrfResponsePersonalizationWitness,
  mintCsrfField as mintCsrfFieldWithoutLifecycle,
  mintCsrfToken as mintCsrfTokenWithoutLifecycle,
  validateCsrfToken,
  type CsrfAnonymousCookieOptions,
  type CsrfOptions,
} from './csrf.js';
import {
  hasResponseLifecycleReceipt,
  runWithResponseLifecycleRequest,
  sealResponseLifecycleRequestAndSnapshotSetCookies,
} from './response-lifecycle-context.js';

const secret = 'raw-multi-form-secret-0123456789abcdef';
const options: CsrfOptions<Request> = {
  secret,
  sessionId: () => undefined,
};

function ensureResponseLifecycleReceipt(request: unknown): void {
  if (!hasResponseLifecycleReceipt(request)) {
    runWithResponseLifecycleRequest(request, request, () => undefined);
  }
}

function mintCsrfToken<Request>(
  request: Request,
  csrf: CsrfOptions<Request>,
  context: { audience?: string; mutation?: string | { readonly key: string } } = {},
) {
  ensureResponseLifecycleReceipt(request);
  return mintCsrfTokenWithoutLifecycle(request, csrf, context);
}

function mintCsrfField<Request>(
  request: Request,
  csrf: CsrfOptions<Request> & {
    audience?: string;
    field?: string;
    mutation?: string | { readonly key: string };
  },
) {
  ensureResponseLifecycleReceipt(request);
  return mintCsrfFieldWithoutLifecycle(request, csrf);
}

function cookiePair(setCookie: string | undefined): string {
  if (setCookie === undefined) throw new TypeError('expected anonymous CSRF cookie');
  return setCookie.split(';', 1)[0]!;
}

describe('standalone anonymous CSRF mint isolation', () => {
  it('requires a response lifecycle receipt before a first anonymous mint', () => {
    expect(() =>
      mintCsrfTokenWithoutLifecycle(
        new Request('https://shop.example.test/detached-form'),
        options,
      ),
    ).toThrow(/without a framework response lifecycle/u);
  });

  it('keeps every token valid when one raw response mints multiple forms', () => {
    const request = new Request('https://shop.example.test/forms');
    const first = mintCsrfToken(request, options, { audience: 'first' });
    const second = mintCsrfToken(request, options, { audience: 'second' });

    expect(second.setCookie).toBe(first.setCookie);
    const cookie = cookiePair(second.setCookie);
    const submit = (path: string) =>
      new Request(`https://shop.example.test${path}`, {
        headers: { cookie, origin: 'https://shop.example.test' },
        method: 'POST',
      });
    expect(
      validateCsrfToken({ 'kovo-csrf': first.token }, submit('/_m/first'), options, {
        audience: 'first',
      }),
    ).toBe(true);
    expect(
      validateCsrfToken({ 'kovo-csrf': second.token }, submit('/_m/second'), options, {
        audience: 'second',
      }),
    ).toBe(true);
  });

  it('rejects conflicting same-name cookie postures within one raw response', () => {
    const request = new Request('https://shop.example.test/forms');
    mintCsrfToken(request, options, { audience: 'first' });

    expect(() =>
      mintCsrfToken(
        request,
        {
          anonymousCookie: { path: '/auth' },
          secret,
          sessionId: () => undefined,
        },
        { audience: 'second' },
      ),
    ).toThrow(/conflicting browser attribute postures/u);
  });

  it.each([
    ['Path', { path: '/auth' }],
    ['Max-Age', { maxAge: 60 }],
    ['SameSite', { sameSite: 'strict' }],
    ['Secure', { secure: true }],
  ] satisfies readonly (readonly [string, CsrfAnonymousCookieOptions])[])(
    'rejects a conflicting %s posture supplied through a distinct options object',
    (_label, anonymousCookie) => {
      const request = new Request('https://shop.example.test/forms');
      mintCsrfToken(request, options, { audience: 'first' });

      expect(() =>
        mintCsrfToken(
          request,
          {
            anonymousCookie,
            secret,
            sessionId: () => undefined,
          },
          { audience: 'second' },
        ),
      ).toThrow(/conflicting browser attribute postures/u);
    },
  );

  it('rejects an authored browser-prefix alias at the standalone mint boundary', () => {
    for (const name of ['__Host-kovo_csrf', '__Secure-kovo_csrf']) {
      expect(() =>
        mintCsrfToken(
          new Request('https://shop.example.test/forms'),
          {
            anonymousCookie: { name },
            secret,
            sessionId: () => undefined,
          },
          { audience: 'first' },
        ),
      ).toThrow(/unprefixed logical name/u);
    }
  });

  it('reuses one binding through distinct default-equivalent token and field options', () => {
    const request = new Request('https://shop.example.test/forms');
    const first = mintCsrfToken(request, options, { audience: 'first' });
    const second = mintCsrfField(request, {
      anonymousCookie: {
        maxAge: 24 * 60 * 60,
        name: 'kovo_csrf',
        path: '/',
        sameSite: 'lax',
      },
      audience: 'second',
      secret,
      sessionId: () => undefined,
    });

    expect(second.setCookie).toBe(first.setCookie);
    expect(second.html).toContain(`value="${second.token}"`);
    const cookie = cookiePair(first.setCookie);
    const submit = new Request('https://shop.example.test/_m/second', {
      headers: { cookie, origin: 'https://shop.example.test' },
      method: 'POST',
    });
    expect(
      validateCsrfToken({ 'kovo-csrf': second.token }, submit, options, {
        audience: 'second',
      }),
    ).toBe(true);
  });

  it('reuses a present cookie while still rejecting a conflicting posture', () => {
    const binding = 'A'.repeat(43);
    const request = new Request('https://shop.example.test/forms', {
      headers: { cookie: `__Host-kovo_csrf=${binding}` },
    });
    const first = mintCsrfToken(request, options, { audience: 'first' });
    const second = mintCsrfField(request, {
      audience: 'second',
      secret,
      sessionId: () => undefined,
    });

    expect(first.setCookie).toBeUndefined();
    expect(second.setCookie).toBeUndefined();
    expect(() =>
      mintCsrfToken(
        request,
        {
          anonymousCookie: { path: '/auth' },
          secret,
          sessionId: () => undefined,
        },
        { audience: 'conflict' },
      ),
    ).toThrow(/conflicting browser attribute postures/u);
  });

  it('allows distinct logical cookie names without cross-binding their tokens', () => {
    const request = new Request('https://shop.example.test/forms');
    const firstOptions = {
      anonymousCookie: { name: 'first_csrf' },
      secret,
      sessionId: () => undefined,
    } satisfies CsrfOptions<Request>;
    const secondOptions = {
      anonymousCookie: { name: 'second_csrf' },
      secret,
      sessionId: () => undefined,
    } satisfies CsrfOptions<Request>;
    const first = mintCsrfToken(request, firstOptions, { audience: 'first' });
    const second = mintCsrfToken(request, secondOptions, { audience: 'second' });

    expect(second.setCookie).not.toBe(first.setCookie);
    const cookies = `${cookiePair(first.setCookie)}; ${cookiePair(second.setCookie)}`;
    const submit = new Request('https://shop.example.test/_m/submit', {
      headers: { cookie: cookies, origin: 'https://shop.example.test' },
      method: 'POST',
    });
    expect(
      validateCsrfToken({ 'kovo-csrf': first.token }, submit, firstOptions, {
        audience: 'first',
      }),
    ).toBe(true);
    expect(
      validateCsrfToken({ 'kovo-csrf': second.token }, submit, secondOptions, {
        audience: 'second',
      }),
    ).toBe(true);
  });

  it('reuses one standalone binding across a response request and its ordinary clone', () => {
    const request = new Request('https://shop.example.test/forms');
    const { first, second } = runWithResponseLifecycleRequest(request, request, () => ({
      first: mintCsrfToken(request, options, { audience: 'first' }),
      second: mintCsrfToken(request.clone().clone(), options, { audience: 'second' }),
    }));

    expect(second.setCookie).toBe(first.setCookie);
    const cookie = cookiePair(first.setCookie);
    const submit = new Request('https://shop.example.test/_m/second', {
      headers: { cookie, origin: 'https://shop.example.test' },
      method: 'POST',
    });
    expect(
      validateCsrfToken({ 'kovo-csrf': second.token }, submit, options, {
        audience: 'second',
      }),
    ).toBe(true);
  });

  it('keeps exact nested response lifecycles isolated from the ambient outer frame', () => {
    const outer = new Request('https://shop.example.test/outer', {
      headers: { 'x-session-id': 'outer-session' },
    });
    const inner = new Request('https://shop.example.test/inner', {
      headers: { 'x-session-id': 'inner-session' },
    });
    const sessionOptions = {
      secret,
      sessionId(request: Request) {
        return request.headers.get('x-session-id') ?? undefined;
      },
    };
    const result = runWithResponseLifecycleRequest(outer, outer, () => {
      const innerMint = runWithResponseLifecycleRequest(inner, inner, () =>
        mintCsrfToken(inner, options, { audience: 'inner' }),
      );
      const innerInsideOuter = mintCsrfToken(inner, options, { audience: 'inner-inside-outer' });
      const innerSessionInsideOuter = mintCsrfToken(inner, sessionOptions, {
        audience: 'inner-session-inside-outer',
      });

      expect(anonymousCsrfResponsePersonalizationWitness(inner)).toBe(true);
      expect(anonymousCsrfResponsePersonalizationWitness(outer)).toBe(false);
      const outerMint = mintCsrfToken(outer, options, { audience: 'outer' });
      expect(
        anonymousCsrfResponsePersonalizationWitness(
          new Request('https://shop.example.test/unretained-inner'),
        ),
      ).toBe(false);
      const innerCookies = sealResponseLifecycleRequestAndSnapshotSetCookies(inner);
      expect(innerCookies).toEqual([innerMint.setCookie]);
      expect(() =>
        mintCsrfToken(
          inner,
          { ...options, anonymousCookie: { name: 'sealed_inner_second_csrf' } },
          { audience: 'sealed-inner-second' },
        ),
      ).toThrow(/after response headers were committed/u);

      const secondOuterNamespace = mintCsrfToken(
        outer,
        { ...options, anonymousCookie: { name: 'outer_second_csrf' } },
        { audience: 'outer-second' },
      );
      const outerCookies = sealResponseLifecycleRequestAndSnapshotSetCookies(outer);
      return {
        innerInsideOuter,
        innerMint,
        innerSessionInsideOuter,
        outerCookies,
        outerMint,
        secondOuterNamespace,
      };
    });

    expect(result.innerInsideOuter.setCookie).toBe(result.innerMint.setCookie);
    expect(result.innerMint.setCookie).not.toBe(result.outerMint.setCookie);
    expect(result.outerCookies).toEqual([
      result.outerMint.setCookie,
      result.secondOuterNamespace.setCookie,
    ]);

    const innerCookie = cookiePair(result.innerMint.setCookie);
    const outerCookie = cookiePair(result.outerMint.setCookie);
    const submit = (cookie: string) =>
      new Request('https://shop.example.test/_m/nested', {
        headers: { cookie, origin: 'https://shop.example.test' },
        method: 'POST',
      });
    expect(
      validateCsrfToken(
        { 'kovo-csrf': result.innerInsideOuter.token },
        submit(innerCookie),
        options,
        { audience: 'inner-inside-outer' },
      ),
    ).toBe(true);
    expect(
      validateCsrfToken(
        { 'kovo-csrf': result.innerInsideOuter.token },
        submit(outerCookie),
        options,
        { audience: 'inner-inside-outer' },
      ),
    ).toBe(false);
    expect(
      validateCsrfToken(
        { 'kovo-csrf': result.innerSessionInsideOuter.token },
        new Request('https://shop.example.test/_m/nested-session', {
          headers: { 'x-session-id': 'inner-session' },
        }),
        sessionOptions,
        { audience: 'inner-session-inside-outer' },
      ),
    ).toBe(true);
    expect(
      validateCsrfToken(
        { 'kovo-csrf': result.innerSessionInsideOuter.token },
        new Request('https://shop.example.test/_m/nested-session', {
          headers: { 'x-session-id': 'outer-session' },
        }),
        sessionOptions,
        { audience: 'inner-session-inside-outer' },
      ),
    ).toBe(false);
  });

  it('lets an exact unsealed inner lifecycle outrank a sealed ambient outer lifecycle', () => {
    const outer = new Request('https://shop.example.test/sealed-outer');
    const inner = new Request('https://shop.example.test/open-inner');

    runWithResponseLifecycleRequest(outer, outer, () => {
      runWithResponseLifecycleRequest(inner, inner, () => undefined);
      sealResponseLifecycleRequestAndSnapshotSetCookies(outer);

      const innerMint = mintCsrfToken(inner, options, { audience: 'open-inner' });
      expect(innerMint.setCookie).toBeDefined();
      expect(sealResponseLifecycleRequestAndSnapshotSetCookies(inner)).toEqual([
        innerMint.setCookie,
      ]);
      expect(() =>
        mintCsrfToken(
          new Request(inner),
          { ...options, anonymousCookie: { name: 'ambient_clone_csrf' } },
          { audience: 'ambient-clone' },
        ),
      ).toThrow(/after response headers were committed/u);
    });
  });

  it('rejects a conflicting standalone posture supplied through a response clone', () => {
    const request = new Request('https://shop.example.test/forms');

    expect(() =>
      runWithResponseLifecycleRequest(request, request, () => {
        mintCsrfToken(request, options, { audience: 'first' });
        mintCsrfToken(
          request.clone().clone(),
          {
            anonymousCookie: { path: '/auth' },
            secret,
            sessionId: () => undefined,
          },
          { audience: 'second' },
        );
      }),
    ).toThrow(/conflicting browser attribute postures/u);
  });

  it('keeps standalone bindings isolated between exact request objects', () => {
    const first = mintCsrfToken(new Request('https://shop.example.test/forms'), options, {
      audience: 'first',
    });
    const second = mintCsrfToken(new Request('https://shop.example.test/forms'), options, {
      audience: 'first',
    });

    expect(second.setCookie).not.toBe(first.setCookie);
    const submitWithSecondCookie = new Request('https://shop.example.test/_m/first', {
      headers: {
        cookie: cookiePair(second.setCookie),
        origin: 'https://shop.example.test',
      },
      method: 'POST',
    });
    expect(
      validateCsrfToken({ 'kovo-csrf': first.token }, submitWithSecondCookie, options, {
        audience: 'first',
      }),
    ).toBe(false);
  });
});
