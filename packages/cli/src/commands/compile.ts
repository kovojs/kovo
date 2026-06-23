import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  CompileComponentOptions,
  CompileRouteModuleOptions,
  RouteComponentImportRewrite,
} from '@kovojs/compiler';
import type { DiagnosticCode } from '@kovojs/core';
import { isDiagnosticCode } from '@kovojs/core/internal/diagnostics';
import type { KovoApp, StaticExportCompileDiagnostic, StylesheetAsset } from '@kovojs/server';
import type { KovoConfig, KovoPreset, PresetContext, PresetDiagnostic } from '@kovojs/server/build';
import type { KovoNeutralBuild } from '@kovojs/server/internal/build';

import {
  availableAddComponents,
  isAddComponentName,
  vendoredUiComponents,
  type AddComponentName,
} from '../add-catalog.js';
import {
  ADD_USAGE,
  BUILD_USAGE,
  COMPILE_USAGE,
  COMPILE_USAGE_LINE,
  EXPORT_USAGE,
} from '../commands-manifest.js';
import { compileCachedComponentModule } from './mcp.js';
import {
  addOutputVersion,
  byteLength,
  compileCommandOutputVersion,
  type CliCommandResult,
  type KovoCheckResult,
  stableText,
  stableValue,
} from '../shared.js';

const requireFromCli = createRequire(import.meta.url);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface KovoExportOptions {
  appModulePath: string;
  assetBase?: string;
  distDir?: string;
  manifestFile?: string;
  onNonExportable?: 'error' | 'skip';
  origin?: string;
  outDir: string;
  root?: string;
  stylesheetEnv?: string;
  vite?: boolean;
}

type ExportArgParseResult =
  | { ok: true; options: KovoExportOptions }
  | { message: string; ok: false };

type KovoBuildPresetName = 'cloudflare' | 'node' | 'vercel';

interface KovoBuildOptions {
  appModulePath: string;
  cache: boolean;
  outDir: string;
  preset?: KovoBuildPresetName;
}

type BuildArgParseResult = { ok: true; options: KovoBuildOptions } | { message: string; ok: false };

interface LoadedKovoBuildConfig {
  config?: KovoConfig;
  path?: string;
}

interface SelectedKovoBuildPreset {
  name: KovoBuildPresetName;
  preset?: KovoPreset;
}

interface AddComponentOptions {
  components: readonly AddComponentName[];
  outDir: string;
}

type AddArgParseResult =
  | { ok: true; options: AddComponentOptions }
  | { message: string; ok: false };

type CompileTarget =
  | 'component'
  | 'drizzle-static'
  | 'drizzle-optimistic'
  | 'graph'
  | 'mutation-inputs'
  | 'package-css'
  | 'route';

interface CompileBaseOptions {
  check: boolean;
  outPath: string;
  target: CompileTarget;
}

interface CompileComponentCommandOptions extends CompileBaseOptions {
  allowedDiagnosticCodes: readonly DiagnosticCode[];
  cache: boolean;
  emitClientFiles: boolean;
  factsOutPath?: string;
  fixpoint: boolean;
  fileName?: string;
  queryShapeFactsPath?: string;
  registryFactsPath?: string;
  renderEquivalence: boolean;
  sourcePath: string;
  target: 'component';
}

interface CompileRouteCommandOptions extends CompileBaseOptions {
  artifactFileName?: string;
  componentImportRewrites: CompileRouteModuleOptions['componentImportRewrites'];
  factsOutPath?: string;
  fileName?: string;
  sourcePath: string;
  target: 'route';
}

interface CompileGraphCommandOptions extends CompileBaseOptions {
  inputPath: string;
  target: 'graph';
}

interface CompileMutationInputsCommandOptions extends CompileBaseOptions {
  fileName?: string;
  sourcePath: string;
  target: 'mutation-inputs';
}

interface CompileDrizzleOptimisticCommandOptions extends CompileBaseOptions {
  factsOutPath?: string;
  inputPath: string;
  target: 'drizzle-optimistic';
}

interface CompileDrizzleStaticCommandOptions extends CompileBaseOptions {
  inputPath: string;
  target: 'drizzle-static';
}

interface CompilePackageCssCommandOptions extends CompileBaseOptions {
  entryPath?: string;
  packageName: string;
  target: 'package-css';
}

type CompileCommandOptions =
  | CompileComponentCommandOptions
  | CompileDrizzleStaticCommandOptions
  | CompileDrizzleOptimisticCommandOptions
  | CompileGraphCommandOptions
  | CompileMutationInputsCommandOptions
  | CompilePackageCssCommandOptions
  | CompileRouteCommandOptions;

type CompileArgParseResult =
  | { ok: true; options: CompileCommandOptions }
  | { message: string; ok: false };

