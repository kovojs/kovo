import { Buffer } from 'node:buffer';

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

export const compileOutputVersion = 'compile/v1';
export const compileCommandOutputVersion = 'kovo-compile/v1';
export const addOutputVersion = 'kovo-add/v1';
export const mcpOutputVersion = 'kovo-mcp/v1';
export const buildOutputVersion = 'kovo-build/v1';

export function writeCommandResult(result: CliCommandResult): 0 | 1 {
  if ('error' in result) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }

  const stream = result.exitCode === 0 ? process.stdout : process.stderr;
  stream.write(result.output);
  return result.exitCode;
}

export function writeUsageError(message: string): 1 {
  process.stderr.write(`${message}\n`);
  return 1;
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
