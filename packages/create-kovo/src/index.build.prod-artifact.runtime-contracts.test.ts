import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { File } from 'node:buffer';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
} from './index.test-support.js';
import { addRuntimeContractProofs, buildProductionArtifact } from './index.build.test-support.js';

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

      await fetchTextWhenReady(`${origin}/runtime-contracts-proof`, output);
      const page = await fetch(`${origin}/runtime-contracts-proof`);
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
