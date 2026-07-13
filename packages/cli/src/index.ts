#!/usr/bin/env node
export type { DiagnosticCode } from '@kovojs/core';
import { pathToFileURL } from 'node:url';

import {
  parseBuildArgs,
  parseExportArgs,
  runBuildCommand,
  runExportCommand,
} from './commands/build-export.js';
import { parseDbArgs, runDbCommand } from './commands/db.js';
import { parseDevArgs, runDevCommand } from './commands/dev.js';
import {
  compileUsage,
  parseAddArgs,
  parseCompileArgs,
  runAddCommand,
  runCompileCommand,
} from './commands/compile.js';
import {
  formatNoArgsMessage,
  formatUnknownCommandMessage,
  isAsyncCommand,
  resolveCommand,
  UPDATE_DOCS_USAGE,
  type KovoAsyncCommandName,
  type KovoSyncCommandName,
} from './commands-manifest.js';
import { runUpdateDocsCommand } from './commands/update-docs.js';
import {
  captureKovoCommandSecurityDisposition,
  type KovoCommandSecurityDisposition,
} from './commands/security-disposition.js';
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
import { writeCommandResult, writeUsageError } from './shared.js';
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
  runUpdateDocsCommand,
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
  KovoAccessExplainOptions,
  KovoCheckFamily,
  KovoCheckInput,
  KovoDocumentExplainOptions,
  KovoEndpointExplainOptions,
  KovoExplainInput,
  KovoExplainOptions,
  KovoRevealedExplainOptions,
  KovoSourcesSinksExplainOptions,
  KovoTasksExplainOptions,
  KovoTargetExplainOptions,
  KovoUnguardedExplainOptions,
  KovoUnscopedExplainOptions,
} from './graph-output.js';
export type { KovoCheckResult } from './shared.js';

type SyncCommandHandler = (
  args: readonly string[],
  security: KovoCommandSecurityDisposition,
) => number;
type AsyncCommandHandler = (
  args: readonly string[],
  security: KovoCommandSecurityDisposition,
) => Promise<number>;

const SYNC_COMMAND_HANDLERS: Record<KovoSyncCommandName, SyncCommandHandler> = {
  audit(args, security) {
    const parsed = parseAuditArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(
      runGraphCommand(
        parsed.inputPath,
        (input) => kovoAudit(input, { failOnFindings: parsed.failOnFindings }),
        security.invocationCwd,
      ),
    );
  },
  check(args, security) {
    const parsed = parseCheckArgs(args);
    if (!parsed.ok) return writeCheckUsageError(parsed);
    const { family, inputPath } = parsed;
    if (family === 'sources-sinks') {
      if (inputPath) {
        const input = runGraphCommand(
          inputPath,
          () => ({ exitCode: 0, output: '' }),
          security.invocationCwd,
        );
        if (input.exitCode !== 0) return writeCommandResult(input);
      }
      const driftScan = scanSourceSinkDrift(security.invocationCwd);
      writeSourcesSinksArtifact(security.invocationCwd, { driftScan });
      return writeCommandResult(sourcesSinksCheckResult(outputVersion, { driftScan }));
    }
    return writeCommandResult(
      runGraphCommand(
        inputPath,
        (input) =>
          kovoCheck(input, {
            family,
            paranoidStaticAdvisory: security.paranoidStaticAdvisory,
          }),
        security.invocationCwd,
      ),
    );
  },
  explain(args, security) {
    const parsed = parseExplainArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message);
    if ('sourcesSinks' in parsed.options) writeSourcesSinksArtifact(security.invocationCwd);
    return writeCommandResult(
      runGraphCommand(
        parsed.inputPath,
        (input) => kovoExplain(input, parsed.options),
        security.invocationCwd,
      ),
    );
  },
};

const ASYNC_COMMAND_HANDLERS: Record<KovoAsyncCommandName, AsyncCommandHandler> = {
  async add(args) {
    const parsed = parseAddArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runAddCommand(parsed.options));
  },
  async build(args, security) {
    const parsed = parseBuildArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runBuildCommand(parsed.options, security));
  },
  async db(args, security) {
    const parsed = parseDbArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runDbCommand(parsed.options, security));
  },
  async dev(args, security) {
    const parsed = parseDevArgs(args, security.invocationCwd);
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runDevCommand(parsed.options, security));
  },
  async compile(args) {
    const parsed = parseCompileArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runCompileCommand(parsed.options));
  },
  async export(args, security) {
    const parsed = parseExportArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message);
    return writeCommandResult(await runExportCommand(parsed.options, security));
  },
  async mcp(args) {
    return runMcpCommand(args);
  },
  async 'update-docs'(args) {
    if (args.length > 0) return writeUsageError(UPDATE_DOCS_USAGE);
    return writeCommandResult(await runUpdateDocsCommand());
  },
};

/** @internal Dispatcher keys kept exportable for registry drift tests only. */
export const CLI_COMMAND_DISPATCHER_NAMES = {
  async: Object.keys(ASYNC_COMMAND_HANDLERS).sort(),
  sync: Object.keys(SYNC_COMMAND_HANDLERS).sort(),
} as const;

/** @internal Synchronous argv dispatcher for the `kovo` bin; not a public API. */
export function main(
  args: readonly string[] = process.argv.slice(2),
  security: KovoCommandSecurityDisposition = captureKovoCommandSecurityDisposition(),
): number {
  if (args.length === 0) {
    process.stdout.write(formatNoArgsMessage());
    return 0;
  }

  const command = resolveCommand(args[0]);
  if (command === undefined) {
    process.stderr.write(formatUnknownCommandMessage(args[0] ?? ''));
    return 1;
  }

  if (command.name === 'compile' && args.length === 1) return writeUsageError(compileUsage());
  if (isAsyncCommand(command)) {
    throw new Error(`kovo ${command.name} is asynchronous; call mainAsync() instead.`);
  }

  return SYNC_COMMAND_HANDLERS[command.name](args.slice(1), security);
}

/** @internal Async argv dispatcher (export/mcp) for the `kovo` bin; not a public API. */
export async function mainAsync(
  args: readonly string[] = process.argv.slice(2),
  security: KovoCommandSecurityDisposition = captureKovoCommandSecurityDisposition(),
): Promise<number> {
  const command = resolveCommand(args[0]);
  if (!command || !isAsyncCommand(command)) return main(args, security);
  return ASYNC_COMMAND_HANDLERS[command.name](args.slice(1), security);
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
