import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  formatKovoDiagnosticCommandResult,
  type KovoDiagnosticCommandResult,
} from '../diagnostic.js';
import { normalizeCommandResultDiagnostics, type CliCommandResult } from '../shared.js';

const watchProtocol = 'kovo-check-watch/v1';
const inputProofProtocol = 'kovo-check-input-proof/v1';
const phaseCensusProtocol = 'kovo-check-phase-census/v2';
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const ignoredDirectories = new Set([
  '.git',
  '.kovo',
  '.turbo',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
]);
const watchedExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.sql',
  '.ts',
  '.tsx',
]);
const watchedRootFiles = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.js',
  'vite.config.mjs',
  'kovo.config.ts',
  'kovo.config.mts',
  'kovo.config.js',
  'kovo.config.mjs',
]);
const maximumWatchedFiles = 40_000;
const maximumWatchedBytes = 256 * 1024 * 1024;

/** @internal Complete ordered census of source-check diagnostic-producing phases. */
export const KOVO_SOURCE_CHECK_PHASES = Object.freeze([
  'lifecycle-policy',
  'config-trust',
  'typescript',
  'project-quality',
  'sound-subset',
  'session-authority',
  'app-source-trust',
  'stylesheet',
  'app-evaluation',
  'build-check-graph',
  'graph-diagnostics',
] as const);

/** @internal One immutable authored file admitted to a source-check input proof. */
export interface KovoSourceCheckInputFile {
  readonly fileName: string;
  readonly source: string;
}

/** @internal Exact digest evidence for one accepted source-check revision. */
export interface KovoAcceptedSourceCheckInputProof {
  readonly closure: readonly {
    readonly bytes: number;
    readonly digest: string;
    readonly path: string;
  }[];
  readonly closureDigest: string;
  readonly configClosureDigest: string | null;
  readonly entry: {
    readonly bytes: number;
    readonly digest: string;
    readonly path: string;
  };
  readonly projectDigest: string;
  readonly schema: typeof inputProofProtocol;
  readonly status: 'accepted';
}

/** @internal Fail-closed evidence for an input whose bytes cannot truthfully be digested. */
export interface KovoRejectedSourceCheckInputProof {
  readonly closure: null;
  readonly closureDigest: null;
  readonly configClosureDigest: null;
  readonly entry: {
    readonly bytes: null;
    readonly digest: null;
    readonly path: string;
  };
  readonly projectDigest: string;
  readonly reason: 'ambiguous-closure' | 'missing' | 'renamed' | 'symlink';
  readonly schema: typeof inputProofProtocol;
  readonly status: 'rejected';
}

/** @internal Exact accepted bytes or an explicit refusal to invent unavailable digests. */
export type KovoSourceCheckInputProof =
  | KovoAcceptedSourceCheckInputProof
  | KovoRejectedSourceCheckInputProof;

/** @internal Status vocabulary for the complete diagnostic-producing phase census. */
export type KovoSourceCheckPhaseStatus =
  | 'executed'
  | 'not-applicable'
  | 'not-reached'
  | 'reused-authenticated';

/** @internal One phase observation bound to the exact facts it consumed. */
export interface KovoSourceCheckPhaseObservation {
  readonly durationMs: number;
  readonly inputDigest: string;
  readonly name: string;
  readonly status: KovoSourceCheckPhaseStatus;
}

/** @internal Complete source-check phase evidence for one foreground revision. */
export interface KovoSourceCheckPhaseCensusV2 {
  readonly checkGraphDigest: string | null;
  readonly phases: readonly KovoSourceCheckPhaseObservation[];
  readonly schema: typeof phaseCensusProtocol;
}

/** @internal Result returned by the exact one-shot source-proof pipeline per revision. */
export interface KovoSourceCheckRevisionResult {
  readonly census: KovoSourceCheckPhaseCensusV2;
  readonly input: KovoSourceCheckInputProof;
  readonly result: CliCommandResult;
}

/** @internal Bounded project trigger snapshot. It is scheduling evidence, never proof authority. */
export interface KovoSourceCheckWatchSnapshot {
  readonly digest: string;
  readonly files: number;
  readonly symlinks: readonly string[];
}

/** @internal Dependencies for one foreground source-check session. */
export interface KovoSourceCheckWatchSessionOptions {
  readonly appModulePath: string;
  readonly invocationRoot: string;
  readonly maxRevisions?: number;
  readonly pollIntervalMs?: number;
  readonly runRevision: (
    revision: number,
    trigger: KovoSourceCheckWatchSnapshot,
  ) => Promise<KovoSourceCheckRevisionResult>;
  readonly signal?: AbortSignal;
  readonly write?: (line: string) => void;
}

