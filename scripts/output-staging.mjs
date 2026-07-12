import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class ScriptArtifactCheckError extends Error {
  constructor(message, changed, stale) {
    super(message);
    this.name = 'ScriptArtifactCheckError';
    this.changed = changed;
    this.stale = stale;
  }
}

export async function writeScriptArtifacts(root, entries, options = {}) {
  const mode = options.mode ?? 'write';
  const resolvedRoot = path.resolve(root);
  const manifest = entries.map((entry) => scriptArtifactManifestEntry(resolvedRoot, entry));
  const changed = mode === 'dry-run' ? [] : await changedScriptArtifacts(manifest);
  const stale = options.cleanup
    ? await staleScriptArtifacts(resolvedRoot, manifest, options.cleanup)
    : [];

  if (mode === 'dry-run') return { changed, manifest, mode, stale };
  if (mode === 'check') {
    if (changed.length > 0 || stale.length > 0) {
      throw new ScriptArtifactCheckError(
        `script artifact drift: ${changed.length} changed, ${stale.length} stale`,
        changed,
        stale,
      );
    }
    return { changed, manifest, mode, stale };
  }

  await assertScriptArtifactRoot(resolvedRoot);
  const stagingRoot = await mkdtemp(path.join(path.dirname(resolvedRoot), '.kovo-script-output-'));
  try {
    await Promise.all(
      manifest.map(async (entry) => {
        const stagedPath = path.join(stagingRoot, entry.relativePath);
        await mkdir(path.dirname(stagedPath), { recursive: true });
        await writeFile(stagedPath, entry.content, 'utf8');
      }),
    );
    for (const entry of manifest) {
      await assertScriptArtifactParents(resolvedRoot, entry.targetPath);
    }
    for (const entry of manifest) {
      await mkdir(path.dirname(entry.targetPath), { recursive: true });
      await rename(path.join(stagingRoot, entry.relativePath), entry.targetPath);
    }
    for (const stalePath of stale) {
      await rm(stalePath, { force: true });
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
  return { changed, manifest, mode, stale };
}

function scriptArtifactManifestEntry(root, entry) {
  const targetPath = path.resolve(root, entry.path);
  const relativePath = path.relative(root, targetPath);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    relativePath.split(path.sep).includes('..')
  ) {
    throw new Error(`script artifact '${entry.path}' escapes output root '${root}'`);
  }
  return {
    content: entry.content,
    hash: sha256(entry.content),
    path: entry.path,
    relativePath,
    targetPath,
  };
}

async function changedScriptArtifacts(manifest) {
  const changed = [];
  for (const entry of manifest) {
    try {
      if (sha256(await readFile(entry.targetPath)) !== entry.hash) changed.push(entry);
    } catch {
      changed.push(entry);
    }
  }
  return changed;
}

async function staleScriptArtifacts(root, manifest, cleanup) {
  const owned = new Set(manifest.map((entry) => entry.targetPath));
  const candidates = await cleanup.enumerate(root);
  if (!Array.isArray(candidates)) {
    throw new TypeError('script artifact cleanup candidates must be an array');
  }
  const stale = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (typeof candidate !== 'string') {
      throw new TypeError(`script artifact cleanup candidate ${index} must be a string`);
    }
    const resolved = path.resolve(candidate);
    const relativePath = path.relative(root, resolved);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
    if (!owned.has(resolved)) stale.push(resolved);
  }
  return stale;
}

async function assertScriptArtifactRoot(root) {
  let stats;
  try {
    stats = await lstat(root);
  } catch {
    await mkdir(root, { recursive: true });
    return;
  }
  if (stats.isDirectory() && !stats.isSymbolicLink()) return;
  throw new Error(`script artifact root '${root}' is not a directory`);
}

async function assertScriptArtifactParents(root, targetPath) {
  const relativeDirectory = path.relative(root, path.dirname(targetPath));
  const segments = relativeDirectory === '' ? [] : relativeDirectory.split(path.sep);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch {
      continue;
    }
    if (stats.isSymbolicLink())
      throw new Error(`script artifact parent '${current}' is a symbolic link`);
    if (!stats.isDirectory())
      throw new Error(`script artifact parent '${current}' is not a directory`);
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}