export function parseAddArgs(args: readonly string[]): AddArgParseResult {
  let outDir = 'src/components/ui';
  const components: AddComponentName[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      return { message: addUsage(), ok: false };
    }

    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: add --out requires a directory.\n', ok: false };
      outDir = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
      if (!outDir) return { message: 'kovo: add --out requires a directory.\n', ok: false };
      continue;
    }

    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown add option ${stableValue(arg)}.\n${addUsage()}`,
        ok: false,
      };
    }

    if (!isAddComponentName(arg)) {
      return {
        message: `kovo: unknown component ${stableValue(arg)}. available: ${availableAddComponents()}.`,
        ok: false,
      };
    }

    if (!components.includes(arg)) components.push(arg);
  }

  if (components.length === 0) {
    return { message: `kovo: add requires at least one component.\n${addUsage()}`, ok: false };
  }

  return { ok: true, options: { components, outDir } };
}

export function addUsage(): string {
  return [ADD_USAGE, `available: ${availableAddComponents()}`, ''].join('\n');
}

export function runAddCommand(options: AddComponentOptions): CliCommandResult {
  const lines = [addOutputVersion];
  mkdirSync(options.outDir, { recursive: true });

  for (const component of options.components) {
    const entry = vendoredUiComponents[component];
    if (!entry) {
      return {
        error: `${addOutputVersion}\nERROR ${component} reason=unknown-component`,
        exitCode: 1,
      };
    }
    const target = resolve(options.outDir, entry.fileName);

    // SPEC.md §5.2 requires vendored UI to land as TSX app source, not lowered IR.
    if (existsSync(target)) {
      const current = readFileSync(target, 'utf8');
      if (current === entry.source) {
        lines.push(`SKIP ${component} path=${JSON.stringify(target)} reason=already-current`);
        continue;
      }

      return {
        error: `${addOutputVersion}\nERROR ${component} path=${JSON.stringify(target)} reason=would-overwrite`,
        exitCode: 1,
      };
    }

    writeFileSync(target, entry.source, 'utf8');
    lines.push(`ADD ${component} path=${JSON.stringify(target)} source=tsx`);
  }

  lines.push(
    `SUMMARY total=${options.components.length} outDir=${JSON.stringify(resolve(options.outDir))}`,
  );
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

export function parseCompileArgs(args: readonly string[]): CompileArgParseResult {
  const target = args[0];
  if (!target || target === '--help' || target === '-h') {
    return { message: compileUsage(), ok: false };
  }

  if (!isCompileTarget(target)) {
    return {
      message: `kovo: unknown compile target ${stableValue(target)}.\n${compileUsage()}`,
      ok: false,
    };
  }

  if (target === 'component') return parseCompileComponentArgs(args.slice(1));
  if (target === 'route') return parseCompileRouteArgs(args.slice(1));
  if (target === 'graph') return parseCompileGraphArgs(args.slice(1));
  if (target === 'mutation-inputs') return parseCompileMutationInputsArgs(args.slice(1));
  if (target === 'drizzle-static') return parseCompileDrizzleStaticArgs(args.slice(1));
  if (target === 'drizzle-optimistic') return parseCompileDrizzleOptimisticArgs(args.slice(1));
  return parseCompilePackageCssArgs(args.slice(1));
}

function parseCompileComponentArgs(args: readonly string[]): CompileArgParseResult {
  let sourcePath: string | undefined;
  let outPath: string | undefined;
  let fileName: string | undefined;
  let factsOutPath: string | undefined;
  let queryShapeFactsPath: string | undefined;
  let registryFactsPath: string | undefined;
  let check = false;
  let cache = true;
  let emitClientFiles = false;
  let fixpoint = false;
  let renderEquivalence = false;
  const allowedDiagnosticCodes: DiagnosticCode[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--no-cache') {
      cache = false;
      continue;
    }
    if (arg === '--fixpoint') {
      fixpoint = true;
      continue;
    }
    if (arg === '--render-equivalence') {
      renderEquivalence = true;
      continue;
    }
    if (arg === '--emit-client-files') {
      emitClientFiles = true;
      continue;
    }
    if (arg === '--allow-diagnostic') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile component --allow-diagnostic requires a code.\n',
          ok: false,
        };
      if (!isDiagnosticCode(value)) {
        return {
          message: `kovo: compile component --allow-diagnostic received unknown code ${stableValue(value)}.\n`,
          ok: false,
        };
      }
      allowedDiagnosticCodes.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--allow-diagnostic=')) {
      const value = arg.slice('--allow-diagnostic='.length);
      if (!value)
        return {
          message: 'kovo: compile component --allow-diagnostic requires a code.\n',
          ok: false,
        };
      if (!isDiagnosticCode(value)) {
        return {
          message: `kovo: compile component --allow-diagnostic received unknown code ${stableValue(value)}.\n`,
          ok: false,
        };
      }
      allowedDiagnosticCodes.push(value);
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile component --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile component --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--file-name') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile component --file-name requires a name.\n', ok: false };
      fileName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--file-name=')) {
      fileName = arg.slice('--file-name='.length);
      if (!fileName)
        return { message: 'kovo: compile component --file-name requires a name.\n', ok: false };
      continue;
    }
    if (arg === '--facts-out') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile component --facts-out requires a JSON path.\n',
          ok: false,
        };
      factsOutPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--facts-out=')) {
      factsOutPath = arg.slice('--facts-out='.length);
      if (!factsOutPath)
        return {
          message: 'kovo: compile component --facts-out requires a JSON path.\n',
          ok: false,
        };
      continue;
    }
    if (arg === '--registry-facts') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile component --registry-facts requires a JSON path.\n',
          ok: false,
        };
      registryFactsPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--registry-facts=')) {
      registryFactsPath = arg.slice('--registry-facts='.length);
      if (!registryFactsPath)
        return {
          message: 'kovo: compile component --registry-facts requires a JSON path.\n',
          ok: false,
        };
      continue;
    }
    if (arg === '--query-shape-facts') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile component --query-shape-facts requires a JSON path.\n',
          ok: false,
        };
      queryShapeFactsPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--query-shape-facts=')) {
      queryShapeFactsPath = arg.slice('--query-shape-facts='.length);
      if (!queryShapeFactsPath)
        return {
          message: 'kovo: compile component --query-shape-facts requires a JSON path.\n',
          ok: false,
        };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile component option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (sourcePath) {
      return {
        message: `kovo: compile component accepts one source path.\n${compileUsage()}`,
        ok: false,
      };
    }
    sourcePath = arg;
  }

  if (!sourcePath)
    return {
      message: `kovo: compile component requires a source path.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return { message: `kovo: compile component requires --out.\n${compileUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      allowedDiagnosticCodes,
      cache,
      check,
      emitClientFiles,
      ...(factsOutPath === undefined ? {} : { factsOutPath }),
      fixpoint,
      ...(fileName === undefined ? {} : { fileName }),
      outPath,
      ...(queryShapeFactsPath === undefined ? {} : { queryShapeFactsPath }),
      ...(registryFactsPath === undefined ? {} : { registryFactsPath }),
      renderEquivalence,
      sourcePath,
      target: 'component',
    },
  };
}

function parseCompileRouteArgs(args: readonly string[]): CompileArgParseResult {
  let sourcePath: string | undefined;
  let outPath: string | undefined;
  let fileName: string | undefined;
  let artifactFileName: string | undefined;
  let factsOutPath: string | undefined;
  let check = false;
  const componentImportRewrites: RouteComponentImportRewrite[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile route --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath) return { message: 'kovo: compile route --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--file-name') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile route --file-name requires a name.\n', ok: false };
      fileName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--file-name=')) {
      fileName = arg.slice('--file-name='.length);
      if (!fileName)
        return { message: 'kovo: compile route --file-name requires a name.\n', ok: false };
      continue;
    }
    if (arg === '--artifact-file-name') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile route --artifact-file-name requires a name.\n',
          ok: false,
        };
      artifactFileName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--artifact-file-name=')) {
      artifactFileName = arg.slice('--artifact-file-name='.length);
      if (!artifactFileName)
        return {
          message: 'kovo: compile route --artifact-file-name requires a name.\n',
          ok: false,
        };
      continue;
    }
    if (arg === '--facts-out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile route --facts-out requires a JSON path.\n', ok: false };
      factsOutPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--facts-out=')) {
      factsOutPath = arg.slice('--facts-out='.length);
      if (!factsOutPath)
        return { message: 'kovo: compile route --facts-out requires a JSON path.\n', ok: false };
      continue;
    }
    if (arg === '--rewrite') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile route --rewrite requires Local=specifier.\n', ok: false };
      const rewrite = parseRouteRewrite(value);
      if (!rewrite.ok) return rewrite;
      componentImportRewrites.push(rewrite.value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--rewrite=')) {
      const rewrite = parseRouteRewrite(arg.slice('--rewrite='.length));
      if (!rewrite.ok) return rewrite;
      componentImportRewrites.push(rewrite.value);
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile route option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (sourcePath) {
      return {
        message: `kovo: compile route accepts one source path.\n${compileUsage()}`,
        ok: false,
      };
    }
    sourcePath = arg;
  }

  if (!sourcePath)
    return { message: `kovo: compile route requires a source path.\n${compileUsage()}`, ok: false };
  if (!outPath)
    return { message: `kovo: compile route requires --out.\n${compileUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      ...(artifactFileName === undefined ? {} : { artifactFileName }),
      check,
      componentImportRewrites,
      ...(factsOutPath === undefined ? {} : { factsOutPath }),
      ...(fileName === undefined ? {} : { fileName }),
      outPath,
      sourcePath,
      target: 'route',
    },
  };
}

