#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import { generateApiReference } from '../site/scripts/api-ref.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { repoRoot } from './lib/repo-root.mjs';

export const agentDocsSnapshotSchema = 'kovo.agent-docs-snapshot/v1';
export const agentDocsSnapshotFileName = 'kovo-docs.snapshot.json.gz';

const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 2_048;
const MAX_AGGREGATE_FILE_BYTES = 24 * 1024 * 1024;
const REQUIRED_FILES = Object.freeze(['kovo-rules.md', 'llms-full.txt', 'llms.txt', 'spec.md']);
const PLACEHOLDER_MARKERS = Object.freeze([
  'Bundled starter placeholder',
  'Installed CLI snapshot. Upgrade Kovo',
]);

/**
 * Build the exact authored-doc/API snapshot consumed by the installed CLI.
 *
 * The returned gzip bytes are deterministic for the same source inputs: no absolute path,
 * timestamp, random value, output directory, or gzip host byte enters the artifact.
 */
export function buildAgentDocsSnapshot({
  root = repoRoot(),
  apiDirectory = path.join(root, 'site/gen/api'),
  sourceCommit = resolveSourceCommit(root),
  version = readCliVersion(root),
} = {}) {
  assertSourceCommit(sourceCommit);
  assertVersion(version);
  const authored = collectAuthoredDocs(root, { apiDirectory });
  const generated = generateAgentViews(authored);
  const files = new Map(authored);
  for (const [filePath, source] of generated) {
    if (files.has(filePath)) {
      throw new TypeError(`generated agent view collides with authored source ${filePath}`);
    }
    files.set(filePath, source);
  }
  const publicManifestDigest = digestPublicManifest(root);
  const records = [...files]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([filePath, source]) => snapshotFileRecord(filePath, source));
  assertCompleteCorpus(records);

  const unsigned = {
    files: records,
    publicManifestDigest,
    schema: agentDocsSnapshotSchema,
    sourceCommit,
    version,
  };
  const snapshotDigest = sha256(canonicalJson(unsigned));
  const snapshot = { ...unsigned, snapshotDigest };
  const encoded = Buffer.from(`${canonicalJson(snapshot)}\n`, 'utf8');
  if (encoded.byteLength > MAX_UNCOMPRESSED_BYTES) {
    throw new TypeError(`agent docs snapshot exceeds ${MAX_UNCOMPRESSED_BYTES} uncompressed bytes`);
  }
  const compressed = gzipSync(encoded, { level: 9, mtime: 0 });
  // Node's zlib otherwise records the current host family. Pinning the RFC 1952 OS byte makes
  // clean Linux and macOS package builds byte-identical.
  compressed[9] = 255;
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new TypeError(`agent docs snapshot exceeds ${MAX_COMPRESSED_BYTES} compressed bytes`);
  }
  return { compressed, snapshot };
}

