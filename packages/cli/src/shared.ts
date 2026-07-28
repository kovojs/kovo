import { Buffer } from 'node:buffer';

import { requireKovoCommandResultProtocol } from './command-schema.js';
import { formatKovoDiagnostics, usageDiagnostic } from './diagnostic.js';

/**
 * Result of a `kovoCheck`/`kovoExplain` run: the stable verifier output text and
 * a process exit code (0 success, 1 failure) matching what the `kovo` bin would
 * emit (SPEC.md §11.4 verification surface; §1.1 proof claims).
 */
export interface KovoCheckResult {
  exitCode: 0 | 1;
  output: string;
}

export type CliCommandResult = KovoCheckResult | { error: string; exitCode: 1 };

/**
 * A process-level CLI result may additionally be indeterminate. SPEC §11.4
 * assigns authenticated UNKNOWN to exit 2; the command contract also assigns
 * invocation/config mistakes to 2. The versioned payload distinguishes them.
 */
export type CliProcessResult = CliCommandResult | { exitCode: 2; output: string };

export const compileOutputVersion = 'compile/v1';
export const compileCommandOutputVersion = requireKovoCommandResultProtocol('compile');
export const addOutputVersion = requireKovoCommandResultProtocol('add');
export const mcpOutputVersion = requireKovoCommandResultProtocol('mcp');
export const buildOutputVersion = requireKovoCommandResultProtocol('build');
export const dbOutputVersion = requireKovoCommandResultProtocol('db');

export function writeCommandResult(result: CliProcessResult): 0 | 1 | 2 {
  if ('error' in result) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }

  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(result.output);
  return result.exitCode;
}

export function writeUsageError(message: string): 2 {
  process.stderr.write(formatKovoDiagnostics([usageDiagnostic(message)], 'human'));
  return 2;
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
