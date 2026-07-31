import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  AlgebraicQueryShape,
  DerivationProof,
  DerivationProofLevel,
  DerivationResult,
  PatchOp,
  PuntReason,
  SymbolicEffect,
} from '@kovojs/core/internal/derivation';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import type {
  CompileComponentOptions,
  CompileResult,
  CompileRouteModuleOptions,
  RouteComponentImportRewrite,
} from '@kovojs/compiler';
import type { DiagnosticCode } from '@kovojs/core/diagnostics';
import { assertRegisteredDiagnostic, isDiagnosticCode } from '@kovojs/core/internal/diagnostics';
import {
  createFrameworkFileSystemBoundary,
  createFrameworkOutputFileSystemBoundary,
  type CapturedFileReplacement,
  type FrameworkFileSystemBoundary,
} from '@kovojs/core/internal/filesystem';

import {
  availableAddComponents,
  normalizedVendoredUiComponentSource,
  vendoredUiComponents,
  type AddComponentName,
} from '../add-catalog.js';
import {
  ADD_USAGE,
  COMPILE_USAGE,
  COMPILE_USAGE_LINE,
  parseKovoCommandInvocation,
} from '../commands-manifest.js';
import { compileFrameworkComponentModule } from './mcp.js';
import {
  addOutputVersion,
  byteLength,
  compileCommandOutputVersion,
  type CliCommandResult,
  type KovoCheckResult,
  stableText,
  stableValue,
} from '../shared.js';
import { findNearestFile, isRecord } from '../tooling.js';
import {
  readCapabilityPackageSummaries,
  resolveCapabilityPackages,
} from '../capability-closure-packages.js';
import { readCliPackageVersion } from '../package-version.js';
import { projectKovoDiagnostic } from '../diagnostic.js';

const requireFromCli = createRequire(import.meta.url);
const cliPackageVersion = readCliPackageVersion();

function drizzleStaticSqlSafetyErrorExit(
  sqlSafetyErrors: readonly SqlSafetyDiagnosticLike[],
): { exitCode: 1 } | undefined {
  if (sqlSafetyErrors.length > 0) return { exitCode: 1 };
  return undefined;
}

export const addCommandShell = {
  execFileSync,
};

type AddComponentOptions =
  | {
      readonly kind: 'list';
    }
  | {
      readonly components: readonly AddComponentName[];
      readonly dryRun: boolean;
      readonly install: 'auto' | 'never';
      readonly kind: 'components';
      readonly outDir: string;
    };

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
  const parsed = parseKovoCommandInvocation('add', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };
  if (parsed.value.form === 'list') {
    return { ok: true, options: { kind: 'list' } };
  }

  const components: AddComponentName[] = [];
  for (const component of parsed.value.arguments.components) {
    if (!components.includes(component)) components.push(component);
  }

  return {
    ok: true,
    options: {
      components,
      dryRun: parsed.value.options.dryRun,
      install: parsed.value.options.install,
      kind: 'components',
      outDir: parsed.value.options.out,
    },
  };
}

export function addUsage(): string {
  return [ADD_USAGE, `available: ${availableAddComponents()}`, ''].join('\n');
}

export async function runAddCommand(options: AddComponentOptions): Promise<CliCommandResult> {
  if (options.kind === 'list') {
    return {
      exitCode: 0,
      output: `${addOutputVersion}\nCATALOG ${availableAddComponents()}\nSUMMARY total=${Object.keys(vendoredUiComponents).length}\n`,
    };
  }
  try {
    return await runAddCommandWithOutputBoundary(options);
  } catch (error) {
    return {
      error: `${addOutputVersion}\nERROR OUTPUT reason=${stableText(
        error instanceof Error ? error.message : String(error),
      )}`,
      exitCode: 1,
    };
  }
}

