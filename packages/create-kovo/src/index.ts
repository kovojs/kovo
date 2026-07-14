#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bundledKovoDocsMirrorFiles,
  bundledKovoRulesSource,
  renderKovoRulesBlock,
} from '@kovojs/core/internal/agent-docs';

const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectIs = NativeObject.is;
const nativeReflectApply = NativeReflect.apply;

export interface CreateKovoOptions {
  dialect?: CreateKovoDialect;
  name: string;
}

export type CreateKovoDialect = 'postgres' | 'sqlite';

export interface GeneratedFile {
  path: string;
  source: string;
  symlinkTarget?: string;
}

export interface CreateKovoProject {
  files: GeneratedFile[];
  name: string;
}

export interface WriteKovoProjectResult {
  files: string[];
  name: string;
  root: string;
}

export interface WriteKovoProjectOptions extends Partial<CreateKovoOptions> {
  disableGit?: boolean;
}

/** Usage line emitted by the `create-kovo` bin and consumed by the docs generator. */
export const CREATE_KOVO_USAGE = 'create-kovo <target-directory> [options]';

interface CreateKovoReferenceOption {
  defaultText?: string;
  description: string;
  docsDescription?: string;
  flag: string;
}

interface CreateKovoReferenceDefault {
  label: string;
  value: string;
}

interface CreateKovoReferenceSection {
  anchor: string;
  body: readonly string[];
  title: string;
}

interface CreateKovoReferenceSchema {
  defaults: readonly CreateKovoReferenceDefault[];
  description: string;
  examples: readonly string[];
  options: readonly CreateKovoReferenceOption[];
  sections: readonly CreateKovoReferenceSection[];
  title: string;
  usage: string;
}

export const CREATE_KOVO_REFERENCE = {
  title: 'create-kovo',
  description: 'Create a new Kovo application.',
  usage: CREATE_KOVO_USAGE,
  options: [
    {
      flag: '--name <name>',
      description: 'Package name for package.json.',
      defaultText: 'normalized target directory name.',
      docsDescription:
        'Override the generated `package.json` name. Names are normalized to lowercase npm-compatible words and dashes.',
    },
    {
      flag: '--dialect <postgres|sqlite>',
      description: 'Database scaffold to generate.',
      defaultText: 'postgres.',
      docsDescription: 'Select the database starter. Defaults to `postgres`.',
    },
    {
      flag: '--postgres',
      description: 'Alias for --dialect postgres.',
      docsDescription: 'Alias for `--dialect postgres`.',
    },
    {
      flag: '--sqlite',
      description: 'Alias for --dialect sqlite.',
      docsDescription: 'Alias for `--dialect sqlite`.',
    },
    {
      flag: '--experimental-sqlite',
      description: 'Allow SQLite scaffold generation for single-principal local development.',
      docsDescription:
        'Required for `--sqlite` or `--dialect sqlite` unless `KOVO_EXPERIMENTAL_SQLITE=1` is set. SQLite is a single-principal local-development scaffold and does not provide Kovo authorization/confidentiality guarantees.',
    },
    {
      flag: '--disable-git',
      description: 'Do not initialize a Git repository.',
      docsDescription:
        'Skip Git repository initialization. By default, `create-kovo` runs `git init` unless the target is already inside a Git or Mercurial repository.',
    },
    {
      flag: '-h, --help',
      description: 'Show this help.',
      docsDescription: 'Print usage and exit without writing files.',
    },
  ],
  examples: [
    'create-kovo my-app',
    'create-kovo my-app --name acme-todos',
    'create-kovo my-app --dialect sqlite --experimental-sqlite',
  ],
  defaults: [
    { label: 'target-directory', value: 'Required.' },
    { label: 'name', value: 'basename(target-directory), normalized for npm.' },
    { label: 'dialect', value: 'postgres.' },
    { label: 'package manager', value: `${rootPackageManager()}.` },
  ],
  sections: [
    {
      title: 'Generated project',
      anchor: 'generated-project',
      body: [
        'The scaffold writes the application source, Vite+/Kovo config, test files, README, CI workflow, and database-specific schema/auth/database files for the selected dialect. It also writes `.env`, `.env.example`, and `.gitignore`. By default, it initializes a Git repository after writing files; pass `--disable-git` to skip that step. If the target already sits under a Git or Mercurial repository, `create-kovo` leaves version control to the parent repository.',
        'The `.env` file contains a per-project random `KOVO_CSRF_SECRET`; `.env` is gitignored, while `.env.example` keeps the deployment placeholder visible and documents the Postgres runtime/admin URL split, PGlite data dir, and driver overrides. The starter auth module fails closed when the secret is missing or still set to the placeholder.',
        'SQLite scaffolds are explicit opt-in: pass `--experimental-sqlite` with `--sqlite` or `--dialect sqlite`, or set `KOVO_EXPERIMENTAL_SQLITE=1`. The generated SQLite README repeats that it is a single-principal local-development scaffold, not the Postgres authorization/confidentiality posture.',
      ],
    },
    {
      title: 'Write safety',
      anchor: 'write-safety',
      body: [
        'The command resolves every template destination under the target root before writing and rejects path traversal. Existing non-empty directories and non-directory targets fail before any scaffold file is written.',
      ],
    },
  ],
} as const satisfies CreateKovoReferenceSchema;

