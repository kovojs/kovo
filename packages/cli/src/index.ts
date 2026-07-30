#!/usr/bin/env node
export type { DiagnosticCode } from '@kovojs/core/diagnostics';
import { lockCompilerSecurityRealm } from '@kovojs/compiler/internal/security-bootstrap';
import { pathToFileURL } from 'node:url';

import {
  parseBuildArgs,
  parseExportArgs,
  runBuildCommand,
  runExportCommand,
  runSourceCheckCommand,
} from './commands/build-export.js';
import { runKovoSourceCheckWatchCommand } from './commands/source-check-watch.js';
import { parseDbArgs, runDbCommand } from './commands/db.js';
import { parseAttestArgs, runAttestCommand } from './commands/attest.js';
import { parseIncidentArgs, runIncidentScopeCommand } from './commands/incident-scope.js';
import { parseAdvisoryArgs, runAdvisoryCheck } from './commands/advisories.js';
import { parseFixArgs, runFixCommand } from './commands/fix.js';
import { parseDevArgs, runDevCommand } from './commands/dev.js';
import { parseDoctorArgs, runDoctorCommand } from './commands/doctor.js';
import {
  parseAddArgs,
  parseCompileArgs,
  runAddCommand,
  runCompileCommand,
} from './commands/compile.js';
import {
  commandRequestToArgv,
  formatCliVersion,
  formatCommandHelp,
  formatMetaCommandHelp,
  formatRootHelp,
  formatUnknownCommandMessage,
  isAsyncCommand,
  isAsyncKovoCommandInvocation,
  KOVO_CLI_VERSION,
  parseKovoCommandInvocation,
  parseKovoMetaInvocation,
  renderShellCompletion,
  resolveKovoBinInvocationPosture,
  resolveCommand,
  type KovoAsyncCommandName,
  type KovoSemanticCommandRequest,
  type KovoSyncCommandName,
} from './commands-manifest.js';
import { runUpdateDocsCommand } from './commands/update-docs.js';
import { runDocsCommand } from './commands/docs.js';
import { parseTestArgs, runTestCommand } from './commands/test.js';
import { runLifecyclePolicyCheck } from './commands/lifecycle-policy.js';
import {
  captureKovoCommandSecurityDisposition,
  type KovoCommandSecurityDisposition,
} from './commands/security-disposition.js';
import { snapshotKovoSemanticCommandRequest } from './semantic-command-request-snapshot.js';
import {
  compileComponentV1,
  createKovoMcpServer,
  runMcpCommand,
  runMcpStdioServer,
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
  runRequiredSelectedGraphCommand,
  runSelectedGraphCommand,
  writeCheckUsageError,
} from './graph-output.js';
import {
  writeCommandResult,
  writeFormattedCommandResult,
  writeStructuredCommandResult,
  writeUsageError,
} from './shared.js';
import { runDeploymentEnvironmentCheck } from './deployment-environment-contract.js';
import {
  scanSourceSinkDrift,
  sourcesSinksCheckResult,
  writeSourcesSinksArtifact,
} from './sources-sinks.js';

export {
  commandRequestToArgv,
  compileComponentV1,
  createKovoMcpServer,
  formatCommandHelp,
  formatRootHelp,
  kovoAudit,
  kovoCheck,
  kovoExplain,
  KOVO_CLI_VERSION,
  renderShellCompletion,
  resolveKovoBinInvocationPosture,
  runMcpStdioServer,
  runUpdateDocsCommand,
};