async function runAddCommandWithOutputBoundary(
  options: Extract<AddComponentOptions, { readonly kind: 'components' }>,
): Promise<CliCommandResult> {
  const lines = [addOutputVersion];
  const resolvedOutDir = resolve(options.outDir);
  const output = createFrameworkOutputFileSystemBoundary(resolvedOutDir);
  const requiredPackageDependencies = new Set<string>();
  const plannedWrites: {
    component: AddComponentName;
    file: (typeof vendoredUiComponents)[AddComponentName]['files'][number];
    relativePath: string;
    target: string;
  }[] = [];

  for (const component of options.components) {
    const entry = vendoredUiComponents[component];
    if (!entry) {
      return {
        error: `${addOutputVersion}\nERROR ${component} reason=unknown-component`,
        exitCode: 1,
      };
    }
    for (const packageName of entry.requiredPackageDependencies) {
      requiredPackageDependencies.add(packageName);
    }
    for (const file of entry.files) {
      const shared = plannedWrites.find((planned) => planned.relativePath === file.fileName);
      if (shared !== undefined) {
        if (
          normalizedVendoredUiComponentSource(shared.file.source) !==
          normalizedVendoredUiComponentSource(file.source)
        ) {
          return {
            error: `${addOutputVersion}\nERROR ${component} path=${JSON.stringify(resolve(resolvedOutDir, file.fileName))} reason=catalog-conflict`,
            exitCode: 1,
          };
        }
        continue;
      }
      plannedWrites.push({
        component,
        file,
        relativePath: file.fileName,
        target: resolve(resolvedOutDir, file.fileName),
      });
    }
  }

  const pendingWrites: typeof plannedWrites = [];
  for (const planned of plannedWrites) {
    const currentBytes = await output.fileBytes(planned.relativePath);
    if (currentBytes === undefined) {
      pendingWrites.push(planned);
      continue;
    }
    const current = Buffer.from(currentBytes).toString('utf8');
    if (
      normalizedVendoredUiComponentSource(current) ===
      normalizedVendoredUiComponentSource(planned.file.source)
    ) {
      continue;
    }
    return {
      error: `${addOutputVersion}\nERROR ${planned.component} path=${JSON.stringify(planned.target)} reason=would-overwrite`,
      exitCode: 1,
    };
  }

  for (const component of options.components) {
    const entry = vendoredUiComponents[component];
    if (!entry) continue;
    const componentTarget = resolve(resolvedOutDir, entry.fileName);
    const componentPending = entry.files.some((file) =>
      pendingWrites.some((planned) => planned.relativePath === file.fileName),
    );
    lines.push(
      componentPending
        ? `${options.dryRun ? 'PLAN ' : ''}ADD ${component} path=${JSON.stringify(componentTarget)} source=tsx package=@kovojs/ui@${entry.packageVersion} sourceHash=${entry.sourceHash}`
        : `SKIP ${component} path=${JSON.stringify(componentTarget)} reason=already-current package=@kovojs/ui@${entry.packageVersion} sourceHash=${entry.sourceHash}`,
    );
  }

  const missingDependencies = await missingAddPackageDependencies(
    [...requiredPackageDependencies].sort(),
    resolvedOutDir,
  );
  if (missingDependencies.length > 0 && (options.dryRun || options.install === 'never')) {
    lines.push(
      `DEPENDENCIES status=${options.dryRun ? 'planned' : 'follow-up'} packages=${missingDependencies.join(',')}` +
        ` install=${JSON.stringify(`pnpm add ${missingDependencies.join(' ')}`)}`,
    );
  }

  if (options.dryRun) {
    lines.push(
      `SUMMARY total=${options.components.length} writes=0 planned=${pendingWrites.length} outDir=${JSON.stringify(resolvedOutDir)}`,
    );
    return { exitCode: 0, output: `${lines.join('\n')}\n` };
  }

  const stagingRoot = await output.createStagingRoot('.kovo-add-staging-');
  const staging = createFrameworkOutputFileSystemBoundary(stagingRoot);
  let dependencyTransaction:
    | Extract<EnsureAddPackageDependenciesResult, { readonly ok: true }>
    | undefined;
  const promoted: string[] = [];
  try {
    for (const planned of pendingWrites) {
      await staging.writeFile(planned.relativePath, planned.file.source);
    }

    if (missingDependencies.length > 0 && options.install === 'auto') {
      const ensuredDependencies = await ensureAddPackageDependencies(
        missingDependencies,
        resolvedOutDir,
      );
      if (!ensuredDependencies.ok) {
        const installAttempted = ensuredDependencies.reason === 'install-failed';
        return {
          error:
            `${addOutputVersion}\nERROR DEPENDENCIES reason=${ensuredDependencies.reason}` +
            ` packages=${missingDependencies.join(',')}` +
            ` install=${JSON.stringify(ensuredDependencies.installCommand)}` +
            ` completed=${installAttempted ? 'package-manager-attempt' : 'none'} planned=component-files` +
            (ensuredDependencies.rolledBack === 'complete'
              ? ' rolledBack=manifest,lockfile'
              : ensuredDependencies.rolledBack === 'partial'
                ? ' rolledBack=partial'
                : '') +
            (installAttempted ? ' residual=node_modules-possible' : '') +
            (ensuredDependencies.packageJsonPath
              ? ` manifest=${JSON.stringify(ensuredDependencies.packageJsonPath)}`
              : ''),
          exitCode: 1,
        };
      }
      dependencyTransaction = ensuredDependencies;
      lines.push(
        `DEPENDENCIES status=${ensuredDependencies.status} packages=${missingDependencies.join(',')}` +
          ` install=${JSON.stringify(ensuredDependencies.installCommand)}` +
          (ensuredDependencies.packageJsonPath
            ? ` manifest=${JSON.stringify(ensuredDependencies.packageJsonPath)}`
            : ''),
      );
    }

    for (const planned of pendingWrites) {
      await output.renameFrom(resolve(stagingRoot, planned.relativePath), planned.relativePath);
      promoted.push(planned.relativePath);
    }
  } catch (error) {
    let componentRollbackComplete = true;
    for (const relativePath of promoted.reverse()) {
      try {
        await output.deleteFile(relativePath);
      } catch {
        componentRollbackComplete = false;
      }
    }
    const packageRollback =
      dependencyTransaction === undefined
        ? undefined
        : await dependencyTransaction.rollback().catch(() => 'partial' as const);
    return {
      error:
        `${addOutputVersion}\nERROR TRANSACTION reason=${stableText(
          error instanceof Error ? error.message : String(error),
        )} completed=${dependencyTransaction === undefined ? 'none' : 'package-manager-install'} planned=component-files` +
        ` rolledBack=${componentRollbackComplete ? 'component-files' : 'component-files-partial'}` +
        (packageRollback === undefined
          ? ''
          : packageRollback === 'complete'
            ? ',manifest,lockfile residual=node_modules-possible'
            : ',package-state-partial residual=node_modules-possible'),
      exitCode: 1,
    };
  } finally {
    await staging.removeTree().catch(() => undefined);
  }

  lines.push(
    `SUMMARY total=${options.components.length} writes=${pendingWrites.length} planned=0 outDir=${JSON.stringify(resolvedOutDir)}`,
  );
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

async function missingAddPackageDependencies(
  packageNames: readonly string[],
  outDir: string,
): Promise<readonly string[]> {
  if (packageNames.length === 0) return [];
  const packageJsonPath = findNearestPackageJson(resolve(outDir));
  if (!packageJsonPath) return packageNames;
  const parsed = await readAddPackageJson(packageJsonPath);
  if (parsed === undefined) return packageNames;
  return packageNames.filter((packageName) => !packageJsonDeclaresPackage(parsed, packageName));
}

type EnsureAddPackageDependenciesResult =
  | {
      installCommand: string;
      ok: true;
      packageJsonPath?: string;
      rollback(): Promise<'complete' | 'partial'>;
      status: 'follow-up' | 'installed';
    }
  | {
      installCommand: string;
      ok: false;
      packageJsonPath?: string;
      reason: 'install-failed' | 'invalid-package-json';
      rolledBack: 'complete' | 'none' | 'partial';
    };

interface AddRollbackFile {
  readonly boundary: FrameworkFileSystemBoundary;
  readonly fileName: string;
  readonly original?: CapturedFileReplacement;
}

async function ensureAddPackageDependencies(
  packageNames: readonly string[],
  outDir: string,
): Promise<EnsureAddPackageDependenciesResult> {
  const packageJsonPath = findNearestPackageJson(resolve(outDir));
  if (!packageJsonPath) {
    return {
      installCommand: `pnpm add ${packageNames.join(' ')}`,
      ok: true,
      rollback: async () => 'complete',
      status: 'follow-up',
    };
  }

  const parsed = await readAddPackageJson(packageJsonPath);
  if (parsed === undefined) {
    return {
      installCommand: 'pnpm install',
      ok: false,
      packageJsonPath,
      reason: 'invalid-package-json',
      rolledBack: 'none',
    };
  }
  const installInvocation = packageManagerInstallInvocation(parsed);
  const installCommand = [installInvocation.command, ...installInvocation.args].join(' ');

  const missingByManifest = packageNames.filter(
    (packageName) => !packageJsonDeclaresPackage(parsed, packageName),
  );
  if (missingByManifest.length === 0) {
    return {
      installCommand,
      ok: true,
      packageJsonPath,
      rollback: async () => 'complete',
      status: 'installed',
    };
  }

  const dependencySpecs = Object.fromEntries(
    missingByManifest.map((packageName) => [
      packageName,
      inferAddDependencySpec(parsed, packageName),
    ]),
  );
  const nextManifest = addDependenciesToPackageJson(parsed, dependencySpecs);
  const manifestRollback = await captureAddRollbackFile(packageJsonPath);
  if (manifestRollback?.original === undefined) {
    return {
      installCommand,
      ok: false,
      packageJsonPath,
      reason: 'invalid-package-json',
      rolledBack: 'none',
    };
  }
  const lockfileRollback = await captureAddRollbackFile(
    addPackageManagerLockfilePath(parsed, packageJsonPath),
  );
  if (lockfileRollback === undefined) {
    return {
      installCommand,
      ok: false,
      packageJsonPath,
      reason: 'invalid-package-json',
      rolledBack: 'none',
    };
  }
  const rollbackFiles = [manifestRollback, lockfileRollback];
  await manifestRollback.boundary.replaceCapturedFile(
    manifestRollback.original,
    `${JSON.stringify(nextManifest, null, 2)}\n`,
  );

  try {
    addCommandShell.execFileSync(installInvocation.command, installInvocation.args, {
      cwd: dirname(packageJsonPath),
      stdio: 'pipe',
    });
  } catch {
    const rolledBack = await rollbackAddFiles(rollbackFiles);
    return {
      installCommand,
      ok: false,
      packageJsonPath,
      reason: 'install-failed',
      rolledBack,
    };
  }

  return {
    installCommand,
    ok: true,
    packageJsonPath,
    rollback: async () => rollbackAddFiles(rollbackFiles),
    status: 'installed',
  };
}

async function captureAddRollbackFile(path: string): Promise<AddRollbackFile | undefined> {
  const boundary = await createFrameworkFileSystemBoundary(dirname(path));
  const fileName = basename(path);
  const original = await boundary.captureFileForReplacement(fileName);
  if (original === undefined && lexicalPathExists(path)) return undefined;
  return {
    boundary,
    fileName,
    ...(original === undefined ? {} : { original }),
  };
}

async function rollbackAddFiles(
  files: readonly AddRollbackFile[],
): Promise<'complete' | 'partial'> {
  const results = await Promise.all(files.map(restoreAddRollbackFile));
  return results.every(Boolean) ? 'complete' : 'partial';
}

async function restoreAddRollbackFile(file: AddRollbackFile): Promise<boolean> {
  try {
    const current = await file.boundary.captureFileForReplacement(file.fileName);
    if (file.original === undefined) {
      if (current !== undefined || lexicalPathExists(join(file.boundary.root, file.fileName))) {
        await file.boundary.deleteFile(file.fileName);
      }
      return !lexicalPathExists(join(file.boundary.root, file.fileName));
    }
    if (current !== undefined) {
      await file.boundary.replaceCapturedFile(current, file.original.body);
      return true;
    }
    if (lexicalPathExists(join(file.boundary.root, file.fileName))) {
      await file.boundary.deleteFile(file.fileName);
    }
    await file.boundary.writeFile(file.fileName, file.original.body);
    return true;
  } catch {
    return false;
  }
}

function addPackageManagerLockfilePath(
  manifest: Record<string, unknown>,
  packageJsonPath: string,
): string {
  const packageRoot = dirname(packageJsonPath);
  const manager = packageManagerName(manifest);
  const lockfileName =
    manager === 'bun'
      ? 'bun.lock'
      : manager === 'npm'
        ? 'package-lock.json'
        : manager === 'yarn'
          ? 'yarn.lock'
          : 'pnpm-lock.yaml';
  const existing = findNearestFile(packageRoot, lockfileName);
  if (existing !== undefined) return existing;
  if (manager === 'bun') {
    const binaryLockfile = findNearestFile(packageRoot, 'bun.lockb');
    if (binaryLockfile !== undefined) return binaryLockfile;
  }
  if (manager === 'pnpm') {
    const workspace = findNearestFile(packageRoot, 'pnpm-workspace.yaml');
    if (workspace !== undefined) return join(dirname(workspace), lockfileName);
  }
  return join(packageRoot, lockfileName);
}

function lexicalPathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

async function readAddPackageJson(path: string): Promise<Record<string, unknown> | undefined> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(dirname(path));
  const bytes = await fileSystem.fileBytes(basename(path));
  if (bytes === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function findNearestPackageJson(startDir: string): string | undefined {
  return findNearestFile(startDir, 'package.json');
}

function packageJsonDeclaresPackage(
  manifest: Record<string, unknown>,
  packageName: string,
): boolean {
  return (
    packageBagDeclaresPackage(manifest.dependencies, packageName) ||
    packageBagDeclaresPackage(manifest.devDependencies, packageName) ||
    packageBagDeclaresPackage(manifest.peerDependencies, packageName) ||
    packageBagDeclaresPackage(manifest.optionalDependencies, packageName)
  );
}

function packageBagDeclaresPackage(value: unknown, packageName: string): boolean {
  return isRecord(value) && typeof value[packageName] === 'string';
}

function addDependenciesToPackageJson(
  manifest: Record<string, unknown>,
  dependencySpecs: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const currentDependencies = isRecord(manifest.dependencies) ? { ...manifest.dependencies } : {};
  for (const [packageName, spec] of Object.entries(dependencySpecs)) {
    currentDependencies[packageName] = spec;
  }
  return {
    ...manifest,
    dependencies: sortRecordKeys(currentDependencies),
  };
}

function sortRecordKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function inferAddDependencySpec(manifest: Record<string, unknown>, packageName: string): string {
  if (packageName.startsWith('@kovojs/')) {
    const exactOverride = exactPnpmPackageOverride(manifest, packageName);
    if (exactOverride !== undefined) return exactOverride;
    const inferredKovoSpec = inferExistingKovoPackageSpec(manifest, packageName);
    if (inferredKovoSpec) return inferredKovoSpec;
    return cliPackageVersion;
  }
  const existingVersion = findDeclaredPackageSpec(manifest, packageName);
  if (existingVersion) return existingVersion;
  throw new Error(`Unable to infer package spec for ${packageName}`);
}

function inferExistingKovoPackageSpec(
  manifest: Record<string, unknown>,
  packageName: string,
): string | undefined {
  for (const bagName of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const) {
    const bag = manifest[bagName];
    if (!isRecord(bag)) continue;
    for (const [existingPackageName, existingSpec] of Object.entries(bag)) {
      if (!existingPackageName.startsWith('@kovojs/') || typeof existingSpec !== 'string') continue;
      const linkedSpec = inferLinkedKovoPackageSpec(existingPackageName, existingSpec, packageName);
      if (linkedSpec) return linkedSpec;
      if (existingSpec.startsWith('workspace:')) return existingSpec;
      // Archive, URL, alias, and patch specs identify one concrete package. Reusing another
      // Kovo package's spec can install bytes whose declared name differs from `packageName`.
      if (packageBoundDependencySpec(existingSpec)) continue;
      return existingSpec;
    }
  }
  return undefined;
}

function exactPnpmPackageOverride(
  manifest: Record<string, unknown>,
  packageName: string,
): string | undefined {
  const pnpm = manifest.pnpm;
  if (!isRecord(pnpm)) return undefined;
  const overrides = pnpm.overrides;
  if (!isRecord(overrides)) return undefined;
  const exact = overrides[packageName];
  return typeof exact === 'string' && exact.length > 0 ? exact : undefined;
}

function packageBoundDependencySpec(spec: string): boolean {
  return (
    spec.startsWith('file:') ||
    spec.startsWith('portal:') ||
    spec.startsWith('patch:') ||
    spec.startsWith('npm:') ||
    spec.startsWith('git:') ||
    spec.startsWith('git+') ||
    spec.startsWith('github:') ||
    spec.startsWith('http:') ||
    spec.startsWith('https:') ||
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    isAbsolute(spec)
  );
}

function inferLinkedKovoPackageSpec(
  existingPackageName: string,
  existingSpec: string,
  nextPackageName: string,
): string | undefined {
  if (!existingSpec.startsWith('link:')) return undefined;
  const existingLeaf = existingPackageName.slice('@kovojs/'.length);
  const linkedPath = existingSpec.slice('link:'.length);
  const normalized = linkedPath.replaceAll('\\', '/');
  const suffix = `/packages/${existingLeaf}`;
  if (!normalized.endsWith(suffix)) return undefined;
  return `${existingSpec.slice(0, -suffix.length)}/packages/${nextPackageName.slice('@kovojs/'.length)}`;
}

function findDeclaredPackageSpec(
  manifest: Record<string, unknown>,
  packageName: string,
): string | undefined {
  for (const bagName of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const) {
    const bag = manifest[bagName];
    if (isRecord(bag) && typeof bag[packageName] === 'string') {
      return bag[packageName];
    }
  }
  return undefined;
}

function packageManagerInstallInvocation(manifest: Record<string, unknown>): {
  args: string[];
  command: 'bun' | 'npm' | 'pnpm' | 'yarn';
} {
  const command = packageManagerName(manifest);
  // `kovo add` has just updated package.json, so pnpm's CI-default frozen lockfile necessarily
  // describes the pre-add manifest. Permit this one intentional lockfile refresh while preserving
  // pnpm's normal lifecycle/network policy and leaving every other package manager unchanged.
  return {
    args: command === 'pnpm' ? ['install', '--no-frozen-lockfile'] : ['install'],
    command,
  };
}

function packageManagerName(manifest: Record<string, unknown>): 'bun' | 'npm' | 'pnpm' | 'yarn' {
  const packageManager = manifest.packageManager;
  if (typeof packageManager === 'string') {
    const [name] = packageManager.split('@');
    if (name === 'bun' || name === 'npm' || name === 'pnpm' || name === 'yarn') return name;
  }
  return 'pnpm';
}

export function parseCompileArgs(args: readonly string[]): CompileArgParseResult {
  const parsed = parseKovoCommandInvocation('compile', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };

  const invocation = parsed.value;
  switch (invocation.form) {
    case 'component': {
      const allowedDiagnosticCodes: DiagnosticCode[] = [];
      for (const code of invocation.options.allowDiagnostic) {
        if (!isDiagnosticCode(code)) {
          return {
            message: `kovo: compile component --allow-diagnostic received unknown code ${stableValue(code)}.\n`,
            ok: false,
          };
        }
        allowedDiagnosticCodes.push(code);
      }

      return {
        ok: true,
        options: {
          allowedDiagnosticCodes,
          check: invocation.options.check,
          emitClientFiles: invocation.options.emitClientFiles,
          ...(invocation.options.factsOut === undefined
            ? {}
            : { factsOutPath: invocation.options.factsOut }),
          fixpoint: invocation.options.fixpoint,
          ...(invocation.options.fileName === undefined
            ? {}
            : { fileName: invocation.options.fileName }),
          outPath: invocation.options.out,
          ...(invocation.options.queryShapeFacts === undefined
            ? {}
            : { queryShapeFactsPath: invocation.options.queryShapeFacts }),
          ...(invocation.options.registryFacts === undefined
            ? {}
            : { registryFactsPath: invocation.options.registryFacts }),
          renderEquivalence: invocation.options.renderEquivalence,
          sourcePath: invocation.arguments.source,
          target: 'component',
        },
      };
    }
    case 'route': {
      const componentImportRewrites: RouteComponentImportRewrite[] = [];
      for (const value of invocation.options.rewrite) {
        const rewrite = parseRouteRewrite(value);
        if (!rewrite.ok) return rewrite;
        componentImportRewrites.push(rewrite.value);
      }

      return {
        ok: true,
        options: {
          ...(invocation.options.artifactFileName === undefined
            ? {}
            : { artifactFileName: invocation.options.artifactFileName }),
          check: invocation.options.check,
          componentImportRewrites,
          ...(invocation.options.factsOut === undefined
            ? {}
            : { factsOutPath: invocation.options.factsOut }),
          ...(invocation.options.fileName === undefined
            ? {}
            : { fileName: invocation.options.fileName }),
          outPath: invocation.options.out,
          sourcePath: invocation.arguments.source,
          target: 'route',
        },
      };
    }
    case 'graph':
      return {
        ok: true,
        options: {
          check: invocation.options.check,
          inputPath: invocation.arguments.input,
          outPath: invocation.options.out,
          target: 'graph',
        },
      };
    case 'mutation-inputs':
      return {
        ok: true,
        options: {
          check: invocation.options.check,
          ...(invocation.options.fileName === undefined
            ? {}
            : { fileName: invocation.options.fileName }),
          outPath: invocation.options.out,
          sourcePath: invocation.arguments.source,
          target: 'mutation-inputs',
        },
      };
    case 'drizzle-static':
      return {
        ok: true,
        options: {
          check: invocation.options.check,
          inputPath: invocation.arguments.input,
          outPath: invocation.options.out,
          target: 'drizzle-static',
        },
      };
    case 'drizzle-optimistic':
      return {
        ok: true,
        options: {
          check: invocation.options.check,
          ...(invocation.options.factsOut === undefined
            ? {}
            : { factsOutPath: invocation.options.factsOut }),
          inputPath: invocation.arguments.input,
          outPath: invocation.options.out,
          target: 'drizzle-optimistic',
        },
      };
    case 'package-css':
      return {
        ok: true,
        options: {
          check: invocation.options.check,
          ...(invocation.options.entry === undefined
            ? {}
            : { entryPath: invocation.options.entry }),
          outPath: invocation.options.out,
          packageName: invocation.arguments.package,
          target: 'package-css',
        },
      };
  }
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
      exitCode: error instanceof CompileConfigurationError ? 2 : 1,
    };
  }
}

