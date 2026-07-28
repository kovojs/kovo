import { Buffer } from 'node:buffer';

import {
  kovoCommandExitCode,
  requireKovoCommandResultProtocol,
  type KovoCommandName,
} from './command-schema.js';
import {
  commandFindingDiagnostic,
  formatKovoDiagnostics,
  usageDiagnostic,
  type KovoDiagnosticCategory,
  type KovoDiagnosticFormat,
  type KovoDiagnosticRecord,
} from './diagnostic.js';

/**
 * Result of a `kovoCheck`/`kovoExplain` run: the stable verifier output text and
 * a process exit code (0 success, 1 failure) matching what the `kovo` bin would
 * emit (SPEC.md §11.4 verification surface; §1.1 proof claims).
 */
export interface KovoCheckResult {
  exitCode: 0 | 1;
  output: string;
}

export type CliCommandResult =
  | KovoCheckResult
  | {
      readonly diagnostics?: readonly KovoDiagnosticRecord[];
      error: string;
      exitCode: 1 | 2;
    };

/**
 * A process-level CLI result may additionally be indeterminate. SPEC §11.4
 * assigns authenticated UNKNOWN to exit 2; the command contract also assigns
 * invocation/config mistakes to 2. The versioned payload distinguishes them.
 */
export type CliProcessResult =
  | CliCommandResult
  | {
      readonly diagnostics?: readonly KovoDiagnosticRecord[];
      exitCode: 2;
      output: string;
    };

type NormalizedCliProcessResult =
  | (KovoCheckResult & { readonly diagnostics?: readonly KovoDiagnosticRecord[] })
  | {
      readonly diagnostics?: readonly KovoDiagnosticRecord[];
      error: string;
      exitCode: 1 | 2;
    }
  | {
      readonly diagnostics?: readonly KovoDiagnosticRecord[];
      exitCode: 2;
      output: string;
    };

export const compileOutputVersion = 'compile/v1';
export const compileCommandOutputVersion = requireKovoCommandResultProtocol('compile');
export const addOutputVersion = requireKovoCommandResultProtocol('add');
export const mcpOutputVersion = requireKovoCommandResultProtocol('mcp');
export const buildOutputVersion = requireKovoCommandResultProtocol('build');
export const dbOutputVersion = requireKovoCommandResultProtocol('db');

export function writeCommandResult(
  result: CliProcessResult,
  category: Exclude<KovoDiagnosticCategory, 'usage'> = 'proof',
  command?: KovoCommandName,
  exitTwoClass: 'unknown' | 'usage' = 'usage',
): 0 | 1 | 2 {
  const normalized = normalizeCommandResultDiagnostics(result, category);
  if ('error' in normalized) {
    process.stderr.write(normalized.error);
  } else {
    const stream = normalized.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(normalized.output);
  }

  if (command === undefined) return normalized.exitCode;
  const exitClass =
    normalized.exitCode === 0 ? 'success' : normalized.exitCode === 1 ? 'finding' : exitTwoClass;
  const schemaExitCode = kovoCommandExitCode(command, exitClass);
  if (schemaExitCode !== normalized.exitCode) {
    throw new TypeError(
      `Kovo ${command} result exit ${normalized.exitCode} contradicts schema class ${exitClass}.`,
    );
  }
  return schemaExitCode;
}

export function writeUsageError(message: string, command?: KovoCommandName): 2 {
  process.stderr.write(formatKovoDiagnostics([usageDiagnostic(message)], 'human'));
  if (command === undefined) return 2;
  const exitCode = kovoCommandExitCode(command, 'usage');
  if (exitCode !== 2) {
    throw new TypeError(`Kovo ${command} usage exit ${exitCode} contradicts the CLI contract.`);
  }
  return exitCode;
}

/**
 * @internal Attach one stable record to a command finding and render its human
 * output through the same adapter used by JSON and GitHub consumers.
 */
export function normalizeCommandResultDiagnostics(
  result: CliProcessResult,
  category: Exclude<KovoDiagnosticCategory, 'usage'>,
): NormalizedCliProcessResult {
  if (result.exitCode === 0) return result;
  const existing = 'diagnostics' in result ? result.diagnostics : undefined;
  const diagnostics =
    existing === undefined || existing.length === 0
      ? Object.freeze([
          commandFindingDiagnostic(category, 'error' in result ? result.error : result.output),
        ])
      : existing;
  const human = formatKovoDiagnostics(diagnostics, 'human');
  const normalized: NormalizedCliProcessResult =
    'error' in result
      ? { error: human, exitCode: result.exitCode }
      : result.exitCode === 2
        ? { exitCode: 2 as const, output: human }
        : { exitCode: 1 as const, output: human };
  Object.defineProperty(normalized, 'diagnostics', {
    configurable: false,
    enumerable: false,
    value: diagnostics,
    writable: false,
  });
  return normalized;
}

/** @internal Render the exact records associated with a command result. */
export function formatCommandResultDiagnostics(
  result: CliProcessResult,
  format: KovoDiagnosticFormat,
  category: Exclude<KovoDiagnosticCategory, 'usage'>,
): string {
  const normalized = normalizeCommandResultDiagnostics(result, category);
  if (normalized.exitCode === 0) {
    return format === 'human' ? normalized.output : formatKovoDiagnostics([], format);
  }
  const diagnostics = normalized.diagnostics ?? [];
  return formatKovoDiagnostics(diagnostics, format);
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function stableValue(value: string | undefined): string {
  return value === undefined ? '-' : JSON.stringify(value);
}

export function stableText(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ');
}
