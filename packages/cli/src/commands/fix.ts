import { realpathSync } from 'node:fs';
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

import {
  commandArgvError,
  FIX_ARGV_SPEC,
  FIX_USAGE,
  parsedBooleanOption,
  parseCommandArgv,
  requireSinglePositional,
} from '../commands-manifest.js';
import type { CliCommandResult } from '../shared.js';

/** @internal Parsed options for the source-rewrite and corpus-report modes. */
export type FixCommandOptions =
  | { readonly check: boolean; readonly sourcePath: string }
  | { readonly costReport: true };

/** @internal Closed parse result for `kovo fix`. */
export type FixArgParseResult =
  | { readonly ok: true; readonly options: FixCommandOptions }
  | { readonly message: string; readonly ok: false };

/** @internal Parse `kovo fix` through the manifest-owned argv grammar. */
export function parseFixArgs(args: readonly string[]): FixArgParseResult {
  const parsed = parseCommandArgv(args, FIX_ARGV_SPEC);
  if (!parsed.ok) return commandArgvError('fix', parsed, FIX_USAGE);
  const costReport = parsedBooleanOption(parsed.value, '--cost-report');
  const check = parsedBooleanOption(parsed.value, '--check');
  if (costReport) {
    if (check || parsed.value.positionals.length > 0) {
      return {
        message: `kovo: fix --cost-report does not accept a source path or --check.\n${FIX_USAGE}`,
        ok: false,
      };
    }
    return { ok: true, options: { costReport: true } };
  }

  const sourcePath = requireSinglePositional(parsed.value, {
    label: 'authored source path',
    name: 'fix',
    usage: FIX_USAGE,
  });
  if (!sourcePath.ok) return sourcePath;
  return { ok: true, options: { check, sourcePath: sourcePath.value } };
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