async function runCompileComponentCommand(
  options: CompileComponentCommandOptions,
): Promise<CliCommandResult> {
  const { assertFixpoint, assertRenderEquivalence } = await import('@kovojs/compiler');
  const compileOptions: CompileComponentOptions = {
    fileName: options.fileName ?? options.sourcePath,
    source: readCompileInputFile(options.sourcePath),
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
  const result = await compileFrameworkComponentModule(compileOptions);
  assertCompileResultDiagnostics(result.diagnostics, 'CLI component compiler diagnostics');
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
      source: `${JSON.stringify(
        {
          componentGraphFacts: result.componentGraphFacts,
          publishToClientFacts: result.publishToClientFacts,
          taskGraphFacts: result.taskGraphFacts,
        },
        null,
        2,
      )}\n`,
    });
  }
  if (options.emitClientFiles) {
    for (const file of result.files) {
      if (file.kind === 'client') {
        artifacts.push({
          kind: 'client',
          path: join(dirname(options.outPath), basename(file.fileName)),
          source: file.source,
        });
      }
    }
  }

  return await compileArtifactsResult(options.check, artifacts, warningLines(warnings), warnings);
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
    source: readCompileInputFile(options.sourcePath),
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
  return await compileArtifactsResult(options.check, artifacts);
}