export function renderCreateKovoHelp(reference = CREATE_KOVO_REFERENCE): string {
  const optionWidth = Math.max(...reference.options.map((option) => option.flag.length));
  const defaultWidth = Math.max(27, ...reference.defaults.map((item) => item.label.length));
  const lines = [
    reference.title,
    '',
    reference.description,
    '',
    'Usage',
    `  ${reference.usage}`,
    '',
    'Options',
  ];

  for (const option of reference.options) {
    lines.push(`  ${option.flag.padEnd(optionWidth)} ${option.description}`);
    if ('defaultText' in option && option.defaultText) {
      lines.push(`  ${''.padEnd(optionWidth)} Default: ${option.defaultText}`);
    }
    lines.push('');
  }

  lines.push('Examples');
  for (const example of reference.examples) lines.push(`  ${example}`);
  lines.push('', 'Defaults');
  for (const item of reference.defaults) {
    lines.push(`  ${item.label.padEnd(defaultWidth)} ${item.value}`);
  }
  lines.push('');

  return lines.join('\n');
}

export const CREATE_KOVO_HELP = renderCreateKovoHelp();

const templateRoot = new URL('../templates/', import.meta.url);
interface TemplateFile {
  path: string;
  sourcePath?: string;
  sqlitePath?: string;
}

const templateFiles: readonly TemplateFile[] = [
  { path: 'package.json', sqlitePath: 'package.sqlite.json' },
  { path: '.npmrc', sourcePath: 'npmrc' },
  'tsconfig.json',
  'kovo.config.ts',
  'vite.config.ts',
  'index.html',
  '.github/workflows/ci.yml',
  { path: 'README.md', sqlitePath: 'README.sqlite.md' },
  'scripts/check-sound-subset.mjs',
  'scripts/check-parallel.mjs',
  { path: 'src/schema.ts', sqlitePath: 'src/schema.sqlite.ts' },
  { path: 'src/db.ts', sqlitePath: 'src/db.sqlite.ts' },
  { path: 'src/_kovo/app-runtime-db.ts', sqlitePath: 'src/_kovo/app-runtime-db.sqlite.ts' },
  { path: 'src/auth.ts', sqlitePath: 'src/auth.sqlite.ts' },
  'src/model.ts',
  'src/queries.ts',
  'src/mutations.ts',
  'src/components/contacts.tsx',
  'src/components/auth-forms.tsx',
  'src/app.tsx',
  'src/app.test.ts',
  'src/endpoint-posture.test.ts',
  'src/theme.ts',
  'src/styles.css',
].map((file) => (typeof file === 'string' ? { path: file } : file));

