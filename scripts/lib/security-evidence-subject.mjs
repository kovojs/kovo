import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SECURITY_EVIDENCE_SUBJECT_PROTOCOL = Object.freeze({
  schema: 'kovo.security-evidence-subject/v1',
  codeSubject:
    'codeSubjectSha names the clean committed code tree measured before this evidence artifact is written',
  evidenceCommit:
    'the later commit containing the evidence artifact is intentionally not embedded because its own SHA is self-referential',
});

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function validateCodeSubjectSha(value, label = 'codeSubjectSha') {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new TypeError(`${label} must be one full lowercase Git commit SHA`);
  }
  return value;
}

export function parseExactCliArguments(
  args,
  { command, optionalFlags = [], optionalValueFlags = [], valueFlags = [] },
) {
  if (!Array.isArray(args)) throw new TypeError('CLI arguments must be an array');
  const allowed = new Set([command, ...optionalFlags, ...optionalValueFlags, ...valueFlags]);
  const valued = new Set([...optionalValueFlags, ...valueFlags]);
  const counts = new Map();
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!allowed.has(token)) throw new Error(`unexpected argument ${JSON.stringify(token)}`);
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (counts.get(token) > 1) throw new Error(`duplicate argument ${token}`);
    if (valued.has(token)) {
      const value = args[index + 1];
      if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
        throw new Error(`argument ${token} requires one value`);
      }
      values[token.slice(2)] = value;
      index += 1;
    } else {
      values[token.slice(2)] = true;
    }
  }
  if (counts.get(command) !== 1) throw new Error(`argument ${command} is required exactly once`);
  for (const flag of valueFlags) {
    if (counts.get(flag) !== 1) throw new Error(`argument ${flag} is required exactly once`);
  }
  return Object.freeze(values);
}

/**
 * Writers use a two-commit protocol: first commit the measured code, then write and commit evidence.
 * Requiring a clean exact HEAD makes the subject binding mechanical and avoids pretending that an
 * evidence file can contain the SHA of the commit that contains itself.
 */
export function assertCleanCurrentCodeSubject({ repoRoot, subjectSha }) {
  const expected = validateCodeSubjectSha(subjectSha);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']).trim();
  if (head !== expected) {
    throw new Error(`codeSubjectSha must equal clean HEAD before evidence is written (${head})`);
  }
  const status = runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim() !== '') {
    throw new Error(
      `code subject worktree must be clean before evidence is written:\n${status.trimEnd()}`,
    );
  }
}

/** Prove that a claimed evidence subject names a retained commit in this repository. */
export function assertRetainedCodeSubject({ repoRoot, subjectSha }) {
  const expected = validateCodeSubjectSha(subjectSha);
  runGit(repoRoot, ['cat-file', '-e', `${expected}^{commit}`]);
  runGit(repoRoot, ['merge-base', '--is-ancestor', expected, 'HEAD']);
  return expected;
}

/** Prove that one retained evidence subject is chronologically downstream of another. */
export function assertCodeSubjectDescendsFrom({ ancestorSha, descendantSha, repoRoot }) {
  const ancestor = validateCodeSubjectSha(ancestorSha, 'ancestor code subject');
  const descendant = validateCodeSubjectSha(descendantSha, 'descendant code subject');
  runGit(repoRoot, ['cat-file', '-e', `${ancestor}^{commit}`]);
  runGit(repoRoot, ['cat-file', '-e', `${descendant}^{commit}`]);
  runGit(repoRoot, ['merge-base', '--is-ancestor', ancestor, descendant]);
  return descendant;
}

