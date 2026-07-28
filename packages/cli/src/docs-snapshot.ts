import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/** @internal Exact packed docs snapshot schema consumed by `kovo update-docs` and `kovo docs`. */
export const agentDocsSnapshotSchema = 'kovo.agent-docs-snapshot/v1' as const;
/** @internal Exact packed docs snapshot filename emitted beside the CLI bundles. */
export const agentDocsSnapshotFileName = 'kovo-docs.snapshot.json.gz' as const;

const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 2_048;
const MAX_AGGREGATE_FILE_BYTES = 24 * 1024 * 1024;
const REQUIRED_FILES = Object.freeze([
  'kovo-rules.md',
  'llms-full.txt',
  'llms.txt',
  'spec.md',
] as const);
const PLACEHOLDER_MARKERS = Object.freeze([
  'Bundled starter placeholder',
  'Installed CLI snapshot. Upgrade Kovo',
] as const);

/** @internal One authenticated file inside the version-matched docs snapshot. */
export interface InstalledAgentDocsFile {
  readonly bytes: number;
  readonly content: string;
  readonly path: string;
  readonly sha256: `sha256:${string}`;
}

/** @internal Authenticated snapshot returned only after complete bounded validation. */
export interface InstalledAgentDocsSnapshot {
  readonly files: readonly InstalledAgentDocsFile[];
  readonly publicManifestDigest: `sha256:${string}`;
  readonly schema: typeof agentDocsSnapshotSchema;
  readonly snapshotDigest: `sha256:${string}`;
  readonly sourceCommit: string;
  readonly version: string;
}

/** @internal Read the snapshot bundled beside the executing CLI artifact. */
export function readInstalledAgentDocsSnapshot({
  expectedVersion,
  snapshotUrl = new URL(`./${agentDocsSnapshotFileName}`, import.meta.url),
}: {
  expectedVersion: string;
  snapshotUrl?: URL;
}): InstalledAgentDocsSnapshot {
  return decodeInstalledAgentDocsSnapshot(readFileSync(snapshotUrl), { expectedVersion });
}

/** @internal Authenticate an installed snapshot before exposing any content to a command. */
export function decodeInstalledAgentDocsSnapshot(
  compressedInput: Uint8Array,
  { expectedVersion }: { expectedVersion?: string } = {},
): InstalledAgentDocsSnapshot {
  const compressed = Buffer.from(compressedInput);
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new TypeError(`agent docs snapshot exceeds ${MAX_COMPRESSED_BYTES} compressed bytes`);
  }
  let encoded: Buffer;
  try {
    encoded = gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  } catch {
    throw new TypeError('agent docs snapshot is invalid gzip or exceeds its uncompressed limit');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(encoded.toString('utf8'));
  } catch {
    throw new TypeError('agent docs snapshot is not valid JSON');
  }
  assertExactObjectKeys(
    raw,
    ['files', 'publicManifestDigest', 'schema', 'snapshotDigest', 'sourceCommit', 'version'],
    'agent docs snapshot',
  );
  const snapshot = raw as {
    files: unknown;
    publicManifestDigest: unknown;
    schema: unknown;
    snapshotDigest: unknown;
    sourceCommit: unknown;
    version: unknown;
  };
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
  if (!Array.isArray(snapshot.files) || snapshot.files.length > MAX_FILES) {
    throw new TypeError(`agent docs snapshot files must contain at most ${MAX_FILES} entries`);
  }

  let aggregateBytes = 0;
  const seen = new Set<string>();
  const records: InstalledAgentDocsFile[] = [];
  for (const rawRecord of snapshot.files) {
    assertExactObjectKeys(rawRecord, ['bytes', 'content', 'path', 'sha256'], 'snapshot file');
    const record = rawRecord as {
      bytes: unknown;
      content: unknown;
      path: unknown;
      sha256: unknown;
    };
    assertSnapshotPath(record.path);
    if (seen.has(record.path)) {
      throw new TypeError(`agent docs snapshot repeats ${JSON.stringify(record.path)}`);
    }
    seen.add(record.path);
    if (typeof record.content !== 'string') {
      throw new TypeError(`${record.path}: snapshot content must be a string`);
    }
    const content = record.content;
    const bytes = Buffer.from(content, 'utf8');
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
    if (PLACEHOLDER_MARKERS.some((marker) => content.includes(marker))) {
      throw new TypeError(`${record.path}: placeholder content cannot enter a complete snapshot`);
    }
    records.push(
      Object.freeze({
        bytes: record.bytes,
        content,
        path: record.path,
        sha256: record.sha256,
      }),
    );
  }
  assertCompleteCorpus(records);
  const sorted = [...records].sort((left, right) => compareUtf8(left.path, right.path));
  if (records.some((record, index) => record.path !== sorted[index]?.path)) {
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
    files: Object.freeze(records),
    publicManifestDigest: snapshot.publicManifestDigest,
    schema: snapshot.schema,
    snapshotDigest: snapshot.snapshotDigest,
    sourceCommit: snapshot.sourceCommit,
    version: snapshot.version,
  });
}

function assertCompleteCorpus(records: readonly InstalledAgentDocsFile[]): void {
  if (records.length === 0 || records.length > MAX_FILES) {
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

function assertSnapshotPath(value: unknown): asserts value is string {
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

function assertExactObjectKeys(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertSourceCommit(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError('agent docs source commit must be a 40-character lowercase Git SHA');
  }
}

function assertVersion(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new TypeError('agent docs snapshot version must be an exact semantic version');
  }
}

function assertDigest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value !== 'object') throw new TypeError('canonical JSON value is unsupported');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
