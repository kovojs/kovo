import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  createFrameworkFileSystemBoundary,
  type CapturedFileReplacement,
  type FrameworkFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';
import { analyzeStyleApiV1Migration } from '@kovojs/compiler/internal';

import type { CliCommandResult } from '../shared.js';
import {
  analyzeBetterAuthApiV1Migration,
  analyzeBrowserAuthoringV1Migration,
  analyzeBrowserClientInstallerV1Migration,
  analyzeBrowserInlineOptimismV1Migration,
  analyzeCoreApiV1Migration,
  analyzeDrizzleApiV1Migration,
  analyzeServerApiV1Migration,
  analyzeTestHarnessV2Migration,
  analyzeUiHeadlessIconsV1Migration,
  type ApiV1MigrationAnalysis,
  type ApiV1MigrationAnalyzer,
  type ApiV1MigrationRefusal,
} from './api-v1-migration-analyzers.mjs';

export const API_V1_MIGRATION_RESULT_SCHEMA = 'kovo-api-migration-result/v1' as const;
const API_V1_BATCH = 'api-v1';
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

interface ApiV1Batch {
  readonly analyze: ApiV1MigrationAnalyzer;
  readonly guide: string;
  readonly id: string;
  readonly manualAction: string;
}

const API_V1_BATCHES = [
  {
    analyze: analyzeCoreApiV1Migration,
    guide: 'move-core-imports',
    id: 'core-task-topology-v1',
    manualAction:
      'Delete the retired implementation carrier and let the app contract infer it, or define an app-local type for the cited use.',
  },
  {
    analyze: analyzeStyleApiV1Migration,
    guide: 'migrate-styles-and-themes',
    id: 'style-opaque-handles',
    manualAction:
      'Choose StyleHandle for one compiled style value or an app-local aggregate for composed styles; choose defineTheme only when the source is a reviewed seed theme.',
  },
  {
    analyze: analyzeUiHeadlessIconsV1Migration,
    guide: 'update-components-headless-primitives-and-icons',
    id: 'ui-headless-icons-v1',
    manualAction:
      'Import the concrete component subpath or replace the retired state projection with the public attribute builder for that primitive anatomy.',
  },
  {
    analyze: analyzeBrowserClientInstallerV1Migration,
    guide: 'replace-custom-client-assembly',
    id: 'browser-client-installer-v1',
    manualAction:
      'Replace manual client assembly with installKovoClient and pass only the documented root, import, fetch-observer, lifecycle, error, and upload hooks.',
  },
  {
    analyze: analyzeBrowserAuthoringV1Migration,
    guide: 'make-browser-trust-and-derive-inputs-explicit',
    id: 'browser-authoring-v1',
    manualAction:
      'Select the exact query, state, or clock handle for derive, or write structured non-empty review metadata for the cited trusted output.',
  },
  {
    analyze: analyzeBrowserInlineOptimismV1Migration,
    guide: 'bind-optimism-to-query-handles',
    id: 'browser-inline-optimism-v1',
    manualAction:
      'Delete the retired plan/support annotation, extract each pure predictor, and bind it through the exact query handle inside app.mutation({ optimistic: [...] }); only compiler-emitted modules may import OptimisticFor from @kovojs/browser/generated.',
  },
  {
    analyze: analyzeServerApiV1Migration,
    guide: 'move-server-imports-by-task',
    id: 'server-task-topology-v1',
    manualAction:
      'Remove the retired framework carrier and use the task subpath named by the guide; if the value encoded authority, define the app-owned boundary explicitly.',
  },
  {
    analyze: analyzeTestHarnessV2Migration,
    guide: 'bind-tests-to-the-built-app',
    id: 'test-harness-v2',
    manualAction:
      'Construct the app-scoped harness with the imported app, successful build artifact, absolute project root, and an explicit HTTP origin when page behavior is required.',
  },
  {
    analyze: analyzeDrizzleApiV1Migration,
    guide: 'migrate-drizzle-annotations',
    id: 'drizzle-typed-annotations-v1',
    manualAction:
      'Use exact Drizzle column objects in the kovo annotation callback and remove app-authored runtime metadata carriers.',
  },
  {
    analyze: analyzeBetterAuthApiV1Migration,
    guide: 'move-generated-auth-bindings',
    id: 'better-auth-generated-assembly-v1',
    manualAction:
      'Import generated bindings from the exact Postgres or SQLite generated subpath; replace retired credential wire carriers with an app-local result contract.',
  },
] as const satisfies readonly ApiV1Batch[];