async function runCompileGraphCommand(
  options: CompileGraphCommandOptions,
): Promise<CliCommandResult> {
  const { deriveAppGraph } = await import('@kovojs/compiler/graph');
  const result = deriveAppGraph(
    readJsonFile(options.inputPath) as Parameters<typeof deriveAppGraph>[0],
  );
  if (result.diagnostics.length > 0) return compileDiagnosticResult(result.diagnostics);
  return await compileArtifactResult(
    options,
    `${JSON.stringify(result.graph, null, 2)}\n`,
    'graph',
  );
}

async function runCompileMutationInputsCommand(
  options: CompileMutationInputsCommandOptions,
): Promise<CliCommandResult> {
  const { mutationInputFactsFromSource } = await import('@kovojs/compiler/internal');
  const facts = Object.fromEntries(
    [
      ...mutationInputFactsFromSource(
        options.fileName ?? options.sourcePath,
        readCompileInputFile(options.sourcePath),
      ).values(),
    ].map((fact) => [
      fact.key,
      fact.fields.map((field) => ({
        ...field,
        provenance: 'registry' as const,
      })),
    ]),
  );
  return await compileArtifactResult(
    options,
    `${JSON.stringify(facts, null, 2)}\n`,
    'mutation-inputs',
  );
}

type DrizzleOptimisticEntryStatus = 'await-fragment' | 'derived' | 'hand-written';

