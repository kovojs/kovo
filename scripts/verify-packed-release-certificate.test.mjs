import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import {
  canonicalizeTarballBytes,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import { repoRoot, tarballDir } from './release-packages.mjs';
import { verifyPackedReleaseCertificate } from './verify-packed-release-certificate.mjs';

const installedVerifierManifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages', 'verify', 'package.json'), 'utf8'),
);
const [parserDependency] = Object.entries(installedVerifierManifest.dependencies ?? {});
if (parserDependency === undefined) throw new Error('@kovojs/verify has no parser dependency');

describe('final packed release certificate', () => {
  it('materializes and verifies the exact attested tarball bytes', () => {
    const fixture = releaseFixture();
    const exec = vi.fn((command, args) => {
      expect(command).toBe(process.execPath);
      const artifactsIndex = args.indexOf('--artifacts');
      expect(artifactsIndex).toBeGreaterThan(-1);
      const packageRoot = path.join(args[artifactsIndex + 1], '@kovojs', 'verify');
      expect(args[0]).toBe(path.join(packageRoot, 'dist', 'bin.mjs'));
      expect(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).toBe(
        `${JSON.stringify(fixture.packedPackage.manifest, null, 2)}\n`,
      );
      expect(readFileSync(path.join(packageRoot, 'dist', 'runtime.mjs'), 'utf8')).toBe(
        'export const releaseFixture = true;\n',
      );
      return 'PASS final packed release certificate\n';
    });

    try {
      expect(
        verifyPackedReleaseCertificate({
          certificateFile: fixture.certificateFile,
          exec,
          expectedPackages: [
            {
              manifest: fixture.sourceManifest,
              name: fixture.packedPackage.name,
              version: fixture.packedPackage.version,
            },
          ],
          packedManifestFile: fixture.packedManifestFile,
          policyFile: fixture.policyFile,
        }),
      ).toBe('PASS final packed release certificate\n');
      expect(exec).toHaveBeenCalledTimes(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects final bytes that do not match the packed release attestation', () => {
    const fixture = releaseFixture();
    const attackedManifest = JSON.parse(readFileSync(fixture.packedManifestFile, 'utf8'));
    attackedManifest.packages[0].sha512 = `sha512-${Buffer.alloc(64).toString('base64')}`;
    writeFileSync(fixture.packedManifestFile, `${JSON.stringify(attackedManifest)}\n`);

    try {
      expect(() =>
        verifyPackedReleaseCertificate({
          certificateFile: fixture.certificateFile,
          exec: vi.fn(),
          expectedPackages: [
            {
              manifest: fixture.sourceManifest,
              name: fixture.packedPackage.name,
              version: fixture.packedPackage.version,
            },
          ],
          packedManifestFile: fixture.packedManifestFile,
          policyFile: fixture.policyFile,
        }),
      ).toThrow('tarball sha512 attestation mismatch');
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects an unauthenticated verifier before a fake-success executable can run', () => {
    const fixture = releaseFixture();
    const policy = JSON.parse(readFileSync(fixture.policyFile, 'utf8'));
    policy.artifacts.find((artifact) =>
      artifact.path.endsWith('/bin.mjs'),
    ).sha512 = `sha512-${Buffer.alloc(64).toString('base64')}`;
    writeFileSync(fixture.policyFile, `${JSON.stringify(policy)}\n`);
    const exec = vi.fn(() => 'PASS from poisoned build output\n');

    try {
      expect(() =>
        verifyPackedReleaseCertificate({
          certificateFile: fixture.certificateFile,
          exec,
          expectedPackages: [
            {
              manifest: fixture.sourceManifest,
              name: fixture.packedPackage.name,
              version: fixture.packedPackage.version,
            },
          ],
          packedManifestFile: fixture.packedManifestFile,
          policyFile: fixture.policyFile,
        }),
      ).toThrow('does not match its reviewer-owned sha512');
      expect(exec).not.toHaveBeenCalled();
    } finally {
      fixture.cleanup();
    }
  });
});

function releaseFixture() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'kovo-packed-certificate-test-'));
  const tarballRoot = path.join(tarballDir, `certificate-test-${randomUUID()}`);
  mkdirSync(tarballRoot, { recursive: true });
  const packageManifest = {
    dependencies: { [parserDependency[0]]: parserDependency[1] },
    name: '@kovojs/verify',
    version: '1.2.3',
  };
  const sourceManifest = { ...packageManifest, publishConfig: {} };
  const binBytes = Buffer.from('import "./runtime.mjs";\n');
  const runtimeBytes = Buffer.from('export const releaseFixture = true;\n');
  const tarballBytes = canonicalizeTarballBytes(
    fixtureTarball([
      fixtureEntry('package/package.json', JSON.stringify(packageManifest)),
      fixtureEntry('package/dist/bin.mjs', binBytes),
      fixtureEntry('package/dist/runtime.mjs', runtimeBytes),
    ]),
  );
  const tarballFile = path.join(tarballRoot, 'kovojs-verify-1.2.3.tgz');
  writeFileSync(tarballFile, tarballBytes);
  const packedPackage = {
    files: validatedPackageTarballEntries(tarballBytes)
      .map((entry) => entry.name)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    manifest: packageManifest,
    name: packageManifest.name,
    sha512: `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`,
    tarball: path.relative(repoRoot, tarballFile),
    version: packageManifest.version,
  };
  const packedManifestFile = path.join(tempRoot, 'packed-packages.json');
  const policyFile = path.join(tempRoot, 'policy.json');
  const certificateFile = path.join(tempRoot, 'certificate.json');
  writeFileSync(packedManifestFile, `${JSON.stringify({ packages: [packedPackage] })}\n`);
  writeFileSync(
    policyFile,
    `${JSON.stringify({
      artifacts: [
        {
          path: '@kovojs/verify/dist/bin.mjs',
          sha512: `sha512-${createHash('sha512').update(binBytes).digest('base64')}`,
        },
        {
          path: '@kovojs/verify/dist/runtime.mjs',
          sha512: `sha512-${createHash('sha512').update(runtimeBytes).digest('base64')}`,
        },
      ],
      packages: [{ manifest: packageManifest, name: packageManifest.name }],
    })}\n`,
  );
  writeFileSync(certificateFile, '{}\n');

  return {
    certificateFile,
    cleanup() {
      rmSync(tempRoot, { force: true, recursive: true });
      rmSync(tarballRoot, { force: true, recursive: true });
    },
    packedManifestFile,
    packedPackage,
    policyFile,
    sourceManifest,
  };
}

function fixtureEntry(name, body) {
  return { body: Buffer.from(body), mode: 0o644, name };
}

function fixtureTarball(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    writeOctal(header, 100, 108, entry.mode);
    writeOctal(header, 108, 116, 501);
    writeOctal(header, 116, 124, 501);
    writeOctal(header, 124, 136, entry.body.byteLength);
    writeOctal(header, 136, 148, 123);
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    Buffer.from('ustar\0').copy(header, 257);
    Buffer.from('00').copy(header, 263);
    const checksum = header
      .reduce((sum, byte) => sum + byte, 0)
      .toString(8)
      .padStart(6, '0');
    header.write(checksum, 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 0x20;
    blocks.push(
      header,
      entry.body,
      Buffer.alloc(Math.ceil(entry.body.byteLength / 512) * 512 - entry.body.byteLength),
    );
  }
  blocks.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
  compressed[9] = 255;
  return compressed;
}

function writeOctal(header, start, end, value) {
  header.write(value.toString(8).padStart(end - start - 1, '0'), start, end - start - 1, 'ascii');
  header[end - 1] = 0;
}
