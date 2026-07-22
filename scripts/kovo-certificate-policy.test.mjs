import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyCommittedKovoCertificate } from './check-kovo-certificate.mjs';
import { packAndReadManifest } from './kovo-certificate-policy.mjs';

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('reviewer certificate policy packing', () => {
  it('proves policy proposal and checking cannot run pack lifecycle hooks', () => {
    const fixture = lifecycleWorkspace();
    const packageDirectory = () => fixture.packageRoot;
    const manifest = packAndReadManifest('@kovojs/lifecycle-fixture', {
      cwd: fixture.root,
      packageDirectory,
    });
    expect(manifest.name).toBe('@kovojs/lifecycle-fixture');
    expect(existsSync(fixture.marker)).toBe(false);

    const policyFile = path.join(fixture.root, 'policy.json');
    const certificateFile = path.join(fixture.root, 'certificate.json');
    writeFileSync(
      policyFile,
      JSON.stringify({ packages: [{ name: '@kovojs/lifecycle-fixture' }] }),
    );
    writeFileSync(certificateFile, '{}\n');
    expect(
      verifyCommittedKovoCertificate({
        certificateFile,
        cwd: fixture.root,
        exec: () => {
          expect(existsSync(fixture.marker)).toBe(false);
          return 'lifecycle-free checker pack PASS\n';
        },
        packageDirectory,
        policyFile,
      }),
    ).toBe('lifecycle-free checker pack PASS\n');
    expect(existsSync(fixture.marker)).toBe(false);
  });
});

function lifecycleWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-certificate-lifecycle-'));
  roots.push(root);
  const packageRoot = path.join(root, 'packages/fixture');
  const marker = path.join(root, 'lifecycle-ran.txt');
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: '@kovojs/lifecycle-fixture',
        scripts: {
          postpack: 'node marker.mjs',
          prepack: 'node marker.mjs',
          prepare: 'node marker.mjs',
        },
        version: '1.0.0',
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(packageRoot, 'marker.mjs'),
    "import { appendFileSync } from 'node:fs'; appendFileSync(new URL('../../lifecycle-ran.txt', import.meta.url), 'ran\\n');\n",
  );
  return { marker, packageRoot, root };
}
