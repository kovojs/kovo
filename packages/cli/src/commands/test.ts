import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import { type CliCommandResult } from '../shared.js';
import type { KovoCommandSecurityDisposition } from './security-disposition.js';

const requireFromCli = createRequire(import.meta.url);
const TEST_PROTOCOL = 'kovo-test/v1';

/** @internal Boot-captured process sink kept injectable for exact delegation tests. */
export const testCommandShell = { spawnSync };

export interface KovoTestOptions {
  readonly coverage: boolean;
  readonly files: readonly string[];
  readonly passWithNoTests: boolean;
  readonly reporter?: 'basic' | 'default' | 'dot' | 'json' | 'junit' | 'verbose';
  readonly testNamePattern?: string;
  readonly update: boolean;
}

type TestParseResult =
  | { readonly ok: true; readonly options: KovoTestOptions }
  | { readonly message: string; readonly ok: false };

export function parseTestArgs(args: readonly string[]): TestParseResult {
  const parsed = parseKovoCommandInvocation('test', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };
  return {
    ok: true,
    options: {
      coverage: parsed.value.options.coverage,
      files: parsed.value.arguments.files ?? [],
      passWithNoTests: parsed.value.options.passWithNoTests,
      ...(parsed.value.options.reporter === undefined
        ? {}
        : { reporter: parsed.value.options.reporter }),
      ...(parsed.value.options.testNamePattern === undefined
        ? {}
        : { testNamePattern: parsed.value.options.testNamePattern }),
      update: parsed.value.options.update,
    },
  };
}

/**
 * Run Vitest through Kovo's bundled implementation dependency.
 *
 * `kovo` establishes compiler/runtime posture before this handler. The child receives only the
 * semantic test selection derived by the command AST, so app scripts never expose Vite Plus as a
 * user-facing command (SPEC §11.4/§12).
 */
export async function runTestCommand(
  options: KovoTestOptions,
  security: KovoCommandSecurityDisposition,
): Promise<CliCommandResult> {
  const args = ['test', '--run', ...options.files];
  if (options.coverage) args.push('--coverage');
  if (options.update) args.push('--update');
  if (options.passWithNoTests) args.push('--passWithNoTests');
  if (options.reporter !== undefined) args.push('--reporter', options.reporter);
  if (options.testNamePattern !== undefined) args.push('-t', options.testNamePattern);

  let executable: string;
  try {
    executable = vitePlusBin();
  } catch (error) {
    return {
      error: `${TEST_PROTOCOL}\nERROR runner reason=${singleLine(error)}`,
      exitCode: 2,
    };
  }

  const result = testCommandShell.spawnSync(process.execPath, [executable, ...args], {
    cwd: security.invocationCwd,
    env: security.invocationEnv,
    stdio: 'inherit',
  });
  if (result.error !== undefined || result.signal !== null) {
    return {
      error: `${TEST_PROTOCOL}\nERROR runner reason=${singleLine(
        result.error ?? `terminated by ${result.signal}`,
      )}`,
      exitCode: 2,
    };
  }
  const status = result.status ?? 2;
  if (status === 0) {
    return { exitCode: 0, output: `${TEST_PROTOCOL}\nPASS\n` };
  }
  return {
    error: `${TEST_PROTOCOL}\n${status === 1 ? 'FAIL tests' : `ERROR runner status=${status}`}`,
    exitCode: status === 1 ? 1 : 2,
  };
}

function vitePlusBin(): string {
  const manifestPath = requireFromCli.resolve('vite-plus/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('bin' in manifest) ||
    typeof manifest.bin !== 'object' ||
    manifest.bin === null ||
    !('vp' in manifest.bin) ||
    typeof manifest.bin.vp !== 'string'
  ) {
    throw new TypeError('vite-plus package does not declare its vp executable');
  }
  return resolve(dirname(manifestPath), manifest.bin.vp);
}

function singleLine(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).replace(/\s+/gu, ' ').trim();
}
