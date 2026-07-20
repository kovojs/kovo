import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

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
  const canonical = canonicalizeTarballBytes(readFileSync(tarballPath));
  writeFileSync(tarballPath, canonical);
  return canonical;
}

export function canonicalizeTarballBytes(compressed) {
  const entries = parseTar(gunzipSync(compressed));
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
  const findings = [];
  if (compressed.length < 10 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
    return ['tarball is not gzip encoded'];
  }
  if (compressed.readUInt32LE(4) !== deterministicPackContract.gzipMtime) {
    findings.push('gzip mtime is not zero');
  }
  if (compressed[9] !== deterministicPackContract.gzipOs) {
    findings.push(`gzip OS byte is ${compressed[9]}, expected ${deterministicPackContract.gzipOs}`);
  }
  let entries;
  try {
    entries = parseTar(gunzipSync(compressed));
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
    return findings;
  }
  const sorted = [...entries].sort((left, right) =>
    Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
  );
  if (entries.some((entry, index) => entry.name !== sorted[index].name)) {
    findings.push('tar entries are not in bytewise path order');
  }
  for (const entry of entries) {
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
    if (!compressed.equals(canonicalizeTarballBytes(compressed))) {
      findings.push('tarball bytes do not equal their canonical representation');
    }
  } catch (error) {
    findings.push(error instanceof Error ? error.message : String(error));
  }
  return findings;
}

function parseTar(tar) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return entries;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 500);
    const fullName = prefix === '' ? name : `${prefix}/${name}`;
    const size = tarOctal(header, 124, 136);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (fullName === '' || bodyEnd > tar.length) throw new Error('tarball has a malformed entry');
    const mode = tarOctal(header, 100, 108);
    entries.push({
      data: Buffer.from(tar.subarray(bodyStart, bodyEnd)),
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
  return header.subarray(start, end).toString('utf8').replace(/\0.*$/su, '');
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
