import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import { buildProductionArtifact } from './index.build.test-support.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: redirect and capability URL artifacts)', () => {
  it('finalizes redirect Location and capability download URLs in the production server artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-redirect-capability-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Redirect Capability Proof' });
      addRedirectAndCapabilityProof(root);
      linkStarterBuildDependencies(root);

      buildProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      const capabilityPage = await fetchTextWhenReady(`${origin}/capability-url-proof`, output);
      const href = capabilityPage.match(/<a\b[^>]*id="capability-proof"[^>]*href="([^"]+)"/)?.[1];
      expect(href).toMatch(/^\/capability-download\/receipts\/ord_1\.txt\?kovo-cap=/u);
      if (href === undefined) throw new Error('Expected capability proof link href.');

      const redirect = await fetch(`${origin}/redirect-location-unsafe`, { redirect: 'manual' });
      expect(redirect.status).toBe(303);
      expect(redirect.headers.get('location')).toBe('/');
      expect(redirect.headers.getSetCookie()).toEqual([]);

      const download = await fetch(`${origin}${href}`);
      await expect(download.text()).resolves.toBe('capability secret\n');
      expect(download.status).toBe(200);
      expect(download.headers.get('cache-control')).toBe('private, no-store');
      expect(download.headers.get('content-disposition')).toBe('attachment; filename="ord_1.txt"');

      const tamperedHref = href.replace('/receipts/ord_1.txt?', '/receipts/ord_2.txt?');
      const tampered = await fetch(`${origin}${tamperedHref}`);
      const tamperedBody = await tampered.text();
      expect(tampered.status).toBe(404);
      expect(tamperedBody).toBe('Not Found');
      expect(tamperedBody).not.toContain('capability secret');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

function addRedirectAndCapabilityProof(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const withStorageImports = replaceRequired(
    app,
    [
      '  createApp,',
      '  createMemoryMutationReplayStore,',
      '  createMemoryVersionedClientModuleRegistry,',
    ].join('\n'),
    [
      '  createApp,',
      '  createMemoryMutationReplayStore,',
      '  createMemoryStorage,',
      '  createMemoryVersionedClientModuleRegistry,',
      '  createStorageDownloadEndpoint,',
    ].join('\n'),
    'capability proof imports',
  );
  const withStorage = replaceRequired(
    withStorageImports,
    'const mutationReplayStore = createMemoryMutationReplayStore();',
    [
      'const mutationReplayStore = createMemoryMutationReplayStore();',
      'const capabilityProofStorage = createMemoryStorage();',
      "await capabilityProofStorage.put('receipts/ord_1.txt', 'capability secret\\n', {",
      "  contentType: 'text/plain',",
      "  metadata: { filename: 'ord_1.txt' },",
      '});',
      'const capabilityDownloadEndpoint = createStorageDownloadEndpoint({',
      "  basePath: '/capability-download',",
      '  secret: appCsrf.secret,',
      '  storage: capabilityProofStorage,',
      '});',
    ].join('\n'),
    'capability proof storage setup',
  );
  const withEndpoint = replaceRequired(
    withStorage,
    '  endpoints: [healthEndpoint],',
    '  endpoints: [healthEndpoint, capabilityDownloadEndpoint],',
    'capability proof endpoint registration',
  );
  const withRoutes = replaceRequired(
    withEndpoint,
    "  routes: [\n    route('/', {",
    [
      '  routes: [',
      "    route('/redirect-location-unsafe', {",
      "      access: publicAccess('public redirect Location sink proof'),",
      '      page() {',
      "        return { location: 'https://evil.example/phish\\r\\nSet-Cookie: c2=owned', status: 303 };",
      '      },',
      '    }),',
      "    route('/capability-url-proof', {",
      "      access: publicAccess('public capability URL sink proof'),",
      '      async page(context) {',
      "        if (context.signUrl === undefined) throw new Error('missing ctx.signUrl');",
      "        const signed = await context.signUrl({ key: 'receipts/ord_1.txt', expiresIn: 60_000 });",
      '        return (',
      '          <main>',
      '            <a id="capability-proof" href={signed.url}>',
      '              Download capability',
      '            </a>',
      '          </main>',
      '        );',
      '      },',
      '    }),',
      "    route('/', {",
    ].join('\n'),
    'redirect and capability proof routes',
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
