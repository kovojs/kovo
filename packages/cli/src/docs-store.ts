import { createHash } from 'node:crypto';

import {
  createFrameworkFileSystemBoundary,
  createFrameworkOutputFileSystemBoundary,
  type FrameworkFileSystemBoundary,
  type FrameworkOutputFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';

import type { InstalledAgentDocsFile, InstalledAgentDocsSnapshot } from './docs-snapshot.js';

const installedAgentDocsManifestSchema = 'kovo.installed-agent-docs/v1' as const;
const installedAgentDocsPointerSchema = 'kovo.installed-agent-docs-current/v1' as const;
const POINTER_MAX_BYTES = 16 * 1024;
const MANIFEST_MAX_BYTES = 1024 * 1024;

interface InstalledAgentDocsManifest {
  readonly files: readonly Omit<InstalledAgentDocsFile, 'content'>[];
  readonly publicManifestDigest: `sha256:${string}`;
  readonly schema: typeof installedAgentDocsManifestSchema;
  readonly snapshotDigest: `sha256:${string}`;
  readonly sourceCommit: string;
  readonly version: string;
}

interface InstalledAgentDocsPointer {
  readonly publicManifestDigest: `sha256:${string}`;
  readonly schema: typeof installedAgentDocsPointerSchema;
  readonly snapshotDigest: `sha256:${string}`;
  readonly sourceCommit: string;
  readonly version: string;
}

/** @internal Result of selecting one complete content-addressed local snapshot. */
export interface InstallAgentDocsResult {
  readonly directory: string;
  readonly files: number;
  readonly pointerPath: '.kovo/docs/current.json';
  readonly snapshotDigest: `sha256:${string}`;
}

/** @internal One bounded local retrieval result shared by CLI and MCP projections. */
export interface AgentDocsSearchResult {
  readonly excerpt: string;
  readonly path: string;
  readonly sha256: `sha256:${string}`;
  readonly snapshotDigest: `sha256:${string}`;
  readonly version: string;
}

/**
 * Install every file under an immutable digest directory, prove the written bytes, then atomically
 * replace the small active pointer last. A failed or interrupted refresh cannot select a partial
 * corpus; the previous pointer remains authoritative.
 */
export async function installAgentDocsSnapshot({
  beforeSelect,
  cwd,
  fileSystem,
  output,
  snapshot,
}: {
  beforeSelect?: (prepared: InstallAgentDocsResult) => Promise<void> | void;
  cwd: string;
  fileSystem?: FrameworkFileSystemBoundary;
  output?: FrameworkOutputFileSystemBoundary;
  snapshot: InstalledAgentDocsSnapshot;
}): Promise<InstallAgentDocsResult> {
  const outputBoundary = output ?? createFrameworkOutputFileSystemBoundary(cwd);
  const readBoundary = fileSystem ?? (await createFrameworkFileSystemBoundary(cwd));
  const digest = snapshot.snapshotDigest.slice('sha256:'.length);
  const directory = `.kovo/docs/snapshots/${digest}`;
  const manifest = snapshotManifest(snapshot);

  for (const file of snapshot.files) {
    await outputBoundary.writeFile(`${directory}/${file.path}`, file.content);
  }
  await outputBoundary.writeFile(`${directory}/manifest.json`, `${canonicalJson(manifest)}\n`);

  for (const file of snapshot.files) {
    const relativePath = `${directory}/${file.path}`;
    const bytes = await readExpectedFile(readBoundary, relativePath, file.bytes);
    if (sha256(bytes) !== file.sha256) {
      throw new TypeError(`${relativePath}: installed docs digest does not match snapshot`);
    }
  }
  const manifestBytes = await readExpectedFile(
    readBoundary,
    `${directory}/manifest.json`,
    Buffer.byteLength(`${canonicalJson(manifest)}\n`),
    MANIFEST_MAX_BYTES,
  );
  const installedManifest = parseManifest(manifestBytes);
  if (canonicalJson(installedManifest) !== canonicalJson(manifest)) {
    throw new TypeError('installed docs manifest does not match the selected snapshot');
  }

  const pointer: InstalledAgentDocsPointer = {
    publicManifestDigest: snapshot.publicManifestDigest,
    schema: installedAgentDocsPointerSchema,
    snapshotDigest: snapshot.snapshotDigest,
    sourceCommit: snapshot.sourceCommit,
    version: snapshot.version,
  };
  const result = Object.freeze({
    directory,
    files: snapshot.files.length,
    pointerPath: '.kovo/docs/current.json' as const,
    snapshotDigest: snapshot.snapshotDigest,
  });
  // Callers that must update a companion file can do so after every immutable snapshot byte has
  // been proved but before the one authoritative pointer selects it.
  await beforeSelect?.(result);
  await readBoundary.updateDurableFile(
    '.kovo/docs/current.json',
    () => `${canonicalJson(pointer)}\n`,
  );
  return result;
}

/** @internal Authenticate and return the active content-addressed manifest. */
export async function readActiveAgentDocsManifest({
  cwd,
  expectedSnapshot,
  fileSystem,
}: {
  cwd: string;
  expectedSnapshot: InstalledAgentDocsSnapshot;
  fileSystem?: FrameworkFileSystemBoundary;
}): Promise<InstalledAgentDocsManifest> {
  const boundary = fileSystem ?? (await createFrameworkFileSystemBoundary(cwd));
  let pointerBytes: Uint8Array | undefined;
  await boundary.updateDurableFile('.kovo/docs/current.json', (current) => {
    pointerBytes = current;
    return undefined;
  });
  if (pointerBytes === undefined) {
    throw new TypeError('no installed Kovo docs snapshot; run `kovo update-docs`');
  }
  if (pointerBytes.byteLength > POINTER_MAX_BYTES) {
    throw new TypeError('installed docs pointer exceeds its byte limit');
  }
  const pointer = parsePointer(pointerBytes);
  if (
    pointer.snapshotDigest !== expectedSnapshot.snapshotDigest ||
    pointer.publicManifestDigest !== expectedSnapshot.publicManifestDigest ||
    pointer.sourceCommit !== expectedSnapshot.sourceCommit ||
    pointer.version !== expectedSnapshot.version
  ) {
    throw new TypeError(
      `installed docs snapshot does not match CLI ${JSON.stringify(expectedSnapshot.version)}; run \`kovo update-docs\``,
    );
  }
  const digest = pointer.snapshotDigest.slice('sha256:'.length);
  const manifestPath = `.kovo/docs/snapshots/${digest}/manifest.json`;
  const manifestStat = await boundary.statFile(manifestPath);
  if (manifestStat === undefined || manifestStat.size > MANIFEST_MAX_BYTES) {
    throw new TypeError('installed docs manifest is missing or exceeds its byte limit');
  }
  const manifestBytes = await readExpectedFile(boundary, manifestPath, manifestStat.size);
  const manifest = parseManifest(manifestBytes);
  if (
    manifest.snapshotDigest !== pointer.snapshotDigest ||
    manifest.publicManifestDigest !== pointer.publicManifestDigest ||
    manifest.sourceCommit !== pointer.sourceCommit ||
    manifest.version !== pointer.version
  ) {
    throw new TypeError('installed docs pointer does not match its content-addressed manifest');
  }
  if (canonicalJson(manifest) !== canonicalJson(snapshotManifest(expectedSnapshot))) {
    throw new TypeError('installed docs manifest does not match the snapshot bundled with the CLI');
  }
  return manifest;
}

/** @internal Retrieve bounded, digest-checked docs results from the active snapshot. */
export async function searchInstalledAgentDocs({
  cwd,
  expectedSnapshot,
  fileSystem,
  limit = 5,
  maxExcerptBytes = 4_096,
  task,
}: {
  cwd: string;
  expectedSnapshot: InstalledAgentDocsSnapshot;
  fileSystem?: FrameworkFileSystemBoundary;
  limit?: number;
  maxExcerptBytes?: number;
  task: string;
}): Promise<readonly AgentDocsSearchResult[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) {
    throw new TypeError('docs result limit must be an integer from 1 through 8');
  }
  if (!Number.isSafeInteger(maxExcerptBytes) || maxExcerptBytes < 256 || maxExcerptBytes > 16_384) {
    throw new TypeError('docs excerpt limit must be 256..16384 bytes');
  }
  const query = normalizedTask(task);
  const boundary = fileSystem ?? (await createFrameworkFileSystemBoundary(cwd));
  const manifest = await readActiveAgentDocsManifest({
    cwd,
    expectedSnapshot,
    fileSystem: boundary,
  });
  const digest = manifest.snapshotDigest.slice('sha256:'.length);
  const ranked: Array<{
    file: Omit<InstalledAgentDocsFile, 'content'>;
    score: number;
    source: string;
  }> = [];
  for (const file of manifest.files) {
    if (file.path === 'llms-full.txt') continue;
    const relativePath = `.kovo/docs/snapshots/${digest}/${file.path}`;
    const bytes = await readExpectedFile(boundary, relativePath, file.bytes);
    if (sha256(bytes) !== file.sha256) {
      throw new TypeError(`${file.path}: installed docs content digest mismatch`);
    }
    const source = Buffer.from(bytes).toString('utf8');
    const score = searchScore(file.path, source, query);
    if (score > 0) ranked.push({ file, score, source });
  }
  ranked.sort(
    (left, right) => right.score - left.score || compareUtf8(left.file.path, right.file.path),
  );
  return Object.freeze(
    ranked.slice(0, limit).map(({ file, source }) =>
      Object.freeze({
        excerpt: boundedExcerpt(source, query, maxExcerptBytes),
        path: file.path,
        sha256: file.sha256,
        snapshotDigest: manifest.snapshotDigest,
        version: manifest.version,
      }),
    ),
  );
}

