#!/usr/bin/env node
export type { DiagnosticCode } from '@kovojs/core';
import { pathToFileURL } from 'node:url';

import {
  parseBuildArgs,
  parseExportArgs,
  runBuildCommand,
  runExportCommand,
} from './commands/build-export.js';
import {
  compileUsage,
  parseAddArgs,
  parseCompileArgs,
  runAddCommand,
  runCompileCommand,
} from './commands/compile.js';
import {
  compileComponentV1,
  handleKovoMcpRequest,
  runMcpCommand,
  runMcpFallbackStdio,
  runMcpSdkServer,
} from './commands/mcp.js';
import {
  kovoAudit,
  kovoCheck,
  kovoExplain,
  outputVersion,
  parseAuditArgs,
  parseCheckArgs,
  parseExplainArgs,
  runGraphCommand,
  writeCheckUsageError,
} from './graph-output.js';
import { stableValue, writeCommandResult, writeUsageError } from './shared.js';
import {
  scanSourceSinkDrift,
  sourcesSinksCheckResult,
  writeSourcesSinksArtifact,
} from './sources-sinks.js';

export {
  compileComponentV1,
  handleKovoMcpRequest,
  kovoAudit,
  kovoCheck,
  kovoExplain,
  runMcpFallbackStdio,
  runMcpSdkServer,
};

export type {
  CompileComponentV1Diagnostic,
  CompileComponentV1Input,
  CompileComponentV1Result,
  KovoMcpRequest,
  KovoMcpResponse,
  KovoMcpToolName,
} from './commands/mcp.js';
export type {
  ExplainKind,
  KovoAuditOptions,
  KovoCheckFamily,
  KovoCheckInput,
  KovoEndpointExplainOptions,
  KovoExplainInput,
  KovoExplainOptions,
  KovoSourcesSinksExplainOptions,
  KovoTargetExplainOptions,
  KovoUnguardedExplainOptions,
  KovoUnscopedExplainOptions,
} from './graph-output.js';
export type { KovoCheckResult } from './shared.js';

/** @internal Synchronous argv dispatcher for the `kovo` bin; not a public API. */
export function main(args: readonly string[] = process.argv.slice(2)): number {
  if (args.length === 0) {
    process.stdout.write('kovo: add, audit, build, check, compile, explain, export, mcp\n');
    return 0;
  }

  if (args[0] === 'compile' && args.length === 1) return writeUsageError(compileUsage());
  if (args[0] === 'build' || args[0] === 'compile' || args[0] === 'export' || args[0] === 'mcp') {
    throw new Error(`kovo ${args[0]} is asynchronous; call mainAsync() instead.`);
  }

  if (args[0] === 'check') {
    const parsed = parseCheckArgs(args.slice(1));
    if (!parsed.ok) return writeCheckUsageError(parsed);
    const { family, inputPath } = parsed;
    if (family === 'sources-sinks') {
      if (inputPath) {
        const input = runGraphCommand(inputPath, () => ({ exitCode: 0, output: '' }));
        if (input.exitCode !== 0) return writeCommandResult(input);
      }
      const driftScan = scanSourceSinkDrift();
      writeSourcesSinksArtifact(process.cwd(), { driftScan });
      return writeCommandResult(sourcesSinksCheckResult(outputVersion, { driftScan }));
    }
    return writeCommandResult(runGraphCommand(inputPath, (input) => kovoCheck(input, { family })));
  }

  if (args[0] === 'add') {
    const parsed = parseAddArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(runAddCommand(parsed.options));
  }

  if (args[0] === 'audit') {
    const parsed = parseAuditArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(
      runGraphCommand(parsed.inputPath, (input) =>
        kovoAudit(input, { failOnFindings: parsed.failOnFindings }),
      ),
    );
  }

  if (args[0] === 'explain') {
    const parsed = parseExplainArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    if ('sourcesSinks' in parsed.options) writeSourcesSinksArtifact();
    return writeCommandResult(
      runGraphCommand(parsed.inputPath, (input) => kovoExplain(input, parsed.options)),
    );
  }

  process.stderr.write(
    `kovo: unknown command ${stableValue(args[0])}. expected add, build, compile, explain, check, audit, export, or mcp.\n`,
  );
  return 1;
}

/** @internal Async argv dispatcher (export/mcp) for the `kovo` bin; not a public API. */
export async function mainAsync(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (args[0] === 'mcp') return runMcpCommand(args.slice(1));
  if (args[0] === 'build') {
    const parsed = parseBuildArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runBuildCommand(parsed.options));
  }
  if (args[0] === 'compile') {
    const parsed = parseCompileArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runCompileCommand(parsed.options));
  }
  if (args[0] !== 'export') return main(args);

  const parsed = parseExportArgs(args.slice(1));
  if (!parsed.ok) return writeUsageError(parsed.message);
  return writeCommandResult(await runExportCommand(parsed.options));
}

/**
 * Run the same command dispatcher as the `kovo` executable and return its exit
 * code. Generated app maintenance scripts use this when they need the command
 * facade in-process, for example to run `kovo export --vite` after loading the
 * CLI through Vite SSR.
 */
export async function runKovoCommand(args: readonly string[]): Promise<number> {
  return await mainAsync(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void mainAsync().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
