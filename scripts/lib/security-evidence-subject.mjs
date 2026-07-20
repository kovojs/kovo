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

export function parseExactCliArguments(args, { command, optionalFlags = [], valueFlags = [] }) {
  if (!Array.isArray(args)) throw new TypeError('CLI arguments must be an array');
  const allowed = new Set([command, ...optionalFlags, ...valueFlags]);
  const counts = new Map();
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!allowed.has(token)) throw new Error(`unexpected argument ${JSON.stringify(token)}`);
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (counts.get(token) > 1) throw new Error(`duplicate argument ${token}`);
    if (valueFlags.includes(token)) {
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

/**
 * A historical first round may predate the series ledger. It is admissible only when every named
 * measurement input is byte-identical to the retained commit. Future rounds should use the clean
 * current-HEAD writer path instead.
 */
export function assertHistoricalCodeSubjectMatches({ paths, repoRoot, subjectSha }) {
  const expected = validateCodeSubjectSha(subjectSha);
  runGit(repoRoot, ['cat-file', '-e', `${expected}^{commit}`]);
  for (const relativePath of normalizedPaths(paths)) {
    const current = readFileSync(path.join(repoRoot, relativePath));
    const retained = runGitBuffer(repoRoot, ['show', `${expected}:${relativePath}`]);
    if (!current.equals(retained)) {
      throw new Error(
        `${relativePath} differs from historical code subject ${expected}; start a new series or use the current clean HEAD`,
      );
    }
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

function normalizedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError('security evidence source set must name at least one path');
  }
  const normalized = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
  if (
    normalized.length !== paths.length ||
    normalized.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.length === 0 ||
        path.isAbsolute(entry) ||
        entry.split('/').includes('..'),
    )
  ) {
    throw new TypeError('security evidence source paths must be unique safe relative paths');
  }
  return normalized;
}

function runGit(repoRoot, args) {
  return runGitBuffer(repoRoot, args).toString('utf8');
}

function runGitBuffer(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: null });
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
