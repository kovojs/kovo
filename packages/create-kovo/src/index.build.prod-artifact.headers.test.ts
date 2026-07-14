import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  attributeValue,
  buildReusableProductionArtifact,
  fieldValue,
  firstFormHtml,
} from './index.build.test-support.js';
import {
  assertProdArtifactSinkCensus,
  readProductionGraph,
} from './index.build.prod-artifact.sink-census.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  mergeCookies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: production response header artifacts)', () => {
  it('fails closed on unsafe response header values in the production server artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-header-sink-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Header Sink Proof' });
      addHeaderSinkProofRoutes(root);
      linkStarterBuildDependencies(root);

      buildReusableProductionArtifact(root);
      const census = assertProdArtifactSinkCensus(root, [
        {
          proof: {
            evidence:
              'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts observes route outcome headers, guarded cache floors, structural-forgery escaping, prototype-safe pinned outcomes, and KV415 CRLF failure in the production server artifact',
            kind: 'proof',
          },
          sink: 'response headers / route outcome headers',
          witnesses: [
            'finalizeResponseHeaders',
            'ResponseHeaderChannelError',
            'X-Kovo-Header-Proof',
            'header-route-forged.html',
            'header-route-pinned.bin',
            'header-route-prototype.bin',
            'header-route-access-private.txt',
            'header-sink-unsafe.txt',
          ],
        },
        {
          proof: {
            evidence:
              'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts observes typed and raw endpoint Set-Cookie normalization plus unsafe cookie rejection in the production server artifact',
            kind: 'proof',
          },
          sink: 'Set-Cookie typed response header',
          witnesses: [
            'serializeCookie',
            'Set-Cookie',
            'header-cookie-proof',
            'raw-header-endpoint',
            'c2_cookie',
          ],
        },
      ]);
      expect(census.entries).toHaveLength(2);
      expect(JSON.stringify(readProductionGraph(root))).toContain('/header-sink-safe.txt');

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_VERIFY_ENDPOINT_POSTURE: '1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      await fetchTextWhenReady(`${origin}/header-sink-safe.txt`, output);
      const safe = await fetch(`${origin}/header-sink-safe.txt`);
      await expect(safe.text()).resolves.toBe('safe header proof\n');
      expect(safe.status).toBe(200);
      expect(safe.headers.get('x-kovo-header-proof')).toBe('safe-header-value');

      const safeStream = await fetch(`${origin}/header-stream-safe.bin`);
      await expect(safeStream.text()).resolves.toBe('safe stream proof\n');
      expect(safeStream.status).toBe(200);
      expect(safeStream.headers.get('content-disposition')).toBe(
        'attachment; filename="safe-stream.bin"',
      );
      expect(safeStream.headers.get('content-type')).toBe('application/octet-stream');
      expect(safeStream.headers.get('x-content-type-options')).toBe('nosniff');

      // SPEC §6.6: a public structural shape is not authority. Exercise the emitted Node
      // artifact so bundling cannot accidentally collapse the module-private route witness.
      const forged = await fetch(`${origin}/header-route-forged.html`);
      const forgedBody = await forged.text();
      expect(forged.status, forgedBody).toBe(200);
      expect(forged.headers.get('content-disposition')).toBeNull();
      expect(forged.headers.get('x-kovo-forged')).toBeNull();
      expect(forgedBody).toContain(
        '&lt;script&gt;globalThis.KOVO_FORGED_ROUTE = true&lt;/script&gt;',
      );
      expect(forgedBody).not.toContain('<script>globalThis.KOVO_FORGED_ROUTE = true</script>');

      // SPEC §6.6 / §10.6 C15: the HTTP sink consumes the private snapshot minted by
      // respond.file(), not mutable inputs or the public inspection view.
      const pinned = await fetch(`${origin}/header-route-pinned.bin`);
      await expect(pinned.text()).resolves.toBe('PINNED_GENUINE_BYTES');
      expect(pinned.status).toBe(200);
      expect(pinned.headers.get('content-disposition')).toBe(
        'attachment; filename="pinned-genuine.bin"',
      );
      expect(pinned.headers.get('content-type')).toBe('application/octet-stream');
      expect(pinned.headers.get('x-content-type-options')).toBe('nosniff');
      expect(pinned.headers.get('x-kovo-pinned')).toBe('pinned-genuine-header');

      const unsafe = await fetch(`${origin}/header-sink-unsafe.txt`);
      const unsafeBody = await unsafe.text();
      expect(unsafe.status, unsafeBody).toBe(500);
      expect(unsafe.headers.get('x-kovo-header-proof')).toBeNull();
      expect(unsafe.headers.getSetCookie()).toEqual([]);
      expect(unsafeBody).toContain('Server Error');

      const rollingMissing = await fetch(`${origin}/rolling-cookie-404`, {
        headers: { 'x-kovo-rolling-proof': '1' },
      });
      const rollingMissingBody = await rollingMissing.text();
      expect(rollingMissing.status, rollingMissingBody).toBe(404);
      expect(rollingMissing.headers.getSetCookie()).toEqual([
        expect.stringContaining('rolling_proof=victim-token'),
      ]);
      expect(rollingMissing.headers.get('cache-control')).toBe('private, no-store');
      expect(rollingMissing.headers.get('vary')).toContain('Cookie');

      const rollingOk = await fetch(`${origin}/rolling-cookie-200`, {
        headers: { 'x-kovo-rolling-proof': '1' },
      });
      await expect(rollingOk.text()).resolves.toContain('rolling cookie 200 control');
      expect(rollingOk.status).toBe(200);
      expect(rollingOk.headers.getSetCookie()).toEqual([
        expect.stringContaining('rolling_proof=victim-token'),
      ]);
      expect(rollingOk.headers.get('cache-control')).toBe('private, no-store');
      expect(rollingOk.headers.get('vary')).toContain('Cookie');

      const cookieJar = new Map<string, string>();
      const cookiePage = await fetch(`${origin}/header-cookie-proof`);
      mergeCookies(cookieJar, cookiePage.headers.getSetCookie());
      const cookieForm = firstFormHtml(await cookiePage.text());
      const action = attributeValue(cookieForm, 'action');
      if (!action) throw new Error('Expected header cookie proof form action.');

      const cookie = await fetch(`${origin}${action}`, {
        body: new URLSearchParams({
          csrf: fieldValue(cookieForm, 'csrf'),
          'Kovo-Idem': `cookie-${Date.now()}`,
          mode: 'safe',
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(cookieJar),
          'Kovo-Fragment': 'true',
          origin,
        },
        method: 'POST',
      });
      await cookie.text();
      expect(cookie.status).toBe(200);
      expect(cookie.headers.getSetCookie()).toEqual([
        expect.stringContaining('c2_cookie=hello%20world'),
      ]);
      expect(cookie.headers.getSetCookie()[0]).toContain('SameSite=Lax');

      const unsafeCookie = await fetch(`${origin}${action}`, {
        body: new URLSearchParams({
          csrf: fieldValue(cookieForm, 'csrf'),
          'Kovo-Idem': `unsafe-cookie-${Date.now()}`,
          mode: 'unsafe',
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(cookieJar),
          'Kovo-Fragment': 'true',
          origin,
        },
        method: 'POST',
      });
      const unsafeCookieBody = await unsafeCookie.text();
      expect(unsafeCookie.status, unsafeCookieBody).toBe(500);
      expect(unsafeCookie.headers.getSetCookie()).toEqual([]);
      expect(unsafeCookieBody).not.toContain('Set-Cookie: c2=owned');

      const rawEndpoint = await fetch(`${origin}/raw-header-endpoint`, {
        headers: { 'x-kovo-header-proof': 'accepted' },
        redirect: 'manual',
      });
      const rawEndpointBody = await rawEndpoint.text();
      expect(rawEndpoint.status, `${rawEndpointBody}\n${output()}`).toBe(200);
      expect(rawEndpointBody).toBe('raw endpoint header proof');
      const rawCookies = rawEndpoint.headers.getSetCookie();
      expect(rawCookies).toHaveLength(1);
      expect(rawCookies[0]).toContain('raw_sid=abc');
      expect(rawCookies[0]).toContain('HttpOnly');
      // The artifact is exercised over local HTTP under NODE_ENV=test; Secure is intentionally
      // transport/runtime-derived instead of being frozen into the production build output.
      expect(rawCookies[0]).not.toContain('Secure');
      expect(rawCookies[0]).toContain('SameSite=Lax');

      const rawRedirect = await fetch(`${origin}/raw-header-redirect`, { redirect: 'manual' });
      const rawRedirectBody = await rawRedirect.text();
      expect(rawRedirect.status, rawRedirectBody).toBe(500);
      expect(rawRedirect.headers.get('location')).toBeNull();
      expect(rawRedirect.headers.getSetCookie()).toEqual([]);
      expect(rawRedirectBody).toContain('Server Error');

      for (const path of [
        '/header-route-access-private.txt',
        '/header-parent-layout-access-private.txt',
      ]) {
        const unauthorized = await fetch(`${origin}${path}`);
        const unauthorizedBody = await unauthorized.text();
        expect(unauthorized.status, `${path}\n${unauthorizedBody}`).toBe(403);
        expect(unauthorizedBody).not.toContain('PRIVATE:victim');

        const authorized = await fetch(`${origin}${path}`, {
          headers: { 'x-principal': 'victim' },
        });
        await expect(authorized.text()).resolves.toBe('PRIVATE:victim');
        expect(authorized.status, path).toBe(200);
        expect(authorized.headers.get('cache-control'), path).toBe('no-store');
        expect(authorized.headers.get('vary'), path).toContain('Cookie');

        const notModified = await fetch(`${origin}${path}`, {
          headers: {
            'if-none-match': '"private-v1"',
            'x-principal': 'victim',
          },
        });
        expect(notModified.status, path).toBe(304);
        expect(notModified.headers.get('cache-control'), path).toBe('no-store');
        expect(notModified.headers.get('vary'), path).toContain('Cookie');
      }

      const publicCacheControl = await fetch(`${origin}/header-public-cache-control.txt`, {
        headers: { 'if-none-match': '"public-v1"' },
      });
      expect(publicCacheControl.status).toBe(304);
      expect(publicCacheControl.headers.get('cache-control')).toBeNull();
      expect(publicCacheControl.headers.get('vary')).toBeNull();

      // Run this final: the hostile app route deliberately leaves its server realm polluted. The
      // private outcome snapshot must retain exact-own undefined policy through the HTTP sink.
      const prototypeSafe = await fetch(`${origin}/header-route-prototype.bin`, {
        headers: { 'if-none-match': '"inherited-forgery"' },
      });
      await expect(prototypeSafe.text()).resolves.toBe('PINNED_PROTOTYPE_BYTES');
      expect(prototypeSafe.status).toBe(200);
      expect(prototypeSafe.headers.get('etag')).toBeNull();
      expect(prototypeSafe.headers.get('cache-control')).toBeNull();
      expect(prototypeSafe.headers.get('x-inherited-forgery')).toBeNull();
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

function addHeaderSinkProofRoutes(root: string): void {
  const authPath = join(root, 'src/auth.ts');
  writeFileSync(
    authPath,
    replaceRequired(
      readFileSync(authPath, 'utf8'),
      'export const appSessionProvider = appSession.provider(authBindings.sessionProvider);',
      [
        'export const appSessionProvider = appSession.provider(async (request: { headers: Headers }) => {',
        "  if (request.headers.get('x-kovo-rolling-proof') === '1') {",
        '    return {',
        "      setCookies: ['rolling_proof=victim-token; Path=/; HttpOnly; SameSite=Lax'],",
        "      value: { id: 'rolling-proof', user: { id: 'rolling-proof', email: 'proof@example.test', name: 'Proof' } },",
        '    };',
        '  }',
        '  return authBindings.sessionProvider(request);',
        '});',
      ].join('\n'),
      'rolling-cookie response session provider',
    ),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/header-cookie-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { mutation, mutationFormAttributes, publicAccess, s } from '@kovojs/server';",
      '',
      'export const headerCookieProof = mutation({',
      "  access: publicAccess('public Set-Cookie response header sink proof'),",
      '  input: s.object({ mode: s.string() }),',
      '  handler(input, _request, context) {',
      "    const value = input.mode === 'unsafe' ? 'unsafe\\r\\nSet-Cookie: c2=owned' : 'hello world';",
      "    context.setCookie?.('c2_cookie', value, { class: 'app-data', path: '/', sameSite: 'lax' });",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const HeaderCookieProof = component({',
      '  mutations: { headerCookieProof },',
      '  render: () => (',
      '    <main>',
      '      <form {...mutationFormAttributes(headerCookieProof)}>',
      '        <input name="mode" value="safe" />',
      '        <button type="submit">Set cookie</button>',
      '      </form>',
      '    </main>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const withRespondImport = replaceRequired(
    app,
    '  redirect,\n  route,',
    '  customVerifier,\n  notFound,\n  redirect,\n  respond,\n  route,',
    'response-header proof response imports',
  );
  const withRawEndpoint = replaceRequired(
    withRespondImport,
    'const mutationReplayStore = appRuntimeMutationReplayStore();',
    [
      'const mutationReplayStore = appRuntimeMutationReplayStore();',
      "const rawHeaderProofVerifier = customVerifier('raw-header-proof', ({ headers }) =>",
      "  'get' in headers &&",
      "  typeof headers.get === 'function' &&",
      "  headers.get('x-kovo-header-proof') === 'accepted',",
      ');',
      "const rawHeaderEndpoint = endpoint('/raw-header-endpoint', {",
      "  access: publicAccess('public raw endpoint Set-Cookie header sink proof'),",
      "  auth: { kind: 'custom', name: 'raw-header-proof', verify: rawHeaderProofVerifier },",
      "  method: 'GET',",
      "  reason: 'raw endpoint Set-Cookie header sink proof',",
      '  csrf: false,',
      "  csrfJustification: 'read-only raw header proof endpoint',",
      "  response: { appOwnedSafety: true, body: 'text', cache: 'no-store', reservedHeaders: ['Set-Cookie'] },",
      '  handler() {',
      "    return new Response('raw endpoint header proof', {",
      "      headers: { 'Cache-Control': 'no-store', 'Set-Cookie': 'raw_sid=abc; Path=/' },",
      '    });',
      '  },',
      '});',
      "const rawHeaderRedirectEndpoint = endpoint('/raw-header-redirect', {",
      "  access: publicAccess('public raw endpoint redirect Location header sink proof'),",
      "  auth: { kind: 'none', justification: 'public read-only redirect sink proof endpoint' },",
      "  method: 'GET',",
      "  reason: 'raw endpoint redirect Location header sink proof',",
      '  csrf: false,',
      "  csrfJustification: 'read-only raw redirect proof endpoint',",
      "  response: { appOwnedSafety: true, body: 'redirect', cache: 'no-store', reservedHeaders: ['Location'] },",
      '  handler() {',
      '    return new Response(null, {',
      "      headers: { 'Cache-Control': 'no-store', Location: 'https://evil.example/phish' },",
      '      status: 303,',
      '    });',
      '  },',
      '});',
      'const headerCacheAllowVictim = (request: AppRequest) =>',
      "  request.headers.get('x-principal') === 'victim'",
      '    ? true',
      "    : { kind: 'forbidden' as const };",
      'const HeaderCacheParentLayout = layout<AppRequest>({ access: [headerCacheAllowVictim] });',
      'const HeaderCacheChildLayout = layout<AppRequest>({ parent: HeaderCacheParentLayout });',
    ].join('\n'),
    'response-header proof raw endpoints',
  );
  const withCookieProofImport = replaceRequired(
    withRawEndpoint,
    "import { ContactsRegion } from './components/contacts.js';",
    [
      "import { ContactsRegion } from './components/contacts.js';",
      "import { HeaderCookieProof, headerCookieProof } from './header-cookie-proof.js';",
    ].join('\n'),
    'response-header proof cookie import',
  );
  const withMutationRegistration = replaceRequired(
    withCookieProofImport,
    '  mutations: [addContact, appSignIn, appSignOut],',
    '  mutations: [addContact, headerCookieProof, appSignIn, appSignOut],',
    'response-header proof cookie mutation registration',
  );
  const withEndpointRegistration = replaceRequired(
    withMutationRegistration,
    '  endpoints: [healthEndpoint],',
    '  endpoints: [healthEndpoint, rawHeaderEndpoint, rawHeaderRedirectEndpoint],',
    'response-header proof raw endpoint registration',
  );
  const withRoutes = replaceRequired(
    withEndpointRegistration,
    "  routes: [\n    route('/', {",
    [
      '  routes: [',
      "    route('/rolling-cookie-404', {",
      "      access: publicAccess('rolling-cookie matched 404 cache-floor proof'),",
      '      page() {',
      '        return notFound();',
      '      },',
      '    }),',
      "    route('/rolling-cookie-200', {",
      "      access: publicAccess('rolling-cookie 200 cache-floor control'),",
      '      page() {',
      '        return <main>rolling cookie 200 control</main>;',
      '      },',
      '    }),',
      "    route('/header-sink-safe.txt', {",
      "      access: publicAccess('public response header sink proof'),",
      '      page() {',
      "        return respond.file('safe header proof\\n', {",
      "          contentType: 'text/plain; charset=utf-8',",
      "          headers: { 'X-Kovo-Header-Proof': 'safe-header-value' },",
      '        });',
      '      },',
      '    }),',
      "    route('/header-route-access-private.txt', {",
      '      access: [headerCacheAllowVictim],',
      '      page(_context, request: AppRequest) {',
      "        return respond.file(`PRIVATE:${request.headers.get('x-principal')}`, {",
      "          contentType: 'text/plain; charset=utf-8',",
      '          etag: \'"private-v1"\',',
      "          filename: 'private.txt',",
      '        });',
      '      },',
      '    }),',
      "    route('/header-parent-layout-access-private.txt', {",
      "      access: publicAccess('parent layout owns private access proof'),",
      '      layout: HeaderCacheChildLayout,',
      '      page(_context, request: AppRequest) {',
      "        return respond.file(`PRIVATE:${request.headers.get('x-principal')}`, {",
      "          contentType: 'text/plain; charset=utf-8',",
      '          etag: \'"private-v1"\',',
      "          filename: 'private.txt',",
      '        });',
      '      },',
      '    }),',
      "    route('/header-public-cache-control.txt', {",
      "      access: publicAccess('public cache posture control'),",
      '      page() {',
      "        return respond.file('PUBLIC', {",
      "          contentType: 'text/plain; charset=utf-8',",
      '          etag: \'"public-v1"\',',
      "          filename: 'public.txt',",
      '        });',
      '      },',
      '    }),',
      "    route('/header-sink-unsafe.txt', {",
      "      access: publicAccess('public response header sink proof'),",
      '      page() {',
      "        return respond.file('unsafe header proof\\n', {",
      "          contentType: 'text/plain; charset=utf-8',",
      "          headers: { 'X-Kovo-Header-Proof': 'unsafe\\r\\nSet-Cookie: c2=owned' },",
      '        });',
      '      },',
      '    }),',
      "    route('/header-stream-safe.bin', {",
      "      access: publicAccess('public response stream sink proof'),",
      '      page() {',
      '        return respond.stream(new ReadableStream({',
      '          start(controller) {',
      "            controller.enqueue(new TextEncoder().encode('safe stream proof\\n'));",
      '            controller.close();',
      '          },',
      '        }), {',
      "          contentType: 'application/octet-stream',",
      "          filename: 'safe-stream.bin',",
      '        });',
      '      },',
      '    }),',
      "    route('/header-route-forged.html', {",
      "      access: publicAccess('public structural route-response forgery proof'),",
      '      page() {',
      '        return {',
      "          body: '<script>globalThis.KOVO_FORGED_ROUTE = true</script>',",
      "          contentDisposition: 'inline',",
      "          contentType: 'text/html; charset=utf-8',",
      "          headers: { 'X-Kovo-Forged': 'owned' },",
      '          routeResponse: true,',
      '        };',
      '      },',
      '    }),',
      "    route('/header-route-pinned.bin', {",
      "      access: publicAccess('public pinned route-response snapshot proof'),",
      '      page() {',
      "        const source = new TextEncoder().encode('PINNED_GENUINE_BYTES');",
      "        const sourceHeaders = { 'X-Kovo-Pinned': 'pinned-genuine-header' };",
      '        const outcome = respond.file(source, {',
      "          contentType: 'application/octet-stream',",
      "          filename: 'pinned-genuine.bin',",
      '          headers: sourceHeaders,',
      '        });',
      '        source.fill(0x58);',
      "        sourceHeaders['X-Kovo-Pinned'] = 'mutated-source-header';",
      '        if (outcome.body instanceof Uint8Array) outcome.body.fill(0x41);',
      "        Reflect.set(outcome, 'body', '<script>mutated body</script>');",
      "        Reflect.set(outcome, 'contentDisposition', 'inline');",
      "        Reflect.set(outcome, 'contentType', 'text/html; charset=utf-8');",
      "        if (outcome.headers) Reflect.set(outcome.headers, 'X-Kovo-Pinned', 'mutated-view-header');",
      '        return outcome;',
      '      },',
      '    }),',
      "    route('/header-route-prototype.bin', {",
      "      access: publicAccess('private route outcome prototype snapshot proof'),",
      '      page() {',
      "        const outcome = respond.file('PINNED_PROTOTYPE_BYTES', {",
      "          contentType: 'application/octet-stream',",
      "          filename: 'prototype-safe.bin',",
      '        });',
      "        Object.defineProperty(Object.prototype, 'etag', {",
      '          configurable: true,',
      '          value: \'"inherited-forgery"\',',
      '          writable: true,',
      '        });',
      "        Object.defineProperty(Object.prototype, 'headers', {",
      '          configurable: true,',
      '          value: {',
      "            'Cache-Control': 'public, max-age=86400',",
      "            'X-Inherited-Forgery': 'reached-artifact-sink',",
      '          },',
      '          writable: true,',
      '        });',
      '        return outcome;',
      '      },',
      '    }),',
      "    route('/header-cookie-proof', {",
      "      access: publicAccess('public Set-Cookie response header sink proof'),",
      '      page() {',
      '        return <HeaderCookieProof />;',
      '      },',
      '    }),',
      "    route('/', {",
    ].join('\n'),
    'response-header proof routes',
  );
  writeFileSync(appPath, withRoutes, 'utf8');
}

function replaceRequired(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  if (!source.includes(search)) throw new Error(`Expected scaffold anchor for ${label}.`);
  return source.replace(search, replacement);
}
