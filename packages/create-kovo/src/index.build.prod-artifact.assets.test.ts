import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import { buildReusableProductionArtifact, signInDemoUser } from './index.build.test-support.js';

describe('create-kovo starter (build integration: production asset artifacts)', () => {
  it('serves referenced public assets from dynamic production node artifacts', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-public-asset-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Public Asset Proof' });
      linkStarterBuildDependencies(root);

      mkdirSync(join(root, 'public'), { recursive: true });
      writeFileSync(
        join(root, 'public/dogfood-marker.svg'),
        '<svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>',
        'utf8',
      );
      writeFileSync(join(root, 'public/emoji-💣.txt'), 'UNICODE_STATIC_ASSET', 'utf8');
      const appPath = join(root, 'src/app.tsx');
      writeFileSync(
        appPath,
        readFileSync(appPath, 'utf8').replace(
          '      <ContactsRegion />',
          '      <img src="/dogfood-marker.svg" alt="" />\n' +
            '      <a href="/emoji-💣.txt">Unicode asset</a>\n' +
            '      <ContactsRegion />',
        ),
        'utf8',
      );

      buildReusableProductionArtifact(root);

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
      const jar = new Map<string, string>();

      await fetchTextWhenReady(`${origin}/login`, output);
      await signInDemoUser(root, origin, jar, output);

      const homeResponse = await fetch(`${origin}/`, {
        headers: { cookie: cookieHeader(jar) },
      });
      expect(homeResponse.status).toBe(200);
      await expect(homeResponse.text()).resolves.toContain('src="/dogfood-marker.svg"');

      const assetResponse = await fetch(`${origin}/dogfood-marker.svg`);
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get('content-type')).toBe('image/svg+xml');
      await expect(assetResponse.text()).resolves.toBe(
        '<svg viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>',
      );

      // SPEC §6.6/§9.1: the emitted server uses the same Unicode-safe serializer as respond.file.
      // A non-ASCII basename must remain a valid Node header instead of throwing ERR_INVALID_CHAR.
      const unicodeAssetResponse = await fetch(`${origin}/emoji-💣.txt`);
      expect(unicodeAssetResponse.status).toBe(200);
      expect(unicodeAssetResponse.headers.get('content-disposition')).toBe(
        `inline; filename="emoji-_.txt"; filename*=UTF-8''emoji-%F0%9F%92%A3.txt`,
      );
      await expect(unicodeAssetResponse.text()).resolves.toBe('UNICODE_STATIC_ASSET');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});
