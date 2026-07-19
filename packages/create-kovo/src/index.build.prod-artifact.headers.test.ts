import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as netConnect } from 'node:net';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  attributeValue,
  buildReusableProductionArtifact,
  fieldValue,
  firstFormHtml,
  freshProductionArtifactIdempotencyToken,
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
              'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts observes route outcome headers, guarded cache floors, structural-forgery escaping, typed file outcomes, omitted cache policy, and KV415 CRLF/transport-framing failure in the production server artifact',
            kind: 'proof',
          },
          sink: 'response headers / route outcome headers',
          witnesses: [
            'finalizeResponseHeaders',
            'ResponseHeaderChannelError',
            'Wed, 21 Oct 2015 07:28:00 GMT',
            'header-route-forged.html',
            'header-route-typed-file.bin',
            'header-route-omitted-policy.bin',
            'header-route-access-private.txt',
            'header-sink-unsafe.txt',
            'header-name-unsafe.txt',
            'header-transport-unsafe.txt',
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
          BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
          HOST: '127.0.0.1',
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
      expect(safe.headers.get('last-modified')).toBe('Wed, 21 Oct 2015 07:28:00 GMT');

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

      // SPEC §6.6 / §10.6 C15: preserve a framework-minted typed file outcome through the emitted
      // Node artifact. Focused server tests own the separate late-mutation snapshot proof.
      const typedFile = await fetch(`${origin}/header-route-typed-file.bin`);
      await expect(typedFile.text()).resolves.toBe('PINNED_GENUINE_BYTES');
      expect(typedFile.status).toBe(200);
      expect(typedFile.headers.get('content-disposition')).toBe(
        'attachment; filename="pinned-genuine.bin"',
      );
      expect(typedFile.headers.get('content-type')).toBe('application/octet-stream');
      expect(typedFile.headers.get('x-content-type-options')).toBe('nosniff');
      expect(typedFile.headers.get('vary')).toBe('Accept-Encoding');

      const unsafe = await fetch(`${origin}/header-sink-unsafe.txt`);
      const unsafeBody = await unsafe.text();
      expect(unsafe.status, unsafeBody).toBe(500);
      expect(unsafe.headers.get('vary')).toBeNull();
      expect(unsafe.headers.getSetCookie()).toEqual([]);
      expect(unsafeBody).toContain('Server Error');

      const unsafeTransport = await fetch(`${origin}/header-transport-unsafe.txt`, {
        headers: { 'x-declared-length': '0' },
      });
      const unsafeTransportBody = await unsafeTransport.text();
      expect(unsafeTransport.status, unsafeTransportBody).toBe(500);
      expect(unsafeTransport.headers.get('content-length')).not.toBe('0');
      expect(unsafeTransportBody).not.toContain('UNDECLARED_ROUTE_BYTES');

      const unsafeName = await fetch(`${origin}/header-name-unsafe.txt`, {
        headers: { 'x-response-name': 'X-Accel-Redirect' },
      });
      const unsafeNameBody = await unsafeName.text();
      expect(unsafeName.status, unsafeNameBody).toBe(500);
      expect(unsafeName.headers.get('x-accel-redirect')).toBeNull();
      expect(unsafeNameBody).not.toContain('UNKNOWN_HEADER_BYTES');

      const pipelinedWire = await pipelinedTransportHeaderExchange(port);
      expect(pipelinedWire).toContain('HTTP/1.1 500');
      expect(pipelinedWire).toMatch(/connection: close/iu);
      expect(pipelinedWire).not.toContain('HTTP/1.1 200');
      expect(pipelinedWire).not.toContain('safe header proof');
      expect(pipelinedWire).not.toContain('UNDECLARED_ROUTE_BYTES');
      expect(pipelinedWire).not.toContain('\r\n\r\nUNDECLARED_ROUTE_BYTESHTTP/1.1');
      expect(pipelinedWire.match(/HTTP\/1\.1 /gu)).toHaveLength(1);

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

      const cookieIdem = freshProductionArtifactIdempotencyToken();
      const cookie = await fetch(`${origin}${action}`, {
        body: new URLSearchParams({
          csrf: fieldValue(cookieForm, 'csrf'),
          'Kovo-Idem': cookieIdem,
          mode: 'safe',
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(cookieJar),
          'Kovo-Fragment': 'true',
          'Kovo-Idem': cookieIdem,
          origin,
        },
        method: 'POST',
      });
      const cookieBody = await cookie.text();
      expect(cookie.status, cookieBody).toBe(200);
      expect(cookie.headers.getSetCookie()).toEqual([
        expect.stringContaining('c2_cookie=hello%20world'),
      ]);
      expect(cookie.headers.getSetCookie()[0]).toContain('SameSite=Lax');

      const unsafeCookieIdem = freshProductionArtifactIdempotencyToken();
      const unsafeCookie = await fetch(`${origin}${action}`, {
        body: new URLSearchParams({
          csrf: fieldValue(cookieForm, 'csrf'),
          'Kovo-Idem': unsafeCookieIdem,
          mode: 'unsafe',
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(cookieJar),
          'Kovo-Fragment': 'true',
          'Kovo-Idem': unsafeCookieIdem,
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

      const rawTransport = await fetch(`${origin}/raw-header-transport`);
      const rawTransportBody = await rawTransport.text();
      expect(rawTransport.status, rawTransportBody).toBe(500);
      expect(rawTransport.headers.get('content-length')).not.toBe('0');
      expect(rawTransportBody).not.toContain('RAW_UNDECLARED_BYTES');

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

      const omittedPolicy = await fetch(`${origin}/header-route-omitted-policy.bin`, {
        headers: { 'if-none-match': '"missing-validator"' },
      });
      await expect(omittedPolicy.text()).resolves.toBe('OMITTED_POLICY_BYTES');
      expect(omittedPolicy.status).toBe(200);
      expect(omittedPolicy.headers.get('etag')).toBeNull();
      expect(omittedPolicy.headers.get('cache-control')).toBeNull();
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
        'export const appSessionProvider = appSession.provider(async (request: { headers: Headers; url: string }) => {',
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
    'const mutationReplayStore = appRuntimeMutationReplayStore;',
    [
      'const mutationReplayStore = appRuntimeMutationReplayStore;',
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
      "const rawHeaderTransportEndpoint = endpoint('/raw-header-transport', {",
      "  access: publicAccess('public raw endpoint transport-header sink proof'),",
      "  auth: { kind: 'none', justification: 'public read-only transport-header proof endpoint' },",
      "  method: 'GET',",
      "  reason: 'raw endpoint transport-header sink proof',",
      '  csrf: false,',
      "  csrfJustification: 'read-only raw transport-header proof endpoint',",
      "  response: { appOwnedSafety: true, body: 'text', cache: 'no-store', reservedHeaders: ['Content-Length'] },",
      '  handler() {',
      "    return new Response('RAW_UNDECLARED_BYTES', {",
      "      headers: { 'Cache-Control': 'no-store', 'Content-Length': '0' },",
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
      'const HeaderCacheParentLayout = layout<AppRequest>({ access: [(request: AppRequest) =>',
      "  request.headers.get('x-principal') === 'victim'",
      '    ? true',
      "    : { kind: 'forbidden' as const }] });",
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
    '  endpoints: [healthEndpoint, rawHeaderEndpoint, rawHeaderTransportEndpoint, rawHeaderRedirectEndpoint],',
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
      "          headers: { 'Last-Modified': 'Wed, 21 Oct 2015 07:28:00 GMT' },",
      '        });',
      '      },',
      '    }),',
      "    route('/header-name-unsafe.txt', {",
      "      access: publicAccess('public response header-name allowlist proof'),",
      '      page(_context, request: AppRequest) {',
      "        const name = request.headers.get('x-response-name') ?? 'X-Accel-Redirect';",
      "        const headers: Record<string, string> = { [name]: '/internal/admin' };",
      "        return respond.file('UNKNOWN_HEADER_BYTES', {",
      "          contentType: 'text/plain; charset=utf-8',",
      '          headers,',
      '        });',
      '      },',
      '    }),',
      "    route('/header-transport-unsafe.txt', {",
      "      access: publicAccess('public response transport-header sink proof'),",
      '      page(_context, request: AppRequest) {',
      "        const headers: Record<string, string> = { 'Content-Length': request.headers.get('x-declared-length') ?? '0' };",
      "        return respond.file('UNDECLARED_ROUTE_BYTES', {",
      "          contentType: 'text/plain; charset=utf-8',",
      '          headers,',
      '        });',
      '      },',
      '    }),',
      "    route('/header-route-access-private.txt', {",
      '      access: [(request: AppRequest) =>',
      "        request.headers.get('x-principal') === 'victim'",
      '          ? true',
      "          : { kind: 'forbidden' as const }],",
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
      "          headers: { Vary: 'unsafe\\r\\nSet-Cookie: c2=owned' },",
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
      "    route('/header-route-typed-file.bin', {",
      "      access: publicAccess('public typed file route-response artifact proof'),",
      '      page() {',
      "        return respond.file(new TextEncoder().encode('PINNED_GENUINE_BYTES'), {",
      "          contentType: 'application/octet-stream',",
      "          filename: 'pinned-genuine.bin',",
      "          headers: { Vary: 'Accept-Encoding' },",
      '        });',
      '      },',
      '    }),',
      "    route('/header-route-omitted-policy.bin', {",
      "      access: publicAccess('public omitted route outcome policy artifact proof'),",
      '      page() {',
      "        return respond.file('OMITTED_POLICY_BYTES', {",
      "          contentType: 'application/octet-stream',",
      "          filename: 'prototype-safe.bin',",
      '        });',
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

function pipelinedTransportHeaderExchange(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1');
    let output = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the production transport-header pipeline proof.'));
    }, 5_000);
    socket.setEncoding('latin1');
    socket.once('connect', () => {
      socket.write(
        'GET /header-transport-unsafe.txt HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          'X-Declared-Length: 0\r\n\r\n' +
          'GET /header-sink-safe.txt HTTP/1.1\r\n' +
          'Host: 127.0.0.1\r\n' +
          'Connection: close\r\n\r\n',
      );
    });
    socket.on('data', (chunk) => {
      output += chunk;
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('end', () => {
      clearTimeout(timeout);
      resolve(output);
    });
  });
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