/** Decode and fully authenticate one installed snapshot before any file is exposed. */
export function decodeAgentDocsSnapshot(
  compressed,
  { expectedPublicManifestDigest, expectedVersion } = {},
) {
  if (!Buffer.isBuffer(compressed)) {
    throw new TypeError('agent docs snapshot bytes must be a Buffer');
  }
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new TypeError(`agent docs snapshot exceeds ${MAX_COMPRESSED_BYTES} compressed bytes`);
  }
  let encoded;
  try {
    encoded = gunzipSync(Buffer.from(compressed), { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  } catch {
    throw new TypeError('agent docs snapshot is invalid gzip or exceeds its uncompressed limit');
  }
  let snapshot;
  try {
    snapshot = JSON.parse(encoded.toString('utf8'));
  } catch {
    throw new TypeError('agent docs snapshot is not valid JSON');
  }
  assertExactObjectKeys(
    snapshot,
    ['files', 'publicManifestDigest', 'schema', 'snapshotDigest', 'sourceCommit', 'version'],
    'agent docs snapshot',
  );
  if (snapshot.schema !== agentDocsSnapshotSchema) {
    throw new TypeError(`agent docs snapshot schema must be ${agentDocsSnapshotSchema}`);
  }
  assertSourceCommit(snapshot.sourceCommit);
  assertVersion(snapshot.version);
  assertDigest(snapshot.publicManifestDigest, 'publicManifestDigest');
  assertDigest(snapshot.snapshotDigest, 'snapshotDigest');
  if (expectedVersion !== undefined && snapshot.version !== expectedVersion) {
    throw new TypeError(
      `agent docs snapshot version ${JSON.stringify(snapshot.version)} does not match installed CLI ${JSON.stringify(expectedVersion)}`,
    );
  }
  if (
    expectedPublicManifestDigest !== undefined &&
    snapshot.publicManifestDigest !== expectedPublicManifestDigest
  ) {
    throw new TypeError('agent docs snapshot public-manifest digest does not match the CLI');
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length > MAX_FILES) {
    throw new TypeError(`agent docs snapshot files must contain at most ${MAX_FILES} entries`);
  }

  let aggregateBytes = 0;
  const seen = new Set();
  const records = [];
  for (const record of snapshot.files) {
    assertExactObjectKeys(record, ['bytes', 'content', 'path', 'sha256'], 'snapshot file');
    assertSnapshotPath(record.path);
    if (seen.has(record.path)) {
      throw new TypeError(`agent docs snapshot repeats ${JSON.stringify(record.path)}`);
    }
    seen.add(record.path);
    if (typeof record.content !== 'string') {
      throw new TypeError(`${record.path}: snapshot content must be a string`);
    }
    const bytes = Buffer.from(record.content, 'utf8');
    aggregateBytes += bytes.byteLength;
    if (
      !Number.isSafeInteger(record.bytes) ||
      record.bytes !== bytes.byteLength ||
      record.bytes > MAX_FILE_BYTES
    ) {
      throw new TypeError(`${record.path}: snapshot byte length is invalid`);
    }
    if (aggregateBytes > MAX_AGGREGATE_FILE_BYTES) {
      throw new TypeError('agent docs snapshot exceeds its aggregate file-byte limit');
    }
    assertDigest(record.sha256, `${record.path} sha256`);
    if (record.sha256 !== sha256(bytes)) {
      throw new TypeError(`${record.path}: snapshot digest does not match its content`);
    }
    if (PLACEHOLDER_MARKERS.some((marker) => record.content.includes(marker))) {
      throw new TypeError(`${record.path}: placeholder content cannot enter a complete snapshot`);
    }
    records.push({
      bytes: record.bytes,
      content: record.content,
      path: record.path,
      sha256: record.sha256,
    });
  }
  assertCompleteCorpus(records);
  const sorted = [...records].sort((left, right) => compareUtf8(left.path, right.path));
  if (records.some((record, index) => record.path !== sorted[index].path)) {
    throw new TypeError('agent docs snapshot files are not in bytewise path order');
  }
  const unsigned = {
    files: records,
    publicManifestDigest: snapshot.publicManifestDigest,
    schema: snapshot.schema,
    sourceCommit: snapshot.sourceCommit,
    version: snapshot.version,
  };
  if (snapshot.snapshotDigest !== sha256(canonicalJson(unsigned))) {
    throw new TypeError('agent docs snapshot digest does not match its manifest and files');
  }
  return Object.freeze({
    files: Object.freeze(records.map((record) => Object.freeze(record))),
    publicManifestDigest: snapshot.publicManifestDigest,
    schema: snapshot.schema,
    snapshotDigest: snapshot.snapshotDigest,
    sourceCommit: snapshot.sourceCommit,
    version: snapshot.version,
  });
}

export async function writeAgentDocsSnapshot({
  apiDirectory,
  root = repoRoot(),
  output = path.join(root, 'packages/cli/dist', agentDocsSnapshotFileName),
  prepareApi = true,
  sourceCommit,
  version,
} = {}) {
  let temporaryApiDirectory;
  try {
    if (apiDirectory === undefined && prepareApi) {
      temporaryApiDirectory = mkdtempSync(path.join(tmpdir(), 'kovo-agent-docs-api-'));
      await generateApiReference({ outDir: temporaryApiDirectory });
      apiDirectory = temporaryApiDirectory;
    }
    const result = buildAgentDocsSnapshot({
      apiDirectory: apiDirectory ?? path.join(root, 'site/gen/api'),
      root,
      sourceCommit,
      version,
    });
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, result.compressed);
    return {
      compressedBytes: result.compressed.byteLength,
      files: result.snapshot.files.length,
      output,
      publicManifestDigest: result.snapshot.publicManifestDigest,
      snapshotDigest: result.snapshot.snapshotDigest,
      uncompressedFileBytes: result.snapshot.files.reduce((sum, file) => sum + file.bytes, 0),
    };
  } finally {
    if (temporaryApiDirectory !== undefined) {
      rmSync(temporaryApiDirectory, { force: true, recursive: true });
    }
  }
}