// SECURITY (SECURITY_FINDINGS.md M5): every scaffolded app must start with its own
// strong, secret CSRF HMAC key — never a known constant from the template. We generate
// a per-project random secret at scaffold time and write it into `.env` (gitignored),
// while `src/auth.ts` reads `process.env.KOVO_CSRF_SECRET` and fails closed if it is
// missing or still the placeholder.
export const csrfSecretEnvVar = 'KOVO_CSRF_SECRET';
export const demoPasswordEnvVar = 'KOVO_DEMO_PASSWORD';
const csrfSecretPlaceholder = 'replace-with-a-deployed-secret';
const demoPasswordPlaceholder = 'replace-with-a-local-demo-password';

export function generateCsrfSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function generateDemoPassword(): string {
  return randomBytes(18).toString('base64url');
}

/** Globally unique, committed live-target security identity for one scaffolded application. */
export function generateAppId(): string {
  return randomUUID();
}

function renderEnvFile(secret: string, demoPassword: string): string {
  return [
    '# Local development environment for this Kovo app.',
    '# Generated by create-kovo. This file is gitignored; do NOT commit real secrets.',
    '',
    '# CSRF HMAC key. SECURITY: keep this secret and unique per deployment',
    '# (regenerate with `openssl rand -base64 32`). src/auth.ts fails closed if it is',
    `# missing or still the '${csrfSecretPlaceholder}' placeholder.`,
    `${csrfSecretEnvVar}=${secret}`,
    '',
    '# Local seeded demo account password. Development only; do not reuse in production.',
    `${demoPasswordEnvVar}=${demoPassword}`,
    '',
  ].join('\n');
}

function renderEnvExampleFile(): string {
  return [
    '# Copy this file to .env and fill in real secrets before deploying.',
    '# Generate a strong CSRF secret with: openssl rand -base64 32',
    `${csrfSecretEnvVar}=${csrfSecretPlaceholder}`,
    '',
    '# Local default: leave the database URLs unset and Kovo uses embedded PGlite.',
    '# Set KOVO_DATABASE_URL for app boot + kovo db check on external Postgres.',
    'KOVO_DATABASE_URL=postgres://app_runtime@db.example.com:5432/your_app',
    '# Optional explicit runtime login passed through kovo db provision for future least-privilege grants.',
    'KOVO_RUNTIME_DATABASE_URL=postgres://app_runtime@db.example.com:5432/your_app',
    '# Privileged owner/admin URL used only for kovo db generate|migrate|provision.',
    'KOVO_ADMIN_DATABASE_URL=postgres://app_admin@db.example.com:5432/your_app',
    '# Force pglite|pg|node-postgres only when auto-detection is not enough.',
    'KOVO_DB_DRIVER=',
    '# Embedded PGlite data dir for local development or mounted prod volumes.',
    'KOVO_DATA_DIR=.kovo/pglite',
    '# Local-only demo seed password. Leave unset in production.',
    `${demoPasswordEnvVar}=${demoPasswordPlaceholder}`,
    '',
  ].join('\n');
}

const gitignoreEntries = [
  'node_modules',
  'dist',
  '.env',
  '.env.*',
  '!.env.example',
  '.kovo/',
  '',
].join('\n');