interface DrizzleStaticCommandInput {
  extract?: readonly (
    | 'algebraicShapes'
    | 'capabilities'
    | 'cookieDowngrades'
    | 'materializedViewRefreshFacts'
    | 'ownerAudit'
    | 'queryFacts'
    | 'revealed'
    | 'sqlSafetyDiagnostics'
    | 'symbolicEffects'
    | 'touchGraph'
    | 'trustEscapes'
    | 'unregisteredSinks'
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
    analyzeSqlSafetyFromProject,
    collectCapabilityEscapesFromProject,
    collectCookieDowngradesFromProject,
    collectRuntimeRevealAuditFromProject,
    collectTrustEscapesFromProject,
    collectUnregisteredSinksFromProject,
    deriveInvalidationRegistry,
    deriveMutationTouchRegistry,
    extractAlgebraicShapesFromProject,
    extractMassAssignmentFromProject,
    extractGrantGraphFactsFromProject,
    extractMaterializedViewRefreshFactsFromProject,
    extractOwnerAuditFromProject,
    extractQueryFactsFromProject,
    extractQueryWriteReachabilityFromProject,
    extractToctouFromProject,
    extractSymbolicEffectsFromProject,
    extractTouchGraphFromProject,
    revealFactsFromQueryFacts,
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
        'capabilities',
        'cookieDowngrades',
        'grantGraph',
        'massAssignmentFacts',
        'materializedViewRefreshFacts',
        'ownerAudit',
        'queryFacts',
        'queryWriteReachability',
        'revealed',
        'sqlSafetyDiagnostics',
        'symbolicEffects',
        'toctouFacts',
        'touchGraph',
        'trustEscapes',
        'unregisteredSinks',
      ],
    );
    let queryFacts: ReturnType<typeof extractQueryFactsFromProject> | undefined;
    const getQueryFacts = () => (queryFacts ??= extractQueryFactsFromProject({ files }));

    if (extract.has('touchGraph')) output.touchGraph = extractTouchGraphFromProject({ files });
    if (extract.has('ownerAudit')) {
      // SPEC §10.1/§10.3: owner-domain facts + IDOR scope audits the graph emission
      // feeds to `kovo check` (KV414).
      const ownerAudit = extractOwnerAuditFromProject({ files });
      output.ownerDomains = ownerAudit.ownerDomains;
      output.scopeAudits = ownerAudit.scopeAudits;
    }
    if (extract.has('massAssignmentFacts')) {
      // SPEC §11.1 / secure-framework Phase 3: governed-column mass-assignment facts
      // the graph emission feeds to `kovo check` (KV438).
      output.massAssignmentFacts = extractMassAssignmentFromProject({ files });
    }
    if (extract.has('grantGraph')) {
      output.grants = extractGrantGraphFactsFromProject({ files });
    }
    if (extract.has('queryWriteReachability')) {
      // SPEC §6.6/§9.4 / secure-framework Phase 5: query-loader write-reachability facts
      // the graph emission feeds to `kovo check` (KV433 Stage 2).
      output.queryWriteReachability = extractQueryWriteReachabilityFromProject({ files });
    }
    if (extract.has('toctouFacts')) {
      // SPEC §10.3/§11.1 / secure-framework Phase 6: lost-update (TOCTOU) facts the graph
      // emission feeds to `kovo check` (KV429).
      output.toctouFacts = extractToctouFromProject({ files });
    }
    if (extract.has('materializedViewRefreshFacts')) {
      output.materializedViewRefreshFacts = extractMaterializedViewRefreshFactsFromProject({
        files,
      });
    }
    if (extract.has('queryFacts')) {
      output.queryFacts = getQueryFacts();
      output.queryDomains = queryDomainsFromStaticFacts(getQueryFacts());
    }
    if (extract.has('revealed')) {
      const queryReveals = revealFactsFromQueryFacts(getQueryFacts());
      const runtimeAudit = collectRuntimeRevealAuditFromProject({ files });
      output.revealed = mergeDrizzleStaticRevealFacts(queryReveals, runtimeAudit.revealed);
      appendDrizzleStaticDiagnostics(output, runtimeAudit.diagnostics);
    }
    if (extract.has('sqlSafetyDiagnostics')) {
      output.sqlSafetyDiagnostics = analyzeSqlSafetyFromProject({ files });
    }
    if (extract.has('trustEscapes')) {
      // SPEC §6.6 (audit-only): every app-authored trust escape (trustedHtml/Url/Sql, raw
      // endpoint(), webhook({verify:'none'})) rides into `graph.trustEscapes` so
      // `kovo explain trust` enumerates the trust surface and KV426 surfaces missing justifications.
      output.trustEscapes = collectTrustEscapesFromProject({ files });
    }
    if (extract.has('capabilities')) {
      // SPEC §6.6 (audit-only), threat-matrix-plan.md M3: every app-authored escape-hatch CALL SITE
      // (serverValue/trustedAssign/unsafeRegex/declarePublicRelation/usePostgresSystemDb/
      // accept.unverified/unsafeCookie/crossOwnerRead/rawRead/actAs/declareSystemRead|Write/egress
      // allowInternal) rides into `graph.capabilities` so `kovo explain capabilities` enumerates
      // the whole intentional-security-hole surface from one place, mirroring `publishToClient`.
      output.capabilities = collectCapabilityEscapesFromProject({ files });
    }
    if (extract.has('cookieDowngrades')) {
      // SPEC §6.6/§9.1 (audit-only): every `serializeCookie(..., { unsafe: unsafeCookie(...) })`
      // credential-cookie downgrade rides into `graph.cookieDowngrades` so `kovo explain cookies`
      // surfaces the weakened floor statically (previously only the runtime drain populated it).
      output.cookieDowngrades = collectCookieDowngradesFromProject({ files });
    }
    if (extract.has('unregisteredSinks')) {
      // SPEC §5.2/§6.6: standalone static extraction follows the same compiler-owned finite
      // handler graph as `kovo build`. The exact supplied byte snapshot supplies both framework
      // identity and semantic summaries; TASK B keeps its non-handler request/process coverage.
      const staticInputDirectory = dirname(resolve(options.inputPath));
      const staticInputManifest =
        findNearestPackageJson(staticInputDirectory) ?? findNearestPackageJson(process.cwd());
      const staticInputRoot =
        staticInputManifest === undefined ? staticInputDirectory : dirname(staticInputManifest);
      const compilerVerdict = await compileStaticHandlerSecurityVerdict(
        files,
        staticInputRoot,
        resolve(staticInputRoot, files[0]?.fileName ?? 'app.ts'),
      );
      if (compilerVerdict.diagnostics.length > 0) {
        appendDrizzleStaticDiagnostics(output, compilerVerdict.diagnostics);
      }
      output.unregisteredSinks = collectUnregisteredSinksFromProject({
        compilerSecuritySemanticSources: compilerVerdict.semanticSources,
        compilerTaskBClosure: {
          capabilityFacts: compilerVerdict.capabilityClosure.facts,
          dependencyManifest: compilerVerdict.capabilityClosure.dependencyManifest,
          finiteVerdict: compilerVerdict.finiteVerdict,
          files,
          schema: 'kovo-task-b-closure/v2',
        },
        files,
      });
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
    if (touchGraph === undefined) {
      throw new CompileConfigurationError('drizzle-static invalidation requires touchGraph');
    }
    if (queries === undefined) {
      throw new CompileConfigurationError('drizzle-static invalidation requires queries');
    }
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
    if (touchGraph === undefined) {
      throw new CompileConfigurationError('drizzle-static serializeTouchGraph requires touchGraph');
    }
    const source = serializeTouchGraph(touchGraph);
    output.touchGraphSource =
      input.serializeTouchGraph.exportName === undefined
        ? source
        : source.replace(
            'export const touchGraph =',
            `export const ${input.serializeTouchGraph.exportName} =`,
          );
  }

  const artifact = await compileArtifactResult(
    options,
    `${JSON.stringify(output, null, 2)}\n`,
    'drizzle-static',
  );

  // SPEC §10.2/§11.2: the SQL-safety analyzer is by-construction sound but, until now, gated
  // nothing — unsafe raw SQL shipped green. An error-severity KV422 in `sqlSafetyDiagnostics` means
  // request-derived/unproven data could reach executable SQL text on a managed DB handle, so the
  // drizzle-static extraction MUST surface a nonzero exit. The artifact (facts JSON) is still
  // written so the diagnostics flow downstream into the check graph; we override only the exit code
  // and append the KV422 finding lines to the output. (`kovo check` independently re-gates these
  // via the KV422 finding family once the facts ride into the graph JSON — see graph-output.ts.)
  const sqlSafetyErrors = sqlSafetyDiagnosticErrors(output.sqlSafetyDiagnostics);
  const revealAuditErrors = staticDiagnosticErrors(output.diagnostics, 'KV426');
  const staticErrorOutput = [...sqlSafetyErrors, ...revealAuditErrors]
    .map((diagnostic) => `ERROR ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`)
    .join('\n');
  const sqlSafetyExit = drizzleStaticSqlSafetyErrorExit([...sqlSafetyErrors, ...revealAuditErrors]);
  if (sqlSafetyExit && artifact.exitCode === 0) {
    return {
      ...artifact,
      ...sqlSafetyExit,
      output: `${(artifact.output ?? '').replace(/\n+$/, '')}\n${staticErrorOutput}\n`,
    };
  }

  return artifact;
}