function snapshotManifest(snapshot: InstalledAgentDocsSnapshot): InstalledAgentDocsManifest {
  return Object.freeze({
    files: Object.freeze(
      snapshot.files.map((file) =>
        Object.freeze({ bytes: file.bytes, path: file.path, sha256: file.sha256 }),
      ),
    ),
    publicManifestDigest: snapshot.publicManifestDigest,
    schema: installedAgentDocsManifestSchema,
    snapshotDigest: snapshot.snapshotDigest,
    sourceCommit: snapshot.sourceCommit,
    version: snapshot.version,
  });
}

async function readExpectedFile(
  boundary: FrameworkFileSystemBoundary,
  relativePath: string,
  expectedBytes: number,
  maximumBytes = 2 * 1024 * 1024,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maximumBytes) {
    throw new TypeError(`${relativePath}: expected byte length exceeds its limit`);
  }
  const stat = await boundary.statFile(relativePath);
  if (stat === undefined || stat.size !== expectedBytes) {
    throw new TypeError(`${relativePath}: installed docs byte length mismatch`);
  }
  const result = await boundary.readFile(relativePath, { requireSingleLink: true });
  if (
    result === undefined ||
    !(result.body instanceof Uint8Array) ||
    result.size !== expectedBytes ||
    result.body.byteLength !== expectedBytes
  ) {
    throw new TypeError(`${relativePath}: installed docs file changed during read`);
  }
  return result.body;
}