function parseCompileGraphArgs(args: readonly string[]): CompileArgParseResult {
  let inputPath: string | undefined;
  let outPath: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value) return { message: 'kovo: compile graph --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath) return { message: 'kovo: compile graph --out requires a path.\n', ok: false };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile graph option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (inputPath) {
      return {
        message: `kovo: compile graph accepts one input path.\n${compileUsage()}`,
        ok: false,
      };
    }
    inputPath = arg;
  }

  if (!inputPath)
    return { message: `kovo: compile graph requires an input path.\n${compileUsage()}`, ok: false };
  if (!outPath)
    return { message: `kovo: compile graph requires --out.\n${compileUsage()}`, ok: false };

  return { ok: true, options: { check, inputPath, outPath, target: 'graph' } };
}

function parseCompileMutationInputsArgs(args: readonly string[]): CompileArgParseResult {
  let sourcePath: string | undefined;
  let outPath: string | undefined;
  let fileName: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile mutation-inputs --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile mutation-inputs --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--file-name') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile mutation-inputs --file-name requires a name.\n',
          ok: false,
        };
      fileName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--file-name=')) {
      fileName = arg.slice('--file-name='.length);
      if (!fileName)
        return {
          message: 'kovo: compile mutation-inputs --file-name requires a name.\n',
          ok: false,
        };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile mutation-inputs option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (sourcePath) {
      return {
        message: `kovo: compile mutation-inputs accepts one source path.\n${compileUsage()}`,
        ok: false,
      };
    }
    sourcePath = arg;
  }

  if (!sourcePath)
    return {
      message: `kovo: compile mutation-inputs requires a source path.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return {
      message: `kovo: compile mutation-inputs requires --out.\n${compileUsage()}`,
      ok: false,
    };

  return {
    ok: true,
    options: {
      check,
      ...(fileName === undefined ? {} : { fileName }),
      outPath,
      sourcePath,
      target: 'mutation-inputs',
    },
  };
}

function parseCompileDrizzleOptimisticArgs(args: readonly string[]): CompileArgParseResult {
  let inputPath: string | undefined;
  let outPath: string | undefined;
  let factsOutPath: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile drizzle-optimistic --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile drizzle-optimistic --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--facts-out') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile drizzle-optimistic --facts-out requires a JSON path.\n',
          ok: false,
        };
      factsOutPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--facts-out=')) {
      factsOutPath = arg.slice('--facts-out='.length);
      if (!factsOutPath)
        return {
          message: 'kovo: compile drizzle-optimistic --facts-out requires a JSON path.\n',
          ok: false,
        };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile drizzle-optimistic option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (inputPath) {
      return {
        message: `kovo: compile drizzle-optimistic accepts one input path.\n${compileUsage()}`,
        ok: false,
      };
    }
    inputPath = arg;
  }

  if (!inputPath)
    return {
      message: `kovo: compile drizzle-optimistic requires an input path.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return {
      message: `kovo: compile drizzle-optimistic requires --out.\n${compileUsage()}`,
      ok: false,
    };

  return {
    ok: true,
    options: {
      check,
      ...(factsOutPath === undefined ? {} : { factsOutPath }),
      inputPath,
      outPath,
      target: 'drizzle-optimistic',
    },
  };
}

