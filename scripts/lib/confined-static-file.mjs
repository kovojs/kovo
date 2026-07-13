import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const READ_ONLY_NO_FOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/**
 * Resolve one URL pathname to an existing regular file beneath a canonical static root.
 *
 * SPEC §6.6: request bytes, lexical paths, and symlink-resolved paths are distinct trust
 * boundaries. A prefix string comparison is not containment (`dist-evil` starts with `dist`),
 * and `stat()` follows symlinks, so both the root and candidate must be canonicalized first.
 */
export async function openConfinedStaticFile(root, encodedPathname, prefix = '/') {
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

    return await openConfinedFilePath(canonicalRoot, lexicalCandidate);
  } catch {
    return undefined;
  }
}

/**
 * Open and authenticate one candidate before returning the descriptor used to serve it.
 *
 * SPEC §6.6: canonical-path containment is only meaningful for the filesystem object
 * that was checked. Returning a pathname and reopening it later would let a concurrent
 * symlink/rename replace the checked object. The descriptor, its stat, and its canonical
 * spelling therefore travel together as one authenticated serving capability.
 */
export async function openConfinedFilePath(root, candidate) {
  let fileHandle;
  try {
    const canonicalRoot = await realpath(root);
    const canonicalCandidate = await realpath(candidate);
    if (!isConfinedPath(canonicalRoot, canonicalCandidate)) return undefined;

    fileHandle = await open(canonicalCandidate, READ_ONLY_NO_FOLLOW);
    const [descriptorInfo, currentCanonicalCandidate, currentPathInfo] = await Promise.all([
      fileHandle.stat(),
      realpath(canonicalCandidate),
      stat(canonicalCandidate),
    ]);
    if (
      !descriptorInfo.isFile() ||
      !currentPathInfo.isFile() ||
      !isConfinedPath(canonicalRoot, currentCanonicalCandidate) ||
      descriptorInfo.dev !== currentPathInfo.dev ||
      descriptorInfo.ino !== currentPathInfo.ino
    ) {
      await fileHandle.close();
      return undefined;
    }

    return {
      fileHandle,
      filePath: canonicalCandidate,
      stat: descriptorInfo,
    };
  } catch {
    await fileHandle?.close().catch(() => {});
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