interface StaticHandlerSecurityVerdict {
  capabilityClosure: import('@kovojs/compiler/internal').AnalyzeCapabilityClosureResult;
  diagnostics: CoreGraph.StaticDiagnosticFact[];
  finiteVerdict: import('@kovojs/drizzle/internal/static').CompilerTaskBFiniteVerdict;
  semanticSources: {
    fileName: string;
    graphs: NonNullable<CoreGraph.ComponentExplain['securitySemanticGraph']>[];
    operations: import('@kovojs/drizzle/internal/static').CompilerTaskBSourceOperation[];
    source: string;
  }[];
}

function appendCompileTaskBFiniteDiagnostics(
  compilerDiagnostics: CompileResult['diagnostics'],
  diagnostics: CoreGraph.StaticDiagnosticFact[],
  blockingDiagnostics: CoreGraph.StaticDiagnosticFact[],
): void {
  for (const diagnostic of compilerDiagnostics) {
    if (diagnostic.code !== 'KV449' && diagnostic.code !== 'KV450' && diagnostic.code !== 'KV452') {
      continue;
    }
    const fact: CoreGraph.StaticDiagnosticFact = {
      code: diagnostic.code,
      ...(diagnostic.length === undefined ? {} : { length: diagnostic.length }),
      message: diagnostic.message,
      severity: diagnostic.severity ?? 'error',
      site: diagnostic.fileName,
      ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
    };
    diagnostics.push(fact);
    blockingDiagnostics.push(fact);
  }
}

async function compileStaticHandlerSecurityVerdict(
  files: readonly { fileName: string; source: string }[],
  root: string,
  importerPath: string,
): Promise<StaticHandlerSecurityVerdict> {
  const { compileRouteModule } = await import('@kovojs/compiler');
  const {
    analyzeCapabilityClosure,
    collectCapabilityPackageRequests,
    componentTaskBSourceOperationFacts,
    compilerGeneratedCapabilityDependencies,
    parseComponentModule,
  } = await import('@kovojs/compiler/internal');
  const { snapshotCompilerTaskBFiniteVerdict } = await import('@kovojs/drizzle/internal/static');
  const diagnostics: CoreGraph.StaticDiagnosticFact[] = [];
  const blockingDiagnostics: CoreGraph.StaticDiagnosticFact[] = [];
  const compilerDependencies: import('@kovojs/compiler/internal').CompilerGeneratedCapabilityDependency[] =
    [];
  const semanticSources: StaticHandlerSecurityVerdict['semanticSources'] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    const extraFiles = files.filter((_, candidateIndex) => candidateIndex !== index);
    const options = {
      ...(extraFiles.length === 0 ? {} : { extraFiles }),
      fileName: file.fileName,
      source: file.source,
      sourceProvenance: 'app',
    } as CompileComponentOptions & {
      readonly extraFiles?: readonly { fileName: string; source: string }[];
    };
    const result: CompileResult = await compileFrameworkComponentModule(options);
    assertCompileResultDiagnostics(
      result.diagnostics,
      `CLI static handler diagnostics for ${file.fileName}`,
    );
    const routeResult = compileRouteModule({ fileName: file.fileName, source: file.source });
    assertCompileResultDiagnostics(
      routeResult.diagnostics,
      `CLI static route diagnostics for ${file.fileName}`,
    );
    appendCompileTaskBFiniteDiagnostics(result.diagnostics, diagnostics, blockingDiagnostics);
    appendCompileTaskBFiniteDiagnostics(routeResult.diagnostics, diagnostics, blockingDiagnostics);
    const loweredSources = [
      result.loweredSource,
      ...routeResult.files.map((routeFile) => routeFile.source),
    ];
    for (const loweredSource of loweredSources) {
      for (const dependency of compilerGeneratedCapabilityDependencies({
        authoredSource: file.source,
        fileName: file.fileName,
        loweredSource,
      })) {
        compilerDependencies.push(dependency);
      }
    }
    semanticSources.push({
      fileName: file.fileName,
      graphs: result.componentGraphFacts.flatMap((fact) =>
        fact.securitySemanticGraph === undefined ? [] : [fact.securitySemanticGraph],
      ),
      operations: componentTaskBSourceOperationFacts(
        parseComponentModule(
          file.fileName,
          file.source,
          extraFiles.length === 0 ? {} : { frameworkIdentityFiles: extraFiles },
        ),
      ),
      source: file.source,
    });
  }
  const packageRequests = collectCapabilityPackageRequests(files, compilerDependencies);
  const capabilityClosure = analyzeCapabilityClosure({
    compilerDependencies,
    files,
    packageSummaries: readCapabilityPackageSummaries(root),
    packages: resolveCapabilityPackages(packageRequests, importerPath),
  });
  assertCompileResultDiagnostics(
    capabilityClosure.diagnostics,
    'CLI static capability-closure diagnostics',
  );
  for (const diagnostic of capabilityClosure.diagnostics) {
    diagnostics.push({
      code: diagnostic.code,
      ...(diagnostic.length === undefined ? {} : { length: diagnostic.length }),
      message: diagnostic.message,
      severity: diagnostic.severity ?? 'error',
      site: diagnostic.fileName,
      ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
    });
  }
  return {
    capabilityClosure,
    diagnostics,
    finiteVerdict: snapshotCompilerTaskBFiniteVerdict({
      blockingDiagnostics,
      semanticSources,
    }),
    semanticSources,
  };
}

