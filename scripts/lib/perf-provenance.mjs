import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function git(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `could not record benchmark git provenance (${args.join(' ')}): ${String(result.stderr).trim()}`,
    );
  }
  return String(result.stdout).trim();
}

function sha256File(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

/** Exact SHA-256 report identity used by the production server benchmark. */
export function sha256PerformanceBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Bind a performance report to the source tree and dependency resolutions it measured.
 *
 * A dirty tree is recorded rather than rejected because exploratory spikes intentionally run from
 * disposable worktrees. Publication policy can require `dirty: false`; a dirty report still says
 * exactly which paths differed instead of looking like evidence for `HEAD`.
 */
export function collectPerformanceProvenance({ lockFiles, repoRoot }) {
  const status = git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const dirtyPaths = status === '' ? [] : status.split(/\r?\n/u);
  const locks = {};
  for (const relativePath of lockFiles) {
    const absolutePath = path.join(repoRoot, relativePath);
    locks[relativePath] = existsSync(absolutePath) ? sha256File(absolutePath) : null;
  }
  return {
    commit: git(repoRoot, ['rev-parse', 'HEAD']),
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    locks,
  };
}