/** Read one exact path from a retained code-subject commit, never from the current worktree. */
export function readFileAtCodeSubject({ relativePath, repoRoot, subjectSha }) {
  const expected = assertRetainedCodeSubject({ repoRoot, subjectSha });
  const [safePath] = normalizedPaths([relativePath]);
  const output = runGitBuffer(repoRoot, ['ls-tree', '-z', '--full-tree', expected, '--', safePath]);
  const records = splitNullRecords(output);
  if (records.length !== 1) {
    throw new TypeError(`retained security evidence path is not one regular file: ${safePath}`);
  }
  const record = records[0];
  const separator = record.indexOf(0x09);
  const metadata = separator > 0 ? record.subarray(0, separator).toString('ascii').split(' ') : [];
  const pathBytes = separator > 0 ? record.subarray(separator + 1) : Buffer.alloc(0);
  if (
    metadata.length !== 3 ||
    (metadata[0] !== '100644' && metadata[0] !== '100755') ||
    metadata[1] !== 'blob' ||
    !/^[0-9a-f]{40,64}$/u.test(metadata[2] ?? '') ||
    !Buffer.from(safePath, 'utf8').equals(pathBytes)
  ) {
    throw new TypeError(`retained security evidence path is not one regular file: ${safePath}`);
  }
  return runGitBuffer(repoRoot, ['cat-file', 'blob', metadata[2]]);
}

/**
 * A historical first round may predate the series ledger. This writer-side compatibility check
 * requires every named measurement input to remain byte-identical; artifact gates must still bind
 * each round to retained commit bytes again at check time.
 */
export function assertHistoricalCodeSubjectMatches({ paths, repoRoot, subjectSha }) {
  const expected = assertRetainedCodeSubject({ repoRoot, subjectSha });
  const normalized = normalizedPaths(paths);
  const retainedFiles = readGitFilesAtCodeSubject(repoRoot, expected, normalized);
  for (const relativePath of normalized) {
    const current = readFileSync(path.join(repoRoot, relativePath));
    const retained = retainedFiles.get(relativePath);
    if (!current.equals(retained)) {
      throw new Error(
        `${relativePath} differs from historical code subject ${expected}; start a new series or use the current clean HEAD`,
      );
    }
  }
}

/**
 * A compact SHA-256 descriptor over complete source-tree membership, file modes, paths, and bytes.
 * Directory membership is part of the subject so adding or deleting a producer file cannot hide
 * behind a hand-maintained file list.
 */
export function buildSourceTreeSet({ repoRoot, roots }) {
  const normalized = normalizedRoots(roots);
  const status = runGitBuffer(repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    ...normalized,
  ]);
  if (status.length > 0) {
    throw new Error('security evidence source trees must be clean and fully tracked');
  }
  const subjectSha = validateCodeSubjectSha(runGit(repoRoot, ['rev-parse', 'HEAD']).trim());
  const descriptors = sourceTreeDescriptorsAtCodeSubject({
    repoRoot,
    roots: normalized,
    subjectSha,
  });
  return freezeSourceTreeSet(descriptors);
}

/** Build the same complete source-tree descriptor from one retained code-subject commit. */
export function buildSourceTreeSetAtCodeSubject({ repoRoot, roots, subjectSha }) {
  const expected = assertRetainedCodeSubject({ repoRoot, subjectSha });
  const descriptors = sourceTreeDescriptorsAtCodeSubject({
    repoRoot,
    roots: normalizedRoots(roots),
    subjectSha: expected,
  });
  return freezeSourceTreeSet(descriptors);
}

/** Require complete current producer trees to match a retained historical code subject. */
export function assertHistoricalSourceTreesMatch({ repoRoot, roots, subjectSha }) {
  const current = buildSourceTreeSet({ repoRoot, roots });
  const retained = buildSourceTreeSetAtCodeSubject({ repoRoot, roots, subjectSha });
  if (canonicalJson(current) !== canonicalJson(retained)) {
    throw new Error(
      `measurement producer source trees differ from historical code subject ${subjectSha}; start a new series or use the current clean HEAD`,
    );
  }
}

export function buildSourceSet({ paths, repoRoot }) {
  const files = normalizedPaths(paths).map((relativePath) => ({
    path: relativePath,
    sha256: sha256(readFileSync(path.join(repoRoot, relativePath))),
  }));
  return Object.freeze({
    files: Object.freeze(files),
    sha256: sha256(canonicalJson(files)),
  });
}

