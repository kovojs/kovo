import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { DiagnosticCode } from '@kovojs/core';
import {
  createFrameworkFileSystemBoundary,
  type CapturedFileReplacement,
  type FrameworkFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';
import {
  analyzeSafeComponentFixes,
  measureAgentAuthoredCostToGreenCorpus,
  type SafeComponentFixEdit,
} from '@kovojs/compiler/internal';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import type { CliCommandResult } from '../shared.js';
import { runApiV1Migration } from './api-v1-migration.js';
import { resolveVitePlusBin } from './vite-plus-bin.js';

const FIX_FORMAT_PROTOCOL = 'kovo-fix-format/v1';

/** @internal Boot-captured process seam for exact formatter-delegation tests. */
export const fixFormatCommandShell = { spawnSync };

/** @internal Parsed options for the source-rewrite and corpus-report modes. */
export type FixCommandOptions =
  | { readonly check: boolean; readonly sourcePath: string }
  | {
      readonly apiV1: true;
      readonly check: boolean;
      readonly sourcePaths: readonly string[];
    }
  | {
      readonly check: boolean;
      readonly format: true;
      readonly sourcePaths: readonly string[];
    }
  | { readonly costReport: true };

/** @internal Closed parse result for `kovo fix`. */
export type FixArgParseResult =
  | { readonly ok: true; readonly options: FixCommandOptions }
  | { readonly message: string; readonly ok: false };

/** @internal Parse `kovo fix` through the manifest-owned argv grammar. */
export function parseFixArgs(args: readonly string[]): FixArgParseResult {
  const parsed = parseKovoCommandInvocation('fix', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };
  if (parsed.value.form === 'cost-report') {
    return { ok: true, options: { costReport: true } };
  }
  if (parsed.value.form === 'api-v1') {
    return {
      ok: true,
      options: {
        apiV1: true,
        check: parsed.value.options.check,
        sourcePaths: parsed.value.arguments.sources ?? [],
      },
    };
  }
  if (parsed.value.form === 'format') {
    return {
      ok: true,
      options: {
        check: parsed.value.options.check,
        format: true,
        sourcePaths: parsed.value.arguments.sources ?? [],
      },
    };
  }

  return {
    ok: true,
    options: {
      check: parsed.value.options.check,
      sourcePath: parsed.value.arguments.source,
    },
  };
}

/**
 * Apply only compiler-proven source rewrites. The command refuses symlinks, generated trees,
 * ambiguous diagnostics, analyzer residue, and required emitted-behavior drift.
 *
 * @internal CLI command implementation; SPEC §5.2 / §11.4.
 */
export async function runFixCommand(
  options: FixCommandOptions,
  invocationCwd: string,
): Promise<CliCommandResult> {
  try {
    if ('costReport' in options) return costReportResult();
    if ('apiV1' in options) {
      return runApiV1Migration(
        {
          mode: options.check ? 'check' : 'write',
          sourcePaths: options.sourcePaths,
        },
        invocationCwd,
      );
    }
    if ('format' in options) {
      return runFormatFix(options, invocationCwd);
    }
    const source = await readAuthoredSource(invocationCwd, options.sourcePath);
    const analysis = analyzeSafeComponentFixes({
      fileName: source.relativePath,
      source: source.value,
    });
    if (analysis.status === 'green') {
      return {
        exitCode: 0,
        output: `OK kovo fix ${source.relativePath} rewritten=0 analyzer=green\n`,
      };
    }
    if (analysis.status === 'blocked') {
      return {
        exitCode: 1,
        output: `${blockedLines(analysis.blockedCodes, source.relativePath)}kovo fix: refused to write; ${analysis.reason}.\n`,
      };
    }

    const verb = options.check ? 'WOULD_FIX' : 'FIX';
    const lines = editLines(verb, source.relativePath, source.value, analysis.edits);
    if (options.check) {
      return {
        exitCode: 1,
        output: `${lines}kovo fix: check found ${analysis.edits.length} safe rewrite(s); analyzer=green.\n`,
      };
    }

    await source.fileSystem.replaceCapturedFile(source.snapshot, analysis.source);
    return {
      exitCode: 0,
      output: `${lines}OK kovo fix ${source.relativePath} rewritten=${analysis.edits.length} analyzer=green\n`,
    };
  } catch (error) {
    return {
      error: `kovo: fix failed: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
}

function runFormatFix(
  options: Extract<FixCommandOptions, { readonly format: true }>,
  invocationCwd: string,
): CliCommandResult {
  const root = realpathSync(invocationCwd);
  const sources = options.sourcePaths.map((source) => resolveAuthoredFormatPath(root, source));
  const executable = resolveVitePlusBin();
  const result = fixFormatCommandShell.spawnSync(
    process.execPath,
    [executable, 'fmt', options.check ? '--check' : '--write', ...sources],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error !== undefined || result.signal !== null) {
    return {
      error: `${FIX_FORMAT_PROTOCOL}\nERROR runner reason=${singleLine(
        result.error ?? `terminated by ${result.signal}`,
      )}`,
      exitCode: 2,
    };
  }
  const status = result.status ?? 2;
  if (status === 0) {
    return {
      exitCode: 0,
      output: `${FIX_FORMAT_PROTOCOL}\nOK mode=${options.check ? 'check' : 'write'} paths=${
        sources.length === 0 ? 'project' : String(sources.length)
      }\n`,
    };
  }
  if (options.check && status === 1) {
    return {
      error: `${FIX_FORMAT_PROTOCOL}\nWOULD_FORMAT paths=${
        sources.length === 0 ? 'project' : String(sources.length)
      }\n`,
      exitCode: 1,
    };
  }
  return {
    error: `${FIX_FORMAT_PROTOCOL}\nERROR runner status=${String(status)}\n`,
    exitCode: 2,
  };
}

function resolveAuthoredFormatPath(root: string, input: string): string {
  const candidate = resolve(root, input);
  const relativePath = relative(root, candidate);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${input} resolves outside the invocation root`);
  }
  const stats = lstatSync(candidate);
  if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
    throw new Error(`${input} must be a regular file or directory`);
  }
  const canonical = realpathSync(candidate);
  const canonicalRelative = relative(root, canonical);
  if (
    canonicalRelative === '..' ||
    canonicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(canonicalRelative)
  ) {
    throw new Error(`${input} resolves outside the invocation root`);
  }
  return canonicalRelative === '' ? '.' : canonicalRelative;
}

