import { renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { readBoundedRegularFile } from './bounded-regular-file.mjs';

const MAX_COMPRESSED_TARBALL_BYTES = 16 * 1024 * 1024;
const MAX_UNCOMPRESSED_TARBALL_BYTES = 32 * 1024 * 1024;
const MAX_TARBALL_ENTRIES = 8_192;
const MAX_TARBALL_ENTRY_BYTES = 16 * 1024 * 1024;

export const deterministicPackContract = Object.freeze({
  gid: 0,
  gzipMtime: 0,
  gzipOs: 255,
  locale: 'C',
  modeExecutable: 0o755,
  modeRegular: 0o644,
  ordering: 'bytewise-path',
  packageManifestDependencyOrdering: 'bytewise-key',
  packageManifestEncoding: 'utf8-json-2-space-lf',
  sourceDateEpoch: 499_162_500,
  timezone: 'UTC',
  uid: 0,
});

export function deterministicPackEnvironment(base = process.env) {
  return {
    ...base,
    LANG: deterministicPackContract.locale,
    LC_ALL: deterministicPackContract.locale,
    SOURCE_DATE_EPOCH: String(deterministicPackContract.sourceDateEpoch),
    TZ: deterministicPackContract.timezone,
  };
}

export function canonicalizePackedTarball(tarballPath) {
  const canonical = canonicalizeTarballBytes(readPackageTarballSnapshot(tarballPath));
  const temporaryPath = `${tarballPath}.kovo-canonical-${process.pid}`;
  try {
    writeFileSync(temporaryPath, canonical, { flag: 'wx', mode: 0o600 });
    renameSync(temporaryPath, tarballPath);
    return canonical;
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function readPackageTarballSnapshot(tarballPath) {
  return readBoundedRegularFile(
    tarballPath,
    MAX_COMPRESSED_TARBALL_BYTES,
    `package tarball ${tarballPath}`,
  );
}

export function canonicalizeTarballBytes(compressed) {
  const entries = parseCompressedTar(compressed);
  return canonicalizeTarEntries(entries);
}

function canonicalizeTarEntries(entries) {
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
  const tar = Buffer.concat([
    ...entries.flatMap((entry) => canonicalEntryBlocks(entry)),
    Buffer.alloc(1024),
  ]);
  const gzip = gzipSync(tar, { level: 9, mtime: 0 });
  gzip[9] = deterministicPackContract.gzipOs;
  return gzip;
}

export function deterministicTarballFindings(compressed) {
  return inspectDeterministicTarball(compressed).findings;
}

function inspectDeterministicTarball(compressed) {
  const findings = [];
  let bytes;
  try {
    bytes = snapshotCompressedTarball(compressed);
  } catch (error) {
    return {
      entries: undefined,
      findings: [error instanceof Error ? error.message : String(error)],
    };
  }
  if (bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return { entries: undefined, findings: ['tarball is not gzip encoded'] };
  }
  if (bytes.readUInt32LE(4) !== deterministicPackContract.gzipMtime) {
    findings.push('gzip mtime is not zero');
  }
  if (bytes[9] !== deterministicPackContract.gzipOs) {
    findings.push(`gzip OS byte is ${bytes[9]}, expected ${deterministicPackContract.gzipOs}`);
  }
  let entries;
  try {
    entries = parseCompressedTarBytes(bytes);
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
    return { entries: undefined, findings };
  }
  const sorted = [...entries].sort((left, right) =>
    Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
  );
  if (entries.some((entry, index) => entry.name !== sorted[index].name)) {
    findings.push('tar entries are not in bytewise path order');
  }
  const seenNames = new Set();
  for (const entry of entries) {
    if (seenNames.has(entry.name)) findings.push(`${entry.name}: duplicate tar entry`);
    seenNames.add(entry.name);
    const pathFinding = packageTarPathFinding(entry.name);
    if (pathFinding !== undefined) findings.push(`${entry.name}: ${pathFinding}`);
    const expectedMode = entry.executable
      ? deterministicPackContract.modeExecutable
      : deterministicPackContract.modeRegular;
    if (entry.mode !== expectedMode) {
      findings.push(
        `${entry.name}: mode ${entry.mode.toString(8)} is not ${expectedMode.toString(8)}`,
      );
    }
    if (
      entry.uid !== deterministicPackContract.uid ||
      entry.gid !== deterministicPackContract.gid
    ) {
      findings.push(`${entry.name}: owner must be 0:0`);
    }
    if (entry.mtime !== deterministicPackContract.sourceDateEpoch) {
      findings.push(`${entry.name}: mtime must be ${deterministicPackContract.sourceDateEpoch}`);
    }
    if (entry.type !== '0')
      findings.push(`${entry.name}: only regular-file tar entries are allowed`);
    if (entry.uname !== '' || entry.gname !== '') {
      findings.push(`${entry.name}: owner names must be empty`);
    }
  }
  try {
    if (!bytes.equals(canonicalizeTarEntries([...entries]))) {
      findings.push('tarball bytes do not equal their canonical representation');
    }
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  return { entries, findings };
}

/**
 * Parse one canonical npm package tarball only after its complete byte/path/metadata contract has
 * passed. Returned entry bytes can be materialized without invoking a system tar extractor.
 */
export function validatedPackageTarballEntries(compressed) {
  const { entries, findings } = inspectDeterministicTarball(compressed);
  if (findings.length > 0) {
    throw new TypeError(`invalid canonical package tarball:\n  ${findings.join('\n  ')}`);
  }
  return entries.map((entry) => ({
    data: Buffer.from(entry.data),
    executable: entry.executable,
    name: entry.name,
  }));
}

function parseCompressedTar(compressed) {
  return parseCompressedTarBytes(snapshotCompressedTarball(compressed));
}

function snapshotCompressedTarball(compressed) {
  if (!Buffer.isBuffer(compressed)) {
    throw new TypeError('tarball bytes must be a Buffer');
  }
  if (compressed.byteLength > MAX_COMPRESSED_TARBALL_BYTES) {
    throw new TypeError(
      `tarball exceeds the ${MAX_COMPRESSED_TARBALL_BYTES}-byte compressed limit`,
    );
  }
  return Buffer.from(compressed);
}

function parseCompressedTarBytes(compressed) {
  let tar;
  try {
    tar = gunzipSync(compressed, {
      maxOutputLength: MAX_UNCOMPRESSED_TARBALL_BYTES,
    });
  } catch {
    throw new Error(
      `tarball is invalid gzip or exceeds the ${MAX_UNCOMPRESSED_TARBALL_BYTES}-byte uncompressed limit`,
    );
  }
  return parseTar(tar);
}

function parseTar(tar) {
  const entries = [];
  let offset = 0;
  let totalEntryBytes = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      const second = tar.subarray(offset + 512, offset + 1024);
      if (second.byteLength !== 512 || !second.every((byte) => byte === 0)) {
        throw new Error('tarball is missing its second zero-block terminator');
      }
      if (!tar.subarray(offset + 1024).every((byte) => byte === 0)) {
        throw new Error('tarball contains data after its zero-block terminator');
      }
      return entries;
    }
    if (entries.length >= MAX_TARBALL_ENTRIES) {
      throw new Error(`tarball exceeds the ${MAX_TARBALL_ENTRIES}-entry limit`);
    }
    assertTarHeaderChecksum(header);
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 500);
    const fullName = prefix === '' ? name : `${prefix}/${name}`;
    const size = tarOctal(header, 124, 136);
    if (!Number.isSafeInteger(size) || size > MAX_TARBALL_ENTRY_BYTES) {
      throw new Error(`${fullName || 'tar entry'} exceeds the per-entry byte limit`);
    }
    totalEntryBytes += size;
    if (totalEntryBytes > MAX_UNCOMPRESSED_TARBALL_BYTES) {
      throw new Error('tarball entries exceed the aggregate byte limit');
    }
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (fullName === '' || bodyEnd > tar.length) throw new Error('tarball has a malformed entry');
    const mode = tarOctal(header, 100, 108);
    entries.push({
      data: tar.subarray(bodyStart, bodyEnd),
      executable: (mode & 0o111) !== 0,
      gid: tarOctal(header, 116, 124),
      gname: tarString(header, 297, 329),
      mode,
      mtime: tarOctal(header, 136, 148),
      name: fullName,
      type: tarString(header, 156, 157) || '0',
      uid: tarOctal(header, 108, 116),
      uname: tarString(header, 265, 297),
    });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  throw new Error('tarball is missing its zero-block terminator');
}

function assertTarHeaderChecksum(header) {
  const expected = tarOctal(header, 148, 156);
  const snapshot = Buffer.from(header);
  snapshot.fill(0x20, 148, 156);
  const actual = snapshot.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) throw new Error('tarball contains an invalid header checksum');
}

function packageTarPathFinding(value) {
  if (!/^package\/[\x21-\x7e]+$/u.test(value)) {
    return 'path must be visible ASCII below package/';
  }
  if (value.includes('\\') || value.includes('\0')) return 'path contains an ambiguous separator';
  const relative = value.slice('package/'.length);
  if (
    relative === '' ||
    path.posix.isAbsolute(relative) ||
    path.posix.normalize(relative) !== relative ||
    relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return 'path is not canonical';
  }
  return undefined;
}

function canonicalEntryBlocks(entry) {
  if (entry.type !== '0')
    throw new Error(`${entry.name}: unsupported tar entry type ${entry.type}`);
  const name = Buffer.from(entry.name);
  if (name.byteLength > 100) throw new Error(`${entry.name}: path exceeds canonical tar limit`);
  const data = canonicalEntryData(entry);
  const header = Buffer.alloc(512);
  name.copy(header, 0);
  writeTarOctal(
    header,
    100,
    108,
    entry.executable
      ? deterministicPackContract.modeExecutable
      : deterministicPackContract.modeRegular,
  );
  writeTarOctal(header, 108, 116, deterministicPackContract.uid);
  writeTarOctal(header, 116, 124, deterministicPackContract.gid);
  writeTarOctal(header, 124, 136, data.byteLength);
  writeTarOctal(header, 136, 148, deterministicPackContract.sourceDateEpoch);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  Buffer.from('ustar\0').copy(header, 257);
  Buffer.from('00').copy(header, 263);
  writeTarOctal(header, 329, 337, 0);
  writeTarOctal(header, 337, 345, 0);
  writeTarChecksum(header);
  const padding = Buffer.alloc(Math.ceil(data.byteLength / 512) * 512 - data.byteLength);
  return [header, data, padding];
}

function canonicalEntryData(entry) {
  if (entry.name !== 'package/package.json') return entry.data;
  let manifest;
  try {
    manifest = JSON.parse(entry.data.toString('utf8'));
  } catch {
    throw new Error('package/package.json must contain valid JSON');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('package/package.json must contain a JSON object');
  }
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ]) {
    if (!manifest[field] || typeof manifest[field] !== 'object' || Array.isArray(manifest[field])) {
      continue;
    }
    manifest[field] = Object.fromEntries(
      Object.entries(manifest[field]).sort(([left], [right]) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      ),
    );
  }
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

function tarString(header, start, end) {
  const value = header.subarray(start, end).toString('utf8');
  const nulIndex = value.indexOf('\0');
  return nulIndex === -1 ? value : value.slice(0, nulIndex);
}

function tarOctal(header, start, end) {
  const value = tarString(header, start, end).trim();
  if (!/^[0-7]*$/u.test(value)) throw new Error('tarball contains a non-octal header field');
  return Number.parseInt(value || '0', 8);
}

function writeTarOctal(header, start, end, value) {
  const width = end - start;
  const encoded = value.toString(8).padStart(width - 1, '0');
  if (encoded.length >= width) throw new Error(`tar value ${value} exceeds field width ${width}`);
  header.write(encoded, start, width - 1, 'ascii');
  header[end - 1] = 0;
}

function writeTarChecksum(header) {
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const encoded = checksum.toString(8).padStart(6, '0');
  header.write(encoded, 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
}