export function createKovoProject(options: CreateKovoOptions): CreateKovoProject {
  const packageName = normalizePackageName(options.name);
  const dialect = options.dialect ?? 'postgres';
  const values = templateValues(packageName, generateAppId());
  const docsVersion = packageVersion('@kovojs/core');
  const csrfSecret = generateCsrfSecret();
  const demoPassword = generateDemoPassword();
  const kovoRulesBlock = renderKovoRulesBlock({
    rulesSource: bundledKovoRulesSource(),
    version: docsVersion,
  });

  return {
    files: [
      { path: 'AGENTS.md', source: renderAgentsFile(kovoRulesBlock) },
      {
        path: 'CLAUDE.md',
        source: 'See AGENTS.md for agent instructions.\n',
        symlinkTarget: 'AGENTS.md',
      },
      ...bundledKovoDocsMirrorFiles({ version: docsVersion }).map((file) => ({
        path: `.kovo/docs/${file.path}`,
        source: file.source,
      })),
      ...templateFiles.map((file) => ({
        path: file.path,
        source: renderTemplate(readTemplate(templatePathForDialect(file, dialect)), values),
      })),
      // Generated (non-template) project files: a per-project random CSRF secret and the
      // ignore rules that keep the real secret out of version control.
      { path: '.env', source: renderEnvFile(csrfSecret, demoPassword) },
      { path: '.env.example', source: renderEnvExampleFile() },
      { path: '.gitignore', source: gitignoreEntries },
    ],
    name: packageName,
  };
}

export function writeKovoProject(
  targetDirectory: string,
  options: WriteKovoProjectOptions = {},
): WriteKovoProjectResult {
  const root = resolve(targetDirectory);
  const configuredName = ownScaffoldOption(options, 'name');
  const configuredDialect = ownScaffoldOption(options, 'dialect');
  const disableGit = ownScaffoldOption(options, 'disableGit');
  if (configuredName !== undefined && typeof configuredName !== 'string') {
    throw new TypeError("create-kovo option 'name' must be a string.");
  }
  if (
    configuredDialect !== undefined &&
    configuredDialect !== 'postgres' &&
    configuredDialect !== 'sqlite'
  ) {
    throw new TypeError("create-kovo option 'dialect' must be 'postgres' or 'sqlite'.");
  }
  if (disableGit !== undefined && typeof disableGit !== 'boolean') {
    throw new TypeError("create-kovo option 'disableGit' must be a boolean.");
  }
  const name = configuredName ?? basename(root);
  const project = createKovoProject({
    ...(configuredDialect === undefined ? {} : { dialect: configuredDialect }),
    name,
  });

  assertWritableTarget(root);

  mkdirSync(root, { recursive: true });
  const rootIdentity = pinScaffoldRoot(root);
  verifyScaffoldRoot(rootIdentity);
  const stagingRoot = mkdtempSync(resolve(rootIdentity.canonicalPath, '.kovo-scaffold-'));
  verifyScaffoldRoot(rootIdentity);

  try {
    for (let fileIndex = 0; fileIndex < project.files.length; fileIndex += 1) {
      const file = project.files[fileIndex]!;
      const destination = resolve(stagingRoot, file.path);

      const relativeDestination = relative(stagingRoot, destination);

      if (
        relativeDestination === '' ||
        relativeDestination.startsWith('..') ||
        isAbsolute(relativeDestination)
      ) {
        throw new Error(`Refusing to write outside target directory: ${file.path}`);
      }

      mkdirSync(dirname(destination), { recursive: true });
      if (file.symlinkTarget) {
        try {
          symlinkSync(file.symlinkTarget, destination);
          continue;
        } catch {
          writeFileSync(destination, file.source, 'utf8');
          continue;
        }
      }
      if (file.path === '.env') {
        // SPEC §2: generated credentials cross a trust boundary. Do not let a permissive
        // process umask make the CSRF key or demo password readable by other local users.
        writeFileSync(destination, file.source, { encoding: 'utf8', mode: 0o600 });
      } else {
        writeFileSync(destination, file.source, 'utf8');
      }
    }

    const stagedNames = readdirSync(stagingRoot);
    for (let nameIndex = 0; nameIndex < stagedNames.length; nameIndex += 1) {
      const name = stagedNames[nameIndex]!;
      if (name === '.' || name === '..' || basename(name) !== name) {
        throw new Error(`Invalid scaffold staging entry: ${name}`);
      }
      verifyScaffoldRoot(rootIdentity);
      renameSync(resolve(stagingRoot, name), resolve(rootIdentity.canonicalPath, name));
    }
  } finally {
    rmSync(stagingRoot, { force: true, recursive: true });
  }

  if (disableGit !== true) {
    verifyScaffoldRoot(rootIdentity);
    tryGitInit(rootIdentity.canonicalPath);
  }

  const writtenFiles: string[] = [];
  for (let index = 0; index < project.files.length; index += 1) {
    writtenFiles[index] = project.files[index]!.path;
  }
  return {
    files: writtenFiles,
    name: project.name,
    root,
  };
}

