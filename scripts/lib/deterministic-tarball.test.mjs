import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  canonicalizeTarballBytes,
  deterministicPackContract,
  deterministicPackEnvironment,
  deterministicTarballFindings,
  validatedPackageTarballEntries,
} from './deterministic-tarball.mjs';

describe('deterministic package tarballs', () => {
  it('normalizes order, metadata, and gzip host bytes into the same sha512 subject', () => {
    const left = fixtureTarball(
      [
        fixtureEntry('package/z.txt', 'z', { gid: 12, mtime: 1, uid: 34 }),
        fixtureEntry('package/a.txt', 'a', { gid: 56, mtime: 2, uid: 78 }),
      ],
      3,
    );
    const right = fixtureTarball(
      [
        fixtureEntry('package/a.txt', 'a', { gid: 1, mtime: 99, uid: 2 }),
        fixtureEntry('package/z.txt', 'z', { gid: 3, mtime: 100, uid: 4 }),
      ],
      19,
    );

    const canonicalLeft = canonicalizeTarballBytes(left);
    const canonicalRight = canonicalizeTarballBytes(right);
    expect(sha512(canonicalLeft)).toBe(sha512(canonicalRight));
    expect(deterministicTarballFindings(canonicalLeft)).toEqual([]);
    expect(canonicalLeft[9]).toBe(255);
  });

  it('preserves only the executable class while normalizing file modes', () => {
    const canonical = canonicalizeTarballBytes(
      fixtureTarball([
        fixtureEntry('package/bin.mjs', 'bin', { mode: 0o711 }),
        fixtureEntry('package/index.mjs', 'index', { mode: 0o600 }),
      ]),
    );

    expect(deterministicTarballFindings(canonical)).toEqual([]);
  });

  it('normalizes dependency rewrite order without sorting semantic export conditions', () => {
    const leftManifest = {
      dependencies: { '@kovojs/z': '0.2.0', '@kovojs/a': '0.2.0' },
      exports: { import: './dist/import.mjs', default: './dist/default.mjs' },
      name: '@kovojs/example',
      version: '0.2.0',
    };
    const rightManifest = {
      dependencies: { '@kovojs/a': '0.2.0', '@kovojs/z': '0.2.0' },
      exports: { import: './dist/import.mjs', default: './dist/default.mjs' },
      name: '@kovojs/example',
      version: '0.2.0',
    };

    const left = canonicalizeTarballBytes(
      fixtureTarball([fixtureEntry('package/package.json', JSON.stringify(leftManifest))]),
    );
    const right = canonicalizeTarballBytes(
      fixtureTarball([fixtureEntry('package/package.json', JSON.stringify(rightManifest))]),
    );

    expect(sha512(left)).toBe(sha512(right));
    expect(deterministicTarballFindings(left)).toEqual([]);
  });

  it('pins locale, timezone, and SOURCE_DATE_EPOCH without inheriting caller drift', () => {
    expect(
      deterministicPackEnvironment({ LANG: 'fr_FR', LC_ALL: 'tr_TR', TZ: 'Pacific/Auckland' }),
    ).toMatchObject({
      LANG: 'C',
      LC_ALL: 'C',
      SOURCE_DATE_EPOCH: String(deterministicPackContract.sourceDateEpoch),
      TZ: 'UTC',
    });
  });

  it('rejects duplicate package paths before materialization', () => {
    const duplicate = canonicalizeTarballBytes(
      fixtureTarball([
        fixtureEntry('package/index.mjs', 'first'),
        fixtureEntry('package/index.mjs', 'second'),
      ]),
    );

    expect(deterministicTarballFindings(duplicate)).toContain(
      'package/index.mjs: duplicate tar entry',
    );
    expect(() => validatedPackageTarballEntries(duplicate)).toThrow('duplicate tar entry');
  });

  it('rejects traversal and non-canonical package paths before materialization', () => {
    const traversal = canonicalizeTarballBytes(
      fixtureTarball([fixtureEntry('package/../escape.mjs', 'escape')]),
    );

    expect(deterministicTarballFindings(traversal)).toContain(
      'package/../escape.mjs: path is not canonical',
    );
    expect(() => validatedPackageTarballEntries(traversal)).toThrow('path is not canonical');
  });

  it('rejects a tar header whose bytes no longer match its checksum', () => {
    const tar = gunzipSync(fixtureTarball([fixtureEntry('package/index.mjs', 'index')]));
    tar[0] ^= 1;
    const corrupted = gzipSync(tar, { level: 9, mtime: 0 });
    corrupted[9] = deterministicPackContract.gzipOs;

    expect(deterministicTarballFindings(corrupted)).toContain(
      'tarball contains an invalid header checksum',
    );
    expect(() => validatedPackageTarballEntries(corrupted)).toThrow('invalid header checksum');
  });

  it('returns owned bytes only after the complete canonical contract passes', () => {
    const canonical = canonicalizeTarballBytes(
      fixtureTarball([
        fixtureEntry('package/package.json', '{"name":"@kovojs/example","version":"0.2.0"}'),
        fixtureEntry('package/dist/index.mjs', 'export const value = 1;'),
      ]),
    );

    const entries = validatedPackageTarballEntries(canonical);
    expect(entries.map((entry) => entry.name)).toEqual([
      'package/dist/index.mjs',
      'package/package.json',
    ]);
    const first = entries[0].data;
    canonical.fill(0);
    expect(first.toString('utf8')).toBe('export const value = 1;');
  });

  it('bounds gzip expansion before parsing archive entries', () => {
    const expanding = gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1), { level: 9, mtime: 0 });
    expanding[9] = deterministicPackContract.gzipOs;

    expect(deterministicTarballFindings(expanding)).toContain(
      'tarball is invalid gzip or exceeds the 33554432-byte uncompressed limit',
    );
    expect(() => validatedPackageTarballEntries(expanding)).toThrow(
      'exceeds the 33554432-byte uncompressed limit',
    );
  });
});

function fixtureEntry(name, body, overrides = {}) {
  return {
    body: Buffer.from(body),
    gid: 501,
    mode: 0o644,
    mtime: 123,
    name,
    uid: 501,
    ...overrides,
  };
}

function fixtureTarball(entries, os = 3) {
  const blocks = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100, 'utf8');
    writeOctal(header, 100, 108, entry.mode);
    writeOctal(header, 108, 116, entry.uid);
    writeOctal(header, 116, 124, entry.gid);
    writeOctal(header, 124, 136, entry.body.byteLength);
    writeOctal(header, 136, 148, entry.mtime);
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
  compressed[9] = os;
  return compressed;
}

function writeOctal(header, start, end, value) {
  header.write(value.toString(8).padStart(end - start - 1, '0'), start, end - start - 1, 'ascii');
  header[end - 1] = 0;
}

function sha512(value) {
  return createHash('sha512').update(value).digest('base64');
}