/** Build the exact source-set digest retained by a named commit. */
export function buildSourceSetAtCodeSubject({ paths, repoRoot, subjectSha }) {
  const expected = assertRetainedCodeSubject({ repoRoot, subjectSha });
  const normalized = normalizedPaths(paths);
  const retainedFiles = readGitFilesAtCodeSubject(repoRoot, expected, normalized);
  const files = normalized.map((relativePath) => ({
    path: relativePath,
    sha256: sha256(retainedFiles.get(relativePath)),
  }));
  return Object.freeze({
    files: Object.freeze(files),
    sha256: sha256(canonicalJson(files)),
  });
}

function normalizedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError('security evidence source set must name at least one path');
  }
  const normalized = [...new Set(paths)].sort(compareSecurityEvidencePaths);
  if (
    normalized.length !== paths.length ||
    normalized.some(
      (entry) =>
        typeof entry !== 'string' || entry.length === 0 || !safeSecurityEvidencePath(entry),
    )
  ) {
    throw new TypeError('security evidence source paths must be unique safe relative paths');
  }
  return normalized;
}

function safeSecurityEvidencePath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value ||
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    value.includes(':') ||
    value.includes('\\')
  ) {
    return false;
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2060 && code <= 0x206f) ||
      code === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}

function normalizedRoots(roots) {
  const normalized = normalizedPaths(roots);
  if (
    normalized.some((root, index) =>
      normalized.some(
        (candidate, candidateIndex) => index !== candidateIndex && root.startsWith(`${candidate}/`),
      ),
    )
  ) {
    throw new TypeError('security evidence source roots must not overlap');
  }
  return normalized;
}

function sourceTreeDescriptorsAtCodeSubject({ repoRoot, roots, subjectSha }) {
  const output = runGitBuffer(repoRoot, [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    subjectSha,
    '--',
    ...roots,
  ]);
  const rowsByRoot = new Map(roots.map((root) => [root, []]));
  for (const record of splitNullRecords(output)) {
    const separator = record.indexOf(0x09);
    if (separator <= 0) {
      throw new TypeError('retained security evidence source tree has a malformed row');
    }
    const metadata = record.subarray(0, separator).toString('ascii').split(' ');
    const pathBytes = record.subarray(separator + 1);
    const relativePath = pathBytes.toString('utf8');
    const root = roots.find((candidate) => relativePath.startsWith(`${candidate}/`));
    if (
      root === undefined ||
      metadata.length !== 3 ||
      (metadata[0] !== '100644' && metadata[0] !== '100755') ||
      metadata[1] !== 'blob' ||
      !/^[0-9a-f]{40,64}$/u.test(metadata[2] ?? '') ||
      !Buffer.from(relativePath, 'utf8').equals(pathBytes)
    ) {
      throw new TypeError(`retained security evidence source tree has an unsafe row: ${root}`);
    }
    rowsByRoot.get(root).push({
      mode: metadata[0],
      objectId: metadata[2],
      path: relativePath,
    });
  }
  const rows = [...rowsByRoot.values()].flat();
  const blobs = readGitBlobs(
    repoRoot,
    rows.map((row) => row.objectId),
  );
  return roots.map((root) => {
    const entries = rowsByRoot.get(root).map((row) => ({
      mode: row.mode,
      path: row.path,
      sha256: sha256(blobs.get(row.objectId)),
    }));
    entries.sort((left, right) => compareSecurityEvidencePaths(left.path, right.path));
    return sourceTreeDescriptorFromEntries(root, entries);
  });
}

function sourceTreeDescriptorFromEntries(root, entries) {
  if (entries.length === 0) {
    throw new TypeError(`security evidence source tree must contain at least one file: ${root}`);
  }
  return Object.freeze({
    fileCount: entries.length,
    root,
    sha256: sha256(canonicalJson(entries)),
  });
}