export type {
  CompileComponentV1Diagnostic,
  CompileComponentV1Input,
  CompileComponentV1Result,
  KovoMcpToolName,
} from './commands/mcp.js';
export type { KovoCompletionShell, KovoSemanticCommandRequest } from './commands-manifest.js';
export type {
  ExplainKind,
  KovoAuditOptions,
  KovoAccessExplainOptions,
  KovoAgentExplainOptions,
  KovoAuthLifecycleExplainOptions,
  KovoAuthorizationExplainOptions,
  KovoCheckFamily,
  KovoCheckInput,
  KovoDocumentExplainOptions,
  KovoEndpointExplainOptions,
  KovoExplainInput,
  KovoExplainOptions,
  KovoGrantExplainOptions,
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
    if (!parsed.ok) return writeUsageError(parsed.message, 'audit');
    return writeCommandResult(
      runGraphCommand(
        parsed.inputPath,
        (input) => kovoAudit(input, { failOnFindings: parsed.failOnFindings }),
        security.invocationCwd,
      ),
      'proof',
      'audit',
    );
  },
  check(args, security) {
    const parsed = parseCheckArgs(args);
    if (!parsed.ok) return writeCheckUsageError(parsed);
    if ('source' in parsed) {
      return writeUsageError(
        'kovo: source-backed check requires asynchronous command dispatch.\n',
        'check',
      );
    }
    if ('environment' in parsed) {
      return writeFormattedCommandResult(
        runDeploymentEnvironmentCheck(
          parsed.inputPath,
          security.invocationCwd,
          security.invocationEnv,
        ),
        parsed.format,
        'proof',
        'check',
      );
    }
    if ('lifecycle' in parsed) {
      return writeFormattedCommandResult(
        runLifecyclePolicyCheck(security.invocationCwd),
        parsed.format,
        'config',
        'check',
      );
    }
    const { artifact, family, inputPath } = parsed;
    if (family === 'sources-sinks') {
      if (inputPath) {
        const input = runGraphCommand(
          inputPath,
          () => ({ exitCode: 0, output: '' }),
          security.invocationCwd,
        );
        if (input.exitCode !== 0) {
          return writeFormattedCommandResult(input, parsed.format, 'proof', 'check');
        }
      }
      const driftScan = scanSourceSinkDrift(security.invocationCwd);
      return writeFormattedCommandResult(
        sourcesSinksCheckResult(outputVersion, { driftScan }),
        parsed.format,
        'proof',
        'check',
      );
    }
    return writeFormattedCommandResult(
      runRequiredSelectedGraphCommand(
        inputPath,
        artifact,
        (input) =>
          kovoCheck(input, {
            family,
            paranoidStaticAdvisory: security.paranoidStaticAdvisory,
          }),
        security.invocationCwd,
        family,
      ),
      parsed.format,
      'proof',
      'check',
    );
  },
  explain(args, security) {
    const parsed = parseExplainArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'explain');
    if (parsed.options.view === 'auth-lifecycle' || parsed.options.view === 'model-boundaries') {
      return writeFormattedCommandResult(
        kovoExplain({}, parsed.options),
        parsed.format,
        'proof',
        'explain',
      );
    }
    return writeFormattedCommandResult(
      runSelectedGraphCommand(
        parsed.inputPath,
        parsed.artifact,
        (input) => kovoExplain(input, parsed.options),
        security.invocationCwd,
      ),
      parsed.format,
      'proof',
      'explain',
    );
  },
  incident(args, security) {
    const parsed = parseIncidentArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'incident');
    return writeCommandResult(
      runIncidentScopeCommand(parsed.options, security.invocationCwd, security.invocationEnv),
      'proof',
      'incident',
    );
  },
};

