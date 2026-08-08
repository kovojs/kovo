import { isAbsolute, resolve } from 'node:path';

import {
  createFrameworkFileSystemBoundary,
  isFrameworkFileSystemBoundary,
  type FrameworkFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';
import { blessSink, isBlessedSink } from '@kovojs/core/internal/sink-policy';

import { respond, type RouteResponseOutcome, type RouteStreamOptions } from './response.js';
import { securityIsUint8Array } from './response-security-intrinsics.js';
import {
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
  witnessObjectKeys,
} from './security-witness-intrinsics.js';

type RootedFileServeSink = 'rooted-file-serve';

/** Options for serving a file from a rooted filesystem capability. */
export interface RootedFileServeOptions extends Omit<RouteStreamOptions, 'disposition'> {
  disposition?: 'attachment' | 'inline';
}

/**
 * A framework-owned filesystem serving capability rooted at one real directory.
 *
 * App code passes request-derived path segments to {@link RootedFiles.serve}; the primitive resolves
 * through realpath containment before reading and returns the existing route response outcome instead
 * of exposing the resolved filesystem path to app code.
 */
export interface RootedFiles {
  readonly root: string;
  serve(path: string, options: RootedFileServeOptions): Promise<RouteResponseOutcome | undefined>;
}

const nativePathIsAbsolute = isAbsolute;
const nativePathResolve = resolve;
const nativeEncodeURIComponent = encodeURIComponent;
// SPEC §14 / plans/good-perf.md O16: the generated production server entry sets this before it
// imports the handler graph so relative `rootedFiles()` roots resolve deterministically against
// the artifact's staged copies instead of against the launch process's working directory. Boot-read
// once; app code that later mutates process.env cannot re-point already-resolved roots.
const stagedRootedFilesDirectory = readStagedRootedFilesDirectory();

function readStagedRootedFilesDirectory(): string | undefined {
  const environment = typeof process === 'object' && process !== null ? process.env : undefined;
  const value = environment?.KOVO_ROOTED_FILES_DIR;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * @internal Deterministic single-segment staging name shared by the runtime resolver above and
 * the build preset emitters (SPEC §14). The `root-` prefix guarantees the name is never `.`/`..`,
 * and percent-encoding folds every path separator into the single directory entry name.
 */
export function stagedRootedFilesEntryName(root: string): string {
  return `root-${nativeEncodeURIComponent(root)}`;
}

function stagedRootedFilesRoot(root: string): string | undefined {
  if (stagedRootedFilesDirectory === undefined) return undefined;
  if (typeof root !== 'string' || root.length === 0 || nativePathIsAbsolute(root)) {
    return undefined;
  }
  return nativePathResolve(stagedRootedFilesDirectory, stagedRootedFilesEntryName(root));
}

const MAX_RECORDED_ROOTED_FILES_ROOTS = 128;
const rootedFilesBuildRoots: { readonly root: string; readonly spec: string }[] = [];

function recordRootedFilesBuildRoot(spec: string, root: string): void {
  // Consumed only by build preset emitters in the `kovo build` process; the cap keeps a server
  // that constructs capabilities per request from growing this ledger without bound.
  if (rootedFilesBuildRoots.length >= MAX_RECORDED_ROOTED_FILES_ROOTS) return;
  for (let index = 0; index < rootedFilesBuildRoots.length; index += 1) {
    if (rootedFilesBuildRoots[index]!.spec === spec) return;
  }
  rootedFilesBuildRoots[rootedFilesBuildRoots.length] = witnessFreeze({ root, spec });
}

/**
 * @internal Build-time inventory of constructed `rootedFiles()` roots so preset emitters can
 * stage relative roots into the deploy artifact (SPEC §14; plans/good-perf.md O16).
 */
export function rootedFilesBuildInventory(): readonly {
  readonly root: string;
  readonly spec: string;
}[] {
  const snapshot: { readonly root: string; readonly spec: string }[] = [];
  for (let index = 0; index < rootedFilesBuildRoots.length; index += 1) {
    snapshot[index] = rootedFilesBuildRoots[index]!;
  }
  return witnessFreeze(snapshot);
}

/**
 * Create a path-traversal-safe file serving primitive for a single filesystem root.
 *
 * SPEC §6.6 / §9.1: raw file/path sinks must be routed through a safe framework surface. This
 * primitive treats traversal, symlink escape, directories, missing files, and open races as generic
 * not-found outcomes so callers do not branch on filesystem internals.
 *
 * SPEC §14: a **relative** root is resolved against the process working directory in dev and at
 * build time, and against the artifact's staged `rooted/` copies in the generated production
 * server — `kovo build` snapshots each relative root into the deploy artifact so the server never
 * depends on files outside its own output. Absolute roots always name live deploy-host paths.
 */
export async function rootedFiles(root: string): Promise<RootedFiles> {
  const fileSystem = await createFrameworkFileSystemBoundary(stagedRootedFilesRoot(root) ?? root);
  if (typeof root === 'string') recordRootedFilesBuildRoot(root, fileSystem.root);
  const capability: RootedFiles = {
    root: fileSystem.root,
    serve: (path, options) => serveRootedFile(fileSystem, path, options),
  };
  return blessSink<RootedFileServeSink, RootedFiles>(
    ROOTED_FILE_SERVE_SINK,
    witnessFreeze(capability),
  );
}

const ROOTED_FILE_SERVE_SINK: RootedFileServeSink = 'rooted-file-serve';

/** @internal Test/audit hook for the shared Blessed<Sink> witness substrate. */
export function isRootedFileServeCapability(value: unknown): value is RootedFiles {
  return isBlessedSink(ROOTED_FILE_SERVE_SINK, value);
}

async function serveRootedFile(
  fileSystem: FrameworkFileSystemBoundary,
  requestedPath: string,
  options: RootedFileServeOptions,
): Promise<RouteResponseOutcome | undefined> {
  if (!isFrameworkFileSystemBoundary(fileSystem)) return undefined;
  const closedOptions = snapshotRootedFileServeOptions(options);
  // SPEC §2 / §6.6 / §10.6: containment is authority, not merely lexical shape. Refuse hardlinked
  // aliases so an inode whose other name lives outside this capability cannot become downloadable.
  const file = await fileSystem.readFile(requestedPath, { requireSingleLink: true });
  if (file === undefined || !securityIsUint8Array(file.body)) return undefined;
  return respond.stream(file.body, {
    ...closedOptions,
    filename: closedOptions.filename ?? file.fileName,
  });
}

const ROOTED_FILE_SERVE_OPTION_KEYS = [
  'contentType',
  'disposition',
  'etag',
  'filename',
  'headers',
  'unsafeInline',
] as const satisfies readonly (keyof RootedFileServeOptions)[];

function snapshotRootedFileServeOptions(options: RootedFileServeOptions): RootedFileServeOptions {
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('Rooted file serve options must be an object.');
  }
  const snapshot = witnessCreateNullRecord<unknown>() as Record<
    keyof RootedFileServeOptions,
    unknown
  >;
  for (let index = 0; index < ROOTED_FILE_SERVE_OPTION_KEYS.length; index += 1) {
    const key = ROOTED_FILE_SERVE_OPTION_KEYS[index]!;
    snapshot[key] = stableRootedFileOption(options, key);
  }
  if (typeof snapshot.contentType !== 'string') {
    throw new TypeError('Rooted file serve contentType must be an own string data property.');
  }
  if (
    snapshot.disposition !== undefined &&
    snapshot.disposition !== 'attachment' &&
    snapshot.disposition !== 'inline'
  ) {
    throw new TypeError('Rooted file serve disposition must be attachment or inline.');
  }
  if (snapshot.etag !== undefined && typeof snapshot.etag !== 'string') {
    throw new TypeError('Rooted file serve etag must be a string.');
  }
  if (snapshot.filename !== undefined && typeof snapshot.filename !== 'string') {
    throw new TypeError('Rooted file serve filename must be a string.');
  }
  if (snapshot.headers !== undefined) {
    snapshot.headers = snapshotRootedFileHeaders(snapshot.headers);
  }
  return witnessFreeze(snapshot) as RootedFileServeOptions;
}

function snapshotRootedFileHeaders(source: unknown): Readonly<Record<string, string>> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('Rooted file serve headers must be an object.');
  }
  const names = witnessObjectKeys(source);
  if (names.length > 100_000) {
    throw new TypeError('Rooted file serve headers must be bounded.');
  }
  const snapshot = witnessCreateNullRecord<string>();
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const value = stableRootedFileOption(source, name);
    if (typeof value !== 'string') {
      throw new TypeError(`Rooted file serve header ${name} must be a string.`);
    }
    snapshot[name] = value;
  }
  return witnessFreeze(snapshot) as Readonly<Record<string, string>>;
}

function stableRootedFileOption(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`Rooted file serve option ${String(property)} must be stable.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(
      `Rooted file serve option ${String(property)} must be an own data property.`,
    );
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`Rooted file serve option ${String(property)} changed during validation.`);
  }
  return before.value;
}
