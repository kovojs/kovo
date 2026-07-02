import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
  withStarterBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: paranoid runtime chokes)', () => {
  it('serves legitimate production routes and fails closed on unsafe response headers with static classifiers advisory', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-paranoid-runtime-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Paranoid Runtime Proof' });
      addParanoidRuntimeProofRoutes(root);
      linkStarterBuildDependencies(root);

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      const healthBody = await fetchTextWhenReady(`${origin}/api/health`, output);
      expect(healthBody).toContain('"ok":true');

      const safe = await fetch(`${origin}/paranoid-runtime-safe.txt`);
      await expect(safe.text()).resolves.toBe('paranoid runtime safe\n');
      expect(safe.status).toBe(200);
      expect(safe.headers.get('x-kovo-paranoid-proof')).toBe('safe');

      const unsafe = await fetch(`${origin}/paranoid-runtime-unsafe.txt`);
      const unsafeBody = await unsafe.text();
      expect(unsafe.status, unsafeBody).toBe(500);
      expect(unsafe.headers.get('x-kovo-paranoid-proof')).toBeNull();
      expect(unsafe.headers.getSetCookie()).toEqual([]);
      expect(unsafeBody).toContain('Server Error');
      expect(unsafeBody).not.toContain('Set-Cookie: paranoid=owned');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

function buildParanoidProductionArtifact(root: string): void {
  rmSync(join(root, '.kovo/cache'), { force: true, recursive: true });
  execFileSync(join(root, 'node_modules/.bin/kovo'), ['build', './src/app.tsx', '--no-cache'], {
    cwd: root,
    env: {
      ...withStarterBinOnPath(root),
      KOVO_PARANOID: '1',
    },
    stdio: 'pipe',
  });
}

function addParanoidRuntimeProofRoutes(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const withRespondImport = replaceRequired(
    app,
    '  redirect,\n  route,',
    '  redirect,\n  respond,\n  route,',
    'paranoid runtime proof response imports',
  );
  const withRoutes = replaceRequired(
    withRespondImport,
    "  routes: [\n    route('/', {",
    [
      '  routes: [',
      "    route('/paranoid-runtime-safe.txt', {",
      "      access: publicAccess('public paranoid runtime safe route'),",
      '      page() {',
      "        return respond.file('paranoid runtime safe\\n', {",
      "          contentType: 'text/plain; charset=utf-8',",
      "          headers: { 'X-Kovo-Paranoid-Proof': 'safe' },",
      '        });',
      '      },',
      '    }),',
      "    route('/paranoid-runtime-unsafe.txt', {",
      "      access: publicAccess('public paranoid runtime header choke proof'),",
      '      page() {',
      "        return respond.file('paranoid runtime unsafe\\n', {",
      "          contentType: 'text/plain; charset=utf-8',",
      "          headers: { 'X-Kovo-Paranoid-Proof': 'unsafe\\r\\nSet-Cookie: paranoid=owned' },",
      '        });',
      '      },',
      '    }),',
      "    route('/', {",
    ].join('\n'),
    'paranoid runtime proof routes',
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
