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
    const manifest = { exports: { '.': './dist/index.mjs' }, name: '@kovojs/server' };
    writeFileSync(path.join(artifactRoot, '@kovojs/server/package.json'), JSON.stringify(manifest));
    const policy = policyFor(module, manifest);
    const policyPath = path.join(root, 'policy.json');
    writeFileSync(policyPath, policy);
    const certificatePath = path.join(root, 'certificate.json');
    writeFileSync(
      certificatePath,
      `${JSON.stringify({
        artifacts: [module],
        cap: { [module]: [] },
        domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
        doors: [],
        edges: [],
        opaque: [],
        policySha512: sha512(policy),
        roots: [],
        schema: 'kovo.certificate/v1',
      })}\n`,
    );
    let stdout = '';
    let stderr = '';
    const exitCode = await runKovoVerify(
      [certificatePath, '--policy', policyPath, '--artifacts', artifactRoot],
      {
        stderr: (text) => (stderr += text),
        stdout: (text) => (stdout += text),
      },
    );
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe(
      'kovo-verify/v1 PASS artifacts=1 edges=0 roots=0 doors=0 opaque=0 capabilities=0 findings=0\n',
    );
  });

  it('rejects a vacuous certificate instead of ignoring an installed artifact tree', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kovo-verify-cli-empty-certificate-'));
    roots.push(root);
    const artifactRoot = path.join(root, 'artifacts');
    mkdirSync(path.join(artifactRoot, '@kovojs/server/dist'), { recursive: true });
    writeFileSync(
      path.join(artifactRoot, '@kovojs/server/dist/index.mjs'),
      "import 'node:child_process';",
      'utf8',
    );
    const module = '@kovojs/server/dist/index.mjs';
    const manifest = { exports: { '.': './dist/index.mjs' }, name: '@kovojs/server' };
    writeFileSync(path.join(artifactRoot, '@kovojs/server/package.json'), JSON.stringify(manifest));
    const policy = policyFor(module, manifest);
    const policyPath = path.join(root, 'policy.json');
    writeFileSync(policyPath, policy);
    const certificatePath = path.join(root, 'certificate.json');
    writeFileSync(
      certificatePath,
      `${JSON.stringify({
        artifacts: [],
        cap: {},
        domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
        doors: [],
        edges: [],
        opaque: [],
        policySha512: sha512(policy),
        roots: [],
        schema: 'kovo.certificate/v1',
      })}\n`,
    );

    let stdout = '';
    let stderr = '';
    const exitCode = await runKovoVerify(
      [certificatePath, '--policy', policyPath, '--artifacts', artifactRoot],
      {
        stderr: (text) => (stderr += text),
        stdout: (text) => (stdout += text),
      },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toBe('');
    expect(stdout).toContain('kovo-verify/v1 FAIL');
  });

  it('uses exit 2 for usage errors', async () => {
    let stderr = '';
    await expect(
      runKovoVerify([], { stderr: (text) => (stderr += text), stdout: () => {} }),
    ).resolves.toBe(2);
    expect(stderr).toBe(
      'usage: kovo-verify <certificate.json> --policy <policy.json> --artifacts <root>\n',
    );
  });
});

function policyFor(module: string, manifest: { exports: { '.': string }; name: string }): string {
  return `${JSON.stringify(
    {
      artifacts: [{ path: module, sha512: sha512('export {};') }],
      doors: [],
      opaque: [],
      packages: [
        {
          manifest,
          name: manifest.name,
        },
      ],
      roots: [],
      schema: 'kovo.certificate-policy/v1',
    },
    null,
    2,
  )}\n`;
}

function sha512(bytes: string): string {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}