function parsePointer(bytes: Uint8Array): InstalledAgentDocsPointer {
  const value = parseJsonObject(bytes, 'installed docs pointer');
  assertExactObjectKeys(
    value,
    ['publicManifestDigest', 'schema', 'snapshotDigest', 'sourceCommit', 'version'],
    'installed docs pointer',
  );
  if (value.schema !== installedAgentDocsPointerSchema) {
    throw new TypeError(`installed docs pointer schema must be ${installedAgentDocsPointerSchema}`);
  }
  assertDigest(value.publicManifestDigest, 'installed docs pointer publicManifestDigest');
  assertDigest(value.snapshotDigest, 'installed docs pointer snapshotDigest');
  assertSourceCommit(value.sourceCommit);
  assertVersion(value.version);
  return Object.freeze({
    publicManifestDigest: value.publicManifestDigest,
    schema: value.schema,
    snapshotDigest: value.snapshotDigest,
    sourceCommit: value.sourceCommit,
    version: value.version,
  });
}

function parseManifest(bytes: Uint8Array): InstalledAgentDocsManifest {
  const value = parseJsonObject(bytes, 'installed docs manifest');
  assertExactObjectKeys(
    value,
    ['files', 'publicManifestDigest', 'schema', 'snapshotDigest', 'sourceCommit', 'version'],
    'installed docs manifest',
  );
  if (value.schema !== installedAgentDocsManifestSchema) {
    throw new TypeError(
      `installed docs manifest schema must be ${installedAgentDocsManifestSchema}`,
    );
  }
  assertDigest(value.publicManifestDigest, 'installed docs manifest publicManifestDigest');
  assertDigest(value.snapshotDigest, 'installed docs manifest snapshotDigest');
  assertSourceCommit(value.sourceCommit);
  assertVersion(value.version);
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > 2_048) {
    throw new TypeError('installed docs manifest files must contain 1..2048 entries');
  }
  const seen = new Set<string>();
  const files = value.files.map((rawFile) => {
    assertExactObjectKeys(rawFile, ['bytes', 'path', 'sha256'], 'installed docs manifest file');
    assertSnapshotPath(rawFile.path);
    if (seen.has(rawFile.path)) {
      throw new TypeError(`installed docs manifest repeats ${JSON.stringify(rawFile.path)}`);
    }
    seen.add(rawFile.path);
    if (
      !Number.isSafeInteger(rawFile.bytes) ||
      (rawFile.bytes as number) < 0 ||
      (rawFile.bytes as number) > 2 * 1024 * 1024
    ) {
      throw new TypeError(`${rawFile.path}: installed docs byte length is invalid`);
    }
    assertDigest(rawFile.sha256, `${rawFile.path} sha256`);
    return Object.freeze({
      bytes: rawFile.bytes as number,
      path: rawFile.path,
      sha256: rawFile.sha256,
    });
  });
  const sorted = [...files].sort((left, right) => compareUtf8(left.path, right.path));
  if (files.some((file, index) => file.path !== sorted[index]?.path)) {
    throw new TypeError('installed docs manifest files are not in bytewise path order');
  }
  return Object.freeze({
    files: Object.freeze(files),
    publicManifestDigest: value.publicManifestDigest,
    schema: value.schema,
    snapshotDigest: value.snapshotDigest,
    sourceCommit: value.sourceCommit,
    version: value.version,
  });
}

