import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { kovoDocsMirrorRemotes } from '@kovojs/core/internal/agent-docs';
import { describe, expect, it, vi } from 'vitest';

import {
  CREATE_KOVO_HELP,
  CREATE_KOVO_HOST_POSTURE,
  CREATE_KOVO_REFERENCE,
  createKovoCommandShell,
  createKovoProject,
  demoPasswordEnvVar,
  main,
  mainAsync,
  readInteractiveCreateKovoOptions,
  renderCreateKovoHelp,
  type WriteKovoProjectOptions,
  writeKovoProject,
} from './index.js';
import { linkStarterBuildDependencies, resolveDependencyRoot } from './index.test-support.js';

const TEMPLATE_FILES = [
  'package.json',
  '.npmrc',
  'tsconfig.json',
  'kovo.config.ts',
  'vite.config.ts',
  'index.html',
  '.github/workflows/ci.yml',
  'README.md',
  'src/schema.ts',
  'src/db.ts',
  'src/_kovo/app-runtime-db-options.ts',
  'src/_kovo/app-runtime-db.ts',
  'src/auth.ts',
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
];
const AGENT_DOC_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  ...kovoDocsMirrorRemotes.map((remote) => `.kovo/docs/${remote.path}`),
  '.kovo/docs/metadata.json',
];
const GENERATED_FILES = [...AGENT_DOC_FILES, '.env', '.env.example', '.gitignore'];
const ALL_FILES = [...AGENT_DOC_FILES, ...TEMPLATE_FILES, '.env', '.env.example', '.gitignore'];
const SQLITE_TEMPLATE_FILES = [
  'package.sqlite.json',
  'README.sqlite.md',
  'src/schema.sqlite.ts',
  'src/db.sqlite.ts',
  'src/_kovo/app-runtime-db.sqlite.ts',
  'src/auth.sqlite.ts',
];
const createKovoPackageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const SOUND_SUBSET_SCRIPT = fileURLToPath(
  new URL('../../cli/src/commands/sound-subset.mjs', import.meta.url),
);
const createKovoPackage = JSON.parse(
  readFileSync(join(createKovoPackageRoot, 'package.json'), 'utf8'),
) as { version: string };

