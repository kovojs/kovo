import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import { kovoInvocationEnvironmentValue } from '../invocation-environment.js';
import { type CliCommandResult } from '../shared.js';
import type { KovoCommandSecurityDisposition } from './security-disposition.js';
import { resolveVitePlusBin } from './vite-plus-bin.js';

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
  let runnerConfig: string;
  try {
    runnerConfig = resolveKovoTestRunnerConfig();
  } catch (error) {
    return {
      error: `${TEST_PROTOCOL}\nERROR bootstrap reason=${singleLine(error)}`,
      exitCode: 2,
    };
  }
  const args = ['test', '--run', '--config', runnerConfig, ...options.files];
  if (options.coverage) args.push('--coverage');
  if (options.update) args.push('--update');
  if (options.passWithNoTests) args.push('--passWithNoTests');
  if (options.reporter !== undefined) args.push('--reporter', options.reporter);
  if (options.testNamePattern !== undefined) args.push('-t', options.testNamePattern);

  let executable: string;
  try {
    executable = resolveVitePlusBin();
  } catch (error) {
    return {
      error: `${TEST_PROTOCOL}\nERROR runner reason=${singleLine(error)}`,
      exitCode: 2,
    };
  }

  const result = testCommandShell.spawnSync(process.execPath, [executable, ...args], {
    cwd: security.invocationCwd,
    env: testRunnerEnvironment(security.invocationEnv),
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

function testRunnerEnvironment(invocationEnvironment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(invocationEnvironment)) {
    // The source CLI's self-respawn marker is framework transport state, not operator posture.
    // A nested `kovo dev` launched by a test must perform its own typed-source respawn.
    if (name.toLowerCase() === 'kovo_cli_transform_types') continue;
    childEnvironment[name] = value;
  }
  if (kovoInvocationEnvironmentValue(invocationEnvironment, 'BETTER_AUTH_URL') === undefined) {
    // Tests have no bound HTTP listener, but Better Auth still needs one canonical origin to build
    // its same-origin adapters. Supply a deterministic loopback-only test posture without
    // overriding any operator-provided value (SPEC §6.6/§12).
    childEnvironment.BETTER_AUTH_URL = 'http://127.0.0.1:4173';
  }
  return childEnvironment;
}

function resolveKovoTestRunnerConfig(): string {
  // Source workspaces evaluate this module from src/commands; packed CLIs bundle it into dist/bin
  // beside the separately emitted runner config. Authenticate either exact package-owned location.
  const candidates = [
    fileURLToPath(new URL('../test-runner-config.ts', import.meta.url)),
    fileURLToPath(new URL('./test-runner-config.mjs', import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const stats = lstatSync(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new TypeError('Kovo test runner config is not a regular package file.');
    }
    return realpathSync(candidate);
  }
  throw new TypeError('Kovo test runner config is missing from the installed CLI.');
}

function singleLine(value: unknown): string {
  return (value instanceof Error ? value.message : String(value)).replace(/\s+/gu, ' ').trim();
}
