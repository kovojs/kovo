import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { File } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
import {
  addRuntimeContractProofs,
  buildReusableProductionArtifact,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: production runtime contract artifacts)', () => {
  it('serves query warnings and upload MIME sniffing through the production build artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-runtime-contracts-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Runtime Contract Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeContractProofs(root);

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

      await fetchTextWhenReady(`${origin}/runtime-contracts-proof`, output);
      const page = await fetch(`${origin}/runtime-contracts-proof`);
      const jar = new Map<string, string>();
      mergeCookies(jar, page.headers.getSetCookie());
      const pageHtml = await page.text();
      expect(page.status).toBe(200);
      expect(page.headers.get('kovo-warn')).toBe('QUERY_LIST_LIMIT $.rows;limit=2');
      expect(pageHtml).toContain('data-proof="runtime-contracts"');
      expect(pageHtml).toContain('data-warning-count="2"');
      expect(pageHtml).toContain('item-0,item-1');
      expect(pageHtml).not.toContain('item-2');

      const queryRead = await fetch(`${origin}/_q/runtime-contract-proofs/warning-items-query`);
      const queryBody = await queryRead.text();
      expect(queryRead.status).toBe(200);
      expect(queryRead.headers.get('kovo-warn')).toBe('QUERY_LIST_LIMIT $.rows;limit=2');
      expect(queryBody).toContain(
        '<kovo-query name="runtime-contract-proofs/warning-items-query">',
      );
      expect(queryBody).toContain('"label":"item-1"');
      expect(queryBody).not.toContain('"label":"item-2"');

      const proofRoot = rootElementWithAttribute(pageHtml, 'data-proof', 'runtime-contracts');
      const liveTarget = requiredAttribute(proofRoot, 'kovo-fragment-target');
      const liveComponent = requiredAttribute(proofRoot, 'kovo-live-component');
      const liveToken = requiredAttribute(proofRoot, 'kovo-live-token');
      const liveDeps = requiredAttribute(proofRoot, 'kovo-deps');
      const liveProps = attributeValue(proofRoot, 'kovo-props') ?? '{}';
      const refresh = new FormData();
      refresh.set('reason', 'prod-artifact-contract');
      const mutationRefresh = await fetch(
        `${origin}/_m/runtime-contract-proofs/refresh-warning-items`,
        {
          body: refresh,
          headers: {
            cookie: cookieHeader(jar),
            'Kovo-Current-Url': `${origin}/runtime-contracts-proof`,
            'Kovo-Fragment': 'true',
            'Kovo-Live-Targets': `${liveTarget}#${liveComponent}@${liveToken}:${liveProps}`,
            'Kovo-Targets': `${liveTarget}=${liveDeps}`,
          },
          method: 'POST',
        },
      );
      const mutationRefreshBody = await mutationRefresh.text();
      expect(mutationRefresh.status, `${mutationRefreshBody}\n${output()}`).toBe(200);
      expect(mutationRefresh.headers.get('kovo-warn')).toContain('QUERY_LIST_LIMIT $.rows;limit=2');
      expect(mutationRefreshBody).toContain(
        '<kovo-query name="runtime-contract-proofs/warning-items-query">',
      );
      expect(mutationRefreshBody).toContain('<kovo-fragment');
      expect(mutationRefreshBody).toContain('data-warning-count="2"');
      expect(mutationRefreshBody).toContain('item-0,item-1');
      expect(mutationRefreshBody).not.toContain('item-2');

      const refreshedRoot = rootElementWithAttribute(
        mutationRefreshBody,
        'data-proof',
        'runtime-contracts',
      );
      const refreshedTarget = requiredAttribute(refreshedRoot, 'kovo-fragment-target');
      const refreshedComponent = requiredAttribute(refreshedRoot, 'kovo-live-component');
      const refreshedToken = requiredAttribute(refreshedRoot, 'kovo-live-token');
      const refreshedDeps = requiredAttribute(refreshedRoot, 'kovo-deps');
      const refreshedProps = attributeValue(refreshedRoot, 'kovo-props') ?? '{}';
      const secondRefresh = await fetch(
        `${origin}/_m/runtime-contract-proofs/refresh-warning-items`,
        {
          body: new URLSearchParams({ reason: 'prod-artifact-second-refresh' }),
          headers: {
            cookie: cookieHeader(jar),
            'Kovo-Current-Url': `${origin}/runtime-contracts-proof`,
            'Kovo-Fragment': 'true',
            'Kovo-Live-Targets': `${refreshedTarget}#${refreshedComponent}@${refreshedToken}:${refreshedProps}`,
            'Kovo-Targets': `${refreshedTarget}=${refreshedDeps}`,
          },
          method: 'POST',
        },
      );
      const secondRefreshBody = await secondRefresh.text();
      expect(secondRefresh.status, `${secondRefreshBody}\n${output()}`).toBe(200);
      expect(secondRefreshBody).toContain('<kovo-fragment');
      expect(secondRefreshBody).toContain('data-warning-count="2"');

      const syncParse = await fetch(
        `${origin}/_q/runtime-contract-proofs/sync-verified-file-parse-query`,
      );
      const syncParseBody = await syncParse.text();
      expect(syncParse.status).toBe(200);
      expect(syncParseBody).toContain('"ok":true');
      expect(syncParseBody).toContain(
        'verified file type checks require async parsing; call parseAsync',
      );

      const forgedHtmlUpload = new FormData();
      forgedHtmlUpload.set(
        'avatar',
        new File(['<html><script>alert(document.cookie)</script></html>'], 'avatar.png', {
          type: 'image/png',
        }) as unknown as Blob,
      );
      forgedHtmlUpload.set('Kovo-Idem', `forged-${Date.now()}`);
      const rejected = await fetch(`${origin}/_m/runtime-contract-proofs/accept-png-upload`, {
        body: forgedHtmlUpload,
        headers: {
          'Kovo-Form-Target': 'runtime-upload-form',
          'Kovo-Fragment': 'true',
          origin,
        },
        method: 'POST',
      });
      const rejectedBody = await rejected.text();
      expect(rejected.status).toBe(422);
      expect(rejectedBody).toContain('Expected file type image/png');

      const png = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
      ]);
      const clientMimeLie = new FormData();
      clientMimeLie.set(
        'avatar',
        new File([png], 'avatar.png', { type: 'text/html' }) as unknown as Blob,
      );
      clientMimeLie.set('Kovo-Idem', `accepted-${Date.now()}`);
      const accepted = await fetch(`${origin}/_m/runtime-contract-proofs/accept-png-upload`, {
        body: clientMimeLie,
        headers: {
          'Kovo-Fragment': 'true',
          origin,
        },
        method: 'POST',
      });
      await accepted.text();
      expect(accepted.status).toBe(200);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

function rootElementWithAttribute(html: string, name: string, value: string): string {
  const pattern = new RegExp(
    `<[A-Za-z][^>]*\\b${escapeRegExp(name)}="${escapeRegExp(value)}"[^>]*>`,
  );
  const match = pattern.exec(html);
  if (!match) throw new Error(`Missing element with ${name}="${value}" in built artifact.`);
  return match[0];
}

function requiredAttribute(tag: string, name: string): string {
  const value = attributeValue(tag, name);
  if (value === undefined) throw new Error(`Missing ${name} in ${tag}`);
  return value;
}

function attributeValue(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`);
  const match = pattern.exec(tag);
  return match === null ? undefined : decodeAttribute(match[1] ?? '');
}

function decodeAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