/** @internal Exact checked-ledger order exercised by the cumulative command. */
export const API_V1_MIGRATION_BATCH_IDS = Object.freeze(API_V1_BATCHES.map((batch) => batch.id));

/** @internal Closed migration options shared by argv parsing and tests. */
export interface ApiV1MigrationOptions {
  readonly mode: 'check' | 'write';
  readonly sourcePaths: readonly string[];
}

interface MigrationFile {
  readonly capturePath: string;
  readonly outputPath: string;
}

interface MigrationResultFile {
  readonly batches?: readonly string[];
  readonly path: string;
  readonly refusals?: readonly MigrationResultRefusal[];
  readonly state: 'refused' | 'rewritten' | 'unchanged';
}

interface MigrationResultRefusal {
  readonly anchor: { readonly end: number; readonly start: number };
  readonly batch: string;
  readonly category: string;
  readonly manualAction: string;
  readonly reason: string;
}

interface PreparedMigrationFile {
  readonly file: MigrationFile;
  readonly result: MigrationResultFile;
  readonly snapshot: CapturedFileReplacement;
  readonly source: string;
  readonly rewrittenSource: string;
}

interface AnalyzedMigrationFile {
  readonly result: MigrationResultFile;
  readonly source: string;
}

/**
 * Execute every removed API-v1 ledger batch as one fail-closed application transaction.
 *
 * The command first captures and analyzes the complete source set. A refusal anywhere prevents
 * every write. A concurrent file change during commit rolls back already-written files when their
 * just-written bytes still match, so Kovo never knowingly leaves a half-migrated application.
 *
 * @internal CLI migration implementation; `rules/api-surface.md`.
 */