function singleLine(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).replace(/\s+/gu, ' ').trim();
}

interface AuthoredSource {
  readonly fileSystem: FrameworkFileSystemBoundary;
  readonly relativePath: string;
  readonly snapshot: CapturedFileReplacement;
  readonly value: string;
}

async function readAuthoredSource(
  invocationCwd: string,
  inputPath: string,
): Promise<AuthoredSource> {
  const root = realpathSync(invocationCwd);
  const lexicalPath = resolve(root, inputPath);
  const lexicalRelativePath = relativeAuthoredPath(root, lexicalPath, inputPath);
  assertAuthoredPathShape(lexicalRelativePath, inputPath);
  const fileSystem = await createFrameworkFileSystemBoundary(root);
  const snapshot = await fileSystem.captureFileForReplacement(lexicalRelativePath);
  if (snapshot === undefined) {
    throw new Error(`${inputPath} must be a regular, non-symlink source file`);
  }
  const relativePath = snapshot.relativePath;
  assertAuthoredPathShape(relativePath, inputPath);
  return {
    fileSystem,
    relativePath,
    snapshot,
    value: new TextDecoder('utf-8').decode(snapshot.body),
  };
}

function relativeAuthoredPath(root: string, candidatePath: string, inputPath: string): string {
  const relativePath = relative(root, candidatePath);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${inputPath} resolves outside the invocation root`);
  }
  return relativePath;
}

function assertAuthoredPathShape(relativePath: string, inputPath: string): void {
  const extension = extname(relativePath).toLowerCase();
  if (extension !== '.tsx' && extension !== '.jsx') {
    throw new Error(`${inputPath} must be authored TSX or JSX source`);
  }
  const segments = relativePath.split(sep);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (
      segment === '.kovo' ||
      segment === 'dist' ||
      segment === 'generated' ||
      segment === 'node_modules'
    ) {
      throw new Error(`${inputPath} is under generated or dependency path ${segment}`);
    }
  }
}

function blockedLines(codes: readonly DiagnosticCode[], relativePath: string): string {
  let output = '';
  for (let index = 0; index < codes.length; index += 1) {
    output += `BLOCKED ${codes[index]} ${relativePath} recipe=none\n`;
  }
  return output;
}

function editLines(
  verb: 'FIX' | 'WOULD_FIX',
  relativePath: string,
  source: string,
  edits: readonly SafeComponentFixEdit[],
): string {
  let output = '';
  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index]!;
    const position = sourcePosition(source, edit.start);
    output += `${verb} ${edit.code} ${relativePath}:${position.line}:${position.column} recipe=${edit.recipe} atoms=${edit.editAtoms}\n`;
  }
  return output;
}

function sourcePosition(source: string, offset: number): { column: number; line: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { column, line };
}

function costReportResult(): CliCommandResult {
  const report = measureAgentAuthoredCostToGreenCorpus();
  let output = `COST_TO_GREEN ${report.schema} metric=${JSON.stringify(report.metric)} corpus=${report.corpusAuthor}\n`;
  let defects = 0;
  for (let index = 0; index < report.diagnostics.length; index += 1) {
    const row = report.diagnostics[index]!;
    if (row.status === 'framework-defect') defects += 1;
    output +=
      `DIAGNOSTIC ${row.code} traffic=${row.traffic} ` +
      `safe=${row.safeEditAtoms ?? '-'} escape=${row.escapeEditAtoms} ` +
      `delta=${row.costDelta ?? '-'} status=${row.status} owner=${row.defectOwner ?? '-'}\n`;
  }
  output += `SUMMARY diagnostics=${report.diagnostics.length} cases=${report.cases} defects=${defects}\n`;
  return { exitCode: defects === 0 ? 0 : 1, output };
}
