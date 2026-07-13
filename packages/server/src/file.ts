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

/**
 * Create a path-traversal-safe file serving primitive for a single filesystem root.
 *
 * SPEC §6.6 / §9.1: raw file/path sinks must be routed through a safe framework surface. This
 * primitive treats traversal, symlink escape, directories, missing files, and open races as generic
 * not-found outcomes so callers do not branch on filesystem internals.
 */
export async function rootedFiles(root: string): Promise<RootedFiles> {
  const fileSystem = await createFrameworkFileSystemBoundary(root);
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
  const file = await fileSystem.readFile(requestedPath);
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
