import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildParanoidProductionArtifact } from './index.build.test-support.js';
import { writeKovoProject } from './index.js';
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

// This suite proves, from a BUILT paranoid production artifact of a default create-kovo app, that
// request-authenticity (CSRF) is enforced by default for unsafe-verb requests (SPEC §6.6/§9.1).
// The single runtime refusal point is `validateCsrfToken` in packages/server/src/csrf.ts, which
// first runs the fail-closed Origin floor (`verifyCsrfRequestOriginFloor`) and then the
// synchronizer-token check. It is the uniform gate for mutations (mutation.ts) and endpoints
// (app-dispatch.ts). The proof uses a PUBLIC-access, default-CSRF mutation so a refusal is
// CSRF-specific (never confounded by an auth/authz block), and a module-level side-effect log
// proves the handler only ever runs for the same-origin, valid-token positive control.
describe('create-kovo starter (build integration: production CSRF artifact)', () => {
  // @kovo-security-certifies KV418 csrf-cross-origin-refusal-prod-artifact
  it('refuses cross-origin and missing-token unsafe requests to a default-CSRF mutation from the paranoid production artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-csrf-refusal-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Prod CSRF Refusal Proof' });
      linkStarterBuildDependencies(root);
      addCsrfDefaultRefusalProof(root);

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'test',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;
      const mutationUrl = `${origin}/_m/csrf-proof/csrf-probe`;

      // Wait for the server to come up, then mint a valid same-origin token plus the
      // framework-owned anonymous CSRF binding cookie (SPEC §6.6/§9.1).
      await fetchTextWhenReady(`${origin}/api/csrf-probe-count`, output);
      const mintResponse = await fetch(`${origin}/api/csrf-probe-token`);
      const jar = new Map<string, string>();
      mergeCookies(jar, mintResponse.headers.getSetCookie());
      const { token } = (await mintResponse.json()) as { field: string; token: string };
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      const formEncoded = 'application/x-www-form-urlencoded';

      // NEGATIVE 1 — cross-origin: a foreign Origin header with a real binding cookie AND a valid
      // token. The Origin floor (verifyCsrfRequestOriginFloor) rejects it before the token check.
      const crossOrigin = await fetch(mutationUrl, {
        body: new URLSearchParams({
          csrf: token,
          'Kovo-Idem': crypto.randomUUID(),
          marker: 'cross-origin-attempt',
        }),
        headers: {
          'content-type': formEncoded,
          cookie: cookieHeader(jar),
          origin: 'https://evil.example',
        },
        method: 'POST',
        redirect: 'manual',
      });
      const crossOriginBody = await crossOrigin.text();
      expect(crossOrigin.status, crossOriginBody).toBe(422);
      expect(crossOriginBody).toContain('data-error-code="CSRF"');

      // NEGATIVE 2 — same-origin but NO CSRF token: the synchronizer-token check rejects it.
      const missingToken = await fetch(mutationUrl, {
        body: new URLSearchParams({
          'Kovo-Idem': crypto.randomUUID(),
          marker: 'missing-token-attempt',
        }),
        headers: { 'content-type': formEncoded, cookie: cookieHeader(jar), origin },
        method: 'POST',
        redirect: 'manual',
      });
      const missingTokenBody = await missingToken.text();
      expect(missingToken.status, missingTokenBody).toBe(422);
      expect(missingTokenBody).toContain('data-error-code="CSRF"');

      // NEGATIVE 3 — no Origin header at all (fail-closed): the floor rejects even a valid token.
      const noOrigin = await fetch(mutationUrl, {
        body: new URLSearchParams({
          csrf: token,
          'Kovo-Idem': crypto.randomUUID(),
          marker: 'no-origin-attempt',
        }),
        headers: { 'content-type': formEncoded, cookie: cookieHeader(jar) },
        method: 'POST',
        redirect: 'manual',
      });
      const noOriginBody = await noOrigin.text();
      expect(noOrigin.status, noOriginBody).toBe(422);
      expect(noOriginBody).toContain('data-error-code="CSRF"');

      // POSITIVE control — same-origin Origin + valid token + binding cookie: the handler runs.
      // This proves the refusals above are CSRF-specific, not a blanket block on the mutation.
      const positiveMarker = `csrf-allowed-${Date.now()}`;
      const allowed = await fetch(mutationUrl, {
        body: new URLSearchParams({
          csrf: token,
          'Kovo-Idem': crypto.randomUUID(),
          marker: positiveMarker,
        }),
        headers: { 'content-type': formEncoded, cookie: cookieHeader(jar), origin },
        method: 'POST',
        redirect: 'manual',
      });
      const allowedBody = await allowed.text();
      expect([200, 303], allowedBody).toContain(allowed.status);

      // The side-effect log proves the handler ran EXACTLY once — only for the positive control.
      // None of the three refused requests ever reached the handler.
      const countResponse = await fetch(`${origin}/api/csrf-probe-count`);
      const count = (await countResponse.json()) as { count: number; markers: string[] };
      expect(count.markers).toEqual([positiveMarker]);
      expect(count.count).toBe(1);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 240_000);
});