export function collectAuthoredDocs(root, { apiDirectory = path.join(root, 'site/gen/api') } = {}) {
  const files = new Map();
  addSourceFile(files, 'spec.md', path.join(root, 'SPEC.md'));
  for (const file of walkMarkdownFiles(path.join(root, 'spec'))) {
    addSourceFile(files, `spec/${path.relative(path.join(root, 'spec'), file)}`, file);
  }
  for (const file of walkMarkdownFiles(path.join(root, 'site/content'))) {
    addSourceFile(files, path.relative(path.join(root, 'site/content'), file), file);
  }
  for (const file of walkMarkdownFiles(apiDirectory)) {
    addSourceFile(files, `api/${path.relative(apiDirectory, file)}`, file);
  }
  return files;
}

export function digestPublicManifest(root) {
  const registry = readJson(path.join(root, 'public-packages.json'));
  if (!Array.isArray(registry?.packages)) {
    throw new TypeError('public-packages.json must contain a packages array');
  }
  const packages = registry.packages
    .filter((entry) => entry?.visibility === 'public')
    .map((entry) => {
      const manifest = readJson(path.join(root, 'packages', entry.dir, 'package.json'));
      if (manifest.name !== entry.name || typeof manifest.version !== 'string') {
        throw new TypeError(`${entry.name}: package manifest identity does not match registry`);
      }
      return {
        apiBoundary: entry.apiBoundary ?? {},
        exports: manifest.exports ?? {},
        kind: entry.kind,
        name: entry.name,
        version: manifest.version,
      };
    })
    .sort((left, right) => compareUtf8(left.name, right.name));
  return sha256(canonicalJson({ packages, schema: 'kovo.public-manifest-subject/v1' }));
}

export function generateAgentViews(authored) {
  const pages = [...authored]
    .sort(([left], [right]) => compareUtf8(left, right))
    .map(([filePath, source]) => ({
      description: markdownFrontmatterValue(source, 'description'),
      path: filePath,
      source,
      title: markdownTitle(source, filePath),
    }));
  const llmsIndex = [
    '# Kovo',
    '',
    'Version-bound local documentation installed from the exact Kovo CLI package.',
    '',
    ...pages.flatMap((page) => [
      `- [${page.title}](./${page.path})${page.description ? ` — ${page.description}` : ''}`,
    ]),
    '',
  ].join('\n');
  const llmsFull = [
    '# Kovo full documentation snapshot',
    '',
    ...pages.flatMap((page) => [`<!-- source: ${page.path} -->`, '', page.source.trimEnd(), '']),
  ].join('\n');
  const grouped = new Map();
  for (const page of pages) {
    const group = page.path.includes('/') ? page.path.split('/')[0] : 'root';
    const groupPages = grouped.get(group) ?? [];
    groupPages.push(page);
    grouped.set(group, groupPages);
  }
  const rules = [
    '# Kovo Docs',
    '',
    'Use these files as version-matched explanatory context. `SPEC.md` and `spec/` remain the',
    'normative framework authority.',
    '',
    '## Commands',
    '',
    '- `kovo check`: verify the app graph and framework invariants.',
    '- `kovo explain <target>`: inspect the same graph and proof facts.',
    '- `kovo docs <task>`: retrieve a bounded result from this installed snapshot.',
    '- `kovo update-docs`: atomically select the snapshot bundled with the installed CLI.',
    '',
    '## Files',
    '',
    ...[...grouped]
      .sort(([left], [right]) => compareUtf8(left, right))
      .flatMap(([group, groupPages]) => [
        `### ${group}`,
        '',
        ...groupPages.map((page) => `- [${page.title}](./${page.path})`),
        '',
      ]),
  ].join('\n');
  return new Map([
    ['kovo-rules.md', rules],
    ['llms-full.txt', llmsFull],
    ['llms.txt', llmsIndex],
  ]);
}

