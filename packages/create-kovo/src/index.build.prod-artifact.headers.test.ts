import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  attributeValue,
  buildReusableProductionArtifact,
  firstFormHtml,
} from './index.build.test-support.js';
import {
  assertProdArtifactSinkCensus,
  readProductionGraph,
} from './index.build.prod-artifact.sink-census.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
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
              'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts observes route outcome headers and KV415 CRLF failure in the production server artifact',
            kind: 'proof',
          },
          sink: 'response headers / route outcome headers',
          witnesses: [
            'finalizeResponseHeaders',
            'ResponseHeaderChannelError',
            'X-Kovo-Header-Proof',
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

      const unsafe = await fetch(`${origin}/header-sink-unsafe.txt`);
      const unsafeBody = await unsafe.text();
      expect(unsafe.status, unsafeBody).toBe(500);
      expect(unsafe.headers.get('x-kovo-header-proof')).toBeNull();
      expect(unsafe.headers.getSetCookie()).toEqual([]);
      expect(unsafeBody).toContain('Server Error');

      const cookiePage = await fetch(`${origin}/header-cookie-proof`);
      const cookieForm = firstFormHtml(await cookiePage.text());
      const action = attributeValue(cookieForm, 'action');
      if (!action) throw new Error('Expected header cookie proof form action.');

      const cookie = await fetch(`${origin}${action}`, {
        body: new URLSearchParams({ 'Kovo-Idem': `cookie-${Date.now()}`, mode: 'safe' }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
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
        body: new URLSearchParams({ 'Kovo-Idem': `unsafe-cookie-${Date.now()}`, mode: 'unsafe' }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'Kovo-Fragment': 'true',
          origin,
        },
        method: 'POST',
      });
      const unsafeCookieBody = await unsafeCookie.text();
      expect(unsafeCookie.status, unsafeCookieBody).toBe(500);
      expect(unsafeCookie.headers.getSetCookie()).toEqual([]);
      expect(unsafeCookieBody).not.toContain('Set-Cookie: c2=owned');

      const rawEndpoint = await fetch(`${origin}/raw-header-endpoint`, { redirect: 'manual' });
      await expect(rawEndpoint.text()).resolves.toBe('raw endpoint header proof');
      expect(rawEndpoint.status).toBe(200);
      const rawCookies = rawEndpoint.headers.getSetCookie();
      expect(rawCookies).toHaveLength(1);
      expect(rawCookies[0]).toContain('raw_sid=abc');
      expect(rawCookies[0]).toContain('HttpOnly');
      expect(rawCookies[0]).toContain('Secure');
      expect(rawCookies[0]).toContain('SameSite=Lax');

      const rawRedirect = await fetch(`${origin}/raw-header-redirect`, { redirect: 'manual' });
      const rawRedirectBody = await rawRedirect.text();
      expect(rawRedirect.status, rawRedirectBody).toBe(500);
      expect(rawRedirect.headers.get('location')).toBeNull();
      expect(rawRedirect.headers.getSetCookie()).toEqual([]);
      expect(rawRedirectBody).toContain('Server Error');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

function addHeaderSinkProofRoutes(root: string): void {
  writeFileSync(
    join(root, 'src/header-cookie-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { mutation, mutationFormAttributes, publicAccess, s } from '@kovojs/server';",
      '',
      'export const headerCookieProof = mutation({',
      "  access: publicAccess('public Set-Cookie response header sink proof'),",
      '  csrf: false,',
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
    '  redirect,\n  respond,\n  route,',
    'response-header proof response imports',
  );
  const withRawEndpoint = replaceRequired(
    withRespondImport,
    'const mutationReplayStore = createMemoryMutationReplayStore();',
    [
      'const mutationReplayStore = createMemoryMutationReplayStore();',
      "const rawHeaderEndpoint = endpoint('/raw-header-endpoint', {",
      "  access: publicAccess('public raw endpoint Set-Cookie header sink proof'),",
      "  auth: { kind: 'none', justification: 'public read-only header sink proof endpoint' },",
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
      "    route('/header-sink-safe.txt', {",
      "      access: publicAccess('public response header sink proof'),",
      '      page() {',
      "        return respond.file('safe header proof\\n', {",
      "          contentType: 'text/plain; charset=utf-8',",
      "          headers: { 'X-Kovo-Header-Proof': 'safe-header-value' },",
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
