import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

function boundaryRelative(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Resolve a canonical slash-separated descendant while rejecting a symbolic link in every path
 * segment. A final realpath boundary check remains as defense in depth against ambiguous roots.
 */
export function nonSymlinkDescendant(root, relative, options = {}) {
  const label = options.label ?? 'path';
  const expected = options.kind ?? 'file';
  const absoluteRoot = path.resolve(root);
  if (!existsSync(absoluteRoot)) throw new Error(`${label} root is missing`);
  const rootStat = lstatSync(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`${label} root must be a regular non-symlink directory`);
  }
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    relative.includes('\\') ||
    path.posix.isAbsolute(relative) ||
    path.posix.normalize(relative) !== relative ||
    relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a canonical relative path`);
  }

  const segments = relative.split('/');
  let current = absoluteRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    if (!existsSync(current)) throw new Error(`${label} is missing: ${relative}`);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link path segment: ${relative}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} contains a non-directory path segment: ${relative}`);
    }
  }

  const finalStat = lstatSync(current);
  if (
    (expected === 'file' && !finalStat.isFile()) ||
    (expected === 'directory' && !finalStat.isDirectory())
  ) {
    throw new Error(`${label} must be a regular ${expected}: ${relative}`);
  }
  const realRoot = realpathSync(absoluteRoot);
  const realTarget = realpathSync(current);
  if (!boundaryRelative(realRoot, realTarget)) {
    throw new Error(`${label} resolves outside its root: ${relative}`);
  }
  return current;
}

/** Validate the root directory itself for the special `.` cwd contract. */
export function nonSymlinkRootDirectory(root, label = 'path') {
  const absoluteRoot = path.resolve(root);
  if (!existsSync(absoluteRoot)) throw new Error(`${label} root is missing`);
  const stat = lstatSync(absoluteRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} root must be a regular non-symlink directory`);
  }
  return absoluteRoot;
}

/** Create a canonical descendant directory one segment at a time without following symlinks. */
export function ensureNonSymlinkDescendantDirectory(root, relative, label = 'path') {
  const absoluteRoot = nonSymlinkRootDirectory(root, label);
  if (
    typeof relative !== 'string' ||
    relative.length === 0 ||
    relative.includes('\\') ||
    path.posix.isAbsolute(relative) ||
    path.posix.normalize(relative) !== relative ||
    relative.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a canonical relative path`);
  }
  let current = absoluteRoot;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      // A one-segment create is deliberate: recursive mkdir would follow a hostile parent link.
      mkdirSync(current);
      continue;
    }
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(
        `${label} contains a non-directory or symbolic-link path segment: ${relative}`,
      );
    }
  }
  return nonSymlinkDescendant(absoluteRoot, relative, { kind: 'directory', label });
}