const ASYNC_COMMAND_HANDLERS: Record<KovoAsyncCommandName, AsyncCommandHandler> = {
  async add(args) {
    const parsed = parseAddArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'add');
    return writeCommandResult(await runAddCommand(parsed.options), 'build', 'add');
  },
  async build(args, security) {
    const parsed = parseBuildArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'build');
    return writeFormattedCommandResult(
      await runBuildCommand(parsed.options, security),
      parsed.format,
      'build',
      'build',
    );
  },
  async db(args, security) {
    const parsed = parseDbArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'db');
    return writeCommandResult(await runDbCommand(parsed.options, security), 'config', 'db');
  },
  async dev(args, security) {
    const parsed = parseDevArgs(args, security.invocationCwd);
    if (!parsed.ok) return writeUsageError(parsed.message, 'dev');
    return writeCommandResult(await runDevCommand(parsed.options, security), 'runtime', 'dev');
  },
  async docs(args, security) {
    const parsed = parseKovoCommandInvocation('docs', args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'docs');
    return writeCommandResult(
      await runDocsCommand({
        cwd: security.invocationCwd,
        format: parsed.value.options.format,
        limit: parsed.value.options.limit,
        task: parsed.value.arguments.task,
      }),
      'config',
      'docs',
    );
  },
  async doctor(args, security) {
    const parsed = parseDoctorArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'doctor');
    return writeFormattedCommandResult(
      await runDoctorCommand(parsed.options, security),
      parsed.options.format,
      'config',
      'doctor',
    );
  },
  async compile(args) {
    const parsed = parseCompileArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'compile');
    return writeCommandResult(await runCompileCommand(parsed.options), 'build', 'compile');
  },
  async export(args, security) {
    const parsed = parseExportArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'export');
    return writeCommandResult(await runExportCommand(parsed.options, security), 'build', 'export');
  },
  async fix(args, security) {
    const parsed = parseFixArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'fix');
    const result = await runFixCommand(parsed.options, security.invocationCwd);
    return 'apiV1' in parsed.options
      ? writeStructuredCommandResult(result, 'build', 'fix')
      : writeCommandResult(result, 'build', 'fix');
  },
  async mcp(args, security) {
    return runMcpCommand(args, security.invocationCwd);
  },
  async test(args, security) {
    const parsed = parseTestArgs(args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'test');
    return writeCommandResult(await runTestCommand(parsed.options, security), 'runtime', 'test');
  },
  async 'update-docs'(args) {
    const parsed = parseKovoCommandInvocation('update-docs', args);
    if (!parsed.ok) return writeUsageError(parsed.message, 'update-docs');
    return writeCommandResult(await runUpdateDocsCommand(), 'config', 'update-docs');
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
  const metaResult = runMetaInvocation(args);
  if (metaResult !== undefined) return metaResult;

  const command = resolveCommand(args[0]);
  if (command === undefined) {
    return writeUsageError(formatUnknownCommandMessage(args[0] ?? ''));
  }

  const parsed = parseKovoCommandInvocation(command.name, args.slice(1));
  if (!parsed.ok) return writeUsageError(parsed.message, command.name);
  if (isAsyncKovoCommandInvocation(parsed.value)) {
    if (!isAsyncCommand(command)) {
      return writeUsageError(
        `kovo: ${command.name} ${parsed.value.form} is asynchronous; call mainAsync() instead.\n`,
        command.name,
      );
    }
    throw new Error(`kovo ${command.name} is asynchronous; call mainAsync() instead.`);
  }
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
  const metaResult = runMetaInvocation(args);
  if (metaResult !== undefined) return metaResult;

  const command = resolveCommand(args[0]);
  if (command === undefined) {
    return writeUsageError(formatUnknownCommandMessage(args[0] ?? ''));
  }
  const parsedInvocation = parseKovoCommandInvocation(command.name, args.slice(1));
  if (!parsedInvocation.ok) return writeUsageError(parsedInvocation.message, command.name);
  const invocation = parsedInvocation.value;

  if (invocation.command === 'explain' && invocation.form === 'attest') {
    const parsed = parseAttestArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message, 'explain');
    return writeFormattedCommandResult(
      await runAttestCommand(parsed.options, security.invocationCwd),
      invocation.options.format,
      'proof',
      'explain',
    );
  }
  if (invocation.command === 'check' && invocation.form === 'advisories') {
    const parsed = parseAdvisoryArgs(args.slice(1));
    if (!parsed.ok) return writeUsageError(parsed.message, 'check');
    return writeFormattedCommandResult(
      await runAdvisoryCheck(parsed.options, security.invocationCwd),
      invocation.options.format,
      'proof',
      'check',
      'unknown',
    );
  }
  if (
    invocation.command === 'check' &&
    (invocation.form === 'source-default' ||
      invocation.form === 'source' ||
      invocation.form === 'source-watch')
  ) {
    const parsed = parseCheckArgs(args.slice(1));
    if (!parsed.ok || !('source' in parsed)) {
      return writeUsageError(
        parsed.ok
          ? 'kovo: source-backed check selected an incompatible command form.\n'
          : parsed.message,
        'check',
      );
    }
    if (invocation.form === 'source-watch') {
      return runKovoSourceCheckWatchCommand(
        {
          appModulePath: parsed.appModulePath,
          cache: parsed.cache,
        },
        security,
      );
    }
    return writeFormattedCommandResult(
      await runSourceCheckCommand(
        {
          appModulePath: parsed.appModulePath,
          cache: parsed.cache,
        },
        security,
      ),
      parsed.format,
      'proof',
      'check',
    );
  }
  if (invocation.command === 'check' && invocation.form === 'endpoint-posture-suite') {
    const testResult = await runTestCommand(
      {
        coverage: false,
        files: ['src/endpoint-posture.test.ts'],
        passWithNoTests: false,
        update: false,
      },
      security,
    );
    if (testResult.exitCode !== 0) {
      return writeCommandResult(testResult, 'runtime', 'check');
    }
    return writeFormattedCommandResult(
      runRequiredSelectedGraphCommand(
        '.kovo/endpoint-posture.json',
        false,
        (input) =>
          kovoCheck(input, {
            family: 'endpoint-posture',
            paranoidStaticAdvisory: security.paranoidStaticAdvisory,
          }),
        security.invocationCwd,
        'endpoint-posture',
      ),
      invocation.options.format,
      'proof',
      'check',
    );
  }
  if (!isAsyncCommand(command)) {
    if (invocation.command === 'check' && invocation.form === 'graph') {
      const parsed = parseCheckArgs(args.slice(1));
      if (!parsed.ok || !('family' in parsed) || parsed.family !== 'sources-sinks') {
        return main(args, security);
      }
      const driftScan = scanSourceSinkDrift(security.invocationCwd);
      await writeSourcesSinksArtifact(security.invocationCwd, { driftScan });
    } else if (invocation.command === 'explain' && invocation.form === 'sources-sinks') {
      await writeSourcesSinksArtifact(security.invocationCwd);
    }
    return main(args, security);
  }
  return ASYNC_COMMAND_HANDLERS[command.name](args.slice(1), security);
}

