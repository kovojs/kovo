import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  canonicalizeTarballBytes,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import { sealPackedReleasePayload } from './verify-packed-release-payload.mjs';

describe('packed release payload sealing', () => {
  it('snapshots and materializes only the exact bounded regular-file census', () => {
    const fixture = payloadFixture();
    try {
      expect(
        sealPackedReleasePayload({
          expectedPackages: fixture.expectedPackages,
          inputRoot: fixture.inputRoot,
          outputRoot: fixture.outputRoot,
        }),
      ).toHaveLength(1);
      expect(readFileSync(path.join(fixture.outputRoot, 'packed-packages.json'))).toEqual(
        readFileSync(path.join(fixture.inputRoot, 'packed-packages.json')),
      );
      expect(readFileSync(path.join(fixture.outputRoot, 'tarballs', fixture.tarballName))).toEqual(
        fixture.tarballBytes,
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects surplus files and symlink aliases before creating the sealed root', () => {
    for (const attack of [
      (fixture) => writeFileSync(path.join(fixture.inputRoot, 'surplus'), 'smuggled'),
      (fixture) => {
        rmSync(path.join(fixture.inputRoot, 'tarballs', fixture.tarballName));
        symlinkSync(
          path.join(fixture.inputRoot, 'packed-packages.json'),
          path.join(fixture.inputRoot, 'tarballs', fixture.tarballName),
        );
      },
      (fixture) => writeFileSync(path.join(fixture.inputRoot, 'tarballs', 'extra.tgz'), 'extra'),
    ]) {
      const fixture = payloadFixture();
      try {
        attack(fixture);
        expect(() =>
          sealPackedReleasePayload({
            expectedPackages: fixture.expectedPackages,
            inputRoot: fixture.inputRoot,
            outputRoot: fixture.outputRoot,
          }),
        ).toThrow();
        expect(existsSync(fixture.outputRoot)).toBe(false);
      } finally {
        fixture.cleanup();
      }
    }
  });
});

function payloadFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-release-payload-'));
  const inputRoot = path.join(root, 'input');
  const outputRoot = path.join(root, 'sealed');
  const tarballRoot = path.join(inputRoot, 'tarballs');
  mkdirSync(tarballRoot, { recursive: true });
  const packedPackageManifest = { name: '@kovojs/a', version: '1.2.3' };
  const sourceManifest = { ...packedPackageManifest, publishConfig: {} };
  const tarballBytes = canonicalizeTarballBytes(
    fixtureTarball([
      { body: Buffer.from(JSON.stringify(packedPackageManifest)), name: 'package/package.json' },
      { body: Buffer.from('export const fixture = true;\n'), name: 'package/dist/index.mjs' },
    ]),
  );
  const tarballName = 'kovojs-a-1.2.3.tgz';
  writeFileSync(path.join(tarballRoot, tarballName), tarballBytes);
  const packedPackage = {
    files: validatedPackageTarballEntries(tarballBytes)
      .map((entry) => entry.name)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    manifest: packedPackageManifest,
    name: packedPackageManifest.name,
    sha512: `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`,
    tarball: `.release/tarballs/${tarballName}`,
    version: packedPackageManifest.version,
  };
  writeFileSync(
    path.join(inputRoot, 'packed-packages.json'),
    `${JSON.stringify({ packages: [packedPackage], schema: 'kovo.packed-public-packages/v2' })}\n`,
  );
  return {
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    expectedPackages: [
      {
        manifest: sourceManifest,
        name: packedPackage.name,
        version: packedPackage.version,
      },
    ],
    inputRoot,
    outputRoot,
    tarballBytes,
    tarballName,
  };
}

function fixtureTarball(entries) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    writeOctal(header, 100, 108, 0o644);
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
