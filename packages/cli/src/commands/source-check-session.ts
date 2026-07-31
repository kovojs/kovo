/* oxlint-disable typescript/unbound-method -- Boot-captured controls use pinned Reflect.apply. */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';

import {
  createKovoDiagnosticEnvelope,
  diagnosticContractDiagnostic,
  KOVO_DIAGNOSTIC_VERSION,
  type KovoDiagnosticCommandResult,
  type KovoDiagnosticRecord,
} from '../diagnostic.js';
import { type CliCommandResult } from '../shared.js';
import {
  buildApply,
  buildArrayIsArray,
  buildArrayJoin,
  buildArrayLength,
  buildByteLength,
  buildCreateMap,
  buildCreateSet,
  buildJsonStringify,
  buildMapGet,
  buildMapSet,
  buildOwnDataValue,
  buildRegExpExec,
  buildSecurityArrayAppend,
  buildSetAdd,
  buildSetHas,
  buildSnapshotDenseArray,
  buildStringEndsWith,
  buildStringIncludes,
  buildStringSplit,
  buildStringStartsWith,
} from './build-security-intrinsics.js';
import { readBoundedRegularFile } from './bounded-regular-file.js';

const watchProtocol = 'kovo-check-watch/v1';
const inputProofProtocol = 'kovo-check-input-proof/v1';
const phaseCensusProtocol = 'kovo-check-phase-census/v2';
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const NativeNumberIsFinite = Number.isFinite;
const NativeNumberIsSafeInteger = Number.isSafeInteger;
const NativeObjectFreeze = Object.freeze;
const NativeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const NativePromise = Promise;
const NativeTypeError = TypeError;
const bootstrapHash = createHash('sha256');
const NativeHashDigest = bootstrapHash.digest;
const NativeHashUpdate = bootstrapHash.update;
const NativeEventTargetAddEventListener = EventTarget.prototype.addEventListener;
const NativeEventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const NativeAbortSignalAborted = NativeObjectGetOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)?.get;
const positiveInfinity = Number.POSITIVE_INFINITY;
const stdout = process.stdout;
const stdoutWrite = stdout.write;
const ignoredDirectories = stringSet([
  '.git',
  '.kovo',
  '.next',
  '.output',
  '.release',
  '.turbo',
  '.vite',
  'coverage',
  'dist',
  'node_modules',
]);
const snapshotRaceCodes = stringSet([
  'EAGAIN',
  'EBUSY',
  'EISDIR',
  'ELOOP',
  'ENOENT',
  'ENOTDIR',
  'ESTALE',
]);
const phaseStatuses = stringSet([
  'executed',
  'not-applicable',
  'not-reached',
  'reused-authenticated',
]);
const maximumWatchedDirectories = 20_000;
const maximumWatchedDepth = 64;
const maximumWatchedEntries = 80_000;
const maximumWatchedFiles = 40_000;
const maximumWatchedBytes = 256 * 1024 * 1024;
const maximumWatchedFileBytes = 16 * 1024 * 1024;
const maximumWatchedSymlinks = 4_096;
const maximumSymlinkTargetBytes = 4_096;
const snapshotRaceBrand = Symbol('kovo.source-check-snapshot-race');