/**
 * Run the same command dispatcher as the `kovo` executable and return its exit
 * code from a semantic command request. Programmatic callers name command
 * concepts (`out`, `preset`), while only the bin adapter handles argv spellings
 * (`--out`, `--preset`). The call writes the command's normal stdout/stderr and
 * resolves after one-shot output is complete. Long-lived `dev` and `mcp`
 * processes remain executable-only until Kovo exposes an explicit
 * abort/disposal contract.
 *
 * Commands that evaluate authored modules establish the same irreversible
 * compiler-realm lock as the executable before dispatch (SPEC.md §5.2 and §6.6).
 */
export async function runKovoCommand(
  request: KovoSemanticCommandRequest,
): Promise<KovoCommandExitCode> {
  // Snapshot caller data without invoking accessors or Proxy traps. Only this inert copy is read
  // while choosing command posture, so a semantic request cannot run authored code in the
  // bootstrap-before-lock gap (SPEC §6.6 rule 6).
  const snapshot = snapshotKovoSemanticCommandRequest(request);
  const command = resolveCommand(snapshot.command);
  if (command === undefined) {
    throw new TypeError(`Unknown Kovo semantic command ${JSON.stringify(snapshot.command)}.`);
  }
  if (command.processLifecycle !== 'one-shot') {
    throw new TypeError(
      `Kovo ${command.name} is long-lived and cannot run through runKovoCommand(). Use the kovo executable.`,
    );
  }
  if (command.compilerRealm === 'locked-before-dispatch') {
    lockCompilerSecurityRealm();
  }
  const security = captureKovoCommandSecurityDisposition();
  const args = commandRequestToArgv(snapshot);
  const exitCode = await mainAsync(args, security);
  if (exitCode !== 0 && exitCode !== 1 && exitCode !== 2) {
    throw new TypeError(`Kovo command returned unsupported exit code ${String(exitCode)}.`);
  }
  return exitCode;
}

/** Stable process exit codes returned by {@link runKovoCommand}. */
export type KovoCommandExitCode = 0 | 1 | 2;

function runMetaInvocation(args: readonly string[]): 0 | 2 | undefined {
  const parsed = parseKovoMetaInvocation(args);
  if (!parsed.ok) return writeUsageError(parsed.message);
  if (!parsed.handled) return undefined;
  switch (parsed.value.kind) {
    case 'root-help':
      return writeInformational(formatRootHelp());
    case 'command-help':
      return writeInformational(formatCommandHelp(parsed.value.command));
    case 'meta-help':
      return writeInformational(formatMetaCommandHelp(parsed.value.command));
    case 'completion':
      return writeInformational(renderShellCompletion(parsed.value.shell));
    case 'version':
      return writeInformational(formatCliVersion());
  }
}

function writeInformational(output: string): 0 {
  process.stdout.write(output);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void mainAsync().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