function parseCompileDrizzleStaticArgs(args: readonly string[]): CompileArgParseResult {
  let inputPath: string | undefined;
  let outPath: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile drizzle-static --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile drizzle-static --out requires a path.\n', ok: false };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile drizzle-static option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (inputPath) {
      return {
        message: `kovo: compile drizzle-static accepts one input path.\n${compileUsage()}`,
        ok: false,
      };
    }
    inputPath = arg;
  }

  if (!inputPath)
    return {
      message: `kovo: compile drizzle-static requires an input path.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return {
      message: `kovo: compile drizzle-static requires --out.\n${compileUsage()}`,
      ok: false,
    };

  return { ok: true, options: { check, inputPath, outPath, target: 'drizzle-static' } };
}

function parseCompilePackageCssArgs(args: readonly string[]): CompileArgParseResult {
  let packageName: string | undefined;
  let outPath: string | undefined;
  let entryPath: string | undefined;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === '--help' || arg === '-h') return { message: compileUsage(), ok: false };
    if (arg === '--check') {
      check = true;
      continue;
    }
    if (arg === '--out') {
      const value = args[index + 1];
      if (!value)
        return { message: 'kovo: compile package-css --out requires a path.\n', ok: false };
      outPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      if (!outPath)
        return { message: 'kovo: compile package-css --out requires a path.\n', ok: false };
      continue;
    }
    if (arg === '--entry') {
      const value = args[index + 1];
      if (!value)
        return {
          message: 'kovo: compile package-css --entry requires a source path.\n',
          ok: false,
        };
      entryPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--entry=')) {
      entryPath = arg.slice('--entry='.length);
      if (!entryPath)
        return {
          message: 'kovo: compile package-css --entry requires a source path.\n',
          ok: false,
        };
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        message: `kovo: unknown compile package-css option ${stableValue(arg)}.\n${compileUsage()}`,
        ok: false,
      };
    }
    if (packageName) {
      return {
        message: `kovo: compile package-css accepts one package name.\n${compileUsage()}`,
        ok: false,
      };
    }
    packageName = arg;
  }

  if (!packageName)
    return {
      message: `kovo: compile package-css requires a package name.\n${compileUsage()}`,
      ok: false,
    };
  if (!outPath)
    return { message: `kovo: compile package-css requires --out.\n${compileUsage()}`, ok: false };

  return {
    ok: true,
    options: {
      check,
      ...(entryPath === undefined ? {} : { entryPath }),
      outPath,
      packageName,
      target: 'package-css',
    },
  };
}

function parseRouteRewrite(
  value: string,
):
  | { ok: true; value: NonNullable<CompileRouteModuleOptions['componentImportRewrites']>[number] }
  | { message: string; ok: false } {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    return { message: 'kovo: compile route --rewrite requires Local=specifier.\n', ok: false };
  }

  return {
    ok: true,
    value: { localName: value.slice(0, separator), specifier: value.slice(separator + 1) },
  };
}

function isCompileTarget(value: string): value is CompileTarget {
  return (
    value === 'component' ||
    value === 'drizzle-static' ||
    value === 'drizzle-optimistic' ||
    value === 'route' ||
    value === 'graph' ||
    value === 'mutation-inputs' ||
    value === 'package-css'
  );
}

export function compileUsage(): string {
  return [COMPILE_USAGE_LINE, ...COMPILE_USAGE, ''].join('\n');
}

export async function runCompileCommand(options: CompileCommandOptions): Promise<CliCommandResult> {
  try {
    if (options.target === 'component') return await runCompileComponentCommand(options);
    if (options.target === 'route') return await runCompileRouteCommand(options);
    if (options.target === 'graph') return await runCompileGraphCommand(options);
    if (options.target === 'mutation-inputs') return await runCompileMutationInputsCommand(options);
    if (options.target === 'drizzle-static') return await runCompileDrizzleStaticCommand(options);
    if (options.target === 'drizzle-optimistic')
      return await runCompileDrizzleOptimisticCommand(options);
    return await runCompilePackageCssCommand(options);
  } catch (error) {
    return {
      error: `kovo: compile failed: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: 1,
    };
  }
}