function ownScaffoldOption<Key extends keyof WriteKovoProjectOptions>(
  options: WriteKovoProjectOptions,
  key: Key,
): WriteKovoProjectOptions[Key] | undefined {
  const before = nativeReflectApply(nativeGetOwnPropertyDescriptor, NativeObject, [options, key]);
  const after = nativeReflectApply(nativeGetOwnPropertyDescriptor, NativeObject, [options, key]);
  if (before === undefined && after === undefined) return undefined;
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !nativeReflectApply(nativeObjectIs, NativeObject, [before.value, after.value]) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError(`create-kovo option '${key}' must be a stable own data property.`);
  }
  return before.value as WriteKovoProjectOptions[Key];
}

function renderAgentsFile(kovoRulesBlock: string): string {
  return [
    '# Agent Instructions',
    '',
    'Add project-specific agent instructions here. Keep Kovo framework docs inside the generated block below.',
    '',
    kovoRulesBlock.trimEnd(),
    '',
  ].join('\n');
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(CREATE_KOVO_HELP);
    return 0;
  }

  try {
    const options = readCliOptions(args);
    assertCliSqliteScaffoldAllowed(options);
    const result = writeKovoProject(options.targetDirectory, {
      ...(options.dialect === undefined ? {} : { dialect: options.dialect }),
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.disableGit === undefined ? {} : { disableGit: options.disableGit }),
    });
    process.stdout.write(renderSuccess(result, options.dialect ?? 'postgres'));
    return 0;
  } catch (error) {
    process.stderr.write(renderCliError(error));
    return 1;
  }
}

function readTemplate(path: string): string {
  return readFileSync(new URL(path, templateRoot), 'utf8');
}

function templatePathForDialect(file: TemplateFile, dialect: CreateKovoDialect): string {
  return dialect === 'sqlite' && file.sqlitePath ? file.sqlitePath : (file.sourcePath ?? file.path);
}

function renderTemplate(source: string, values: Record<string, string>): string {
  return source.replaceAll(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Unknown create-kovo template variable: ${key}`);
    }
    return value;
  });
}

function templateValues(name: string, appId: string): Record<string, string> {
  return {
    app_id: appId,
    kovo_better_auth_version: packageVersion('@kovojs/better-auth'),
    kovo_browser_version: packageVersion('@kovojs/browser'),
    kovo_cli_version: packageVersion('@kovojs/cli'),
    kovo_core_version: packageVersion('@kovojs/core'),
    kovo_drizzle_version: packageVersion('@kovojs/drizzle'),
    kovo_server_version: packageVersion('@kovojs/server'),
    kovo_style_version: packageVersion('@kovojs/style'),
    kovo_ui_version: packageVersion('@kovojs/ui'),
    name,
    package_manager: rootPackageManager(),
  };
}

function packageVersion(packageName: string): string {
  if (!packageName.startsWith('@kovojs/')) {
    throw new Error(`Unsupported create-kovo template package: ${packageName}`);
  }
  const pkg = readOwnPackageJson();
  if (!pkg.version) {
    throw new Error(`Missing package version for ${packageName}`);
  }
  return pkg.version;
}

function rootPackageManager(): string {
  const pkg = readOwnPackageJson();
  const packageManager = pkg.kovo?.starterPackageManager;
  if (!packageManager) {
    throw new Error('create-kovo package.json must declare kovo.starterPackageManager');
  }
  return packageManager;
}

function readOwnPackageJson(): { kovo?: { starterPackageManager?: string }; version?: string } {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    kovo?: { starterPackageManager?: string };
    version?: string;
  };
}

function normalizePackageName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'kovo-app';
}

function assertWritableTarget(root: string): void {
  if (!existsSync(root)) {
    assertNearestScaffoldAncestor(root);
    return;
  }

  const stats = lstatSync(root);

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Target exists and is not a directory: ${root}`);
  }

  const existingEntries = readdirSync(root);

  if (existingEntries.length > 0) {
    throw new Error(`Target directory is not empty: ${root}`);
  }
}

