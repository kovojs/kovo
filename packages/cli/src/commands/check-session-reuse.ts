/**
 * Authenticated in-session reuse for `kovo check source --watch` (plans/good-perf.md O11).
 *
 * A watch session may republish its previous accepted revision only when it can re-prove, from
 * exact per-file content digests taken by the same bounded scanner that schedules revisions,
 * that no input any diagnostic-producing phase consumed has changed — and the sole phase whose
 * conservative input key spans the whole project (`typescript`, because a tsconfig `extends`
 * chain may name any file) is re-executed, never assumed. Everything else refuses reuse and
 * falls back to the complete fresh pipeline: SPEC §11.4 checking stays fail-closed, and there
 * is deliberately no disk cache (plans/compiler-refactoring.md FN3 / commit cab4b4b84 record
 * why an on-disk store cannot authenticate entries against same-UID authored config).
 *
 * The eligibility rules are byte-evidence over the session's own scans, not heuristics:
 *
 * - files added, removed, or renamed refuse reuse (module and config resolution can change
 *   without any retained byte changing);
 * - a changed file inside the previously admitted app/config closure refuses reuse;
 * - a changed file is otherwise reusable only when its name proves it outside every module,
 *   config, stylesheet, and asset surface the check pipeline can consume (documentation-shaped
 *   allowlist below), and no closure source even mentions its name (so `?raw`-style asset
 *   imports of an allowlisted file refuse), and no closure source uses `import.meta.glob`
 *   (whose patterns can match files without naming them);
 * - strict-lifecycle projects (`lifecycle-policy`/`project-quality`/`sound-subset` executed)
 *   always refuse: those analyzers are whole-project by contract.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import { findNearestFile } from '../tooling.js';
import {
  KOVO_SOURCE_CHECK_PHASES,
  type KovoSourceCheckSessionContinuity,
  type KovoSourceCheckWatchSnapshot,
} from './source-check-session.js';

const execFileAsync = promisify(execFile);
const typescriptPhaseIndex = 2;
const wholeProjectPhaseIndexes = [0, 3, 4] as const; // lifecycle-policy, project-quality, sound-subset

/**
 * Basenames and extensions that no source-check phase can consume. The list is deliberately
 * documentation-shaped and closed: anything a compiler, TypeScript, Vite, stylesheet, config,
 * or manifest surface could ever read (source modules, JSON, HTML, CSS, env files, lockfiles,
 * configs) is absent, so it refuses reuse by construction.
 */
const reusableChangedExtensions: ReadonlySet<string> = new Set([
  '.adoc',
  '.asciidoc',
  '.log',
  '.markdown',
  '.md',
  '.mdown',
  '.rst',
  '.text',
  '.txt',
]);
const reusableChangedBasenames: ReadonlySet<string> = new Set([
  '.DS_Store',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.gitkeep',
  'AUTHORS',
  'CODEOWNERS',
  'LICENCE',
  'LICENSE',
  'NOTICE',
]);

/** @internal Exact eligibility outcome; refusals carry the reason for tests and diagnostics. */
export type KovoSourceCheckSessionReusePlan =
  | { readonly changedPaths: readonly string[]; readonly eligible: true }
  | { readonly eligible: false; readonly reason: string };

/**
 * Decide, from byte evidence alone, whether the candidate trigger may republish the previous
 * accepted revision after a fresh `typescript` re-execution. Every uncertain branch refuses.
 */
