import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { lifecyclePolicyDiagnostic, type KovoDiagnosticSourceAnchor } from '../diagnostic.js';
import type { CliCommandResult } from '../shared.js';

type LifecyclePolicyProtocol = 'kovo-build/v1' | 'kovo-check/v1';
const MAX_POLICY_FILE_BYTES = 1024 * 1024;
const EXPECTED_PACKAGE_MANAGER = 'pnpm@10.12.1';
const EXPECTED_IGNORED_DEPENDENCIES = ['esbuild'] as const;
const REVIEWED_NATIVE_PINS = {
  '@node-rs/argon2': '2.0.2',
  'better-sqlite3': '12.11.1',
} as const;

interface LifecyclePolicyContext {
  readonly manifestPath: string;
  readonly manifestSource: string;
  readonly npmrcPath: string;
  readonly npmrcSource: string;
  readonly root: string;
  readonly workspacePath: string;
  readonly workspaceSource?: string;
}

class LifecyclePolicyFinding extends Error {
  readonly source?: KovoDiagnosticSourceAnchor;

  constructor(message: string, source?: KovoDiagnosticSourceAnchor) {
    super(message);
    if (source !== undefined) this.source = source;
  }
}

/**
 * Verify the generated app's dependency-lifecycle door without evaluating authored modules.
 *
 * This command is intentionally usable after an `--ignore-scripts` bootstrap install and before
 * `pnpm rebuild`, so CI can authenticate the allowlist before any dependency lifecycle script
 * executes (SPEC §2).
 */
export function runLifecyclePolicyCheck(
  rootValue: string,
  protocol: LifecyclePolicyProtocol = 'kovo-check/v1',
): CliCommandResult {
  const root = realProjectRoot(rootValue);
  const manifestPath = resolve(root, 'package.json');
  const npmrcPath = resolve(root, '.npmrc');
  const workspacePath = resolve(root, 'pnpm-workspace.yaml');
  let context: LifecyclePolicyContext;

  try {
    context = {
      manifestPath,
      manifestSource: readPolicyFile(root, manifestPath, true),
      npmrcPath,
      npmrcSource: readPolicyFile(root, npmrcPath, true),
      root,
      workspacePath,
      ...(existsSync(workspacePath)
        ? { workspaceSource: readPolicyFile(root, workspacePath, false) }
        : {}),
    };
    validateLifecyclePolicy(context);
  } catch (error) {
    const finding =
      error instanceof LifecyclePolicyFinding
        ? error
        : new LifecyclePolicyFinding(error instanceof Error ? error.message : String(error));
    const diagnostic = lifecyclePolicyDiagnostic(finding.message, finding.source);
    return {
      diagnostics: [diagnostic],
      exitCode: 1,
      output: `${protocol}\nERROR LIFECYCLE-POLICY ${finding.message}\n`,
    };
  }

  return {
    exitCode: 0,
    output: `${protocol}\nOK LIFECYCLE-POLICY package-manager=${EXPECTED_PACKAGE_MANAGER} allowed=${allowedDependencies(
      context.manifestSource,
    ).join(',')} ignored=${EXPECTED_IGNORED_DEPENDENCIES.join(',')}\n`,
  };
}

/** @internal Whether this project opted into the framework-owned strict lifecycle contract. */
export function declaresKovoLifecyclePolicy(rootValue: string): boolean {
  const root = realProjectRoot(rootValue);
  const manifestPath = resolve(root, 'package.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const source = readPolicyFile(root, manifestPath, true);
    const manifest = parseJsonRecord(source, manifestPath);
    const kovo = isRecord(manifest.kovo) ? manifest.kovo : undefined;
    return kovo?.lifecyclePolicy === 'strict-v1';
  } catch {
    // The source/type/config path owns malformed non-enrolled manifests. Explicit
    // `kovo check lifecycle` remains fail-closed and reports the exact policy error.
    return false;
  }
}

