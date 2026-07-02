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
  CREATE_KOVO_REFERENCE,
  createKovoProject,
  demoPasswordEnvVar,
  main,
  renderCreateKovoHelp,
  writeKovoProject,
} from './index.js';
import { linkStarterBuildDependencies, resolveDependencyRoot } from './index.test-support.js';

const TEMPLATE_FILES = [
  'package.json',
  'tsconfig.json',
  'kovo.config.ts',
  'vite.config.ts',
  '.github/workflows/ci.yml',
  'README.md',
  'scripts/check-sound-subset.mjs',
  'scripts/check-parallel.mjs',
  'src/schema.ts',
  'src/db.ts',
  'src/_kovo/app-runtime-db.ts',
  'src/auth.ts',
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
const repoRoot = dirname(dirname(createKovoPackageRoot));
const linkLocalKovoScriptPath = join(repoRoot, 'scripts/link-local-kovo.mjs');
const createKovoPackage = JSON.parse(
  readFileSync(join(createKovoPackageRoot, 'package.json'), 'utf8'),
) as { version: string };

describe('create-kovo starter (metadata)', () => {
  it('scaffolds the real template file set with no unrendered placeholders', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-scaffold-'));

    try {
      const templateUrl = new URL('../templates/', import.meta.url);
      for (const file of TEMPLATE_FILES) {
        expect(existsSync(new URL(file, templateUrl))).toBe(true);
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
      expect(metadata).toMatchObject({ source: 'bundled', version: createKovoPackage.version });
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
        pnpm?: unknown;
        scripts?: Record<string, string>;
      };

      expect(packageJson.name).toBe('my-app');
      expect(packageJson.dependencies).toMatchObject({
        '@electric-sql/pglite': expect.any(String),
        '@kovojs/better-auth': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/core': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/drizzle': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/server': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/style': expect.stringMatching(/^\d+\.\d+\.\d+/),
        '@kovojs/ui': expect.stringMatching(/^\d+\.\d+\.\d+/),
        'better-auth': expect.any(String),
        'drizzle-orm': expect.any(String),
      });
      expect(Object.values(packageJson.dependencies ?? {})).not.toContain('workspace:*');
      expect(Object.values(packageJson.devDependencies ?? {})).not.toContain('workspace:*');
      expect(packageJson.packageManager).toBe('pnpm@10.12.1');
      expect(packageJson.pnpm).toBeUndefined();
      expect(packageJson.dependencies).not.toHaveProperty('better-sqlite3');
      expect(packageJson.devDependencies).toMatchObject({
        '@kovojs/cli': expect.stringMatching(/^\d+\.\d+\.\d+/),
      });
      expect(packageJson.devDependencies).not.toHaveProperty('@kovojs/compiler');
      expect(packageJson.scripts).toMatchObject({
        'build:prod': 'kovo build ./src/app.tsx',
        check: 'node scripts/check-parallel.mjs',
        'check:endpoint-posture':
          'vitest run src/endpoint-posture.test.ts && kovo check endpoint-posture .kovo/endpoint-posture.json',
        'check:sound-subset': 'node scripts/check-sound-subset.mjs',
        dev: 'vp dev',
        serve: 'pnpm run build:prod && NODE_ENV=production node dist/server/server.mjs',
        start: 'NODE_ENV=production node dist/server/server.mjs',
        test: 'vp test',
      });
      // Removed fiction/wrapper scripts are gone.
      expect(packageJson.scripts).not.toHaveProperty('emit-graph');
      expect(packageJson.scripts).not.toHaveProperty('static');
      expect(packageJson.scripts).not.toHaveProperty('serve:dev');

      const ciWorkflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
      expect(ciWorkflow).toContain('vp exec pnpm run build:prod');
      expect(ciWorkflow).not.toContain('run: kovo build');

      const readme = readFileSync(join(root, 'README.md'), 'utf8');
      expect(readme).toContain('Better Auth currently marks `drizzle-orm@^0.45.2`');
      expect(readme).toContain('peer warning');
      expect(readme).toContain('is expected');
      expect(readme).toContain('keep that posture in your process');
      expect(readme).toContain('blocks private-network egress by default');
      expect(readme).toContain('KOVO_DATA_DIR');

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
    const packageJson = JSON.parse(files.get('package.json') ?? '{}') as { pnpm?: unknown };

    expect(files.get('package.json')).toContain('"@electric-sql/pglite"');
    expect(files.get('package.json')).not.toContain('"better-sqlite3"');
    expect(packageJson.pnpm).toBeUndefined();
    expect(files.get('src/db.ts')).toContain("import type { Reader } from '@kovojs/server'");
    expect(files.get('src/db.ts')).toContain(
      "import type { PgliteDatabase } from 'drizzle-orm/pglite'",
    );
    expect(files.get('src/db.ts')).toContain(
      "import { appRuntimeReadonlyDb } from './_kovo/app-runtime-db.js'",
    );
    expect(files.get('src/db.ts')).toContain('export type AppDb = PgliteDatabase');
    expect(files.get('src/db.ts')).toContain('export type AppReadonlyDb = Reader<AppDb>');
    expect(files.get('src/db.ts')).toContain(
      'export const readonlyAppDb: AppReadonlyDb = appRuntimeReadonlyDb',
    );
    expect(files.get('src/db.ts')).not.toContain('createAppDb');
    expect(files.get('src/db.ts')).not.toContain('CreatedAppDb');
    expect(files.get('src/db.ts')).not.toContain('appDbReady');
    expect(files.get('src/db.ts')).not.toContain('appRuntimeDbProvider');
    expect(files.get('src/db.ts')).not.toContain('export function appDbProvider');
    expect(files.get('src/db.ts')).not.toContain('export const appDb = appDatabase.db');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      "import { PGlite } from '@electric-sql/pglite'",
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      "import { getTableConfig } from 'drizzle-orm/pg-core'",
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'process.env.KOVO_DATA_DIR ?? DEFAULT_DATA_DIR',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'sortTablesByForeignKeyDependencies([',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'CREATE TABLE IF NOT EXISTS ${quoteIdent(config.name)}',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('ADD COLUMN IF NOT EXISTS');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      "if (column.columnType === 'PgSerial') return ''",
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('readonlyDb: AppReadonlyDb');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const readDb = drizzle({ client: readonlyPgliteClient(client, { readerRole: true }) });',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('readonlyDb(privilegedReadDb)');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain("const READER_ROLE = 'kovo_reader'");
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'applyPgliteReaderColumnPrivileges(client, SCHEMA_TABLES, SECRET_READ_METADATA)',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'Object.defineProperty(db, kovoReadonlyDbHandle',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'return { db, readonlyDb: secretReadDb, ready }',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      '(tx: unknown) => callback(declaredWriteDrizzleDb(tx as object, policy))',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      "Reflect.apply(tx.exec, tx, ['SET TRANSACTION READ ONLY'])",
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('SET LOCAL ROLE');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const SECRET_READ_METADATA = secretReadMetadata(SCHEMA_TABLES)',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'function secretBoxingReadDb<Db extends object>',
    );
    expect(files.get('src/db.ts')).not.toContain('PgliteDatabase<typeof schema>');
    expect(files.get('src/db.ts')).not.toContain('drizzle({ client, schema })');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('await client.exec(SCHEMA_DDL)');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('void client.exec');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const ready = initializeAppDb(client);\n  const db = drizzle({ client });',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain(
      'readonlyDb(db).exec(SCHEMA_DDL)',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export const appRuntimeDbReady: Promise<void> = appDatabase.ready',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export function appRuntimeDbProvider(): AppDb',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('__kovoStarterAppDatabase');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('ON CONFLICT (id) DO NOTHING');
    expect(files.get('src/app.tsx')).toContain('createMemoryMutationReplayStore');
    expect(files.get('src/app.tsx')).toContain(
      'const mutationReplayStore = createMemoryMutationReplayStore();',
    );
    expect(files.get('src/app.tsx')).toContain('mutationReplayStore,');
    expect(files.get('src/app.tsx')).toContain(
      "import { appRuntimeDbProvider, appRuntimeDbReady } from './_kovo/app-runtime-db.js'",
    );
    expect(files.get('src/app.tsx')).not.toContain("import { appDbReady } from './db.js'");
    expect(files.get('src/app.tsx')).toContain('await appRuntimeDbReady');
    expect(files.get('src/app.tsx')).toContain('db: appRuntimeDbProvider,');
    expect(files.get('src/app.tsx')).not.toContain('db: () => appDb');
    expect(files.get('src/app.test.ts')).toContain("import { readonlyAppDb } from './db.js'");
    expect(files.get('src/app.test.ts')).not.toContain('createAppDb');
    expect(files.get('src/app.test.ts')).toContain('{ db: readonlyAppDb, request: {} }');
    expect(files.get('src/schema.ts')).toContain('import { boolean, pgTable, text, timestamp }');
    expect(files.get('src/auth.ts')).toContain("provider: 'pg'");
    expect(files.get('src/auth.ts')).toContain(
      "import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js'",
    );
    expect(files.get('src/auth.ts')).toContain('database: drizzleAdapter(appRuntimeDbProvider(),');
    expect(files.get('src/auth.ts')).not.toContain('database: drizzleAdapter(appDb,');
  });

  it('classifies Better Auth credential columns as secret in scaffolded schema', () => {
    const defaultProject = createKovoProject({ name: 'Auth Secret Proof' });
    const defaultFiles = new Map(defaultProject.files.map((file) => [file.path, file.source]));
    const sqliteProject = createKovoProject({
      dialect: 'sqlite',
      name: 'Sqlite Auth Secret Proof',
    });
    const sqliteFiles = new Map(sqliteProject.files.map((file) => [file.path, file.source]));

    for (const schemaSource of [
      defaultFiles.get('src/schema.ts'),
      sqliteFiles.get('src/schema.ts'),
    ]) {
      // SPEC.md §6.6 / §10.1: classification is carried by the schema annotation the
      // compiler reads, not by TypeScript-only branding. KV435 rejects projections from
      // these columns once the build graph ingests this starter schema.
      expect(schemaSource).toContain("kovo({ domain: 'auth', key: 'userId', secret: ['token'] })");
      expect(schemaSource).toContain("domain: 'auth'");
      expect(schemaSource).toContain("key: 'userId'");
      expect(schemaSource).toContain(
        "secret: ['password', 'accessToken', 'refreshToken', 'idToken']",
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

    expect(files.get('tsconfig.json')).toContain('"strict": true');
    expect(files.get('tsconfig.json')).toContain('"noUncheckedIndexedAccess": true');
    expect(files.get('scripts/check-sound-subset.mjs')).toContain(
      'SPEC.md §6.6 sound subset bans any',
    );
    expect(files.get('scripts/check-sound-subset.mjs')).toContain(
      '.sort((left, right) => left.localeCompare(right));',
    );
    expect(files.get('scripts/check-sound-subset.mjs')).toContain(
      'bans non-type imports of src/_kovo/app-runtime-db',
    );
    expect(files.get('scripts/check-sound-subset.mjs')).toContain(
      'FRAMEWORK_GENERATED_SOUND_SUBSET_EXEMPT_FILES',
    );
    expect(files.get('scripts/check-sound-subset.mjs')).toContain('SECURITY_SURFACE_FILES');
    expect(files.get('scripts/check-sound-subset.mjs')).toContain(
      'must enroll the whole starter security surface',
    );
    expect(files.get('src/endpoint-posture.test.ts')).not.toMatch(/\bas\s+(?!const\b)[A-Za-z_{]/u);
    expect(files.get('src/auth.ts')).toContain(
      'return request.session?.id ?? request.authCsrfId ?? undefined;',
    );
    expect(files.get('src/app.tsx')).toContain('appCsrf,');
    expect(files.get('src/app.tsx')).toContain('csrf: appCsrf,');
    expect(files.get('src/auth.ts')).not.toContain('kovo-starter-anon');
  });

  it('lets check:sound-subset ignore import aliases and JSX prose while still flagging casts', () => {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(/unsafe-cast\.ts:1: SPEC\.md §6\.6 sound subset bans unchecked casts/);

      try {
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).not.toThrow();
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).not.toThrow();
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /dynamic-trust\.ts:7: SPEC\.md §6\.6 sound subset requires trustedHtml\/trustedUrl\/trustedSql callees/,
      );

      try {
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
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
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails check:sound-subset when the starter security surface is not fully enrolled', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-security-surface-enrollment-'));

    try {
      writeKovoProject(root, { name: 'Security Surface Enrollment Proof' });
      linkStarterBuildDependencies(root);
      rmSync(join(root, 'src/endpoint-posture.test.ts'), { force: true });

      expect(() =>
        execFileSync(process.execPath, [join(root, 'scripts/check-sound-subset.mjs')], {
          cwd: root,
          stdio: 'pipe',
        }),
      ).toThrowError(
        /endpoint-posture\.test\.ts:1: SPEC\.md §6\.6\/§10\.2\/§10\.3 sound subset must enroll the whole starter security surface/,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('emits the SQLite scaffold variant when requested', () => {
    const project = createKovoProject({ dialect: 'sqlite', name: 'Sqlite App' });
    const files = new Map(project.files.map((file) => [file.path, file.source]));
    const packageJson = JSON.parse(files.get('package.json') ?? '{}') as {
      pnpm?: { onlyBuiltDependencies?: string[] };
    };

    expect(files.get('package.json')).toContain('"better-sqlite3"');
    expect(files.get('package.json')).not.toContain('"@electric-sql/pglite"');
    expect(packageJson.pnpm?.onlyBuiltDependencies).toEqual(['better-sqlite3']);
    expect(files.get('src/db.ts')).toContain(
      "import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'",
    );
    expect(files.get('src/db.ts')).toContain(
      "import { appRuntimeReadonlyDb } from './_kovo/app-runtime-db.js'",
    );
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
      "import Database from 'better-sqlite3'",
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain("from 'drizzle-orm/better-sqlite3'");
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('readonlyDb: AppReadonlyDb');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'client.exec(SCHEMA_DDL);\n  client.exec(SEED_CONTACTS);\n  const db = drizzle({ client, schema });',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain(
      'readonlyDb(db).exec(SCHEMA_DDL)',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('readonlyDb: secretReadDb');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'Object.defineProperty(db, kovoReadonlyDbHandle',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('ready: Promise.resolve()');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const SECRET_READ_METADATA = extractKovoRuntimeDbMetadata(SCHEMA_TABLES)',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'const secretReadDb = createSecretBoxingReadDb(readonlyDb(db), SECRET_READ_METADATA',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain(
      'function secretBoxingReadDb<Db extends object>',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export const appRuntimeReadonlyDb: AppReadonlyDb = appDatabase.readonlyDb',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      'export function appRuntimeDbProvider(): AppDb',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('__kovoStarterAppDatabase');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      '"emailVerified" integer NOT NULL DEFAULT 0',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain(
      '"createdAt" integer NOT NULL DEFAULT',
    );
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('"expiresAt" integer NOT NULL');
    expect(files.get('src/_kovo/app-runtime-db.ts')).toContain('"accessTokenExpiresAt" integer');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('"createdAt" text');
    expect(files.get('src/_kovo/app-runtime-db.ts')).not.toContain('"expiresAt" text');
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
    expect(files.get('src/auth.ts')).toContain("provider: 'sqlite'");
    expect(files.get('src/auth.ts')).toContain(
      "import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js'",
    );
    expect(files.get('src/auth.ts')).toContain('database: drizzleAdapter(appRuntimeDbProvider(),');
    expect(files.get('src/auth.ts')).not.toContain('database: drizzleAdapter(appDb,');
    expect(files.get('README.md')).toContain('opt-in SQLite dialect');
    expect(files.get('README.md')).toContain('Better Auth currently marks `drizzle-orm@^0.45.2`');
    expect(files.get('README.md')).toContain('peer warning');
    expect(files.get('README.md')).toContain('is expected');
  });

  it('writes local link specs that survive symlinked app roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'create-kovo-link-local-'));
    const realAppsRoot = join(root, 'real-apps');
    const aliasAppsRoot = join(root, 'alias-apps');
    mkdirSync(realAppsRoot, { recursive: true });
    symlinkSync(realAppsRoot, aliasAppsRoot);
    const appRoot = join(aliasAppsRoot, 'linked-app');

    try {
      writeKovoProject(appRoot, { dialect: 'sqlite', name: 'Linked App', disableGit: true });

      execFileSync(process.execPath, [linkLocalKovoScriptPath, appRoot, repoRoot], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      const realAppRoot = realpathSync(appRoot);
      const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      const serverSpec = packageJson.dependencies?.['@kovojs/server'] ?? '';
      expect(serverSpec.startsWith('link:')).toBe(true);
      expect(realpathSync(resolve(realAppRoot, serverSpec.slice('link:'.length)))).toBe(
        realpathSync(join(repoRoot, 'packages/server')),
      );

      const workspace = readFileSync(join(appRoot, 'pnpm-workspace.yaml'), 'utf8');
      const workspacePattern = workspace.split('\n')[2]?.trim().slice(2) ?? '';
      expect(realpathSync(resolve(realAppRoot, workspacePattern.replace(/\/\*$/, '')))).toBe(
        realpathSync(join(repoRoot, 'packages')),
      );
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
      expect(appSource).toContain('createApp(');
      expect(appSource).not.toContain('/c/__v/');
      expect(appSource).not.toContain('Starter$announce');

      // No fake graph apparatus or static-export wrappers remain.
      expect(existsSync(join(root, 'scripts/check-sound-subset.mjs'))).toBe(true);
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
        if (file.path === '.env') continue;
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
      const demoPassword =
        new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(envSource)?.[1] ?? '';
      expect(demoPassword).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(demoPassword).not.toBe('password123');

      expect(readFileSync(join(root, '.env.example'), 'utf8')).toContain(
        'KOVO_CSRF_SECRET=replace-with-a-deployed-secret',
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
      expect(CREATE_KOVO_HELP).toContain('create-kovo my-app --dialect sqlite');
      expect(CREATE_KOVO_HELP).toContain('--disable-git');
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
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).toMatchObject({
        name: 'hello-cli',
      });
      expect(existsSync(join(root, '.git'))).toBe(true);
    } finally {
      stdout.mockRestore();
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('accepts a SQLite dialect flag', () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-kovo-cli-sqlite-'));
    const root = join(parent, 'Hello SQLite');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      expect(main([root, '--dialect', 'sqlite'])).toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Dialect     sqlite'));
      expect(readFileSync(join(root, 'src/auth.ts'), 'utf8')).toContain("provider: 'sqlite'");
    } finally {
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
      expect(readFileSync(join(target, 'src/app.tsx'), 'utf8')).toContain('createApp(');
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
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Unsupported dialect: mysql.'));
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
});
