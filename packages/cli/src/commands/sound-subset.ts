import { execFile } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  soundSubsetDiagnostic,
  type KovoDiagnosticRecord,
  type KovoDiagnosticSourceAnchor,
} from '../diagnostic.js';
import type { CliCommandResult } from '../shared.js';

const SOUND_SUBSET_VERSION = 'kovo-sound-subset/v1';
const MAX_SOUND_SUBSET_OUTPUT_BYTES = 8 * 1024 * 1024;

/** @internal Boot-captured process seam for exact orchestration tests. */
export const soundSubsetCommandShell = { execFile };

interface SoundSubsetFinding {
  readonly end?: number;
  readonly file: string;
  readonly line: number;
  readonly message: string;
  readonly start?: number;
}

interface SoundSubsetReport {
  readonly findings: readonly SoundSubsetFinding[];
  readonly version: typeof SOUND_SUBSET_VERSION;
}

/**
 * Run the versioned starter-specific classifier shipped with @kovojs/cli.
 *
 * The classifier owns its source spans and structured report. This adapter authenticates the
 * executable path, validates the finite report schema, and only then enrolls shared diagnostics.
 */
export async function runSoundSubsetCheck(
  rootValue: string,
  invocationEnv: NodeJS.ProcessEnv,
  protocol: 'kovo-build/v1' | 'kovo-check/v1',
): Promise<CliCommandResult> {
  const root = realpathSync(resolve(rootValue));
  let script: string;
  try {
    script = soundSubsetScriptPath();
  } catch (error) {
    return runnerFailure(protocol, error);
  }
  const result = await executeSoundSubset(script, root, invocationEnv);
  if (result.error !== undefined) return runnerFailure(protocol, result.error);

  let report: SoundSubsetReport;
  try {
    report = parseSoundSubsetReport(result.stdout);
  } catch (error) {
    return runnerFailure(protocol, error);
  }
  const expectedStatus = report.findings.length === 0 ? 0 : 1;
  if (result.status !== expectedStatus) {
    return runnerFailure(
      protocol,
      `classifier status ${String(result.status)} contradicts ${String(report.findings.length)} finding(s)`,
    );
  }
  if (report.findings.length === 0) {
    return {
      exitCode: 0,
      output: `${protocol}\nOK SOUND-SUBSET files=src\n`,
    };
  }

  const diagnostics: KovoDiagnosticRecord[] = [];
  let lines: string[];
  try {
    lines = report.findings.map((finding) => {
      const source = sourceAnchor(root, finding);
      diagnostics.push(soundSubsetDiagnostic(finding.message, source));
      return `ERROR SOUND-SUBSET ${finding.file}:${String(finding.line)} ${finding.message}`;
    });
  } catch (error) {
    return runnerFailure(protocol, error);
  }
  return {
    diagnostics,
    exitCode: 1,
    output: `${protocol}\n${lines.join('\n')}\n`,
  };
}

async function executeSoundSubset(
  script: string,
  root: string,
  invocationEnv: NodeJS.ProcessEnv,
): Promise<{ readonly error?: unknown; readonly status: number | null; readonly stdout: string }> {
  return new Promise((resolveExecution) => {
    soundSubsetCommandShell.execFile(
      process.execPath,
      [script],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...invocationEnv, KOVO_SOUND_SUBSET_FORMAT: 'json' },
        maxBuffer: MAX_SOUND_SUBSET_OUTPUT_BYTES,
      },
      (error, stdout) => {
        if (error === null) {
          resolveExecution({ status: 0, stdout });
          return;
        }
        const status = typeof error.code === 'number' ? error.code : null;
        if (status === null) {
          resolveExecution({ error, status, stdout });
          return;
        }
        resolveExecution({ status, stdout });
      },
    );
  });
}

function soundSubsetScriptPath(): string {
  const candidates = [
    new URL('./sound-subset.mjs', import.meta.url),
    new URL('./commands/sound-subset.mjs', import.meta.url),
    new URL('../commands/sound-subset.mjs', import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (!existsSync(path)) continue;
    const stats = lstatSync(path);
    if (stats.isFile() && !stats.isSymbolicLink()) return realpathSync(path);
  }
  throw new Error('framework-owned sound-subset executable is missing from @kovojs/cli');
}

function parseSoundSubsetReport(output: unknown): SoundSubsetReport {
  if (typeof output !== 'string' || output.length === 0) {
    throw new TypeError('classifier did not emit its structured report');
  }
  const value = JSON.parse(output) as unknown;
  if (
    !isRecord(value) ||
    value.version !== SOUND_SUBSET_VERSION ||
    !Array.isArray(value.findings)
  ) {
    throw new TypeError('classifier emitted an invalid report envelope');
  }
  const findings = value.findings.map((finding, index) => parseFinding(finding, index));
  return { findings, version: SOUND_SUBSET_VERSION };
}

function parseFinding(value: unknown, index: number): SoundSubsetFinding {
  if (
    !isRecord(value) ||
    typeof value.file !== 'string' ||
    value.file.length === 0 ||
    value.file.startsWith('/') ||
    value.file.includes('\0') ||
    !Number.isInteger(value.line) ||
    Number(value.line) < 1 ||
    typeof value.message !== 'string' ||
    value.message.trim().length === 0
  ) {
    throw new TypeError(`classifier finding ${String(index)} is invalid`);
  }
  const start = value.start;
  const end = value.end;
  if (
    (start !== undefined || end !== undefined) &&
    (!Number.isInteger(start) ||
      !Number.isInteger(end) ||
      Number(start) < 0 ||
      Number(end) <= Number(start))
  ) {
    throw new TypeError(`classifier finding ${String(index)} has an invalid source span`);
  }
  return {
    ...(end === undefined ? {} : { end: Number(end) }),
    file: value.file,
    line: Number(value.line),
    message: value.message.trim(),
    ...(start === undefined ? {} : { start: Number(start) }),
  };
}

function sourceAnchor(
  root: string,
  finding: SoundSubsetFinding,
): KovoDiagnosticSourceAnchor | undefined {
  if (finding.start === undefined || finding.end === undefined) return undefined;
  const file = resolve(root, finding.file);
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    throw new TypeError('classifier finding source escapes the project root');
  }
  return { end: finding.end, file, start: finding.start };
}

function runnerFailure(
  protocol: 'kovo-build/v1' | 'kovo-check/v1',
  error: unknown,
): CliCommandResult {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/\s+/gu, ' ')
    .trim();
  return {
    diagnostics: [
      soundSubsetDiagnostic(
        `Framework-owned sound-subset analysis could not complete: ${message || 'unknown error'}.`,
      ),
    ],
    exitCode: 2,
    error: `${protocol}\nERROR SOUND-SUBSET runner=${message || 'unknown'}\n`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