export function planKovoSourceCheckSessionReuse(
  previous: KovoSourceCheckSessionContinuity | undefined,
  candidate: KovoSourceCheckWatchSnapshot,
): KovoSourceCheckSessionReusePlan {
  if (previous === undefined) return refuse('no accepted previous revision');
  const previousDigests = previous.trigger.fileDigests;
  const candidateDigests = candidate.fileDigests;
  if (previousDigests === undefined || candidateDigests === undefined) {
    return refuse('per-file digest evidence is unavailable');
  }
  if (previous.trigger.symlinks.length > 0 || candidate.symlinks.length > 0) {
    return refuse('project symlinks make the input closure ambiguous');
  }
  if (previous.input.status !== 'accepted') return refuse('previous input proof was rejected');
  if (previous.result.exitCode !== 0 && previous.result.exitCode !== 1) {
    return refuse('previous revision did not complete its proof');
  }
  if (previous.census.phases.length !== KOVO_SOURCE_CHECK_PHASES.length) {
    return refuse('previous phase census is incomplete');
  }
  for (const index of wholeProjectPhaseIndexes) {
    if (previous.census.phases[index]!.status !== 'not-applicable') {
      return refuse('strict lifecycle projects re-prove whole-project analyzers every revision');
    }
  }
  for (const phase of previous.census.phases) {
    if (phase.status === 'not-reached') return refuse('previous revision did not reach every phase');
  }
  if (candidateDigests.size !== previousDigests.size) return refuse('files were added or removed');
  const changedPaths: string[] = [];
  for (const [path, digest] of candidateDigests) {
    const previousDigest = previousDigests.get(path);
    if (previousDigest === undefined) return refuse('files were added or removed');
    if (previousDigest !== digest) changedPaths.push(path);
  }
  if (changedPaths.length === 0) return refuse('no content change was observed');
  const closurePaths = new Set<string>();
  for (const row of previous.input.closure) closurePaths.add(row.path);
  for (const path of changedPaths) {
    if (closurePaths.has(path)) return refuse(`closure input changed: ${path}`);
    if (!isReusableChangedPath(path)) return refuse(`changed file may be a check input: ${path}`);
  }
  for (const file of previous.closureSources) {
    if (file.source.includes('import.meta.glob')) {
      return refuse('closure uses import.meta.glob, whose patterns can match unnamed files');
    }
    for (const path of changedPaths) {
      const basename = path.slice(path.lastIndexOf('/') + 1);
      if (file.source.includes(basename) || file.source.includes(path)) {
        return refuse(`closure source references changed file: ${path}`);
      }
    }
  }
  return Object.freeze({ changedPaths: Object.freeze(changedPaths), eligible: true });
}

/**
 * Re-execute the exact `typescript` preflight the one-shot producer runs (same tsc resolution,
 * flags, and SPEC §10.6-confined `.kovo/cache` build-info handling as
 * `build-export.ts` `runTypeScriptBuildPreflight`). `undefined` refuses reuse: the complete
 * fresh pipeline then owns error reporting, so a type error is never reported from this path.
 */
export async function revalidateKovoCheckTypeScriptPreflight(
  entryAbsolute: string,
  invocationRoot: string,
  invocationEnv: NodeJS.ProcessEnv,
): Promise<{ readonly durationMs: number; readonly executed: boolean } | undefined> {
  const relativeAppPath = relative(invocationRoot, entryAbsolute);
  if (relativeAppPath.split(/[\\/]/u).some((part) => part.startsWith('.'))) {
    return { durationMs: 0, executed: false };
  }
  const tsconfigPath = findNearestFile(dirname(entryAbsolute), 'tsconfig.json', {
    stopDir: invocationRoot,
  });
  if (tsconfigPath === undefined) return { durationMs: 0, executed: false };
  const startedAt = performance.now();
  const projectDir = dirname(tsconfigPath);
  let tscBin: string;
  try {
    tscBin = createRequire(`${projectDir}/package.json`).resolve('typescript/bin/tsc');
  } catch {
    return undefined;
  }
  const projectOutput = createFrameworkOutputFileSystemBoundary(projectDir);
  const projectBuildInfoFile = '.kovo/cache/tsc-preflight.tsbuildinfo';
  const tempDir = mkdtempSync(join(tmpdir(), 'kovo-tsc-preflight-'));
  const buildInfoFile = join(tempDir, 'tsc-preflight.tsbuildinfo');
  try {
    const previousBuildInfo = await projectOutput.fileBytes(projectBuildInfoFile);
    if (previousBuildInfo !== undefined) writeFileSync(buildInfoFile, previousBuildInfo);
    await execFileAsync(
      process.execPath,
      [
        tscBin,
        '--noEmit',
        '--allowImportingTsExtensions',
        '--incremental',
        '--tsBuildInfoFile',
        buildInfoFile,
        '--project',
        tsconfigPath,
      ],
      { cwd: projectDir, encoding: 'utf8', env: invocationEnv },
    );
    await projectOutput.writeFile(projectBuildInfoFile, readFileSync(buildInfoFile));
    return { durationMs: performance.now() - startedAt, executed: true };
  } catch {
    return undefined;
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function isReusableChangedPath(path: string): boolean {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  if (reusableChangedBasenames.has(basename)) return true;
  const dot = basename.lastIndexOf('.');
  if (dot <= 0) return false;
  return reusableChangedExtensions.has(basename.slice(dot).toLowerCase());
}

function refuse(reason: string): KovoSourceCheckSessionReusePlan {
  return Object.freeze({ eligible: false, reason });
}
