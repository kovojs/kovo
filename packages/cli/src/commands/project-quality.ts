import { execFile } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import {
  projectQualityDiagnostic,
  type KovoDiagnosticRecord,
  type KovoDiagnosticSourceAnchor,
} from '../diagnostic.js';
import type { CliCommandResult } from '../shared.js';
import { resolveVitePlusBin } from './vite-plus-bin.js';

const MAX_QUALITY_OUTPUT_BYTES = 16 * 1024 * 1024;
const PROJECT_QUALITY_THREADS = 2;

/** @internal Boot-captured process seam for exact orchestration tests. */
export const projectQualityCommandShell = { execFile };

interface CommandExecution {
  readonly error?: unknown;
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

/**
 * Run formatter and lint policy through Kovo's pinned Vite Plus implementation dependency.
 *
 * TypeScript correctness remains owned by the incremental Kovo preflight. New starters disable
 * Vite Plus's duplicate full type-check while retaining type-aware lint rules.
 */
export async function runProjectQualityCheck(
  rootValue: string,
  invocationEnv: NodeJS.ProcessEnv,
  protocol: 'kovo-build/v1' | 'kovo-check/v1',
): Promise<CliCommandResult> {
  const root = realpathSync(resolve(rootValue));
  let executable: string;
  try {
    executable = resolveVitePlusBin();
  } catch (error) {
    return runnerFailure(protocol, error);
  }

  // Both tools inspect the whole project. Keep their process trees disjoint so copy-in catalogs
  // remain below the first-loop memory ceiling; concurrency here saved wall time by summing two
  // independent formatter/linter heaps at the exact point larger apps need bounded behavior.
  const format = await execute(
    executable,
    ['fmt', '--list-different', `--threads=${String(PROJECT_QUALITY_THREADS)}`],
    root,
    invocationEnv,
  );
  const lint = await execute(
    executable,
    ['lint', '--format=json', `--threads=${String(PROJECT_QUALITY_THREADS)}`],
    root,
    invocationEnv,
  );
  if (format.error !== undefined) return runnerFailure(protocol, format.error);
  if (lint.error !== undefined) return runnerFailure(protocol, lint.error);

  let diagnostics: KovoDiagnosticRecord[];
  try {
    diagnostics = [...formatDiagnostics(root, format), ...lintDiagnostics(root, lint)];
  } catch (error) {
    return runnerFailure(protocol, error);
  }
  const expectedStatus = diagnostics.length === 0 ? 0 : 1;
  if (
    (format.status !== 0 && format.status !== 1) ||
    (lint.status !== 0 && lint.status !== 1) ||
    (expectedStatus === 0 && (format.status !== 0 || lint.status !== 0)) ||
    (expectedStatus === 1 && format.status === 0 && lint.status === 0)
  ) {
    return runnerFailure(
      protocol,
      `formatter/linter status contradicts ${String(diagnostics.length)} finding(s)`,
    );
  }
  if (diagnostics.length === 0) {
    return {
      exitCode: 0,
      output: `${protocol}\nOK PROJECT-QUALITY format=clean lint=clean\n`,
    };
  }

  return {
    diagnostics,
    exitCode: 1,
    output: `${protocol}\n${diagnostics
      .map((diagnostic) => {
        const source = diagnostic.source;
        const anchor =
          source === undefined
            ? ''
            : ` ${relative(root, source.file)}:${String(source.start)}-${String(source.end)}`;
        return `ERROR PROJECT-QUALITY${anchor} ${diagnostic.message}`;
      })
      .join('\n')}\n`,
  };
}

async function execute(
  executable: string,
  args: readonly string[],
  root: string,
  invocationEnv: NodeJS.ProcessEnv,
): Promise<CommandExecution> {
  return new Promise((resolveExecution) => {
    projectQualityCommandShell.execFile(
      process.execPath,
      [executable, ...args],
      {
        cwd: root,
        encoding: 'utf8',
        env: invocationEnv,
        maxBuffer: MAX_QUALITY_OUTPUT_BYTES,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolveExecution({ status: 0, stderr, stdout });
          return;
        }
        const status = typeof error.code === 'number' ? error.code : null;
        if (status === null) {
          resolveExecution({ error, status, stderr, stdout });
          return;
        }
        resolveExecution({ status, stderr, stdout });
      },
    );
  });
}

function formatDiagnostics(root: string, execution: CommandExecution): KovoDiagnosticRecord[] {
  if (execution.status === 0) return [];
  const diagnostics: KovoDiagnosticRecord[] = [];
  for (const line of execution.stdout.split(/\r?\n/u)) {
    const candidate = line.trim();
    if (candidate.length === 0) continue;
    const file = projectFile(root, candidate);
    if (file === undefined) continue;
    diagnostics.push(
      projectQualityDiagnostic(
        `${relative(root, file)} does not match the project formatter.`,
        firstByteAnchor(file),
      ),
    );
  }
  if (diagnostics.length === 0) {
    throw new TypeError(`formatter failed without file findings: ${singleLine(execution.stderr)}`);
  }
  return diagnostics;
}

function lintDiagnostics(root: string, execution: CommandExecution): KovoDiagnosticRecord[] {
  if (execution.status === 0) return [];
  const report = JSON.parse(execution.stdout) as unknown;
  if (!isRecord(report) || !Array.isArray(report.diagnostics)) {
    throw new TypeError(`linter failed without a JSON report: ${singleLine(execution.stderr)}`);
  }
  return report.diagnostics.map((value, index) => {
    if (
      !isRecord(value) ||
      typeof value.message !== 'string' ||
      value.message.trim().length === 0 ||
      typeof value.filename !== 'string'
    ) {
      throw new TypeError(`linter diagnostic ${String(index)} is invalid`);
    }
    const file = projectFile(root, value.filename);
    if (file === undefined) throw new TypeError(`linter diagnostic ${String(index)} escapes root`);
    const label = Array.isArray(value.labels) ? value.labels[0] : undefined;
    const span = isRecord(label) && isRecord(label.span) ? label.span : undefined;
    const start = isRecord(span) && Number.isInteger(span.offset) ? Number(span.offset) : undefined;
    const length =
      isRecord(span) && Number.isInteger(span.length) ? Number(span.length) : undefined;
    const source =
      start === undefined || length === undefined || length < 1
        ? firstByteAnchor(file)
        : ({ end: start + length, file, start } satisfies KovoDiagnosticSourceAnchor);
    const upstreamCode = typeof value.code === 'string' ? `${value.code}: ` : '';
    return projectQualityDiagnostic(`${upstreamCode}${value.message.trim()}`, source);
  });
}

function projectFile(root: string, value: string): string | undefined {
  const candidate = resolve(root, value);
  if (!existsSync(candidate)) return undefined;
  const stats = lstatSync(candidate);
  if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
  const file = realpathSync(candidate);
  if (file !== root && !file.startsWith(`${root}${sep}`)) return undefined;
  return file;
}

function firstByteAnchor(file: string): KovoDiagnosticSourceAnchor | undefined {
  const size = lstatSync(file).size;
  return size < 1 ? undefined : { end: 1, file, start: 0 };
}

function runnerFailure(
  protocol: 'kovo-build/v1' | 'kovo-check/v1',
  error: unknown,
): CliCommandResult {
  const message = singleLine(error) || 'unknown';
  return {
    diagnostics: [
      projectQualityDiagnostic(
        `Framework-owned project quality analysis could not complete: ${message}.`,
      ),
    ],
    exitCode: 2,
    error: `${protocol}\nERROR PROJECT-QUALITY runner=${message}\n`,
  };
}

function singleLine(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).replace(/\s+/gu, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