interface ScaffoldRootIdentity {
  canonicalDev: number;
  canonicalIno: number;
  canonicalPath: string;
  lexicalDev: number;
  lexicalIno: number;
  lexicalPath: string;
}

function assertNearestScaffoldAncestor(root: string): void {
  let candidate = dirname(root);
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`Target has no existing directory ancestor: ${root}`);
    candidate = parent;
  }
  const status = lstatSync(candidate);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error(`Target ancestor must be a non-symbolic-link directory: ${candidate}`);
  }
}

function pinScaffoldRoot(root: string): ScaffoldRootIdentity {
  const lexicalStatus = lstatSync(root);
  if (lexicalStatus.isSymbolicLink() || !lexicalStatus.isDirectory()) {
    throw new Error(`Target exists and is not a directory: ${root}`);
  }
  const canonicalPath = realpathSync(root);
  const canonicalStatus = statSync(canonicalPath);
  return {
    canonicalDev: canonicalStatus.dev,
    canonicalIno: canonicalStatus.ino,
    canonicalPath,
    lexicalDev: lexicalStatus.dev,
    lexicalIno: lexicalStatus.ino,
    lexicalPath: root,
  };
}

function verifyScaffoldRoot(identity: ScaffoldRootIdentity): void {
  const lexicalStatus = lstatSync(identity.lexicalPath);
  const canonicalPath = realpathSync(identity.lexicalPath);
  const canonicalStatus = statSync(canonicalPath);
  if (
    lexicalStatus.isSymbolicLink() ||
    !lexicalStatus.isDirectory() ||
    lexicalStatus.dev !== identity.lexicalDev ||
    lexicalStatus.ino !== identity.lexicalIno ||
    canonicalPath !== identity.canonicalPath ||
    canonicalStatus.dev !== identity.canonicalDev ||
    canonicalStatus.ino !== identity.canonicalIno
  ) {
    throw new Error(`Target directory identity changed while scaffolding: ${identity.lexicalPath}`);
  }
}

