import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';

import { expect } from 'vitest';

import { demoPasswordEnvVar } from './index.js';
import {
  cookieHeader,
  fetchTextWhenReady,
  mergeCookies,
  withStarterBinOnPath,
} from './index.test-support.js';

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
      'const defaultSlots: BlockTitleSlots = { forms: { blockTitle: { failure: null } } };',
      '',
      'export const NoJsFailureProof = component({',
      '  mutations: { blockTitle },',
      '  render: (_queries, _state, slots: BlockTitleSlots = defaultSlots) => {',
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

export function buildProductionArtifact(root: string): void {
  // CI restores **/.kovo/cache, so this prod-artifact gate must prove current source, not cache.
  rmSync(join(root, '.kovo/cache'), { force: true, recursive: true });
  execFileSync(join(root, 'node_modules/.bin/kovo'), ['build', './src/app.tsx', '--no-cache'], {
    cwd: root,
    env: withStarterBinOnPath(root),
    stdio: 'pipe',
  });
}

export function addStorageQueryWriteProof(root: string): void {
  const queriesPath = join(root, 'src/queries.ts');
  let queries = readFileSync(queriesPath, 'utf8');
  queries = replaceRequired(
    queries,
    "import { query, type QueryLoadContext, type Reader } from '@kovojs/server';",
    "import { createMemoryStorage, publicAccess, query, s, type QueryLoadContext, type Reader } from '@kovojs/server';",
    'storage query write proof import',
  );
  queries = replaceRequired(
    queries,
    'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
    [
      'type AppQueryLoadContext = QueryLoadContext<AppQueryRequest, AppDb>;',
      '',
      'const storageWriteProbe = createMemoryStorage();',
      '',
      'const uploadStorageWriteProbe = {',
      '  upload: storageWriteProbe.put.bind(storageWriteProbe),',
      '};',
      '',
      'export const storagePutWriteQuery = query({',
      "  access: publicAccess('storage put write query proof'),",
      '  reads: [],',
      '  async load(): Promise<{ ok: true }> {',
      "    await storageWriteProbe.put('receipts/query-write-proof.txt', 'bad');",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const storageDeleteWriteQuery = query({',
      "  access: publicAccess('storage delete write query proof'),",
      '  reads: [],',
      '  async load(): Promise<{ ok: true }> {',
      "    await storageWriteProbe.delete('receipts/query-delete-proof.txt');",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const storageComputedWriteQuery = query({',
      "  access: publicAccess('storage computed write query proof'),",
      '  reads: [],',
      '  async load(): Promise<{ ok: true }> {',
      "    const method = 'put' as string;",
      '    const storage = storageWriteProbe as unknown as Record<string, (key: string, body: string) => Promise<unknown>>;',
      "    await storage[method]!('receipts/query-computed-proof.txt', 'bad');",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const storageFileStoreWriteQuery = query({',
      "  access: publicAccess('storage file store write query proof'),",
      '  reads: [],',
      '  async load(): Promise<{ ok: true }> {',
      "    const schema = s.file().store({ keyPrefix: 'receipts', storage: storageWriteProbe });",
      "    await schema.parseAsync(new File(['bad'], 'query-store-proof.txt', { type: 'text/plain' }));",
      '    return { ok: true };',
      '  },',
      '});',
      '',
      'export const storageUploadWriteQuery = query({',
      "  access: publicAccess('storage upload write query proof'),",
      '  reads: [],',
      '  async load(): Promise<{ ok: true }> {',
      "    await uploadStorageWriteProbe.upload('receipts/query-upload-proof.txt', 'bad');",
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
    "import { contactsQuery, storageComputedWriteQuery, storageDeleteWriteQuery, storageFileStoreWriteQuery, storagePutWriteQuery, storageUploadWriteQuery } from './queries.js';",
    'storage query write proof app import',
  );
  app = replaceRequired(
    app,
    '  queries: [contactsQuery],',
    '  queries: [contactsQuery, storageComputedWriteQuery, storageDeleteWriteQuery, storageFileStoreWriteQuery, storagePutWriteQuery, storageUploadWriteQuery],',
    'storage query write proof app registration',
  );
  writeFileSync(appPath, app, 'utf8');
}

export function addStorageMutationWriteProof(root: string): void {
  writeFileSync(
    join(root, 'src/storage-mutation-proof.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { createMemoryStorage, mutation, publicAccess, s } from '@kovojs/server';",
      '',
      'const storageMutationProof = createMemoryStorage();',
      "await storageMutationProof.put('receipts/delete-target.txt', 'delete target');",
      "const publicProof = publicAccess('public storage mutation capability proof');",
      '',
      'export const storageMutationWrite = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
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
  options: { declareTables?: boolean; trusted?: boolean } = {},
): void {
  const declareTables = options.declareTables !== false;
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
    "import { guards, mutation, s, serverValue, type MutationContext } from '@kovojs/server';",
    [
      options.trusted
        ? "import { sql, trustedSql } from '@kovojs/drizzle';"
        : "import { sql } from '@kovojs/drizzle';",
      "import { domain, guards, mutation, s, serverValue, type MutationContext } from '@kovojs/server';",
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
  mutations = replaceRequired(
    mutations,
    'registry: { touches: [contact] },',
    declareTables
      ? "registry: { touches: [contact, rawOwner], tables: ['raw_owners'] },"
      : 'registry: { touches: [contact, rawOwner] },',
    'raw SQL proof mutation registry',
  );
  mutations = replaceRequired(
    mutations,
    [
      '  await db',
      '    .insert(contacts)',
      "    .values({ id: serverValue(id, 'server-generated contact id'), name, email, company });",
    ].join('\n'),
    [
      `  await db.${rawSqlMethod}(`,
      options.trusted
        ? "    trustedSql(sql`update raw_owners set label = ${company} where id = ${serverValue(id, 'server-generated contact id')}`, { justification: 'reviewed owner predicate' }),"
        : "    sql`update raw_owners set label = ${company} where id = ${serverValue(id, 'server-generated contact id')}`,",
      '  );',
      '  await db',
      '    .insert(contacts)',
      "    .values({ id: serverValue(id, 'server-generated contact id'), name, email, company });",
    ].join('\n'),
    'raw SQL proof contact insert anchor',
  );
  writeFileSync(mutationsPath, mutations, 'utf8');
}

export interface RuntimeMutationSafetyProofOptions {
  includeManagedWriteEscapeAttempt?: boolean;
  includeRawTableDrift?: boolean;
  includeReadonlyMutationAttempt?: boolean;
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
        '});',
        '',
        `export const rawRuntimeDrift = ${tableFactory}('raw_runtime_drift', {`,
        "  id: text('id').primaryKey(),",
        "  label: text('label').notNull().default(''),",
        '});',
        '',
        '// --- Auth infrastructure',
      ].join('\n'),
    ),
    'utf8',
  );

  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db.ts');
  const runtimeDbSource = readFileSync(runtimeDbPath, 'utf8');
  const runtimeDb = isSqlite
    ? runtimeDbSource.replace(
        '  "CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL DEFAULT \'\');",\n  // Better Auth tables',
        [
          '  "CREATE TABLE contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, company text NOT NULL DEFAULT \'\');",',
          '  "CREATE TABLE tx_proofs (id text PRIMARY KEY);",',
          '  "CREATE TABLE raw_runtime_drift (id text PRIMARY KEY, label text NOT NULL DEFAULT \'\');",',
          '  // Better Auth tables',
        ].join('\n'),
      )
    : runtimeDbSource
        .replace(
          "import { account, contacts, session, user, verification } from '../schema.js';",
          [
            'import {',
            '  account,',
            '  contacts,',
            '  rawRuntimeDrift,',
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
      "import { createMemoryWebhookReplayStore, domain, endpoint, mutation, publicAccess, s, webhook, write, type MutationContext } from '@kovojs/server';",
      '',
      "import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js';",
      "import { readonlyAppDb } from './db.js';",
      "import { rawRuntimeDrift, txProofs } from './schema.js';",
      "import type { AppRequest } from './auth.js';",
      '',
      'const runtimeTableDriftError = s.object({ message: s.string() });',
      "const publicProof = publicAccess('public production mutation safety regression proof');",
      "const txProof = domain('tx_proof');",
      ...(includeWebhookTransactionProof || includeWebhookTxEscapeAttempt
        ? [
            'const webhookReplayStore = createMemoryWebhookReplayStore();',
            'const webhookTxProofInput = s.object({ id: s.string() });',
          ]
        : []),
      ...(includeRawTableDrift
        ? ["const rawRuntimeDriftDomain = domain('raw_runtime_drift');"]
        : []),
      '',
      "async function insertTxProofRow(db: AppRequest['db'], id: string) {",
      '  await db.insert(txProofs).values({ id });',
      '}',
      '',
      ...(includeManagedWriteEscapeAttempt
        ? [
            'type ManagedWriteEscapeResult = { blocked: boolean; message: string; method: string };',
            '',
            'function managedWriteEscapeResult(',
            '  method: string,',
            '  run: () => unknown,',
            '): ManagedWriteEscapeResult {',
            '  try {',
            '    void run();',
            "    return { blocked: false, message: 'raw driver escape reached managed write handle', method };",
            '  } catch (error) {',
            '    const message = error instanceof Error ? error.message : String(error);',
            '    const blocked = /raw driver escape|KV422/u.test(message);',
            '    return { blocked, message, method };',
            '  }',
            '}',
            '',
            'function attemptManagedWriteClientEscape(request: AppRequest): ManagedWriteEscapeResult {',
            "  return managedWriteEscapeResult('$client', () => {",
            '    void (request.db as unknown as { $client: unknown }).$client;',
            '  });',
            '}',
            '',
            'function attemptManagedWriteSessionEscape(request: AppRequest): ManagedWriteEscapeResult {',
            "  return managedWriteEscapeResult('session', () => {",
            '    void (request.db as unknown as { session: unknown }).session;',
            '  });',
            '}',
            '',
            'export const managedWriteEscapeAttempt = mutation({',
            '  access: publicProof,',
            '  csrf: false,',
            '  input: s.object({ id: s.string() }),',
            "  registry: { tables: ['tx_proofs'], touches: [txProof] },",
            '  async handler(input: { id: string }, request: AppRequest) {',
            '    const results = [',
            '      attemptManagedWriteClientEscape(request),',
            '      attemptManagedWriteSessionEscape(request),',
            '    ];',
            '    if (!results.every((result) => result.blocked)) {',
            "      throw new Error(results.map((result) => `${result.method}: ${result.message}`).join('\\n'));",
            '    }',
            '    await insertTxProofRow(request.db, input.id);',
            '    return { blocked: true, results };',
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
      '  csrf: false,',
      '  input: s.object({ id: s.string() }),',
      '  registry: { touches: [txProof] },',
      '  async handler(input: { id: string }, request: AppRequest) {',
      '    await insertTxProofRow(request.db, input.id);',
      "    throw new Error('rollback proof');",
      '  },',
      '});',
      '',
      'export const writeTxProof = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
      '  input: s.object({ id: s.string() }),',
      '  registry: { touches: [txProof] },',
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
            '  idempotency: (input) => input.id,',
            '  input: webhookTxProofInput,',
            '  replayStore: webhookReplayStore,',
            '  async transaction(_context, run) {',
            '    return run(appRuntimeDbProvider());',
            '  },',
            "  verify: 'none',",
            "  verifyJustification: 'local production webhook transaction proof fixture',",
            '  writes: [txProof],',
            '  async handler(input, context) {',
            '    await context.runMutation(writeTxProof, { id: input.id });',
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
            '  idempotency: (input) => input.id,',
            '  input: webhookTxProofInput,',
            '  replayStore: webhookReplayStore,',
            '  async transaction(_context, run) {',
            '    return run(appRuntimeDbProvider());',
            '  },',
            "  verify: 'none',",
            "  verifyJustification: 'local production webhook transaction proof fixture',",
            '  writes: [txProof],',
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
            '  csrf: false,',
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
      "export const txProofCountEndpoint = endpoint('/api/tx-proof-count', {",
      '  access: publicProof,',
      "  auth: { justification: 'public transaction rollback proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only transaction rollback proof',",
      '  async handler() {',
      '    const rows = await readonlyAppDb.select().from(txProofs);',
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
      '  async handler() {',
      '    const rows = await readonlyAppDb.select().from(rawRuntimeDrift);',
      "    return Response.json({ count: rows.length }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only runtime raw-SQL allowlist proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
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
    ].join('\n'),
    'utf8',
  );

  const runtimeSafetyImports = [
    'failAfterWrite',
    ...(includeManagedWriteEscapeAttempt ? ['managedWriteEscapeAttempt'] : []),
    ...(includeReadonlyMutationAttempt ? ['readonlyMutationAttemptEndpoint'] : []),
    'rawRuntimeDriftCountEndpoint',
    ...(includeRawTableDrift ? ['rawTableDrift'] : []),
    ...(includeWebhookTransactionProof ? ['txProofWebhook'] : []),
    ...(includeWebhookTxEscapeAttempt ? ['webhookTxEscapeAttempt'] : []),
    'txProofCountEndpoint',
    'writeTxProof',
  ];
  const runtimeSafetyEndpoints = [
    'healthEndpoint',
    'txProofCountEndpoint',
    'rawRuntimeDriftCountEndpoint',
    ...(includeReadonlyMutationAttempt ? ['readonlyMutationAttemptEndpoint'] : []),
    ...(includeWebhookTransactionProof ? ['txProofWebhook'] : []),
    ...(includeWebhookTxEscapeAttempt ? ['webhookTxEscapeAttempt'] : []),
  ];
  const runtimeSafetyMutations = [
    'addContact',
    'failAfterWrite',
    ...(includeManagedWriteEscapeAttempt ? ['managedWriteEscapeAttempt'] : []),
    ...(includeRawTableDrift ? ['rawTableDrift'] : []),
    'writeTxProof',
    'appSignIn',
    'appSignOut',
  ];

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
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
    );
  writeFileSync(appPath, app, 'utf8');
}

export function addInternalHtmlImportProof(root: string): void {
  writeFileSync(
    join(root, 'src/raw-helper.ts'),
    [
      "import { renderedHtml } from '@kovojs/server/internal/html';",
      '',
      'export const rawUnescaped = (markup: string) => renderedHtml(markup);',
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
        "import { rawUnescaped } from './raw-helper.js';",
      ].join('\n'),
    )
    .replace(
      '// Fail fast on schema/seed errors, then seed the local demo account when the',
      [
        'void rawUnescaped;',
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
      "import * as browserTrust from '@kovojs/browser';",
      "import { trustedHtml, trustedUrl } from '@kovojs/browser';",
      "import { component } from '@kovojs/core';",
      ...(unsafe ? ["import { renderedHtml } from '@kovojs/server/internal/html';"] : []),
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
    ['function HomePage({ request }: { request: AppRequest }): string {', '  return ('].join('\n'),
    [
      "const dynamicTrustedUrlKey: 'trustedUrl' = 'trustedUrl';",
      "const dynamicTrustedHtmlKey: 'trustedHtml' = 'trustedHtml';",
      '',
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
      unsafe
        ? '      <a href={browserTrust[dynamicTrustedUrlKey](data.contacts.items[0]?.email ?? "")}>'
        : '      <a href={trustedUrl(data.contacts.items[0]?.email ?? "", "server-reviewed dynamic contact mailto route")}>',
      '        Dynamic unsafe URL',
      '      </a>',
      unsafe
        ? '      {renderedHtml(data.contacts.items.map((contact) => contact.name).join(""))}'
        : '      <section>static trusted output proof</section>',
      unsafe
        ? '      {trustedHtml(slots.request?.headers.get("x-proof") ?? "")}'
        : '      {trustedHtml(slots.request?.headers.get("x-proof") ?? "", "reviewed trusted output request header")}',
      unsafe
        ? '      {browserTrust[dynamicTrustedHtmlKey](slots.request?.headers.get("x-dynamic-proof") ?? "")}'
        : '      {trustedHtml(slots.request?.headers.get("x-dynamic-proof") ?? "", "reviewed dynamic trusted output request header")}',
      '    </main>',
      '  ),',
      '});',
      '',
      'function HomePage({ request }: { request: AppRequest }): string {',
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
      '    rows: Array.from({ length: 4 }, (_, id) => ({ id, label: `item-${id}` })),',
      '  }),',
      '  reads: [runtimeRows],',
      '});',
      '',
      'export const refreshWarningItems = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
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
      '    } catch (error) {',
      '      return { ok: true, message: error instanceof Error ? error.message : String(error) };',
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
  const unsafeQueryNames = [
    'authSecretDirectLeakQuery',
    'authSecretTransformedLeakQuery',
    'authSecretRenderLeakQuery',
    'authSecretLeakQuery',
  ];
  const appQueryNames = leakToWire ? unsafeQueryNames : ['authSecretLeakQuery'];
  const appQueryProps = appQueryNames.map((_name, index) => `secrets${index}`);
  const queriesPath = join(root, 'src/queries.ts');
  const queries = readFileSync(queriesPath, 'utf8')
    .replace(
      "import { query, type QueryLoadContext, type Reader } from '@kovojs/server';",
      [
        "import { domain, query, type QueryLoadContext, type Reader } from '@kovojs/server';",
        "import { eq } from 'drizzle-orm';",
      ].join('\n'),
    )
    .replace(
      "import { contacts } from './schema.js';",
      "import { account, contacts } from './schema.js';",
    )
    .replace(
      'export interface ContactListResult {\n  items: ContactRow[];\n}',
      [
        'export interface ContactListResult {',
        '  items: ContactRow[];',
        '}',
        '',
        'export interface AuthSecretLeakResult {',
        '  items: { accessToken: string | null; id: string; password: string | null }[];',
        '}',
      ].join('\n'),
    )
    .replace(
      '// SPEC §9.4 (MARQUEE): the framework provides `context.db` as the read-only managed handle.',
      [
        ...(leakToWire
          ? [
              'export const authSecretDirectLeakQuery = query({',
              "  access: { guards: [{ guard: appAuthed, name: 'appAuthed' }], kind: 'guard-chain' },",
              '  guard: appAuthed,',
              "  reads: [domain('auth')],",
              '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
              '    const db = requireDb(context);',
              "    const userId = context?.request.session?.user.id ?? '';",
              '    const items = await db',
              '      .select({',
              '        accessToken: account.accessToken,',
              '        id: account.id,',
              '        password: account.password,',
              '      })',
              '      .from(account)',
              '      .where(eq(account.userId, userId));',
              '    return { items };',
              '  },',
              '});',
              '',
              'export const authSecretTransformedLeakQuery = query({',
              "  access: { guards: [{ guard: appAuthed, name: 'appAuthed' }], kind: 'guard-chain' },",
              '  guard: appAuthed,',
              "  reads: [domain('auth')],",
              '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
              '    const db = requireDb(context);',
              "    const userId = context?.request.session?.user.id ?? '';",
              '    const wrapCredential = (value: string | null) => value;',
              '    const items = (await db',
              '      .select({',
              '        accessToken: account.accessToken,',
              '        id: account.id,',
              '        password: account.password,',
              '      })',
              '      .from(account)',
              '      .where(eq(account.userId, userId))).map((secretRow) => ({',
              '        accessToken: JSON.stringify({ value: `${wrapCredential(secretRow.accessToken) ?? ""}` }),',
              '        id: secretRow.id,',
              '        password: wrapCredential(secretRow.password),',
              '      }));',
              '    return { items };',
              '  },',
              '});',
              '',
              'export const authSecretRenderLeakQuery = query({',
              "  access: { guards: [{ guard: appAuthed, name: 'appAuthed' }], kind: 'guard-chain' },",
              '  guard: appAuthed,',
              "  reads: [domain('auth')],",
              '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
              '    const db = requireDb(context);',
              "    const userId = context?.request.session?.user.id ?? '';",
              '    const items = (await db',
              '      .select({',
              '        id: account.id,',
              '        renderPassword: account.password,',
              '      })',
              '      .from(account)',
              '      .where(eq(account.userId, userId))).map((secretRow) => ({',
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
        "  access: { guards: [{ guard: appAuthed, name: 'appAuthed' }], kind: 'guard-chain' },",
        '  guard: appAuthed,',
        "  reads: [domain('auth')],",
        '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
        '    const db = requireDb(context);',
        "    const userId = context?.request.session?.user.id ?? '';",
        '    const items = (await db',
        '      .select({',
        '        id: account.id,',
        '      })',
        '      .from(account)',
        '      .where(eq(account.userId, userId))',
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
        '      .where(eq(account.userId, userId));',
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
        '// SPEC §9.4 (MARQUEE): the framework provides `context.db` as the read-only managed handle.',
      ].join('\n'),
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

export async function signInDemoUser(
  root: string,
  origin: string,
  jar: Map<string, string>,
  output: () => string,
): Promise<void> {
  await fetchTextWhenReady(`${origin}/login`, output);
  const loginResponse = await fetch(`${origin}/login`);
  mergeCookies(jar, loginResponse.headers.getSetCookie());
  const loginHtml = await loginResponse.text();
  const loginCsrf = fieldValue(loginHtml, 'csrf');
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
      next: '/',
      password: demoPassword,
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  });
  mergeCookies(jar, signIn.headers.getSetCookie());
  expect(signIn.status).toBe(303);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
