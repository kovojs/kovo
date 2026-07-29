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
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  bundledKovoDocsMirrorFiles,
  bundledKovoRulesSource,
  renderKovoRulesBlock,
} from '@kovojs/core/internal/agent-docs';

import {
  CREATE_KOVO_CREATOR_SCHEMA,
  assertCreateKovoSqliteScaffoldAllowed,
  creatorChoiceValues,
  readCreateKovoCliOptions,
  type CreateKovoCliOptions,
  type CreateKovoDeploymentTarget,
  type CreateKovoDialect,
  type CreateKovoInstallChoice,
  type CreateKovoRetentionPosture,
} from './cli-schema.js';
import {
  CREATE_KOVO_EXAMPLE_SOURCE_CATALOG,
  readKovoExampleSourceFiles,
  type CreateKovoExampleName,
} from './example-assets.js';

export type {
  CreateKovoDeploymentTarget,
  CreateKovoDialect,
  CreateKovoInstallChoice,
  CreateKovoRetentionPosture,
} from './cli-schema.js';
export type { CreateKovoExampleName } from './example-assets.js';

const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectIs = NativeObject.is;
const nativeReflectApply = NativeReflect.apply;

/** Boot-captured process sink kept injectable for exact creator/install tests. */
export const createKovoCommandShell = { execFileSync };

export interface CreateKovoOptions {
  deploymentTarget?: CreateKovoDeploymentTarget;
  dialect?: CreateKovoDialect;
  name: string;
  retention?: CreateKovoRetentionPosture;
}

export interface CreateKovoExampleOptions {
  example: CreateKovoExampleName;
  name: string;
}

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

export interface WriteKovoExampleProjectOptions {
  disableGit?: boolean;
  example: CreateKovoExampleName;
  name?: string;
}