function snapshotFileRecord(filePath, source) {
  assertSnapshotPath(filePath);
  if (typeof source !== 'string') throw new TypeError(`${filePath}: source must be text`);
  const bytes = Buffer.from(source, 'utf8');
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new TypeError(`${filePath}: source exceeds ${MAX_FILE_BYTES} bytes`);
  }
  if (PLACEHOLDER_MARKERS.some((marker) => source.includes(marker))) {
    throw new TypeError(`${filePath}: placeholder content cannot enter the packed snapshot`);
  }
  return {
    bytes: bytes.byteLength,
    content: source,
    path: filePath,
    sha256: sha256(bytes),
  };
}

function assertCompleteCorpus(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > MAX_FILES) {
    throw new TypeError(`agent docs snapshot must contain 1..${MAX_FILES} files`);
  }
  const paths = new Set(records.map((record) => record.path));
  for (const required of REQUIRED_FILES) {
    if (!paths.has(required)) throw new TypeError(`agent docs snapshot is missing ${required}`);
  }
  if (![...paths].some((filePath) => filePath.startsWith('api/'))) {
    throw new TypeError('agent docs snapshot has no generated API reference');
  }
  if (![...paths].some((filePath) => filePath.startsWith('guides/'))) {
    throw new TypeError('agent docs snapshot has no authored guides');
  }
}

function addSourceFile(files, logicalPath, sourcePath) {
  const normalized = logicalPath.split(path.sep).join('/');
  assertSnapshotPath(normalized);
  if (files.has(normalized)) throw new TypeError(`duplicate docs source ${normalized}`);
  const sourceStat = lstatSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new TypeError(`${sourcePath}: docs source must be a regular file`);
  }
  files.set(normalized, readFileSync(sourcePath, 'utf8'));
}

function walkMarkdownFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      compareUtf8(left.name, right.name),
    )) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new TypeError(`${target}: docs source symlinks are forbidden`);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(target);
    }
  };
  visit(directory);
  return files;
}

function markdownTitle(source, filePath) {
  const frontmatter = markdownFrontmatterValue(source, 'title');
  if (frontmatter) return frontmatter;
  const heading = source.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  return heading || filePath;
}

function markdownFrontmatterValue(source, name) {
  if (!source.startsWith('---\n')) return '';
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) return '';
  const match = source
    .slice(4, end)
    .match(new RegExp(`^${name}:\\s*(.+)$`, 'mu'))?.[1]
    ?.trim();
  if (!match) return '';
  return match.replace(/^(['"])(.*)\1$/u, '$2');
}

function assertSnapshotPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 240 ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)
  ) {
    throw new TypeError(`invalid agent docs snapshot path ${JSON.stringify(value)}`);
  }
}

function assertExactObjectKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertSourceCommit(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError('agent docs source commit must be a 40-character lowercase Git SHA');
  }
}

function assertVersion(value) {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new TypeError('agent docs snapshot version must be an exact semantic version');
  }
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
}

function readCliVersion(root) {
  return readJson(path.join(root, 'packages/cli/package.json')).version;
}

function resolveSourceCommit(root) {
  const environmentCommit = process.env.KOVO_SOURCE_COMMIT || process.env.GITHUB_SHA;
  if (environmentCommit) return environmentCommit;
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value !== 'object') throw new TypeError('canonical JSON value is unsupported');
  return `{${Object.keys(value)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--output', '--root', '--source-commit', '--version'].includes(flag) || !value) {
      throw new TypeError(
        'usage: agent-docs-snapshot [--root DIR] [--output FILE] [--source-commit SHA] [--version VERSION]',
      );
    }
    if (flag === '--output') options.output = path.resolve(value);
    else if (flag === '--root') options.root = path.resolve(value);
    else if (flag === '--source-commit') options.sourceCommit = value;
    else options.version = value;
  }
  return options;
}

async function main({ argv = process.argv.slice(2) } = {}) {
  const report = await writeAgentDocsSnapshot(parseArgs(argv));
  process.stdout.write(
    `agent-docs-snapshot/v1 files=${report.files} compressed=${report.compressedBytes} installed=${report.uncompressedFileBytes} digest=${report.snapshotDigest}\n`,
  );
  return true;
}

if (isMainEntry(import.meta.url)) await runGate(main);