function tryGitInit(root: string): boolean {
  if (isInsideVersionControl(root)) {
    return false;
  }

  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    return false;
  }

  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    try {
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

function isInsideVersionControl(root: string): boolean {
  let current = resolve(root);

  while (true) {
    if (existsSync(resolve(current, '.git')) || existsSync(resolve(current, '.hg'))) {
      return true;
    }

    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

interface CliOptions {
  disableGit?: boolean;
  dialect?: CreateKovoDialect;
  experimentalSqlite?: boolean;
  name?: string;
  targetDirectory: string;
}

function readCliOptions(args: readonly string[]): CliOptions {
  let disableGit: boolean | undefined;
  let experimentalSqlite: boolean | undefined;
  let targetDirectory: string | undefined;
  let name: string | undefined;
  let dialect: CreateKovoDialect | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--name') {
      name = readRequiredOptionValue(args, index, '--name');
      index += 1;
      continue;
    }

    if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
      if (!name) throw new Error('Missing value for --name.');
      continue;
    }

    if (arg === '--dialect') {
      dialect = parseDialectOption(readRequiredOptionValue(args, index, '--dialect'));
      index += 1;
      continue;
    }

    if (arg === '--sqlite') {
      dialect = 'sqlite';
      continue;
    }

    if (arg === '--disable-git') {
      disableGit = true;
      continue;
    }

    if (arg === '--experimental-sqlite') {
      experimentalSqlite = true;
      continue;
    }

    if (arg === '--postgres') {
      dialect = 'postgres';
      continue;
    }

    if (arg.startsWith('--dialect=')) {
      dialect = parseDialectOption(arg.slice('--dialect='.length));
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (targetDirectory) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    targetDirectory = arg;
  }

  if (!targetDirectory) {
    throw new Error('Missing target directory.');
  }

  return {
    ...(disableGit === undefined ? {} : { disableGit }),
    ...(dialect === undefined ? {} : { dialect }),
    ...(experimentalSqlite === undefined ? {} : { experimentalSqlite }),
    ...(name === undefined ? {} : { name }),
    targetDirectory,
  };
}

function assertCliSqliteScaffoldAllowed(options: CliOptions): void {
  if (options.dialect !== 'sqlite') return;
  if (options.experimentalSqlite || process.env.KOVO_EXPERIMENTAL_SQLITE === '1') return;

  throw new Error(
    'SQLite scaffold is experimental and single-principal/local-dev only; it does not provide Kovo authorization/confidentiality guarantees. Set KOVO_EXPERIMENTAL_SQLITE=1 or pass --experimental-sqlite to scaffold it.',
  );
}

function readRequiredOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}.`);
  }
  return value;
}

function parseDialectOption(value: string | undefined): CreateKovoDialect {
  if (value === 'postgres' || value === 'sqlite') return value;

  throw new Error(`Unsupported dialect: ${value ?? '<missing>'}.`);
}

function renderSuccess(result: WriteKovoProjectResult, dialect: CreateKovoDialect): string {
  return [
    'Kovo app created',
    '',
    `  Directory   ${result.root}`,
    `  Name        ${result.name}`,
    `  Dialect     ${dialect}`,
    `  Files       ${result.files.length}`,
    '',
    'Next steps',
    `  cd ${shellQuote(result.root)}`,
    `  ${packageManagerCommand()} install`,
    `  ${packageManagerCommand()} run dev`,
    '',
  ].join('\n');
}

function packageManagerCommand(): string {
  return rootPackageManager().split('@')[0] ?? 'pnpm';
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = [`create-kovo: ${message}`];

  if (message === 'Missing target directory.') {
    lines.push(
      '',
      `Usage: ${CREATE_KOVO_USAGE}`,
      '',
      'Run `create-kovo --help` for examples and defaults.',
    );
  } else if (message.startsWith('Target directory is not empty: ')) {
    const root = message.slice('Target directory is not empty: '.length);
    lines.push(
      '',
      `  ${root} already contains files.`,
      '',
      'Choose an empty directory, or remove the existing directory and try again.',
    );
  } else if (message.startsWith('Target exists and is not a directory: ')) {
    const root = message.slice('Target exists and is not a directory: '.length);
    lines.push(
      '',
      `  ${root} is a file, not a directory.`,
      '',
      'Choose a new directory path and try again.',
    );
  } else if (
    message.startsWith('SQLite scaffold is experimental') ||
    message.startsWith('Unsupported dialect: ') ||
    message.startsWith('Unknown option: ') ||
    message.startsWith('Missing value for ') ||
    message.startsWith('Unexpected argument: ')
  ) {
    lines.push('', 'Run `create-kovo --help` to see supported options and defaults.');
  }

  return `${lines.join('\n')}\n`;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;

  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  }
}

if (isMainModule()) {
  process.exitCode = main();
}