/** Internal executable seam for the TASK B caller-carrier mutation gate (SPEC §6.6). */
export async function snapshotCompileCompilerTaskBFiniteVerdictForTests(
  files: readonly { readonly fileName: string; readonly source: string }[],
  root: string,
  importerPath: string,
): Promise<import('@kovojs/drizzle/internal/static').CompilerTaskBFiniteVerdict> {
  return (await compileStaticHandlerSecurityVerdict(files, root, importerPath)).finiteVerdict;
}

interface SqlSafetyDiagnosticLike {
  code: string;
  message?: string;
  severity?: string;
  site: string;
}

function staticDiagnosticErrors(value: unknown, code: string): SqlSafetyDiagnosticLike[] {
  return sqlSafetyDiagnosticErrors(value).filter((diagnostic) => diagnostic.code === code);
}

function appendDrizzleStaticDiagnostics(
  output: Record<string, unknown>,
  diagnostics: readonly CoreGraph.StaticDiagnosticFact[],
): void {
  if (diagnostics.length === 0) return;
  const existing = Array.isArray(output.diagnostics)
    ? (output.diagnostics as readonly CoreGraph.StaticDiagnosticFact[])
    : [];
  output.diagnostics = [...existing, ...diagnostics];
}

function mergeDrizzleStaticRevealFacts(
  queryReveals: readonly CoreGraph.RevealExplainFact[],
  runtimeReveals: readonly CoreGraph.RevealExplainFact[],
): CoreGraph.RevealExplainFact[] {
  const queryCallIdentities = new Set(
    queryReveals.flatMap((reveal) =>
      reveal.callIdentity === undefined ? [] : [reveal.callIdentity],
    ),
  );
  return [
    ...queryReveals,
    ...runtimeReveals.filter((reveal) => {
      return reveal.callIdentity === undefined || !queryCallIdentities.has(reveal.callIdentity);
    }),
  ]
    .map(withoutRevealCallIdentity)
    .sort(
      (left, right) =>
        left.query.localeCompare(right.query) ||
        left.path.localeCompare(right.path) ||
        left.site.localeCompare(right.site),
    );
}

function withoutRevealCallIdentity(
  reveal: CoreGraph.RevealExplainFact,
): CoreGraph.RevealExplainFact {
  const { callIdentity: _callIdentity, ...fact } = reveal;
  return fact;
}

/**
 * SPEC §10.2/§11.2: extract the error-severity KV422 SQL-safety diagnostics produced by
 * `analyzeSqlSafetyFromProject`. These are the by-construction findings that, when present, mean
 * unproven data could reach executable SQL text on a managed DB handle and so must fail the build.
 */
function sqlSafetyDiagnosticErrors(value: unknown): SqlSafetyDiagnosticLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (diagnostic): diagnostic is SqlSafetyDiagnosticLike =>
      typeof diagnostic === 'object' &&
      diagnostic !== null &&
      typeof (diagnostic as { code?: unknown }).code === 'string' &&
      typeof (diagnostic as { site?: unknown }).site === 'string' &&
      // Default to error when severity is absent: KV422 is an error-severity diagnostic (SPEC §10.2).
      ((diagnostic as { severity?: unknown }).severity ?? 'error') === 'error',
  );
}