async function runCompileComponentCommand(
  options: CompileComponentCommandOptions,
): Promise<CliCommandResult> {
  const { assertFixpoint, assertRenderEquivalence } = await import('@kovojs/compiler');
  const compileOptions: CompileComponentOptions = {
    fileName: options.fileName ?? options.sourcePath,
    source: readFileSync(options.sourcePath, 'utf8'),
  };
  if (options.registryFactsPath !== undefined) {
    compileOptions.registryFacts = readJsonFile(options.registryFactsPath) as NonNullable<
      CompileComponentOptions['registryFacts']
    >;
  }
  if (options.queryShapeFactsPath !== undefined) {
    compileOptions.queryShapeFacts = readJsonFile(options.queryShapeFactsPath) as NonNullable<
      CompileComponentOptions['queryShapeFacts']
    >;
  }
  const result = await compileCachedComponentModule(compileOptions, options.cache);
  const allowedDiagnosticCodes = new Set(options.allowedDiagnosticCodes);
  const warnings = result.diagnostics.filter((diagnostic) =>
    allowedDiagnosticCodes.has(diagnostic.code),
  );
  const blockingDiagnostics = result.diagnostics.filter(
    (diagnostic) => !allowedDiagnosticCodes.has(diagnostic.code),
  );
  if (blockingDiagnostics.length > 0) return compileDiagnosticResult(blockingDiagnostics);
  if (options.fixpoint) assertFixpoint(result);
  if (options.renderEquivalence) assertRenderEquivalence(result);
  if (!result.loweredSource) throw new Error(`${options.sourcePath} produced no lowered source`);

  const artifacts: CompileArtifact[] = [
    { kind: 'component', path: options.outPath, source: result.loweredSource },
  ];
  if (options.factsOutPath !== undefined) {
    artifacts.push({
      kind: 'component-facts',
      path: options.factsOutPath,
      source: `${JSON.stringify({ componentGraphFacts: result.componentGraphFacts }, null, 2)}\n`,
    });
  }
  if (options.emitClientFiles) {
    for (const file of result.files) {
      if (file.kind === 'client') {
        artifacts.push({ kind: 'client', path: file.fileName, source: file.source });
      }
    }
  }

  return compileArtifactsResult(options.check, artifacts, warningLines(warnings));
}

async function runCompileRouteCommand(
  options: CompileRouteCommandOptions,
): Promise<CliCommandResult> {
  const { compileRouteModule } = await import('@kovojs/compiler');
  const result = compileRouteModule({
    ...(options.artifactFileName === undefined
      ? {}
      : { artifactFileName: options.artifactFileName }),
    ...(options.componentImportRewrites === undefined ||
    options.componentImportRewrites.length === 0
      ? {}
      : { componentImportRewrites: options.componentImportRewrites }),
    fileName: options.fileName ?? options.sourcePath,
    source: readFileSync(options.sourcePath, 'utf8'),
  });
  if (result.diagnostics.length > 0) return compileDiagnosticResult(result.diagnostics);
  const source = result.files[0]?.source;
  if (!source) throw new Error(`${options.sourcePath} produced no route artifact`);

  const artifacts: CompileArtifact[] = [{ kind: 'route', path: options.outPath, source }];
  if (options.factsOutPath !== undefined) {
    artifacts.push({
      kind: 'route-facts',
      path: options.factsOutPath,
      source: `${JSON.stringify({ routePageFacts: result.routePageFacts }, null, 2)}\n`,
    });
  }
  return compileArtifactsResult(options.check, artifacts);
}

