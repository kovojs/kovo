import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runKovoVerify } from './bin.js';
import { KOVO_CERTIFICATE_CAPABILITY_DOMAIN } from './index.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo-verify CLI', () => {
  it('prints a stable success report and returns zero', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-verify-cli-'));
    roots.push(root);
    const artifactRoot = path.join(root, 'artifacts');
    const module = '@kovojs/server/dist/index.mjs';
    const source = 'export {};';
    mkdirSync(path.join(artifactRoot, '@kovojs/server/dist'), { recursive: true });
    writeFileSync(path.join(artifactRoot, module), source, 'utf8');
    const certificatePath = path.join(root, 'certificate.json');
    writeFileSync(
      certificatePath,
      `${JSON.stringify({
        artifacts: [
          {
            path: module,
            sha512: `sha512-${createHash('sha512').update(source).digest('base64')}`,
          },
        ],
        cap: { [module]: [] },
        domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
        doors: [],
        edges: [],
        opaque: [],
        roots: [],
        schema: 'kovo.certificate/v1',
      })}\n`,
    );
    let stdout = '';
    let stderr = '';
    const exitCode = await runKovoVerify([certificatePath, '--artifacts', artifactRoot], {
      stderr: (text) => (stderr += text),
      stdout: (text) => (stdout += text),
    });
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe(
      'kovo-verify/v1 PASS artifacts=1 edges=0 roots=0 doors=0 opaque=0 capabilities=0 findings=0\n',
    );
  });

  it('uses exit 2 for usage errors', async () => {
    let stderr = '';
    await expect(
      runKovoVerify([], { stderr: (text) => (stderr += text), stdout: () => {} }),
    ).resolves.toBe(2);
    expect(stderr).toBe('usage: kovo-verify <certificate.json> --artifacts <root>\n');
  });
});