/**
 * Construct exact content-addressed source/config/closure evidence from the same immutable
 * source snapshots consumed by the one-shot compiler pipeline.
 *
 * The inputs are facts, not a cache: every call revalidates exact project-relative identities,
 * rejects conflicting duplicate carriers, and derives all digests from the admitted bytes.
 */
export function createKovoSourceCheckInputProof(
  entryPath: string,
  appFiles: readonly KovoSourceCheckInputFile[],
  configFiles: readonly KovoSourceCheckInputFile[] = [],
): KovoAcceptedSourceCheckInputProof {
  const entry = exactRelativePath(entryPath, 'source-check entry');
  const app = canonicalInputFiles(appFiles, 'source-check app closure');
  const config = canonicalInputFiles(configFiles, 'source-check config closure');
  const closureByPath = new Map<string, KovoSourceCheckInputFile>();
  for (const file of [...app, ...config]) {
    const existing = closureByPath.get(file.fileName);
    if (existing !== undefined && existing.source !== file.source) {
      throw new TypeError(`Source-check input proof has conflicting bytes for ${file.fileName}.`);
    }
    closureByPath.set(file.fileName, file);
  }
  const closure = [...closureByPath.values()].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  );
  const entryFile = closureByPath.get(entry);
  if (entryFile === undefined) {
    throw new TypeError(`Source-check entry ${entry} is absent from its exact app closure.`);
  }
  const closureRows = closure.map(fileDigestRow);
  const closureDigest = digestFrames(closure.map((file) => [file.fileName, file.source] as const));
  const configClosureDigest =
    config.length === 0
      ? null
      : digestFrames(config.map((file) => [file.fileName, file.source] as const));
  return Object.freeze({
    closure: Object.freeze(closureRows),
    closureDigest,
    configClosureDigest,
    entry: Object.freeze(fileDigestRow(entryFile)),
    projectDigest: digestText(`${entry}\0${closureDigest}\0${configClosureDigest ?? 'none'}`),
    schema: inputProofProtocol,
    status: 'accepted',
  });
}

/**
 * Represent a missing or ambiguous revision without assigning a digest to bytes that were never
 * admitted. The bounded project snapshot identifies the rejected filesystem state but is not
 * mislabeled as a source or closure digest.
 */
export function createRejectedKovoSourceCheckInputProof(
  entryPath: string,
  projectSnapshotDigest: string,
  reason: KovoRejectedSourceCheckInputProof['reason'],
): KovoRejectedSourceCheckInputProof {
  const entry = exactRelativePath(entryPath, 'rejected source-check entry');
  if (!digestPattern.test(projectSnapshotDigest)) {
    throw new TypeError('Rejected source-check input requires an exact project snapshot digest.');
  }
  return Object.freeze({
    closure: null,
    closureDigest: null,
    configClosureDigest: null,
    entry: Object.freeze({ bytes: null, digest: null, path: entry }),
    projectDigest: projectSnapshotDigest,
    reason,
    schema: inputProofProtocol,
    status: 'rejected',
  });
}

/**
 * Run one foreground, project-confined revision stream.
 *
 * There is no daemon or global cache. At most one revision runs and one latest filesystem state
 * waits behind it: edits that arrive during a slow proof collapse into the next exact snapshot,
 * so the queue is bounded and revision order is serialized.
 */
export async function runKovoSourceCheckWatchSession(
  options: KovoSourceCheckWatchSessionOptions,
): Promise<0 | 1 | 2> {
  const root = exactProjectRoot(options.invocationRoot);
  const appPath = resolve(root, options.appModulePath);
  assertInsideRoot(root, appPath, 'source-check watch entry');
  const interval = boundedPollInterval(options.pollIntervalMs ?? 75);
  const maximumRevisions = options.maxRevisions ?? Number.POSITIVE_INFINITY;
  if (
    maximumRevisions !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(maximumRevisions) || maximumRevisions < 1)
  ) {
    throw new TypeError('Source-check watch maxRevisions must be a positive integer.');
  }
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  let trigger = snapshotKovoSourceCheckProject(root);
  let revision = 0;
  let lastExit: 0 | 1 | 2 = 0;

  while (!options.signal?.aborted) {
    const checked = await options.runRevision(revision, trigger);
    validateRevisionResult(checked);
    write(formatKovoSourceCheckWatchRecord(revision, checked));
    lastExit = checked.result.exitCode;
    revision += 1;
    if (revision >= maximumRevisions) return lastExit;

    for (;;) {
      if (options.signal?.aborted) return 0;
      await abortableDelay(interval, options.signal);
      if (options.signal?.aborted) return 0;
      const candidate = snapshotKovoSourceCheckProject(root);
      if (candidate.digest === trigger.digest) continue;
      trigger = candidate;
      break;
    }
  }
  return 0;
}

