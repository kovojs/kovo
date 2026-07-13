import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve one URL pathname to an existing regular file beneath a canonical static root.
 *
 * SPEC §6.6: request bytes, lexical paths, and symlink-resolved paths are distinct trust
 * boundaries. A prefix string comparison is not containment (`dist-evil` starts with `dist`),
 * and `stat()` follows symlinks, so both the root and candidate must be canonicalized first.
 */
export async function resolveConfinedStaticFile(root, encodedPathname, prefix = '/') {
  let pathname;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    return undefined;
  }
  if (!pathname.startsWith(prefix)) return undefined;

  try {
    const canonicalRoot = await realpath(root);
    const lexicalCandidate = path.resolve(canonicalRoot, `.${pathname}`);
    if (!isConfinedPath(canonicalRoot, lexicalCandidate)) return undefined;

    const canonicalCandidate = await realpath(lexicalCandidate);
    if (!isConfinedPath(canonicalRoot, canonicalCandidate)) return undefined;
    const info = await stat(canonicalCandidate);
    return info.isFile() ? canonicalCandidate : undefined;
  } catch {
    return undefined;
  }
}

function isConfinedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