function validateLifecyclePolicy(context: LifecyclePolicyContext): void {
  const manifest = parseJsonRecord(context.manifestSource, context.manifestPath);
  const dependencies = ownRecord(manifest, 'dependencies', context);
  const pnpm = ownRecord(manifest, 'pnpm', context);
  const overrides = ownRecord(pnpm, 'overrides', context);
  const expectedAllowed = Object.hasOwn(dependencies, 'better-sqlite3')
    ? (['@node-rs/argon2', 'better-sqlite3'] as const)
    : (['@node-rs/argon2'] as const);

  requireExactValue(
    manifest.packageManager,
    EXPECTED_PACKAGE_MANAGER,
    `packageManager must remain exactly ${EXPECTED_PACKAGE_MANAGER}`,
    sourceForKey(context.manifestPath, context.manifestSource, '"packageManager"'),
  );
  requireExactArray(
    pnpm.onlyBuiltDependencies,
    expectedAllowed,
    'pnpm.onlyBuiltDependencies must equal the reviewed lifecycle build allowlist',
    sourceForKey(context.manifestPath, context.manifestSource, '"onlyBuiltDependencies"'),
  );
  requireExactArray(
    pnpm.ignoredBuiltDependencies,
    EXPECTED_IGNORED_DEPENDENCIES,
    'pnpm.ignoredBuiltDependencies must equal the reviewed no-build list',
    sourceForKey(context.manifestPath, context.manifestSource, '"ignoredBuiltDependencies"'),
  );

  for (const name of expectedAllowed) {
    const expectedVersion = REVIEWED_NATIVE_PINS[name];
    requireExactValue(
      dependencies[name],
      expectedVersion,
      `${name} lifecycle permission requires the exact direct dependency pin ${expectedVersion}`,
      sourceForKey(context.manifestPath, context.manifestSource, JSON.stringify(name)),
    );
    requireExactValue(
      overrides[name],
      expectedVersion,
      `${name} lifecycle permission requires a graph-wide override to ${expectedVersion}`,
      sourceForKey(context.manifestPath, context.manifestSource, '"overrides"'),
    );
    for (const [selector, version] of Object.entries(overrides)) {
      if (overrideTargetsPackage(selector, name) && version !== expectedVersion) {
        fail(
          `${selector} may not override lifecycle-permitted ${name} away from ${expectedVersion}`,
          sourceForKey(context.manifestPath, context.manifestSource, JSON.stringify(selector)),
        );
      }
    }
  }

  for (const forbidden of [
    'allowBuilds',
    'dangerouslyAllowAllBuilds',
    'neverBuiltDependencies',
    'onlyBuiltDependenciesFile',
  ]) {
    if (Object.hasOwn(pnpm, forbidden)) {
      fail(
        `package.json pnpm.${forbidden} is outside the generated lifecycle policy`,
        sourceForKey(context.manifestPath, context.manifestSource, JSON.stringify(forbidden)),
      );
    }
  }

  const npmrc = readNpmrc(context);
  requireExactValue(
    npmrc.get('strict-dep-builds'),
    'true',
    'strict-dep-builds must be exactly true',
    sourceForKey(context.npmrcPath, context.npmrcSource, 'strict-dep-builds'),
  );
  requireExactValue(
    npmrc.get('dangerously-allow-all-builds'),
    'false',
    'dangerously-allow-all-builds must be exactly false',
    sourceForKey(context.npmrcPath, context.npmrcSource, 'dangerously-allow-all-builds'),
  );
  requireExactValue(
    npmrc.get('package-manager-strict-version'),
    'true',
    'package-manager-strict-version must be exactly true',
    sourceForKey(context.npmrcPath, context.npmrcSource, 'package-manager-strict-version'),
  );

  if (context.workspaceSource !== undefined) {
    const override = [
      'allowBuilds',
      'dangerouslyAllowAllBuilds',
      'ignoredBuiltDependencies',
      'neverBuiltDependencies',
      'onlyBuiltDependencies',
      'onlyBuiltDependenciesFile',
      'strictDepBuilds',
    ].find((name) => context.workspaceSource?.includes(name));
    if (override !== undefined) {
      fail(
        `pnpm-workspace.yaml must not override generated lifecycle setting ${override}`,
        sourceForKey(context.workspacePath, context.workspaceSource, override),
      );
    }
  }
}

