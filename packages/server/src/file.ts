import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, isAbsolute, resolve, sep } from 'node:path';

import { blessSink, isBlessedSink } from '@kovojs/core/internal/sink-policy';

import { respond, type RouteResponseOutcome, type RouteStreamOptions } from './response.js';

type RootedFileServeSink = 'rooted-file-serve';

/** Options for serving a file from a rooted filesystem capability. */
export interface RootedFileServeOptions extends Omit<
  RouteStreamOptions,
  'disposition' | 'verifiedSafe'
> {
  disposition?: 'attachment' | 'inline';
  verifiedSafe?: boolean;
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
  const realRoot = await realpath(root);
  const capability: RootedFiles = {
    root: realRoot,
    serve: (path, options) => serveRootedFile(realRoot, path, options),
  };
  return blessSink<RootedFileServeSink, RootedFiles>(
    ROOTED_FILE_SERVE_SINK,
    Object.freeze(capability),
  );
}

const ROOTED_FILE_SERVE_SINK: RootedFileServeSink = 'rooted-file-serve';

/** @internal Test/audit hook for the shared Blessed<Sink> witness substrate. */
export function isRootedFileServeCapability(value: unknown): value is RootedFiles {
  return isBlessedSink(ROOTED_FILE_SERVE_SINK, value);
}

async function serveRootedFile(
  realRoot: string,
  requestedPath: string,
  options: RootedFileServeOptions,
): Promise<RouteResponseOutcome | undefined> {
  const candidate = rootedCandidate(realRoot, requestedPath);
  if (candidate === undefined) return undefined;

  const resolved = await safeRealpath(candidate);
  if (resolved === undefined || !containsPath(realRoot, resolved)) return undefined;

  const handle = await safeOpen(resolved);
  if (handle === undefined) return undefined;

  try {
    const [stat, postOpenResolved] = await Promise.all([handle.stat(), safeRealpath(resolved)]);
    if (
      !stat.isFile() ||
      postOpenResolved === undefined ||
      !containsPath(realRoot, postOpenResolved)
    ) {
      return undefined;
    }

    const body = await handle.readFile();
    return respond.stream(body, {
      ...options,
      filename: options.filename ?? basename(postOpenResolved),
    });
  } finally {
    await handle.close();
  }
}

function rootedCandidate(realRoot: string, requestedPath: string): string | undefined {
  if (requestedPath.includes('\0') || isAbsolute(requestedPath)) return undefined;
  const candidate = resolve(realRoot, requestedPath);
  return containsPath(realRoot, candidate) ? candidate : undefined;
}

function containsPath(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

async function safeRealpath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function safeOpen(path: string) {
  try {
    return await open(path, constants.O_RDONLY);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP')
  );
}
