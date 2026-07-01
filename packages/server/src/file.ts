import {
  createFrameworkFileSystemBoundary,
  isFrameworkFileSystemBoundary,
  type FrameworkFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';
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
  const fileSystem = await createFrameworkFileSystemBoundary(root);
  const capability: RootedFiles = {
    root: fileSystem.root,
    serve: (path, options) => serveRootedFile(fileSystem, path, options),
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
  fileSystem: FrameworkFileSystemBoundary,
  requestedPath: string,
  options: RootedFileServeOptions,
): Promise<RouteResponseOutcome | undefined> {
  if (!isFrameworkFileSystemBoundary(fileSystem)) return undefined;
  const file = await fileSystem.readFile(requestedPath);
  if (file === undefined || !(file.body instanceof Uint8Array)) return undefined;
  return respond.stream(file.body, {
    ...options,
    filename: options.filename ?? file.fileName,
  });
}