function freezeSourceTreeSet(descriptors) {
  const frozen = Object.freeze(descriptors.map((descriptor) => Object.freeze(descriptor)));
  return Object.freeze({
    roots: frozen,
    sha256: sha256(canonicalJson(frozen)),
  });
}

function splitNullRecords(value) {
  const records = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) continue;
    if (index > start) records.push(value.subarray(start, index));
    start = index + 1;
  }
  if (start !== value.length) {
    throw new TypeError('retained security evidence source tree is not NUL terminated');
  }
  return records;
}

function readGitBlobs(repoRoot, objectIds) {
  const uniqueIds = [...new Set(objectIds)];
  const result = spawnSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot,
    encoding: null,
    input: Buffer.from(`${uniqueIds.join('\n')}\n`, 'ascii'),
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error('git cat-file --batch failed while reading a security evidence source tree');
  }
  const output = result.stdout ?? Buffer.alloc(0);
  const blobs = new Map();
  let offset = 0;
  for (const expectedId of uniqueIds) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) {
      throw new TypeError('git cat-file --batch returned a truncated blob header');
    }
    const [objectId, type, sizeText] = output
      .subarray(offset, headerEnd)
      .toString('ascii')
      .split(' ');
    const size = Number(sizeText);
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + size;
    if (
      objectId !== expectedId ||
      type !== 'blob' ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      bodyEnd >= output.length ||
      output[bodyEnd] !== 0x0a
    ) {
      throw new TypeError('git cat-file --batch returned an invalid blob record');
    }
    blobs.set(objectId, output.subarray(bodyStart, bodyEnd));
    offset = bodyEnd + 1;
  }
  if (offset !== output.length) {
    throw new TypeError('git cat-file --batch returned surplus blob records');
  }
  return blobs;
}

function readGitFilesAtCodeSubject(repoRoot, subjectSha, paths) {
  const output = runGitBuffer(repoRoot, [
    'ls-tree',
    '-z',
    '--full-tree',
    subjectSha,
    '--',
    ...paths,
  ]);
  const objectIdsByPath = new Map();
  for (const record of splitNullRecords(output)) {
    const separator = record.indexOf(0x09);
    if (separator <= 0) {
      throw new TypeError('retained security evidence source set has a malformed row');
    }
    const metadata = record.subarray(0, separator).toString('ascii').split(' ');
    const pathBytes = record.subarray(separator + 1);
    const relativePath = pathBytes.toString('utf8');
    if (
      metadata.length !== 3 ||
      (metadata[0] !== '100644' && metadata[0] !== '100755') ||
      metadata[1] !== 'blob' ||
      !/^[0-9a-f]{40,64}$/u.test(metadata[2] ?? '') ||
      !paths.includes(relativePath) ||
      objectIdsByPath.has(relativePath) ||
      !Buffer.from(relativePath, 'utf8').equals(pathBytes)
    ) {
      throw new TypeError('retained security evidence source set has an unsafe row');
    }
    objectIdsByPath.set(relativePath, metadata[2]);
  }
  if (objectIdsByPath.size !== paths.length) {
    throw new TypeError('retained security evidence source set is missing an exact file');
  }
  const blobs = readGitBlobs(repoRoot, [...objectIdsByPath.values()]);
  return new Map(
    paths.map((relativePath) => [relativePath, blobs.get(objectIdsByPath.get(relativePath))]),
  );
}

function compareSecurityEvidencePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runGit(repoRoot, args) {
  return runGitBuffer(repoRoot, args).toString('utf8');
}

function runGitBuffer(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = Buffer.concat([
      result.stdout ?? Buffer.alloc(0),
      result.stderr ?? Buffer.alloc(0),
    ])
      .toString('utf8')
      .trim();
    throw new Error(
      `git ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ''}${detail ? `\n${detail}` : ''}`,
    );
  }
  return result.stdout ?? Buffer.alloc(0);
}