/** @internal Complete ordered census of source-check diagnostic-producing phases. */
export const KOVO_SOURCE_CHECK_PHASES = freeze([
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

/** @internal Production caps may only be narrowed by hostile scanner tests. */
export interface KovoSourceCheckSnapshotLimits {
  readonly bytes?: number;
  readonly depth?: number;
  readonly directories?: number;
  readonly entries?: number;
  readonly fileBytes?: number;
  readonly files?: number;
  readonly symlinks?: number;
}

/** @internal Test-only mutation point for deterministic readdir-to-lstat race fixtures. */
export interface KovoSourceCheckSnapshotTestHooks {
  readonly beforeEntryLstat?: (relativePath: string) => void;
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
  /** @internal Deterministic race/retry seam; production always uses the bounded scanner. */
  readonly snapshotProject?: (root: string) => KovoSourceCheckWatchSnapshot;
  readonly write?: (line: string) => void;
}

/** @internal A concurrent save invalidated only scheduling evidence; retry from a fresh state. */
export class KovoSourceCheckSnapshotRaceError extends Error {
  readonly [snapshotRaceBrand] = true;

  constructor(path: string) {
    super(`Source-check project changed during trigger snapshot: ${path}.`);
  }
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
  const closureByPath = buildCreateMap<string, KovoSourceCheckInputFile>();
  const closure: KovoSourceCheckInputFile[] = [];
  appendUniqueInputFiles(closureByPath, closure, app);
  appendUniqueInputFiles(closureByPath, closure, config);
  const entryFile = buildMapGet(closureByPath, entry);
  if (entryFile === undefined) {
    throw new NativeTypeError(`Source-check entry ${entry} is absent from its exact app closure.`);
  }
  const closureRows: Array<{
    readonly bytes: number;
    readonly digest: string;
    readonly path: string;
  }> = [];
  for (let index = 0; index < closure.length; index += 1) {
    buildSecurityArrayAppend(
      closureRows,
      fileDigestRow(closure[index]!),
      'Source-check input proof closure rows',
    );
  }
  const closureDigest = digestFrames(closure);
  const configClosureDigest =
    buildArrayLength(config, 'Source-check config closure') === 0 ? null : digestFrames(config);
  return freeze({
    closure: freeze(closureRows),
    closureDigest,
    configClosureDigest,
    entry: fileDigestRow(entryFile),
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
  if (buildRegExpExec(digestPattern, projectSnapshotDigest) === null) {
    throw new NativeTypeError(
      'Rejected source-check input requires an exact project snapshot digest.',
    );
  }
  return freeze({
    closure: null,
    closureDigest: null,
    configClosureDigest: null,
    entry: freeze({ bytes: null, digest: null, path: entry }),
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
  const invocationRoot = buildOwnDataValue(options, 'invocationRoot', 'Source-check watch options');
  const appModulePath = buildOwnDataValue(options, 'appModulePath', 'Source-check watch options');
  const runRevision = buildOwnDataValue(options, 'runRevision', 'Source-check watch options');
  if (
    typeof invocationRoot !== 'string' ||
    typeof appModulePath !== 'string' ||
    typeof runRevision !== 'function'
  ) {
    throw new NativeTypeError('Source-check watch options are invalid.');
  }
  const root = exactProjectRoot(invocationRoot);
  const appPath = resolve(root, appModulePath);
  assertInsideRoot(root, appPath, 'source-check watch entry');
  const pollIntervalValue = buildOwnDataValue(
    options,
    'pollIntervalMs',
    'Source-check watch options',
  );
  const maximumRevisionsValue = buildOwnDataValue(
    options,
    'maxRevisions',
    'Source-check watch options',
  );
  const signalValue = buildOwnDataValue(options, 'signal', 'Source-check watch options');
  const snapshotValue = buildOwnDataValue(options, 'snapshotProject', 'Source-check watch options');
  const writeValue = buildOwnDataValue(options, 'write', 'Source-check watch options');
  if (
    (pollIntervalValue !== undefined && typeof pollIntervalValue !== 'number') ||
    (maximumRevisionsValue !== undefined && typeof maximumRevisionsValue !== 'number') ||
    (signalValue !== undefined && (signalValue === null || typeof signalValue !== 'object')) ||
    (snapshotValue !== undefined && typeof snapshotValue !== 'function') ||
    (writeValue !== undefined && typeof writeValue !== 'function')
  ) {
    throw new NativeTypeError('Source-check watch optional controls are invalid.');
  }
  const interval = boundedPollInterval(pollIntervalValue ?? 75);
  const maximumRevisions = maximumRevisionsValue ?? positiveInfinity;
  if (
    maximumRevisions !== positiveInfinity &&
    (!nativeNumberIsSafeInteger(maximumRevisions) || maximumRevisions < 1)
  ) {
    throw new NativeTypeError('Source-check watch maxRevisions must be a positive integer.');
  }
  const signal = signalValue as AbortSignal | undefined;
  const runSourceRevision = runRevision as KovoSourceCheckWatchSessionOptions['runRevision'];
  const snapshotProject =
    (snapshotValue as KovoSourceCheckWatchSessionOptions['snapshotProject']) ??
    ((snapshotRoot: string) => snapshotKovoSourceCheckProject(snapshotRoot));
  const write =
    (writeValue as KovoSourceCheckWatchSessionOptions['write']) ??
    ((line: string) => {
      buildApply(stdoutWrite, stdout, [line]);
    });
  let trigger = await retryKovoSourceCheckSnapshot(root, snapshotProject, interval, signal);
  if (trigger === undefined) return 0;
  let revision = 0;
  let lastExit: 0 | 1 | 2 = 0;

  while (!signalAborted(signal)) {
    const checked = await runSourceRevision(revision, trigger);
    validateRevisionResult(checked);
    write(formatKovoSourceCheckWatchRecord(revision, checked));
    lastExit = checked.result.exitCode;
    revision += 1;
    if (revision >= maximumRevisions) return lastExit;

    for (;;) {
      if (signalAborted(signal)) return 0;
      await abortableDelay(interval, signal);
      if (signalAborted(signal)) return 0;
      const candidate = await retryKovoSourceCheckSnapshot(root, snapshotProject, interval, signal);
      if (candidate === undefined) return 0;
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
  if (!nativeNumberIsSafeInteger(revision) || revision < 0) {
    throw new NativeTypeError('Source-check watch revision must be a non-negative integer.');
  }
  validateRevisionResult(checked);
  const diagnosticEnvelope = sourceCheckDiagnosticEnvelope(checked.result);
  const serialized = buildJsonStringify({
    check: diagnosticEnvelope,
    event: 'revision',
    input: checked.input,
    phaseCensus: checked.census,
    revision,
    version: watchProtocol,
  });
  if (serialized === undefined) {
    throw new NativeTypeError('Source-check watch record could not be serialized.');
  }
  return `${serialized}\n`;
}

/**
 * @internal Deterministic bounded trigger snapshot for architecture and queue tests.
 *
 * This intentionally overapproximates the proof pipeline by observing every regular file outside
 * known generated/vendor trees. Extension allowlists are unsound here: formatter, linter,
 * TypeScript, config, package, and future compiler inputs are all allowed to use uncommon names.
 */
export function snapshotKovoSourceCheckProject(
  rootPath: string,
  narrowedLimits: KovoSourceCheckSnapshotLimits = {},
  testHooks: KovoSourceCheckSnapshotTestHooks = {},
): KovoSourceCheckWatchSnapshot {
  const root = exactProjectRoot(rootPath);
  const limits = sourceCheckSnapshotLimits(narrowedLimits);
  const beforeEntryLstat = buildOwnDataValue(
    testHooks,
    'beforeEntryLstat',
    'Source-check snapshot test hooks',
  );
  if (beforeEntryLstat !== undefined && typeof beforeEntryLstat !== 'function') {
    throw new NativeTypeError('Source-check snapshot beforeEntryLstat hook must be a function.');
  }
  const frames: string[] = [];
  const symlinks: string[] = [];
  let directories = 0;
  let entries = 0;
  let files = 0;
  let totalBytes = 0;

  const visit = (directory: string, depth: number): void => {
    if (depth > limits.depth) {
      throw new NativeTypeError('Source-check watch project snapshot exceeded its depth bound.');
    }
    directories += 1;
    if (directories > limits.directories) {
      throw new NativeTypeError(
        'Source-check watch project snapshot exceeded its directory bound.',
      );
    }
    const directoryBefore = stableLstat(directory);
    if (statKind(directoryBefore) !== 'directory') throw snapshotRace(directory);
    let names: string[];
    try {
      names = sortedStrings(
        buildSnapshotDenseArray(
          readdirSync(directory, { encoding: 'utf8' }),
          'Source-check directory entries',
        ),
      );
    } catch (error) {
      throw snapshotFilesystemError(error, directory);
    }
    assertSameStat(directoryBefore, stableLstat(directory), directory);
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index]!;
      entries += 1;
      if (entries > limits.entries) {
        throw new NativeTypeError('Source-check watch project snapshot exceeded its entry bound.');
      }
      if (name === '' || name === '.' || name === '..') {
        throw new NativeTypeError('Source-check watch encountered an ambiguous directory entry.');
      }
      const absolute = resolve(directory, name);
      assertInsideRoot(root, absolute, 'source-check watched path');
      const relativePath = slash(relative(root, absolute));
      if (beforeEntryLstat !== undefined) beforeEntryLstat(relativePath);
      const before = stableLstat(absolute);
      const kind = statKind(before);
      if (kind === 'symlink') {
        if (symlinks.length >= limits.symlinks) {
          throw new NativeTypeError(
            'Source-check watch project snapshot exceeded its symlink bound.',
          );
        }
        let target: string;
        try {
          target = readlinkSync(absolute, { encoding: 'utf8' });
        } catch (error) {
          throw snapshotFilesystemError(error, relativePath);
        }
        if (buildByteLength(target) > maximumSymlinkTargetBytes) {
          throw new NativeTypeError('Source-check watch symlink target exceeded its byte bound.');
        }
        assertSameStat(before, stableLstat(absolute), relativePath);
        buildSecurityArrayAppend(symlinks, relativePath, 'Source-check watch project symlinks');
        buildSecurityArrayAppend(
          frames,
          `L\0${relativePath}\0${target}`,
          'Source-check watch project frames',
        );
        continue;
      }
      if (kind === 'directory') {
        if (buildSetHas(ignoredDirectories, name)) continue;
        visit(absolute, depth + 1);
        assertSameStat(before, stableLstat(absolute), relativePath);
        continue;
      }
      if (kind !== 'file') {
        throw new NativeTypeError(
          `Source-check watch project contains a special filesystem entry: ${relativePath}.`,
        );
      }
      const size = statNumber(before, 'size', relativePath);
      if (size > limits.fileBytes) {
        throw new NativeTypeError(
          `Source-check watched file exceeds its byte bound: ${relativePath}.`,
        );
      }
      if (files >= limits.files || totalBytes + size > limits.bytes) {
        throw new NativeTypeError(
          'Source-check watch project snapshot exceeded its resource bounds.',
        );
      }
      const bytes = readStableRegularFile(absolute, relativePath, before, limits.fileBytes);
      files += 1;
      totalBytes += buildByteLength(bytes);
      if (totalBytes > limits.bytes) {
        throw new NativeTypeError(
          'Source-check watch project snapshot exceeded its resource bounds.',
        );
      }
      buildSecurityArrayAppend(
        frames,
        `F\0${relativePath}\0${digestBuffer(bytes)}`,
        'Source-check watch project frames',
      );
    }
    assertSameStat(
      directoryBefore,
      stableLstat(directory),
      slash(relative(root, directory)) || '.',
    );
  };

  visit(root, 0);
  return freeze({
    digest: digestText(buildArrayJoin(frames, '\0')),
    files,
    symlinks: freeze(sortedStrings(symlinks)),
  });
}

function sourceCheckDiagnosticEnvelope(result: CliCommandResult): {
  readonly diagnostics: readonly KovoDiagnosticRecord[];
  readonly result: KovoDiagnosticCommandResult;
  readonly version: typeof KOVO_DIAGNOSTIC_VERSION;
} {
  const exitCode = buildOwnDataValue(result, 'exitCode', 'Source-check command result');
  const output = buildOwnDataValue(result, 'output', 'Source-check command result');
  const error = buildOwnDataValue(result, 'error', 'Source-check command result');
  if (
    (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) ||
    (typeof output !== 'string' && typeof error !== 'string') ||
    (output !== undefined && error !== undefined)
  ) {
    throw new NativeTypeError('Source-check command result is invalid.');
  }
  const rawDiagnostics = buildOwnDataValue(result, 'diagnostics', 'Source-check command result');
  let diagnostics: KovoDiagnosticRecord[];
  if (rawDiagnostics === undefined) {
    diagnostics = exitCode === 0 ? [] : [diagnosticContractDiagnostic('proof')];
  } else {
    if (!buildArrayIsArray(rawDiagnostics)) {
      throw new NativeTypeError('Source-check command diagnostics must be an array.');
    }
    diagnostics = buildSnapshotDenseArray(
      rawDiagnostics as readonly KovoDiagnosticRecord[],
      'Source-check command diagnostics',
    );
    if (exitCode !== 0 && diagnostics.length === 0) {
      buildSecurityArrayAppend(
        diagnostics,
        diagnosticContractDiagnostic('proof'),
        'Source-check command diagnostics',
      );
    }
  }
  const envelope = createKovoDiagnosticEnvelope(diagnostics);
  const rawText = typeof error === 'string' ? error : (output as string);
  const text = exitCode === 0 || buildStringEndsWith(rawText, '\n') ? rawText : `${rawText}\n`;
  return freeze({
    diagnostics: envelope.diagnostics,
    result: freeze({
      command: 'check',
      exitCode,
      protocol: 'kovo-check/v1',
      text,
    }),
    version: envelope.version,
  });
}

function appendUniqueInputFiles(
  byPath: Map<string, KovoSourceCheckInputFile>,
  target: KovoSourceCheckInputFile[],
  values: readonly KovoSourceCheckInputFile[],
): void {
  const source = buildSnapshotDenseArray(values, 'Source-check canonical input files');
  for (let index = 0; index < source.length; index += 1) {
    const file = source[index]!;
    const existing = buildMapGet(byPath, file.fileName);
    if (existing !== undefined && existing.source !== file.source) {
      throw new NativeTypeError(
        `Source-check input proof has conflicting bytes for ${file.fileName}.`,
      );
    }
    if (existing !== undefined) continue;
    buildMapSet(byPath, file.fileName, file);
    insertInputFileSorted(target, file);
  }
}

function insertInputFileSorted(
  target: KovoSourceCheckInputFile[],
  value: KovoSourceCheckInputFile,
): void {
  buildSecurityArrayAppend(target, value, 'Source-check sorted input files');
  let index = target.length - 1;
  while (index > 0 && target[index - 1]!.fileName > value.fileName) {
    target[index] = target[index - 1]!;
    index -= 1;
  }
  target[index] = value;
}

function sortedStrings(values: readonly string[]): string[] {
  const source = buildSnapshotDenseArray(values, 'Source-check sorted strings');
  const result: string[] = [];
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const value = source[sourceIndex]!;
    if (typeof value !== 'string') {
      throw new NativeTypeError('Source-check filesystem identity must be text.');
    }
    buildSecurityArrayAppend(result, value, 'Source-check sorted strings');
    let index = result.length - 1;
    while (index > 0 && result[index - 1]! > value) {
      result[index] = result[index - 1]!;
      index -= 1;
    }
    result[index] = value;
  }
  return result;
}

function stringSet(values: readonly string[]): ReadonlySet<string> {
  const result = buildCreateSet<string>();
  for (let index = 0; index < values.length; index += 1) {
    buildSetAdd(result, values[index]!);
  }
  return result;
}

function sourceCheckSnapshotLimits(
  value: KovoSourceCheckSnapshotLimits,
): Required<KovoSourceCheckSnapshotLimits> {
  if (value === null || typeof value !== 'object' || buildArrayIsArray(value)) {
    throw new NativeTypeError('Source-check snapshot limits must be an object.');
  }
  return freeze({
    bytes: narrowedSnapshotLimit(value, 'bytes', maximumWatchedBytes, 1),
    depth: narrowedSnapshotLimit(value, 'depth', maximumWatchedDepth, 0),
    directories: narrowedSnapshotLimit(value, 'directories', maximumWatchedDirectories, 1),
    entries: narrowedSnapshotLimit(value, 'entries', maximumWatchedEntries, 1),
    fileBytes: narrowedSnapshotLimit(value, 'fileBytes', maximumWatchedFileBytes, 1),
    files: narrowedSnapshotLimit(value, 'files', maximumWatchedFiles, 1),
    symlinks: narrowedSnapshotLimit(value, 'symlinks', maximumWatchedSymlinks, 0),
  });
}

function narrowedSnapshotLimit(
  source: KovoSourceCheckSnapshotLimits,
  name: keyof KovoSourceCheckSnapshotLimits,
  maximum: number,
  minimum: number,
): number {
  const value = buildOwnDataValue(source, name, 'Source-check snapshot limits');
  if (value === undefined) return maximum;
  if (
    typeof value !== 'number' ||
    !nativeNumberIsSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new NativeTypeError(
      `Source-check snapshot ${name} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function stableLstat(path: string): ReturnType<typeof lstatSync> {
  try {
    return lstatSync(path);
  } catch (error) {
    throw snapshotFilesystemError(error, path);
  }
}

function statKind(stat: ReturnType<typeof lstatSync>): 'directory' | 'file' | 'other' | 'symlink' {
  const mode = statNumber(stat, 'mode', 'filesystem entry');
  const kind = mode & 0o170000;
  if (kind === 0o040000) return 'directory';
  if (kind === 0o100000) return 'file';
  if (kind === 0o120000) return 'symlink';
  return 'other';
}

function statNumber(
  stat: ReturnType<typeof lstatSync>,
  name: 'dev' | 'ino' | 'mode' | 'mtimeMs' | 'size',
  path: string,
): number {
  const value = buildOwnDataValue(stat, name, `Source-check filesystem metadata for ${path}`);
  if (
    typeof value !== 'number' ||
    !nativeNumberIsFinite(value) ||
    value < 0 ||
    (name !== 'mtimeMs' && !nativeNumberIsSafeInteger(value))
  ) {
    throw new NativeTypeError(`Source-check filesystem metadata is invalid for ${path}.`);
  }
  return value;
}

function assertSameStat(
  before: ReturnType<typeof lstatSync>,
  after: ReturnType<typeof lstatSync>,
  path: string,
): void {
  if (
    statKind(before) !== statKind(after) ||
    statNumber(before, 'dev', path) !== statNumber(after, 'dev', path) ||
    statNumber(before, 'ino', path) !== statNumber(after, 'ino', path) ||
    statNumber(before, 'size', path) !== statNumber(after, 'size', path) ||
    statNumber(before, 'mtimeMs', path) !== statNumber(after, 'mtimeMs', path)
  ) {
    throw snapshotRace(path);
  }
}

function readStableRegularFile(
  absolute: string,
  path: string,
  pathStat: ReturnType<typeof lstatSync>,
  maximumBytes: number,
): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = readBoundedRegularFile(absolute, {
      label: `Source-check watched file ${path}`,
      limitMessage: `Source-check watched file exceeds its byte bound: ${path}.`,
      maxBytes: maximumBytes,
    });
  } catch (error) {
    if (isSnapshotRace(error) || filesystemErrorCode(error) === undefined) throw error;
    throw snapshotFilesystemError(error, path);
  }
  assertSameStat(pathStat, stableLstat(absolute), path);
  if (buildByteLength(bytes) !== statNumber(pathStat, 'size', path)) throw snapshotRace(path);
  return bytes;
}

function snapshotFilesystemError(error: unknown, path: string): Error {
  const code = filesystemErrorCode(error);
  if (code !== undefined && buildSetHas(snapshotRaceCodes, code)) {
    return snapshotRace(path);
  }
  return new NativeTypeError(`Source-check trigger snapshot could not inspect ${path}.`);
}

function filesystemErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const code = buildOwnDataValue(error, 'code', 'Source-check filesystem error');
  return typeof code === 'string' ? code : undefined;
}

function snapshotRace(path: string): KovoSourceCheckSnapshotRaceError {
  return new KovoSourceCheckSnapshotRaceError(path);
}

function isSnapshotRace(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    buildOwnDataValue(error, snapshotRaceBrand, 'Source-check snapshot error') === true
  );
}

async function retryKovoSourceCheckSnapshot(
  root: string,
  snapshot: (root: string) => KovoSourceCheckWatchSnapshot,
  interval: number,
  signal: AbortSignal | undefined,
): Promise<KovoSourceCheckWatchSnapshot | undefined> {
  while (!signalAborted(signal)) {
    try {
      return validateWatchSnapshot(snapshot(root));
    } catch (error) {
      if (!isSnapshotRace(error)) throw error;
    }
    await abortableDelay(interval, signal);
  }
  return undefined;
}

function validateWatchSnapshot(value: KovoSourceCheckWatchSnapshot): KovoSourceCheckWatchSnapshot {
  if (value === null || typeof value !== 'object') {
    throw new NativeTypeError('Source-check snapshot callback returned an invalid result.');
  }
  const digest = buildOwnDataValue(value, 'digest', 'Source-check watch snapshot');
  const files = buildOwnDataValue(value, 'files', 'Source-check watch snapshot');
  const symlinkValue = buildOwnDataValue(value, 'symlinks', 'Source-check watch snapshot');
  if (
    typeof digest !== 'string' ||
    buildRegExpExec(digestPattern, digest) === null ||
    typeof files !== 'number' ||
    !nativeNumberIsSafeInteger(files) ||
    files < 0 ||
    !buildArrayIsArray(symlinkValue)
  ) {
    throw new NativeTypeError('Source-check snapshot callback returned invalid evidence.');
  }
  const symlinks = buildSnapshotDenseArray(
    symlinkValue as readonly string[],
    'Source-check watch snapshot symlinks',
  );
  for (let index = 0; index < symlinks.length; index += 1) {
    exactRelativePath(symlinks[index]!, `Source-check watch symlink[${index}]`);
  }
  return freeze({ digest, files, symlinks: freeze(symlinks) });
}

function canonicalInputFiles(
  files: readonly KovoSourceCheckInputFile[],
  label: string,
): readonly KovoSourceCheckInputFile[] {
  if (!buildArrayIsArray(files)) throw new NativeTypeError(`${label} must be an array.`);
  const source = buildSnapshotDenseArray(files, label);
  const byPath = buildCreateMap<string, KovoSourceCheckInputFile>();
  const result: KovoSourceCheckInputFile[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const file = source[index]!;
    if (file === null || typeof file !== 'object') {
      throw new NativeTypeError(`${label}[${index}] must be a source file.`);
    }
    const fileNameValue = buildOwnDataValue(file, 'fileName', `${label}[${index}]`);
    const fileSource = buildOwnDataValue(file, 'source', `${label}[${index}]`);
    if (typeof fileNameValue !== 'string' || typeof fileSource !== 'string') {
      throw new NativeTypeError(`${label}[${index}] must carry source text and identity.`);
    }
    const fileName = exactRelativePath(fileNameValue, `${label}[${index}]`);
    const existing = buildMapGet(byPath, fileName);
    if (existing !== undefined && existing.source !== fileSource) {
      throw new NativeTypeError(`${label} has conflicting duplicate ${fileName}.`);
    }
    if (existing !== undefined) continue;
    const snapshot = freeze({ fileName, source: fileSource });
    buildMapSet(byPath, fileName, snapshot);
    insertInputFileSorted(result, snapshot);
  }
  return freeze(result);
}

function fileDigestRow(file: KovoSourceCheckInputFile): {
  readonly bytes: number;
  readonly digest: string;
  readonly path: string;
} {
  return freeze({
    bytes: buildByteLength(file.source),
    digest: digestText(file.source),
    path: file.fileName,
  });
}

function digestFrames(files: readonly KovoSourceCheckInputFile[]): string {
  const source = buildSnapshotDenseArray(files, 'Source-check digest input files');
  const digest = createHash('sha256');
  for (let index = 0; index < source.length; index += 1) {
    const file = source[index]!;
    hashUpdate(digest, `${buildByteLength(file.fileName)}:`);
    hashUpdate(digest, file.fileName);
    hashUpdate(digest, `${buildByteLength(file.source)}:`);
    hashUpdate(digest, file.source);
  }
  return `sha256:${hashDigest(digest)}`;
}

function digestBuffer(value: Uint8Array): string {
  const digest = createHash('sha256');
  hashUpdate(digest, value);
  return `sha256:${hashDigest(digest)}`;
}

function digestText(value: string): string {
  const digest = createHash('sha256');
  hashUpdate(digest, value);
  return `sha256:${hashDigest(digest)}`;
}

function exactRelativePath(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    buildStringIncludes(value, '\\') ||
    isAbsolute(value)
  ) {
    throw new NativeTypeError(`${label} must be a project-relative slash path.`);
  }
  const parts = buildStringSplit(value, '/');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (part === '' || part === '.' || part === '..') {
      throw new NativeTypeError(`${label} must not contain ambiguous path segments.`);
    }
  }
  return value;
}

function exactProjectRoot(root: string): string {
  const absolute = resolve(root);
  const stat = stableLstat(absolute);
  if (statKind(stat) !== 'directory' || realpathSync(absolute) !== absolute) {
    throw new NativeTypeError('Source-check watch root must be one stable non-symlink directory.');
  }
  return absolute;
}

function assertInsideRoot(root: string, candidate: string, label: string): void {
  const rel = relative(root, candidate);
  if (rel === '..' || buildStringStartsWith(rel, `..${sep}`) || isAbsolute(rel)) {
    throw new NativeTypeError(`${label} escapes the invocation project.`);
  }
}

function slash(value: string): string {
  return sep === '/' ? value : buildArrayJoin(buildStringSplit(value, sep), '/');
}

function boundedPollInterval(value: number): number {
  if (!nativeNumberIsFinite(value) || value < 25 || value > 2_000) {
    throw new NativeTypeError('Source-check watch pollIntervalMs must be between 25 and 2000.');
  }
  return value;
}

function validateRevisionResult(checked: KovoSourceCheckRevisionResult): void {
  if (checked.input.schema !== inputProofProtocol) {
    throw new NativeTypeError('Source-check revision returned an unknown input-proof schema.');
  }
  if (
    checked.census.schema !== phaseCensusProtocol ||
    (checked.census.checkGraphDigest !== null &&
      buildRegExpExec(digestPattern, checked.census.checkGraphDigest) === null) ||
    buildArrayLength(checked.census.phases, 'Source-check phase census') !==
      KOVO_SOURCE_CHECK_PHASES.length
  ) {
    throw new NativeTypeError('Source-check revision returned an invalid phase census.');
  }
  if (buildRegExpExec(digestPattern, checked.input.projectDigest) === null) {
    throw new NativeTypeError('Source-check revision returned invalid input digests.');
  }
  if (checked.input.status === 'accepted') {
    if (
      buildRegExpExec(digestPattern, checked.input.closureDigest) === null ||
      buildRegExpExec(digestPattern, checked.input.entry.digest) === null ||
      (checked.input.configClosureDigest !== null &&
        buildRegExpExec(digestPattern, checked.input.configClosureDigest) === null)
    ) {
      throw new NativeTypeError('Source-check revision returned invalid input digests.');
    }
  } else if (
    checked.input.closure !== null ||
    checked.input.closureDigest !== null ||
    checked.input.configClosureDigest !== null ||
    checked.input.entry.bytes !== null ||
    checked.input.entry.digest !== null
  ) {
    throw new NativeTypeError('Rejected source-check input fabricated unavailable byte digests.');
  }
  if (
    checked.input.status === 'rejected' &&
    (checked.result.exitCode === 0 || checked.census.checkGraphDigest !== null)
  ) {
    throw new NativeTypeError('Rejected source-check input cannot publish a passing graph proof.');
  }
  let notReached = false;
  const phases = buildSnapshotDenseArray(checked.census.phases, 'Source-check phase census');
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index]!;
    if (
      phase.name !== KOVO_SOURCE_CHECK_PHASES[index] ||
      !nativeNumberIsFinite(phase.durationMs) ||
      phase.durationMs < 0 ||
      buildRegExpExec(digestPattern, phase.inputDigest) === null ||
      !buildSetHas(phaseStatuses, phase.status)
    ) {
      throw new NativeTypeError(`Source-check revision returned invalid phase ${phase.name}.`);
    }
    if (
      (phase.status === 'not-applicable' ||
        phase.status === 'not-reached' ||
        phase.status === 'reused-authenticated') &&
      phase.durationMs !== 0
    ) {
      throw new NativeTypeError(
        `Source-check revision returned nonzero skipped phase ${phase.name}.`,
      );
    }
    if (notReached && phase.status !== 'not-reached') {
      throw new NativeTypeError(
        `Source-check revision resumed after phase ${phase.name} was not reached.`,
      );
    }
    if (phase.status === 'not-reached') notReached = true;
  }
}

function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new NativePromise((resolveDelay) => {
    if (signalAborted(signal)) {
      resolveDelay();
      return;
    }
    const timer = setNodeTimeout(done, milliseconds);
    function done(): void {
      clearNodeTimeout(timer);
      if (signal !== undefined) removeAbortListener(signal, done);
      resolveDelay();
    }
    if (signal !== undefined) addAbortListener(signal, done);
  });
}

function freeze<Value extends object>(value: Value): Readonly<Value> {
  return buildApply<Readonly<Value>>(NativeObjectFreeze, undefined, [value]);
}

function nativeNumberIsFinite(value: number): boolean {
  return buildApply<boolean>(NativeNumberIsFinite, undefined, [value]);
}

function nativeNumberIsSafeInteger(value: number): boolean {
  return buildApply<boolean>(NativeNumberIsSafeInteger, undefined, [value]);
}

function hashUpdate(digest: ReturnType<typeof createHash>, value: string | Uint8Array): void {
  buildApply(NativeHashUpdate, digest, [value]);
}

function hashDigest(digest: ReturnType<typeof createHash>): string {
  return buildApply<string>(NativeHashDigest, digest, ['hex']);
}

function signalAborted(signal: AbortSignal | undefined): boolean {
  if (signal === undefined) return false;
  if (typeof NativeAbortSignalAborted !== 'function') {
    throw new NativeTypeError('Source-check abort control is unavailable.');
  }
  return buildApply<boolean>(NativeAbortSignalAborted, signal, []);
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
  buildApply(NativeEventTargetAddEventListener, signal, [
    'abort',
    listener,
    freeze({ once: true }),
  ]);
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  buildApply(NativeEventTargetRemoveEventListener, signal, ['abort', listener]);
}