/** @internal Render exactly one self-contained JSONL record. */
export function formatKovoSourceCheckWatchRecord(
  revision: number,
  checked: KovoSourceCheckRevisionResult,
): string {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('Source-check watch revision must be a non-negative integer.');
  }
  validateRevisionResult(checked);
  const normalized = normalizeCommandResultDiagnostics(checked.result, 'proof');
  const text = 'error' in normalized ? normalized.error : normalized.output;
  const commandResult: KovoDiagnosticCommandResult = Object.freeze({
    command: 'check',
    exitCode: normalized.exitCode,
    protocol: 'kovo-check/v1',
    text,
  });
  const diagnosticEnvelope = JSON.parse(
    formatKovoDiagnosticCommandResult(normalized.diagnostics ?? [], commandResult, 'json'),
  ) as unknown;
  return `${JSON.stringify({
    check: diagnosticEnvelope,
    event: 'revision',
    input: checked.input,
    phaseCensus: checked.census,
    revision,
    version: watchProtocol,
  })}\n`;
}

/** @internal Deterministic bounded trigger snapshot for architecture and queue tests. */
export function snapshotKovoSourceCheckProject(rootPath: string): KovoSourceCheckWatchSnapshot {
  const root = exactProjectRoot(rootPath);
  const frames: string[] = [];
  const symlinks: string[] = [];
  let files = 0;
  let totalBytes = 0;

  const visit = (directory: string): void => {
    const relativeDirectory = relative(root, directory);
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      if (entry.name === '' || entry.name === '.' || entry.name === '..') {
        throw new TypeError('Source-check watch encountered an ambiguous directory entry.');
      }
      const absolute = resolve(directory, entry.name);
      assertInsideRoot(root, absolute, 'source-check watched path');
      const relativePath = slash(relative(root, absolute));
      const before = lstatSync(absolute);
      if (before.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        symlinks.push(relativePath);
        frames.push(`L\0${relativePath}\0${target}`);
        continue;
      }
      if (before.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        visit(absolute);
        continue;
      }
      if (!before.isFile() || !watchedFile(relativePath, relativeDirectory === '')) continue;
      const bytes = readFileSync(absolute);
      const after = lstatSync(absolute);
      if (
        !after.isFile() ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs
      ) {
        throw new TypeError(`Source-check watched file changed during snapshot: ${relativePath}.`);
      }
      files += 1;
      totalBytes += bytes.byteLength;
      if (files > maximumWatchedFiles || totalBytes > maximumWatchedBytes) {
        throw new TypeError('Source-check watch project snapshot exceeded its resource bounds.');
      }
      frames.push(`F\0${relativePath}\0${digestBuffer(bytes)}`);
    }
  };

  visit(root);
  return Object.freeze({
    digest: digestText(frames.join('\0')),
    files,
    symlinks: Object.freeze(symlinks.sort()),
  });
}

function canonicalInputFiles(
  files: readonly KovoSourceCheckInputFile[],
  label: string,
): readonly KovoSourceCheckInputFile[] {
  if (!Array.isArray(files)) throw new TypeError(`${label} must be an array.`);
  const byPath = new Map<string, KovoSourceCheckInputFile>();
  for (const [index, file] of files.entries()) {
    if (file === null || typeof file !== 'object') {
      throw new TypeError(`${label}[${index}] must be a source file.`);
    }
    const fileName = exactRelativePath(file.fileName, `${label}[${index}]`);
    if (typeof file.source !== 'string') {
      throw new TypeError(`${label}[${index}] must carry source text.`);
    }
    const existing = byPath.get(fileName);
    if (existing !== undefined && existing.source !== file.source) {
      throw new TypeError(`${label} has conflicting duplicate ${fileName}.`);
    }
    byPath.set(fileName, Object.freeze({ fileName, source: file.source }));
  }
  return Object.freeze(
    [...byPath.values()].sort((left, right) => left.fileName.localeCompare(right.fileName)),
  );
}

function fileDigestRow(file: KovoSourceCheckInputFile): {
  readonly bytes: number;
  readonly digest: string;
  readonly path: string;
} {
  const bytes = Buffer.from(file.source, 'utf8');
  return {
    bytes: bytes.byteLength,
    digest: digestBuffer(bytes),
    path: file.fileName,
  };
}

