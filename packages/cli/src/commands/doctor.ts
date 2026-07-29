import { execFileSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import {
  doctorFindingDiagnostic,
  type KovoDiagnosticFormat,
  type KovoDiagnosticRecord,
  type KovoDiagnosticSourceAnchor,
  type KovoDoctorDiagnosticCode,
} from '../diagnostic.js';
import { kovoInvocationEnvironmentValue } from '../invocation-environment.js';
import { type CliCommandResult } from '../shared.js';
import { isRecord } from '../tooling.js';
import type { KovoCommandSecurityDisposition } from './security-disposition.js';

const DOCTOR_PROTOCOL = 'kovo-doctor/v1';
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_SOURCE_FILES = 10_000;
const KOVO_PACKAGE_PREFIX = '@kovojs/';

/** @internal Boot-captured host controls kept injectable for contract tests. */
export const doctorHost = {
  accessSync,
  execFileSync,
};

export interface KovoDoctorOptions {
  readonly fix: boolean;
  readonly format: KovoDiagnosticFormat;
  readonly root: string;
}

type DoctorParseResult =
  | { readonly ok: true; readonly options: KovoDoctorOptions }
  | { readonly message: string; readonly ok: false };

interface DoctorContext {
  readonly configError?: string;
  readonly configPath?: string;
  readonly configSource?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly envPath: string;
  readonly envSource?: string;
  readonly fix: boolean;
  readonly manifest: Record<string, unknown>;
  readonly manifestPath: string;
  readonly manifestSource: string;
  readonly root: string;
}

interface DoctorFinding {
  readonly code: KovoDoctorDiagnosticCode;
  readonly message: string;
  readonly source?: KovoDiagnosticSourceAnchor;
}

interface DoctorCheckResult {
  readonly finding?: DoctorFinding;
  readonly line: string;
}

export function parseDoctorArgs(args: readonly string[]): DoctorParseResult {
  const parsed = parseKovoCommandInvocation('doctor', args);
  if (!parsed.ok) return { message: parsed.message, ok: false };
  return {
    ok: true,
    options: {
      fix: parsed.value.options.fix,
      format: parsed.value.options.format,
      root: parsed.value.arguments.root ?? '.',
    },
  };
}

/**
 * Inspect one app without evaluating authored modules or contacting the network.
 *
 * The checks correspond to SPEC §11.4's local-coherence surface. Safe repair is deliberately
 * limited to deleting a derived stale cache or creating the framework-owned `.kovo` directory.
 */
export async function runDoctorCommand(
  options: KovoDoctorOptions,
  security: KovoCommandSecurityDisposition,
): Promise<CliCommandResult> {
  const root = resolve(security.invocationCwd, options.root);
  const manifestPath = join(root, 'package.json');
  let manifestSource: string;
  let manifest: Record<string, unknown>;
  try {
    manifestSource = boundedText(manifestPath, MAX_CONFIG_BYTES);
    const parsed = JSON.parse(manifestSource) as unknown;
    if (!isRecord(parsed)) throw new TypeError('package.json must contain an object');
    manifest = parsed;
  } catch (error) {
    const message = `package manifest is unavailable or invalid at ${relativeLabel(
      root,
      manifestPath,
    )}: ${errorMessage(error)}`;
    return doctorResult(
      root,
      [{ code: 'KOVO_DOCTOR_CONFIG', message }],
      [`ERROR manifest ${message}`],
    );
  }

  const configPath = findConfig(root);
  let configError: string | undefined;
  let configSource: string | undefined;
  if (configPath !== undefined) {
    try {
      configSource = boundedText(configPath, MAX_CONFIG_BYTES);
    } catch (error) {
      configError = errorMessage(error);
    }
  }
  const envPath = join(root, '.env');
  let envSource: string | undefined;
  if (existsSync(envPath)) {
    try {
      envSource = boundedText(envPath, MAX_CONFIG_BYTES);
    } catch {
      // The finding below remains safe and points at the expected configuration target. Never
      // copy an environment-file read failure because host paths can contain sensitive context.
    }
  }
  const context: DoctorContext = {
    ...(configError === undefined ? {} : { configError }),
    ...(configPath === undefined ? {} : { configPath }),
    ...(configSource === undefined ? {} : { configSource }),
    env: security.invocationEnv,
    envPath,
    ...(envSource === undefined ? {} : { envSource }),
    fix: options.fix,
    manifest,
    manifestPath,
    manifestSource,
    root,
  };
  const checks = [
    checkNode(context),
    checkPackageManager(context),
    checkInstalledPackages(context),
    checkConfig(context),
    checkOrigin(context),
    checkSecret(context),
    checkDatabase(context),
    checkMigrations(context),
    checkRetention(context),
    await checkWritablePaths(context),
    await checkCache(context),
  ];
  return doctorResult(
    root,
    checks.flatMap((check) => (check.finding === undefined ? [] : [check.finding])),
    checks.map((check) => check.line),
  );
}

function checkNode(context: DoctorContext): DoctorCheckResult {
  const engines = isRecord(context.manifest.engines) ? context.manifest.engines : undefined;
  const requirement = typeof engines?.node === 'string' ? engines.node : '>=24.10.0';
  const minimum = /(?:^|[<>=~^| ])(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(requirement);
  const current = numericVersion(process.versions.node);
  const required =
    minimum === null
      ? undefined
      : [Number(minimum[1]), Number(minimum[2] ?? 0), Number(minimum[3] ?? 0)];
  if (required === undefined || compareVersion(current, required) < 0) {
    return finding(
      'KOVO_DOCTOR_NODE',
      `Node ${process.versions.node} does not satisfy ${JSON.stringify(requirement)}.`,
      'node',
      sourceForKey(context, '"engines"'),
    );
  }
  return pass(
    'node',
    `version=${process.versions.node} requirement=${JSON.stringify(requirement)}`,
  );
}

function checkPackageManager(context: DoctorContext): DoctorCheckResult {
  const declared = context.manifest.packageManager;
  const match = typeof declared === 'string' ? /^pnpm@(\d+\.\d+\.\d+)$/u.exec(declared) : null;
  if (match === null) {
    return finding(
      'KOVO_DOCTOR_PACKAGE_MANAGER',
      'package.json must declare one exact supported packageManager such as pnpm@10.12.1.',
      'package-manager',
      sourceForKey(context, '"packageManager"'),
    );
  }
  let actual: string;
  try {
    actual = String(
      doctorHost.execFileSync('pnpm', ['--version'], {
        cwd: context.root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ).trim();
  } catch {
    return finding(
      'KOVO_DOCTOR_PACKAGE_MANAGER',
      `pnpm ${match[1]} is declared but pnpm could not be executed.`,
      'package-manager',
      sourceForKey(context, '"packageManager"'),
    );
  }
  if (actual !== match[1]) {
    return finding(
      'KOVO_DOCTOR_PACKAGE_MANAGER',
      `pnpm ${actual || '(unknown)'} does not equal declared pnpm ${match[1]}.`,
      'package-manager',
      sourceForKey(context, '"packageManager"'),
    );
  }
  return pass('package-manager', `pnpm=${actual}`);
}

function checkInstalledPackages(context: DoctorContext): DoctorCheckResult {
  const packages = installedKovoPackages(context.root);
  const duplicate = [...packages.entries()].find(([, rows]) => {
    const identities = new Set(rows.map((row) => `${row.version}\0${row.realPath}`));
    return identities.size > 1;
  });
  if (duplicate !== undefined) {
    const versions = [...new Set(duplicate[1].map((row) => row.version))].sort();
    return finding(
      'KOVO_DOCTOR_DUPLICATE_PACKAGE',
      `${duplicate[0]} resolves to multiple installed copies (${versions.join(', ')}).`,
      'packages',
      sourceForKey(context, JSON.stringify(duplicate[0])),
    );
  }
  for (const rows of packages.values()) {
    for (const row of rows) {
      const peers = isRecord(row.manifest.peerDependencies)
        ? row.manifest.peerDependencies
        : undefined;
      if (peers === undefined) continue;
      for (const [peer, range] of Object.entries(peers)) {
        if (!peer.startsWith(KOVO_PACKAGE_PREFIX) || typeof range !== 'string') continue;
        const installed = packages.get(peer)?.[0]?.version;
        if (installed !== undefined && !versionSatisfies(installed, range)) {
          return finding(
            'KOVO_DOCTOR_PEER',
            `${row.name}@${row.version} requires ${peer}@${range}, but ${installed} is installed.`,
            'peers',
            sourceForKey(context, JSON.stringify(peer)),
          );
        }
      }
    }
  }
  return pass('packages', `kovo=${packages.size} duplicate=0 peer-mismatch=0`);
}

function checkConfig(context: DoctorContext): DoctorCheckResult {
  if (context.configError !== undefined) {
    return finding(
      'KOVO_DOCTOR_CONFIG',
      `Kovo config could not be read safely: ${context.configError}.`,
      'config',
    );
  }
  if (context.configPath === undefined || context.configSource === undefined) {
    return finding(
      'KOVO_DOCTOR_CONFIG',
      'No kovo.config.ts, .mts, .js, or .mjs was found at the app root.',
      'config',
    );
  }
  const preset = /\b(?:node|vercel|cloudflare)\s*\(/u.exec(context.configSource)?.[0];
  if (preset === undefined) {
    return finding(
      'KOVO_DOCTOR_CONFIG',
      'Kovo config does not select one supported deployment preset.',
      'config',
      sourceForConfig(context, 'preset'),
    );
  }
  return pass('config', `file=${relativeLabel(context.root, context.configPath)} preset=${preset}`);
}

function checkOrigin(context: DoctorContext): DoctorCheckResult {
  const betterAuthOrigin = kovoInvocationEnvironmentValue(context.env, 'BETTER_AUTH_URL');
  const originName = betterAuthOrigin === undefined ? 'KOVO_ORIGIN' : 'BETTER_AUTH_URL';
  const raw = betterAuthOrigin ?? kovoInvocationEnvironmentValue(context.env, 'KOVO_ORIGIN');
  if (raw === undefined) return pass('origin', 'mode=loopback-auto');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return finding(
      'KOVO_DOCTOR_ORIGIN',
      'Configured application origin is not a valid URL.',
      'origin',
      sourceForEnvironment(context, originName),
    );
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if ((loopback && url.protocol !== 'http:') || (!loopback && url.protocol !== 'https:')) {
    return finding(
      'KOVO_DOCTOR_ORIGIN',
      loopback
        ? 'Loopback development origin must use http.'
        : 'Non-loopback application origin must use fixed https.',
      'origin',
      sourceForEnvironment(context, originName),
    );
  }
  return pass('origin', `mode=${loopback ? 'loopback-explicit' : 'deployment-https'}`);
}

function checkSecret(context: DoctorContext): DoctorCheckResult {
  const required =
    declaresPackage(context.manifest, '@kovojs/better-auth') ||
    declaresPackage(context.manifest, 'better-auth');
  if (!required) return pass('secret', 'required=false');
  if (
    environmentNameDeclared(context, 'BETTER_AUTH_SECRET') ||
    environmentNameDeclared(context, 'KOVO_CSRF_SECRET')
  ) {
    return pass('secret', 'required=true configured=true');
  }
  return finding(
    'KOVO_DOCTOR_SECRET',
    'Better Auth requires a framework signing secret, but neither BETTER_AUTH_SECRET nor KOVO_CSRF_SECRET is configured.',
    'secret',
    sourceForEnvironment(context, 'KOVO_CSRF_SECRET'),
  );
}

function checkDatabase(context: DoctorContext): DoctorCheckResult {
  if (declaresPackage(context.manifest, 'better-sqlite3')) {
    return pass('database', 'mode=experimental-sqlite roles=single-principal');
  }
  const runtime =
    environmentNameDeclared(context, 'KOVO_RUNTIME_DATABASE_URL') ||
    environmentNameDeclared(context, 'KOVO_DATABASE_URL');
  const system = environmentNameDeclared(context, 'KOVO_DB_SYSTEM_URL');
  if (!runtime && declaresPackage(context.manifest, '@electric-sql/pglite')) {
    return pass('database', 'mode=pglite-development roles=embedded');
  }
  if (!runtime || !system) {
    return finding(
      'KOVO_DOCTOR_DATABASE',
      `Database role configuration is incomplete (runtime=${runtime ? 'set' : 'missing'}, system=${system ? 'set' : 'missing'}).`,
      'database',
      sourceForEnvironment(context, runtime ? 'KOVO_DB_SYSTEM_URL' : 'KOVO_RUNTIME_DATABASE_URL'),
    );
  }
  return pass('database', 'mode=postgres roles=runtime+system');
}

function checkMigrations(context: DoctorContext): DoctorCheckResult {
  const candidates = ['drizzle', 'migrations', '.kovo/migrations'];
  const found = candidates.find((candidate) => existsSync(join(context.root, candidate)));
  if (found === undefined) {
    return finding(
      'KOVO_DOCTOR_MIGRATIONS',
      'No generated migration directory was found.',
      'migrations',
      configurationInsertionAnchor(context.root, join(context.root, 'migrations')),
    );
  }
  return pass('migrations', `path=${found}`);
}

function checkRetention(context: DoctorContext): DoctorCheckResult {
  const sourceFacts = inspectSourceTree(context.root);
  if (!sourceFacts.usesClientRetention) return pass('retention', 'required=false');
  if (context.configSource === undefined || !/\bretention\s*:/u.test(context.configSource)) {
    return finding(
      'KOVO_DOCTOR_RETENTION',
      'Client-bearing source requires an explicit deploy-skew retention declaration.',
      'retention',
      sourceForConfig(context, 'preset') ??
        configurationInsertionAnchor(context.root, join(context.root, 'kovo.config.ts')),
    );
  }
  return pass('retention', 'required=true declared=true');
}

async function checkWritablePaths(context: DoctorContext): Promise<DoctorCheckResult> {
  try {
    doctorHost.accessSync(context.root, constants.W_OK);
    const kovoRoot = join(context.root, '.kovo');
    if (existsSync(kovoRoot)) {
      const info = lstatSync(kovoRoot);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new TypeError('.kovo must be a real project-owned directory');
      }
      doctorHost.accessSync(kovoRoot, constants.W_OK);
    } else if (context.fix) {
      await createFrameworkOutputFileSystemBoundary(kovoRoot).ensureDirectory();
    }
  } catch (error) {
    return finding(
      'KOVO_DOCTOR_WRITABLE',
      `Framework output paths are not writable: ${errorMessage(error)}.`,
      'writable',
    );
  }
  return pass('writable', `root=true${context.fix ? ' safe-fix=checked' : ''}`);
}

async function checkCache(context: DoctorContext): Promise<DoctorCheckResult> {
  const cache = join(context.root, '.kovo/cache');
  if (!existsSync(cache)) return pass('cache', 'state=absent');
  const info = lstatSync(cache);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    return finding(
      'KOVO_DOCTOR_CACHE',
      '.kovo/cache is not a real project-owned directory and will not be repaired.',
      'cache',
    );
  }
  const cacheNewest = newestMtime(cache);
  const sourceNewest = Math.max(
    newestMtime(join(context.root, 'src')),
    statSync(context.manifestPath).mtimeMs,
    context.configPath === undefined ? 0 : statSync(context.configPath).mtimeMs,
  );
  if (cacheNewest === 0 || sourceNewest <= cacheNewest) {
    return pass('cache', 'state=current');
  }
  if (context.fix) {
    try {
      await createFrameworkOutputFileSystemBoundary(cache).removeTree();
    } catch {
      return finding(
        'KOVO_DOCTOR_CACHE',
        'Stale cache could not be removed through the project-confined filesystem boundary.',
        'cache',
      );
    }
    return { line: 'FIX cache removed=.kovo/cache reason=stale-derived-inputs' };
  }
  return finding(
    'KOVO_DOCTOR_CACHE',
    'Derived cache predates current source or configuration.',
    'cache',
  );
}

function doctorResult(
  root: string,
  findings: readonly DoctorFinding[],
  lines: readonly string[],
): CliCommandResult {
  const diagnostics: readonly KovoDiagnosticRecord[] = Object.freeze(
    findings.map((item) => doctorFindingDiagnostic(item.code, item.message, item.source)),
  );
  const summary = `SUMMARY root=${JSON.stringify(root)} checks=${lines.length} findings=${findings.length}`;
  return {
    diagnostics,
    exitCode: findings.length === 0 ? 0 : 1,
    output: `${[DOCTOR_PROTOCOL, ...lines, summary].join('\n')}\n`,
  };
}

function finding(
  code: KovoDoctorDiagnosticCode,
  message: string,
  id: string,
  source?: KovoDiagnosticSourceAnchor,
): DoctorCheckResult {
  return {
    finding: { code, message, ...(source === undefined ? {} : { source }) },
    line: `ERROR ${id} cause=${JSON.stringify(message)}`,
  };
}

function pass(id: string, detail: string): DoctorCheckResult {
  return { line: `PASS ${id} ${detail}` };
}

interface InstalledPackage {
  readonly manifest: Record<string, unknown>;
  readonly name: string;
  readonly realPath: string;
  readonly version: string;
}

function installedKovoPackages(root: string): Map<string, InstalledPackage[]> {
  const result = new Map<string, InstalledPackage[]>();
  const roots = [join(root, 'node_modules/@kovojs')];
  const store = join(root, 'node_modules/.pnpm');
  if (existsSync(store)) {
    for (const entry of readdirSync(store).slice(0, MAX_SOURCE_FILES)) {
      roots.push(join(store, entry, 'node_modules/@kovojs'));
    }
  }
  const seen = new Set<string>();
  for (const scopeRoot of roots) {
    if (!existsSync(scopeRoot)) continue;
    for (const leaf of readdirSync(scopeRoot).slice(0, 512)) {
      const packageRoot = join(scopeRoot, leaf);
      const manifestPath = join(packageRoot, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let realPath: string;
      try {
        realPath = realpathSync(packageRoot);
      } catch {
        continue;
      }
      if (seen.has(realPath)) continue;
      seen.add(realPath);
      try {
        const manifest = JSON.parse(boundedText(manifestPath, MAX_CONFIG_BYTES)) as unknown;
        if (!isRecord(manifest)) continue;
        const name = manifest.name;
        const version = manifest.version;
        if (
          typeof name !== 'string' ||
          !name.startsWith(KOVO_PACKAGE_PREFIX) ||
          typeof version !== 'string'
        ) {
          continue;
        }
        const row = { manifest, name, realPath, version };
        result.set(name, [...(result.get(name) ?? []), row]);
      } catch {
        continue;
      }
    }
  }
  return result;
}

function versionSatisfies(version: string, range: string): boolean {
  if (range === '*' || range.startsWith('workspace:')) return true;
  const actual = numericVersion(version);
  const expectedText = /\d+(?:\.\d+){0,2}/u.exec(range)?.[0];
  if (expectedText === undefined) return false;
  const expected = numericVersion(expectedText);
  if (range.startsWith('>=')) return compareVersion(actual, expected) >= 0;
  if (range.startsWith('^')) {
    return actual[0] === expected[0] && compareVersion(actual, expected) >= 0;
  }
  if (range.startsWith('~')) {
    return (
      actual[0] === expected[0] &&
      actual[1] === expected[1] &&
      compareVersion(actual, expected) >= 0
    );
  }
  return compareVersion(actual, expected) === 0;
}

function numericVersion(value: string): [number, number, number] {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(value);
  return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), Number(match?.[3] ?? 0)];
}

function compareVersion(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function inspectSourceTree(root: string): { readonly usesClientRetention: boolean } {
  const pending = [join(root, 'src')];
  let files = 0;
  let usesClientRetention = false;
  while (pending.length > 0 && files < MAX_SOURCE_FILES && !usesClientRetention) {
    const current = pending.pop()!;
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current)) pending.push(join(current, entry));
      continue;
    }
    files += 1;
    if (!/\.[cm]?[jt]sx?$/u.test(current)) continue;
    let text: string;
    try {
      text = boundedText(current, MAX_CONFIG_BYTES);
    } catch {
      continue;
    }
    usesClientRetention =
      /\bisland\s*\(/u.test(text) ||
      /\bclient\s*:\s*(?:true|\{)/u.test(text) ||
      /\btrigger\s*:\s*['"](?:idle|visible|media)/u.test(text);
  }
  return { usesClientRetention };
}

function newestMtime(root: string): number {
  if (!existsSync(root)) return 0;
  const pending = [root];
  let newest = 0;
  let visited = 0;
  while (pending.length > 0 && visited < MAX_SOURCE_FILES) {
    const current = pending.pop()!;
    const info = lstatSync(current);
    if (info.isSymbolicLink()) continue;
    newest = Math.max(newest, info.mtimeMs);
    visited += 1;
    if (info.isDirectory()) {
      for (const entry of readdirSync(current)) pending.push(join(current, entry));
    }
  }
  return newest;
}

function environmentNameDeclared(context: DoctorContext, name: string): boolean {
  const invocationValue = kovoInvocationEnvironmentValue(context.env, name);
  if (invocationValue !== undefined) return invocationValue.trim().length > 0;
  if (context.envSource === undefined) return false;
  const match = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=([^\\r\\n]*)$`, 'mu').exec(
    context.envSource,
  );
  return match !== null && (match[1] ?? '').trim().length > 0;
}

function declaresPackage(manifest: Record<string, unknown>, name: string): boolean {
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(
    (bag) => isRecord(manifest[bag]) && typeof manifest[bag][name] === 'string',
  );
}

function sourceForKey(context: DoctorContext, key: string): KovoDiagnosticSourceAnchor | undefined {
  return sourceAnchor(context.root, context.manifestPath, context.manifestSource, key);
}

function sourceForConfig(
  context: DoctorContext,
  key: string,
): KovoDiagnosticSourceAnchor | undefined {
  return context.configPath === undefined || context.configSource === undefined
    ? undefined
    : sourceAnchor(context.root, context.configPath, context.configSource, key);
}

function sourceForEnvironment(context: DoctorContext, key: string): KovoDiagnosticSourceAnchor {
  return (
    (context.envSource === undefined
      ? undefined
      : sourceAnchor(context.root, context.envPath, context.envSource, key)) ??
    configurationInsertionAnchor(context.root, context.envPath)
  );
}

function configurationInsertionAnchor(root: string, path: string): KovoDiagnosticSourceAnchor {
  return Object.freeze({
    end: 0,
    file: relativeLabel(root, path),
    start: 0,
  });
}

function sourceAnchor(
  root: string,
  path: string,
  text: string,
  needle: string,
): KovoDiagnosticSourceAnchor | undefined {
  const start = text.indexOf(needle);
  if (start < 0) return undefined;
  return Object.freeze({
    end: start + needle.length,
    file: relativeLabel(root, path),
    start,
  });
}

function findConfig(root: string): string | undefined {
  return ['kovo.config.ts', 'kovo.config.mts', 'kovo.config.js', 'kovo.config.mjs']
    .map((file) => join(root, file))
    .find(existsSync);
}

function boundedText(path: string, limit: number): string {
  const info = statSync(path);
  if (!info.isFile() || info.size > limit) {
    throw new TypeError(`${basename(path)} must be a regular file no larger than ${limit} bytes`);
  }
  return readFileSync(path, 'utf8');
}

function relativeLabel(root: string, path: string): string {
  const value = relative(root, path).replaceAll('\\', '/');
  return value === '' || value.startsWith('../') ? basename(path) : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