interface DrizzleOptimisticCommandInput {
  complete?: boolean;
  constName: string;
  effects: readonly unknown[];
  entries: readonly {
    domains?: readonly string[];
    query: string;
    queryImport?: { name: string; path: string };
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
  mutationSource?: {
    fileName: string;
    source: string;
  };
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
  const authoredOptimisticStatuses = await authoredOptimisticStatusesFromInput(input);
  const facts: {
    derivation?: { proof?: DerivationProof; reason?: unknown; status: 'PUNTED' | 'derived' };
    query: string;
    status: DrizzleOptimisticEntryStatus;
  }[] = [];

  for (const entry of input.entries) {
    const status =
      authoredOptimisticStatuses.get(entry.query) ??
      entry.status ??
      (matviewAwaitFragmentQueries.has(entry.query) ? 'await-fragment' : 'derived');
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
      facts.push({
        derivation: {
          proof: derivationProofForResult(
            result,
            input.effects as readonly SymbolicEffect[],
            entry.shape as AlgebraicQueryShape,
          ),
          status: 'derived',
        },
        query: entry.query,
        status,
      });
      continue;
    }

    facts.push({
      ...(result.kind === 'punt'
        ? {
            derivation: {
              proof: derivationProofForResult(
                result,
                input.effects as readonly SymbolicEffect[],
                entry.shape as AlgebraicQueryShape,
              ),
              reason: result.reason,
              status: 'PUNTED' as const,
            },
          }
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
          authoredOptimisticStatuses.get(entry.query) ??
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
    queryValueImports: input.entries.flatMap((entry) =>
      entry.queryImport === undefined ? [] : [{ ...entry.queryImport, query: entry.query }],
    ),
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
  return await compileArtifactsResult(options.check, artifacts);
}

async function authoredOptimisticStatusesFromInput(
  input: DrizzleOptimisticCommandInput,
): Promise<ReadonlyMap<string, DrizzleOptimisticEntryStatus>> {
  const mutationSource = input.mutationSource;
  if (!mutationSource) return new Map();

  const { inlineOptimisticPlansFromSource } = await import('@kovojs/compiler/internal');
  const plans = inlineOptimisticPlansFromSource(mutationSource.fileName, mutationSource.source, {
    resolveStaticImport: resolveLocalStaticImport,
  });
  const matchingPlans =
    input.mutation === undefined ? plans : plans.filter((plan) => plan.mutation === input.mutation);
  const selectedPlans = matchingPlans.length > 0 ? matchingPlans : plans;

  const statuses = new Map<string, DrizzleOptimisticEntryStatus>();
  for (const plan of selectedPlans) {
    for (const transform of plan.transforms) {
      statuses.set(transform.query, transform.status);
    }
  }
  return statuses;
}

function resolveLocalStaticImport(
  fromFileName: string,
  moduleSpecifier: string,
): { fileName: string; source: string } | null {
  if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) return null;
  const fromPath = resolve(fromFileName);
  const basePath = resolve(dirname(fromPath), moduleSpecifier);
  for (const candidate of localImportCandidates(basePath)) {
    if (!existsSync(candidate)) continue;
    return {
      fileName: normalizePath(relative(process.cwd(), candidate)),
      source: readFileSync(candidate, 'utf8'),
    };
  }
  return null;
}

function localImportCandidates(basePath: string): string[] {
  const candidates = new Set<string>();
  candidates.add(basePath);

  const extension = extname(basePath);
  if (extension === '.js' || extension === '.jsx' || extension === '.mjs' || extension === '.cjs') {
    const withoutExtension = basePath.slice(0, -extension.length);
    for (const replacement of ['.ts', '.tsx', '.mts', '.cts']) {
      candidates.add(`${withoutExtension}${replacement}`);
    }
  }

  for (const extensionCandidate of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']) {
    candidates.add(`${basePath}${extensionCandidate}`);
    candidates.add(join(basePath, `index${extensionCandidate}`));
  }
  return [...candidates];
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function derivationProofForResult(
  result: DerivationResult,
  effects: readonly SymbolicEffect[],
  shape: AlgebraicQueryShape,
): DerivationProof {
  return compactProof({
    level:
      result.kind === 'derived'
        ? derivedProofLevel(result.program.ops)
        : puntProofLevel(result.reason),
    privateScope: privateScopesForDerivation(effects, shape),
  });
}

function compactProof(proof: DerivationProof): DerivationProof {
  const privateScope = proof.privateScope?.filter(
    (entry, index, all) => all.indexOf(entry) === index,
  );
  return privateScope && privateScope.length > 0
    ? { level: proof.level, privateScope }
    : { level: proof.level };
}

function derivedProofLevel(ops: readonly PatchOp[]): DerivationProofLevel {
  if (ops.some((op) => op.op === 'remove-row' || op.op === 'update-row')) return 'exact-row';
  if (ops.some((op) => op.op === 'push-row')) return 'membership-filter';
  return 'scoped-rowset';
}

function puntProofLevel(reason: PuntReason): DerivationProofLevel {
  switch (reason.code) {
    case 'membership-entry':
    case 'no-row-witness':
      return 'membership-filter';
    case 'non-key-match':
    case 'partial-key':
      return 'table-level';
    case 'interprocedural':
    case 'mixed-disjunction':
    case 'opaque-orderby':
    case 'opaque-projection':
    case 'opaque-set':
    case 'opaque-shape':
    case 'unsupported':
    case 'untraceable-param':
      return 'opaque';
  }
}

function privateScopesForDerivation(
  effects: readonly SymbolicEffect[],
  shape: AlgebraicQueryShape,
): string[] {
  const scopes: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const kind = record.kind;
    if (
      (kind === 'guard' || kind === 'session' || kind === 'tenant') &&
      typeof record.path === 'string'
    ) {
      scopes.push(`${kind}:${record.path}`);
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const item of child) visit(item);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };

  for (const effect of effects) visit(effect);
  visit(shape);
  return scopes.sort();
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
    source:
      options.entryPath === undefined
        ? existsSync(entryPath)
          ? readFileSync(entryPath, 'utf8')
          : ''
        : readCompileInputFile(entryPath),
  });
  if (!result.css) throw new Error(`no CSS extracted for ${options.packageName}`);

  const lines = await compileArtifactLines(options, result.css, 'package-css');
  for (const diagnostic of result.diagnostics) {
    lines.splice(
      -1,
      0,
      `WARN package-css file=${JSON.stringify(diagnostic.fileName)} ${stableText(diagnostic.message)}`,
    );
  }
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

async function compileArtifactResult(
  options: CompileBaseOptions,
  source: string,
  kind: CompileTarget,
): Promise<CliCommandResult> {
  return {
    exitCode: 0,
    output: `${(await compileArtifactLines(options, source, kind)).join('\n')}\n`,
  };
}

interface CompileArtifact {
  kind: string;
  path: string;
  source: string;
}

async function compileArtifactsResult(
  check: boolean,
  artifacts: readonly CompileArtifact[],
  warnings: readonly string[] = [],
  diagnostics: CompileResult['diagnostics'] = [],
): Promise<CliCommandResult> {
  const lines = [compileCommandOutputVersion];
  for (const artifact of artifacts) {
    lines.push(...(await compileArtifactActionLines(check, artifact)));
  }
  lines.push(...warnings, `SUMMARY artifacts=${artifacts.length} diagnostics=${warnings.length}`);
  return {
    ...(diagnostics.length === 0
      ? {}
      : {
          diagnostics: diagnostics.map((diagnostic) => projectKovoDiagnostic(diagnostic, 'build')),
        }),
    exitCode: 0,
    output: `${lines.join('\n')}\n`,
  };
}

async function compileArtifactLines(
  options: CompileBaseOptions,
  source: string,
  kind: CompileTarget,
): Promise<string[]> {
  return [
    compileCommandOutputVersion,
    ...(await compileArtifactActionLines(options.check, {
      kind,
      path: options.outPath,
      source,
    })),
    `SUMMARY artifacts=1 diagnostics=0`,
  ];
}

async function compileArtifactActionLines(
  check: boolean,
  artifact: CompileArtifact,
): Promise<string[]> {
  const target = resolve(artifact.path);
  const output = createFrameworkOutputFileSystemBoundary(dirname(target));
  const relativeTarget = basename(target);
  if (check) {
    const currentBytes = await output.fileBytes(relativeTarget);
    if (currentBytes === undefined) {
      throw new Error(`${artifact.kind} artifact ${target} is missing or outside its output root`);
    }
    const current = Buffer.from(currentBytes).toString('utf8');
    if (current !== artifact.source) {
      throw new Error(`${artifact.kind} artifact ${target} is stale; rerun without --check`);
    }
    return [
      `CHECK ${artifact.kind} path=${JSON.stringify(target)} status=current bytes=${byteLength(artifact.source)}`,
    ];
  }
  await output.ensureDirectory();
  await output.writeFile(relativeTarget, artifact.source);
  return [
    `WRITE ${artifact.kind} path=${JSON.stringify(target)} bytes=${byteLength(artifact.source)}`,
  ];
}

function warningLines(diagnostics: CompileResult['diagnostics']): string[] {
  assertCompileResultDiagnostics(diagnostics, 'CLI warning diagnostics');
  return diagnostics.map(
    (diagnostic) =>
      `WARN ${diagnostic.code} file=${JSON.stringify(diagnostic.fileName)} ${stableText(diagnostic.message)}`,
  );
}

function compileDiagnosticResult(diagnostics: CompileResult['diagnostics']): CliCommandResult {
  assertCompileResultDiagnostics(diagnostics, 'CLI blocking compiler diagnostics');
  return {
    diagnostics: diagnostics.map((diagnostic) => projectKovoDiagnostic(diagnostic, 'build')),
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

function assertCompileResultDiagnostics(
  diagnostics: CompileResult['diagnostics'],
  label: string,
): void {
  for (let index = 0; index < diagnostics.length; index += 1) {
    assertRegisteredDiagnostic(diagnostics[index], `${label}[${index}]`);
  }
}

class CompileConfigurationError extends Error {}

function readCompileInputFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new CompileConfigurationError(
      `cannot read input ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new CompileConfigurationError(
      `cannot read JSON input ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function queryDomainsFromStaticFacts(
  facts: readonly {
    query: string;
    readProvenance?: readonly CoreGraph.QueryReadProvenance[];
    reads: readonly string[];
    site: string;
  }[],
): CoreGraph.QueryReadSet[] {
  return [...facts]
    .sort((left, right) => siteLineNumber(left.site) - siteLineNumber(right.site))
    .map((fact) => {
      const readProvenance = fact.readProvenance;
      return {
        domains: [...fact.reads],
        query: fact.query,
        ...(readProvenance !== undefined && readProvenance.length > 0 ? { readProvenance } : {}),
      };
    });
}

function siteLineNumber(site: string): number {
  return Number(String(site).split(':').pop() ?? 0);
}
