import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  createFrameworkFileSystemBoundary,
  type CapturedFileReplacement,
  type FrameworkFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';
import {
  analyzeStyleApiV1Migration,
  type StyleApiV1MigrationRefusal,
} from '@kovojs/compiler/internal';

import type { CliCommandResult } from '../shared.js';

export const API_V1_MIGRATION_RESULT_SCHEMA = 'kovo-api-migration-result/v1' as const;
const API_V1_BATCH = 'style-opaque-handles';
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.kovo',
  '.release',
  'dist',
  'generated',
  'node_modules',
]);
const SOURCE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

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
  readonly path: string;
  readonly refusals?: readonly {
    readonly anchor: { readonly end: number; readonly start: number };
    readonly category: StyleApiV1MigrationRefusal['category'];
  }[];
  readonly state: 'refused' | 'rewritten' | 'unchanged';
}

interface PreparedMigrationFile {
  readonly analysis: ReturnType<typeof analyzeStyleApiV1Migration>;
  readonly file: MigrationFile;
  readonly snapshot: CapturedFileReplacement;
}

/** @internal Execute the style API v1 migration with deterministic structured output. */
export async function runApiV1Migration(
  options: ApiV1MigrationOptions,
  invocationCwd: string,
): Promise<CliCommandResult> {
  try {
    const root = realpathSync(invocationCwd);
    const files = discoverMigrationFiles(root, options.sourcePaths);
    const fileSystem = await createFrameworkFileSystemBoundary(root);
    const results: MigrationResultFile[] = [];
    let rewritten = 0;
    let refused = 0;
    let unchanged = 0;
    const prepared: PreparedMigrationFile[] = [];

    for (const file of files) {
      const snapshot = await fileSystem.captureFileForReplacement(file.capturePath);
      if (!snapshot) {
        throw new Error(`${file.outputPath} must remain a regular, non-symlink source file`);
      }
      const source = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.body);
      const analysis = analyzeStyleApiV1Migration({
        fileName: file.outputPath,
        source,
      });
      prepared.push({ analysis, file, snapshot });
      if (analysis.status === 'refused') {
        refused += 1;
        results.push({
          path: file.outputPath,
          refusals: analysis.refusals.map((entry) => ({
            anchor: {
              end: utf8Offset(source, entry.end),
              start: utf8Offset(source, entry.start),
            },
            category: entry.category,
          })),
          state: 'refused',
        });
        continue;
      }
      if (analysis.status === 'rewritten') {
        rewritten += 1;
        results.push({ path: file.outputPath, state: 'rewritten' });
        continue;
      }
      unchanged += 1;
      results.push({ path: file.outputPath, state: 'unchanged' });
    }

    // Analyze and capture the complete batch before the first write. A refusal
    // anywhere leaves every source file unchanged instead of producing a
    // half-migrated application.
    if (options.mode === 'write' && refused === 0) {
      for (const entry of prepared) {
        if (entry.analysis.status !== 'rewritten') continue;
        await replaceCapturedSource(fileSystem, entry.snapshot, entry.analysis.source);
      }
    }

    const result = {
      schema: API_V1_MIGRATION_RESULT_SCHEMA,
      batch: API_V1_BATCH,
      mode: options.mode,
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

async function replaceCapturedSource(
  fileSystem: FrameworkFileSystemBoundary,
  snapshot: CapturedFileReplacement,
  source: string,
): Promise<void> {
  await fileSystem.replaceCapturedFile(snapshot, source);
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