function parseJsonObject(bytes: Uint8Array, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizedTask(value: string): readonly string[] {
  if (typeof value !== 'string') throw new TypeError('docs task must be a string');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes === 0 || bytes > 256) throw new TypeError('docs task must be 1..256 UTF-8 bytes');
  const tokens = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .split(/[^a-z0-9@._/-]+/u)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 16) {
    throw new TypeError('docs task must contain 1..16 searchable tokens');
  }
  return Object.freeze(tokens);
}

function searchScore(filePath: string, source: string, tokens: readonly string[]): number {
  const pathText = filePath.toLocaleLowerCase('en-US');
  const heading = source.match(/^#\s+(.+)$/mu)?.[1]?.toLocaleLowerCase('en-US') ?? '';
  const prefix = source.slice(0, 64 * 1024).toLocaleLowerCase('en-US');
  let score = 0;
  for (const token of tokens) {
    if (pathText.includes(token)) score += 12;
    if (heading.includes(token)) score += 8;
    if (prefix.includes(token)) score += 1;
  }
  return score;
}

function boundedExcerpt(source: string, tokens: readonly string[], maximumBytes: number): string {
  const lower = source.toLocaleLowerCase('en-US');
  const first = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const start = Math.max(0, (first ?? 0) - 512);
  let excerpt = source.slice(start, start + maximumBytes);
  while (Buffer.byteLength(excerpt, 'utf8') > maximumBytes) excerpt = excerpt.slice(0, -1);
  return excerpt;
}

function assertExactObjectKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertSnapshotPath(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 240 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)
  ) {
    throw new TypeError(`invalid installed docs path ${JSON.stringify(value)}`);
  }
}

function assertSourceCommit(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError('installed docs source commit must be a lowercase Git SHA');
  }
}

function assertVersion(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new TypeError('installed docs version must be an exact semantic version');
  }
}

function assertDigest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
}

function sha256(value: Uint8Array): `sha256:${string}` {
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