async function runCompileGraphCommand(
  options: CompileGraphCommandOptions,
): Promise<CliCommandResult> {
  const { deriveAppGraph } = await import('@kovojs/compiler/graph');
  const result = deriveAppGraph(
    readJsonFile(options.inputPath) as Parameters<typeof deriveAppGraph>[0],
  );
  if (result.diagnostics.length > 0) return compileDiagnosticResult(result.diagnostics);
  return compileArtifactResult(options, `${JSON.stringify(result.graph, null, 2)}\n`, 'graph');
}

async function runCompileMutationInputsCommand(
  options: CompileMutationInputsCommandOptions,
): Promise<CliCommandResult> {
  const { mutationInputFactsFromSource } = await import('@kovojs/compiler/internal');
  const facts = Object.fromEntries(
    [
      ...mutationInputFactsFromSource(
        options.fileName ?? options.sourcePath,
        readFileSync(options.sourcePath, 'utf8'),
      ).values(),
    ].map((fact) => [
      fact.key,
      fact.fields.map((field) => ({
        ...field,
        provenance: 'registry' as const,
      })),
    ]),
  );
  return compileArtifactResult(options, `${JSON.stringify(facts, null, 2)}\n`, 'mutation-inputs');
}

type DrizzleOptimisticEntryStatus = 'await-fragment' | 'derived' | 'hand-written';

interface DrizzleStaticCommandInput {
  extract?: readonly (
    | 'algebraicShapes'
    | 'materializedViewRefreshFacts'
    | 'queryFacts'
    | 'symbolicEffects'
    | 'touchGraph'
  )[];
  files?: readonly unknown[];
  invalidation?: {
    constName?: string;
    mutations: readonly unknown[];
    queries?: readonly unknown[];
    touchGraph?: unknown;
    typeName?: string;
  };
  serializeTouchGraph?: {
    exportName?: string;
    touchGraph?: unknown;
  };
}

async function runCompileDrizzleStaticCommand(
  options: CompileDrizzleStaticCommandOptions,
): Promise<CliCommandResult> {
  const {
    deriveInvalidationRegistry,
    deriveMutationTouchRegistry,
    extractAlgebraicShapesFromProject,
    extractMaterializedViewRefreshFactsFromProject,
    extractOwnerAuditFromProject,
    extractQueryFactsFromProject,
    extractSymbolicEffectsFromProject,
    extractTouchGraphFromProject,
    serializeInvalidationRegistry,
    serializeMutationTouchRegistry,
    serializeTouchGraph,
  } = await import('@kovojs/drizzle/internal/static');
  const input = readJsonFile(options.inputPath) as DrizzleStaticCommandInput;
  const files = input.files as
    | Parameters<typeof extractTouchGraphFromProject>[0]['files']
    | undefined;
  const output: Record<string, unknown> = { version: 'drizzle-static/v1' };

  if (files !== undefined) {
    const extract = new Set(
      input.extract ?? [
        'algebraicShapes',
        'materializedViewRefreshFacts',
        'ownerAudit',
        'queryFacts',
        'symbolicEffects',
        'touchGraph',
      ],
    );
    if (extract.has('touchGraph')) output.touchGraph = extractTouchGraphFromProject({ files });
    if (extract.has('ownerAudit')) {
      // SPEC §10.1/§10.3: owner-domain facts + IDOR scope audits the graph emission
      // feeds to `kovo check` (KV414).
      const ownerAudit = extractOwnerAuditFromProject({ files });
      output.ownerDomains = ownerAudit.ownerDomains;
      output.scopeAudits = ownerAudit.scopeAudits;
    }
    if (extract.has('materializedViewRefreshFacts')) {
      output.materializedViewRefreshFacts = extractMaterializedViewRefreshFactsFromProject({
        files,
      });
    }
    if (extract.has('queryFacts')) {
      const queryFacts = extractQueryFactsFromProject({ files });
      output.queryFacts = queryFacts;
      output.queryDomains = queryDomainsFromStaticFacts(queryFacts);
    }
    if (extract.has('symbolicEffects'))
      output.symbolicEffects = extractSymbolicEffectsFromProject({ files });
    if (extract.has('algebraicShapes'))
      output.algebraicShapes = extractAlgebraicShapesFromProject({ files });
  }

  if (input.invalidation !== undefined) {
    const touchGraph = (input.invalidation.touchGraph ?? output.touchGraph) as Parameters<
      typeof deriveInvalidationRegistry
    >[0]['touchGraph'];
    const queries = (input.invalidation.queries ?? output.queryDomains) as Parameters<
      typeof deriveInvalidationRegistry
    >[0]['queries'];
    if (touchGraph === undefined)
      throw new Error('drizzle-static invalidation requires touchGraph');
    if (queries === undefined) throw new Error('drizzle-static invalidation requires queries');
    const invalidationRegistry = deriveInvalidationRegistry({
      mutations: input.invalidation.mutations as Parameters<
        typeof deriveInvalidationRegistry
      >[0]['mutations'],
      queries,
      touchGraph,
    });
    const mutationTouchRegistry = deriveMutationTouchRegistry({
      mutations: input.invalidation.mutations as Parameters<
        typeof deriveMutationTouchRegistry
      >[0]['mutations'],
      touchGraph,
    });
    output.invalidationRegistry = invalidationRegistry;
    output.invalidationRegistrySource = serializeInvalidationRegistry(invalidationRegistry, {
      constName: input.invalidation.constName ?? 'invalidationSets',
      typeName: input.invalidation.typeName ?? 'InvalidationSets',
    });
    output.mutationTouchRegistry = mutationTouchRegistry;
    output.mutationTouchRegistrySource = serializeMutationTouchRegistry(mutationTouchRegistry);
  }

  if (input.serializeTouchGraph !== undefined) {
    const touchGraph = (input.serializeTouchGraph.touchGraph ?? output.touchGraph) as Parameters<
      typeof serializeTouchGraph
    >[0];
    if (touchGraph === undefined)
      throw new Error('drizzle-static serializeTouchGraph requires touchGraph');
    const source = serializeTouchGraph(touchGraph);
    output.touchGraphSource =
      input.serializeTouchGraph.exportName === undefined
        ? source
        : source.replace(
            'export const touchGraph =',
            `export const ${input.serializeTouchGraph.exportName} =`,
          );
  }

  return compileArtifactResult(options, `${JSON.stringify(output, null, 2)}\n`, 'drizzle-static');
}