function allowedDependencies(manifestSource: string): readonly string[] {
  const manifest = parseJsonRecord(manifestSource, 'package.json');
  const dependencies =
    isRecord(manifest.dependencies) && Object.hasOwn(manifest.dependencies, 'better-sqlite3')
      ? ['@node-rs/argon2', 'better-sqlite3']
      : ['@node-rs/argon2'];
  return dependencies;
}

function readPolicyFile(root: string, path: string, required: boolean): string {
  if (!existsSync(path)) {
    if (!required) return '';
    fail(`${relativeLabel(root, path)} is missing.`);
  }
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    fail(`${relativeLabel(root, path)} must be a regular file inside the project.`);
  }
  if (stats.size > MAX_POLICY_FILE_BYTES) {
    fail(`${relativeLabel(root, path)} exceeds the 1 MiB policy-file limit.`);
  }
  return readFileSync(path, 'utf8');
}

function realProjectRoot(value: string): string {
  const root = resolve(value);
  try {
    const stats = lstatSync(root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail('lifecycle policy root must be a real project directory.');
    }
    return realpathSync(root);
  } catch (error) {
    if (error instanceof LifecyclePolicyFinding) throw error;
    fail(
      `lifecycle policy root is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseJsonRecord(source: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value)) fail(`${path} must contain a JSON object.`);
  return value;
}

function ownRecord(
  record: Record<string, unknown>,
  key: string,
  context: LifecyclePolicyContext,
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    fail(
      `package.json ${key} must be an object`,
      sourceForKey(context.manifestPath, context.manifestSource, JSON.stringify(key)),
    );
  }
  return value;
}

function readNpmrc(context: LifecyclePolicyContext): Map<string, string> {
  const entries = new Map<string, string>();
  const lines = context.npmrcSource.split(/\r?\n/u);
  let offset = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length > 0 && !line.startsWith('#') && !line.startsWith(';')) {
      const separator = line.indexOf('=');
      if (separator <= 0) {
        fail('.npmrc entries must use key=value syntax.', {
          end: offset + rawLine.length,
          file: context.npmrcPath,
          start: offset,
        });
      }
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (entries.has(key)) {
        fail(
          `.npmrc must not repeat ${key}`,
          sourceForKey(context.npmrcPath, context.npmrcSource, key),
        );
      }
      entries.set(key, value);
    }
    offset += rawLine.length + 1;
  }
  return entries;
}

function requireExactArray(
  actual: unknown,
  expected: readonly string[],
  message: string,
  source?: KovoDiagnosticSourceAnchor,
): void {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    fail(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      source,
    );
  }
}

function requireExactValue(
  actual: unknown,
  expected: string,
  message: string,
  source?: KovoDiagnosticSourceAnchor,
): void {
  if (actual !== expected) {
    fail(`${message}; received ${JSON.stringify(actual)}`, source);
  }
}

function sourceForKey(
  file: string,
  source: string,
  needle: string,
): KovoDiagnosticSourceAnchor | undefined {
  const start = source.indexOf(needle);
  return start === -1 ? undefined : { end: start + needle.length, file, start };
}

function overrideTargetsPackage(selector: string, packageName: string): boolean {
  return (
    selector === packageName ||
    selector.startsWith(`${packageName}@`) ||
    selector.endsWith(`>${packageName}`) ||
    selector.includes(`>${packageName}@`)
  );
}

function relativeLabel(root: string, path: string): string {
  const label = relative(root, path);
  return label.length === 0 || label.startsWith('..') ? path : label;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string, source?: KovoDiagnosticSourceAnchor): never {
  throw new LifecyclePolicyFinding(message, source);
}
