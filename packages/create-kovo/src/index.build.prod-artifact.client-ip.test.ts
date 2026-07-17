import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import { buildReusableProductionArtifact } from './index.build.test-support.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: trusted client-IP artifacts)', () => {
  it('keeps all built-in trusted-proxy port carriers in canonical per-IP buckets', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-client-ip-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Client IP Proof' });
      linkStarterBuildDependencies(root);
      const appPath = join(root, 'src/app.tsx');
      const appSource = readFileSync(appPath, 'utf8');
      const anchor = '  queries: [contactsQuery],';
      if (!appSource.includes(anchor)) throw new TypeError('Missing starter query-list anchor.');
      writeFileSync(
        appPath,
        appSource.replace(
          anchor,
          [
            anchor,
            '  requestLimits: {',
            '    global: { max: 100, windowMs: 60_000 },',
            '    mutations: { global: { max: 100 }, perIp: { max: 100 } },',
            '    perIp: { max: 1, windowMs: 60_000 },',
            '    queries: { global: { max: 100 }, perIp: { max: 100 } },',
            '    trustedProxy: true,',
            '  },',
          ].join('\n'),
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
      await fetchTextWhenReady(`${origin}/api/health`, output);

      const carriers = [
        {
          first: { Forwarded: 'for="203.0.113.61:47011"' },
          label: 'Forwarded IPv4 port',
          second: { Forwarded: 'for="203.0.113.61:47012"' },
        },
        {
          first: { Forwarded: 'for="[2001:db8::61]:47011"' },
          label: 'Forwarded IPv6 port',
          second: { Forwarded: 'for="[2001:0DB8:0:0:0:0:0:61]:47012"' },
        },
        {
          first: { 'X-Forwarded-For': '203.0.113.62:47011' },
          label: 'X-Forwarded-For IPv4 port',
          second: { 'X-Forwarded-For': '203.0.113.62:47012' },
        },
        {
          first: { 'X-Forwarded-For': '[2001:db8::62]:47011' },
          label: 'X-Forwarded-For IPv6 port',
          second: { 'X-Forwarded-For': '[2001:0DB8:0:0:0:0:0:62]:47012' },
        },
        {
          first: { 'X-Real-IP': '203.0.113.63:47011' },
          label: 'X-Real-IP IPv4 port',
          second: { 'X-Real-IP': '203.0.113.63:47012' },
        },
        {
          first: { 'X-Real-IP': '[2001:db8::63]:47011' },
          label: 'X-Real-IP IPv6 port',
          second: { 'X-Real-IP': '[2001:0DB8:0:0:0:0:0:63]:47012' },
        },
      ] as const;

      for (const carrier of carriers) {
        const first = await fetch(`${origin}/api/health`, { headers: carrier.first });
        const second = await fetch(`${origin}/api/health`, { headers: carrier.second });
        expect(first.status, `${carrier.label}: ${await first.text()}\n${output()}`).toBe(200);
        expect(second.status, `${carrier.label}: ${await second.text()}\n${output()}`).toBe(429);
        expect(second.headers.get('retry-after'), carrier.label).toBeTruthy();
      }
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});