interface DrizzleOptimisticCommandInput {
  complete?: boolean;
  constName: string;
  effects: readonly unknown[];
  entries: readonly {
    domains?: readonly string[];
    query: string;
    shape: unknown;
    status?: DrizzleOptimisticEntryStatus;
  }[];
  formImport: { name: string; path: string };
  materializedViewRefreshFacts?: readonly {
    domain?: unknown;
    mutation?: unknown;
    optimisticStatus?: unknown;
  }[];
  mutation?: string;
  overrides?: readonly string[];
  queryDomains?: readonly {
    domains?: readonly string[];
    query?: string;
  }[];
  queue?: string;
}

async function runCompileDrizzleOptimisticCommand(
  options: CompileDrizzleOptimisticCommandOptions,
): Promise<CliCommandResult> {
  const { deriveOptimistic } = await import('@kovojs/drizzle/internal/derive');
  const { serializeDerivedOptimistic } = await import('@kovojs/drizzle/internal/derive-codegen');
  const input = readJsonFile(options.inputPath) as DrizzleOptimisticCommandInput;
  const derivedEntries: Parameters<typeof serializeDerivedOptimistic>[0]['entries'][number][] = [];
  const awaitFragmentQueries: string[] = [];
  const matviewAwaitFragmentQueries = materializedViewAwaitFragmentQueries(input);
  const facts: {
    derivation?: { reason?: unknown; status: 'PUNTED' | 'derived' };
    query: string;
    status: DrizzleOptimisticEntryStatus;
  }[] = [];

  for (const entry of input.entries) {
    const status =
      entry.status ?? (matviewAwaitFragmentQueries.has(entry.query) ? 'await-fragment' : 'derived');
    if (status === 'await-fragment') {
      awaitFragmentQueries.push(entry.query);
      facts.push({
        query: entry.query,
        status,
      });
      continue;
    }

    const result = deriveOptimistic(
      input.effects as Parameters<typeof deriveOptimistic>[0],
      entry.shape as Parameters<typeof deriveOptimistic>[1],
    );

    if (status === 'derived') {
      if (result.kind !== 'derived') {
        throw new Error(
          `${entry.query} expected derived optimistic transform, got ${JSON.stringify(result)}`,
        );
      }
      derivedEntries.push({ program: result.program, query: entry.query });
      facts.push({ derivation: { status: 'derived' }, query: entry.query, status });
      continue;
    }

    facts.push({
      ...(result.kind === 'punt'
        ? { derivation: { status: 'PUNTED' as const, reason: result.reason } }
        : {}),
      query: entry.query,
      status,
    });
  }

  const overrideQueries =
    input.overrides ??
    input.entries
      .filter((entry) => {
        const status =
          entry.status ??
          (matviewAwaitFragmentQueries.has(entry.query) ? 'await-fragment' : 'derived');
        return status !== 'derived' && status !== 'await-fragment';
      })
      .map((entry) => entry.query);
  const source = serializeDerivedOptimistic({
    ...(awaitFragmentQueries.length === 0 ? {} : { awaitFragments: awaitFragmentQueries }),
    complete: input.complete ?? overrideQueries.length === 0,
    constName: input.constName,
    entries: derivedEntries,
    formImport: input.formImport,
    ...(input.queue === undefined ? {} : { queue: input.queue }),
    ...(overrideQueries.length === 0 ? {} : { overrides: overrideQueries }),
  });
  const artifacts: CompileArtifact[] = [
    { kind: 'drizzle-optimistic', path: options.outPath, source },
  ];
  if (options.factsOutPath !== undefined) {
    artifacts.push({
      kind: 'drizzle-optimistic-facts',
      path: options.factsOutPath,
      source: `${JSON.stringify(facts, null, 2)}\n`,
    });
  }
  return compileArtifactsResult(options.check, artifacts);
}