function digestFrames(files: readonly (readonly [string, string])[]): string {
  const hash = createHash('sha256');
  for (const [fileName, source] of files) {
    const nameBytes = Buffer.from(fileName, 'utf8');
    const sourceBytes = Buffer.from(source, 'utf8');
    hash.update(`${nameBytes.byteLength}:`);
    hash.update(nameBytes);
    hash.update(`${sourceBytes.byteLength}:`);
    hash.update(sourceBytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

function digestBuffer(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digestText(value: string): string {
  return digestBuffer(Buffer.from(value, 'utf8'));
}

function exactRelativePath(value: string, label: string): string {
  if (typeof value !== 'string' || value === '' || value.includes('\\') || isAbsolute(value)) {
    throw new TypeError(`${label} must be a project-relative slash path.`);
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`${label} must not contain ambiguous path segments.`);
  }
  return value;
}

function exactProjectRoot(root: string): string {
  const absolute = resolve(root);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(absolute) !== absolute) {
    throw new TypeError('Source-check watch root must be one stable non-symlink directory.');
  }
  return absolute;
}

function assertInsideRoot(root: string, candidate: string, label: string): void {
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new TypeError(`${label} escapes the invocation project.`);
  }
}

function watchedFile(path: string, atRoot: boolean): boolean {
  if (atRoot && watchedRootFiles.has(path)) return true;
  const dot = path.lastIndexOf('.');
  return dot >= 0 && watchedExtensions.has(path.slice(dot));
}

function slash(value: string): string {
  return value.split(sep).join('/');
}

function boundedPollInterval(value: number): number {
  if (!Number.isFinite(value) || value < 25 || value > 2_000) {
    throw new TypeError('Source-check watch pollIntervalMs must be between 25 and 2000.');
  }
  return value;
}

function validateRevisionResult(checked: KovoSourceCheckRevisionResult): void {
  if (checked.input.schema !== inputProofProtocol) {
    throw new TypeError('Source-check revision returned an unknown input-proof schema.');
  }
  if (
    checked.census.schema !== phaseCensusProtocol ||
    (checked.census.checkGraphDigest !== null &&
      !digestPattern.test(checked.census.checkGraphDigest)) ||
    checked.census.phases.length !== KOVO_SOURCE_CHECK_PHASES.length
  ) {
    throw new TypeError('Source-check revision returned an invalid phase census.');
  }
  if (!digestPattern.test(checked.input.projectDigest)) {
    throw new TypeError('Source-check revision returned invalid input digests.');
  }
  if (checked.input.status === 'accepted') {
    if (
      !digestPattern.test(checked.input.closureDigest) ||
      !digestPattern.test(checked.input.entry.digest) ||
      (checked.input.configClosureDigest !== null &&
        !digestPattern.test(checked.input.configClosureDigest))
    ) {
      throw new TypeError('Source-check revision returned invalid input digests.');
    }
  } else if (
    checked.input.closure !== null ||
    checked.input.closureDigest !== null ||
    checked.input.configClosureDigest !== null ||
    checked.input.entry.bytes !== null ||
    checked.input.entry.digest !== null
  ) {
    throw new TypeError('Rejected source-check input fabricated unavailable byte digests.');
  }
  if (
    checked.input.status === 'rejected' &&
    (checked.result.exitCode === 0 || checked.census.checkGraphDigest !== null)
  ) {
    throw new TypeError('Rejected source-check input cannot publish a passing graph proof.');
  }
  let notReached = false;
  for (const [index, phase] of checked.census.phases.entries()) {
    if (
      phase.name !== KOVO_SOURCE_CHECK_PHASES[index] ||
      !Number.isFinite(phase.durationMs) ||
      phase.durationMs < 0 ||
      !digestPattern.test(phase.inputDigest) ||
      !['executed', 'not-applicable', 'not-reached', 'reused-authenticated'].includes(phase.status)
    ) {
      throw new TypeError(`Source-check revision returned invalid phase ${phase.name}.`);
    }
    if (
      (phase.status === 'not-applicable' ||
        phase.status === 'not-reached' ||
        phase.status === 'reused-authenticated') &&
      phase.durationMs !== 0
    ) {
      throw new TypeError(`Source-check revision returned nonzero skipped phase ${phase.name}.`);
    }
    if (notReached && phase.status !== 'not-reached') {
      throw new TypeError(
        `Source-check revision resumed after phase ${phase.name} was not reached.`,
      );
    }
    if (phase.status === 'not-reached') notReached = true;
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolveDelay) => {
    if (signal?.aborted) {
      resolveDelay();
      return;
    }
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolveDelay();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
