import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import {
  createFrameworkFileSystemBoundary,
  type FrameworkFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';

import {
  projectQualityDiagnostic,
  type KovoDiagnosticRecord,
  type KovoDiagnosticSourceAnchor,
} from '../diagnostic.js';
import type { CliCommandResult } from '../shared.js';
import { resolveVitePlusQualityBin, type VitePlusQualityBin } from './vite-plus-bin.js';

const MAX_QUALITY_OUTPUT_BYTES = 16 * 1024 * 1024;
const PROJECT_QUALITY_THREADS = 1;
const PROJECT_QUALITY_NODE_MODULE_IGNORES = [
  '--ignore-pattern=node_modules/**',
  '--ignore-pattern=**/node_modules/**',
] as const;
const QUALITY_CONFIG_SCHEMA = 'kovo-project-quality-config/v1';
const QUALITY_CONFIG_PROBE = `
import { pathToFileURL } from 'node:url';
const modulePath = process.argv[1];
const imported = await import(pathToFileURL(modulePath).href);
const vitePlus = imported.default ?? imported;
if (typeof vitePlus.loadConfigFromFile !== 'function') {
  throw new TypeError('vite-plus config module has no loadConfigFromFile export');
}
const loaded = await vitePlus.loadConfigFromFile(
  { command: 'build', mode: 'production' },
  undefined,
  process.cwd(),
  'silent',
);
const config = loaded?.config ?? {};
const seen = new Set();
function jsonValue(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(label + ' is cyclic');
    seen.add(value);
    const result = value.map((item, index) => jsonValue(item, label + '[' + String(index) + ']'));
    seen.delete(value);
    return result;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(label + ' is not JSON-safe');
  }
  if (seen.has(value)) throw new TypeError(label + ' is cyclic');
  seen.add(value);
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = jsonValue(value[key], label + '.' + key);
  seen.delete(value);
  return result;
}
process.stdout.write(JSON.stringify({
  fmt: jsonValue(config.fmt ?? {}, 'fmt'),
  lint: jsonValue(config.lint ?? {}, 'lint'),
  schema: '${QUALITY_CONFIG_SCHEMA}',
}));
`;

/** @internal Boot-captured process seam for exact orchestration tests. */
export const projectQualityCommandShell = { execFile };

interface CommandExecution {
  readonly error?: unknown;
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

interface ProjectQualityConfig {
  readonly fmt: Record<string, unknown>;
  readonly lint: Record<string, unknown>;
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
  let formatter: VitePlusQualityBin;
  let fileSystem: FrameworkFileSystemBoundary;
  let linter: VitePlusQualityBin;
  try {
    formatter = resolveVitePlusQualityBin('oxfmt');
    linter = resolveVitePlusQualityBin('oxlint');
    fileSystem = await createFrameworkFileSystemBoundary(root);
  } catch (error) {
    return runnerFailure(protocol, error);
  }

  // Both tools still inspect the whole project. Load the declarative lint/fmt fields without
  // executing unrelated Vite plugin hooks, then keep the exact pinned formatter/linter process
  // trees disjoint and single-threaded. This preserves Vite Plus's root/config/ignore semantics
  // without retaining its unified build/test heap or re-running Kovo compiler analysis around the
  // packed catalog.
  const config = await resolveProjectQualityConfig(formatter.configModule, root, invocationEnv);
  if ('error' in config) return runnerFailure(protocol, config.error);
  const format = await executeQualityTool(
    formatter,
    config.fmt,
    'oxfmtrc',
    ['--list-different', `--threads=${String(PROJECT_QUALITY_THREADS)}`],
    root,
    invocationEnv,
    fileSystem,
  );
  if (format.error !== undefined) return runnerFailure(protocol, format.error);
  const lint = await executeQualityTool(
    linter,
    config.lint,
    'oxlintrc',
    [
      ...PROJECT_QUALITY_NODE_MODULE_IGNORES,
      '--format=json',
      `--threads=${String(PROJECT_QUALITY_THREADS)}`,
    ],
    root,
    invocationEnv,
    fileSystem,
  );
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

async function resolveProjectQualityConfig(
  configModule: string,
  root: string,
  invocationEnv: NodeJS.ProcessEnv,
): Promise<ProjectQualityConfig | { readonly error: unknown }> {
  const configProbe = await executeNode(
    ['--input-type=module', '--eval', QUALITY_CONFIG_PROBE, configModule],
    root,
    invocationEnv,
  );
  if (configProbe.error !== undefined || configProbe.status !== 0) {
    return {
      error:
        configProbe.error === undefined
          ? new TypeError(
              `formatter config resolver failed: ${singleLine(configProbe.stderr) || `exit ${String(configProbe.status)}`}`,
            )
          : configProbe.error,
    };
  }

  try {
    const report = JSON.parse(configProbe.stdout) as unknown;
    if (
      !isRecord(report) ||
      report.schema !== QUALITY_CONFIG_SCHEMA ||
      !isRecord(report.fmt) ||
      !isRecord(report.lint)
    ) {
      throw new TypeError('formatter config resolver emitted an invalid report');
    }
    return { fmt: report.fmt, lint: report.lint };
  } catch (error) {
    return {
      error: new TypeError(`formatter config resolver report is invalid: ${singleLine(error)}`),
    };
  }
}

async function executeQualityTool(
  tool: VitePlusQualityBin,
  config: Record<string, unknown>,
  configKind: 'oxfmtrc' | 'oxlintrc',
  args: readonly string[],
  root: string,
  invocationEnv: NodeJS.ProcessEnv,
  fileSystem: FrameworkFileSystemBoundary,
): Promise<CommandExecution> {
  const configName = `.kovo-project-quality-${randomUUID()}.${configKind}.json`;
  let execution: CommandExecution;
  try {
    const configPath = fileSystem.confinedPath(configName);
    if (configPath === undefined) {
      throw new TypeError('formatter config path escaped the enrolled project root');
    }
    const ignorePatterns = config.ignorePatterns;
    const enrolledIgnorePatterns =
      ignorePatterns === undefined
        ? [configName]
        : Array.isArray(ignorePatterns) &&
            ignorePatterns.every((value) => typeof value === 'string')
          ? [...ignorePatterns, configName]
          : undefined;
    if (enrolledIgnorePatterns === undefined) {
      throw new TypeError('formatter ignorePatterns config is invalid');
    }
    await fileSystem.writeFile(
      configName,
      `${JSON.stringify({ ...config, ignorePatterns: enrolledIgnorePatterns })}\n`,
    );
    execution = await execute(tool.executable, ['--config', configPath, ...args], root, {
      ...invocationEnv,
      ...tool.environment,
      JS_RUNTIME_NAME: process.release.name,
      JS_RUNTIME_VERSION: process.versions.node,
      NODE_PACKAGE_MANAGER: 'vite-plus',
    });
  } catch (error) {
    execution = { error, status: null, stderr: '', stdout: '' };
  }
  try {
    await fileSystem.deleteFile(configName);
  } catch (error) {
    return { error, status: null, stderr: '', stdout: '' };
  }
  return execution;
}

async function execute(
  executable: string,
  args: readonly string[],
  root: string,
  invocationEnv: NodeJS.ProcessEnv,
): Promise<CommandExecution> {
  return executeNode([executable, ...args], root, invocationEnv);
}

async function executeNode(
  args: readonly string[],
  root: string,
  invocationEnv: NodeJS.ProcessEnv,
): Promise<CommandExecution> {
  return new Promise((resolveExecution) => {
    projectQualityCommandShell.execFile(
      process.execPath,
      args,
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
  let report: unknown;
  try {
    report = JSON.parse(execution.stdout) as unknown;
  } catch (error) {
    throw new TypeError(
      `linter failed without a valid JSON report: ${singleLine(error)} ${singleLine(execution.stderr)}`,
    );
  }
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