function materializedViewAwaitFragmentQueries(input: DrizzleOptimisticCommandInput): Set<string> {
  const mutation = input.mutation;
  if (!mutation) return new Set();

  const domainsByQuery = new Map<string, Set<string>>();
  for (const entry of input.entries) {
    const domains = entry.domains ?? [];
    if (domains.length > 0) domainsByQuery.set(entry.query, new Set(domains));
  }
  for (const fact of input.queryDomains ?? []) {
    if (typeof fact.query !== 'string') continue;
    const domains = fact.domains ?? [];
    if (domains.length === 0) continue;
    const queryDomains = domainsByQuery.get(fact.query) ?? new Set<string>();
    for (const domain of domains) queryDomains.add(domain);
    domainsByQuery.set(fact.query, queryDomains);
  }

  const refreshDomains = new Set(
    (input.materializedViewRefreshFacts ?? []).flatMap((fact) =>
      fact.mutation === mutation &&
      fact.optimisticStatus === 'await-fragment' &&
      typeof fact.domain === 'string'
        ? [fact.domain]
        : [],
    ),
  );
  if (refreshDomains.size === 0) return new Set();

  return new Set(
    [...domainsByQuery]
      .filter(([, domains]) => [...refreshDomains].some((domain) => domains.has(domain)))
      .map(([query]) => query),
  );
}

async function runCompilePackageCssCommand(
  options: CompilePackageCssCommandOptions,
): Promise<CliCommandResult> {
  const { extractPackageComponentCss } = await import('@kovojs/compiler/package-styles');
  const entryPath = options.entryPath ?? 'src/app.ts';
  const result = extractPackageComponentCss(options.packageName, {
    fileName: entryPath,
    packagePrefixDiscoveryRoot: dirname(resolve(entryPath)),
    source: existsSync(entryPath) ? readFileSync(entryPath, 'utf8') : '',
  });
  if (!result.css) throw new Error(`no CSS extracted for ${options.packageName}`);

  const lines = compileArtifactLines(options, result.css, 'package-css');
  for (const diagnostic of result.diagnostics) {
    lines.splice(
      -1,
      0,
      `WARN package-css file=${JSON.stringify(diagnostic.fileName)} ${stableText(diagnostic.message)}`,
    );
  }
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

function compileArtifactResult(
  options: CompileBaseOptions,
  source: string,
  kind: CompileTarget,
): CliCommandResult {
  return { exitCode: 0, output: `${compileArtifactLines(options, source, kind).join('\n')}\n` };
}

interface CompileArtifact {
  kind: string;
  path: string;
  source: string;
}

function compileArtifactsResult(
  check: boolean,
  artifacts: readonly CompileArtifact[],
  warnings: readonly string[] = [],
): CliCommandResult {
  const lines = [compileCommandOutputVersion];
  for (const artifact of artifacts) {
    lines.push(...compileArtifactActionLines(check, artifact));
  }
  lines.push(...warnings, `SUMMARY artifacts=${artifacts.length} diagnostics=${warnings.length}`);
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

function compileArtifactLines(
  options: CompileBaseOptions,
  source: string,
  kind: CompileTarget,
): string[] {
  return [
    compileCommandOutputVersion,
    ...compileArtifactActionLines(options.check, { kind, path: options.outPath, source }),
    `SUMMARY artifacts=1 diagnostics=0`,
  ];
}

function compileArtifactActionLines(check: boolean, artifact: CompileArtifact): string[] {
  const target = resolve(artifact.path);
  if (check) {
    const current = readFileSync(target, 'utf8');
    if (current !== artifact.source) {
      throw new Error(`${artifact.kind} artifact ${target} is stale; rerun without --check`);
    }
    return [
      `CHECK ${artifact.kind} path=${JSON.stringify(target)} status=current bytes=${byteLength(artifact.source)}`,
    ];
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, artifact.source, 'utf8');
  return [
    `WRITE ${artifact.kind} path=${JSON.stringify(target)} bytes=${byteLength(artifact.source)}`,
  ];
}

function warningLines(
  diagnostics: readonly { code: DiagnosticCode; fileName: string; message: string }[],
): string[] {
  return diagnostics.map(
    (diagnostic) =>
      `WARN ${diagnostic.code} file=${JSON.stringify(diagnostic.fileName)} ${stableText(diagnostic.message)}`,
  );
}

function compileDiagnosticResult(
  diagnostics: readonly { code: DiagnosticCode; fileName: string; message: string }[],
): CliCommandResult {
  return {
    error: [
      compileCommandOutputVersion,
      ...diagnostics.map(
        (diagnostic) =>
          `ERROR ${diagnostic.code} file=${JSON.stringify(diagnostic.fileName)} ${stableText(diagnostic.message)}`,
      ),
      `SUMMARY artifacts=0 diagnostics=${diagnostics.length}`,
    ].join('\n'),
    exitCode: 1,
  };
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function queryDomainsFromStaticFacts(
  facts: readonly { query: string; reads: readonly string[]; site: string }[],
): { domains: readonly string[]; query: string }[] {
  return [...facts]
    .sort((left, right) => siteLineNumber(left.site) - siteLineNumber(right.site))
    .map((fact) => ({ domains: [...fact.reads], query: fact.query }));
}

function siteLineNumber(site: string): number {
  return Number(String(site).split(':').pop() ?? 0);
}