/**
 * Add a PUBLIC-access, default-CSRF mutation plus two read-only GET endpoints (a token mint and a
 * handler-run counter). Because the mutation is public, the ONLY thing that can refuse an unsafe
 * request is the CSRF floor — so a refusal is provably CSRF-specific (SPEC §6.6/§9.1).
 */
function addCsrfDefaultRefusalProof(root: string): void {
  writeFileSync(
    join(root, 'src/csrf-proof.ts'),
    [
      "import { endpoint, mintCsrfField, mutation, publicAccess, s } from '@kovojs/server';",
      '',
      "import { appCsrf } from './auth.js';",
      '',
      "const publicProof = publicAccess('public default-CSRF refusal proof');",
      '',
      '// Module-level side-effect log. A marker only lands here if the mutation handler actually',
      '// ran — i.e. the request passed the default CSRF floor (SPEC §6.6/§9.1). Read back by the',
      '// count endpoint so the test can prove no forged/missing-token/cross-origin request ran it.',
      'const csrfProbeMarkers: string[] = [];',
      '',
      'export const csrfProbe = mutation({',
      '  access: publicProof,',
      '  // Default CSRF for an unsafe verb (NOT csrf: false). This is the posture under proof.',
      '  csrf: appCsrf,',
      '  input: s.object({ marker: s.string() }),',
      '  handler(input: { marker: string }) {',
      '    csrfProbeMarkers.push(input.marker);',
      '    return { ok: true };',
      '  },',
      '});',
      "(csrfProbe as { key: string }).key = 'csrf-proof/csrf-probe';",
      '',
      '// Read-only GET that mints a valid same-origin CSRF token bound to csrfProbe, plus the',
      '// framework-owned anonymous binding cookie. Uses the SAME secret/field the mutation validates',
      '// with (appCsrf) and forces the anonymous binding (sessionId: () => undefined) so the minted',
      '// token round-trips an anonymous POST. Only the positive control uses it.',
      "export const csrfProbeTokenEndpoint = endpoint('/api/csrf-probe-token', {",
      '  access: publicProof,',
      "  auth: { justification: 'read-only CSRF token mint for default-CSRF proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only token mint, no state change',",
      '  async handler(request: Request) {',
      '    const minted = mintCsrfField(request, {',
      '      field: appCsrf.field,',
      '      secret: appCsrf.secret,',
      '      sessionId: () => undefined,',
      '      mutation: csrfProbe,',
      '    });',
      "    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };",
      "    if (minted.setCookie) headers['Set-Cookie'] = minted.setCookie;",
      '    return Response.json({ field: minted.field, token: minted.token }, { headers });',
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only CSRF token mint for default-CSRF proof',",
      '  // The mint sets the framework-owned anonymous CSRF binding cookie (SPEC §6.6/§9.1),',
      '  // so this read-only endpoint declares Set-Cookie as a reserved response header.',
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store', reservedHeaders: ['Set-Cookie'] },",
      '});',
      '',
      '// Read-only GET reporting how many times the CSRF-protected handler actually ran.',
      "export const csrfProbeCountEndpoint = endpoint('/api/csrf-probe-count', {",
      '  access: publicProof,',
      "  auth: { justification: 'read-only CSRF probe count for default-CSRF proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only probe count, no state change',",
      '  async handler() {',
      '    return Response.json(',
      '      { count: csrfProbeMarkers.length, markers: csrfProbeMarkers },',
      "      { headers: { 'Cache-Control': 'no-store' } },",
      '    );',
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only CSRF probe count for default-CSRF proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { addContact } from './mutations.js';",
    [
      "import { addContact } from './mutations.js';",
      "import { csrfProbe, csrfProbeCountEndpoint, csrfProbeTokenEndpoint } from './csrf-proof.js';",
    ].join('\n'),
    'csrf proof app import',
  );
  app = replaceRequired(
    app,
    '  endpoints: [healthEndpoint],',
    '  endpoints: [healthEndpoint, csrfProbeCountEndpoint, csrfProbeTokenEndpoint],',
    'csrf proof endpoint registration',
  );
  app = replaceRequired(
    app,
    '  mutations: [addContact, appSignIn, appSignOut],',
    '  mutations: [addContact, csrfProbe, appSignIn, appSignOut],',
    'csrf proof mutation registration',
  );
  writeFileSync(appPath, app, 'utf8');
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