describe('create-kovo starter (metadata)', () => {
  it('scaffolds the real template file set with no unrendered placeholders', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-scaffold-'));

    try {
      const templateUrl = new URL('../templates/', import.meta.url);
      for (const file of TEMPLATE_FILES) {
        expect(existsSync(new URL(file === '.npmrc' ? 'npmrc' : file, templateUrl))).toBe(true);
      }
      for (const file of SQLITE_TEMPLATE_FILES) {
        expect(existsSync(new URL(file, templateUrl))).toBe(true);
      }

      const result = writeKovoProject(root, { name: 'My App' });
      expect(result).toEqual({ files: ALL_FILES, name: 'my-app', root });

      for (const file of TEMPLATE_FILES) {
        const source = readFileSync(join(root, file), 'utf8');
        // No unrendered mustache placeholders — match the exact token shape `renderTemplate`
        // substitutes (`{{identifier}}`, no spaces/dots). GitHub Actions `${{ runner.os }}`
        // expressions (spaces + dots) are intentional workflow syntax, not mustache tokens.
        expect(source).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
      }

      const project = createKovoProject({ name: 'My App' });
      expect(project.name).toBe('my-app');
      expect(project.files.map((file) => file.path)).toEqual(ALL_FILES);
      expect(readFileSync(join(root, 'src/mutations.ts'), 'utf8')).toContain(
        "registry: { tables: ['contacts'], touches: [contact] }",
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('scaffolds local agent docs and points CLAUDE.md at AGENTS.md', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-agents-'));

    try {
      writeKovoProject(root, { name: 'Agent Docs' });

      const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(agents).toContain('# Agent Instructions');
      expect(agents).toContain('<!-- BEGIN:kovo-rules -->');
      expect(agents).toContain(`<!-- kovo-rules-version: ${createKovoPackage.version} -->`);
      expect(agents).toContain('`kovo check`');
      expect(agents).toContain('Docs root: `./.kovo/docs/`.');
      expect(agents).toContain('- Getting Started (`getting-started/`): why-kovo, quickstart');
      expect(agents).toContain('- Guides (`guides/`): routing, layouts, queries, live-queries');
      expect(agents).not.toContain('## Read First');
      expect(agents).not.toContain('./.kovo/docs/spec.md');
      expect(agents).not.toContain('./.kovo/docs/llms.txt');
      expect(agents).not.toContain('./.kovo/docs/llms-full.txt');
      expect(agents).toContain('<!-- END:kovo-rules -->');

      expect(readlinkSync(join(root, 'CLAUDE.md'))).toBe('AGENTS.md');
      expect(realpathSync(join(root, 'CLAUDE.md'))).toBe(realpathSync(join(root, 'AGENTS.md')));

      expect(readFileSync(join(root, '.kovo/docs/kovo-rules.md'), 'utf8')).toContain('## Commands');
      expect(existsSync(join(root, '.kovo/docs/getting-started/why-kovo.md'))).toBe(true);
      expect(readFileSync(join(root, '.kovo/docs/llms.txt'), 'utf8')).toContain(
        'Compact local docs index',
      );
      const metadata = JSON.parse(readFileSync(join(root, '.kovo/docs/metadata.json'), 'utf8')) as {
        source?: string;
        version?: string;
      };
      expect(metadata).toMatchObject({
        source: 'installed-package',
        version: createKovoPackage.version,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('declares the building-block dependencies and the lean script set', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-pkg-'));

    try {
      writeKovoProject(root, { name: 'My App' });
      const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        name?: string;
        packageManager?: string;
        pnpm?: {
          ignoredBuiltDependencies?: string[];
          onlyBuiltDependencies?: string[];
          overrides?: Record<string, string>;
        };
        scripts?: Record<string, string>;
      };

      expect(packageJson.name).toBe('my-app');
      expect(packageJson.dependencies).toMatchObject({
        '@kovojs/better-auth': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/core': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/drizzle': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/server': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/style': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/ui': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@node-rs/argon2': '2.0.2',
        'drizzle-orm': expect.any(String),
        pg: expect.any(String),
      });
      expect(packageJson.dependencies).not.toHaveProperty('better-auth');
      expect(Object.values(packageJson.dependencies ?? {})).not.toContain('workspace:*');
      expect(Object.values(packageJson.devDependencies ?? {})).not.toContain('workspace:*');
      for (const [name, version] of Object.entries({
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.devDependencies ?? {}),
      })) {
        expect(version, `${name} must be immutable in a generated starter`).toMatch(
          /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u,
        );
      }
      expect(packageJson.packageManager).toBe('pnpm@10.12.1');
      expect(packageJson.pnpm?.ignoredBuiltDependencies).toEqual(['esbuild']);
      expect(packageJson.pnpm?.onlyBuiltDependencies).toEqual(['@node-rs/argon2']);
      expect(packageJson.pnpm?.overrides).toEqual({ '@node-rs/argon2': '2.0.2' });
      expect(packageJson.dependencies).not.toHaveProperty('better-sqlite3');
      expect(packageJson.dependencies?.['pgsql-ast-parser']).toBe('12.0.2');
      expect(packageJson.devDependencies).toMatchObject({
        '@kovojs/cli': expect.stringMatching(/^\d+\.\d+\.\d+/),
      });
      expect(packageJson.devDependencies).not.toHaveProperty('@kovojs/compiler');
      expect(readFileSync(join(root, '.npmrc'), 'utf8')).toBe(
        [
          'registry=https://registry.npmjs.org/',
          '@kovojs:registry=https://registry.npmjs.org/',
          'strict-dep-builds=true',
          'dangerously-allow-all-builds=false',
          'package-manager-strict-version=true',
          '',
        ].join('\n'),
      );
      expect(packageJson.scripts).toMatchObject({
        'build:prod': 'kovo build ./src/app.tsx',
        check: 'kovo check',
        'check:endpoint-posture': 'kovo check endpoint-posture',
        dev: 'kovo dev ./src/app.tsx',
        serve: 'pnpm run build:prod && NODE_ENV=production node dist/server/server.mjs',
        start: 'NODE_ENV=production node dist/server/server.mjs',
        test: 'kovo test',
      });
      // Removed fiction/wrapper scripts are gone.
      expect(packageJson.scripts).not.toHaveProperty('emit-graph');
      expect(packageJson.scripts).not.toHaveProperty('static');
      expect(packageJson.scripts).not.toHaveProperty('serve:dev');

      const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
      expect(ciWorkflow).toContain('corepack pnpm run build:prod');
      expect(ciWorkflow).toContain('node-version: 24.10.0');
      expect(ciWorkflow).toContain('permissions:\n  contents: read');
      expect(ciWorkflow).not.toContain('actions: read');
      expect(ciWorkflow).toContain('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5');
      expect(ciWorkflow).toContain('persist-credentials: false');
      expect(ciWorkflow).toContain('actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830');
      expect(ciWorkflow).toContain('corepack pnpm install --frozen-lockfile --ignore-scripts');
      expect(ciWorkflow).toContain('corepack pnpm exec kovo check lifecycle');
      expect(ciWorkflow).toContain('corepack pnpm rebuild');
      expect(ciWorkflow).toContain('corepack pnpm run check');
      expect(ciWorkflow).toContain('corepack pnpm run test');
      expect(ciWorkflow).toContain('corepack pnpm run check:endpoint-posture');
      expect(ciWorkflow.indexOf('corepack pnpm run build:prod')).toBeLessThan(
        ciWorkflow.indexOf('corepack pnpm run check:endpoint-posture'),
      );
      expect(ciWorkflow).not.toContain('- run: vp ');
      expect(ciWorkflow).not.toMatch(/uses: [^\n]+@v\d/u);
      expect(ciWorkflow).not.toContain('run: kovo build');

      const readme = readFileSync(join(root, 'README.md'), 'utf8');
      expect(readme).not.toContain('peer warning');
      expect(readme).toContain('keep that posture in your process');
      expect(readme).toContain('blocks private-network egress by default');
      expect(readme).toContain('KOVO_DATA_DIR');
      expect(readme).toContain('The source-backed check');
      expect(readme).toMatch(/needs no\s+deployment-retention declaration/u);

      const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toContain("host: process.env.HOST ?? '127.0.0.1'");
      expect(viteConfig).toContain('port: Number.isFinite(port) ? port : 5173');
      expect(viteConfig).toContain('strictPort: true');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps Postgres as the default scaffold dialect', () => {
    const project = createKovoProject({ name: 'Default Dialect' });
    const files = new Map(project.files.map((file) => [file.path, file.source]));
    const packageJson = JSON.parse(files.get('package.json') ?? '{}') as {
      dependencies?: Record<string, string>;
      pnpm?: {
        ignoredBuiltDependencies?: string[];
        onlyBuiltDependencies?: string[];
        overrides?: Record<string, string>;
      };
    };

    expect(files.get('package.json')).toContain('"pg"');
    expect(files.get('package.json')).toContain('"@electric-sql/pglite"');
    expect(files.get('package.json')).not.toContain('"better-sqlite3"');
    expect(packageJson.dependencies?.['@node-rs/argon2']).toBe('2.0.2');
    expect(packageJson.pnpm?.ignoredBuiltDependencies).toEqual(['esbuild']);
    expect(packageJson.pnpm?.onlyBuiltDependencies).toEqual(['@node-rs/argon2']);
    expect(packageJson.pnpm?.overrides).toEqual({ '@node-rs/argon2': '2.0.2' });
    expect(files.get('src/db.ts')).toContain("import type { Reader } from '@kovojs/server'");
    expect(files.get('src/db.ts')).toContain(
      "import type { PgAsyncDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'",
    );
    expect(files.get('src/db.ts')).toContain(
      "import type { EmptyRelations } from 'drizzle-orm/relations'",
    );
    expect(files.get('src/db.ts')).toContain(
      "import { appRuntimeReadonlyDb } from './_kovo/app-runtime-db.js'",
    );
    expect(files.get('src/db.ts')).toContain(
      'export type AppDb = PgAsyncDatabase<PgQueryResultHKT, EmptyRelations>',
    );
    expect(files.get('src/db.ts')).toContain('export type AppReadonlyDb = Reader<AppDb>');
    expect(files.get('src/db.ts')).toContain(
      'export const readonlyAppDb: AppReadonlyDb = appRuntimeReadonlyDb',
    );
    expect(files.get('src/db.ts')).not.toContain('createAppDb');
    expect(files.get('src/db.ts')).not.toContain('CreatedAppDb');
    expect(files.get('src/db.ts')).not.toContain('appDbReady');
    expect(files.get('src/db.ts')).not.toContain('export function appDbProvider');
    expect(files.get('src/db.ts')).not.toContain('export const appDb = appDatabase.db');
    expect(files.get('src/_kovo/app-runtime-db-options.ts')).toContain(
      'type KovoPostgresAppRuntimeOptions',
    );
    expect(files.get('src/_kovo/app-runtime-db-options.ts')).toContain(
      "import * as schema from '../schema.js'",
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      "import type { AppReadonlyDb } from '../db.js'",
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain("} from '@kovojs/server';");
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain(
      '@kovojs/server/internal/managed-db',
    );
    expect(files.get('src/_kovo/app-runtime-db-options.ts')).toContain(
      'export const appRuntimeDbOptions = postgresAppRuntimeOptions({\n  schema: appRuntimeSchema,\n  seedSql: SEED_CONTACTS,\n}) satisfies KovoPostgresAppRuntimeOptions;',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const authSystemDb = postgresSystemDbForGeneratedIntegration(appDatabase, {',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('function lazyAppDatabaseValue');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export const appRuntimeDbReady: Promise<void> = appDatabase.ready;',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('new Proxy');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('Reflect.');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('then(onFulfilled');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('SCHEMA_TABLES');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('getTableConfig');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain(
      'sortTablesByForeignKeyDependencies',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('CREATE TABLE IF NOT EXISTS');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('ADD COLUMN IF NOT EXISTS');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('createPostgresScopedClient');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('applyPgliteOwnerPolicies');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('createAuthorizationCensusDb');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('createDeclaredWriteDb');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('SET TRANSACTION READ ONLY');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('SET LOCAL ROLE');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('extractKovoRuntimeDbMetadata');
    expect(files.get('src/db.ts')).not.toContain('PgliteDatabase<typeof schema>');
    expect(files.get('src/db.ts')).not.toContain('drizzle({ client, schema })');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('void client.exec');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain(
      'readonlyDb(db).exec(SCHEMA_DDL)',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb;',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'return createBetterAuthPostgresBindingsFromEnvironment<',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain(
      'export function createAuthAdapter',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export function createAppAuthBindings(options: AppAuthBindingOptions)',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('systemDb: authSystemDb,');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('process.env');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('developmentSeed');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('export const appRuntimeAuthDb');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export const appRuntimeDbProvider = appDatabase.db;',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('__kovoStarterAppDatabase');
    expect(files.get('src/_kovo/app-runtime-db-options.ts')).toContain(
      'ON CONFLICT (id) DO NOTHING',
    );
    expect(files.get('src/kovo.ts')).toContain('appRuntimeMutationReplayStore');
    expect(files.get('src/kovo.ts')).toContain('appRuntimePrincipalEpochStore');
    expect(files.get('src/kovo.ts')).toContain(
      'mutationReplayStore: appRuntimeMutationReplayStore,',
    );
    expect(files.get('src/kovo.ts')).toContain(
      'principalEpochStore: appRuntimePrincipalEpochStore,',
    );
    expect(files.get('src/kovo.ts')).toContain("} from './_kovo/app-runtime-db.js'");
    expect(files.get('src/app.tsx')).not.toContain("import { appDbReady } from './db.js'");
    expect(files.get('src/app.tsx')).not.toContain('appRuntimeDbReady');
    expect(files.get('src/kovo.ts')).toContain('db: appRuntimeDbProvider,');
    expect(files.get('src/app.tsx')).not.toContain('db: () => appDb');
    expect(files.get('src/app.test.ts')).toContain("spawn('kovo', ['dev', './src/app.tsx']");
    expect(files.get('src/app.test.ts')).toContain('await fetch(');
    expect(files.get('src/app.test.ts')).toContain('toBeInstanceOf(Response)');
    expect(files.get('src/app.test.ts')).toContain("response.headers.get('content-type')");
    expect(files.get('src/app.test.ts')).not.toContain("from './app.js'");
    expect(files.get('src/app.test.ts')).not.toContain('isKovoApp');
    expect(files.get('src/app.test.ts')).not.toContain('/internal/');
    expect(files.get('vite.config.ts')).not.toContain('setupFiles');
    expect(files.has('src/test-setup.ts')).toBe(false);
    expect([...files.values()].join('\n')).not.toContain(
      '@kovojs/core/internal/classifier-verdict',
    );
    expect(files.get('src/schema.ts')).toContain(
      'import { bigint, boolean, integer, pgTable, text, timestamp }',
    );
    expect(files.get('src/schema.ts')).toContain('export const rateLimit = pgTable(');
    expect(files.get('src/schema.ts')).toContain("  'rateLimit',");
    expect(files.get('src/schema.ts')).toContain("domain: 'auth-rate-limit'");
    expect(files.get('src/schema.ts')).toContain('authzPolicy: sql`false`');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain("provider: 'pg'");
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('drizzleAdapter');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain("from 'better-auth'");
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'createBetterAuthPostgresBindingsFromEnvironment',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('betterAuthPostgresSecret');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('secret:');
    expect(files.get('src/auth.ts')).toContain(
      "import { appRuntimeDbReady, createAppAuthBindings } from './_kovo/app-runtime-db.js'",
    );
    expect(files.get('src/auth.ts')).toContain('const authBindings = createAppAuthBindings({');
    expect(files.get('src/auth.ts')).toContain('betterAuthCsrfFromEnvironment({');
    expect(files.get('src/auth.ts')).toContain(
      'await appRuntimeDbReady;\nawait authBindings.seedDemoUser();',
    );
    expect(files.get('src/auth.ts')).not.toContain('export const appSeedDemoUser');
    expect(files.get('src/auth.ts')).not.toContain('process.env');
    expect(files.get('src/auth.ts')).not.toContain('loadEnvFile');
    expect(files.get('src/auth.ts')).not.toContain('requireAuthSecret');
    expect(files.get('src/auth.ts')).not.toContain('appRuntimeAuthDb');
    expect(files.get('src/auth.ts')).not.toContain('auth.$context');
    expect(files.get('src/auth.ts')).not.toContain('auth.api');
    expect(files.get('src/auth.ts')).not.toContain('drizzleAdapter(');
    expect(files.get('src/auth.ts')).not.toContain('database: drizzleAdapter(appDb,');
    expect(files.get('README.md')).toContain('### Deploying to Postgres');
    expect(files.get('README.md')).toContain('kovo db generate');
    expect(files.get('README.md')).toContain('KOVO_RUNTIME_DATABASE_URL');
    expect(files.get('README.md')).toContain('KOVO_ADMIN_DATABASE_URL');
    expect(files.get('README.md')).toContain('BETTER_AUTH_URL');
    expect(files.get('src/app.tsx')).toContain(
      'function HomePage({ userName }: { userName: string }): string',
    );
    expect(files.get('src/app.tsx')).toContain('<HomePage userName={request.session.user.name} />');
    expect(files.get('src/app.tsx')).not.toContain('<HomePage request={request} />');
    expect(files.get('src/app.tsx')).toContain(`<main>
        <ContactsRegion />
      </main>`);
    expect(files.get('src/app.tsx')).not.toContain('<span style={styles.who}>');
    expect(files.get('src/app.tsx')).toContain("if (request.session) return redirect('/', {});");
  });

  it('emits the selected deployment and honest retention posture', () => {
    const project = createKovoProject({
      deploymentTarget: 'vercel',
      dialect: 'postgres',
      name: 'Vercel App',
      retention: 'retained-24h',
    });
    const files = new Map(project.files.map((file) => [file.path, file.source]));
    const config = files.get('kovo.config.ts') ?? '';
    const readme = files.get('README.md') ?? '';
    const manifest = JSON.parse(files.get('package.json') ?? '{}') as {
      scripts?: Record<string, string>;
    };

    expect(config).toContain("import { defineConfig, vercel } from '@kovojs/server/build';");
    expect(config).toContain('preset: vercel({');
    expect(config).toContain('hours: 24');
    expect(config).toContain("immutableClientModules: 'retained'");
    expect(config).toContain("priorTokenQueryReads: 'retained'");
    expect(readme).toContain('selected the `vercel` preset');
    expect(readme).toContain('retention posture\n`retained-24h`');
    expect(readme).toContain('not currently supported development hosts');
    expect(manifest.scripts).not.toHaveProperty('serve');
    expect(manifest.scripts).not.toHaveProperty('start');

    const unconfigured = createKovoProject({
      deploymentTarget: 'node',
      name: 'Node App',
      retention: 'unconfigured',
    });
    const unconfiguredConfig =
      unconfigured.files.find((file) => file.path === 'kovo.config.ts')?.source ?? '';
    expect(unconfiguredConfig).toContain('preset: node()');
    expect(unconfiguredConfig).toContain('build remains fail-closed');
    expect(unconfiguredConfig).not.toContain('hours: 24');
  });

  it('keeps deployment environment access out of generated production source', () => {
    for (const dialect of ['postgres', 'sqlite'] as const) {
      const project = createKovoProject({ dialect, name: `Environment Boundary ${dialect}` });
      const productionSource = project.files
        .filter((file) => file.path.startsWith('src/') && !file.path.endsWith('.test.ts'))
        .map((file) => `// ${file.path}\n${file.source}`)
        .join('\n');

      expect(productionSource).not.toContain('process.env');
      expect(productionSource).not.toContain('loadEnvFile');
      expect(productionSource).not.toContain('BETTER_AUTH_SECRET');
      expect(productionSource).not.toContain('KOVO_CSRF_SECRET');
      expect(productionSource).not.toContain('BETTER_AUTH_URL');
      expect(productionSource).not.toContain('KOVO_DEMO_PASSWORD');
      expect(productionSource).not.toContain('baseURL:');
      expect(productionSource).toContain('betterAuthCsrfFromEnvironment({');
      expect(productionSource).toContain(
        dialect === 'postgres'
          ? 'createBetterAuthPostgresBindingsFromEnvironment<'
          : 'createBetterAuthSqliteBindingsFromEnvironment<',
      );
    }
  });

  it('classifies Better Auth credential columns as secret in scaffolded schema', () => {
    const defaultProject = createKovoProject({ name: 'Auth Secret Proof' });
    const defaultFiles = new Map(defaultProject.files.map((file) => [file.path, file.source]));
    const sqliteProject = createKovoProject({
      dialect: 'sqlite',
      name: 'Sqlite Auth Secret Proof',
    });
    const sqliteFiles = new Map(sqliteProject.files.map((file) => [file.path, file.source]));

    const postgresSchema = defaultFiles.get('src/schema.ts');
    expect(postgresSchema).toContain("domain: 'auth'");
    expect(postgresSchema).toContain('key: columns.userId');
    expect(postgresSchema).toContain('owner: columns.userId');
    expect(postgresSchema).toContain('secret: [columns.token]');
    expect(postgresSchema).toContain(
      'secret: [columns.password, columns.accessToken, columns.refreshToken, columns.idToken]',
    );

    const sqliteSchema = sqliteFiles.get('src/schema.ts');
    expect(sqliteSchema).toContain("domain: 'auth'");
    expect(sqliteSchema).toContain('key: columns.userId');
    expect(sqliteSchema).toContain('owner: columns.userId');
    expect(sqliteSchema).toContain('secret: [columns.token]');
    expect(sqliteSchema).toContain(
      'secret: [columns.password, columns.accessToken, columns.refreshToken, columns.idToken]',
    );

    for (const schemaSource of [postgresSchema, sqliteSchema]) {
      // SPEC.md §6.6 / §10.1: classification is carried by the schema annotation the
      // compiler reads, not by TypeScript-only branding. KV435 rejects projections from
      // these columns once the build graph ingests this starter schema.
      expect(schemaSource).toContain("domain: 'auth'");
      expect(schemaSource).toContain('key: columns.userId');
      expect(schemaSource).toContain('owner: columns.userId');
      expect(schemaSource).toContain('secret: [columns.token]');
      expect(schemaSource).toContain(
        'secret: [columns.password, columns.accessToken, columns.refreshToken, columns.idToken]',
      );
      expect(schemaSource).toContain("password: text('password'),");
      expect(schemaSource).toContain("accessToken: text('accessToken'),");
      expect(schemaSource).toContain("refreshToken: text('refreshToken'),");
      expect(schemaSource).toContain("idToken: text('idToken'),");
      expect(schemaSource).toContain("token: text('token').notNull().unique(),");
    }
  });

  it('emits SPEC §6.6 sound-subset policy and framework anonymous CSRF binding', () => {
    const project = createKovoProject({ name: 'Policy Proof' });
    const files = new Map(project.files.map((file) => [file.path, file.source]));
    const soundSubsetSource = readFileSync(SOUND_SUBSET_SCRIPT, 'utf8');

    expect(files.get('tsconfig.json')).toContain('"strict": true');
    expect(files.get('tsconfig.json')).toContain('"noUncheckedIndexedAccess": true');
    expect(files.has('scripts/check-sound-subset.mjs')).toBe(false);
    expect(soundSubsetSource).toContain('SPEC.md §6.6 sound subset bans any');
    expect(soundSubsetSource).toContain('.sort((left, right) => left.localeCompare(right));');
    expect(soundSubsetSource).toContain('bans non-type imports of src/_kovo/app-runtime-db');
    expect(soundSubsetSource).toContain('FRAMEWORK_GENERATED_SOUND_SUBSET_EXEMPT_FILES');
    expect(soundSubsetSource).toContain(
      "['src/auth.ts', new Set(['appRuntimeDbReady', 'createAppAuthBindings'])]",
    );
    expect(soundSubsetSource).toContain('SECURITY_SURFACE_FILES');
    expect(soundSubsetSource).toContain('must enroll the whole starter security surface');
    expect(files.get('src/endpoint-posture.test.ts')).not.toMatch(/\bas\s+(?!const\b)[A-Za-z_{]/u);
    expect(files.get('src/auth.ts')).toContain("field: 'csrf',");
    expect(files.get('src/auth.ts')).not.toContain('sessionId(');
    expect(files.get('src/kovo.ts')).toContain('appCsrf,');
    expect(files.get('src/kovo.ts')).toContain('csrf: appCsrf,');
    expect(files.get('src/auth.ts')).not.toContain('kovo-starter-anon');
  });

  it('lets the framework sound-subset classifier ignore aliases and prose while flagging casts', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-sound-subset-'));

    try {
      writeKovoProject(root, { name: 'Sound Subset Proof' });
      linkStarterBuildDependencies(root);
      writeFileSync(join(root, 'src/source.ts'), 'export const sourceValue = 1;\n', 'utf8');
      writeFileSync(
        join(root, 'src/import-alias.ts'),
        [
          'import {',
          '  sourceValue as renamedSourceValue,',
          "} from './source';",
          '',
          'export const aliasValue = renamedSourceValue;',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'src/unsafe-cast.ts'),
        'const maybeNumber = "1" as number;\nexport const castValue = maybeNumber;\n',
        'utf8',
      );
      writeFileSync(
        join(root, 'src/transaction-bridge.ts'),
        [
          'type AppDb = { write(): void };',
          'type AppRequest = { db: { transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> } };',
          '',
          'export const mutationDefinition = {',
          '  transaction(request: AppRequest, run: (request: AppRequest) => Promise<void>) {',
          '    return request.db.transaction((tx) => run({ ...request, db: tx as unknown as AppDb }));',
          '  },',
          '};',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'src/jsx-prose.tsx'),
        [
          'export function JsxProse() {',
          '  return <p>Rendered as HTML prose only.</p>;',
          '}',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'src/string-prose.ts'),
        'export const message = "Rendered as HTML prose only.";\n',
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(/unsafe-cast\.ts:1: SPEC\.md §6\.6 sound subset bans unchecked casts/);

      try {
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        });
      } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8') ?? '';
        expect(stderr).not.toContain('import-alias.ts');
        expect(stderr).not.toContain('transaction-bridge.ts');
        expect(stderr).not.toContain('jsx-prose.tsx');
        expect(stderr).not.toContain('string-prose.ts');
        expect(stderr).not.toContain('src/_kovo/app-runtime-db.ts');
      }

      rmSync(join(root, 'src/unsafe-cast.ts'), { force: true });
      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).not.toThrow();

      const generatedAuth = readFileSync(join(root, 'src/auth.ts'), 'utf8');
      writeFileSync(
        join(root, 'src/auth.ts'),
        generatedAuth.replace(
          'await appRuntimeDbReady;\nawait authBindings.seedDemoUser();',
          'export const appSeedDemoUser = authBindings.seedDemoUser;',
        ),
        'utf8',
      );
      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(/demo seeding must be one top-level awaited boot operation/);
      writeFileSync(join(root, 'src/auth.ts'), generatedAuth, 'utf8');

      writeFileSync(
        join(root, 'src/auth.ts'),
        generatedAuth.replace(
          "import { appRuntimeDbReady, createAppAuthBindings } from './_kovo/app-runtime-db.js';",
          "import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js';",
        ),
        'utf8',
      );
      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(/auth\.ts:.*bans non-type imports of src\/_kovo\/app-runtime-db/);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects app-authored value imports of the framework runtime DB module', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-runtime-db-subset-'));

    try {
      writeKovoProject(root, { name: 'Runtime Db Subset Proof' });
      linkStarterBuildDependencies(root);
      writeFileSync(
        join(root, 'src/unsafe-runtime-db.ts'),
        [
          "import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js';",
          '',
          'export const leakedRuntimeProvider = appRuntimeDbProvider;',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /unsafe-runtime-db\.ts:1: SPEC\.md §6\.6 sound subset bans non-type imports of src\/_kovo\/app-runtime-db/,
      );

      writeFileSync(
        join(root, 'src/unsafe-runtime-db.ts'),
        [
          "import { appRuntimeDbOptions } from './_kovo/app-runtime-db-options.js';",
          '',
          'export const leakedRuntimeOptions = appRuntimeDbOptions;',
          '',
        ].join('\n'),
        'utf8',
      );
      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /unsafe-runtime-db\.ts:1: SPEC\.md §6\.6 sound subset bans non-type imports of src\/_kovo\/app-runtime-db/,
      );

      writeFileSync(
        join(root, 'src/unsafe-runtime-db.ts'),
        [
          "import type { AppDb } from './db.js';",
          '',
          'export type RuntimeDbAlias = AppDb;',
          '',
        ].join('\n'),
        'utf8',
      );
      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('confines the generated Better Auth instance and adapter under KOVO_PARANOID', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-auth-capability-subset-'));

    try {
      writeKovoProject(root, { name: 'Auth Capability Subset Proof' });
      linkStarterBuildDependencies(root);
      const authPath = join(root, 'src/auth.ts');
      writeFileSync(
        authPath,
        `${readFileSync(authPath, 'utf8')}\n${[
          'export async function leakStoredAuthCredentials(): Promise<string> {',
          '  const context = await authBindings.$context;',
          "  const accounts = await context.adapter.findMany({ model: 'account' });",
          "  const sessions = await context.adapter.findMany({ model: 'session' });",
          '  return JSON.stringify({',
          '    password: accounts[0]?.password,',
          '    token: sessions[0]?.token,',
          '  });',
          '}',
          '',
          'export { createAppAuthBindings as leakedAuthBindingFactory };',
          '',
        ].join('\n')}`,
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          env: { ...process.env, KOVO_PARANOID: '1' },
          stdio: 'pipe',
        }),
      ).toThrowError(
        /confines the Better Auth instance and privileged adapter to the framework-owned runtime/,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects raw SQL in query loaders while preserving explicit trustedSql escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-raw-sql-waist-'));

    try {
      writeKovoProject(root, { name: 'Raw Sql Waist Proof' });
      linkStarterBuildDependencies(root);
      writeFileSync(
        join(root, 'src/raw-sql-query.ts'),
        [
          "import { query } from '@kovojs/server';",
          "import { sql } from '@kovojs/drizzle';",
          "import { contacts } from './schema.js';",
          '',
          'export const leakedQuery = query({',
          '  async load(_input, context) {',
          '    return context.db',
          '      .select({',
          '        id: contacts.id,',
          '        detail: sql<string>`(select token from session limit 1)`,',
          '      })',
          '      .from(contacts);',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /raw-sql-query\.ts:10: SPEC\.md §6\.6\/§10\.2 sound subset bans raw SQL in query loaders/,
      );

      writeFileSync(
        join(root, 'src/raw-sql-query.ts'),
        [
          "import { query } from '@kovojs/server';",
          "import { sql } from '@kovojs/drizzle';",
          '',
          'export const aliasedRawQuery = query({',
          '  async load(_input, context) {',
          '    const rawSql = sql.raw;',
          "    const statement = rawSql('select token from session limit 1');",
          '    return context.db.execute(statement);',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /raw-sql-query\.ts:7: SPEC\.md §6\.6\/§10\.2 sound subset bans raw SQL in query loaders/,
      );

      writeFileSync(
        join(root, 'src/raw-sql-query.ts'),
        [
          "import { query } from '@kovojs/server';",
          "import { sql } from '@kovojs/drizzle';",
          '',
          'const rawSql = sql;',
          '',
          'export const aliasedTagQuery = query({',
          '  async load(_input, context) {',
          '    return context.db.execute(rawSql`select token from session limit 1`);',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /raw-sql-query\.ts:8: SPEC\.md §6\.6\/§10\.2 sound subset bans raw SQL in query loaders/,
      );

      writeFileSync(
        join(root, 'src/raw-sql-query.ts'),
        [
          "import { query } from '@kovojs/server';",
          "import { sql, trustedSql } from '@kovojs/drizzle';",
          '',
          'export const reviewedQuery = query({',
          '  async load(_input, context) {',
          '    return context.db.execute(',
          '      trustedSql(sql.raw("select id from contacts"), { justification: "reviewed raw read path" }),',
          '    );',
          '  },',
          '});',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects dynamically computed framework trust-sink callees', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-trust-waist-'));

    try {
      writeKovoProject(root, { name: 'Trust Waist Proof' });
      linkStarterBuildDependencies(root);
      writeFileSync(
        join(root, 'src/dynamic-trust.ts'),
        [
          "import * as browser from '@kovojs/browser';",
          "import * as server from '@kovojs/server';",
          '',
          'export function renderTrusted(helper: string) {',
          "  return server[helper]('<strong>reviewed</strong>');",
          '}',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /dynamic-trust\.ts:5: SPEC\.md §6\.6 sound subset requires trustedHtml\/trustedUrl\/trustedSql callees/,
      );

      writeFileSync(
        join(root, 'src/dynamic-trust.ts'),
        [
          "import * as browser from '@kovojs/browser';",
          "import * as drizzle from '@kovojs/drizzle';",
          '',
          'export function renderTrusted(helper: string, sqlHelper: string) {',
          '  const trustedMarkup = browser[helper];',
          '  const reviewedSql = drizzle[sqlHelper];',
          "  const trusted = trustedMarkup('<strong>reviewed</strong>');",
          "  const statement = reviewedSql(drizzle.sql.raw('select 1'), { justification: 'reviewed' });",
          '  return { statement, trusted };',
          '}',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /dynamic-trust\.ts:7: SPEC\.md §6\.6 sound subset requires trustedHtml\/trustedUrl\/trustedSql callees/,
      );

      try {
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        });
      } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8') ?? '';
        expect(stderr).toContain(
          'dynamic-trust.ts:8: SPEC.md §6.6 sound subset requires trustedHtml/trustedUrl/trustedSql callees',
        );
      }

      writeFileSync(
        join(root, 'src/dynamic-trust.ts'),
        [
          "import * as browser from '@kovojs/browser';",
          "import * as drizzle from '@kovojs/drizzle';",
          '',
          "export const trusted = browser['trustedHtml']('<strong>reviewed</strong>');",
          "export const statement = drizzle['trustedSql'](drizzle.sql.raw('select 1'), { justification: 'reviewed' });",
          '',
        ].join('\n'),
        'utf8',
      );

      expect(() =>
        execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each(['src/app.test.ts', 'src/endpoint-posture.test.ts'])(
    'fails the framework sound-subset classifier when security surface %s is not fully enrolled',
    (removedFile) => {
      const root = mkdtempSync(join(tmpdir(), 'create-kovo-security-surface-enrollment-'));

      try {
        writeKovoProject(root, { name: 'Security Surface Enrollment Proof' });
        linkStarterBuildDependencies(root);
        rmSync(join(root, removedFile), { force: true });

        expect(() =>
          execFileSync(process.execPath, [SOUND_SUBSET_SCRIPT], {
            cwd: root,
            stdio: 'pipe',
          }),
        ).toThrowError(
          new RegExp(
            `${removedFile.replaceAll('.', '\\.').replaceAll('/', '\\/')}:1: SPEC\\.md §6\\.6\\/§10\\.2\\/§10\\.3 sound subset must enroll the whole starter security surface`,
          ),
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
  );

  it('emits the SQLite scaffold variant when requested', () => {
    const project = createKovoProject({ dialect: 'sqlite', name: 'Sqlite App' });
    const files = new Map(project.files.map((file) => [file.path, file.source]));
    const packageJson = JSON.parse(files.get('package.json') ?? '{}') as {
      dependencies?: Record<string, string>;
      pnpm?: {
        ignoredBuiltDependencies?: string[];
        onlyBuiltDependencies?: string[];
        overrides?: Record<string, string>;
      };
    };

    expect(files.get('package.json')).toContain('"better-sqlite3"');
    expect(files.has('src/_kovo/app-runtime-db-options.ts')).toBe(false);
    // rules/dependency-policy.md: the experimental native SQLite runtime is still an
    // exact-pinned dependency so a fresh scaffold cannot silently install a new binary.
    expect(packageJson.dependencies?.['@node-rs/argon2']).toBe('2.0.2');
    expect(packageJson.dependencies?.['better-sqlite3']).toBe('12.11.1');
    expect(packageJson.dependencies?.['pgsql-ast-parser']).toBe('12.0.2');
    expect(files.get('package.json')).toContain(
      '"start": "NODE_ENV=production node dist/server/server.mjs"',
    );
    expect(files.get('package.json')).toContain(
      '"serve": "pnpm run build:prod && NODE_ENV=production node dist/server/server.mjs"',
    );
    expect(files.get('package.json')).not.toContain('"@electric-sql/pglite"');
    expect(packageJson.pnpm?.onlyBuiltDependencies).toEqual(['@node-rs/argon2', 'better-sqlite3']);
    expect(packageJson.pnpm?.ignoredBuiltDependencies).toEqual(['esbuild']);
    expect(packageJson.pnpm?.overrides).toEqual({
      '@node-rs/argon2': '2.0.2',
      'better-sqlite3': '12.11.1',
    });
    expect(files.get('src/db.ts')).toContain(
      "import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'",
    );
    expect(files.get('src/db.ts')).toContain(
      "import { appRuntimeReadonlyDb } from './_kovo/app-runtime-db.js'",
    );
    expect(files.get('src/db.ts')).toContain('export type AppDb = BetterSQLite3Database;');
    expect(files.get('src/db.ts')).toContain('export type AppReadonlyDb = Reader<AppDb>');
    expect(files.get('src/db.ts')).toContain(
      'export const readonlyAppDb: AppReadonlyDb = appRuntimeReadonlyDb',
    );
    expect(files.get('src/db.ts')).not.toContain('createAppDb');
    expect(files.get('src/db.ts')).not.toContain('CreatedAppDb');
    expect(files.get('src/db.ts')).not.toContain('appRuntimeDbProvider');
    expect(files.get('src/db.ts')).not.toContain('export function appDbProvider');
    expect(files.get('src/db.ts')).not.toContain('export const appDb = appDatabase.db');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      "import { createSqliteAppRuntime, type KovoSqliteSeed } from '@kovojs/server/sqlite'",
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'createBetterAuthSqliteBindingsFromEnvironment',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('const APP_TABLES = [');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'verification, rateLimit] as const;',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      '] as const satisfies readonly KovoSqliteSeed[];',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const appDatabase = createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const authSystemDb = sqliteSystemDbForGeneratedIntegration(appDatabase, {',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('better-sqlite3');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('drizzleAdapter');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('createAuthAdapter');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('process.env');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('SCHEMA_DDL');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('SEED_CONTACTS');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('sqliteFile');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('openDatabase');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('RUNTIME_DB_METADATA');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export const appRuntimeDbProvider = appDatabase.db;',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('__kovoStarterAppDatabase');
    expect(files.get('src/schema.ts')).toContain('import { integer, sqliteTable, text }');
    expect(files.get('src/schema.ts')).toContain("integer('emailVerified', { mode: 'boolean' })");
    expect(files.get('src/schema.ts')).toContain("integer('createdAt', { mode: 'timestamp_ms' })");
    expect(files.get('src/schema.ts')).toContain("integer('expiresAt', { mode: 'timestamp_ms' })");
    expect(files.get('src/schema.ts')).toContain(
      "integer('accessTokenExpiresAt', { mode: 'timestamp_ms' })",
    );
    expect(files.get('src/schema.ts')).not.toContain("text('createdAt')");
    expect(files.get('src/schema.ts')).not.toContain("text('expiresAt')");
    expect(files.get('src/schema.ts')).not.toContain('timestamp(');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain("provider: 'sqlite'");
    expect(files.get('src/auth.ts')).toContain(
      "import { appRuntimeDbReady, createAppAuthBindings } from './_kovo/app-runtime-db.js'",
    );
    expect(files.get('src/auth.ts')).toContain('const authBindings = createAppAuthBindings({');
    expect(files.get('src/auth.ts')).toContain('betterAuthCsrfFromEnvironment({');
    expect(files.get('src/auth.ts')).toContain(
      'await appRuntimeDbReady;\nawait authBindings.seedDemoUser();',
    );
    expect(files.get('src/auth.ts')).not.toContain('process.env');
    expect(files.get('src/auth.ts')).not.toContain('loadEnvFile');
    expect(files.get('src/auth.ts')).not.toContain('requireAuthSecret');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain(
      'export function createAuthAdapter',
    );
    expect(files.get('src/auth.ts')).not.toContain('appRuntimeDbProvider()');
    expect(files.get('src/auth.ts')).not.toContain('drizzleAdapter(');
    expect(files.get('src/auth.ts')).not.toContain('database: drizzleAdapter(appDb,');
    expect(files.get('README.md')).toContain('opt-in SQLite dialect');
    expect(files.get('README.md')).toContain('single-principal local-development');
    expect(files.get('README.md')).toContain('Kovo authorization/confidentiality guarantees');
    expect(files.get('README.md')).not.toContain('peer warning');
    expect(files.get('README.md')).toContain('BETTER_AUTH_URL');
  });

  it('rejects scaffolding through a symlinked app-root parent', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-link-local-'));
    const realAppsRoot = join(root, 'real-apps');
    const aliasAppsRoot = join(root, 'alias-apps');
    mkdirSync(realAppsRoot, { recursive: true });
    symlinkSync(realAppsRoot, aliasAppsRoot);
    const appRoot = join(aliasAppsRoot, 'linked-app');

    try {
      expect(() =>
        writeKovoProject(appRoot, { dialect: 'sqlite', name: 'Linked App', disableGit: true }),
      ).toThrow(`Target ancestor must be a non-symbolic-link directory: ${aliasAppsRoot}`);
      expect(readdirSync(realAppsRoot)).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('uses the public Kovo Vite plugin instead of a hand-rolled dev loader', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-vite-'));

    try {
      writeKovoProject(root, { name: 'My App' });
      const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
      expect(viteConfig).toContain("import { kovo } from '@kovojs/server/vite'");
      expect(viteConfig).toContain("kovo({ app: '/src/app.tsx' })");
      expect(viteConfig).toContain("external: ['undici']");
      expect(viteConfig).not.toContain('ssrLoadModule');
      expect(viteConfig).not.toContain('starterSharedAppShellDevPlugin');

      const appSource = readFileSync(join(root, 'src/app.tsx'), 'utf8');
      // Idiomatic TSX, not hand-authored lowered IR (SPEC.md §5.2 / KV235).
      expect(appSource).toContain('@jsxImportSource @kovojs/server');
      expect(appSource).toContain('app.assemble({');
      expect(appSource).not.toContain('/c/__v/');
      expect(appSource).not.toContain('Starter$announce');

      // No fake graph apparatus or static-export wrappers remain.
      expect(existsSync(join(root, 'scripts/check-sound-subset.mjs'))).toBe(false);
      expect(existsSync(join(root, 'docs'))).toBe(false);
      expect(existsSync(join(root, '.kovo/docs/llms.txt'))).toBe(true);
      expect(existsSync(join(root, 'src/app-shell.ts'))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes deterministic files plus a fresh per-project secret', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-det-'));

    try {
      const result = writeKovoProject(root, { name: 'Example App' });
      const project = createKovoProject({ name: 'Example App' });

      expect(result).toEqual({
        files: project.files.map((file) => file.path),
        name: 'example-app',
        root,
      });

      for (const file of project.files) {
        // Both contain fresh per-project security material for each independent scaffold call.
        if (file.path === '.env' || file.path === 'src/kovo.ts') continue;
        if (file.symlinkTarget) {
          expect(readlinkSync(join(root, file.path))).toBe(file.symlinkTarget);
          continue;
        }
        expect(readFileSync(join(root, file.path), 'utf8')).toBe(file.source);
      }

      const envSource = readFileSync(join(root, '.env'), 'utf8');
      const secret = /^KOVO_CSRF_SECRET=(.+)$/m.exec(envSource)?.[1] ?? '';
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(secret).not.toBe('replace-with-a-deployed-secret');
      const contractSource = readFileSync(join(root, 'src/kovo.ts'), 'utf8');
      expect(contractSource).toMatch(
        /appId: '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'/u,
      );
      const demoPassword =
        new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(envSource)?.[1] ?? '';
      expect(demoPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(demoPassword).not.toBe('password123');
      expect(envSource).not.toContain('BETTER_AUTH_URL');

      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_CSRF_SECRET=replace-with-a-deployed-secret',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'BETTER_AUTH_URL=https://app.example.com',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_NODE_ORIGIN=https://app.example.com',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        '# KOVO_NODE_TRUSTED_PROXY=1',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_DATABASE_URL=postgres://app_runtime@db.example.com:5432/your_app?sslmode=verify-full',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_RUNTIME_DATABASE_URL=postgres://app_runtime@db.example.com:5432/your_app?sslmode=verify-full',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_ADMIN_DATABASE_URL=postgres://app_admin@db.example.com:5432/your_app?sslmode=verify-full',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_DB_SYSTEM_URL=postgres://kovo_system@db.example.com:5432/your_app?sslmode=verify-full',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        '# KOVO_DB_DRIVER=node-postgres',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_DATA_DIR=.kovo/pglite',
      );
      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_DEMO_PASSWORD=replace-with-a-local-demo-password',
      );
      const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.env');
      expect(gitignore).toContain('.kovo/');
      expect(gitignore).not.toContain('.kovo/endpoint-posture.json');
      expect(gitignore).not.toContain('graph.json');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes the generated secret environment file with owner-only permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-secret-mode-'));
    const previousUmask = process.umask(0);

    try {
      writeKovoProject(root, { disableGit: true, name: 'Secret Mode' });

      expect(statSync(join(root, '.env')).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(previousUmask);
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('create-kovo starter (CLI)', () => {
  it('prints polished help with defaults and examples', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['--help'])).toBe(0);
      expect(stderr).not.toHaveBeenCalled();
      expect(stdout).toHaveBeenCalledWith(CREATE_KOVO_HELP);
      expect(CREATE_KOVO_HELP).toBe(renderCreateKovoHelp(CREATE_KOVO_REFERENCE));
      expect(CREATE_KOVO_HELP).toContain('Create a new Kovo application.');
      expect(CREATE_KOVO_HELP).toContain('Default: normalized target directory name.');
      expect(CREATE_KOVO_HELP).toContain('Default: postgres.');
      expect(CREATE_KOVO_HELP).toContain('package manager             pnpm@10.12.1.');
      expect(CREATE_KOVO_HELP).toContain('--experimental-sqlite');
      expect(CREATE_KOVO_HELP).toContain(
        'Allow SQLite scaffold generation for single-principal local development.',
      );
      expect(CREATE_KOVO_HELP).toContain(
        'create-kovo my-app --dialect sqlite --experimental-sqlite',
      );
      expect(CREATE_KOVO_HELP).toContain('--disable-git');
      expect(CREATE_KOVO_HELP).toContain('--install[=auto|never]');
      expect(CREATE_KOVO_HELP).toContain('--deployment <node|vercel|cloudflare>');
      expect(CREATE_KOVO_HELP).toContain('--retention <unconfigured|retained-24h>');
      expect(CREATE_KOVO_REFERENCE.sections).toContainEqual(
        expect.objectContaining({ anchor: 'development-host-support' }),
      );
      expect(CREATE_KOVO_HOST_POSTURE).toEqual({
        supported: ['Linux', 'macOS'],
        unsupported:
          'Native Windows and WSL are not policy-tested development hosts in the technical preview.',
      });
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('prints usage guidance when the target directory is missing', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main([])).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Missing target directory.'));
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Usage: create-kovo'));
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('create-kovo --help'));
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('creates a new target directory and derives the package name', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-'));
    const root = join(parent, 'Hello CLI');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Kovo app created'));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining(`Directory   ${root}`));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Name        hello-cli'));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Dialect     postgres'));
      expect(stdout).toHaveBeenCalledWith(
        expect.stringContaining(`Files       ${ALL_FILES.length}`),
      );
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Next steps'));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining(`cd '${root}'`));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('pnpm install --ignore-scripts'));
      expect(stdout).toHaveBeenCalledWith(
        expect.stringContaining('pnpm exec kovo check lifecycle'),
      );
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('pnpm rebuild'));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('pnpm run dev'));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('pnpm run check'));
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Install     skipped'));
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        name: 'hello-cli',
      });
      expect(existsSync(join(root, '.git'))).toBe(true);
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('refuses a SQLite dialect flag without an explicit experimental opt-in', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-sqlite-'));
    const root = join(parent, 'Hello SQLite');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main([root, '--dialect', 'sqlite'])).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('single-principal/local-dev'));
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('KOVO_EXPERIMENTAL_SQLITE=1'));
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('--experimental-sqlite'));
      expect(existsSync(root)).toBe(false);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('accepts SQLite when the experimental flag is present', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-sqlite-flag-'));
    const root = join(parent, 'Hello SQLite');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root, '--sqlite', '--experimental-sqlite'])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Dialect     sqlite'));
      expect(stdout).toHaveBeenCalledWith(
        expect.stringContaining(
          'WARNING SQLite is experimental and single-principal/local-dev only.',
        ),
      );
      expect(readFileSync(join(root, 'src/auth.ts'), 'utf8')).toContain(
        'const authBindings = createAppAuthBindings({',
      );
      expect(readFileSync(join(root, 'src/_kovo/app-runtime-db.ts'), 'utf8')).toContain(
        'createBetterAuthSqliteBindingsFromEnvironment<',
      );
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('accepts SQLite when KOVO_EXPERIMENTAL_SQLITE=1 is set', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-sqlite-env-'));
    const root = join(parent, 'Hello SQLite');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const previousOptIn = process.env.KOVO_EXPERIMENTAL_SQLITE;

    try {
      process.env.KOVO_EXPERIMENTAL_SQLITE = '1';
      expect(main([root, '--dialect=sqlite'])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Dialect     sqlite'));
      expect(readFileSync(join(root, 'src/auth.ts'), 'utf8')).toContain(
        'const authBindings = createAppAuthBindings({',
      );
      expect(readFileSync(join(root, 'src/_kovo/app-runtime-db.ts'), 'utf8')).toContain(
        'createBetterAuthSqliteBindingsFromEnvironment<',
      );
    } finally {
      if (previousOptIn === undefined) {
        delete process.env.KOVO_EXPERIMENTAL_SQLITE;
      } else {
        process.env.KOVO_EXPERIMENTAL_SQLITE = previousOptIn;
      }
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('skips Git initialization when requested', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-disable-git-'));
    const root = join(parent, 'No Git');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root, '--disable-git'])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Kovo app created'));
      expect(existsSync(join(root, '.git'))).toBe(false);
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('installs only when selected and omits install from completed next steps', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-install-'));
    const root = join(parent, 'Installed App');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const install = vi
      .spyOn(createKovoCommandShell, 'execFileSync')
      .mockImplementation(() => Buffer.alloc(0));

    try {
      expect(main([root, '--install', '--disable-git'])).toBe(0);
      expect(install).toHaveBeenNthCalledWith(1, 'pnpm', ['install', '--ignore-scripts'], {
        cwd: root,
        stdio: 'inherit',
      });
      expect(install).toHaveBeenNthCalledWith(2, 'pnpm', ['exec', 'kovo', 'check', 'lifecycle'], {
        cwd: root,
        stdio: 'inherit',
      });
      expect(install).toHaveBeenNthCalledWith(3, 'pnpm', ['rebuild'], {
        cwd: root,
        stdio: 'inherit',
      });
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('Install     complete');
      expect(output).toContain('pnpm run dev');
      expect(output).toContain('pnpm run check');
      expect(output).not.toContain('  pnpm install --ignore-scripts\n');
    } finally {
      install.mockRestore();
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('reports a partial install precisely without claiming creator success', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-install-failure-'));
    const root = join(parent, 'Install Failure');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const install = vi.spyOn(createKovoCommandShell, 'execFileSync').mockImplementation(() => {
      throw new Error('network unavailable');
    });

    try {
      expect(main([root, '--install', '--disable-git'])).toBe(1);
      expect(existsSync(join(root, 'package.json'))).toBe(true);
      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('project files were created');
      expect(output).toContain('pnpm install --ignore-scripts');
      expect(output).toContain('pnpm exec kovo check lifecycle');
      expect(output).toContain('pnpm rebuild');
      expect(output).toContain('pnpm run dev');
      expect(output).toContain('pnpm run check');
      expect(output).not.toContain('Kovo app created');
    } finally {
      install.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('projects interactive answers through the same semantic option shape', async () => {
    const answers = ['interactive-app', 'Interactive App', '2', '2', '2', '2', '1'];
    const questions: string[] = [];
    const options = await readInteractiveCreateKovoOptions(async (question) => {
      questions.push(question);
      return answers.shift() ?? '';
    });

    expect(options).toEqual({
      deploymentTarget: 'vercel',
      dialect: 'sqlite',
      disableGit: true,
      experimentalSqlite: true,
      install: 'never',
      name: 'Interactive App',
      retention: 'unconfigured',
      targetDirectory: 'interactive-app',
    });
    expect(questions).toHaveLength(7);
    expect(questions.join('\n')).toContain('SQLite (experimental)');
    expect(questions.join('\n')).toContain('Not configured yet');
  });

  it('runs an injected interactive scaffold with no hidden environment edit', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-interactive-'));
    const root = join(parent, 'Prompt App');
    const answers = [root, 'Prompt App', '1', '2', '2', '3', '1'];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      await expect(
        mainAsync([], {
          ask: async () => answers.shift() ?? '',
        }),
      ).resolves.toBe(0);
      expect(existsSync(join(root, 'package.json'))).toBe(true);
      expect(readFileSync(join(root, 'kovo.config.ts'), 'utf8')).toContain(
        "import { defineConfig, cloudflare } from '@kovojs/server/build';",
      );
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Deploy      cloudflare'));
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('skips nested Git initialization inside an existing Git repository', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-parent-git-'));
    const root = join(parent, 'Nested App');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      execFileSync('git', ['init'], { cwd: parent, stdio: 'ignore' });
      expect(main([root])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Kovo app created'));
      expect(existsSync(join(parent, '.git'))).toBe(true);
      expect(existsSync(join(root, '.git'))).toBe(false);
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('skips nested Git initialization inside an existing Mercurial repository', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-parent-hg-'));
    const root = join(parent, 'Nested App');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(parent, '.hg'));
      expect(main([root])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Kovo app created'));
      expect(existsSync(join(root, '.git'))).toBe(false);
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('writes CLI failure output to stderr while returning a non-zero exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-cli-error-'));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(join(root, 'README.md'), 'existing', 'utf8');
      expect(main([root])).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Target directory is not empty'));
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('already contains files'));
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Choose an empty directory'));
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('ships templates in the packed CLI tarball', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-packed-'));
    const extractRoot = join(parent, 'extract');
    const target = join(parent, 'Packed App');

    try {
      execFileSync('pnpm', ['pack', '--pack-destination', parent], {
        cwd: createKovoPackageRoot,
        stdio: 'pipe',
      });
      const tarball = readdirSync(parent).find((entry) => entry.endsWith('.tgz'));
      expect(tarball).toBeTruthy();

      mkdirSync(extractRoot, { recursive: true });
      execFileSync('tar', ['-xzf', join(parent, tarball ?? ''), '-C', extractRoot], {
        stdio: 'pipe',
      });

      const packedPackageRoot = join(extractRoot, 'package');
      mkdirSync(join(packedPackageRoot, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(
        resolveDependencyRoot('@kovojs/core'),
        join(packedPackageRoot, 'node_modules/@kovojs/core'),
      );

      const stdout = execFileSync(process.execPath, [
        join(packedPackageRoot, 'dist/index.mjs'),
        target,
        '--name',
        'Packed App',
      ]).toString('utf8');

      expect(stdout).toContain('Kovo app created');
      expect(stdout).toContain(`Files       ${ALL_FILES.length}`);
      expect(readFileSync(join(target, 'package.json'), 'utf8')).toContain('"name": "packed-app"');
      expect(readFileSync(join(target, 'src/app.tsx'), 'utf8')).toContain('app.assemble({');
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  }, 30_000);

  it('rejects unknown options and unsupported dialects with help guidance', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['app', '--template', 'demo'])).toBe(1);
      expect(main(['app', '--dialect', 'mysql'])).toBe(1);
      expect(main(['app', '--local-kovo', '../kovo'])).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Unknown option: --template'));
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported value for --dialect: mysql.'),
      );
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Unknown option: --local-kovo'));
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining('supported options and defaults'),
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('refuses to write into a non-empty target directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-collision-'));
    writeFileSync(join(root, 'README.md'), 'existing', 'utf8');

    try {
      expect(() => writeKovoProject(root, { name: 'Collision' })).toThrow(
        `Target directory is not empty: ${root}`,
      );
      expect(existsSync(join(root, 'package.json'))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('refuses a symlinked scaffold target without writing outside', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-target-alias-'));
    const outside = mkdtempSync(join(tmpdir(), 'create-kovo-target-outside-'));
    const root = join(parent, 'app');
    symlinkSync(outside, root, 'dir');

    try {
      expect(() => writeKovoProject(root, { disableGit: true, name: 'Alias' })).toThrow(
        `Target exists and is not a directory: ${root}`,
      );
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(parent, { force: true, recursive: true });
      rmSync(outside, { force: true, recursive: true });
    }
  });

  it('rejects live scaffold option accessors before writing or invoking git', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'create-kovo-options-')), 'app');
    const options = Object.create(null) as WriteKovoProjectOptions;
    Object.defineProperty(options, 'disableGit', {
      enumerable: true,
      get: () => false,
    });

    try {
      expect(() => writeKovoProject(root, options)).toThrow(
        "create-kovo option 'disableGit' must be a stable own data property.",
      );
      expect(existsSync(root)).toBe(false);
    } finally {
      rmSync(dirname(root), { force: true, recursive: true });
    }
  });

  it('rejects invalid scaffold option values before writing', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'create-kovo-invalid-options-')), 'app');
    try {
      expect(() => writeKovoProject(root, { disableGit: 'no' as unknown as boolean })).toThrow(
        "create-kovo option 'disableGit' must be a boolean.",
      );
      expect(() => writeKovoProject(root, { name: 42 as unknown as string })).toThrow(
        "create-kovo option 'name' must be a string.",
      );
      expect(existsSync(root)).toBe(false);
    } finally {
      rmSync(dirname(root), { force: true, recursive: true });
    }
  });

  it('does not dispatch staging commits through a replaced Array iterator', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-iterator-'));
    const root = join(parent, 'app');
    const nativeIterator = Array.prototype[Symbol.iterator];
    Array.prototype[Symbol.iterator] = function poisonedStagingIterator() {
      if (typeof this[0] === 'string' && this.some((value) => value === '.env')) {
        return Reflect.apply(nativeIterator, ['../outside'], []);
      }
      return Reflect.apply(nativeIterator, this, []);
    };

    try {
      writeKovoProject(root, { disableGit: true, name: 'Iterator Safe' });
      expect(existsSync(join(root, 'package.json'))).toBe(true);
      expect(existsSync(join(parent, 'outside'))).toBe(false);
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
      rmSync(parent, { force: true, recursive: true });
    }
  });
});