export async function runApiV1Migration(
  options: ApiV1MigrationOptions,
  invocationCwd: string,
): Promise<CliCommandResult> {
  try {
    const root = realpathSync(invocationCwd);
    const files = discoverMigrationFiles(root, options.sourcePaths);
    const fileSystem = await apiV1MigrationRuntime.createFileSystemBoundary(root);
    const results: MigrationResultFile[] = [];
    const prepared: PreparedMigrationFile[] = [];
    let rewritten = 0;
    let refused = 0;
    let unchanged = 0;

    for (const file of files) {
      const snapshot = await fileSystem.captureFileForReplacement(file.capturePath);
      if (!snapshot) {
        throw new Error(`${file.outputPath} must remain a regular, non-symlink source file`);
      }
      const source = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.body);
      const analyzed = analyzeMigrationFile(file.outputPath, source);
      results.push(analyzed.result);
      if (analyzed.result.state === 'refused') refused += 1;
      else if (analyzed.result.state === 'rewritten') rewritten += 1;
      else unchanged += 1;
      prepared.push({
        file,
        result: analyzed.result,
        snapshot,
        source,
        rewrittenSource: analyzed.source,
      });
    }

    // SPEC §1.3 / rules/api-surface.md: a source migration may not guess through one file and
    // still rewrite another. The entire captured application is the transaction boundary.
    if (options.mode === 'write' && refused === 0) {
      await applyMigrationTransaction(
        fileSystem,
        prepared.filter((entry) => entry.result.state === 'rewritten'),
      );
    }

    const result = {
      schema: API_V1_MIGRATION_RESULT_SCHEMA,
      batch: API_V1_BATCH,
      mode: options.mode,
      migrationBatches: API_V1_MIGRATION_BATCH_IDS,
      files: results,
      summary: { rewritten, unchanged, refused },
    };
    return {
      exitCode: refused > 0 || (options.mode === 'check' && rewritten > 0) ? 1 : 0,
      output: `${JSON.stringify(result, null, 2)}\n`,
    };
  } catch (error) {
    return {
      error: `kovo: fix api-v1 failed: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
}

/** @internal Mutable only as a boot-captured filesystem seam for transaction rollback tests. */
export const apiV1MigrationRuntime = {
  createFileSystemBoundary: (root: string) => createFrameworkFileSystemBoundary(root),
};

function analyzeMigrationFile(path: string, source: string): AnalyzedMigrationFile {
  // Refusals are always anchored to the on-disk bytes the user can inspect. Each analyzer first
  // sees the original source; only a refusal-free file enters the ordered in-memory rewrite pass.
  const originalAnalyses = API_V1_BATCHES.map((batch) => ({
    analysis: analyzeBatch(batch, path, source),
    batch,
  }));
  const refusals = originalAnalyses.flatMap(({ analysis, batch }) =>
    analysis.status === 'refused'
      ? analysis.refusals.map((refusal) => migrationRefusal(source, batch, refusal))
      : [],
  );
  if (refusals.length > 0) {
    const candidateBatches = originalAnalyses
      .filter(({ analysis }) => analysis.status === 'rewritten')
      .map(({ batch }) => batch.id);
    return {
      result: {
        ...(candidateBatches.length === 0 ? {} : { batches: candidateBatches }),
        path,
        refusals,
        state: 'refused',
      },
      source,
    };
  }

  let rewrittenSource = source;
  const batches: string[] = [];
  for (const batch of API_V1_BATCHES) {
    const analysis = analyzeBatch(batch, path, rewrittenSource);
    if (analysis.status === 'refused') {
      throw new Error(
        `${path}: ${batch.id} became ambiguous only after a prior mechanical rewrite; ` +
          'the migration composition must be reviewed before any source can change',
      );
    }
    if (analysis.status === 'unchanged') continue;
    if (analysis.source === rewrittenSource) {
      throw new Error(`${path}: ${batch.id} reported a rewrite without changing source bytes`);
    }
    rewrittenSource = analysis.source;
    batches.push(batch.id);
  }
  if (batches.length === 0) {
    return { result: { path, state: 'unchanged' }, source };
  }
  return {
    result: { batches, path, state: 'rewritten' },
    source: rewrittenSource,
  };
}

function analyzeBatch(batch: ApiV1Batch, path: string, source: string): ApiV1MigrationAnalysis {
  try {
    return batch.analyze({ fileName: path, source });
  } catch (error) {
    throw new Error(
      `${path}: ${batch.id} analyzer failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function migrationRefusal(
  source: string,
  batch: ApiV1Batch,
  refusal: ApiV1MigrationRefusal,
): MigrationResultRefusal {
  return {
    anchor: {
      end: utf8Offset(source, refusal.end),
      start: utf8Offset(source, refusal.start),
    },
    batch: batch.id,
    category: refusal.category,
    manualAction: manualActionFor(batch, refusal.category),
    reason:
      refusal.reason ??
      `The ${batch.id} analyzer cannot prove this ${refusal.category} rewrite from syntax alone.`,
  };
}

function manualActionFor(batch: ApiV1Batch, category: string): string {
  const guide = `docs/releases/api-v1.md#${batch.guide}`;
  switch (category) {
    case 'ambiguous-binding':
    case 'dynamic-import':
      return `Replace the cited namespace, default, wildcard, CommonJS, computed, or dynamic access with direct named imports, then rerun \`kovo fix api-v1 --check\`; see ${guide}.`;
    case 'auth-posture':
      return `Define the app-local auth result contract and bind its guard or session authority explicitly, then rerun \`kovo fix api-v1 --check\`; see ${guide}.`;
    case 'csrf-posture':
      return `Choose the route's CSRF verifier or explicit reviewed exemption in source, then rerun \`kovo fix api-v1 --check\`; see ${guide}.`;
    case 'deployment-posture':
      return `Configure the concrete deployment origin/runtime boundary in source, then rerun \`kovo fix api-v1 --check\`; see ${guide}.`;
    case 'sql-semantics':
      return `Use the app-scoped query or mutation database, then replace the cited SQL with typed Drizzle or declare its reviewed read/write facts; rerun \`kovo fix api-v1 --check\`; see ${guide}.`;
    case 'trust-decision':
      return `Write the app-owned structured trust/declassification review for the cited value; Kovo will not invent it. Then rerun \`kovo fix api-v1 --check\`; see ${guide}.`;
    default:
      return `${batch.manualAction} Then rerun \`kovo fix api-v1 --check\`; see ${guide}.`;
  }
}

async function applyMigrationTransaction(
  fileSystem: FrameworkFileSystemBoundary,
  entries: readonly PreparedMigrationFile[],
): Promise<void> {
  const written: PreparedMigrationFile[] = [];
  let active: PreparedMigrationFile | undefined;
  try {
    for (const entry of entries) {
      active = entry;
      await fileSystem.replaceCapturedFile(entry.snapshot, entry.rewrittenSource);
      written.push(entry);
      active = undefined;
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    let rolledBack = 0;
    const rollbackEntries =
      active === undefined ? [...written].reverse() : [active, ...written.reverse()];
    for (const entry of rollbackEntries) {
      try {
        const current = await fileSystem.captureFileForReplacement(entry.file.capturePath);
        if (
          current === undefined ||
          !equalBytes(current.body, new TextEncoder().encode(entry.rewrittenSource))
        ) {
          // The active replacement may have failed before touching the target because an author
          // changed it after capture. Preserve those bytes. A previously completed replacement,
          // however, must still match Kovo's output or rollback is genuinely incomplete.
          if (entry !== active) {
            rollbackFailures.push(`${entry.file.outputPath} changed again before rollback`);
          }
          continue;
        }
        await fileSystem.replaceCapturedFile(current, entry.snapshot.body);
        rolledBack += 1;
      } catch (rollbackError) {
        rollbackFailures.push(
          `${entry.file.outputPath}: ${
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          }`,
        );
      }
    }
    const cause = error instanceof Error ? error.message : String(error);
    if (rollbackFailures.length > 0) {
      throw new Error(
        `migration transaction failed (${cause}); rollback was incomplete: ${rollbackFailures.join(
          '; ',
        )}`,
      );
    }
    throw new Error(
      `migration transaction failed (${cause}); ${rolledBack} migration output file(s) rolled back`,
    );
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function discoverMigrationFiles(root: string, inputs: readonly string[]): MigrationFile[] {
  const selected = inputs.length === 0 ? ['.'] : inputs;
  const byOutputPath = new Map<string, MigrationFile>();
  for (const input of selected) {
    const candidate = resolve(root, input);
    const capturePath = relativeInsideRoot(root, candidate, input);
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) throw new Error(`${input} must not be a symlink`);
    if (stat.isFile()) {
      addSourceFile(byOutputPath, capturePath);
      continue;
    }
    if (!stat.isDirectory()) throw new Error(`${input} must be a source file or directory`);
    collectDirectoryFiles(candidate, root, byOutputPath);
  }
  return [...byOutputPath.values()].sort((left, right) =>
    left.outputPath.localeCompare(right.outputPath),
  );
}

function collectDirectoryFiles(
  directory: string,
  root: string,
  target: Map<string, MigrationFile>,
): void {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const candidate = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collectDirectoryFiles(candidate, root, target);
      continue;
    }
    if (!entry.isFile()) continue;
    addSourceFile(target, relativeInsideRoot(root, candidate, candidate));
  }
}

function addSourceFile(target: Map<string, MigrationFile>, capturePath: string): void {
  if (!SOURCE_EXTENSIONS.has(extname(capturePath).toLowerCase())) return;
  const outputPath = capturePath.split(sep).join('/');
  target.set(outputPath, { capturePath, outputPath });
}

function relativeInsideRoot(root: string, candidate: string, input: string): string {
  const relativePath = relative(root, candidate);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${input} resolves outside the invocation root`);
  }
  return relativePath || '.';
}

function utf8Offset(source: string, utf16Offset: number): number {
  return new TextEncoder().encode(source.slice(0, utf16Offset)).byteLength;
}