export const CREATE_KOVO_HOST_POSTURE = {
  supported: ['Linux', 'macOS'],
  unsupported:
    'Native Windows and WSL are not policy-tested development hosts in the technical preview.',
} as const;

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
      flag: `${CREATE_KOVO_CREATOR_SCHEMA.name.flags[0]} <name>`,
      description: CREATE_KOVO_CREATOR_SCHEMA.name.description,
      defaultText: 'normalized target directory name.',
      docsDescription:
        'Override the generated `package.json` name. Names are normalized to lowercase npm-compatible words and dashes.',
    },
    {
      flag: `${CREATE_KOVO_CREATOR_SCHEMA.example.flags[0]} <${creatorChoiceValues('example').join(
        '|',
      )}>`,
      description: CREATE_KOVO_CREATOR_SCHEMA.example.description,
      docsDescription:
        'Clone the tracked authored sources for exactly one advanced example into a standalone packed-consumer project. No aliases or repository-only demo/test helpers are copied.',
    },
    {
      flag: `${CREATE_KOVO_CREATOR_SCHEMA.dialect.flags[0]} <${creatorChoiceValues('dialect').join(
        '|',
      )}>`,
      description: CREATE_KOVO_CREATOR_SCHEMA.dialect.description,
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
      flag: '--git, --no-git',
      description: CREATE_KOVO_CREATOR_SCHEMA.git.description,
      docsDescription:
        'Choose Git initialization explicitly. `--disable-git` remains a spelling alias for `--no-git`. By default, `create-kovo` runs `git init` unless the target is already inside a Git or Mercurial repository.',
    },
    {
      flag: '--disable-git',
      description: 'Alias for --no-git.',
      docsDescription: 'Alternate spelling for `--no-git`.',
    },
    {
      flag: '--install[=auto|never]',
      description: CREATE_KOVO_CREATOR_SCHEMA.install.description,
      defaultText: 'never for explicit non-interactive invocations.',
      docsDescription:
        'Run the policy-pinned `pnpm install` after scaffolding, or select `never`. `--no-install` selects `never`. Interactive use defaults to `auto`.',
    },
    {
      flag: '--no-install',
      description: 'Write files without installing dependencies.',
      docsDescription: 'Alias for `--install=never`.',
    },
    {
      flag: `--deployment <${creatorChoiceValues('deploymentTarget').join('|')}>`,
      description: CREATE_KOVO_CREATOR_SCHEMA.deploymentTarget.description,
      defaultText: `${CREATE_KOVO_CREATOR_SCHEMA.deploymentTarget.nonInteractiveDefault}.`,
      docsDescription: 'Select the built-in deployment preset emitted into `kovo.config.ts`.',
    },
    {
      flag: `--retention <${creatorChoiceValues('retention').join('|')}>`,
      description: CREATE_KOVO_CREATOR_SCHEMA.retention.description,
      defaultText: `${CREATE_KOVO_CREATOR_SCHEMA.retention.nonInteractiveDefault}.`,
      docsDescription:
        'Keep the build fail-closed with `unconfigured`, or assert the exact SPEC §14 floor with `retained-24h` only when the serving layer really retains both required artifact classes.',
    },
    {
      flag: '--yes',
      description: 'Accept schema defaults without interactive prompts.',
      docsDescription:
        'Use deterministic schema defaults. A target directory is still required; pass explicit flags to override any default.',
    },
    {
      flag: '-h, --help',
      description: 'Show this help.',
      docsDescription: 'Print usage and exit without writing files.',
    },
  ],
  examples: [
    'create-kovo my-app',
    'create-kovo sales-app --example crm --yes --no-git --no-install',
    'create-kovo shop --example commerce --yes --no-git --no-install',
    'create-kovo my-app --yes --no-install',
    'create-kovo my-app --name acme-todos',
    'create-kovo my-app --deployment node --retention retained-24h',
    'create-kovo my-app --dialect sqlite --experimental-sqlite',
  ],
  defaults: [
    { label: 'target-directory', value: 'Required.' },
    { label: 'name', value: 'basename(target-directory), normalized for npm.' },
    { label: 'dialect', value: 'postgres.' },
    { label: 'install (non-interactive)', value: 'never.' },
    { label: 'deployment', value: 'node; retention unconfigured.' },
    { label: 'package manager', value: `${rootPackageManager()}.` },
  ],
  sections: [
    {
      title: 'Generated project',
      anchor: 'generated-project',
      body: [
        'The scaffold writes the application source, Vite+/Kovo config, test files, README, CI workflow, and database-specific schema/auth/database files for the selected dialect. It also writes `.env`, `.env.example`, and `.gitignore`. By default, it initializes a Git repository after writing files; pass `--disable-git` to skip that step. If the target already sits under a Git or Mercurial repository, `create-kovo` leaves version control to the parent repository.',
        'The `.env` file contains a per-project random `KOVO_CSRF_SECRET`; `.env` is gitignored, while `.env.example` keeps the deployment placeholders visible and documents the required production `BETTER_AUTH_URL`, generated-Node public-origin posture, Postgres runtime/admin URL split, PGlite data dir, and driver overrides. Framework bootstrap loads and pins that environment before generated app modules run, and the Better Auth constructors fail closed when required secrets or production origin are missing or invalid.',
        'SQLite scaffolds are explicit opt-in: pass `--experimental-sqlite` with `--sqlite` or `--dialect sqlite`, or set `KOVO_EXPERIMENTAL_SQLITE=1`. The generated SQLite README repeats that it is a single-principal local-development scaffold, not the Postgres authorization/confidentiality posture.',
      ],
    },
    {
      title: 'Advanced examples',
      anchor: 'advanced-examples',
      body: [
        '`--example crm` and `--example commerce` copy the release-authenticated authored source payload into a standalone project. The two names come from the same semantic schema as parsing and help; arbitrary paths and aliases are rejected before filesystem work.',
        'Each packed payload accounts for every tracked source and binds copied files to byte length plus SHA-256. Repository-only scripts, scratch drivers, monorepo configs, secret-shaped files, and tests that depend on internal repository seams are excluded. The generated package, Vite/Vitest config, CI workflow, and local agent docs provide the standalone shell.',
      ],
    },
    {
      title: 'Development host support',
      anchor: 'development-host-support',
      body: [
        `The technical preview policy-tests local development on ${CREATE_KOVO_HOST_POSTURE.supported.join(
          ' and ',
        )}. ${CREATE_KOVO_HOST_POSTURE.unsupported} Generated application runtime behavior remains portable where the selected deployment preset supports it; this statement is about the scaffolded local-development journey.`,
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
  postgresOnly?: boolean;
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
  { path: 'src/schema.ts', sqlitePath: 'src/schema.sqlite.ts' },
  { path: 'src/db.ts', sqlitePath: 'src/db.sqlite.ts' },
  { path: 'src/_kovo/app-runtime-db-options.ts', postgresOnly: true },
  { path: 'src/_kovo/app-runtime-db.ts', sqlitePath: 'src/_kovo/app-runtime-db.sqlite.ts' },
  { path: 'src/auth.ts', sqlitePath: 'src/auth.sqlite.ts' },
  'src/kovo.ts',
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
// while framework bootstrap loads and pins the environment before generated app modules run.
// Better Auth's environment constructors validate the secret and fail closed if it is missing or
// still the placeholder; app-authored source never reads the secret itself (SPEC §6.6/§10.3).
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
    '# Required in production: canonical public HTTPS origin used by Better Auth.',
    'BETTER_AUTH_URL=https://app.example.com',
    '',
    '# Generated standalone Node behind TLS: pin Request URLs to that same public origin.',
    'KOVO_NODE_ORIGIN=https://app.example.com',
    '# Alternative only behind an immediate trusted proxy that replaces X-Forwarded-Proto',
    '# and preserves the external Host. Never set this together with KOVO_NODE_ORIGIN.',
    '# KOVO_NODE_TRUSTED_PROXY=1',
    '',
    '# Local default: leave the database URLs unset and Kovo uses embedded PGlite.',
    '# Ordinary least-privilege login used by app requests and the runtime side of posture checks.',
    'KOVO_DATABASE_URL=postgres://app_runtime@db.example.com:5432/your_app?sslmode=verify-full',
    '# Explicit runtime login passed to kovo db migrate|provision|check.',
    'KOVO_RUNTIME_DATABASE_URL=postgres://app_runtime@db.example.com:5432/your_app?sslmode=verify-full',
    '# Privileged owner/admin URL used for setup and only as the kovo db check fallback.',
    'KOVO_ADMIN_DATABASE_URL=postgres://app_admin@db.example.com:5432/your_app?sslmode=verify-full',
    '# Dedicated system login used by app boot and preferred by kovo db check; same live primary.',
    'KOVO_DB_SYSTEM_URL=postgres://kovo_system@db.example.com:5432/your_app?sslmode=verify-full',
    '# Optional: uncomment with exactly pglite, pg, or node-postgres to override auto-detection.',
    '# KOVO_DB_DRIVER=node-postgres',
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
  const deploymentTarget =
    options.deploymentTarget ?? CREATE_KOVO_CREATOR_SCHEMA.deploymentTarget.nonInteractiveDefault;
  const retention = options.retention ?? CREATE_KOVO_CREATOR_SCHEMA.retention.nonInteractiveDefault;
  const values = templateValues(packageName, generateAppId(), deploymentTarget, retention);
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
      ...templateFiles
        .filter((file) => dialect === 'postgres' || file.postgresOnly !== true)
        .map((file) => ({
          path: file.path,
          source: renderProjectTemplate(file, dialect, values, {
            deploymentTarget,
            retention,
          }),
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

export function createKovoExampleProject(options: CreateKovoExampleOptions): CreateKovoProject {
  const packageName = normalizePackageName(options.name);
  const definition = CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples[options.example];
  const docsVersion = packageVersion('@kovojs/core');
  const kovoRulesBlock = renderKovoRulesBlock({
    rulesSource: bundledKovoRulesSource(),
    version: docsVersion,
  });
  const sourceFiles = readKovoExampleSourceFiles(options.example);

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
      { path: 'package.json', source: renderExamplePackageJson(packageName, definition.entry) },
      { path: '.npmrc', source: readTemplate('npmrc') },
      { path: 'tsconfig.json', source: readTemplate('tsconfig.json') },
      { path: 'kovo.config.ts', source: renderKovoConfig('node', 'unconfigured') },
      { path: 'vite.config.ts', source: renderExampleViteConfig(definition.entry) },
      { path: 'vitest.config.ts', source: renderExampleVitestConfig() },
      { path: 'index.html', source: readTemplate('index.html') },
      {
        path: '.github/workflows/ci.yml',
        source: renderExampleCiWorkflow(),
      },
      {
        path: 'README.md',
        source: renderExampleReadme(options.example, definition),
      },
      ...sourceFiles,
      ...(options.example === 'crm'
        ? [{ path: 'src/example-db.test.ts', source: renderCrmExampleDatabaseTest() }]
        : []),
      { path: '.gitignore', source: gitignoreEntries },
    ],
    name: packageName,
  };
}

function renderExamplePackageJson(name: string, entry: string): string {
  const values = templateValues(name, generateAppId(), 'node', 'unconfigured');
  const starter = JSON.parse(renderTemplate(readTemplate('package.json'), values)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: Record<string, string>;
    kovo?: Record<string, unknown>;
    packageManager?: string;
    pnpm?: Record<string, unknown>;
  };
  const dependencyNames = [
    '@electric-sql/pglite',
    '@kovojs/browser',
    '@kovojs/core',
    '@kovojs/drizzle',
    '@kovojs/server',
    '@kovojs/style',
    '@kovojs/ui',
    '@node-rs/argon2',
    'drizzle-orm',
  ] as const;
  const devDependencyNames = [
    '@kovojs/cli',
    '@kovojs/test',
    '@types/node',
    '@typescript/native-preview',
    'typescript',
    'vite',
    'vite-plus',
    'vitest',
  ] as const;
  const dependencies = selectManifestDependencies(
    starter.dependencies,
    dependencyNames,
    'dependency',
  );
  const devDependencies = selectManifestDependencies(
    starter.devDependencies,
    devDependencyNames,
    'dev dependency',
  );
  return `${JSON.stringify(
    {
      name,
      private: true,
      type: 'module',
      scripts: {
        build: `kovo build ./${entry}`,
        check: 'kovo check',
        dev: `kovo dev ./${entry}`,
        test: 'vitest --run --config vitest.config.ts',
        typecheck: 'tsc --noEmit',
      },
      dependencies,
      devDependencies,
      engines: starter.engines,
      packageManager: starter.packageManager,
      pnpm: starter.pnpm,
      kovo: starter.kovo,
    },
    null,
    2,
  )}\n`;
}

function selectManifestDependencies(
  source: Record<string, string> | undefined,
  names: readonly string[],
  label: string,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const name of names) {
    const version = source?.[name];
    if (!version) throw new Error(`Missing generated example ${label}: ${name}`);
    selected[name] = version;
  }
  return selected;
}

function renderExampleViteConfig(entry: string): string {
  return [
    "import { kovo } from '@kovojs/server/vite';",
    "import { defineConfig } from 'vite-plus';",
    '',
    "const port = Number.parseInt(process.env.PORT ?? '5173', 10);",
    '',
    'export default defineConfig({',
    `  plugins: [kovo({ app: '/${entry}' })],`,
    '  server: {',
    "    host: process.env.HOST ?? '127.0.0.1',",
    '    port: Number.isFinite(port) ? port : 5173,',
    '    strictPort: true,',
    '  },',
    '  build: {',
    '    manifest: true,',
    '    rollupOptions: {',
    "      input: { styles: 'src/styles.css' },",
    "      output: { assetFileNames: 'assets/[name][extname]' },",
    '    },',
    '  },',
    '  lint: { options: { typeAware: true, typeCheck: false } },',
    '  fmt: { semi: true, singleQuote: true, sortPackageJson: true },',
    '});',
    '',
  ].join('\n');
}

function renderExampleVitestConfig(): string {
  return [
    "import { defineConfig } from 'vitest/config';",
    '',
    '// These copied smoke tests exercise data/rendering without the monorepo-only generated-graph',
    '// seam used by the canonical integration suites. Build/dev still use Kovo compilation.',
    'export default defineConfig({',
    '  test: {',
    '    testTimeout: 60_000,',
    '  },',
    '});',
    '',
  ].join('\n');
}

function renderExampleCiWorkflow(): string {
  return [
    'name: CI',
    '',
    'on:',
    '  pull_request:',
    '  push:',
    '    branches:',
    '      - main',
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    '        with:',
    '          persist-credentials: false',
    '      - uses: voidzero-dev/setup-vp@2dec1e33f4ab2c6d5bce1b0c4607961bb1a3f7a1',
    '        with:',
    '          node-version: 24.10.0',
    '      - run: corepack pnpm install --frozen-lockfile --ignore-scripts',
    '      - run: corepack pnpm exec kovo check lifecycle',
    '      - run: corepack pnpm rebuild',
    '      - run: corepack pnpm run typecheck',
    '      - run: corepack pnpm run test',
    '      - run: corepack pnpm run build',
    '',
  ].join('\n');
}

function renderExampleReadme(
  exampleName: CreateKovoExampleName,
  definition: {
    description: string;
    entry: string;
    label: string;
  },
): string {
  return [
    `# Kovo ${definition.label} Example`,
    '',
    definition.description,
    '',
    'The authored application files are copied byte-for-byte from the tracked Kovo example for',
    `this release. The package, config, CI, and agent files are generated so this clone runs outside`,
    'the Kovo monorepo. Repository-only demo drivers and test seams are intentionally excluded.',
    '',
    '## Run',
    '',
    '```sh',
    'pnpm install --ignore-scripts',
    'pnpm exec kovo check lifecycle',
    'pnpm rebuild',
    'pnpm run typecheck',
    'pnpm run test',
    ...(exampleName === 'commerce'
      ? [
          'KOVO_ENABLE_LOCAL_AUTH_FIXTURE=I_UNDERSTAND_THIS_IS_LOCAL_ONLY \\',
          "KOVO_LOCAL_AUTH_FIXTURE_PASSWORD='<unique local password, 16+ characters>' \\",
          '  pnpm run dev',
        ]
      : ['pnpm run dev']),
    '```',
    '',
    ...(exampleName === 'commerce'
      ? [
          'The commerce auth fixture is local-only and refuses production use. Replace it with a fixed',
          'Better Auth binding before deployment.',
          '',
        ]
      : []),
    '## Build',
    '',
    '```sh',
    'pnpm run build',
    '```',
    '',
    `App entry: \`${definition.entry}\`. Generated \`dist/\` and \`src/generated/\` files are`,
    'compiler artifacts; author the copied TSX/TS sources instead (SPEC §5.2).',
    '',
  ].join('\n');
}

function renderCrmExampleDatabaseTest(): string {
  return [
    "import { describe, expect, it } from 'vitest';",
    '',
    "import { createCrmDb } from './db.js';",
    "import { contacts, deals } from './schema.js';",
    '',
    "describe('CRM example database', () => {",
    "  it('starts with the tracked contact and deal seed', async () => {",
    '    const db = await createCrmDb();',
    '    const contactRows = await db.select().from(contacts);',
    '    const dealRows = await db.select().from(deals);',
    "    expect(contactRows.map((row) => row.id)).toEqual(['c1', 'c2']);",
    "    expect(dealRows.map((row) => row.id)).toEqual(['d1', 'd2']);",
    '  });',
    '});',
    '',
  ].join('\n');
}

function renderProjectTemplate(
  file: TemplateFile,
  dialect: CreateKovoDialect,
  values: Readonly<Record<string, string>>,
  deployment: {
    deploymentTarget: CreateKovoDeploymentTarget;
    retention: CreateKovoRetentionPosture;
  },
): string {
  if (file.path === 'kovo.config.ts') {
    return renderKovoConfig(deployment.deploymentTarget, deployment.retention);
  }
  const source = renderTemplate(readTemplate(templatePathForDialect(file, dialect)), values);
  // The repository stores JSON templates under its own formatter configuration, while a generated
  // app formats the rendered manifest under its framework-owned project configuration. Canonicalize only at
  // this trusted template boundary so placeholder length and dialect-specific arrays cannot make a
  // brand-new app fail its first `kovo check`.
  if (file.path !== 'package.json') return source;
  const manifest = JSON.parse(source) as { scripts?: Record<string, string> };
  if (deployment.deploymentTarget !== 'node' && manifest.scripts !== undefined) {
    delete manifest.scripts.serve;
    delete manifest.scripts.start;
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function renderKovoConfig(
  deploymentTarget: CreateKovoDeploymentTarget,
  retention: CreateKovoRetentionPosture,
): string {
  const retained =
    retention === 'retained-24h'
      ? [
          '    retention: {',
          '      hours: 24,',
          "      immutableClientModules: 'retained',",
          "      priorTokenQueryReads: 'retained',",
          '    },',
        ]
      : [];
  const preset =
    retained.length === 0
      ? `${deploymentTarget}()`
      : [`${deploymentTarget}({`, ...retained, '  })'].join('\n');
  return [
    `import { defineConfig, ${deploymentTarget} } from '@kovojs/server/build';`,
    '',
    'export default defineConfig({',
    `  preset: ${preset},`,
    '});',
    ...(retention === 'unconfigured'
      ? [
          '',
          '// SPEC §14: this build remains fail-closed for client islands until your serving layer',
          '// retains prior immutable /c/__v/... modules and prior-token /_q reads for at least 24',
          '// hours. Re-run create-kovo with --retention retained-24h only when that is true, or',
          '// configure the equivalent reviewed retention proof here.',
        ]
      : [
          '',
          '// SPEC §14: this declaration is a deployment assertion. Keep it only while the serving',
          '// layer retains both named artifact classes for the full 24-hour window.',
        ]),
    '',
  ].join('\n');
}

export function writeKovoProject(
  targetDirectory: string,
  options: WriteKovoProjectOptions = {},
): WriteKovoProjectResult {
  const root = resolve(targetDirectory);
  const configuredName = ownScaffoldOption(options, 'name');
  const configuredDialect = ownScaffoldOption(options, 'dialect');
  const configuredDeploymentTarget = ownScaffoldOption(options, 'deploymentTarget');
  const configuredRetention = ownScaffoldOption(options, 'retention');
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
  if (
    configuredDeploymentTarget !== undefined &&
    !creatorChoiceValues('deploymentTarget').includes(configuredDeploymentTarget)
  ) {
    throw new TypeError(
      "create-kovo option 'deploymentTarget' must be 'node', 'vercel', or 'cloudflare'.",
    );
  }
  if (
    configuredRetention !== undefined &&
    !creatorChoiceValues('retention').includes(configuredRetention)
  ) {
    throw new TypeError("create-kovo option 'retention' must be 'unconfigured' or 'retained-24h'.");
  }
  const name = configuredName ?? basename(root);
  const project = createKovoProject({
    ...(configuredDeploymentTarget === undefined
      ? {}
      : { deploymentTarget: configuredDeploymentTarget }),
    ...(configuredDialect === undefined ? {} : { dialect: configuredDialect }),
    name,
    ...(configuredRetention === undefined ? {} : { retention: configuredRetention }),
  });
  return writeGeneratedKovoProject(root, project, disableGit);
}

export function writeKovoExampleProject(
  targetDirectory: string,
  options: WriteKovoExampleProjectOptions,
): WriteKovoProjectResult {
  const root = resolve(targetDirectory);
  const configuredName = ownScaffoldOption(options, 'name');
  const example = ownScaffoldOption(options, 'example');
  const disableGit = ownScaffoldOption(options, 'disableGit');
  if (configuredName !== undefined && typeof configuredName !== 'string') {
    throw new TypeError("create-kovo option 'name' must be a string.");
  }
  if (example === undefined || !creatorChoiceValues('example').includes(example)) {
    throw new TypeError("create-kovo option 'example' must be 'crm' or 'commerce'.");
  }
  if (disableGit !== undefined && typeof disableGit !== 'boolean') {
    throw new TypeError("create-kovo option 'disableGit' must be a boolean.");
  }
  const project = createKovoExampleProject({
    example,
    name: configuredName ?? basename(root),
  });
  return writeGeneratedKovoProject(root, project, disableGit);
}

function writeGeneratedKovoProject(
  root: string,
  project: CreateKovoProject,
  disableGit: boolean | undefined,
): WriteKovoProjectResult {
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

function ownScaffoldOption<Options extends object, Key extends Extract<keyof Options, string>>(
  options: Options,
  key: Key,
): Options[Key] | undefined {
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
  return before.value as Options[Key];
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
    const options = readCreateKovoCliOptions(args);
    return runCreateKovoCli(options);
  } catch (error) {
    process.stderr.write(renderCliError(error));
    return 1;
  }
}

export type CreateKovoPrompt = (question: string) => Promise<string>;

/**
 * Interactive bin adapter. Explicit argv always uses the same deterministic parser as `main`;
 * prompt answers are projected into that parser's semantic result shape before any filesystem
 * write. Tests and embedders may inject `ask` without replacing stdin/stdout globals.
 */
export async function mainAsync(
  args: readonly string[] = process.argv.slice(2),
  { ask }: { ask?: CreateKovoPrompt } = {},
): Promise<number> {
  if (args.length > 0 || ask === undefined) return main(args);

  try {
    const options = await readInteractiveCreateKovoOptions(ask);
    return runCreateKovoCli(options);
  } catch (error) {
    process.stderr.write(renderCliError(error));
    return 1;
  }
}

export async function readInteractiveCreateKovoOptions(
  ask: CreateKovoPrompt,
): Promise<CreateKovoCliOptions> {
  const targetDirectory = await promptText(
    ask,
    'Target directory',
    CREATE_KOVO_CREATOR_SCHEMA.name.interactiveDefault,
  );
  const name = await promptText(
    ask,
    CREATE_KOVO_CREATOR_SCHEMA.name.label,
    basename(targetDirectory),
  );
  const dialect = await promptChoice(ask, 'dialect');
  const install = await promptChoice(ask, 'install');
  const git = await promptChoice(ask, 'git');
  const deploymentTarget = await promptChoice(ask, 'deploymentTarget');
  const retention = await promptChoice(ask, 'retention');
  return {
    deploymentTarget,
    disableGit: git === 'skip',
    dialect,
    ...(dialect === 'sqlite' ? { experimentalSqlite: true } : {}),
    install,
    name,
    retention,
    targetDirectory,
  };
}

function runCreateKovoCli(options: CreateKovoCliOptions): number {
  if (options.example !== undefined) {
    assertExampleCliOptionsCompatible(options);
    const install = options.install ?? CREATE_KOVO_CREATOR_SCHEMA.install.nonInteractiveDefault;
    const result = writeKovoExampleProject(options.targetDirectory, {
      ...(options.disableGit === undefined ? {} : { disableGit: options.disableGit }),
      example: options.example,
      ...(options.name === undefined ? {} : { name: options.name }),
    });
    if (install === 'auto') installKovoProject(result.root);
    process.stdout.write(renderExampleSuccess(result, options.example, install));
    return 0;
  }

  const dialect = options.dialect ?? CREATE_KOVO_CREATOR_SCHEMA.dialect.nonInteractiveDefault;
  const install = options.install ?? CREATE_KOVO_CREATOR_SCHEMA.install.nonInteractiveDefault;
  const deploymentTarget =
    options.deploymentTarget ?? CREATE_KOVO_CREATOR_SCHEMA.deploymentTarget.nonInteractiveDefault;
  const retention = options.retention ?? CREATE_KOVO_CREATOR_SCHEMA.retention.nonInteractiveDefault;
  const resolvedOptions: CreateKovoCliOptions = {
    ...options,
    deploymentTarget,
    dialect,
    install,
    retention,
  };
  assertCreateKovoSqliteScaffoldAllowed(resolvedOptions);
  const result = writeKovoProject(options.targetDirectory, {
    deploymentTarget,
    dialect,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.disableGit === undefined ? {} : { disableGit: options.disableGit }),
    retention,
  });
  if (install === 'auto') installKovoProject(result.root);
  process.stdout.write(
    renderSuccess(result, {
      deploymentTarget,
      dialect,
      install,
      retention,
    }),
  );
  return 0;
}

function assertExampleCliOptionsCompatible(options: CreateKovoCliOptions): void {
  const incompatible = [
    ...(options.dialect === undefined ? [] : ['--dialect/--postgres/--sqlite']),
    ...(options.experimentalSqlite === undefined ? [] : ['--experimental-sqlite']),
    ...(options.deploymentTarget === undefined ? [] : ['--deployment']),
    ...(options.retention === undefined ? [] : ['--retention']),
  ];
  if (incompatible.length > 0) {
    throw new Error(`Option --example cannot be combined with ${incompatible.join(', ')}.`);
  }
}

function installKovoProject(root: string): void {
  const packageManager = packageManagerCommand();
  try {
    createKovoCommandShell.execFileSync(packageManager, ['install', '--ignore-scripts'], {
      cwd: root,
      stdio: 'inherit',
    });
    createKovoCommandShell.execFileSync(packageManager, ['exec', 'kovo', 'check', 'lifecycle'], {
      cwd: root,
      stdio: 'inherit',
    });
    createKovoCommandShell.execFileSync(packageManager, ['rebuild'], {
      cwd: root,
      stdio: 'inherit',
    });
  } catch (error) {
    throw new CreateKovoInstallError(
      root,
      `safe ${packageManager} install failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

class CreateKovoInstallError extends Error {
  readonly root: string;

  constructor(root: string, message: string) {
    super(message);
    this.root = root;
  }
}

async function promptText(
  ask: CreateKovoPrompt,
  label: string,
  defaultValue: string,
): Promise<string> {
  const answer = (await ask(`${label} [${defaultValue}]: `)).trim();
  return answer.length === 0 ? defaultValue : answer;
}

async function promptChoice<
  Key extends keyof Pick<
    typeof CREATE_KOVO_CREATOR_SCHEMA,
    'deploymentTarget' | 'dialect' | 'git' | 'install' | 'retention'
  >,
>(
  ask: CreateKovoPrompt,
  key: Key,
): Promise<(typeof CREATE_KOVO_CREATOR_SCHEMA)[Key]['choices'][number]['value']> {
  const field = CREATE_KOVO_CREATOR_SCHEMA[key];
  const choices = field.choices;
  const lines = choices.map(
    (choice, index) => `${String(index + 1)}. ${choice.label} — ${choice.description}`,
  );
  const defaultIndex = choices.findIndex((choice) => choice.value === field.interactiveDefault);
  const answer = (
    await ask(`${field.label}\n${lines.join('\n')}\nChoice [${String(defaultIndex + 1)}]: `)
  ).trim();
  const selectedIndex = answer.length === 0 ? defaultIndex : Number(answer) - 1;
  const selected = choices[selectedIndex];
  if (selected === undefined || !Number.isInteger(selectedIndex)) {
    throw new Error(
      `Invalid ${field.label.toLowerCase()} choice: ${answer || '<empty>'}. Expected 1-${String(
        choices.length,
      )}.`,
    );
  }
  return selected.value;
}

function readTemplate(path: string): string {
  return readFileSync(new URL(path, templateRoot), 'utf8');
}

function templatePathForDialect(file: TemplateFile, dialect: CreateKovoDialect): string {
  return dialect === 'sqlite' && file.sqlitePath ? file.sqlitePath : (file.sourcePath ?? file.path);
}

function renderTemplate(source: string, values: Readonly<Record<string, string>>): string {
  return source.replaceAll(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Unknown create-kovo template variable: ${key}`);
    }
    return value;
  });
}

function templateValues(
  name: string,
  appId: string,
  deploymentTarget: CreateKovoDeploymentTarget,
  retention: CreateKovoRetentionPosture,
): Record<string, string> {
  return {
    app_id: appId,
    deployment_target: deploymentTarget,
    kovo_better_auth_version: packageVersion('@kovojs/better-auth'),
    kovo_browser_version: packageVersion('@kovojs/browser'),
    kovo_cli_version: packageVersion('@kovojs/cli'),
    kovo_core_version: packageVersion('@kovojs/core'),
    kovo_drizzle_version: packageVersion('@kovojs/drizzle'),
    kovo_server_version: packageVersion('@kovojs/server'),
    kovo_style_version: packageVersion('@kovojs/style'),
    kovo_test_version: packageVersion('@kovojs/test'),
    kovo_ui_version: packageVersion('@kovojs/ui'),
    name,
    package_manager: rootPackageManager(),
    production_start_command:
      deploymentTarget === 'node'
        ? 'npm start            # NODE_ENV=production node dist/server/server.mjs'
        : `# deploy dist/ with the generated ${deploymentTarget} preset output`,
    retention_posture: retention,
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

function renderSuccess(
  result: WriteKovoProjectResult,
  options: {
    deploymentTarget: CreateKovoDeploymentTarget;
    dialect: CreateKovoDialect;
    install: CreateKovoInstallChoice;
    retention: CreateKovoRetentionPosture;
  },
): string {
  const packageManager = packageManagerCommand();
  return [
    'Kovo app created',
    '',
    `  Directory   ${result.root}`,
    `  Name        ${result.name}`,
    `  Dialect     ${options.dialect}`,
    `  Deploy      ${options.deploymentTarget}`,
    `  Retention   ${options.retention}`,
    `  Install     ${options.install === 'auto' ? 'complete' : 'skipped'}`,
    `  Git         ${existsSync(resolve(result.root, '.git')) ? 'initialized' : 'not initialized'}`,
    `  Files       ${result.files.length}`,
    ...(options.dialect === 'sqlite'
      ? [
          '',
          '  WARNING SQLite is experimental and single-principal/local-dev only.',
          '  It does not provide Kovo authorization or confidentiality guarantees.',
        ]
      : []),
    '',
    'Next steps',
    `  cd ${shellQuote(result.root)}`,
    ...(options.install === 'never'
      ? [
          `  ${packageManager} install --ignore-scripts`,
          `  ${packageManager} exec kovo check lifecycle`,
          `  ${packageManager} rebuild`,
        ]
      : []),
    `  ${packageManager} run dev`,
    `  ${packageManager} run check`,
    '',
  ].join('\n');
}

function renderExampleSuccess(
  result: WriteKovoProjectResult,
  example: CreateKovoExampleName,
  install: CreateKovoInstallChoice,
): string {
  const packageManager = packageManagerCommand();
  return [
    'Kovo example created',
    '',
    `  Directory   ${result.root}`,
    `  Name        ${result.name}`,
    `  Example     ${example}`,
    `  Install     ${install === 'auto' ? 'complete' : 'skipped'}`,
    `  Git         ${existsSync(resolve(result.root, '.git')) ? 'initialized' : 'not initialized'}`,
    `  Files       ${result.files.length}`,
    '',
    'Next steps',
    `  cd ${shellQuote(result.root)}`,
    ...(install === 'never'
      ? [
          `  ${packageManager} install --ignore-scripts`,
          `  ${packageManager} exec kovo check lifecycle`,
          `  ${packageManager} rebuild`,
        ]
      : []),
    `  ${packageManager} run typecheck`,
    `  ${packageManager} run test`,
    `  ${packageManager} run dev`,
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

  if (error instanceof CreateKovoInstallError) {
    lines.push(
      '',
      'The project files were created, but dependency installation did not complete.',
      '',
      `  cd ${shellQuote(error.root)}`,
      `  ${packageManagerCommand()} install --ignore-scripts`,
      `  ${packageManagerCommand()} exec kovo check lifecycle`,
      `  ${packageManagerCommand()} rebuild`,
      `  ${packageManagerCommand()} run dev`,
      `  ${packageManagerCommand()} run check`,
    );
  } else if (message === 'Missing target directory.') {
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
    message.startsWith('Unsupported value for ') ||
    message.startsWith('Option ') ||
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
  if (process.argv.length === 2 && process.stdin.isTTY && process.stdout.isTTY) {
    const prompts = createInterface({ input: process.stdin, output: process.stdout });
    try {
      process.exitCode = await mainAsync([], {
        ask: (question) => prompts.question(question),
      });
    } finally {
      prompts.close();
    }
  } else {
    process.exitCode = main();
  }
}
