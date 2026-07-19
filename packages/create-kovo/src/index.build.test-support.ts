import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';

import { expect } from 'vitest';

import { demoPasswordEnvVar } from './index.js';
import {
  cookieHeader,
  fetchTextWhenReady,
  mergeCookies,
  resolveStarterBin,
  withStarterBinOnPath,
} from './index.test-support.js';

// Production artifact proofs compile an entire generated application. Shared GitHub runners can
// be several times slower under the full matrix, so keep the semantic test deadline distinct from
// local feedback while still bounding a genuinely stuck build.
export const PRODUCTION_ARTIFACT_TEST_TIMEOUT_MS = process.env.CI ? 600_000 : 180_000;

/** Mint the production wire grammar from SPEC §10.3 with a full 128 random nonce bits. */
export function freshProductionArtifactIdempotencyToken(): string {
  return `v1_${Date.now()}_${randomBytes(16).toString('hex')}`;
}

export function addNoJsFailureProof(root: string): void {
  writeFileSync(
    join(root, 'src/no-js-failure-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';",
      "import { mutation, mutationFormAttributes, publicAccess, s, type MutationContext } from '@kovojs/server';",
      '',
      "import { appCsrf } from './auth.js';",
      '',
      'const blockedTitle = s.object({ title: s.string() });',
      '',
      'export const blockTitle = mutation({',
      "  access: publicAccess('public production FormError regression proof'),",
      '  csrf: appCsrf,',
      '  errors: { BLOCKED_TITLE: blockedTitle },',
      '  input: s.object({ title: s.string() }),',
      '  handler(',
      '    input: { title: string },',
      '    _request: unknown,',
      '    context: MutationContext<{ BLOCKED_TITLE: typeof blockedTitle }>,',
      '  ) {',
      "    return context.fail('BLOCKED_TITLE', { title: input.title });",
      '  },',
      '});',
      '',
      'export const crashTitle = mutation({',
      "  access: publicAccess('public production no-JS 500 regression proof'),",
      '  csrf: appCsrf,',
      '  input: s.object({ title: s.string() }),',
      '  handler() {',
      "    throw new Error('private no-JS mutation detail <script>boom</script>');",
      '  },',
      '});',
      '',
      'type BlockTitleSlots = ComponentRenderSlots<{ blockTitle: typeof blockTitle }>;',
      'interface BlockedTitleFailure {',
      "  code: 'BLOCKED_TITLE';",
      '  payload: { title: string };',
      '}',
      'export const NoJsFailureProof = component({',
      '  mutations: { blockTitle },',
      '  render: (_queries, _state, slots: BlockTitleSlots) => {',
      '    const submitted = slots.forms.blockTitle.submitted ?? {};',
      "    const submittedTitle = typeof submitted.title === 'string' ? submitted.title : '';",
      '    return (',
      '      <main>',
      '        <h1>Blocked title proof</h1>',
      '        <form {...mutationFormAttributes(blockTitle)}>',
      '          <input name="title" value={submittedTitle} />',
      '          <FormError',
      '            code="BLOCKED_TITLE"',
      '            failure={slots.forms.blockTitle.failure}',
      '            message={(failure: BlockedTitleFailure) =>',
      '              `Blocked title: ${failure.payload.title}`',
      '            }',
      '          />',
      '          <button type="submit">Save</button>',
      '        </form>',
      '      </main>',
      '    );',
      '  },',
      '});',
      '',
      'export const NoJsErrorProof = component({',
      '  mutations: { crashTitle },',
      '  render: () => (',
      '    <main>',
      '      <h1>No-JS error proof</h1>',
      '      <form {...mutationFormAttributes(crashTitle)}>',
      '        <input name="title" value="boom" />',
      '        <button type="submit">Crash</button>',
      '      </form>',
      '    </main>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      "import { addContact } from './mutations.js';",
      [
        "import { addContact } from './mutations.js';",
        "import { blockTitle, crashTitle, NoJsErrorProof, NoJsFailureProof } from './no-js-failure-proof.js';",
      ].join('\n'),
    )
    .replace(
      '  mutations: [addContact, appSignIn, appSignOut],',
      '  mutations: [addContact, blockTitle, crashTitle, appSignIn, appSignOut],',
    )
    .replace(
      "  routes: [\n    route('/', {",
      [
        '  routes: [',
        "    route('/no-js-failure-proof', {",
        "      access: publicAccess('public production FormError regression proof'),",
        "      meta: { title: 'FormError proof' },",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      page() {',
        '        return <NoJsFailureProof />;',
        '      },',
        '    }),',
        "    route('/no-js-error-proof', {",
        "      access: publicAccess('public production no-JS 500 regression proof'),",
        "      meta: { title: 'No-JS error proof' },",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      page() {',
        '        return <NoJsErrorProof />;',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

export function buildProductionArtifact(
  root: string,
  options: { maxOldSpaceSizeMb?: number } = {},
): void {
  // CI may restore TypeScript build-info; this prod-artifact gate still proves a fully cold source.
  rmSync(join(root, '.kovo/cache'), { force: true, recursive: true });
  const env = nonParanoidStarterEnv(root);
  if (options.maxOldSpaceSizeMb !== undefined) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, `--max-old-space-size=${options.maxOldSpaceSizeMb}`]
      .filter(Boolean)
      .join(' ');
  }
  execKovoCli(root, ['build', './src/app.tsx', '--no-cache'], env);
}

export function buildReusableProductionArtifact(root: string): void {
  execKovoCli(root, ['build', './src/app.tsx'], nonParanoidStarterEnv(root));
}

export function buildParanoidProductionArtifact(root: string): void {
  rmSync(join(root, '.kovo/cache'), { force: true, recursive: true });
  execKovoCli(root, ['build', './src/app.tsx', '--no-cache'], {
    ...withStarterBinOnPath(root),
    KOVO_PARANOID: '1',
    NODE_OPTIONS: '--max-old-space-size=8192',
  });
}

export function migrateRuntimeSecretBoundaryProof(root: string, dataDir: string): void {
  const emptyMigrations = join(root, '.kovo/runtime-secret-boundary-empty-migrations');
  mkdirSync(emptyMigrations, { recursive: true });
  const env = {
    ...withStarterBinOnPath(root),
    KOVO_PARANOID: '1',
  };
  execKovoCli(
    root,
    [
      'db',
      'provision',
      '--driver',
      'pglite',
      '--data-dir',
      dataDir,
      '--schema',
      './src/schema.ts',
      '--migrations',
      emptyMigrations,
    ],
    env,
  );
  execKovoCli(
    root,
    [
      'db',
      'migrate',
      '--driver',
      'pglite',
      '--data-dir',
      dataDir,
      '--schema',
      './src/schema.ts',
      '--migrations',
      './migrations',
    ],
    env,
  );
}

function execKovoCli(root: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const bin = resolveStarterBin(root, 'kovo');
  const command = bin.endsWith('.ts') ? process.execPath : bin;
  const commandArgs = bin.endsWith('.ts')
    ? ['--disable-warning=ExperimentalWarning', '--experimental-transform-types', bin, ...args]
    : args;
  execFileSync(command, commandArgs, {
    cwd: root,
    env,
    stdio: 'pipe',
  });
}

function nonParanoidStarterEnv(root: string): NodeJS.ProcessEnv {
  const env = { ...withStarterBinOnPath(root) };
  delete env.KOVO_PARANOID;
  return env;
}

export function addStorageQueryWriteProof(root: string): void {
  const queriesPath = join(root, 'src/queries.ts');
  let queries = readFileSync(queriesPath, 'utf8');
  queries = replaceRequired(
    queries,
    "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    "import { publicAccess, publicScopedKey, query, type JsonValue, type QueryLoadContext, type Reader, type StorageCapability } from '@kovojs/server';",
    'storage query write proof import',
  );
  queries = replaceRequired(
    queries,
    'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
    [
      'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
      '',
      'type AppStorageWriteQueryLoadContext = AppQueryLoadContext & StorageCapability;',
      'type AppStorageUploadQueryLoadContext = AppQueryLoadContext & {',
      '  upload(key: string, body: string): Promise<unknown>;',
      '};',
      '',
      'export const storagePutWriteQuery = query({',
      "  access: publicAccess('storage put write query proof'),",
      '  reads: [],',
      '  async load(',
      '    _input: unknown,',
      '    storage?: AppStorageWriteQueryLoadContext,',
      '  ): Promise<{ ok: true }> {',
      "    if (!storage) throw new Error('storage query proof requires loader context');",
      "    await storage.put(publicScopedKey('receipts/query-write-proof.txt'), 'bad');",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const storageDeleteWriteQuery = query({',
      "  access: publicAccess('storage delete write query proof'),",
      '  reads: [],',
      '  async load(',
      '    _input: unknown,',
      '    storage?: AppStorageWriteQueryLoadContext,',
      '  ): Promise<{ ok: true }> {',
      "    if (!storage) throw new Error('storage query proof requires loader context');",
      "    await storage.delete(publicScopedKey('receipts/query-delete-proof.txt'));",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const storageUploadWriteQuery = query({',
      "  access: publicAccess('storage upload write query proof'),",
      '  reads: [],',
      '  async load(',
      '    _input: unknown,',
      '    storageUpload?: AppStorageUploadQueryLoadContext,',
      '  ): Promise<{ ok: true }> {',
      "    if (!storageUpload) throw new Error('storage upload proof requires loader context');",
      "    await storageUpload.upload('receipts/query-upload-proof.txt', 'bad');",
      '    return { ok: true };',
      '  },',
      '});',
    ].join('\n'),
    'storage query write proof query',
  );
  writeFileSync(queriesPath, queries, 'utf8');

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { contactsQuery } from './queries.js';",
    "import { contactsQuery, storageDeleteWriteQuery, storagePutWriteQuery, storageUploadWriteQuery } from './queries.js';",
    'storage query write proof app import',
  );
  app = replaceRequired(
    app,
    '  queries: [contactsQuery],',
    '  queries: [contactsQuery, storageDeleteWriteQuery, storagePutWriteQuery, storageUploadWriteQuery],',
    'storage query write proof app registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addOpaqueStorageQueryWriteProof(root: string): void {
  const queriesPath = join(root, 'src/queries.ts');
  let queries = readFileSync(queriesPath, 'utf8');
  queries = replaceRequired(
    queries,
    "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    "import { createMemoryStorage, publicAccess, query, s, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    'opaque storage query proof import',
  );
  queries = replaceRequired(
    queries,
    'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
    [
      'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
      '',
      'const canonicalFileStoreWriteProbe = createMemoryStorage();',
      'const opaqueStorageWriteProbe = createMemoryStorage();',
      'const opaqueUploadStorageWriteProbe = {',
      '  upload: opaqueStorageWriteProbe.put.bind(opaqueStorageWriteProbe),',
      '};',
      '',
      'export const opaqueStorageComputedWriteQuery = query({',
      "  access: publicAccess('opaque storage computed write query proof'),",
      '  reads: [],',
      '  async load(): Promise<{ ok: true }> {',
      "    const method = 'put' as string;",
      '    const storage = opaqueStorageWriteProbe as unknown as Record<string, (key: string, body: string) => Promise<unknown>>;',
      "    await storage[method]!('receipts/query-computed-proof.txt', 'bad');",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const opaqueStorageFileStoreWriteQuery = query({',
      "  access: publicAccess('opaque storage file store write query proof'),",
      '  reads: [],',
      '  async load(): Promise<{ ok: true }> {',
      "    const schema = s.file().store({ keyPrefix: 'receipts', storage: canonicalFileStoreWriteProbe });",
      "    await schema.parseAsync(new File(['bad'], 'query-store-proof.txt', { type: 'text/plain' }));",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const opaqueStorageUploadWriteQuery = query({',
      "  access: publicAccess('opaque storage upload write query proof'),",
      '  reads: [],',
      '  async load(): Promise<{ ok: true }> {',
      "    await opaqueUploadStorageWriteProbe.upload('receipts/query-upload-proof.txt', 'bad');",
      '    return { ok: true };',
      '  },',
      '});',
    ].join('\n'),
    'opaque storage query proof query',
  );
  writeFileSync(queriesPath, queries, 'utf8');

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { contactsQuery } from './queries.js';",
    "import { contactsQuery, opaqueStorageComputedWriteQuery, opaqueStorageFileStoreWriteQuery, opaqueStorageUploadWriteQuery } from './queries.js';",
    'opaque storage query proof app import',
  );
  app = replaceRequired(
    app,
    '  queries: [contactsQuery],',
    '  queries: [contactsQuery, opaqueStorageComputedWriteQuery, opaqueStorageFileStoreWriteQuery, opaqueStorageUploadWriteQuery],',
    'opaque storage query proof app registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addStorageMutationWriteProof(root: string): void {
  writeFileSync(
    join(root, 'src/storage-mutation-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { createMemoryStorage, mutation, mutationFormAttributes, publicAccess, s } from '@kovojs/server';",
      '',
      "import { appCsrf } from './auth.js';",
      '',
      'const storageMutationProof = createMemoryStorage();',
      "await storageMutationProof.put('receipts/delete-target.txt', 'delete target');",
      "const publicProof = publicAccess('public storage mutation capability proof');",
      '',
      'export const storageMutationWrite = mutation({',
      '  access: publicProof,',
      '  csrf: appCsrf,',
      '  input: s.object({ mode: s.string() }),',
      '  async handler(input: { mode: string }) {',
      "    if (input.mode === 'put') {",
      "      await storageMutationProof.put('receipts/mutation-put.txt', 'mutation put ok', {",
      "        contentType: 'text/plain',",
      '      });',
      "      return { mode: 'put' };",
      '    }',
      "    if (input.mode === 'delete') {",
      "      await storageMutationProof.delete('receipts/delete-target.txt');",
      "      return { mode: 'delete' };",
      '    }',
      "    throw new Error('unsupported storage mutation proof mode');",
      '  },',
      '});',
      '',
      'export async function storageMutationStatus() {',
      "  const put = await storageMutationProof.get('receipts/mutation-put.txt');",
      "  const deleteTarget = await storageMutationProof.get('receipts/delete-target.txt');",
      '  return (',
      '    <main data-proof="storage-mutation">',
      '      <p id="storage-put">{put === undefined ? "missing" : "present"}</p>',
      '      <p id="storage-delete">{deleteTarget === undefined ? "missing" : "present"}</p>',
      '      <form {...mutationFormAttributes(storageMutationWrite)}>',
      '        <input name="mode" value="put" />',
      '        <button type="submit">Write storage</button>',
      '      </form>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { addContact } from './mutations.js';",
    [
      "import { addContact } from './mutations.js';",
      "import { storageMutationStatus, storageMutationWrite } from './storage-mutation-proof.js';",
    ].join('\n'),
    'storage mutation proof import',
  );
  app = replaceRequired(
    app,
    '  mutations: [addContact, appSignIn, appSignOut],',
    '  mutations: [addContact, storageMutationWrite, appSignIn, appSignOut],',
    'storage mutation proof registration',
  );
  app = replaceRequired(
    app,
    "  routes: [\n    route('/', {",
    [
      '  routes: [',
      "    route('/storage-mutation-proof', {",
      "      access: publicAccess('public storage mutation capability proof'),",
      '      page: storageMutationStatus,',
      '    }),',
      "    route('/', {",
    ].join('\n'),
    'storage mutation proof route',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addRawSqlOwnerWriteProof(
  root: string,
  options: { declareTables?: boolean; staticStatement?: boolean; trusted?: boolean } = {},
): void {
  const declareTables = options.declareTables !== false;
  const staticStatement = options.staticStatement === true;
  const schemaPath = join(root, 'src/schema.ts');
  const schemaSource = readFileSync(schemaPath, 'utf8');
  const isSqlite = schemaSource.includes('sqliteTable(');
  const tableFactory = isSqlite ? 'sqliteTable' : 'pgTable';
  const rawSqlMethod = isSqlite ? 'run' : 'execute';
  writeFileSync(
    schemaPath,
    schemaSource.replace(
      ');\n\n// --- Auth infrastructure',
      [
        ');',
        '',
        `export const rawOwners = ${tableFactory}(`,
        "  'raw_owners',",
        '  {',
        "    id: text('id').primaryKey(),",
        "    userId: text('userId').notNull(),",
        "    label: text('label').notNull().default(''),",
        '  },',
        "  kovo({ domain: 'raw-owner', key: 'id', owner: 'userId' }),",
        ');',
        '',
        '// --- Auth infrastructure',
      ].join('\n'),
    ),
    'utf8',
  );

  const mutationsPath = join(root, 'src/mutations.ts');
  let mutations = readFileSync(mutationsPath, 'utf8');
  mutations = replaceRequired(
    mutations,
    "import { mutation, s, trustedAssign, type MutationContext } from '@kovojs/server';",
    [
      options.trusted
        ? "import { sql, trustedSql } from '@kovojs/drizzle';"
        : staticStatement
          ? "import { staticSql } from '@kovojs/drizzle';"
          : "import { sql } from '@kovojs/drizzle';",
      "import { domain, mutation, s, trustedAssign, type MutationContext } from '@kovojs/server';",
    ].join('\n'),
    'raw SQL proof server import',
  );
  mutations = replaceRequired(
    mutations,
    'const duplicateEmailError = s.object({ email: s.string() });',
    [
      'const duplicateEmailError = s.object({ email: s.string() });',
      "const rawOwner = domain('raw-owner');",
    ].join('\n'),
    'raw SQL proof domain declaration',
  );
  mutations = patchRawSqlProofMutationRegistry(mutations, declareTables);
  mutations = replaceRequired(
    mutations,
    [
      '  await db.insert(contacts).values({',
      '    company: row.company,',
      '    email: row.email,',
      "    id: trustedAssign(id, 'opaque server-generated contact id'),",
      '    name: row.name,',
      '  });',
    ].join('\n'),
    [
      `  await db.${rawSqlMethod}(`,
      options.trusted
        ? "    trustedSql(sql`update raw_owners set label = ${row.company} where id = ${trustedAssign(id, 'opaque server-generated contact id')}`, { justification: 'reviewed owner predicate' }),"
        : staticStatement
          ? "    staticSql`update raw_owners set label = 'fixture' where id = 'fixture'`,"
          : "    sql`update raw_owners set label = ${row.company} where id = ${trustedAssign(id, 'opaque server-generated contact id')}`,",
      '  );',
      '  await db.insert(contacts).values({',
      '    company: row.company,',
      '    email: row.email,',
      "    id: trustedAssign(id, 'opaque server-generated contact id'),",
      '    name: row.name,',
      '  });',
    ].join('\n'),
    'raw SQL proof contact insert anchor',
  );
  writeFileSync(mutationsPath, mutations, 'utf8');
}

function patchRawSqlProofMutationRegistry(source: string, declareTables: boolean): string {
  const compactRegistryPattern =
    /registry: \{ (?<body>[^{}]*touches: \[[^\]]*\bcontact\b[^\]]*\][^{}]*) \},/;
  const compactMatch = compactRegistryPattern.exec(source);
  if (compactMatch?.groups?.body !== undefined) {
    return source.replace(
      compactRegistryPattern,
      (_match: string, body: string) =>
        `registry: { ${patchRawSqlRegistryBody(body, declareTables, 'compact')} },`,
    );
  }

  const registryBlockPattern = /  registry: \{\n(?<body>(?:    .*\n)+?)  \},/g;
  let patched = false;
  const result = source.replace(registryBlockPattern, (match: string, body: string) => {
    if (patched || !body.includes('touches: [contact],')) return match;

    patched = true;
    const nextBody = patchRawSqlRegistryBody(body, declareTables, 'multiline');
    return `  registry: {\n${nextBody}  },`;
  });

  if (!patched) throw new Error('Expected scaffold anchor for raw SQL proof mutation registry.');
  return result;
}

function patchRawSqlRegistryBody(
  body: string,
  declareTables: boolean,
  layout: 'compact' | 'multiline',
): string {
  let nextBody = appendArrayEntry(body, 'touches', 'rawOwner');
  if (!declareTables) return nextBody;

  if (/tables: \[[^\]]*\]/.test(nextBody)) {
    return appendArrayEntry(nextBody, 'tables', "'raw_owners'");
  }

  if (layout === 'compact') return `tables: ['raw_owners'], ${nextBody}`;
  return nextBody.replace(/^(\s*)touches: \[/m, "$1tables: ['raw_owners'],\n$1touches: [");
}

function appendArrayEntry(body: string, property: string, entry: string): string {
  const pattern = new RegExp(`${property}: \\[([^\\]]*)\\]`);
  return body.replace(pattern, (match: string, existing: string) => {
    const entries = existing
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (entries.includes(entry)) return match;
    return `${property}: [${[...entries, entry].join(', ')}]`;
  });
}

export interface StarterMutationDbScopeProofOptions {
  mode: 'runtime-table-choke' | 'static-structured';
}

export function addStarterMutationDbScopeProof(
  root: string,
  options: StarterMutationDbScopeProofOptions,
): void {
  const staticStructured = options.mode === 'static-structured';
  const proofMutations = staticStructured
    ? ['starterAuthSessionTableWriteProof', 'starterAuthUserTableWriteProof']
    : ['starterAbsentTablesContactWriteProof', 'starterRawAuthTableWriteProof'];
  const proofImports = [
    ...(staticStructured ? [] : ['starterDbScopeStatusEndpoint']),
    ...proofMutations,
  ];
  writeFileSync(
    join(root, 'src/starter-mutation-db-scope-proof.ts'),
    [
      ...(staticStructured ? [] : ["import { sql, trustedSql } from '@kovojs/drizzle';"]),
      staticStructured
        ? "import { mutation, publicAccess, s, serverValue } from '@kovojs/server';"
        : "import { endpoint, mutation, publicAccess, s, serverValue } from '@kovojs/server';",
      ...(staticStructured ? [] : ["import { eq } from 'drizzle-orm';"]),
      '',
      "import { appCsrf, type AppRequest } from './auth.js';",
      ...(staticStructured ? [] : ["import { readonlyAppDb } from './db.js';"]),
      "import { contact } from './model.js';",
      ...(staticStructured ? [] : ["import { contactsQuery } from './queries.js';"]),
      staticStructured
        ? "import { session, user } from './schema.js';"
        : "import { contacts } from './schema.js';",
      '',
      "const publicProof = publicAccess('public starter mutation DB scope proof');",
      ...(staticStructured
        ? []
        : ["const STARTER_DB_SCOPE_CONTACT_EMAIL = 'starter-scope-proof-contact@example.com';"]),
      'const proofInput = s.object({ marker: s.string() });',
      '',
      ...(staticStructured
        ? [
            'async function starterAuthUserTableWrite(db: AppRequest["db"]) {',
            '    await db.insert(user).values({',
            '      createdAt: new Date(),',
            "      email: 'starter-scope-proof-auth-user@example.com',",
            '      emailVerified: false,',
            "      id: serverValue('starter-scope-proof-auth-user', 'server-generated auth user drift id'),",
            "      name: 'blocked auth user',",
            '      updatedAt: new Date(),',
            '    });',
            '}',
            '',
            'export const starterAuthUserTableWriteProof = mutation({',
            '  access: publicProof,',
            '  csrf: appCsrf,',
            '  input: proofInput,',
            "  registry: { tables: ['contacts'], touches: [contact] },",
            '  async handler(input: { marker: string }, request: AppRequest) {',
            '    void input;',
            '    await starterAuthUserTableWrite(request.db);',
            '    return { ok: true };',
            '  },',
            '});',
            '',
            'async function starterAuthSessionTableWrite(db: AppRequest["db"]) {',
            '    await db.insert(session).values({',
            '      createdAt: new Date(),',
            '      expiresAt: new Date(60_000),',
            "      id: serverValue('starter-scope-proof-auth-session', 'server-generated auth session drift id'),",
            "      token: 'starter-scope-proof-auth-session-token',",
            '      updatedAt: new Date(),',
            "      userId: 'demo-user',",
            '    });',
            '}',
            '',
            'export const starterAuthSessionTableWriteProof = mutation({',
            '  access: publicProof,',
            '  csrf: appCsrf,',
            '  input: proofInput,',
            "  registry: { tables: ['contacts'], touches: [contact] },",
            '  async handler(input: { marker: string }, request: AppRequest) {',
            '    void input;',
            '    await starterAuthSessionTableWrite(request.db);',
            '    return { ok: true };',
            '  },',
            '});',
            '',
          ]
        : []),
      ...(staticStructured
        ? []
        : [
            'async function starterRawAuthTableWrite(db: AppRequest["db"]) {',
            '    await (db as unknown as { execute(statement: unknown): Promise<unknown> }).execute(',
            '      trustedSql(',
            '        sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values (${\'starter-scope-proof-raw-auth-user\'}, \'blocked raw auth user\', ${\'starter-scope-proof-raw-auth-user@example.com\'}, false, now(), now())`,',
            "        { justification: 'starter raw SQL out-of-scope auth table proof' },",
            '      ),',
            '    );',
            '}',
            '',
            'export const starterRawAuthTableWriteProof = mutation({',
            '  access: publicProof,',
            '  csrf: appCsrf,',
            '  input: proofInput,',
            "  optimistic: { [contactsQuery.key]: 'await-fragment' },",
            "  registry: { tables: ['contacts'], touches: [contact] },",
            '  async handler(input: { marker: string }, request: AppRequest) {',
            '    void input;',
            '    await starterRawAuthTableWrite(request.db);',
            '    return { ok: true };',
            '  },',
            '});',
            '',
            'async function starterAbsentTablesContactWrite(db: AppRequest["db"]) {',
            '    await db.insert(contacts).values({',
            "      company: 'Absent tables proof',",
            "      email: 'starter-scope-proof-absent-tables@example.com',",
            "      id: serverValue('starter-scope-proof-absent-contact', 'server-generated absent tables contact id'),",
            "      name: 'Blocked absent tables contact',",
            '    });',
            '}',
            '',
            'export const starterAbsentTablesContactWriteProof = mutation({',
            '  access: publicProof,',
            '  csrf: appCsrf,',
            '  input: proofInput,',
            "  optimistic: { [contactsQuery.key]: 'await-fragment' },",
            '  registry: { touches: [contact] },',
            '  async handler(input: { marker: string }, request: AppRequest) {',
            '    void input;',
            '    await starterAbsentTablesContactWrite(request.db);',
            '    return { ok: true };',
            '  },',
            '});',
            '',
            "export const starterDbScopeStatusEndpoint = endpoint('/api/starter-db-scope-proof', {",
            '  access: publicProof,',
            "  auth: { justification: 'public starter mutation DB scope proof', kind: 'none' },",
            '  csrf: false,',
            "  csrfJustification: 'read-only starter mutation DB scope proof',",
            '  async handler(_request: Request) {',
            '    const contactRows = await readonlyAppDb',
            '      .select({ id: contacts.id })',
            '      .from(contacts)',
            '      .where(eq(contacts.email, STARTER_DB_SCOPE_CONTACT_EMAIL));',
            '    const absentContactRows = await readonlyAppDb',
            '      .select({ id: contacts.id })',
            '      .from(contacts)',
            "      .where(eq(contacts.email, 'starter-scope-proof-absent-tables@example.com'));",
            '    return Response.json(',
            '      {',
            '        absentContactRows: absentContactRows.length,',
            '        contactRows: contactRows.length,',
            '      },',
            "      { headers: { 'Cache-Control': 'no-store' } },",
            '    );',
            '  },',
            "  method: 'GET',",
            "  reason: 'read-only starter mutation DB scope proof',",
            "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
            '});',
            '',
          ]),
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/starter-mutation-db-scope-proof-forms.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { mutationFormAttributes } from '@kovojs/server';",
      '',
      `import { ${proofMutations.join(', ')} } from './starter-mutation-db-scope-proof.js';`,
      '',
      'export const StarterMutationDbScopeProofForms = component({',
      '  mutations: {',
      ...proofMutations.map((name) => `    ${name},`),
      '  },',
      '  render: () => (',
      '    <div hidden>',
      ...proofMutations.map((name) => `      <form {...mutationFormAttributes(${name})} />`),
      '    </div>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { addContact } from './mutations.js';",
    [
      "import { addContact } from './mutations.js';",
      `import { ${proofImports.join(', ')} } from './starter-mutation-db-scope-proof.js';`,
      "import { StarterMutationDbScopeProofForms } from './starter-mutation-db-scope-proof-forms.js';",
    ].join('\n'),
    'starter mutation db scope proof imports',
  );
  if (!staticStructured) {
    app = appendArrayEntry(app, 'endpoints', 'starterDbScopeStatusEndpoint');
  }
  app = replaceRequired(
    app,
    '      <ContactsRegion />',
    '      <ContactsRegion />\n      <StarterMutationDbScopeProofForms />',
    'starter mutation db scope proof forms',
  );
  app = replaceRequired(
    app,
    '  mutations: [addContact, appSignIn, appSignOut],',
    `  mutations: [addContact, ${proofMutations.join(', ')}, appSignIn, appSignOut],`,
    'starter mutation db scope mutation registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

export interface RuntimeMutationSafetyProofOptions {
  includeManagedWriteEscapeAttempt?: boolean;
  includeRawTableDrift?: boolean;
  includeReadonlyMutationAttempt?: boolean;
  includeReadonlyRuntimeChokeProbe?: boolean;
  includeSqliteAuthorizerTriggerDrift?: boolean;
  includeWebhookTransactionProof?: boolean;
  includeWebhookTxEscapeAttempt?: boolean;
}

export function addRuntimeMutationSafetyProofs(
  root: string,
  options: RuntimeMutationSafetyProofOptions = {},
): void {
  const includeManagedWriteEscapeAttempt = options.includeManagedWriteEscapeAttempt === true;
  const includeRawTableDrift = options.includeRawTableDrift === true;
  const includeReadonlyMutationAttempt = options.includeReadonlyMutationAttempt === true;
  const includeReadonlyRuntimeChokeProbe = options.includeReadonlyRuntimeChokeProbe === true;
  const includeSqliteAuthorizerTriggerDrift = options.includeSqliteAuthorizerTriggerDrift === true;
  const includeWebhookTransactionProof = options.includeWebhookTransactionProof === true;
  const includeWebhookTxEscapeAttempt = options.includeWebhookTxEscapeAttempt === true;
  const schemaPath = join(root, 'src/schema.ts');
  const schemaSource = readFileSync(schemaPath, 'utf8');
  const isSqlite = schemaSource.includes('sqliteTable(');
  const tableFactory = isSqlite ? 'sqliteTable' : 'pgTable';
  const rawRuntimeDriftMethod = isSqlite ? 'run' : 'execute';
  writeFileSync(
    schemaPath,
    schemaSource.replace(
      ');\n\n// --- Auth infrastructure',
      [
        ');',
        '',
        `export const txProofs = ${tableFactory}('tx_proofs', {`,
        "  id: text('id').primaryKey(),",
        '}, kovo({',
        isSqlite
          ? "  authzPolicy: 'transaction proof rows are fixture-controlled regression evidence',"
          : '  authzPolicy: sql`TRUE`,',
        "  domain: 'tx_proof',",
        "  key: 'id',",
        '}));',
        '',
        `export const rawRuntimeDrift = ${tableFactory}('raw_runtime_drift', {`,
        "  id: text('id').primaryKey(),",
        "  label: text('label').notNull().default(''),",
        '}, kovo({',
        isSqlite
          ? "  authzPolicy: 'runtime drift proof rows are fixture-controlled regression evidence',"
          : '  authzPolicy: sql`TRUE`,',
        "  domain: 'raw_runtime_drift',",
        "  key: 'id',",
        '}));',
        ...(includeSqliteAuthorizerTriggerDrift
          ? [
              '',
              `export const sqliteAuthorizerDeclared = ${tableFactory}('kovo_authorizer_declared', {`,
              "  id: text('id').primaryKey(),",
              "  label: text('label').notNull().default(''),",
              '}, kovo({',
              "  authzPolicy: 'SQLite authorizer declared proof rows are fixture-controlled regression evidence',",
              "  domain: 'kovo_authorizer_declared',",
              "  key: 'id',",
              '}));',
              '',
              `export const sqliteAuthorizerSideEffects = ${tableFactory}('kovo_authorizer_side_effects', {`,
              "  id: text('id').primaryKey(),",
              "  label: text('label').notNull().default(''),",
              '}, kovo({',
              "  authzPolicy: 'SQLite authorizer side-effect proof rows are fixture-controlled regression evidence',",
              "  domain: 'kovo_authorizer_side_effects',",
              "  key: 'id',",
              '}));',
            ]
          : []),
        '',
        '// --- Auth infrastructure',
      ].join('\n'),
    ),
    'utf8',
  );

  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db.ts');
  const runtimeDbSource = readFileSync(runtimeDbPath, 'utf8');
  const runtimeDb = isSqlite
    ? replaceRequired(
        replaceRequired(
          runtimeDbSource,
          'import {\n  account,',
          ["import * as schema from '../schema.js';", 'import {', '  account,'].join('\n'),
          'runtime mutation safety SQLite schema namespace import',
        ),
        'const APP_TABLES = [contacts, user, session, account, verification, rateLimit] as const;',
        [
          'const APP_TABLES = [',
          '  contacts,',
          '  schema.txProofs,',
          '  schema.rawRuntimeDrift,',
          ...(includeSqliteAuthorizerTriggerDrift
            ? ['  schema.sqliteAuthorizerDeclared,', '  schema.sqliteAuthorizerSideEffects,']
            : []),
          '  user,',
          '  session,',
          '  account,',
          '  verification,',
          '  rateLimit,',
          '] as const;',
        ].join('\n'),
        'runtime mutation safety SQLite table registration',
      )
    : runtimeDbSource
        .replace(
          "import { account, contacts, rateLimit, session, user, verification } from '../schema.js';",
          [
            'import {',
            '  account,',
            '  contacts,',
            '  rawRuntimeDrift,',
            '  rateLimit,',
            '  session,',
            '  txProofs,',
            '  user,',
            '  verification,',
            "} from '../schema.js';",
          ].join('\n'),
        )
        .replace(
          'const SCHEMA_TABLES = sortTablesByForeignKeyDependencies([\n  contacts,\n  user,',
          [
            'const SCHEMA_TABLES = sortTablesByForeignKeyDependencies([',
            '  contacts,',
            '  txProofs,',
            '  rawRuntimeDrift,',
            '  user,',
          ].join('\n'),
        );
  writeFileSync(runtimeDbPath, runtimeDb, 'utf8');

  writeFileSync(
    join(root, 'src/runtime-safety-proofs.ts'),
    [
      "import { sql, trustedSql } from '@kovojs/drizzle';",
      `import { ${includeWebhookTransactionProof ? 'createMemoryWebhookReplayStore, ' : ''}domain, endpoint, mutation, publicAccess, ${includeReadonlyRuntimeChokeProbe ? 'query, ' : ''}s, trustedAssign, webhook, ${includeWebhookTransactionProof ? 'webhookReplayIdentity, ' : ''}type EndpointDbContext, type MutationContext${includeReadonlyRuntimeChokeProbe ? ', type QueryLoadContext' : ''} } from '@kovojs/server';`,
      '',
      `import { ${includeReadonlyMutationAttempt ? 'readonlyAppDb, ' : ''}type AppDb } from './db.js';`,
      [
        'import {',
        '  rawRuntimeDrift,',
        ...(includeSqliteAuthorizerTriggerDrift ? ['  sqliteAuthorizerSideEffects,'] : []),
        '  txProofs,',
        "} from './schema.js';",
      ].join('\n'),
      "import type { AppRequest } from './auth.js';",
      ...(includeReadonlyRuntimeChokeProbe
        ? ['type RuntimeSafetyQueryContext = QueryLoadContext<AppRequest, AppDb>;']
        : []),
      '',
      'const runtimeTableDriftError = s.object({ message: s.string() });',
      "const publicProof = publicAccess('public production mutation safety regression proof');",
      "const txProof = domain('tx_proof');",
      'function write<Definition>(definition: Definition): Definition { return definition; }',
      ...(includeWebhookTransactionProof
        ? ['const webhookReplayStore = createMemoryWebhookReplayStore();']
        : []),
      ...(includeWebhookTransactionProof || includeWebhookTxEscapeAttempt
        ? [
            'const webhookTxProofInput = s.object({ id: s.string(), occurredAtMs: s.number().int() });',
          ]
        : []),
      ...(includeRawTableDrift || includeSqliteAuthorizerTriggerDrift
        ? [
            ...(includeRawTableDrift
              ? ["const rawRuntimeDriftDomain = domain('raw_runtime_drift');"]
              : []),
            ...(includeSqliteAuthorizerTriggerDrift
              ? ["const sqliteAuthorizerDeclaredDomain = domain('kovo_authorizer_declared');"]
              : []),
          ]
        : []),
      '',
      "async function insertTxProofRow(db: AppRequest['db'], id: string) {",
      '  void id;',
      "  await db.insert(txProofs).values({ id: trustedAssign(crypto.randomUUID(), 'opaque server-generated transaction proof id') });",
      '}',
      '',
      ...(includeManagedWriteEscapeAttempt
        ? [
            'export const managedWriteEscapeAttempt = mutation({',
            '  access: publicProof,',
            '  input: s.object({ id: s.string() }),',
            "  registry: { tables: ['tx_proofs'], touches: [txProof] },",
            '  async handler(input: { id: string }, request: AppRequest) {',
            '    const closeRawClient = (request.db as unknown as { $client: { close(): unknown } }).$client.close;',
            '    await closeRawClient();',
            '    void input.id;',
            '    return { ok: true };',
            '  },',
            '});',
            '',
          ]
        : []),
      ...(includeRawTableDrift
        ? [
            'const insertRawRuntimeDrift = write({',
            "  key: 'runtime-safety-proofs/insert-raw-runtime-drift',",
            "  tables: ['contacts'],",
            '  touches: [rawRuntimeDriftDomain],',
            "  async run(db: AppRequest['db'], input: { id: string; label: string }) {",
            `    await db.${rawRuntimeDriftMethod}(`,
            '      trustedSql(',
            '        sql`insert into raw_runtime_drift (id, label) values (${input.id}, ${input.label})`,',
            "        { justification: 'audited runtime table-drift proof' },",
            '      ),',
            '    );',
            '  },',
            '});',
            '',
          ]
        : []),
      'export const failAfterWrite = mutation({',
      '  access: publicProof,',
      '  input: s.object({ id: s.string() }),',
      ...(includeReadonlyRuntimeChokeProbe
        ? [
            "  optimistic: { 'runtime-safety-proofs/readonly-runtime-choke-probe': 'await-fragment' },",
          ]
        : []),
      "  registry: { tables: ['tx_proofs'], touches: [txProof] },",
      '  async handler(input: { id: string }, request: AppRequest) {',
      '    await insertTxProofRow(request.db, input.id);',
      "    throw new Error('rollback proof');",
      '  },',
      '});',
      '',
      'export const writeTxProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({ id: s.string() }),',
      ...(includeReadonlyRuntimeChokeProbe
        ? [
            "  optimistic: { 'runtime-safety-proofs/readonly-runtime-choke-probe': 'await-fragment' },",
          ]
        : []),
      "  registry: { tables: ['tx_proofs'], touches: [txProof] },",
      '  async handler(input: { id: string }, request: AppRequest) {',
      '    await insertTxProofRow(request.db, input.id);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      ...(includeWebhookTransactionProof
        ? [
            "export const txProofWebhook = webhook('/webhooks/tx-proof', {",
            '  access: publicProof,',
            '  idempotency: (input) => webhookReplayIdentity(input.id, input.occurredAtMs),',
            '  input: webhookTxProofInput,',
            '  replayStore: webhookReplayStore,',
            "  verify: 'none',",
            "  verifyJustification: 'local production webhook transaction proof fixture',",
            '  writes: [txProof],',
            '  async handler(input, context) {',
            '    await context',
            "      .actAs('production-webhook-transaction-proof')",
            '      .runMutation(writeTxProof, { id: input.id });',
            '    return { ok: true };',
            '  },',
            '});',
            '',
          ]
        : []),
      ...(includeWebhookTxEscapeAttempt
        ? [
            "export const webhookTxEscapeAttempt = webhook('/webhooks/tx-escape', {",
            '  access: publicProof,',
            '  input: webhookTxProofInput,',
            "  verify: 'none',",
            "  verifyJustification: 'local production webhook transaction proof fixture',",
            '  async handler(input, context) {',
            '    void (context.tx as unknown as { $client: unknown }).$client;',
            '    void (context.tx as unknown as { session: unknown }).session;',
            '    await (context.tx as unknown as { insert(table: unknown): { values(row: unknown): Promise<unknown> } }).insert(txProofs).values({ id: input.id });',
            '    return { ok: true };',
            '  },',
            '});',
            '',
          ]
        : []),
      ...(includeRawTableDrift
        ? [
            'export const rawTableDrift = mutation({',
            '  access: publicProof,',
            '  errors: { RUNTIME_TABLE_DRIFT: runtimeTableDriftError },',
            '  input: s.object({ id: s.string(), label: s.string() }),',
            "  registry: { tables: ['contacts'], touches: insertRawRuntimeDrift.touches },",
            '  async handler(',
            '    input: { id: string; label: string },',
            '    request: AppRequest,',
            '    context: MutationContext<{ RUNTIME_TABLE_DRIFT: typeof runtimeTableDriftError }>,',
            '  ) {',
            '    try {',
            '      await insertRawRuntimeDrift.run(request.db, input);',
            '    } catch (error) {',
            "      if (error instanceof Error && error.message.includes('KV406')) {",
            "        return context.fail('RUNTIME_TABLE_DRIFT', { message: 'KV406' });",
            '      }',
            '      throw error;',
            '    }',
            "    return { status: 'executed' };",
            '  },',
            '});',
            '',
          ]
        : []),
      ...(includeSqliteAuthorizerTriggerDrift
        ? [
            'async function runSqliteAuthorizerTriggerDrift(',
            "  db: AppRequest['db'],",
            '  _input: { id: string; label: string },',
            ') {',
            `  await db.${rawRuntimeDriftMethod}(`,
            '    trustedSql(',
            "      sql`update kovo_authorizer_declared set label = 'authorizer-trigger' where id = 'a1'`,",
            "      { justification: 'audited SQLite authorizer trigger-drift proof' },",
            '    ),',
            '  );',
            '}',
            '',
            'export const sqliteAuthorizerTriggerDrift = mutation({',
            '  access: publicProof,',
            '  errors: { RUNTIME_TABLE_DRIFT: runtimeTableDriftError },',
            '  input: s.object({ id: s.string(), label: s.string() }),',
            "  registry: { tables: ['kovo_authorizer_declared'], touches: [sqliteAuthorizerDeclaredDomain] },",
            '  async handler(',
            '    _input: { id: string; label: string },',
            '    request: AppRequest,',
            '    context: MutationContext<{ RUNTIME_TABLE_DRIFT: typeof runtimeTableDriftError }>,',
            '  ) {',
            '    try {',
            '      await runSqliteAuthorizerTriggerDrift(request.db, _input);',
            '    } catch (error) {',
            "      if (error instanceof Error && error.message.includes('SQLite authorizer')) {",
            "        return context.fail('RUNTIME_TABLE_DRIFT', { message: 'KV406' });",
            '      }',
            '      throw error;',
            '    }',
            "    return { status: 'executed' };",
            '  },',
            '});',
            '(',
            '  sqliteAuthorizerTriggerDrift as { key: string }',
            ").key = 'runtime-safety-proofs/sqlite-authorizer-trigger-drift';",
            '',
          ]
        : []),
      "export const txProofCountEndpoint = endpoint('/api/tx-proof-count', {",
      '  access: publicProof,',
      "  auth: { justification: 'public transaction rollback proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only transaction rollback proof',",
      '  db: true,',
      '  async handler(_request, context: EndpointDbContext<AppDb>) {',
      "    const scoped = await context.actAs('public-production-transaction-proof');",
      '    const rows = await scoped.db.read.select().from(txProofs);',
      "    return Response.json({ count: rows.length }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only transaction rollback proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const rawRuntimeDriftCountEndpoint = endpoint('/api/raw-runtime-drift-count', {",
      '  access: publicProof,',
      "  auth: { justification: 'public runtime raw-SQL allowlist proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only runtime raw-SQL allowlist proof',",
      '  db: true,',
      '  async handler(_request, context: EndpointDbContext<AppDb>) {',
      "    const scoped = await context.actAs('public-production-raw-runtime-proof');",
      '    const rows = await scoped.db.read.select().from(rawRuntimeDrift);',
      "    return Response.json({ count: rows.length }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only runtime raw-SQL allowlist proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      ...(includeSqliteAuthorizerTriggerDrift
        ? [
            "export const sqliteAuthorizerSideEffectCountEndpoint = endpoint('/api/sqlite-authorizer-side-effect-count', {",
            '  access: publicProof,',
            "  auth: { justification: 'public SQLite authorizer trigger side-effect proof', kind: 'none' },",
            '  csrf: false,',
            "  csrfJustification: 'read-only SQLite authorizer trigger side-effect proof',",
            '  db: true,',
            '  async handler(_request, context: EndpointDbContext<AppDb>) {',
            "    const scoped = await context.actAs('public-production-sqlite-authorizer-proof');",
            '    const rows = await scoped.db.read.select().from(sqliteAuthorizerSideEffects);',
            "    return Response.json({ count: rows.length }, { headers: { 'Cache-Control': 'no-store' } });",
            '  },',
            "  method: 'GET',",
            "  reason: 'read-only SQLite authorizer trigger side-effect proof',",
            "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
            '});',
            '',
          ]
        : []),
      ...(includeReadonlyMutationAttempt
        ? [
            'type ReadonlyAttemptResult = { blocked: boolean; message: string; method: string };',
            '',
            'function readonlyWriteStatement(method: string) {',
            '  return trustedSql(',
            "    sql`insert into raw_runtime_drift (id, label) values (${'readonly-' + method}, ${'must-not-insert'})`,",
            "    { justification: 'audited readonly GET mutation-attempt proof' },",
            '  );',
            '}',
            '',
            'async function attemptReadonlySqlMethod(method: string): Promise<ReadonlyAttemptResult> {',
            '  try {',
            '    const sqlMethod = (readonlyAppDb as unknown as Record<string, (statement: unknown) => Promise<unknown>>)[method]!;',
            '    await sqlMethod(readonlyWriteStatement(method));',
            "    return { blocked: false, message: 'write reached readonly handle', method };",
            '  } catch (error) {',
            '    const message = error instanceof Error ? error.message : String(error);',
            '    const blocked = /read-only|readonly|KV433|query\\(\\) loader cannot access/u.test(message);',
            '    return { blocked, message, method };',
            '  }',
            '}',
            '',
            'async function attemptReadonlyTransaction(): Promise<ReadonlyAttemptResult> {',
            '  try {',
            "    const transaction = (readonlyAppDb as unknown as { transaction(callback: (tx: unknown) => unknown): unknown })['transaction'];",
            '    await Promise.resolve(',
            '      transaction(() => {',
            "        throw new Error('readonly transaction callback should not run');",
            '      }),',
            '    );',
            "    return { blocked: false, message: 'transaction reached readonly handle', method: 'transaction' };",
            '  } catch (error) {',
            '    const message = error instanceof Error ? error.message : String(error);',
            '    const blocked = /read-only|readonly|KV433|query\\(\\) loader cannot access/u.test(message);',
            "    return { blocked, message, method: 'transaction' };",
            '  }',
            '}',
            '',
            'async function attemptReadonlyDeniedProperty(method: string): Promise<ReadonlyAttemptResult> {',
            '  try {',
            '    const denied = (readonlyAppDb as unknown as Record<string, () => unknown>)[method]!;',
            '    await Promise.resolve(denied());',
            "    return { blocked: false, message: 'raw driver escape reached readonly handle', method };",
            '  } catch (error) {',
            '    const message = error instanceof Error ? error.message : String(error);',
            '    const blocked = /read-only|readonly|KV433|query\\(\\) loader cannot access/u.test(message);',
            '    return { blocked, message, method };',
            '  }',
            '}',
            '',
            "export const readonlyMutationAttemptEndpoint = endpoint('/api/readonly-mutation-attempt', {",
            '  access: publicProof,',
            "  auth: { justification: 'public readonly handle mutation proof', kind: 'none' },",
            '  csrf: false,',
            "  csrfJustification: 'GET endpoint proves readonlyAppDb cannot mutate',",
            '  async handler() {',
            '    const results = [',
            `      await attemptReadonlySqlMethod('${rawRuntimeDriftMethod}'),`,
            "      await attemptReadonlySqlMethod('all'),",
            "      await attemptReadonlySqlMethod('get'),",
            "      await attemptReadonlySqlMethod('values'),",
            '      await attemptReadonlyTransaction(),',
            "      await attemptReadonlyDeniedProperty('$client'),",
            "      await attemptReadonlyDeniedProperty('session'),",
            "      await attemptReadonlyDeniedProperty('futureStatement'),",
            '    ];',
            '    const blocked = results.every((result) => result.blocked);',
            '    const message = results.map((result) => `${result.method}: ${result.message}`).join("\\n");',
            "    return Response.json({ blocked, message, results }, { headers: { 'Cache-Control': 'no-store' } });",
            '  },',
            "  method: 'GET',",
            "  reason: 'public readonly handle mutation proof',",
            "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
            '});',
            '',
          ]
        : []),
      ...(includeReadonlyRuntimeChokeProbe
        ? [
            'export const readonlyRuntimeChokeProbe = query({',
            '  access: publicProof,',
            '  output: s.object({ ok: s.boolean() }),',
            '  reads: [txProof],',
            '  async load(_input: unknown, context?: RuntimeSafetyQueryContext): Promise<{ ok: true }> {',
            '    const reader = context?.db;',
            "    if (!reader) throw new Error('readonly runtime choke probe requires context.db');",
            '    // SPEC §6.6/§10.3: this deliberate cast proves the runtime KV433 floor remains',
            '    // authoritative when paranoid mode makes the dedicated static KV433 finding advisory.',
            '    const db = reader as unknown as AppDb;',
            "    await db.insert(txProofs).values({ id: 'readonly-runtime-choke-must-not-write' });",
            '    return { ok: true };',
            '  },',
            '});',
            '',
          ]
        : []),
    ].join('\n'),
    'utf8',
  );

  const runtimeSafetyProofFormMutations = [
    'failAfterWrite',
    ...(includeManagedWriteEscapeAttempt ? ['managedWriteEscapeAttempt'] : []),
    ...(includeRawTableDrift ? ['rawTableDrift'] : []),
    ...(includeSqliteAuthorizerTriggerDrift ? ['sqliteAuthorizerTriggerDrift'] : []),
    'writeTxProof',
  ];
  const runtimeSafetyProofFormFields: Record<string, readonly string[]> = {
    failAfterWrite: ['id'],
    managedWriteEscapeAttempt: ['id'],
    rawTableDrift: ['id', 'label'],
    sqliteAuthorizerTriggerDrift: ['id', 'label'],
    writeTxProof: ['id'],
  };
  writeFileSync(
    join(root, 'src/runtime-safety-proof-forms.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      `import { ${runtimeSafetyProofFormMutations.join(', ')} } from './runtime-safety-proofs.js';`,
      '',
      'export const RuntimeSafetyProofForms = component({',
      `  mutations: { ${runtimeSafetyProofFormMutations.join(', ')} },`,
      '  render: () => (',
      '    <main data-proof="runtime-safety-forms">',
      ...runtimeSafetyProofFormMutations.flatMap((name) => [
        `      <form data-proof="${name}" mutation={${name}} enhance>`,
        ...(runtimeSafetyProofFormFields[name] ?? []).map(
          (field) => `        <input type="hidden" name="${field}" value="fixture" />`,
        ),
        '      </form>',
      ]),
      '    </main>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const runtimeSafetyImports = [
    'failAfterWrite',
    ...(includeManagedWriteEscapeAttempt ? ['managedWriteEscapeAttempt'] : []),
    ...(includeReadonlyMutationAttempt ? ['readonlyMutationAttemptEndpoint'] : []),
    ...(includeReadonlyRuntimeChokeProbe ? ['readonlyRuntimeChokeProbe'] : []),
    'rawRuntimeDriftCountEndpoint',
    ...(includeRawTableDrift ? ['rawTableDrift'] : []),
    ...(includeSqliteAuthorizerTriggerDrift ? ['sqliteAuthorizerSideEffectCountEndpoint'] : []),
    ...(includeSqliteAuthorizerTriggerDrift ? ['sqliteAuthorizerTriggerDrift'] : []),
    ...(includeWebhookTransactionProof ? ['txProofWebhook'] : []),
    ...(includeWebhookTxEscapeAttempt ? ['webhookTxEscapeAttempt'] : []),
    'txProofCountEndpoint',
    'writeTxProof',
  ];
  const runtimeSafetyEndpoints = [
    'healthEndpoint',
    'txProofCountEndpoint',
    'rawRuntimeDriftCountEndpoint',
    ...(includeSqliteAuthorizerTriggerDrift ? ['sqliteAuthorizerSideEffectCountEndpoint'] : []),
    ...(includeReadonlyMutationAttempt ? ['readonlyMutationAttemptEndpoint'] : []),
    ...(includeWebhookTransactionProof ? ['txProofWebhook'] : []),
    ...(includeWebhookTxEscapeAttempt ? ['webhookTxEscapeAttempt'] : []),
  ];
  const runtimeSafetyMutations = [
    'addContact',
    'failAfterWrite',
    ...(includeManagedWriteEscapeAttempt ? ['managedWriteEscapeAttempt'] : []),
    ...(includeRawTableDrift ? ['rawTableDrift'] : []),
    ...(includeSqliteAuthorizerTriggerDrift ? ['sqliteAuthorizerTriggerDrift'] : []),
    'writeTxProof',
    'appSignIn',
    'appSignOut',
  ];
  const runtimeSafetyQueries = [
    'contactsQuery',
    ...(includeReadonlyRuntimeChokeProbe ? ['readonlyRuntimeChokeProbe'] : []),
  ];

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      "import { ContactsRegion } from './components/contacts.js';",
      [
        "import { ContactsRegion } from './components/contacts.js';",
        "import { RuntimeSafetyProofForms } from './runtime-safety-proof-forms.js';",
      ].join('\n'),
    )
    .replace(
      "import { addContact } from './mutations.js';",
      [
        "import { addContact } from './mutations.js';",
        'import {',
        ...runtimeSafetyImports.map((name) => `  ${name},`),
        "} from './runtime-safety-proofs.js';",
      ].join('\n'),
    )
    .replace('endpoints: [healthEndpoint],', `endpoints: [${runtimeSafetyEndpoints.join(', ')}],`)
    .replace(
      'mutations: [addContact, appSignIn, appSignOut],',
      `mutations: [${runtimeSafetyMutations.join(', ')}],`,
    )
    .replace('queries: [contactsQuery],', `queries: [${runtimeSafetyQueries.join(', ')}],`)
    .replace(
      "  routes: [\n    route('/', {",
      [
        '  routes: [',
        "    route('/runtime-safety-proof-forms', {",
        "      access: publicAccess('public runtime safety CSRF regression proof'),",
        '      page() {',
        '        return <RuntimeSafetyProofForms />;',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

export function addInternalHtmlImportProof(root: string): void {
  writeFileSync(
    join(root, 'src/raw-helper.ts'),
    [
      "import type { RenderedHtml } from '@kovojs/server/internal/html';",
      '',
      'export type RawInternalHtmlProof = RenderedHtml;',
      "export const rawInternalHtmlProof = 'internal HTML import';",
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      "import { contactsQuery } from './queries.js';",
      [
        "import { contactsQuery } from './queries.js';",
        "import { rawInternalHtmlProof } from './raw-helper.js';",
      ].join('\n'),
    )
    .replace(
      '// Fail fast on schema/seed errors, then seed the local demo account when the',
      [
        'void rawInternalHtmlProof;',
        '',
        '// Fail fast on schema/seed errors, then seed the local demo account when the',
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

export function addTrustedOutputProvenanceBuildProof(
  root: string,
  options: { unsafe?: boolean } = {},
): void {
  const unsafe = options.unsafe ?? true;
  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    '/** @jsxImportSource @kovojs/server */\nimport {',
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { trustedHtml, trustedUrl } from '@kovojs/browser';",
      "import { component } from '@kovojs/core';",
      'import {',
    ].join('\n'),
    'trusted output proof imports',
  );
  app = replaceRequired(
    app,
    "import { contactsQuery } from './queries.js';",
    "import { contactsQuery, type ContactListResult } from './queries.js';",
    'trusted output proof query type import',
  );
  app = replaceRequired(
    app,
    ['function HomePage({ userName }: { userName: string }): string {', '  return ('].join('\n'),
    [
      'const TrustedOutputProvenanceProof = component({',
      '  queries: { contacts: contactsQuery },',
      '  render: (',
      '    data: { contacts: ContactListResult },',
      '    _state,',
      '    slots: { request?: AppRequest },',
      '  ) => (',
      '    <main data-proof="trusted-output-provenance">',
      unsafe
        ? '      <a href={trustedUrl(data.contacts.items.map((contact) => contact.email).join(""))}>'
        : '      <a href={trustedUrl(data.contacts.items.map((contact) => contact.email).join(""), "server-reviewed contact mailto route")}>',
      '        Unsafe URL',
      '      </a>',
      '      <section>static trusted output proof</section>',
      unsafe
        ? '      {trustedHtml(slots.request?.headers.get("x-proof") ?? "")}'
        : '      {trustedHtml(slots.request?.headers.get("x-proof") ?? "", "reviewed trusted output request header")}',
      '    </main>',
      '  ),',
      '});',
      '',
      'function HomePage({ userName }: { userName: string }): string {',
      '  return (',
    ].join('\n'),
    'trusted output proof component',
  );
  app = replaceRequired(
    app,
    "  routes: [\n    route('/', {",
    [
      '  routes: [',
      "    route('/trusted-output-provenance-proof', {",
      "      access: publicAccess('public trusted output provenance build proof'),",
      "      meta: { title: 'Trusted output provenance proof' },",
      '      layout: AppLayout,',
      '      stylesheets,',
      '      page() {',
      '        return <TrustedOutputProvenanceProof />;',
      '      },',
      '    }),',
      "    route('/', {",
    ].join('\n'),
    'trusted output proof route',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addOpaqueTrustedOutputAuthorityProof(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    '/** @jsxImportSource @kovojs/server */\nimport {',
    [
      '/** @jsxImportSource @kovojs/server */',
      "import * as browserTrust from '@kovojs/browser';",
      "import { trustedHtml } from '@kovojs/browser';",
      "import { component } from '@kovojs/core';",
      'import {',
    ].join('\n'),
    'opaque trusted output proof imports',
  );
  app = replaceRequired(
    app,
    "import { contactsQuery } from './queries.js';",
    "import { contactsQuery, type ContactListResult } from './queries.js';",
    'opaque trusted output proof query type import',
  );
  app = replaceRequired(
    app,
    ['function HomePage({ userName }: { userName: string }): string {', '  return ('].join('\n'),
    [
      "const dynamicTrustedUrlKey: 'trustedUrl' = 'trustedUrl';",
      "const dynamicTrustedHtmlKey: 'trustedHtml' = 'trustedHtml';",
      'const trustedOutputAlias = { html: trustedHtml };',
      '',
      'const OpaqueTrustedOutputAuthorityProof = component({',
      '  queries: { contacts: contactsQuery },',
      '  render: (',
      '    data: { contacts: ContactListResult },',
      '    _state,',
      '    slots: { request?: AppRequest },',
      '  ) => (',
      '    <main data-proof="opaque-trusted-output-authority">',
      '      <a href={browserTrust[dynamicTrustedUrlKey](data.contacts.items[0]?.email ?? "")}>',
      '        Dynamic trusted URL authority',
      '      </a>',
      '      {browserTrust[dynamicTrustedHtmlKey](slots.request?.headers.get("x-dynamic-proof") ?? "")}',
      '      {trustedOutputAlias.html(slots.request?.headers.get("x-object-proof") ?? "")}',
      '    </main>',
      '  ),',
      '});',
      '',
      'function HomePage({ userName }: { userName: string }): string {',
      '  return (',
    ].join('\n'),
    'opaque trusted output proof component',
  );
  app = replaceRequired(
    app,
    "  routes: [\n    route('/', {",
    [
      '  routes: [',
      "    route('/opaque-trusted-output-authority-proof', {",
      "      access: publicAccess('public opaque trusted output authority proof'),",
      "      meta: { title: 'Opaque trusted output authority proof' },",
      '      layout: AppLayout,',
      '      stylesheets,',
      '      page() {',
      '        return <OpaqueTrustedOutputAuthorityProof />;',
      '      },',
      '    }),',
      "    route('/', {",
    ].join('\n'),
    'opaque trusted output proof route',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addTrustedUrlAttributeTypeGateProof(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    '/** @jsxImportSource @kovojs/server */\nimport {',
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { trustedUrl } from '@kovojs/browser';",
      'import {',
    ].join('\n'),
    'trusted URL attribute type-gate import',
  );
  app = replaceRequired(
    app,
    '      <ContactsRegion />',
    [
      '      <span title={trustedUrl("/reviewed-non-url-attribute")}>type gate proof</span>',
      '      <ContactsRegion />',
    ].join('\n'),
    'trusted URL non-URL attribute proof',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addEscapedAttackerTextProof(root: string): void {
  writeFileSync(
    join(root, 'src/raw-helper.ts'),
    [
      'export function attackerMarkup(): string {',
      '  return \'<img src=x onerror="alert(1)"><b id="xss-probe">RAW</b>\';',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      "import { contactsQuery } from './queries.js';",
      [
        "import { contactsQuery } from './queries.js';",
        "import { attackerMarkup } from './raw-helper.js';",
      ].join('\n'),
    )
    .replace(
      "    route('/', {",
      [
        "    route('/xss-escape-proof', {",
        "      access: publicAccess('public output escaping regression proof'),",
        "      meta: { title: 'Output escaping proof' },",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      page() {',
        '        return <main data-proof="xss-escape">{attackerMarkup()}</main>;',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

export function addRuntimeContractProofs(root: string): void {
  writeFileSync(
    join(root, 'src/runtime-contract-proofs.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { domain, mutation, publicAccess, query, s } from '@kovojs/server';",
      '',
      "const publicProof = publicAccess('public runtime contract regression proof');",
      "const runtimeRows = domain('runtime-contract-proofs/rows');",
      '',
      'export const warningItemsQuery = query({',
      '  access: publicProof,',
      '  load: () => ({',
      '    rows: [0, 1, 2, 3].map((id) => ({ id, label: `item-${id}` })),',
      '  }),',
      '  reads: [runtimeRows],',
      '});',
      '',
      'export const refreshWarningItems = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
      "  csrfJustification: 'public refresh proof changes no server or browser state',",
      '  input: s.object({ reason: s.string() }),',
      '  registry: {',
      '    queries: [warningItemsQuery],',
      '    touches: [runtimeRows],',
      '  },',
      "  optimistic: { [warningItemsQuery.key]: 'await-fragment' },",
      '  handler(input: { reason: string }) {',
      '    return input;',
      '  },',
      '});',
      '',
      'export const acceptPngUpload = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
      "  csrfJustification: 'public MIME proof stores no state and uses no ambient authority',",
      "  input: s.object({ avatar: s.file().accept(['image/png']) }),",
      '  handler(input: { avatar: { name: string; type: string } }) {',
      '    return { name: input.avatar.name, type: input.avatar.type };',
      '  },',
      '});',
      '',
      'export const syncVerifiedFileParseQuery = query({',
      '  access: publicProof,',
      '  load: () => {',
      '    const file = {',
      "      name: 'avatar.png',",
      '      size: 11,',
      "      type: 'image/png',",
      '      async arrayBuffer() {',
      '        return new Uint8Array([',
      '          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,',
      '        ]).buffer;',
      '      },',
      '    };',
      '    try {',
      "      s.file().accept(['image/png']).parse(file);",
      "      return { ok: false, message: 'sync parse unexpectedly trusted client MIME' };",
      '    } catch {',
      "      return { ok: true, message: 'verified file type checks require async parsing; call parseAsync' };",
      '    }',
      '  },',
      '  reads: [],',
      '});',
      '',
      'export const RuntimeContractsProof = component({',
      '  queries: { warningItems: warningItemsQuery },',
      '  render: ({ warningItems }) => {',
      '    const rows = warningItems.rows as { id: number; label: string }[];',
      '    return (',
      '      <main data-proof="runtime-contracts">',
      '        <p data-warning-count={String(rows.length)}>{rows.map((row) => row.label).join(",")}</p>',
      '      </main>',
      '    );',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'src/mutations.ts'),
    [
      "import { mutation, publicAccess, s } from '@kovojs/server';",
      "import { contact } from './model.js';",
      "import { contactsQuery } from './queries.js';",
      '',
      "const publicProof = publicAccess('unused runtime contract fixture mutation');",
      '',
      'export interface AddContactInput {',
      '  company: string;',
      '  email: string;',
      '  name: string;',
      '}',
      '',
      'export const addContact = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
      "  csrfJustification: 'public contract fixture uses no session or cookie authority',",
      '  input: s.object({',
      '    name: s.string(),',
      '    email: s.string(),',
      '    company: s.string(),',
      '  }),',
      "  optimistic: { [contactsQuery.key]: 'await-fragment' },",
      '  registry: { touches: [contact] },',
      '  handler(input: AddContactInput) {',
      '    return { id: input.email };',
      '  },',
      '});',
      '',
      'export const appMutations = [addContact];',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace("import { ContactsRegion } from './components/contacts.js';\n", '')
    .replace(
      "import { addContact } from './mutations.js';",
      [
        "import { addContact } from './mutations.js';",
        'import {',
        '  acceptPngUpload,',
        '  refreshWarningItems,',
        '  RuntimeContractsProof,',
        '  syncVerifiedFileParseQuery,',
        '  warningItemsQuery,',
        "} from './runtime-contract-proofs.js';",
      ].join('\n'),
    )
    .replace(
      '  mutationReplayStore,',
      '  mutationReplayStore,\n  requestLimits: { maxQueryListItems: 2 },',
    )
    .replace(
      '  mutations: [addContact, appSignIn, appSignOut],',
      '  mutations: [addContact, acceptPngUpload, refreshWarningItems, appSignIn, appSignOut],',
    )
    .replace('      <ContactsRegion />', '      <main data-proof="runtime-contracts-home" />')
    .replace(
      '  queries: [contactsQuery],',
      '  queries: [contactsQuery, syncVerifiedFileParseQuery, warningItemsQuery],',
    )
    .replace(
      "  routes: [\n    route('/', {",
      [
        '  routes: [',
        "    route('/runtime-contracts-proof', {",
        "      access: publicAccess('public runtime contract regression proof'),",
        "      meta: { title: 'Runtime contract proof' },",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      page() {',
        '        return <RuntimeContractsProof />;',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

export function addAuthSecretLeakProof(root: string, options: { leakToWire?: boolean } = {}): void {
  const leakToWire = options.leakToWire ?? true;
  const queryNames = leakToWire
    ? ['authSecretDirectLeakQuery', 'authSecretTransformedLeakQuery', 'authSecretRenderLeakQuery']
    : ['authSecretLeakQuery'];
  const queryProps = queryNames.map((_name, index) => `secrets${index}`);
  const queryInsertionAnchor = 'export const contactsQuery = query({';
  const querySource = (
    name: string,
    rowType: 'AuthSecretLeakRow' | 'AuthSecretRenderLeakRow' | 'AuthSecretSafeRow',
  ): string => {
    const body =
      rowType === 'AuthSecretSafeRow'
        ? [
            '    const items = await db',
            '      .select({ id: authSecretWireProof.id })',
            '      .from(authSecretWireProof);',
          ]
        : name === 'authSecretTransformedLeakQuery'
          ? [
              '    const wrapCredential = (value: string | null) => value;',
              '    const [secretRow] = await db',
              '      .select({',
              '        accessToken: authSecretWireProof.accessToken,',
              '        id: authSecretWireProof.id,',
              '        password: authSecretWireProof.password,',
              '      })',
              '      .from(authSecretWireProof)',
              '      .limit(1);',
              '    const items: AuthSecretLeakRow[] = secretRow',
              '      ? [',
              '          {',
              '            accessToken: wrapCredential(secretRow.accessToken),',
              '            id: secretRow.id,',
              '            password: wrapCredential(secretRow.password),',
              '          },',
              '        ]',
              '      : [];',
            ]
          : name === 'authSecretRenderLeakQuery'
            ? [
                '    const items = await db',
                '      .select({',
                '        id: authSecretWireProof.id,',
                '        renderPassword: authSecretWireProof.password,',
                '      })',
                '      .from(authSecretWireProof);',
              ]
            : [
                '    const items = await db',
                '      .select({',
                '        accessToken: authSecretWireProof.accessToken,',
                '        id: authSecretWireProof.id,',
                '        password: authSecretWireProof.password,',
                '      })',
                '      .from(authSecretWireProof);',
              ];

    return [
      `export const ${name} = query({`,
      '  access: [appAuthed],',
      "  reads: [domain('auth-secret-wire-proof')],",
      `  async load(_input: unknown, context?: AppQueryLoadContext): Promise<{ readonly [key: string]: JsonValue; items: ${rowType}[] }> {`,
      '    const db: Reader<AppDb> | undefined = context?.db;',
      `    if (!db) throw new Error('${name} requires the framework-provided context.db');`,
      ...body,
      '    return { items };',
      '  },',
      '});',
    ].join('\n');
  };

  const querySpecs = [
    {
      name: 'authSecretDirectLeakQuery',
      rowType: 'AuthSecretLeakRow' as const,
    },
    {
      name: 'authSecretTransformedLeakQuery',
      rowType: 'AuthSecretLeakRow' as const,
    },
    {
      name: 'authSecretRenderLeakQuery',
      rowType: 'AuthSecretRenderLeakRow' as const,
    },
    {
      name: 'authSecretLeakQuery',
      rowType: leakToWire ? ('AuthSecretLeakRow' as const) : ('AuthSecretSafeRow' as const),
    },
  ].filter((spec) => queryNames.includes(spec.name));

  const queriesPath = join(root, 'src/queries.ts');
  const schemaPath = join(root, 'src/schema.ts');
  let schema = readFileSync(schemaPath, 'utf8');
  const tableFactory = schema.includes('sqliteTable(') ? 'sqliteTable' : 'pgTable';
  schema = replaceRequired(
    schema,
    '// --- Auth infrastructure -------------------------------------------------------',
    [
      '// Credential-shaped secret table used only by the production wire proof. Keeping it out of',
      "// Better Auth's retained authSchema aggregate isolates KV435 from the aggregate's KV424",
      '// fail-closed authority posture.',
      `export const authSecretWireProof = ${tableFactory}(`,
      "  'auth_secret_wire_proof',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    accessToken: text('accessToken'),",
      "    password: text('password'),",
      '  },',
      '  kovo({',
      tableFactory === 'sqliteTable'
        ? "    authzPolicy: 'build-only credential wire proof is guarded by the query access decision',"
        : '    authzPolicy: sql`TRUE`,',
      "    domain: 'auth-secret-wire-proof',",
      "    key: 'id',",
      '    readOnly: true,',
      "    secret: ['accessToken', 'password'],",
      '  }),',
      ');',
      '',
      '// --- Auth infrastructure -------------------------------------------------------',
    ].join('\n'),
    'auth secret wire proof schema',
  );
  writeFileSync(schemaPath, schema, 'utf8');

  let queries = readFileSync(queriesPath, 'utf8');
  queries = replaceRequired(
    queries,
    "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    "import { domain, query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    'auth secret proof imports',
  );
  queries = replaceRequired(
    queries,
    "import { contacts } from './schema.js';",
    "import { authSecretWireProof, contacts } from './schema.js';",
    'auth secret proof schema import',
  );
  queries = replaceRequired(
    queries,
    queryInsertionAnchor,
    [
      'export interface AuthSecretLeakRow {',
      '  readonly [key: string]: JsonValue;',
      '  accessToken: string | null;',
      '  id: string;',
      '  password: string | null;',
      '}',
      '',
      'export interface AuthSecretRenderLeakRow {',
      '  readonly [key: string]: JsonValue;',
      '  id: string;',
      '  renderPassword: string | null;',
      '}',
      '',
      'export interface AuthSecretSafeRow {',
      '  readonly [key: string]: JsonValue;',
      '  id: string;',
      '}',
      '',
      ...querySpecs.flatMap((spec) => [querySource(spec.name, spec.rowType), '']),
      queryInsertionAnchor,
    ].join('\n'),
    'auth secret proof query insertion',
  );
  writeFileSync(queriesPath, queries, 'utf8');

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    '/** @jsxImportSource @kovojs/server */',
    ['/** @jsxImportSource @kovojs/server */', "import { component } from '@kovojs/core';"].join(
      '\n',
    ),
    'auth secret proof component import',
  );
  app = replaceRequired(
    app,
    "import { contactsQuery } from './queries.js';",
    `import { contactsQuery, ${queryNames.join(', ')} } from './queries.js';`,
    'auth secret proof query import',
  );
  app = replaceRequired(
    app,
    'function HomePage({ userName }: { userName: string }): string {',
    [
      'export const AuthSecretLeakProof = component({',
      `  queries: { ${queryNames.map((name, index) => `${queryProps[index]}: ${name}`).join(', ')} },`,
      '  render(data) {',
      leakToWire
        ? "    const renderValue = data.secrets2.items[0]?.renderPassword ?? 'redacted';"
        : "    const renderValue = data.secrets0.items[0]?.id ?? 'redacted';",
      '    return <main data-proof="auth-secret-wire">{renderValue}</main>;',
      '  },',
      '});',
      '',
      'function HomePage({ userName }: { userName: string }): string {',
    ].join('\n'),
    'auth secret proof component',
  );
  app = replaceRequired(
    app,
    '      <ContactsRegion />',
    ['      <ContactsRegion />', '      <AuthSecretLeakProof />'].join('\n'),
    'auth secret proof render',
  );
  app = replaceRequired(
    app,
    '  queries: [contactsQuery],',
    `  queries: [contactsQuery, ${queryNames.join(', ')}],`,
    'auth secret proof query registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addOpaqueAuthSecretLeakProof(
  root: string,
  options: { leakToWire?: boolean } = {},
): void {
  const leakToWire = options.leakToWire ?? true;
  const unsafeQueryNames = [
    'authSecretDirectLeakQuery',
    'authSecretTransformedLeakQuery',
    'authSecretRenderLeakQuery',
    'authSecretLeakQuery',
  ];
  const appQueryNames = leakToWire ? unsafeQueryNames : ['authSecretLeakQuery'];
  const appQueryProps = appQueryNames.map((_name, index) => `secrets${index}`);
  const queriesPath = join(root, 'src/queries.ts');
  let queries = readFileSync(queriesPath, 'utf8');
  queries = replaceRequired(
    queries,
    "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    [
      "import { domain, query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
      "import { eq } from 'drizzle-orm';",
    ].join('\n'),
    'auth secret proof server imports',
  );
  queries = replaceRequired(
    queries,
    "import { contacts } from './schema.js';",
    "import { account, contacts } from './schema.js';",
    'auth secret proof schema imports',
  );
  queries = replaceRequired(
    queries,
    'export interface ContactListResult {\n  readonly [key: string]: JsonValue;\n  items: ContactRow[];\n}',
    [
      'export interface ContactListResult {',
      '  readonly [key: string]: JsonValue;',
      '  items: ContactRow[];',
      '}',
      '',
      'export interface AuthSecretLeakResult {',
      '  readonly [key: string]: JsonValue;',
      '  items: {',
      '    readonly [key: string]: JsonValue;',
      '    accessToken: string | null;',
      '    id: string;',
      '    password: string | null;',
      '  }[];',
      '}',
    ].join('\n'),
    'auth secret proof result type',
  );
  const queryInsertionAnchor = 'export const contactsQuery = query({';
  queries = replaceRequired(
    queries,
    queryInsertionAnchor,
    [
      ...(leakToWire
        ? [
            'export const authSecretDirectLeakQuery = query({',
            '  access: [appAuthed],',
            "  reads: [domain('auth')],",
            '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
            '    const db: Reader<AppDb> | undefined = context?.db;',
            '    if (!db) throw new Error("query requires framework-provided context.db");',
            "    if (!context?.request.session?.user.id) throw new Error('auth required');",
            '    const items = await db',
            '      .select({',
            '        accessToken: account.accessToken,',
            '        id: account.id,',
            '        password: account.password,',
            '      })',
            '      .from(account)',
            '      .where(eq(account.userId, context.request.session.user.id));',
            '    return { items };',
            '  },',
            '});',
            '',
            'export const authSecretTransformedLeakQuery = query({',
            '  access: [appAuthed],',
            "  reads: [domain('auth')],",
            '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
            '    const db: Reader<AppDb> | undefined = context?.db;',
            '    if (!db) throw new Error("query requires framework-provided context.db");',
            "    if (!context?.request.session?.user.id) throw new Error('auth required');",
            '    const wrapCredential = (value: string | null) => value;',
            '    const items = (await db',
            '      .select({',
            '        accessToken: account.accessToken,',
            '        id: account.id,',
            '        password: account.password,',
            '      })',
            '      .from(account)',
            '      .where(eq(account.userId, context.request.session.user.id))).map((secretRow) => ({',
            '        accessToken: JSON.stringify({ value: `${wrapCredential(secretRow.accessToken) ?? ""}` }),',
            '        id: secretRow.id,',
            '        password: wrapCredential(secretRow.password),',
            '      }));',
            '    return { items };',
            '  },',
            '});',
            '',
            'export const authSecretRenderLeakQuery = query({',
            '  access: [appAuthed],',
            "  reads: [domain('auth')],",
            '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
            '    const db: Reader<AppDb> | undefined = context?.db;',
            '    if (!db) throw new Error("query requires framework-provided context.db");',
            "    if (!context?.request.session?.user.id) throw new Error('auth required');",
            '    const items = (await db',
            '      .select({',
            '        id: account.id,',
            '        renderPassword: account.password,',
            '      })',
            '      .from(account)',
            '      .where(eq(account.userId, context.request.session.user.id))).map((secretRow) => ({',
            '        accessToken: null,',
            '        id: secretRow.id,',
            '        password: secretRow.renderPassword,',
            '      }));',
            '    return { items };',
            '  },',
            '});',
            '',
          ]
        : []),
      'export const authSecretLeakQuery = query({',
      '  access: [appAuthed],',
      "  reads: [domain('auth')],",
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      "    if (!context?.request.session?.user.id) throw new Error('auth required');",
      '    const items = (await db',
      '      .select({',
      '        id: account.id,',
      '      })',
      '      .from(account)',
      '      .where(eq(account.userId, context.request.session.user.id))',
      '      .limit(1)).map((row): { accessToken: string | null; id: string; password: string | null } => ({',
      '        ...row,',
      '        accessToken: null,',
      '        password: null,',
      '      }));',
      '    const wrapCredential = (value: string | null) => value;',
      '    const secretRows = await db',
      '      .select({',
      '        id: account.id,',
      ...(leakToWire
        ? ['        accessToken: account.accessToken,', '        password: account.password,']
        : []),
      '      })',
      '      .from(account)',
      '      .where(eq(account.userId, context.request.session.user.id));',
      leakToWire
        ? [
            '    const secretById = new Map<string, { accessToken: string | null; password: string | null }>();',
            '    function rememberCredentials(',
            '      rows: Array<{ accessToken: string | null; id: string; password: string | null }>,',
            '    ) {',
            '      rows.forEach((secretRow) => {',
            '        secretById.set(secretRow.id, {',
            '          accessToken: JSON.stringify({ value: `${wrapCredential(secretRow.accessToken) ?? ""}` }),',
            '          password: wrapCredential(secretRow.password),',
            '        });',
            '      });',
            '    }',
            '    rememberCredentials(secretRows);',
          ].join('\n')
        : [
            '    const serverOnlyCredentialCount = secretRows.length;',
            '    if (serverOnlyCredentialCount > 10) await Promise.resolve(wrapCredential(String(serverOnlyCredentialCount)));',
          ].join('\n'),
      '    return {',
      leakToWire
        ? [
            '      items: items.map((item) => ({',
            '        ...item,',
            '        ...(secretById.get(item.id) ?? {}),',
            '      })),',
          ].join('\n')
        : '      items,',
      '    };',
      '  },',
      '});',
      '',
      queryInsertionAnchor,
    ].join('\n'),
    'auth secret proof query insertion',
  );
  writeFileSync(queriesPath, queries, 'utf8');

  writeFileSync(
    join(root, 'src/app.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { createApp, createRequestHandler, domain, mutation, publicAccess, route, s, type RequestHandler } from '@kovojs/server';",
      '',
      "import { appSessionProvider } from './auth.js';",
      "import { appRuntimeDbProvider, appRuntimeDbReady } from './_kovo/app-runtime-db.js';",
      `import { ${appQueryNames.join(', ')} } from './queries.js';`,
      '',
      'await appRuntimeDbReady;',
      "const authDomain = domain('auth');",
      'const touchAuth = mutation({',
      "  access: publicAccess('build-only auth touch graph proof'),",
      '  csrf: false,',
      "  csrfJustification: 'public build-only proof uses no session or cookie authority',",
      '  input: s.object({}),',
      `  optimistic: { ${appQueryNames.map((name) => `[${name}.key]: 'await-fragment'`).join(', ')} },`,
      '  registry: { touches: [authDomain] },',
      '  handler() {',
      "    return { status: 'ok' };",
      '  },',
      '});',
      "touchAuth.key = 'auth/secret-touch';",
      '',
      'export const AuthSecretLeakProof = component({',
      `  queries: { ${appQueryNames.map((name, index) => `${appQueryProps[index]}: ${name}`).join(', ')} },`,
      `  render(_props: { ${appQueryProps.map((name) => `${name}: { items: { accessToken: string | null; id: string; password: string | null }[] }`).join('; ')} }) {`,
      `    const renderValueFlowNeedle = _props.${appQueryProps[Math.min(2, appQueryProps.length - 1)]}.items[0]?.password ?? 'redacted';`,
      '    return <main>{renderValueFlowNeedle}</main>;',
      '  },',
      '});',
      '',
      'const app = createApp({',
      '  db: appRuntimeDbProvider,',
      '  mutations: [touchAuth],',
      `  queries: [${appQueryNames.join(', ')}],`,
      '  sessionProvider: appSessionProvider,',
      '  routes: [',
      "    route('/', {",
      "      access: publicAccess('public auth secret build proof'),",
      '      page: () => <AuthSecretLeakProof />,',
      '    }),',
      '  ],',
      '});',
      '',
      'export const requestHandler: RequestHandler = createRequestHandler(app);',
      'export default app;',
      '',
    ].join('\n'),
    'utf8',
  );
}

export function addSecretViewEgressProof(root: string): void {
  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db-options.ts');
  const runtimeDb = replaceRequired(
    readFileSync(runtimeDbPath, 'utf8'),
    'export const appRuntimeDbOptions = postgresAppRuntimeOptions({',
    [
      'const SECRET_VIEW_EGRESS_SEED = [',
      '  \'CREATE OR REPLACE VIEW "account_secret_view" WITH (security_invoker=true) AS SELECT id, "userId", password FROM "account";\',',
      '  \'GRANT SELECT ON "account_secret_view" TO "kovo_reader";\',',
      '];',
      '',
      'export const appRuntimeDbOptions = postgresAppRuntimeOptions({',
    ].join('\n'),
    'secret view proof runtime view DDL',
  );
  writeFileSync(
    runtimeDbPath,
    replaceRequired(
      runtimeDb,
      '  seedSql: SEED_CONTACTS,',
      '  seedSql: [SEED_CONTACTS, ...SECRET_VIEW_EGRESS_SEED],',
      'secret view proof runtime seed registration',
    ),
    'utf8',
  );

  const queriesPath = join(root, 'src/queries.ts');
  let queries = readFileSync(queriesPath, 'utf8');
  queries = replaceRequired(
    queries,
    "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    [
      "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
      "import { pgView } from 'drizzle-orm/pg-core';",
    ].join('\n'),
    'secret view proof imports',
  );
  queries = replaceRequired(
    queries,
    "import { contacts } from './schema.js';",
    [
      "import { account, contacts } from './schema.js';",
      "import { readonlyAppDb } from './db.js';",
    ].join('\n'),
    'secret view proof imports',
  );
  queries = replaceRequired(
    queries,
    'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
    [
      'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
      '',
      'export const accountSecretView = pgView("account_secret_view").as((qb) =>',
      '  qb',
      '    .select({',
      '      id: account.id,',
      '      token: account.password,',
      '      userId: account.userId,',
      '    })',
      '    .from(account),',
      ');',
      '',
      'export interface SecretViewEgressRow {',
      '  readonly [key: string]: JsonValue;',
      '  id: string | null;',
      '  token: string | null;',
      '}',
      '',
      'export interface SecretViewEgressResult {',
      '  readonly [key: string]: JsonValue;',
      '  items: SecretViewEgressRow[];',
      '}',
      '',
      'export const secretViewEgressQuery = query({',
      '  access: [appAuthed],',
      '  reads: [],',
      '  async load(): Promise<SecretViewEgressResult> {',
      '    const db = readonlyAppDb as unknown as { select: typeof readonlyAppDb.select };',
      '    const items = await db',
      '      .select({',
      '        id: accountSecretView.id,',
      '        token: accountSecretView.token,',
      '      })',
      '      .from(accountSecretView);',
      '    return { items };',
      '  },',
      '});',
      "(secretViewEgressQuery as { key: string }).key = 'secret-view-egress';",
    ].join('\n'),
    'secret view proof query',
  );
  writeFileSync(queriesPath, queries, 'utf8');

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { contactsQuery } from './queries.js';",
    "import { contactsQuery, secretViewEgressQuery } from './queries.js';",
    'secret view proof app import',
  );
  app = replaceRequired(
    app,
    '  queries: [contactsQuery],',
    '  queries: [contactsQuery, secretViewEgressQuery],',
    'secret view proof app registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addRuntimeSecretBoundaryProof(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  const schemaSource = readFileSync(schemaPath, 'utf8');
  const withRuntimeSecretTable = replaceRequired(
    schemaSource,
    "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    [
      'export const runtimeSecretProof = pgTable(',
      "  'runtime_secret_proof',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    label: text('label').notNull(),",
      "    classified: text('classified').notNull(),",
      '  },',
      '  kovo({',
      '    authzPolicy: sql`TRUE`,',
      "    domain: 'runtime-secret-proof',",
      "    key: 'id',",
      '    readOnly: true,',
      "    secret: ['classified'],",
      '  }),',
      ');',
      '',
      'export const runtimeSecretFunctionProof = pgTable(',
      "  'runtime_secret_function_proof',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    functionClassified: text('function_classified').notNull(),",
      "    label: text('label').notNull(),",
      '  },',
      '  kovo({',
      '    authzPolicy: sql`TRUE`,',
      "    domain: 'runtime-secret-function-proof',",
      "    key: 'id',",
      '    readOnly: true,',
      '    secret: [(table) => table.functionClassified],',
      '  }),',
      ');',
      '',
      'export const runtimeSecretWholeProof = pgTable(',
      "  'runtime_secret_whole_proof',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    label: text('label').notNull(),",
      '  },',
      '  kovo({',
      '    authzPolicy: sql`TRUE`,',
      "    domain: 'runtime-secret-whole-proof',",
      "    key: 'id',",
      '    readOnly: true,',
      '    secret: true,',
      '  }),',
      ');',
      '',
      "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    ].join('\n'),
    'runtime secret proof schema table',
  );
  writeFileSync(schemaPath, withRuntimeSecretTable, 'utf8');

  const migrationsPath = join(root, 'migrations');
  mkdirSync(migrationsPath, { recursive: true });
  writeFileSync(
    join(migrationsPath, '001_runtime_secret_boundary.sql'),
    [
      "INSERT INTO runtime_secret_proof (id, label, classified) VALUES ('s1', 'public label', 'runtime-secret-value') ON CONFLICT (id) DO NOTHING;",
      "INSERT INTO runtime_secret_function_proof (id, function_classified, label) VALUES ('sf1', 'runtime-function-secret-value', 'public function label') ON CONFLICT (id) DO NOTHING;",
      "INSERT INTO runtime_secret_whole_proof (id, label) VALUES ('sw1', 'runtime-whole-secret-value') ON CONFLICT (id) DO NOTHING;",
      'DROP VIEW IF EXISTS runtime_secret_proof_view;',
      'CREATE VIEW runtime_secret_proof_view WITH (security_invoker=true) AS SELECT id, classified AS leaked FROM runtime_secret_proof;',
    ].join('\n'),
    'utf8',
  );

  const queriesPath = join(root, 'src/queries.ts');
  let queries = readFileSync(queriesPath, 'utf8');
  queries = replaceRequired(
    queries,
    "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    [
      "import { secret, trustedReveal } from '@kovojs/core';",
      "import { sql, trustedSql } from '@kovojs/drizzle';",
      "import { sql as drizzleSql } from 'drizzle-orm';",
      "import { domain, query, s, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    ].join('\n'),
    'runtime secret proof query imports',
  );
  queries = replaceRequired(
    queries,
    "import { contacts } from './schema.js';",
    "import { contacts, runtimeSecretFunctionProof, runtimeSecretProof, runtimeSecretWholeProof } from './schema.js';",
    'runtime secret proof schema import',
  );
  queries = replaceRequired(
    queries,
    'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
    [
      'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
      '',
      'export interface RuntimeSecretBoundaryRow {',
      '  readonly [key: string]: JsonValue;',
      '  id: string;',
      '  label?: string;',
      '  leaked?: string;',
      '}',
      '',
      'export interface RuntimeSecretBoundaryResult {',
      '  readonly [key: string]: JsonValue;',
      '  items: RuntimeSecretBoundaryRow[];',
      '}',
      '',
      'export interface RuntimeSecretRevealRow {',
      '  readonly [key: string]: JsonValue;',
      '  id: string;',
      '  reviewed: string;',
      '}',
      '',
      'export interface RuntimeSecretRevealResult {',
      '  readonly [key: string]: JsonValue;',
      '  items: RuntimeSecretRevealRow[];',
      '}',
      '',
      'const runtimeSecretBoundaryRowSchema = s.object({',
      '  id: s.string(),',
      '  label: s.string().optional(),',
      '  leaked: s.string().optional(),',
      '});',
      'const runtimeSecretRevealOutput = s.object({',
      '  items: s.array(s.object({',
      '    id: s.string(),',
      '    reviewed: s.string(),',
      '  })),',
      '});',
      "const runtimeSecretProofDomain = domain('runtime-secret-proof');",
      "const runtimeSecretFunctionProofDomain = domain('runtime-secret-function-proof');",
      "const runtimeSecretWholeProofDomain = domain('runtime-secret-whole-proof');",
      '',
      'export const runtimeSecretColumnEngineDenialQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(runtimeSecretBoundaryRowSchema) }),',
      '  reads: [runtimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const items = await db',
      '      .select({ id: runtimeSecretProof.id, leaked: runtimeSecretProof.classified })',
      '      .from(runtimeSecretProof);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const runtimeSecretFunctionEngineDenialQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(runtimeSecretBoundaryRowSchema) }),',
      '  reads: [runtimeSecretFunctionProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const items = await db',
      '      .select({',
      '        id: runtimeSecretFunctionProof.id,',
      '        label: runtimeSecretFunctionProof.label,',
      '        leaked: runtimeSecretFunctionProof.functionClassified,',
      '      })',
      '      .from(runtimeSecretFunctionProof);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const runtimeSecretWholeTableEngineDenialQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(runtimeSecretBoundaryRowSchema) }),',
      '  reads: [runtimeSecretWholeProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const items = await db',
      '      .select({ id: runtimeSecretWholeProof.id, label: runtimeSecretWholeProof.label })',
      '      .from(runtimeSecretWholeProof);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const runtimeSecretComputedEngineDenialQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(runtimeSecretBoundaryRowSchema) }),',
      '  reads: [runtimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const items = await db',
      '      .select({',
      '        id: runtimeSecretProof.id,',
      '        leaked: drizzleSql<string>`upper(${runtimeSecretProof.classified})`,',
      '      })',
      '      .from(runtimeSecretProof);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const runtimeSecretRawEngineDenialQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(runtimeSecretBoundaryRowSchema) }),',
      '  reads: [runtimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    await db.rawRead(',
      '      trustedSql(',
      '        sql.raw<RuntimeSecretBoundaryResult["items"][number]>(',
      '          \'select id, classified as leaked from "runtime_secret_proof"\',',
      '        ),',
      "        { justification: 'executable raw secret-column engine-denial proof' },",
      '      ),',
      '      { reads: ["runtime_secret_proof"] },',
      '    );',
      "    return { items: [{ id: 'raw-secret-engine-denial', label: 'not-blocked' }] };",
      '  },',
      '});',
      '',
      'export const runtimeSecretOpaqueRawEngineDenialQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(runtimeSecretBoundaryRowSchema) }),',
      '  reads: [runtimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    await db.rawRead(',
      '      trustedSql(',
      '        sql.raw<RuntimeSecretBoundaryResult["items"][number]>(',
      '          \'select id, upper(classified) as leaked from "runtime_secret_proof"\',',
      '        ),',
      "        { justification: 'executable opaque raw expression engine-denial proof' },",
      '      ),',
      '      { reads: ["runtime_secret_proof"] },',
      '    );',
      "    return { items: [{ id: 'opaque-raw-secret-engine-denial', label: 'not-blocked' }] };",
      '  },',
      '});',
      '',
      'export const runtimeSecretViewEngineDenialQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(runtimeSecretBoundaryRowSchema) }),',
      '  reads: [runtimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    await db.rawRead(',
      '      trustedSql(',
      '        sql.raw<RuntimeSecretBoundaryResult["items"][number]>(',
      '          \'select id, leaked from "runtime_secret_proof_view"\',',
      '        ),',
      "        { justification: 'existing runtime secret view engine-denial proof' },",
      '      ),',
      '      { reads: ["runtime_secret_proof_view"] },',
      '    );',
      "    return { items: [{ id: 'view-secret-engine-denial', label: 'not-blocked' }] };",
      '  },',
      '});',
      '',
      'export const runtimeSecretReaderRoleProofQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(s.object({ id: s.string(), label: s.string() })) }),',
      '  reads: [runtimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const items = await db.rawRead<{ id: string; label: string }>(',
      '      trustedSql(',
      "        sql.raw('select id, current_user as label from runtime_secret_proof limit 1'),",
      "        { justification: 'PGlite current_user reader-role proof' },",
      '      ),',
      "      { reads: ['runtime_secret_proof'] },",
      '    );',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const runtimeSecretDefaultRawPublicQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(runtimeSecretBoundaryRowSchema) }),',
      '  reads: [runtimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<RuntimeSecretBoundaryResult> {',
      '    const db = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const items = await db.rawRead<RuntimeSecretBoundaryResult["items"][number]>(',
      '      trustedSql(',
      "        sql.raw('select id, label from runtime_secret_proof order by id'),",
      "        { justification: 'default reader raw public-column negative control' },",
      '      ),',
      "      { reads: ['runtime_secret_proof'] },",
      '    );',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const runtimeSecretExplicitBoxEgressQuery = query({',
      '  access: [appAuthed],',
      '  reads: [],',
      '  async load(): Promise<RuntimeSecretBoundaryResult> {',
      "    const boxed = secret('runtime-secret-value');",
      "    return { items: [{ id: 'runtime-secret-box', leaked: boxed as unknown as string }] };",
      '  },',
      '});',
      '',
      'export const runtimeSecretRevealAcceptanceQuery = query({',
      '  access: [appAuthed],',
      '  output: runtimeSecretRevealOutput,',
      '  reads: [],',
      '  async load(_input: unknown, _context?: AppQueryLoadContext): Promise<RuntimeSecretRevealResult> {',
      "    const reviewed = trustedReveal(secret('runtime-secret-value'), {",
      "      justification: 'audited runtime query-wire reveal acceptance proof',",
      "      method: 'arbitrary-fn',",
      "      source: 'runtime fixture secret box',",
      '    });',
      "    return { items: [{ id: 'runtime-secret-reveal', reviewed }] };",
      '  },',
      '});',
    ].join('\n'),
    'runtime secret proof queries',
  );
  writeFileSync(queriesPath, queries, 'utf8');

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    '  stylesheet,',
    ['  s,', '  stylesheet,'].join('\n'),
    'runtime config secret proof app schema import',
  );
  app = replaceRequired(
    app,
    "import { contactsQuery } from './queries.js';",
    "import { contactsQuery, runtimeSecretColumnEngineDenialQuery, runtimeSecretComputedEngineDenialQuery, runtimeSecretDefaultRawPublicQuery, runtimeSecretExplicitBoxEgressQuery, runtimeSecretFunctionEngineDenialQuery, runtimeSecretOpaqueRawEngineDenialQuery, runtimeSecretRawEngineDenialQuery, runtimeSecretReaderRoleProofQuery, runtimeSecretRevealAcceptanceQuery, runtimeSecretViewEngineDenialQuery, runtimeSecretWholeTableEngineDenialQuery } from './queries.js';",
    'runtime secret proof app import',
  );
  app = replaceRequired(
    app,
    "  document: { lang: 'en' },",
    [
      "  document: { lang: 'en' },",
      '  env: s.object({ KOVO_CONFIG_SECRET_PROOF: s.secret(s.string()) }),',
    ].join('\n'),
    'runtime config secret proof app env',
  );
  app = replaceRequired(
    app,
    '  queries: [contactsQuery],',
    '  queries: [contactsQuery, runtimeSecretColumnEngineDenialQuery, runtimeSecretComputedEngineDenialQuery, runtimeSecretDefaultRawPublicQuery, runtimeSecretExplicitBoxEgressQuery, runtimeSecretFunctionEngineDenialQuery, runtimeSecretOpaqueRawEngineDenialQuery, runtimeSecretRawEngineDenialQuery, runtimeSecretReaderRoleProofQuery, runtimeSecretRevealAcceptanceQuery, runtimeSecretViewEngineDenialQuery, runtimeSecretWholeTableEngineDenialQuery],',
    'runtime secret proof app registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addSqliteRuntimeSecretProvenanceProof(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  const schemaSource = readFileSync(schemaPath, 'utf8');
  const withRuntimeSecretTable = replaceRequired(
    schemaSource,
    "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    [
      'export const runtimeSecretProof = sqliteTable(',
      "  'runtime_secret_proof',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    label: text('label').notNull(),",
      "    classified: text('classified').notNull(),",
      '  },',
      '  kovo({',
      "    authzPolicy: 'runtime secret proof rows are fixture-controlled regression evidence',",
      "    domain: 'runtime-secret-proof',",
      "    key: 'id',",
      '    readOnly: true,',
      "    secret: ['classified'],",
      '  }),',
      ');',
      '',
      'export const runtimeSecretJoinProof = sqliteTable(',
      "  'runtime_secret_join_proof',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    proofId: text('proof_id').notNull(),",
      "    label: text('label').notNull(),",
      '  },',
      '  kovo({',
      "    authzPolicy: 'runtime secret join proof rows are fixture-controlled regression evidence',",
      "    domain: 'runtime-secret-join-proof',",
      "    key: 'id',",
      '    readOnly: true,',
      '  }),',
      ');',
      '',
      "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    ].join('\n'),
    'sqlite runtime secret provenance schema table',
  );
  writeFileSync(schemaPath, withRuntimeSecretTable, 'utf8');

  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db.ts');
  let runtimeDb = readFileSync(runtimeDbPath, 'utf8');
  runtimeDb = addNamedImportSpecifiersRequired(
    runtimeDb,
    '../schema.js',
    ['account', 'authSchema', 'contacts', 'rateLimit', 'session', 'user', 'verification'],
    ['runtimeSecretJoinProof', 'runtimeSecretProof'],
    'sqlite runtime secret provenance schema import',
  );
  runtimeDb = replaceRequired(
    runtimeDb,
    'const APP_TABLES = [contacts, user, session, account, verification, rateLimit] as const;',
    'const APP_TABLES = [contacts, runtimeSecretProof, runtimeSecretJoinProof, user, session, account, verification, rateLimit] as const;',
    'sqlite runtime secret provenance table list',
  );
  runtimeDb = replaceRequired(
    runtimeDb,
    '  },\n] as const satisfies readonly KovoSqliteSeed[];',
    [
      '  },',
      '  {',
      '    table: runtimeSecretProof,',
      '    rows: [',
      "      { classified: 'runtime-secret-value', id: 's1', label: 'public label' },",
      '    ],',
      '  },',
      '  {',
      '    table: runtimeSecretJoinProof,',
      '    rows: [',
      "      { id: 'j1', label: 'join public label', proof_id: 's1' },",
      '    ],',
      '  },',
      '] as const satisfies readonly KovoSqliteSeed[];',
    ].join('\n'),
    'sqlite runtime secret provenance structured seed',
  );
  writeFileSync(runtimeDbPath, runtimeDb, 'utf8');

  const queriesPath = join(root, 'src/queries.ts');
  let queries = readFileSync(queriesPath, 'utf8');
  queries = replaceRequired(
    queries,
    "import { query, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    [
      "import { trustedReveal, type Secret } from '@kovojs/core';",
      "import { count, eq, sql as drizzleSql } from 'drizzle-orm';",
      "import { alias } from 'drizzle-orm/sqlite-core';",
      "import { sql, trustedSql } from '@kovojs/drizzle';",
      "import { declareSecretReadCapability, domain, endpoint, publicAccess, query, s, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
    ].join('\n'),
    'sqlite runtime secret provenance query imports',
  );
  queries = replaceRequired(
    queries,
    "import { contacts } from './schema.js';",
    [
      "import { readonlyAppDb } from './db.js';",
      "import { contact } from './model.js';",
      "import { contacts, runtimeSecretJoinProof, runtimeSecretProof } from './schema.js';",
    ].join('\n'),
    'sqlite runtime secret provenance schema import',
  );
  queries = replaceRequired(
    queries,
    'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
    [
      'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
      '',
      'type SqliteSecretRow = Record<string, JsonValue> & {',
      '  company?: string;',
      '  id: string;',
      '  label?: string;',
      '  leaked?: string;',
      '  total?: number;',
      '};',
      '',
      'interface SqliteSecretRows {',
      '  readonly [key: string]: JsonValue;',
      '  items: SqliteSecretRow[];',
      '}',
      '',
      'const sqliteSecretRowSchema = s.object({',
      '  company: s.string().optional(),',
      '  id: s.string(),',
      '  label: s.string().optional(),',
      '  leaked: s.string().optional(),',
      '  total: s.number().optional(),',
      '});',
      'const sqliteSecretRowsSchema = s.object({ items: s.array(sqliteSecretRowSchema) });',
      'const sqliteSecretPublicRowsSchema = s.object({ items: s.array(s.object({ id: s.string(), label: s.string() })) });',
      'const sqliteSecretRevealRowsSchema = s.object({ items: s.array(s.object({ company: s.string(), id: s.string() })) });',
      "const sqliteRuntimeSecretProofDomain = domain('runtime-secret-proof');",
      '',
      "const sqliteSecretAggregatePublicProof = publicAccess('public SQLite non-secret aggregate proof');",
      "const sqliteSecretExpressionPublicProof = publicAccess('public SQLite raw-expression narrow-waist proof');",
      "const sqliteSecretRawReadPublicProof = publicAccess('public SQLite declared rawRead proof');",
      '',
      "export const sqliteSecretNonSecretAggregateEndpoint = endpoint('/api/sqlite-secret-nonsecret-aggregate', {",
      '  access: sqliteSecretAggregatePublicProof,',
      "  auth: { justification: 'public SQLite non-secret aggregate proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only SQLite non-secret aggregate proof',",
      '  async handler() {',
      '    const rows = await readonlyAppDb',
      '      .select({ label: runtimeSecretJoinProof.label, total: count() })',
      '      .from(runtimeSecretJoinProof);',
      "    return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only SQLite non-secret aggregate proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const sqliteSecretSafeBuilderExpressionEndpoint = endpoint('/api/sqlite-secret-safe-builder-expression', {",
      '  access: sqliteSecretExpressionPublicProof,',
      "  auth: { justification: 'public SQLite safe raw-expression proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only SQLite safe raw-expression proof',",
      '  async handler() {',
      '    const rows = await readonlyAppDb',
      '      .select({ id: contacts.id, label: drizzleSql<string>`upper(${contacts.name})` })',
      '      .from(contacts);',
      "    return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only SQLite safe raw-expression proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const sqliteSecretHiddenBuilderExpressionEndpoint = endpoint('/api/sqlite-secret-hidden-builder-expression', {",
      '  access: sqliteSecretExpressionPublicProof,',
      "  auth: { justification: 'public SQLite hidden raw-expression proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only SQLite hidden raw-expression proof',",
      '  async handler() {',
      '    const rows = await readonlyAppDb',
      '      .select({',
      '        id: contacts.id,',
      '        leaked: drizzleSql<string>`upper(${contacts.name}) || (select classified from runtime_secret_proof)`,',
      '      })',
      '      .from(contacts);',
      "    return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only SQLite hidden raw-expression proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const sqliteRawReadDeclaredEndpoint = endpoint('/api/sqlite-raw-read-declared', {",
      '  access: sqliteSecretRawReadPublicProof,',
      "  auth: { justification: 'public SQLite declared rawRead proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only SQLite declared rawRead proof',",
      '  async handler() {',
      '    const rows = await readonlyAppDb.rawRead<{ id: string; label: string }>(',
      "      trustedSql(sql.raw<{ id: string; label: string }>('select id, name as label from contacts'), {",
      "        justification: 'declared SQLite rawRead served proof',",
      '      }),',
      "      { reads: ['contacts'] },",
      '    );',
      "    return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only SQLite declared rawRead proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const sqliteRawReadUnderdeclaredEndpoint = endpoint('/api/sqlite-raw-read-underdeclared', {",
      '  access: sqliteSecretRawReadPublicProof,',
      "  auth: { justification: 'public SQLite underdeclared rawRead proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only SQLite underdeclared rawRead proof',",
      '  async handler() {',
      '    const rows = await readonlyAppDb.rawRead<{ id: string; label: string }>(',
      '      trustedSql(',
      "        sql.raw<{ id: string; label: string }>('select contacts.id, runtime_secret_join_proof.label from contacts join runtime_secret_join_proof on 1 = 1'),",
      "        { justification: 'underdeclared SQLite rawRead served proof' },",
      '      ),',
      "      { reads: ['contacts'] },",
      '    );',
      "    return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only SQLite underdeclared rawRead proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      'export const sqliteSecretAliasQuery = query({',
      '  access: [appAuthed],',
      '  output: sqliteSecretRowsSchema,',
      '  reads: [],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      "    const proof = alias(runtimeSecretProof, 'runtime_secret_alias');",
      '    const items = await db.select({ id: proof.id, company: proof.classified }).from(proof);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretDerivationQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(sqliteSecretRowSchema) }),',
      '  reads: [sqliteRuntimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const statement = trustedSql(sql.raw<SqliteSecretRows["items"][number]>(\'select id, substr(classified, 1, 7) as leaked from "runtime_secret_proof"\'), {',
      "      justification: 'sqlite derived secret provenance proof',",
      '    });',
      '    declareSecretReadCapability(statement, {',
      "      columns: ['classified'],",
      "      justification: 'sqlite derivation read remains boxed before egress',",
      "      source: 'runtime_secret_proof.classified',",
      "      table: 'runtime_secret_proof',",
      '    });',
      '    const items = await (db as unknown as { all(value: unknown): SqliteSecretRows["items"] | Promise<SqliteSecretRows["items"]> }).all(statement);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretJoinAliasQuery = query({',
      '  access: [appAuthed],',
      '  output: sqliteSecretRowsSchema,',
      '  reads: [],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      "    const proof = alias(runtimeSecretProof, 'runtime_secret_join_alias');",
      '    const items = await db',
      '      .select({ id: runtimeSecretJoinProof.id, company: proof.classified, label: runtimeSecretJoinProof.label })',
      '      .from(runtimeSecretJoinProof)',
      '      .innerJoin(proof, eq(proof.id, runtimeSecretJoinProof.proofId));',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretCteQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(sqliteSecretRowSchema) }),',
      '  reads: [sqliteRuntimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const statement = trustedSql(sql.raw<SqliteSecretRows["items"][number]>(\'with secret_cte as (select id, classified from "runtime_secret_proof") select id, classified as leaked from secret_cte\'), {',
      "      justification: 'sqlite CTE secret provenance proof',",
      '    });',
      '    declareSecretReadCapability(statement, {',
      "      columns: ['classified'],",
      "      justification: 'sqlite CTE read remains boxed before egress',",
      "      source: 'runtime_secret_proof.classified',",
      "      table: 'runtime_secret_proof',",
      '    });',
      '    const items = await (db as unknown as { all(value: unknown): SqliteSecretRows["items"] | Promise<SqliteSecretRows["items"]> }).all(statement);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretSubqueryQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(sqliteSecretRowSchema) }),',
      '  reads: [sqliteRuntimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const statement = trustedSql(sql.raw<SqliteSecretRows["items"][number]>(\'select id, (select classified from "runtime_secret_proof" nested where nested.id = "runtime_secret_proof".id) as leaked from "runtime_secret_proof"\'), {',
      "      justification: 'sqlite subquery secret provenance proof',",
      '    });',
      '    declareSecretReadCapability(statement, {',
      "      columns: ['classified'],",
      "      justification: 'sqlite subquery read remains boxed before egress',",
      "      source: 'runtime_secret_proof.classified',",
      "      table: 'runtime_secret_proof',",
      '    });',
      '    const items = await (db as unknown as { all(value: unknown): SqliteSecretRows["items"] | Promise<SqliteSecretRows["items"]> }).all(statement);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretUnionQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(sqliteSecretRowSchema) }),',
      '  reads: [sqliteRuntimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const statement = trustedSql(sql.raw<SqliteSecretRows["items"][number]>(\'select id, label as leaked from "runtime_secret_proof" union all select id, classified as leaked from "runtime_secret_proof"\'), {',
      "      justification: 'sqlite union secret provenance proof',",
      '    });',
      '    declareSecretReadCapability(statement, {',
      "      columns: ['classified'],",
      "      justification: 'sqlite union read remains boxed before egress',",
      "      source: 'runtime_secret_proof.classified',",
      "      table: 'runtime_secret_proof',",
      '    });',
      '    const items = await (db as unknown as { all(value: unknown): SqliteSecretRows["items"] | Promise<SqliteSecretRows["items"]> }).all(statement);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretComputedQuery = query({',
      '  access: [appAuthed],',
      '  output: sqliteSecretRowsSchema,',
      '  reads: [],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      "    const proof = alias(runtimeSecretProof, 'runtime_secret_computed_alias');",
      '    const rows = await db.select({ id: proof.id, company: proof.classified }).from(proof);',
      '    return {',
      '      items: rows.map((row) => ({ id: row.id, leaked: row.company })),',
      '    };',
      '  },',
      '});',
      '',
      'export const sqliteSecretMixedChunkQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(sqliteSecretRowSchema) }),',
      '  reads: [sqliteRuntimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const statement = trustedSql(sql.raw<SqliteSecretRows["items"][number]>(\'select id, upper(label) || (select classified from runtime_secret_proof) as leaked from runtime_secret_proof\'), {',
      "      justification: 'sqlite mixed raw string secret provenance proof',",
      '    });',
      '    declareSecretReadCapability(statement, {',
      "      columns: ['classified'],",
      "      justification: 'sqlite mixed raw read remains boxed before egress',",
      "      source: 'runtime_secret_proof.classified',",
      "      table: 'runtime_secret_proof',",
      '    });',
      '    const items = await (db as unknown as { all(value: unknown): SqliteSecretRows["items"] | Promise<SqliteSecretRows["items"]> }).all(statement);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretMixedChunkBuilderQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({',
      '    items: s.array(s.object({ id: s.string(), leaked: s.string() })),',
      '  }),',
      '  reads: [contact],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const items = (await db',
      '      .select({',
      '        id: contacts.id,',
      '        leaked: drizzleSql<string>`upper(${contacts.name}) || (select classified from runtime_secret_proof)`,',
      '      })',
      '      .from(contacts)) as SqliteSecretRows["items"];',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretNonSecretProjectionQuery = query({',
      '  access: [appAuthed],',
      '  output: sqliteSecretPublicRowsSchema,',
      '  reads: [],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      "    const proof = alias(runtimeSecretProof, 'runtime_secret_public_projection_alias');",
      '    const items = await db.select({ id: proof.id, label: proof.label }).from(proof);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretComputedPublicQuery = query({',
      '  access: [appAuthed],',
      '  output: sqliteSecretPublicRowsSchema,',
      '  reads: [],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      "    const proof = alias(runtimeSecretProof, 'runtime_secret_computed_public_alias');",
      '    const rows = await db.select({ id: proof.id, label: proof.label }).from(proof);',
      '    return {',
      '      items: rows.map((row) => ({ id: row.id, label: row.label.toUpperCase() })),',
      '    };',
      '  },',
      '});',
      '',
      'export const sqliteSecretAggregateQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(sqliteSecretRowSchema) }),',
      '  reads: [sqliteRuntimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const statement = trustedSql(sql.raw<SqliteSecretRows["items"][number]>(\'select id, max(classified) as leaked from "runtime_secret_proof"\'), {',
      "      justification: 'sqlite aggregate secret provenance proof',",
      '    });',
      '    declareSecretReadCapability(statement, {',
      "      columns: ['classified'],",
      "      justification: 'sqlite aggregate read remains boxed before egress',",
      "      source: 'runtime_secret_proof.classified',",
      "      table: 'runtime_secret_proof',",
      '    });',
      '    const items = await (db as unknown as { all(value: unknown): SqliteSecretRows["items"] | Promise<SqliteSecretRows["items"]> }).all(statement);',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretSubqueryPublicQuery = query({',
      '  access: [appAuthed],',
      '  output: s.object({ items: s.array(sqliteSecretRowSchema) }),',
      '  reads: [sqliteRuntimeSecretProofDomain],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      '    const items = await db.rawRead<SqliteSecretRows["items"][number]>(',
      '      trustedSql(sql.raw<SqliteSecretRows["items"][number]>(\'select id, (select label from "runtime_secret_proof" nested where nested.id = "runtime_secret_proof".id) as label from "runtime_secret_proof"\'), {',
      "        justification: 'sqlite subquery public provenance proof',",
      '      }),',
      "      { reads: ['runtime_secret_proof'] },",
      '    );',
      '    return { items };',
      '  },',
      '});',
      '',
      'export const sqliteSecretRevealQuery = query({',
      '  access: [appAuthed],',
      '  output: sqliteSecretRevealRowsSchema,',
      '  reads: [],',
      '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<SqliteSecretRows> {',
      '    const db: Reader<AppDb> | undefined = context?.db;',
      '    if (!db) throw new Error("query requires framework-provided context.db");',
      "    const proof = alias(runtimeSecretProof, 'runtime_secret_reveal_alias');",
      '    const rows = await db.select({ id: proof.id, company: proof.classified }).from(proof);',
      '    return {',
      '      items: rows.map((row) => {',
      '        const reviewedCompany = trustedReveal(row.company as unknown as Secret<string>, {',
      "          justification: 'sqlite secret provenance audited reveal acceptance proof',",
      "          method: 'arbitrary-fn',",
      "          source: 'runtime_secret_proof.classified',",
      '        });',
      '        return { id: row.id, company: `${reviewedCompany}:revealed` };',
      '      }),',
      '    };',
      '  },',
      '});',
    ].join('\n'),
    'sqlite runtime secret provenance queries',
  );
  writeFileSync(queriesPath, queries, 'utf8');

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { contactsQuery } from './queries.js';",
    [
      'import {',
      '  contactsQuery,',
      '  sqliteSecretAggregateQuery,',
      '  sqliteSecretAliasQuery,',
      '  sqliteSecretComputedPublicQuery,',
      '  sqliteSecretComputedQuery,',
      '  sqliteSecretCteQuery,',
      '  sqliteSecretDerivationQuery,',
      '  sqliteSecretJoinAliasQuery,',
      '  sqliteSecretHiddenBuilderExpressionEndpoint,',
      '  sqliteSecretMixedChunkQuery,',
      '  sqliteSecretMixedChunkBuilderQuery,',
      '  sqliteSecretNonSecretAggregateEndpoint,',
      '  sqliteSecretNonSecretProjectionQuery,',
      '  sqliteRawReadDeclaredEndpoint,',
      '  sqliteRawReadUnderdeclaredEndpoint,',
      '  sqliteSecretRevealQuery,',
      '  sqliteSecretSafeBuilderExpressionEndpoint,',
      '  sqliteSecretSubqueryPublicQuery,',
      '  sqliteSecretSubqueryQuery,',
      '  sqliteSecretUnionQuery,',
      "} from './queries.js';",
    ].join('\n'),
    'sqlite runtime secret provenance app import',
  );
  app = replaceRequired(
    app,
    '  queries: [contactsQuery],',
    [
      '  queries: [',
      '    contactsQuery,',
      '    sqliteSecretAggregateQuery,',
      '    sqliteSecretAliasQuery,',
      '    sqliteSecretComputedPublicQuery,',
      '    sqliteSecretComputedQuery,',
      '    sqliteSecretCteQuery,',
      '    sqliteSecretDerivationQuery,',
      '    sqliteSecretJoinAliasQuery,',
      '    sqliteSecretMixedChunkQuery,',
      '    sqliteSecretMixedChunkBuilderQuery,',
      '    sqliteSecretNonSecretProjectionQuery,',
      '    sqliteSecretRevealQuery,',
      '    sqliteSecretSubqueryPublicQuery,',
      '    sqliteSecretSubqueryQuery,',
      '    sqliteSecretUnionQuery,',
      '  ],',
    ].join('\n'),
    'sqlite runtime secret provenance app registration',
  );
  app = appendArrayEntry(app, 'endpoints', 'sqliteSecretNonSecretAggregateEndpoint');
  app = appendArrayEntry(app, 'endpoints', 'sqliteSecretSafeBuilderExpressionEndpoint');
  app = appendArrayEntry(app, 'endpoints', 'sqliteSecretHiddenBuilderExpressionEndpoint');
  app = appendArrayEntry(app, 'endpoints', 'sqliteRawReadDeclaredEndpoint');
  app = appendArrayEntry(app, 'endpoints', 'sqliteRawReadUnderdeclaredEndpoint');
  writeFileSync(appPath, app, 'utf8');
}

export function addParanoidPhase5WriteBoundaryProof(root: string): void {
  writeFileSync(
    join(root, 'src/paranoid-phase5-write-boundary-proof.ts'),
    [
      "import { secret } from '@kovojs/core';",
      "import { sql, trustedSql } from '@kovojs/drizzle';",
      "import { and, eq } from 'drizzle-orm';",
      "import { sqliteTable, text } from 'drizzle-orm/sqlite-core';",
      "import { domain, endpoint, mutation, publicAccess, s, serverValue } from '@kovojs/server';",
      '',
      "import { appCsrf, type AppRequest } from './auth.js';",
      "import { readonlyAppDb } from './db.js';",
      "import { contact } from './model.js';",
      "import { contactsQuery } from './queries.js';",
      "import { contacts } from './schema.js';",
      '',
      "const publicProof = publicAccess('public phase 5.1 write boundary proof');",
      "const phase5WriteProof = domain('phase5-write-boundary-proof');",
      "const PHASE5_WRITE_CONTACT_EMAIL = 'phase5-write-boundary-proof-contact@example.com';",
      "const PHASE5_WRITE_MARKER = 'phase5-write-boundary-proof';",
      'const proofInput = s.object({ marker: s.string() });',
      "const sqliteMaster = sqliteTable('sqlite_master', {",
      "  name: text('name'),",
      "  type: text('type'),",
      '});',
      '',
      'async function phase5DdlWriteRun(db: AppRequest["db"]) {',
      '    await (db as unknown as { execute(statement: unknown): Promise<unknown> }).execute(',
      '      trustedSql(',
      "        sql.raw('create table phase5_dogfood_blocked (id text primary key)'),",
      "        { justification: 'phase 5.1 DDL write rejection proof' },",
      '      ),',
      '    );',
      '}',
      '',
      'export const phase5DdlWriteProof = mutation({',
      '  access: publicProof,',
      '  csrf: appCsrf,',
      '  input: proofInput,',
      "  registry: { tables: ['contacts'], touches: [phase5WriteProof] },",
      '  async handler(_input: { marker: string }, request: AppRequest) {',
      '    await phase5DdlWriteRun(request.db);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'async function phase5BoxedSecretBuilderWriteRun(',
      '  db: AppRequest["db"],',
      '  input: { marker: string },',
      ') {',
      '    await db.insert(contacts).values({',
      "      company: secret('phase5-builder-secret') as unknown as string,",
      '      email: `${input.marker}-builder-secret@example.com`,',
      "      id: serverValue(`${input.marker}-builder-secret`, 'phase 5.1 boxed secret builder id'),",
      "      name: 'blocked boxed secret builder write',",
      '    });',
      '}',
      '',
      'export const phase5BoxedSecretBuilderWriteProof = mutation({',
      '  access: publicProof,',
      '  csrf: appCsrf,',
      '  input: proofInput,',
      "  optimistic: { [contactsQuery.key]: 'await-fragment' },",
      "  registry: { tables: ['contacts'], touches: [contact] },",
      '  async handler(input: { marker: string }, request: AppRequest) {',
      '    await phase5BoxedSecretBuilderWriteRun(request.db, input);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'async function phase5BoxedSecretRawWriteRun(',
      '  db: AppRequest["db"],',
      '  input: { marker: string },',
      ') {',
      '    await (db as unknown as { execute(statement: unknown): Promise<unknown> }).execute(',
      '      trustedSql(',
      "        sql`insert into \"contacts\" (id, name, email, company) values (${serverValue(`${input.marker}-raw-secret`, 'phase 5.1 boxed secret raw id')}, ${'blocked boxed secret raw write'}, ${`${input.marker}-raw-secret@example.com`}, ${secret('phase5-raw-secret') as unknown as string})`,",
      "        { justification: 'phase 5.1 boxed secret raw write rejection proof' },",
      '      ),',
      '    );',
      '}',
      '',
      'export const phase5BoxedSecretRawWriteProof = mutation({',
      '  access: publicProof,',
      '  csrf: appCsrf,',
      '  input: proofInput,',
      "  optimistic: { [contactsQuery.key]: 'await-fragment' },",
      "  registry: { tables: ['contacts'], touches: [contact] },",
      '  async handler(input: { marker: string }, request: AppRequest) {',
      '    await phase5BoxedSecretRawWriteRun(request.db, input);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'async function phase5GovernedMassAssignmentRun(',
      '  db: AppRequest["db"],',
      '  input: { marker: string },',
      ') {',
      '    await db.insert(contacts).values({',
      "      company: 'blocked governed mass assignment',",
      '      email: `${input.marker}-governed-mass-assignment@example.com`,',
      '      id: input.marker,',
      "      name: 'blocked governed mass assignment',",
      '    });',
      '}',
      '',
      'export const phase5GovernedMassAssignmentProof = mutation({',
      '  access: publicProof,',
      '  csrf: appCsrf,',
      '  input: proofInput,',
      "  optimistic: { [contactsQuery.key]: 'await-fragment' },",
      "  registry: { tables: ['contacts'], touches: [contact] },",
      '  async handler(input: { marker: string }, request: AppRequest) {',
      '    await phase5GovernedMassAssignmentRun(request.db, input);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      "export const phase5WriteBoundaryStatusEndpoint = endpoint('/api/phase5-write-boundary-proof', {",
      '  access: publicProof,',
      "  auth: { justification: 'public phase 5.1 write boundary status proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only phase 5.1 write boundary status proof',",
      '  async handler(_request: Request) {',
      '    const contactRows = await readonlyAppDb',
      '      .select({ id: contacts.id })',
      '      .from(contacts)',
      '      .where(eq(contacts.email, PHASE5_WRITE_CONTACT_EMAIL));',
      '    const builderRows = await readonlyAppDb',
      '      .select({ id: contacts.id })',
      '      .from(contacts)',
      '      .where(eq(contacts.email, `${PHASE5_WRITE_MARKER}-builder-secret@example.com`));',
      '    const rawRows = await readonlyAppDb',
      '      .select({ id: contacts.id })',
      '      .from(contacts)',
      '      .where(eq(contacts.email, `${PHASE5_WRITE_MARKER}-raw-secret@example.com`));',
      '    const governedRows = await readonlyAppDb',
      '      .select({ id: contacts.id })',
      '      .from(contacts)',
      '      .where(eq(contacts.email, `${PHASE5_WRITE_MARKER}-governed-mass-assignment@example.com`));',
      '    const ddlRows = await readonlyAppDb',
      '      .select({ name: sqliteMaster.name })',
      '      .from(sqliteMaster)',
      "      .where(and(eq(sqliteMaster.type, 'table'), eq(sqliteMaster.name, 'phase5_dogfood_blocked')));",
      '    return Response.json(',
      '      {',
      '        blockedBuilderSecretRows: builderRows.length,',
      '        blockedDdlTables: ddlRows.length,',
      '        blockedGovernedMassAssignmentRows: governedRows.length,',
      '        blockedRawSecretRows: rawRows.length,',
      '        contactRows: contactRows.length,',
      '      },',
      "      { headers: { 'Cache-Control': 'no-store' } },",
      '    );',
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only phase 5.1 write boundary status proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const starterProofPath = join(root, 'src/starter-mutation-db-scope-proof.ts');
  const starterProof = readFileSync(starterProofPath, 'utf8');
  assertRequiredScaffoldAnchor(
    starterProof,
    "import { appCsrf, type AppRequest } from './auth.js';",
    'phase 5.1 protected starter DB-scope CSRF import',
  );
  for (const mutationName of [
    'starterAbsentTablesContactWriteProof',
    'starterRawAuthTableWriteProof',
  ]) {
    assertRequiredScaffoldAnchor(
      starterProof,
      `export const ${mutationName} = mutation({\n  access: publicProof,\n  csrf: appCsrf,`,
      `phase 5.1 protected ${mutationName} CSRF posture`,
    );
  }

  writeFileSync(
    join(root, 'src/paranoid-phase5-write-proof-forms.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { mutationFormAttributes } from '@kovojs/server';",
      '',
      "import { phase5BoxedSecretBuilderWriteProof, phase5BoxedSecretRawWriteProof, phase5DdlWriteProof, phase5GovernedMassAssignmentProof } from './paranoid-phase5-write-boundary-proof.js';",
      '',
      'export const Phase5WriteProofForms = component({',
      '  mutations: {',
      '    phase5BoxedSecretBuilderWriteProof,',
      '    phase5BoxedSecretRawWriteProof,',
      '    phase5DdlWriteProof,',
      '    phase5GovernedMassAssignmentProof,',
      '  },',
      '  render: () => (',
      '    <div hidden>',
      '      <form {...mutationFormAttributes(phase5BoxedSecretBuilderWriteProof)} />',
      '      <form {...mutationFormAttributes(phase5BoxedSecretRawWriteProof)} />',
      '      <form {...mutationFormAttributes(phase5DdlWriteProof)} />',
      '      <form {...mutationFormAttributes(phase5GovernedMassAssignmentProof)} />',
      '    </div>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  const existingImport =
    "import { starterDbScopeStatusEndpoint, starterAbsentTablesContactWriteProof, starterRawAuthTableWriteProof } from './starter-mutation-db-scope-proof.js';";
  const phase5Import =
    "import { phase5BoxedSecretBuilderWriteProof, phase5BoxedSecretRawWriteProof, phase5DdlWriteProof, phase5GovernedMassAssignmentProof, phase5WriteBoundaryStatusEndpoint } from './paranoid-phase5-write-boundary-proof.js';";
  app = app.includes(existingImport)
    ? replaceRequired(
        app,
        existingImport,
        `${existingImport}\n${phase5Import}\nimport { Phase5WriteProofForms } from './paranoid-phase5-write-proof-forms.js';`,
        'phase 5.1 write boundary imports',
      )
    : replaceRequired(
        app,
        "import { addContact } from './mutations.js';",
        [
          "import { addContact } from './mutations.js';",
          phase5Import,
          "import { Phase5WriteProofForms } from './paranoid-phase5-write-proof-forms.js';",
        ].join('\n'),
        'phase 5.1 write boundary imports',
      );
  app = replaceRequired(
    app,
    '      <ContactsRegion />',
    '      <ContactsRegion />\n      <Phase5WriteProofForms />',
    'phase 5.1 protected write proof forms',
  );
  app = appendArrayEntry(app, 'endpoints', 'phase5WriteBoundaryStatusEndpoint');
  app = app.includes(
    '  mutations: [addContact, starterAbsentTablesContactWriteProof, starterRawAuthTableWriteProof, appSignIn, appSignOut],',
  )
    ? replaceRequired(
        app,
        '  mutations: [addContact, starterAbsentTablesContactWriteProof, starterRawAuthTableWriteProof, appSignIn, appSignOut],',
        '  mutations: [addContact, starterAbsentTablesContactWriteProof, starterRawAuthTableWriteProof, phase5BoxedSecretBuilderWriteProof, phase5BoxedSecretRawWriteProof, phase5DdlWriteProof, phase5GovernedMassAssignmentProof, appSignIn, appSignOut],',
        'phase 5.1 write boundary mutation registration',
      )
    : replaceRequired(
        app,
        '  mutations: [addContact, appSignIn, appSignOut],',
        '  mutations: [addContact, phase5BoxedSecretBuilderWriteProof, phase5BoxedSecretRawWriteProof, phase5DdlWriteProof, phase5GovernedMassAssignmentProof, appSignIn, appSignOut],',
        'phase 5.1 write boundary mutation registration',
      );
  writeFileSync(appPath, app, 'utf8');
}

export function addParanoidPhase5AuthorizationProof(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  let schema = readFileSync(schemaPath, 'utf8');
  schema = replaceRequired(
    schema,
    "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    [
      'export const phase5AuthzOrders = sqliteTable(',
      "  'phase5_authz_orders',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    userId: text('user_id').notNull(),",
      "    label: text('label').notNull(),",
      "    classified: text('classified').notNull(),",
      '  },',
      '  kovo({',
      "    domain: 'phase5-authz-order',",
      "    key: 'id',",
      "    owner: 'userId',",
      "    secret: ['classified'],",
      '  }),',
      ');',
      '',
      'export const phase5AuthzItems = sqliteTable(',
      "  'phase5_authz_items',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    orderId: text('order_id').notNull(),",
      "    label: text('label').notNull(),",
      '  },',
      '  kovo({',
      "    domain: 'phase5-authz-item',",
      "    key: 'id',",
      "    ownerVia: { parent: phase5AuthzOrders, fk: 'orderId', parentKey: 'id' },",
      '  }),',
      ');',
      '',
      "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    ].join('\n'),
    'phase 5.1 authorization schema tables',
  );
  writeFileSync(schemaPath, schema, 'utf8');

  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db.ts');
  let runtimeDb = readFileSync(runtimeDbPath, 'utf8');
  runtimeDb = addNamedImportSpecifiersRequired(
    runtimeDb,
    '../schema.js',
    [
      'account',
      'authSchema',
      'contacts',
      'rateLimit',
      'runtimeSecretJoinProof',
      'runtimeSecretProof',
      'session',
      'user',
      'verification',
    ],
    ['phase5AuthzItems', 'phase5AuthzOrders'],
    'phase 5.1 authorization schema import',
  );
  runtimeDb = replaceRequired(
    runtimeDb,
    'const APP_TABLES = [contacts, runtimeSecretProof, runtimeSecretJoinProof, user, session, account, verification, rateLimit] as const;',
    'const APP_TABLES = [contacts, phase5AuthzOrders, phase5AuthzItems, runtimeSecretProof, runtimeSecretJoinProof, user, session, account, verification, rateLimit] as const;',
    'phase 5.1 authorization table list',
  );
  runtimeDb = replaceRequired(
    runtimeDb,
    '  },\n] as const satisfies readonly KovoSqliteSeed[];',
    [
      '  },',
      '  {',
      '    table: phase5AuthzOrders,',
      '    rows: [',
      "      { classified: 'phase5-authz-secret-owner', id: 'phase5-authz-owned', label: 'owner-visible', user_id: 'demo-user' },",
      "      { classified: 'phase5-authz-secret-session-owner', id: 'phase5-authz-owned-session', label: 'owner-visible', user_id: 'demo-user' },",
      "      { classified: 'phase5-authz-secret-other', id: 'phase5-authz-other', label: 'cross-owner-hidden', user_id: 'other-user' },",
      '    ],',
      '  },',
      '  {',
      '    table: phase5AuthzItems,',
      '    rows: [',
      "      { id: 'phase5-authz-item-owned', label: 'owner-item', order_id: 'phase5-authz-owned' },",
      "      { id: 'phase5-authz-item-owned-session', label: 'owner-item', order_id: 'phase5-authz-owned-session' },",
      "      { id: 'phase5-authz-item-other', label: 'other-item', order_id: 'phase5-authz-other' },",
      '    ],',
      '  },',
      '] as const satisfies readonly KovoSqliteSeed[];',
    ].join('\n'),
    'phase 5.1 authorization structured seed',
  );
  writeFileSync(runtimeDbPath, runtimeDb, 'utf8');

  writeFileSync(
    join(root, 'src/paranoid-phase5-authz-proof.ts'),
    [
      "import { sql, trustedSql } from '@kovojs/drizzle';",
      "import { eq } from 'drizzle-orm';",
      "import { alias } from 'drizzle-orm/sqlite-core';",
      "import { domain, endpoint, mutation, publicAccess, query, s, type JsonValue, type QueryLoadContext, type Reader } from '@kovojs/server';",
      '',
      "import { appAuthed, appCsrf, type AppRequest } from './auth.js';",
      "import type { AppDb } from './db.js';",
      "import { readonlyAppDb } from './db.js';",
      "import { phase5AuthzItems, phase5AuthzOrders } from './schema.js';",
      '',
      "const publicProof = publicAccess('public phase 5.1 authorization dogfood proof');",
      "const phase5AuthzOrderDomain = domain('phase5-authz-order');",
      "const phase5AuthzItemDomain = domain('phase5-authz-item');",
      'const proofInput = s.object({ marker: s.string() });',
      'const authzRowsSchema = s.object({',
      '  items: s.array(s.object({ id: s.string(), label: s.string() })),',
      '});',
      '',
      'interface AuthzRow {',
      '  readonly [key: string]: JsonValue;',
      '  id: string;',
      '  label: string;',
      '}',
      '',
      'type Phase5AuthzQueryContext = QueryLoadContext<AppRequest, AppDb>;',
      '',
      'function assertPhase5AuthzDb(context?: Phase5AuthzQueryContext): asserts context is Phase5AuthzQueryContext & { db: Reader<AppDb> } {',
      '  if (!context?.db) throw new Error("missing phase 5.1 authorization query db");',
      '}',
      '',
      'export const phase5AuthzBuilderQuery = query({',
      '  access: [appAuthed],',
      '  output: authzRowsSchema,',
      '  reads: [phase5AuthzOrderDomain],',
      '  async load(_input: unknown, context?: Phase5AuthzQueryContext) {',
      '    assertPhase5AuthzDb(context);',
      '    const db = context.db;',
      '    const rows = (await db',
      '      .select({ id: phase5AuthzOrders.id, label: phase5AuthzOrders.label })',
      '      .from(phase5AuthzOrders)) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5AuthzAliasQuery = query({',
      '  access: [appAuthed],',
      '  output: authzRowsSchema,',
      '  reads: [phase5AuthzOrderDomain],',
      '  async load(_input: unknown, context?: Phase5AuthzQueryContext) {',
      '    assertPhase5AuthzDb(context);',
      '    const db = context.db;',
      "    const owned = alias(phase5AuthzOrders, 'phase5_authz_orders_alias');",
      '    const rows = (await db',
      '      .select({ id: owned.id, label: owned.label })',
      '      .from(owned)) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5AuthzCompoundQuery = query({',
      '  access: [appAuthed],',
      '  output: authzRowsSchema,',
      '  reads: [phase5AuthzOrderDomain],',
      '  async load(_input: unknown, context?: Phase5AuthzQueryContext) {',
      '    assertPhase5AuthzDb(context);',
      '    const db = context.db;',
      '    const rows = (await db',
      '      .select({ id: phase5AuthzOrders.id, label: phase5AuthzOrders.label })',
      '      .from(phase5AuthzOrders)',
      "      .where(eq(phase5AuthzOrders.id, 'phase5-authz-owned-session'))",
      '      .union(',
      '        db',
      '          .select({ id: phase5AuthzOrders.id, label: phase5AuthzOrders.label })',
      '          .from(phase5AuthzOrders)',
      "          .where(eq(phase5AuthzOrders.id, 'phase5-authz-other')),",
      '      )) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5AuthzChildQuery = query({',
      '  access: [appAuthed],',
      '  output: authzRowsSchema,',
      '  reads: [phase5AuthzItemDomain],',
      '  async load(_input: unknown, context?: Phase5AuthzQueryContext) {',
      '    assertPhase5AuthzDb(context);',
      '    const db = context.db;',
      '    const rows = (await db',
      '      .select({ id: phase5AuthzItems.id, label: phase5AuthzItems.label })',
      '      .from(phase5AuthzItems)) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5AuthzGraphProof = mutation({',
      '  access: publicProof,',
      '  csrf: appCsrf,',
      '  input: proofInput,',
      '  optimistic: {',
      "    [phase5AuthzAliasQuery.key]: 'await-fragment',",
      "    [phase5AuthzBuilderQuery.key]: 'await-fragment',",
      "    [phase5AuthzCompoundQuery.key]: 'await-fragment',",
      "    [phase5AuthzChildQuery.key]: 'await-fragment',",
      '  },',
      '  registry: { touches: [phase5AuthzOrderDomain, phase5AuthzItemDomain] },',
      '  handler() {',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      "export const phase5AuthzEndpoint = endpoint('/api/phase5-authz-endpoint', {",
      '  access: publicProof,',
      "  auth: { justification: 'public phase 5.1 endpoint authz proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'phase 5.1 endpoint authz proof',",
      '  db: true,',
      '  async handler(_request, context) {',
      '    const scoped = await context.actAs("demo-user");',
      '    const rows = (await (scoped.db.read as any)',
      '      .select({ id: phase5AuthzOrders.id, label: phase5AuthzOrders.label })',
      '      .from(phase5AuthzOrders)) as AuthzRow[];',
      '    const childRows = (await (scoped.db.read as any)',
      '      .select({ id: phase5AuthzItems.id, label: phase5AuthzItems.label })',
      '      .from(phase5AuthzItems)) as AuthzRow[];',
      '    return Response.json({ childRows, rows }, { headers: { "Cache-Control": "no-store" } });',
      '  },',
      "  method: 'GET',",
      "  reason: 'phase 5.1 endpoint authz proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const phase5AuthzStatusEndpoint = endpoint('/api/phase5-authz-status', {",
      '  access: publicProof,',
      "  auth: { justification: 'public phase 5.1 authorization status proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only phase 5.1 authorization status proof',",
      '  async handler() {',
      '    const rows = await readonlyAppDb',
      '      .select({ id: phase5AuthzOrders.id, label: phase5AuthzOrders.label, userId: phase5AuthzOrders.userId })',
      '      .from(phase5AuthzOrders);',
      '    let secretReadBlocked = false;',
      '    try {',
      '      await readonlyAppDb.rawRead<{ classified: string }>(',
      '        trustedSql(sql.raw("select classified from phase5_authz_orders"), {',
      "          justification: 'phase 5.1 status secret-column floor proof',",
      '        }),',
      "        { reads: ['phase5_authz_orders'] },",
      '      );',
      '    } catch {',
      '      secretReadBlocked = true;',
      '    }',
      '    return Response.json(',
      '      {',
      '        secretReadBlocked,',
      '        rows,',
      '      },',
      '      { headers: { "Cache-Control": "no-store" } },',
      '    );',
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only phase 5.1 authorization status proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  const authzImport =
    "import { phase5AuthzAliasQuery, phase5AuthzBuilderQuery, phase5AuthzChildQuery, phase5AuthzCompoundQuery, phase5AuthzEndpoint, phase5AuthzGraphProof, phase5AuthzStatusEndpoint } from './paranoid-phase5-authz-proof.js';";
  app = replaceRequired(
    app,
    "import { appTheme } from './theme.js';",
    [authzImport, "import { appTheme } from './theme.js';"].join('\n'),
    'phase 5.1 authorization app import',
  );
  for (const endpointEntry of ['phase5AuthzEndpoint', 'phase5AuthzStatusEndpoint']) {
    app = appendArrayEntry(app, 'endpoints', endpointEntry);
  }
  app = appendArrayEntry(app, 'mutations', 'phase5AuthzGraphProof');
  for (const queryEntry of [
    'phase5AuthzAliasQuery',
    'phase5AuthzBuilderQuery',
    'phase5AuthzChildQuery',
    'phase5AuthzCompoundQuery',
  ]) {
    app = appendArrayEntry(app, 'queries', queryEntry);
  }
  writeFileSync(appPath, app, 'utf8');
}

export function pruneParanoidPhase5SqliteReadSet(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    '  sqliteSecretMixedChunkBuilderQuery,\n',
    '',
    'phase 5.1 prune mixed chunk builder import',
  );
  app = replaceRequired(
    app,
    '    sqliteSecretMixedChunkBuilderQuery,\n',
    '',
    'phase 5.1 prune mixed chunk builder registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addPostgresParanoidPhase5DogfoodProof(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  let schema = readFileSync(schemaPath, 'utf8');
  schema = replaceRequired(
    schema,
    "import { bigint, boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
    "import { bigint, boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';",
    'phase 5 postgres schema import anchor',
  );
  schema = replaceRequired(
    schema,
    "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    [
      'export const phase5PgOrders = pgTable(',
      "  'phase5_pg_orders',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    userId: text('user_id').notNull(),",
      "    label: text('label').notNull(),",
      "    classified: text('classified').notNull(),",
      '  },',
      '  kovo({',
      "    domain: 'phase5-pg-order',",
      "    key: 'id',",
      "    owner: 'userId',",
      "    secret: ['classified'],",
      '  }),',
      ');',
      '',
      'export const phase5PgItems = pgTable(',
      "  'phase5_pg_items',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    orderId: text('order_id').notNull(),",
      "    label: text('label').notNull(),",
      '  },',
      '  kovo({',
      "    domain: 'phase5-pg-item',",
      "    key: 'id',",
      "    ownerVia: { parent: phase5PgOrders, fk: 'orderId', parentKey: 'id' },",
      '  }),',
      ');',
      '',
      'export const phase5PgEvents = pgTable(',
      "  'phase5_pg_events',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    label: text('label').notNull(),",
      '  },',
      '  kovo({',
      '    authzPolicy: sql`TRUE`,',
      "    domain: 'phase5-pg-event',",
      "    key: 'id',",
      '  }),',
      ');',
      '',
      "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    ].join('\n'),
    'phase 5 postgres schema tables',
  );
  writeFileSync(schemaPath, schema, 'utf8');

  const runtimeDbOptionsPath = join(root, 'src/_kovo/app-runtime-db-options.ts');
  let runtimeDbOptions = readFileSync(runtimeDbOptionsPath, 'utf8');
  runtimeDbOptions = replaceRequired(
    runtimeDbOptions,
    'export const appRuntimeDbOptions = postgresAppRuntimeOptions({',
    [
      'const PHASE5_PG_PARANOID_SEED = [',
      "  \"INSERT INTO phase5_pg_orders (id, user_id, label, classified) VALUES ('phase5-pg-demo', 'demo-user', 'owner-visible', 'phase5-pg-secret-demo'), ('phase5-pg-other', 'other-user', 'cross-owner-hidden', 'phase5-pg-secret-other') ON CONFLICT (id) DO NOTHING;\",",
      "  \"INSERT INTO phase5_pg_items (id, order_id, label) VALUES ('phase5-pg-item-demo', 'phase5-pg-demo', 'owner-item'), ('phase5-pg-item-other', 'phase5-pg-other', 'other-item') ON CONFLICT (id) DO NOTHING;\",",
      '  "DROP VIEW IF EXISTS phase5_pg_order_view;",',
      '  "CREATE VIEW phase5_pg_order_view WITH (security_invoker=true) AS SELECT id, user_id, label FROM phase5_pg_orders;",',
      '  "GRANT SELECT ON phase5_pg_order_view TO kovo_reader;",',
      '  "DROP FUNCTION IF EXISTS phase5_pg_order_function();",',
      '  "CREATE FUNCTION phase5_pg_order_function() RETURNS TABLE(id text, label text) LANGUAGE sql SECURITY INVOKER STABLE AS $$ SELECT id, label FROM phase5_pg_orders ORDER BY id $$;",',
      '  "REVOKE ALL ON FUNCTION phase5_pg_order_function() FROM PUBLIC;",',
      '  "GRANT EXECUTE ON FUNCTION phase5_pg_order_function() TO kovo_reader;",',
      '];',
      '',
      'export const appRuntimeDbOptions = postgresAppRuntimeOptions({',
    ].join('\n'),
    'phase 5 postgres seed const',
  );
  runtimeDbOptions = replaceRequired(
    runtimeDbOptions,
    '  seedSql: SEED_CONTACTS,',
    '  seedSql: [SEED_CONTACTS, ...PHASE5_PG_PARANOID_SEED],',
    'phase 5 postgres seed registration',
  );
  writeFileSync(runtimeDbOptionsPath, runtimeDbOptions, 'utf8');

  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db.ts');
  let runtimeDb = readFileSync(runtimeDbPath, 'utf8');
  const mutationReplayExport = [
    '/** Durable SPEC §10.3 replay token; opaque and non-callable in app-authored modules. */',
    'export const appRuntimeMutationReplayStore: MutationReplayStore = appDatabase.mutationReplayStore;',
  ].join('\n');
  runtimeDb = replaceRequired(
    runtimeDb,
    mutationReplayExport,
    [
      mutationReplayExport,
      '',
      '/** Durable SPEC §10.3 webhook replay token for the Phase 5 production proof. */',
      'export const appRuntimeWebhookReplayStore = appDatabase.webhookReplayStore;',
    ].join('\n'),
    'phase 5 postgres durable webhook replay export',
  );
  writeFileSync(runtimeDbPath, runtimeDb, 'utf8');

  writeFileSync(
    join(root, 'src/paranoid-phase5-postgres-proof.ts'),
    [
      "import { sql, trustedSql } from '@kovojs/drizzle';",
      "import { eq } from 'drizzle-orm';",
      "import { alias, pgTable, text } from 'drizzle-orm/pg-core';",
      "import { domain, endpoint, mutation, publicAccess, query, s, serverValue, task, webhook, webhookReplayIdentity, type EndpointDbContext, type JsonValue, type QueryLoadContext, type Reader, type TaskSchedulingRequest } from '@kovojs/server';",
      '',
      "import { appRuntimeWebhookReplayStore } from './_kovo/app-runtime-db.js';",
      "import { appAuthed, appCsrf, type AppRequest } from './auth.js';",
      "import type { AppDb } from './db.js';",
      "import { phase5PgEvents, phase5PgItems, phase5PgOrders } from './schema.js';",
      '',
      "const publicProof = publicAccess('public phase 5 postgres paranoid dogfood proof');",
      "const orderDomain = domain('phase5-pg-order');",
      "const itemDomain = domain('phase5-pg-item');",
      "const eventDomain = domain('phase5-pg-event');",
      'const proofInput = s.object({ marker: s.string() });',
      'const rowSchema = s.object({ items: s.array(s.object({ id: s.string(), label: s.string() })) });',
      "const phase5PgOrderView = pgTable('phase5_pg_order_view', {",
      "  id: text('id').primaryKey(),",
      "  userId: text('user_id').notNull(),",
      "  label: text('label').notNull(),",
      '});',
      '',
      'interface AuthzRow { readonly [key: string]: JsonValue; id: string; label: string }',
      'type Phase5PgQueryContext = QueryLoadContext<AppRequest, AppDb>;',
      '',
      'function assertPhase5PgDb(context?: Phase5PgQueryContext): asserts context is Phase5PgQueryContext & { db: Reader<AppDb> } {',
      '  if (!context?.db) throw new Error("missing phase 5 postgres query db");',
      '}',
      '',
      'export const phase5PgBuilderQuery = query({',
      '    access: [appAuthed],',
      '    output: rowSchema,',
      '    reads: [orderDomain],',
      '    async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '      assertPhase5PgDb(context);',
      '      const db = context.db;',
      '      const rows = (await db.select({ id: phase5PgOrders.id, label: phase5PgOrders.label }).from(phase5PgOrders)) as AuthzRow[];',
      '      if (rows.length !== 1) throw new Error("phase 5 builder query must see exactly its owner row");',
      '      return { items: rows };',
      '    },',
      '});',
      '',
      'export const phase5PgTaskReadProofQuery = query({',
      '  access: publicProof, output: s.object({ ok: s.boolean() }), reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = await db.select({ id: phase5PgOrders.id }).from(phase5PgOrders);',
      '    if (rows.length !== 1) throw new Error("phase 5 task query must see exactly its owner row");',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const phase5PgDbQueryQuery = query({',
      '  access: [appAuthed], output: rowSchema, reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = (await (db as any).query.phase5PgOrders.findMany({ columns: { id: true, label: true } })) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgRawQuery = query({',
      '  access: [appAuthed], output: rowSchema, reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = await db.rawRead<AuthzRow>(',
      '      trustedSql(sql.raw("select id, label from phase5_pg_orders order by id"), { justification: "phase 5 postgres raw SQL RLS proof" }),',
      "      { reads: ['phase5_pg_orders'] },",
      '    );',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgSubqueryQuery = query({',
      '  access: [appAuthed], output: rowSchema, reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = await db.rawRead<AuthzRow>(',
      '      trustedSql(sql.raw("select id, label from (select id, label from phase5_pg_orders) scoped order by id"), { justification: "phase 5 postgres subquery RLS proof" }),',
      "      { reads: ['phase5_pg_orders'] },",
      '    );',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgUnionQuery = query({',
      '  access: [appAuthed], output: rowSchema, reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = await db.rawRead<AuthzRow>(',
      '      trustedSql(sql.raw("select id, label from phase5_pg_orders where id = \'phase5-pg-demo\' union all select id, label from phase5_pg_orders where id = \'phase5-pg-other\' order by id"), { justification: "phase 5 postgres union RLS proof" }),',
      "      { reads: ['phase5_pg_orders'] },",
      '    );',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgCteQuery = query({',
      '  access: [appAuthed], output: rowSchema, reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = await db.rawRead<AuthzRow>(',
      '      trustedSql(sql.raw("with scoped as (select id, label from phase5_pg_orders) select id, label from scoped order by id"), { justification: "phase 1 authorization matrix CTE RLS proof" }),',
      "      { reads: ['phase5_pg_orders'] },",
      '    );',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgAliasQuery = query({',
      '  access: [appAuthed],',
      '  output: rowSchema, reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      "    const owned = alias(phase5PgOrders, 'phase5_pg_orders_alias');",
      '    const rows = (await db.select({ id: owned.id, label: owned.label }).from(owned)) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgJoinQuery = query({',
      '  access: [appAuthed], output: rowSchema, reads: [orderDomain, itemDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = (await db',
      '      .select({ id: phase5PgItems.id, label: phase5PgItems.label })',
      '      .from(phase5PgItems)',
      '      .innerJoin(phase5PgOrders, eq(phase5PgItems.orderId, phase5PgOrders.id))) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgViewQuery = query({',
      '  access: [appAuthed],',
      '  output: rowSchema, reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = (await db.select({ id: phase5PgOrderView.id, label: phase5PgOrderView.label }).from(phase5PgOrderView)) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgFunctionQuery = query({',
      '  access: [appAuthed], output: rowSchema, reads: [orderDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = await db.rawRead<AuthzRow>(',
      '      trustedSql(sql.raw("select id, label from phase5_pg_order_function()"), { justification: "phase 1 authorization matrix security-invoker function proof" }),',
      "      { reads: ['phase5_pg_orders'] },",
      '    );',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'export const phase5PgOwnerViaQuery = query({',
      '  access: [appAuthed],',
      '  output: rowSchema, reads: [itemDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const rows = (await db.select({ id: phase5PgItems.id, label: phase5PgItems.label }).from(phase5PgItems)) as AuthzRow[];',
      '    return { items: rows };',
      '  },',
      '});',
      '',
      'async function phase5PgEventWrite(db: AppRequest["db"]) {',
      '    const eventId = crypto.randomUUID();',
      '    await db.insert(phase5PgEvents).values({',
      '      id: serverValue(eventId, "phase 5 postgres event id"),',
      '      label: "owner-visible",',
      '    });',
      '}',
      '',
      'export const phase5PgTaskRecord = mutation({',
      '  access: publicProof, csrf: false, csrfJustification: "internal task and webhook callers have no browser authority", input: proofInput,',
      "  registry: { tables: ['phase5_pg_events'], touches: [eventDomain] },",
      '  async handler(_input: { marker: string }, request: AppRequest) {',
      '    await phase5PgEventWrite(request.db);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      "export const phase5PgReadTask = task('phase5-pg/read-task', {",
      '  input: s.object({ id: s.string() }),',
      '  async run(input: { id: string }, context) {',
      '    const principal = context.actAs("demo-user");',
      '    await principal.runQuery(phase5PgTaskReadProofQuery, undefined);',
      '    await principal.runMutation(phase5PgTaskRecord, { marker: input.id });',
      '  },',
      '});',
      '',
      'export const phase5PgScheduleTask = mutation({',
      '  access: publicProof, csrf: appCsrf, input: proofInput,',
      "  registry: { tables: ['_kovo_jobs'], touches: [eventDomain] },",
      '  async handler(input: { marker: string }, request: AppRequest & TaskSchedulingRequest) {',
      '    await request.schedule(phase5PgReadTask, { id: `${input.marker}-task` });',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'async function phase5PgOwnOrderWrite(db: AppRequest["db"]) {',
      '    await db',
      '      .insert(phase5PgOrders)',
      '      .values({',
      '        classified: "own-secret",',
      '        id: serverValue("phase5-pg-endpoint-own", "phase 5 postgres endpoint own write id"),',
      '        label: "own-write-visible",',
      '        userId: "demo-user",',
      '      });',
      '}',
      '',
      'async function phase5PgCrossOwnerOrderWrite(db: AppRequest["db"]) {',
      '    await db.insert(phase5PgOrders).values({',
      '      classified: "cross-secret",',
      '      id: serverValue("phase5-pg-endpoint-cross", "phase 5 postgres endpoint cross write id"),',
      '      label: "blocked-cross-owner",',
      '      userId: "other-user",',
      '    });',
      '}',
      '',
      'export const phase5PgOwnOrderWriteProof = mutation({',
      '  access: [appAuthed],',
      '  csrf: appCsrf,',
      '  input: proofInput,',
      "  registry: { tables: ['phase5_pg_orders'], touches: [orderDomain] },",
      '  async handler(_input: { marker: string }, request: AppRequest) {',
      '    await phase5PgOwnOrderWrite(request.db);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const phase5PgCrossOwnerOrderWriteProof = mutation({',
      '  access: publicProof,',
      '  csrf: appCsrf,',
      '  input: proofInput,',
      "  registry: { tables: ['phase5_pg_orders'], touches: [orderDomain] },",
      '  async handler(_input: { marker: string }, request: AppRequest) {',
      '    await phase5PgCrossOwnerOrderWrite(request.db);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'async function phase5PgRawCrossOwnerOrderWrite(db: AppRequest["db"]) {',
      '    await db.insert(phase5PgOrders).values({',
      '      classified: "raw-cross-secret",',
      '      id: serverValue("phase5-pg-raw-cross", "phase 1 raw cross-owner id"),',
      '      label: "blocked-raw-cross-owner",',
      '      userId: trustedSql(sql.raw("\'other-user\'"), {',
      '        justification: "phase 1 authorization matrix audited raw owner expression",',
      '      }),',
      '    });',
      '}',
      '',
      'export const phase5PgRawCrossOwnerOrderWriteProof = mutation({',
      '  access: publicProof,',
      '  csrf: appCsrf,',
      '  input: proofInput,',
      "  registry: { tables: ['phase5_pg_orders'], touches: [orderDomain] },",
      '  async handler(_input: { marker: string }, request: AppRequest) {',
      '    await phase5PgRawCrossOwnerOrderWrite(request.db);',
      '    return { ok: true };',
      '  },',
      '});',
      '',
      "export const phase5PgEndpoint = endpoint('/api/phase5-pg-endpoint', {",
      '  access: publicProof, auth: { justification: "public phase 5 postgres endpoint proof", kind: "none" }, csrf: false, csrfJustification: "read-only phase 5 postgres endpoint proof", db: true,',
      '  async handler(request, context: EndpointDbContext<AppDb>) {',
      '    const scoped = await context.actAs("demo-user");',
      '    const db = scoped.db.read;',
      '    const family = new URL(request.url).search;',
      '    if (family === "?family=relational") {',
      '      const rows = await (db as any).query.phase5PgOrders.findMany({ columns: { id: true, label: true } });',
      '      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '    } else if (family === "?family=alias") {',
      '      const owned = alias(phase5PgOrders, "phase5_pg_endpoint_alias");',
      '      const rows = await db.select({ id: owned.id, label: owned.label }).from(owned);',
      '      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '    } else if (family === "?family=owner-via") {',
      '      const rows = await db.select({ id: phase5PgItems.id, label: phase5PgItems.label }).from(phase5PgItems);',
      '      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '    } else if (family === "?family=join") {',
      '      const rows = await db.select({ id: phase5PgItems.id, label: phase5PgItems.label }).from(phase5PgItems).innerJoin(phase5PgOrders, eq(phase5PgItems.orderId, phase5PgOrders.id));',
      '      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '    } else if (family === "?family=raw-sql") {',
      '      const rows = await db.rawRead<AuthzRow>(trustedSql(sql.raw("select id, label from phase5_pg_orders order by id"), { justification: "phase 5 postgres endpoint raw SQL RLS proof" }), { reads: ["phase5_pg_orders"] });',
      '      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '    } else if (family === "?family=subquery-in-from") {',
      '      const rows = await db.rawRead<AuthzRow>(trustedSql(sql.raw("select id, label from (select id, label from phase5_pg_orders) scoped order by id"), { justification: "phase 5 postgres endpoint subquery RLS proof" }), { reads: ["phase5_pg_orders"] });',
      '      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '    } else if (family === "?family=union") {',
      '      const rows = await db.rawRead<AuthzRow>(trustedSql(sql.raw("select id, label from phase5_pg_orders where id = \'phase5-pg-demo\' union all select id, label from phase5_pg_orders where id = \'phase5-pg-other\' order by id"), { justification: "phase 5 postgres endpoint union RLS proof" }), { reads: ["phase5_pg_orders"] });',
      '      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '    } else if (family === "?family=cte") {',
      '      const rows = await db.rawRead<AuthzRow>(trustedSql(sql.raw("with scoped as (select id, label from phase5_pg_orders) select id, label from scoped order by id"), { justification: "phase 1 authorization matrix endpoint CTE RLS proof" }), { reads: ["phase5_pg_orders"] });',
      '      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '    }',
      '    const rows = await db.select({ id: phase5PgOrders.id, label: phase5PgOrders.label }).from(phase5PgOrders);',
      '    return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '  },',
      "  method: 'GET', reason: 'phase 5 postgres endpoint proof', response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const phase5PgFunctionBoundaryEndpoint = endpoint('/api/phase5-pg-function-boundary', {",
      '  access: publicProof, auth: { justification: "public phase 1 function fail-closed proof", kind: "none" }, csrf: false, csrfJustification: "read-only phase 1 function fail-closed proof", db: true,',
      '  async handler(_request, context: EndpointDbContext<AppDb>) {',
      '    const scoped = await context.actAs("demo-user");',
      '    const functionRows = await scoped.db.read.rawRead<AuthzRow>(trustedSql(sql.raw("select id, label from phase5_pg_order_function()"), { justification: "phase 1 authorization matrix non-allowlisted function proof" }), { reads: ["phase5_pg_orders"] });',
      '    return Response.json({ functionRows }, { headers: { "Cache-Control": "no-store" } });',
      '  },',
      "  method: 'GET', reason: 'phase 1 function fail-closed proof', response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const phase5PgUnknownRelationEndpoint = endpoint('/api/phase5-pg-unknown-relation', {",
      '  access: publicProof, auth: { justification: "public phase 5 postgres unknown-relation proof", kind: "none" }, csrf: false, csrfJustification: "read-only phase 5 postgres unknown-relation proof", db: true,',
      '  async handler(_request, context: EndpointDbContext<AppDb>) {',
      '    const scoped = await context.actAs("demo-user");',
      '    const viewRows = await scoped.db.read.select({ id: phase5PgOrderView.id, label: phase5PgOrderView.label }).from(phase5PgOrderView);',
      '    return Response.json({ viewRows }, { headers: { "Cache-Control": "no-store" } });',
      '  },',
      "  method: 'GET', reason: 'phase 5 postgres unknown-relation proof', response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const phase5PgWriteBoundaryEndpoint = endpoint('/api/phase5-pg-write-boundary', {",
      '  access: publicProof, auth: { justification: "public phase 5 postgres write boundary proof", kind: "none" }, csrf: false, csrfJustification: "phase 5 postgres write boundary proof", db: true,',
      '  async handler(_request, context: EndpointDbContext<AppDb>) {',
      '    const ownerScoped = await context.actAs("demo-user");',
      '    const otherScoped = await context.actAs("other-user");',
      '    const ownerRows = await ownerScoped.db.read.select({ id: phase5PgOrders.id }).from(phase5PgOrders).where(eq(phase5PgOrders.id, "phase5-pg-endpoint-own"));',
      '    const crossRows = await otherScoped.db.read.select({ id: phase5PgOrders.id }).from(phase5PgOrders).where(eq(phase5PgOrders.id, "phase5-pg-endpoint-cross"));',
      '    const rawCrossRows = await otherScoped.db.read.select({ id: phase5PgOrders.id }).from(phase5PgOrders).where(eq(phase5PgOrders.id, "phase5-pg-raw-cross"));',
      '    let verificationDenied = false;',
      '    try {',
      '      await otherScoped.db.read.rawRead<{ id: string }>(trustedSql(sql.raw("select id from verification"), { justification: "phase 5 postgres endpoint auth-table denial proof" }), { reads: ["verification"] });',
      '    } catch { verificationDenied = true; }',
      '    return Response.json({ crossOwnerDenied: crossRows.length === 0, ownWriteVisible: ownerRows.length === 1, rawCrossOwnerDenied: rawCrossRows.length === 0, verificationDenied }, { headers: { "Cache-Control": "no-store" } });',
      '  },',
      "  method: 'GET', reason: 'phase 5 postgres write boundary proof', response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      'export const phase5PgStatusQuery = query({',
      '  access: publicProof,',
      '  output: s.object({',
      '    builderSecretReadBlocked: s.boolean(),',
      '    events: s.array(s.object({ id: s.string(), label: s.string() })),',
      '    readonlyRows: s.array(s.object({ id: s.string(), label: s.string() })),',
      '    secretReadBlocked: s.boolean(),',
      '  }),',
      '  reads: [orderDomain, eventDomain],',
      '  async load(_input: unknown, context?: Phase5PgQueryContext) {',
      '    assertPhase5PgDb(context);',
      '    const db = context.db;',
      '    const readonlyRows = await db.select({ id: phase5PgOrders.id, label: phase5PgOrders.label }).from(phase5PgOrders);',
      '    const events = await db.select({ id: phase5PgEvents.id, label: phase5PgEvents.label }).from(phase5PgEvents);',
      '    let builderSecretReadBlocked = false;',
      '    let secretReadBlocked = false;',
      '    try {',
      '      await db.select({ classified: phase5PgOrders.classified }).from(phase5PgOrders);',
      '    } catch { builderSecretReadBlocked = true; }',
      '    try {',
      '      await db.rawRead<{ classified: string }>(trustedSql(sql.raw("select classified from phase5_pg_orders"), { justification: "phase 5 postgres secret-column proof" }), { reads: ["phase5_pg_orders"] });',
      '    } catch { secretReadBlocked = true; }',
      '    return { builderSecretReadBlocked, events, readonlyRows, secretReadBlocked };',
      '  },',
      '});',
      '',
      'const webhookReplayStore = appRuntimeWebhookReplayStore;',
      "export const phase5PgWebhook = webhook('/webhooks/phase5-pg-read', {",
      '  access: publicProof, idempotency: (input) => webhookReplayIdentity(input.id, input.occurredAtMs), input: s.object({ id: s.string(), occurredAtMs: s.number().int() }), replayStore: webhookReplayStore, verify: "none", verifyJustification: "local phase 5 postgres webhook proof", writes: [eventDomain],',
      '  async handler(input, context) {',
      '    const principal = context.actAs("demo-user");',
      '    await principal.runMutation(phase5PgTaskRecord, { marker: input.id });',
      '    return { ok: true };',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/paranoid-phase5-postgres-proof-forms.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { mutationFormAttributes } from '@kovojs/server';",
      '',
      "import { phase5PgCrossOwnerOrderWriteProof, phase5PgOwnOrderWriteProof, phase5PgRawCrossOwnerOrderWriteProof, phase5PgScheduleTask } from './paranoid-phase5-postgres-proof.js';",
      '',
      'export const Phase5PostgresProofForms = component({',
      '  mutations: {',
      '    phase5PgCrossOwnerOrderWriteProof,',
      '    phase5PgOwnOrderWriteProof,',
      '    phase5PgRawCrossOwnerOrderWriteProof,',
      '    phase5PgScheduleTask,',
      '  },',
      '  render: () => (',
      '    <div hidden>',
      '      <form {...mutationFormAttributes(phase5PgCrossOwnerOrderWriteProof)} />',
      '      <form {...mutationFormAttributes(phase5PgOwnOrderWriteProof)} />',
      '      <form {...mutationFormAttributes(phase5PgRawCrossOwnerOrderWriteProof)} />',
      '      <form {...mutationFormAttributes(phase5PgScheduleTask)} />',
      '    </div>',
      '  ),',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  const importLine =
    "import { phase5PgAliasQuery, phase5PgBuilderQuery, phase5PgCrossOwnerOrderWriteProof, phase5PgCteQuery, phase5PgDbQueryQuery, phase5PgEndpoint, phase5PgFunctionBoundaryEndpoint, phase5PgFunctionQuery, phase5PgJoinQuery, phase5PgOwnerViaQuery, phase5PgOwnOrderWriteProof, phase5PgRawCrossOwnerOrderWriteProof, phase5PgRawQuery, phase5PgReadTask, phase5PgScheduleTask, phase5PgStatusQuery, phase5PgSubqueryQuery, phase5PgUnionQuery, phase5PgUnknownRelationEndpoint, phase5PgViewQuery, phase5PgWebhook, phase5PgWriteBoundaryEndpoint } from './paranoid-phase5-postgres-proof.js';";
  app = replaceRequired(
    app,
    "import { appTheme } from './theme.js';",
    [
      importLine,
      "import { Phase5PostgresProofForms } from './paranoid-phase5-postgres-proof-forms.js';",
      "import { appTheme } from './theme.js';",
    ].join('\n'),
    'phase 5 postgres app import',
  );
  app = replaceRequired(
    app,
    '      <ContactsRegion />',
    '      <ContactsRegion />\n      <Phase5PostgresProofForms />',
    'phase 5 postgres protected proof forms',
  );
  for (const endpointEntry of [
    'phase5PgEndpoint',
    'phase5PgFunctionBoundaryEndpoint',
    'phase5PgUnknownRelationEndpoint',
    'phase5PgWebhook',
    'phase5PgWriteBoundaryEndpoint',
  ]) {
    app = appendArrayEntry(app, 'endpoints', endpointEntry);
  }
  for (const mutationEntry of [
    'phase5PgCrossOwnerOrderWriteProof',
    'phase5PgOwnOrderWriteProof',
    'phase5PgRawCrossOwnerOrderWriteProof',
    'phase5PgScheduleTask',
  ]) {
    app = appendArrayEntry(app, 'mutations', mutationEntry);
  }
  app = appendArrayEntry(app, 'queries', 'phase5PgStatusQuery');
  app = app.includes('tasks: [')
    ? appendArrayEntry(app, 'tasks', 'phase5PgReadTask')
    : replaceRequired(
        app,
        '  routes: [',
        '  tasks: [phase5PgReadTask],\n  routes: [',
        'phase 5 postgres task registration',
      );
  writeFileSync(appPath, app, 'utf8');
}

export function addPostgresParanoidFollowup8Shapes(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  let schema = readFileSync(schemaPath, 'utf8');
  schema = replaceRequired(
    schema,
    "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    [
      'export const phase5PgReferenceMemberships = pgTable(',
      "  'phase5_pg_reference_memberships',",
      '  {',
      "    id: text('id').primaryKey(),",
      "    teamId: text('team_id').notNull(),",
      "    userId: text('user_id').notNull(),",
      "    label: text('label').notNull(),",
      '  },',
      '  kovo({',
      "    domain: 'phase5-pg-reference-membership',",
      "    key: 'id',",
      "    owner: 'userId',",
      '  }),',
      ');',
      '',
      "/** Tables Better Auth's Drizzle adapter binds to (see `src/auth.ts`). */",
    ].join('\n'),
    'phase 5 postgres followup 8 schema tables',
  );
  writeFileSync(schemaPath, schema, 'utf8');

  const runtimeDbOptionsPath = join(root, 'src/_kovo/app-runtime-db-options.ts');
  let runtimeDbOptions = readFileSync(runtimeDbOptionsPath, 'utf8');
  runtimeDbOptions = replaceRequired(
    runtimeDbOptions,
    '  "GRANT SELECT ON phase5_pg_order_view TO kovo_reader;",',
    [
      '  "GRANT SELECT ON phase5_pg_order_view TO kovo_reader;",',
      "  \"INSERT INTO phase5_pg_reference_memberships (id, team_id, user_id, label) VALUES ('phase5-pg-membership-demo', 'team-demo', 'demo-user', 'owner-membership'), ('phase5-pg-membership-other', 'team-other', 'other-user', 'cross-tenant-membership') ON CONFLICT (id) DO NOTHING;\",",
    ].join('\n'),
    'phase 5 postgres followup 8 seed registration',
  );
  writeFileSync(runtimeDbOptionsPath, runtimeDbOptions, 'utf8');

  const proofPath = join(root, 'src/paranoid-phase5-postgres-proof.ts');
  let proof = readFileSync(proofPath, 'utf8');
  proof = replaceRequired(
    proof,
    "import { phase5PgEvents, phase5PgItems, phase5PgOrders } from './schema.js';",
    "import { phase5PgEvents, phase5PgItems, phase5PgOrders, phase5PgReferenceMemberships } from './schema.js';",
    'phase 5 postgres followup 8 proof import',
  );
  proof = replaceRequired(
    proof,
    'const webhookReplayStore = appRuntimeWebhookReplayStore;',
    [
      "export const phase5PgReferenceMembershipEndpoint = endpoint('/api/phase5-pg-reference-memberships', {",
      '  access: publicProof, auth: { justification: "public phase 5 postgres reference-membership proof", kind: "none" }, csrf: false, csrfJustification: "read-only phase 5 postgres reference-membership proof", db: true,',
      '  async handler(_request, context: EndpointDbContext<AppDb>) {',
      '    const scoped = await context.actAs("demo-user");',
      '    const rows = await scoped.db.read.select({',
      '      id: phase5PgReferenceMemberships.id,',
      '      label: phase5PgReferenceMemberships.label,',
      '      teamId: phase5PgReferenceMemberships.teamId,',
      '      userId: phase5PgReferenceMemberships.userId,',
      '    }).from(phase5PgReferenceMemberships).orderBy(phase5PgReferenceMemberships.id);',
      '    return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });',
      '  },',
      "  method: 'GET', reason: 'phase 5 postgres reference-membership proof', response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      'const webhookReplayStore = appRuntimeWebhookReplayStore;',
    ].join('\n'),
    'phase 5 postgres followup 8 endpoint insertion',
  );
  writeFileSync(proofPath, proof, 'utf8');

  const appPath = join(root, 'src/app.tsx');
  let app = readFileSync(appPath, 'utf8');
  app = replaceRequired(
    app,
    "import { phase5PgAliasQuery, phase5PgBuilderQuery, phase5PgCrossOwnerOrderWriteProof, phase5PgCteQuery, phase5PgDbQueryQuery, phase5PgEndpoint, phase5PgFunctionBoundaryEndpoint, phase5PgFunctionQuery, phase5PgJoinQuery, phase5PgOwnerViaQuery, phase5PgOwnOrderWriteProof, phase5PgRawCrossOwnerOrderWriteProof, phase5PgRawQuery, phase5PgReadTask, phase5PgScheduleTask, phase5PgStatusQuery, phase5PgSubqueryQuery, phase5PgUnionQuery, phase5PgUnknownRelationEndpoint, phase5PgViewQuery, phase5PgWebhook, phase5PgWriteBoundaryEndpoint } from './paranoid-phase5-postgres-proof.js';",
    "import { phase5PgAliasQuery, phase5PgBuilderQuery, phase5PgCrossOwnerOrderWriteProof, phase5PgCteQuery, phase5PgDbQueryQuery, phase5PgEndpoint, phase5PgFunctionBoundaryEndpoint, phase5PgFunctionQuery, phase5PgJoinQuery, phase5PgOwnerViaQuery, phase5PgOwnOrderWriteProof, phase5PgRawCrossOwnerOrderWriteProof, phase5PgRawQuery, phase5PgReadTask, phase5PgReferenceMembershipEndpoint, phase5PgScheduleTask, phase5PgStatusQuery, phase5PgSubqueryQuery, phase5PgUnionQuery, phase5PgUnknownRelationEndpoint, phase5PgViewQuery, phase5PgWebhook, phase5PgWriteBoundaryEndpoint } from './paranoid-phase5-postgres-proof.js';",
    'phase 5 postgres followup 8 app import',
  );
  app = appendArrayEntry(app, 'endpoints', 'phase5PgReferenceMembershipEndpoint');
  writeFileSync(appPath, app, 'utf8');
}

export async function signInDemoUser(
  root: string,
  origin: string,
  jar: Map<string, string>,
  output: () => string,
  requestOrigin = origin,
): Promise<void> {
  await fetchTextWhenReady(`${origin}/login`, output);
  const loginResponse = await fetch(`${origin}/login`);
  mergeCookies(jar, loginResponse.headers.getSetCookie());
  const loginHtml = await loginResponse.text();
  const loginCsrf = fieldValue(loginHtml, 'csrf');
  const loginIdem = fieldValue(loginHtml, 'Kovo-Idem');
  const demoPassword =
    new RegExp(`^${demoPasswordEnvVar}=(.+)$`, 'm').exec(
      readFileSync(join(root, '.env'), 'utf8'),
    )?.[1] ?? '';
  expect(loginCsrf).toBeTruthy();
  expect(demoPassword).toBeTruthy();

  const signIn = await fetch(`${origin}/_m/auth/sign-in`, {
    body: new URLSearchParams({
      csrf: loginCsrf,
      email: 'demo@example.com',
      'Kovo-Idem': loginIdem,
      next: '/',
      password: demoPassword,
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      origin: requestOrigin,
    },
    method: 'POST',
    redirect: 'manual',
  });
  mergeCookies(jar, signIn.headers.getSetCookie());
  const signInBody = await signIn.text();
  expect(signIn.status, `${signInBody}\n${output()}`).toBe(303);
}

export function execFileSyncErrorOutput(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const maybeOutput = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return [maybeOutput.stdout, maybeOutput.stderr, maybeOutput.message]
    .map(formatErrorOutputPart)
    .join('\n');
}

function formatErrorOutputPart(value: unknown): string {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Error) return value.message;
  return JSON.stringify(value) ?? '';
}

export async function waitForTcpPort(
  host: string,
  port: number,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection({ host, port });
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('error', reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const cause = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Timed out waiting for ${host}:${port} to accept TCP connections: ${cause}\n${output()}`,
  );
}

export function formHtmlByAction(html: string, action: string): string {
  const escaped = escapeRegExp(action);
  const match = new RegExp(`<form\\b(?=[^>]*\\baction="${escaped}")[\\s\\S]*?</form>`, 'i').exec(
    html,
  );
  if (!match?.[0]) throw new Error(`Expected form action ${action}.`);
  return match[0];
}

export function firstFormHtml(html: string): string {
  const match = /<form\b[\s\S]*?<\/form>/i.exec(html);
  if (!match?.[0]) throw new Error('Expected a form.');
  return match[0];
}

export function elementOpeningTagByAttribute(html: string, name: string, value: string): string {
  const escapedName = escapeRegExp(name);
  const escapedValue = escapeRegExp(value);
  const match = new RegExp(
    `<[A-Za-z][A-Za-z0-9:-]*\\b(?=[^>]*\\b${escapedName}="${escapedValue}")[^>]*>`,
    'i',
  ).exec(html);
  if (!match?.[0]) throw new Error(`Expected element with ${name}=${value}.`);
  return match[0];
}

export function fieldValue(html: string, name: string): string {
  const value = attributeValue(elementOpeningTagByAttribute(html, 'name', name), 'value');
  if (value === undefined) throw new Error(`Expected field value for ${name}.`);
  return value;
}

export function attributeValue(html: string, name: string): string | undefined {
  const escaped = escapeRegExp(name);
  const match = new RegExp(`\\b${escaped}="([^"]*)"`).exec(html);
  return match?.[1];
}

function replaceRequired(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  if (!source.includes(search)) throw new Error(`Expected scaffold anchor for ${label}.`);
  return source.replace(search, replacement);
}

function addNamedImportSpecifiersRequired(
  source: string,
  moduleSpecifier: string,
  requiredSpecifiers: readonly string[],
  addedSpecifiers: readonly string[],
  label: string,
): string {
  // Scaffold formatting can move a named import between one and many lines as bindings change.
  // Match the declaration shape while still requiring the bindings that make the proof valid.
  const importPattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*(['"])${escapeRegExp(moduleSpecifier)}\\2;`,
    'gu',
  );
  const matches = [...source.matchAll(importPattern)];
  if (matches.length !== 1 || matches[0]?.index === undefined) {
    throw new Error(`Expected one named scaffold import for ${label}.`);
  }

  const match = matches[0];
  const existingSpecifiers = (match[1] ?? '')
    .split(',')
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier.length > 0);
  if (existingSpecifiers.some((specifier) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(specifier))) {
    throw new Error(`Expected simple named scaffold specifiers for ${label}.`);
  }
  for (const requiredSpecifier of requiredSpecifiers) {
    if (!existingSpecifiers.includes(requiredSpecifier)) {
      throw new Error(
        `Expected scaffold import ${moduleSpecifier} to include ${requiredSpecifier} for ${label}.`,
      );
    }
  }

  const mergedSpecifiers = [...existingSpecifiers];
  for (const addedSpecifier of addedSpecifiers) {
    if (!mergedSpecifiers.includes(addedSpecifier)) mergedSpecifiers.push(addedSpecifier);
  }
  const quote = match[2] ?? "'";
  const replacement = `import { ${mergedSpecifiers.join(', ')} } from ${quote}${moduleSpecifier}${quote};`;
  return `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`;
}

function assertRequiredScaffoldAnchor(source: string, search: string, label: string): void {
  if (!source.includes(search)) throw new Error(`Expected scaffold anchor for ${label}.`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
