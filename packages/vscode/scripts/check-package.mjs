#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { createKovoDiagnosticsVsix } from './package-vsix.mjs';

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'kovo-vscode-package-'));

try {
  const first = path.join(temporaryRoot, 'first.vsix');
  const second = path.join(temporaryRoot, 'second.vsix');
  createKovoDiagnosticsVsix(first);
  createKovoDiagnosticsVsix(second);
  assert(
    readFileSync(first).equals(readFileSync(second)),
    'two clean VSIX packages must be byte-identical',
  );
  const firstArchive = readZip(first);
  const secondArchive = readZip(second);
  const firstNames = [...firstArchive.keys()].sort(compareStrings);
  const secondNames = [...secondArchive.keys()].sort(compareStrings);
  assert(
    JSON.stringify(firstNames) === JSON.stringify(secondNames),
    'two clean VSIX packages must contain the same paths',
  );

  const required = [
    '[Content_Types].xml',
    'extension.vsixmanifest',
    'extension/readme.md',
    'extension/package.json',
    'extension/src/diagnostic-adapter.cjs',
    'extension/src/extension.cjs',
  ];
  for (const entry of required) {
    assert(firstArchive.has(entry), `VSIX is missing ${entry}`);
  }
  for (const entry of firstNames) {
    assert(
      !/(?:^|\/)(?:dist|node_modules|scripts)(?:\/|$)|\.test\.[^.]+$/u.test(entry),
      `VSIX contains development-only path ${entry}`,
    );
  }

  const manifest = JSON.parse(firstArchive.get('extension/package.json').toString('utf8'));
  assert(manifest.name === 'kovo-diagnostics', 'VSIX extension name drifted');
  assert(manifest.publisher === 'kovojs', 'VSIX publisher drifted');
  assert(manifest.main === './src/extension.cjs', 'VSIX runtime entry drifted');
  assert(manifest.engines?.vscode === '^1.85.0', 'VSIX minimum VS Code engine drifted');
  assert(
    manifest.capabilities?.untrustedWorkspaces?.supported === false,
    'VSIX must remain disabled for untrusted workspaces',
  );
  process.stdout.write(
    `kovo-vscode-package/v1 entries=${String(firstNames.length)} runtime=2 publisher=kovojs OK\n`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

function readZip(file) {
  const bytes = readFileSync(file);
  const eocd = findEndOfCentralDirectory(bytes);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert(bytes.readUInt32LE(offset) === 0x02014b50, 'VSIX central directory is malformed');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    assert(!entries.has(name), `VSIX repeats ${name}`);
    entries.set(
      name,
      readLocalEntry(bytes, {
        compressedSize,
        localOffset,
        method,
        uncompressedSize,
      }),
    );
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readLocalEntry(bytes, entry) {
  assert(bytes.readUInt32LE(entry.localOffset) === 0x04034b50, 'VSIX local entry is malformed');
  const nameLength = bytes.readUInt16LE(entry.localOffset + 26);
  const extraLength = bytes.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(start, start + entry.compressedSize);
  const value =
    entry.method === 0
      ? Buffer.from(compressed)
      : entry.method === 8
        ? inflateRawSync(compressed)
        : undefined;
  assert(value !== undefined, `VSIX uses unsupported ZIP method ${String(entry.method)}`);
  assert(value.byteLength === entry.uncompressedSize, 'VSIX entry size is inconsistent');
  return value;
}

function findEndOfCentralDirectory(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('VSIX end-of-central-directory record is missing');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
