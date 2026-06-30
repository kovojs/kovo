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
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      "import { addContact } from './mutations.js';",
      [
        "import { addContact } from './mutations.js';",
        "import { blockTitle, NoJsFailureProof } from './no-js-failure-proof.js';",
      ].join('\n'),
    )
    .replace(
      '  mutations: [addContact, appSignIn, appSignOut],',
      '  mutations: [addContact, blockTitle, appSignIn, appSignOut],',
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

export function addRawSqlOwnerWriteProof(
  root: string,
  options: { declareTables?: boolean; trusted?: boolean } = {},
): void {
  const declareTables = options.declareTables !== false;
  const schemaPath = join(root, 'src/schema.ts');
  writeFileSync(
    schemaPath,
    readFileSync(schemaPath, 'utf8').replace(
      ');\n\n// --- Auth infrastructure',
      [
        ');',
        '',
        'export const rawOwners = pgTable(',
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
  const mutations = readFileSync(mutationsPath, 'utf8')
    .replace(
      "import { guards, mutation, s, serverValue, type MutationContext } from '@kovojs/server';",
      [
        options.trusted
          ? "import { sql, trustedSql } from '@kovojs/drizzle';"
          : "import { sql } from '@kovojs/drizzle';",
        "import { domain, guards, mutation, s, serverValue, type MutationContext } from '@kovojs/server';",
      ].join('\n'),
    )
    .replace(
      'const duplicateEmailError = s.object({ email: s.string() });',
      [
        'const duplicateEmailError = s.object({ email: s.string() });',
        "const rawOwner = domain('raw-owner');",
      ].join('\n'),
    )
    .replace(
      'registry: { touches: [contact] },',
      declareTables
        ? "registry: { touches: [contact, rawOwner], tables: ['raw_owners'] },"
        : 'registry: { touches: [contact, rawOwner] },',
    )
    .replace(
      [
        '    await db',
        '      .insert(contacts)',
        "      .values({ id: serverValue(id, 'server-generated contact id'), name, email, company });",
      ].join('\n'),
      [
        '    await db.execute(',
        options.trusted
          ? "      trustedSql(sql`update raw_owners set label = ${company} where id = ${serverValue(id, 'server-generated contact id')}`, { justification: 'reviewed owner predicate' }),"
          : "      sql`update raw_owners set label = ${company} where id = ${serverValue(id, 'server-generated contact id')}`,",
        '    );',
        '    await db',
        '      .insert(contacts)',
        "      .values({ id: serverValue(id, 'server-generated contact id'), name, email, company });",
      ].join('\n'),
    );
  writeFileSync(mutationsPath, mutations, 'utf8');
}

export function addRuntimeMutationSafetyProofs(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  writeFileSync(
    schemaPath,
    readFileSync(schemaPath, 'utf8').replace(
      ');\n\n// --- Auth infrastructure',
      [
        ');',
        '',
        "export const txProofs = pgTable('tx_proofs', {",
        "  id: text('id').primaryKey(),",
        '});',
        '',
        "export const rawRuntimeDrift = pgTable('raw_runtime_drift', {",
        "  id: text('id').primaryKey(),",
        "  label: text('label').notNull().default(''),",
        '});',
        '',
        '// --- Auth infrastructure',
      ].join('\n'),
    ),
    'utf8',
  );

  const dbPath = join(root, 'src/db.ts');
  const db = readFileSync(dbPath, 'utf8')
    .replace(
      "import { account, contacts, session, user, verification } from './schema.js';",
      [
        'import {',
        '  account,',
        '  contacts,',
        '  rawRuntimeDrift,',
        '  session,',
        '  txProofs,',
        '  user,',
        '  verification,',
        "} from './schema.js';",
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
  writeFileSync(dbPath, db, 'utf8');

  writeFileSync(
    join(root, 'src/runtime-safety-proofs.ts'),
    [
      "import { sql, trustedSql } from '@kovojs/drizzle';",
      "import { domain, endpoint, mutation, publicAccess, s, type MutationContext } from '@kovojs/server';",
      '',
      "import { appDb } from './db.js';",
      "import { rawRuntimeDrift, txProofs } from './schema.js';",
      "import type { AppRequest } from './auth.js';",
      '',
      'const runtimeTableDriftError = s.object({ message: s.string() });',
      "const publicProof = publicAccess('public production mutation safety regression proof');",
      "const txProof = domain('tx_proof');",
      '',
      'export const failAfterWrite = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
      '  input: s.object({ id: s.string() }),',
      '  registry: { touches: [txProof] },',
      '  async handler(input: { id: string }, request: AppRequest) {',
      '    await request.db.insert(txProofs).values({ id: input.id });',
      "    throw new Error('rollback proof');",
      '  },',
      '});',
      '',
      'export const rawTableDrift = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
      '  errors: { RUNTIME_TABLE_DRIFT: runtimeTableDriftError },',
      '  input: s.object({ id: s.string(), label: s.string() }),',
      "  registry: { tables: ['contacts'] },",
      '  async handler(',
      '    input: { id: string; label: string },',
      '    request: AppRequest,',
      '    context: MutationContext<{ RUNTIME_TABLE_DRIFT: typeof runtimeTableDriftError }>,',
      '  ) {',
      '    try {',
      '      await request.db.execute(',
      '        trustedSql(',
      '          sql`insert into raw_runtime_drift (id, label) values (${input.id}, ${input.label})`,',
      "          { justification: 'audited runtime table-drift proof' },",
      '        ),',
      '      );',
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
      "export const txProofCountEndpoint = endpoint('/api/tx-proof-count', {",
      "  auth: { justification: 'public transaction rollback proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only transaction rollback proof',",
      '  async handler() {',
      '    const rows = await appDb.select().from(txProofs);',
      "    return Response.json({ count: rows.length }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only transaction rollback proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
      '});',
      '',
      "export const rawRuntimeDriftCountEndpoint = endpoint('/api/raw-runtime-drift-count', {",
      "  auth: { justification: 'public runtime raw-SQL allowlist proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only runtime raw-SQL allowlist proof',",
      '  async handler() {',
      '    const rows = await appDb.select().from(rawRuntimeDrift);',
      "    return Response.json({ count: rows.length }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only runtime raw-SQL allowlist proof',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
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
        'import {',
        '  failAfterWrite,',
        '  rawRuntimeDriftCountEndpoint,',
        '  rawTableDrift,',
        '  txProofCountEndpoint,',
        "} from './runtime-safety-proofs.js';",
      ].join('\n'),
    )
    .replace(
      'endpoints: [healthEndpoint],',
      'endpoints: [healthEndpoint, txProofCountEndpoint, rawRuntimeDriftCountEndpoint],',
    )
    .replace(
      'mutations: [addContact, appSignIn, appSignOut],',
      'mutations: [addContact, failAfterWrite, rawTableDrift, appSignIn, appSignOut],',
    );
  writeFileSync(appPath, app, 'utf8');
}

export function addDurableTaskProofs(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  writeFileSync(
    schemaPath,
    readFileSync(schemaPath, 'utf8').replace(
      ');\n\n// --- Auth infrastructure',
      [
        ');',
        '',
        "export const taskProofs = pgTable('task_proofs', {",
        "  eventId: text('eventId').primaryKey(),",
        "  proofId: text('proofId').notNull(),",
        '});',
        '',
        '// --- Auth infrastructure',
      ].join('\n'),
    ),
    'utf8',
  );

  const dbPath = join(root, 'src/db.ts');
  const db = readFileSync(dbPath, 'utf8')
    .replace(
      "import { account, contacts, session, user, verification } from './schema.js';",
      [
        'import {',
        '  account,',
        '  contacts,',
        '  session,',
        '  taskProofs,',
        '  user,',
        '  verification,',
        "} from './schema.js';",
      ].join('\n'),
    )
    .replace(
      'const SCHEMA_TABLES = sortTablesByForeignKeyDependencies([\n  contacts,\n  user,',
      [
        'const SCHEMA_TABLES = sortTablesByForeignKeyDependencies([',
        '  contacts,',
        '  taskProofs,',
        '  user,',
      ].join('\n'),
    );
  writeFileSync(dbPath, db, 'utf8');

  writeFileSync(
    join(root, 'src/durable-task-proofs.ts'),
    [
      "import { eq } from 'drizzle-orm';",
      "import { domain, endpoint, mutation, publicAccess, s, task, type TaskSchedulingRequest } from '@kovojs/server';",
      '',
      "import { appDb } from './db.js';",
      "import { taskProofs } from './schema.js';",
      "import type { AppRequest } from './auth.js';",
      '',
      "const taskProof = domain('task_proof');",
      "const publicProof = publicAccess('public durable task regression proof');",
      '',
      'export const recordTaskEffect = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['task_proofs'], touches: [taskProof] },",
      '  async handler(input: { proofId: string }, request: AppRequest) {',
      '    await request.db.insert(taskProofs).values({',
      '      eventId: crypto.randomUUID(),',
      '      proofId: input.proofId,',
      '    });',
      "    return { status: 'recorded' };",
      '  },',
      '});',
      '',
      "export const recordDurableTask = task('durable-task-proofs/record', {",
      '  input: s.object({ proofId: s.string() }),',
      '  async run(input: { proofId: string }, context) {',
      '    await context.runMutation(recordTaskEffect, { proofId: input.proofId });',
      '  },',
      '});',
      '',
      'export const scheduleTaskProof = mutation({',
      '  access: publicProof,',
      '  csrf: false,',
      '  input: s.object({',
      '    proofId: s.string(),',
      '    mode: s.string(),',
      '  }),',
      "  registry: { tables: ['task_proofs'], touches: [taskProof] },",
      '  async handler(input: { proofId: string; mode: string }, request: AppRequest & TaskSchedulingRequest) {',
      "    if (input.mode === 'throw') {",
      '      await request.schedule(recordDurableTask, { proofId: input.proofId });',
      "      throw new Error('durable rollback proof');",
      '    }',
      "    if (input.mode === 'delay') {",
      '      await request.schedule(recordDurableTask, { proofId: input.proofId }, { afterMs: 700 });',
      "      return { status: 'scheduled-delay' };",
      '    }',
      "    if (input.mode === 'cancel') {",
      '      const handle = await request.schedule(recordDurableTask, { proofId: input.proofId }, { afterMs: 5_000 });',
      '      return { cancelled: await request.cancel(handle) };',
      '    }',
      "    if (input.mode === 'replace') {",
      '      await request.schedule(recordDurableTask, { proofId: `${input.proofId}-old` }, {',
      '        afterMs: 5_000,',
      '        key: `durable:${input.proofId}`,',
      '      });',
      '      await request.schedule(recordDurableTask, { proofId: `${input.proofId}-new` }, {',
      '        key: `durable:${input.proofId}`,',
      '      });',
      "      return { status: 'scheduled-replacement' };",
      '    }',
      '    await request.schedule(recordDurableTask, { proofId: input.proofId });',
      "    return { status: 'scheduled' };",
      '  },',
      '});',
      '',
      "export const taskProofCountEndpoint = endpoint('/api/task-proof-count', {",
      "  auth: { justification: 'public durable task proof count', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only durable task proof count',",
      '  async handler(request) {',
      '    const url = new URL(request.url);',
      "    const proofId = url.searchParams.get('id');",
      '    const rows = proofId',
      '      ? await appDb.select().from(taskProofs).where(eq(taskProofs.proofId, proofId))',
      '      : await appDb.select().from(taskProofs);',
      "    return Response.json({ count: rows.length }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'read-only durable task proof count',",
      "  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },",
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
        'import {',
        '  recordDurableTask,',
        '  recordTaskEffect,',
        '  scheduleTaskProof,',
        '  taskProofCountEndpoint,',
        "} from './durable-task-proofs.js';",
      ].join('\n'),
    )
    .replace(
      'endpoints: [healthEndpoint],',
      'endpoints: [healthEndpoint, taskProofCountEndpoint],',
    )
    .replace(
      'mutations: [addContact, appSignIn, appSignOut],',
      'mutations: [addContact, recordTaskEffect, scheduleTaskProof, appSignIn, appSignOut],',
    )
    .replace(
      'stylesheets: options.stylesheets ?? [],',
      'stylesheets: options.stylesheets ?? [],',
    )
    .replace(
      'routes: [',
      'tasks: [recordDurableTask],\n  routes: [',
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

export function addAuthSecretLeakProof(root: string): void {
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
        '  items: { accessToken: string | null; password: string | null }[];',
        '}',
      ].join('\n'),
    )
    .replace(
      '// SPEC §9.4 (MARQUEE): the framework provides `context.db` as the read-only managed handle.',
      [
        'export const authSecretLeakQuery = query({',
        '  guard: appAuthed,',
        "  reads: [domain('auth')],",
        '  async load(_input: unknown, context?: AppQueryLoadContext): Promise<AuthSecretLeakResult> {',
        '    const db = requireDb(context);',
        "    const userId = context?.request.session?.user.id ?? '';",
        '    const items = await db',
        '      .select({',
        '        accessToken: account.accessToken,',
        '        password: account.password,',
        '      })',
        '      .from(account)',
        '      .where(eq(account.userId, userId))',
        '      .limit(1);',
        '    return { items };',
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
      "import { appDb, appDbReady } from './db.js';",
      "import { authSecretLeakQuery } from './queries.js';",
      '',
      'await appDbReady;',
      "const authDomain = domain('auth');",
      'const touchAuth = mutation({',
      "  access: publicAccess('build-only auth touch graph proof'),",
      '  csrf: false,',
      '  input: s.object({}),',
      "  optimistic: { [authSecretLeakQuery.key]: 'await-fragment' },",
      '  registry: { touches: [authDomain] },',
      '  handler() {',
      "    return { status: 'ok' };",
      '  },',
      '});',
      "touchAuth.key = 'auth/secret-touch';",
      '',
      'export const AuthSecretLeakProof = component({',
      '  queries: { secrets: authSecretLeakQuery },',
      '  render(_props: { secrets: { accessToken: string | null; password: string | null }[] }) {',
      '    return <main>credential projection proof</main>;',
      '  },',
      '});',
      '',
      'const app = createApp({',
      '  db: () => appDb,',
      '  mutations: [touchAuth],',
      '  queries: [authSecretLeakQuery],',
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
