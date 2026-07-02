import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  generateParanoidGeneratorAcceptanceCases,
  type ParanoidGeneratorAcceptanceCase,
} from '../../../scripts/security-test-build-gate.mjs';
import { writeKovoProject } from './index.js';
import {
  addRuntimeSecretBoundaryProof,
  buildParanoidProductionArtifact,
  signInDemoUser,
} from './index.build.test-support.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';

describe('create-kovo starter (build integration: paranoid runtime chokes)', () => {
  // @kovo-security-certifies KV435 round-8-paranoid-generator-acceptance
  it('runs generated paranoid acceptance cases with static classifiers advisory', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-paranoid-runtime-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      const paranoidCases = generateParanoidGeneratorAcceptanceCases();
      writeKovoProject(root, { name: 'Paranoid Runtime Proof' });
      addParanoidRuntimeProofRoutes(root, paranoidCases);
      addRuntimeSecretBoundaryProof(root);
      addParanoidSqlRuntimeTwinProof(root);
      linkStarterBuildDependencies(root);

      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          KOVO_PARANOID: '1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      const healthBody = await fetchTextWhenReady(`${origin}/api/health`, output);
      expect(healthBody).toContain('"ok":true');

      for (const testCase of paranoidCases) {
        await expectParanoidRuntimeCase(origin, testCase);
      }
      await expectParanoidRuntimeSqlClassifierTwin(origin);
      await expectParanoidRuntimeKv435Twin(root, origin, output);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

async function expectParanoidRuntimeSqlClassifierTwin(origin: string): Promise<void> {
  const writeId = `paranoid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const writeResponse = await fetch(`${origin}/_m/paranoid-sql-runtime-twin/declared-write-proof`, {
    body: new URLSearchParams({
      id: writeId,
      'Kovo-Idem': `idem-${writeId}`,
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  });
  await writeResponse.text();
  expect(writeResponse.status).toBe(303);

  const response = await fetch(`${origin}/api/paranoid-sql-runtime-twin`);
  const body = (await response.json()) as {
    declaredWrite: {
      markers: string[];
      userxRows: number;
    };
    legitimate: { ok: boolean; rows: number };
    unsafe: Array<{ blocked: boolean; case: string; message: string }>;
  };
  expect(response.status).toBe(200);
  expect(body.legitimate.ok).toBe(true);
  expect(body.legitimate.rows).toBeGreaterThanOrEqual(0);
  expect(body.unsafe).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ blocked: true, case: 'raw-string-execute' }),
      expect.objectContaining({ blocked: true, case: 'trusted-ddl-drop' }),
      expect.objectContaining({ blocked: true, case: 'trusted-pragma-write' }),
    ]),
  );
  expect(body.unsafe).toHaveLength(3);
  for (const result of body.unsafe) expect(result.message).toMatch(/KV422|KV406|read-only/iu);

  expect(body.declaredWrite.markers).toEqual(
    expect.arrayContaining([
      'blocked:userx',
      'blocked:otherschema.contacts',
      'blocked:ddl',
      'blocked:pragma',
      'allowed:contacts',
    ]),
  );
  expect(body.declaredWrite.userxRows).toBe(0);
}

async function expectParanoidRuntimeKv435Twin(
  root: string,
  origin: string,
  output: () => string,
): Promise<void> {
  const jar = new Map<string, string>();
  await signInDemoUser(root, origin, jar, output);

  for (const key of [
    'runtime-secret-column-egress',
    'runtime-secret-raw-egress',
    'runtime-secret-opaque-raw-egress',
    'runtime-secret-computed-egress',
    'runtime-secret-function-egress',
    'runtime-secret-whole-table-egress',
  ]) {
    const response = await fetch(`${origin}/_q/${key}`, {
      headers: { cookie: cookieHeader(jar) },
    });
    const body = await response.text();

    expect(response.status, `${key}: ${body}`).toBe(500);
    expect(body).toBe('{"code":"SERVER_ERROR","payload":{}}');
    expect(body).not.toContain('runtime-secret-value');
  }
  expect(output()).toContain('KV435');
  expect(output()).toContain('Secret runtime value cannot cross');

  const revealResponse = await fetch(`${origin}/_q/runtime-secret-reveal-egress`, {
    headers: { cookie: cookieHeader(jar) },
  });
  const revealBody = await revealResponse.text();
  expect(revealResponse.status, revealBody).toBe(200);
  expect(revealBody).toContain('<kovo-query name="runtime-secret-reveal-egress"');
  expect(revealBody).toContain('runtime-secret-value');
  expect(revealBody).toContain('runtime-secret-value:computed');
}

function addParanoidRuntimeProofRoutes(
  root: string,
  cases: readonly ParanoidGeneratorAcceptanceCase[],
): void {
  const routeLines = cases.flatMap((testCase) => {
    if (testCase.kind !== 'runtime-route') return [];
    if (testCase.route === '/paranoid-runtime-safe.txt') {
      return [
        "    route('/paranoid-runtime-safe.txt', {",
        "      access: publicAccess('public paranoid runtime safe route'),",
        '      page() {',
        "        return respond.file('paranoid runtime safe\\n', {",
        "          contentType: 'text/plain; charset=utf-8',",
        "          headers: { 'X-Kovo-Paranoid-Proof': 'safe' },",
        '        });',
        '      },',
        '    }),',
      ];
    }
    if (testCase.route === '/paranoid-runtime-unsafe-header.txt') {
      return [
        "    route('/paranoid-runtime-unsafe-header.txt', {",
        "      access: publicAccess('public paranoid runtime header choke proof'),",
        '      page() {',
        "        return respond.file('paranoid runtime unsafe header\\n', {",
        "          contentType: 'text/plain; charset=utf-8',",
        "          headers: { 'X-Kovo-Paranoid-Proof': 'unsafe\\r\\nSet-Cookie: paranoid=owned' },",
        '        });',
        '      },',
        '    }),',
      ];
    }
    if (testCase.route === '/paranoid-runtime-unsafe-helper.txt') {
      return [
        "    route('/paranoid-runtime-unsafe-helper.txt', {",
        "      access: publicAccess('public paranoid runtime helper header choke proof'),",
        '      page() {',
        "        return paranoidUnsafeFile('helper');",
        '      },',
        '    }),',
      ];
    }
    throw new Error(`Unhandled paranoid generator acceptance route ${testCase.route}.`);
  });
  if (routeLines.length === 0) {
    throw new Error('Expected generated paranoid runtime route cases.');
  }

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8');
  const withRespondImport = replaceRequired(
    app,
    '  redirect,\n  route,',
    '  redirect,\n  respond,\n  route,',
    'paranoid runtime proof response imports',
  );
  const withRoutes = replaceRequired(
    withRespondImport,
    "  routes: [\n    route('/', {",
    ['  routes: [', ...routeLines, "    route('/', {"].join('\n'),
    'paranoid runtime proof routes',
  );
  const withHelper = replaceRequired(
    withRoutes,
    '\nconst app = createApp({',
    [
      '',
      'function paranoidUnsafeFile(label: string) {',
      '  return respond.file(`paranoid runtime unsafe ${label}\\n`, {',
      "    contentType: 'text/plain; charset=utf-8',",
      "    headers: { 'X-Kovo-Paranoid-Proof': `unsafe-${label}\\r\\nSet-Cookie: paranoid=owned` },",
      '  });',
      '}',
      '',
      'const app = createApp({',
    ].join('\n'),
    'paranoid runtime helper wrapper',
  );
  writeFileSync(appPath, withHelper, 'utf8');
}

function addParanoidSqlRuntimeTwinProof(root: string): void {
  const schemaPath = join(root, 'src/schema.ts');
  const schema = readFileSync(schemaPath, 'utf8');
  writeFileSync(
    schemaPath,
    replaceRequired(
      schema,
      ');\n\n// --- Auth infrastructure',
      [
        ');',
        '',
        "export const userx = pgTable('userx', {",
        "  id: text('id').primaryKey(),",
        "  label: text('label').notNull().default(''),",
        '});',
        '',
        '// --- Auth infrastructure',
      ].join('\n'),
      'paranoid SQL runtime twin out-of-scope table',
    ),
    'utf8',
  );

  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db.ts');
  const runtimeDb = readFileSync(runtimeDbPath, 'utf8');
  const runtimeDbImport = runtimeDb.includes(
    "import { account, contacts, runtimeSecretFunctionProof, runtimeSecretProof, runtimeSecretWholeProof, session, user, verification } from '../schema.js';",
  )
    ? replaceRequired(
        runtimeDb,
        "import { account, contacts, runtimeSecretFunctionProof, runtimeSecretProof, runtimeSecretWholeProof, session, user, verification } from '../schema.js';",
        "import { account, contacts, runtimeSecretFunctionProof, runtimeSecretProof, runtimeSecretWholeProof, session, user, userx, verification } from '../schema.js';",
        'paranoid SQL runtime twin runtime DB imports',
      )
    : replaceRequired(
        runtimeDb,
        "import { account, contacts, session, user, verification } from '../schema.js';",
        "import { account, contacts, session, user, userx, verification } from '../schema.js';",
        'paranoid SQL runtime twin runtime DB imports',
      );
  writeFileSync(
    runtimeDbPath,
    replaceRequired(
      replaceRequired(
        runtimeDbImport,
        '  contacts,\n  user,',
        '  contacts,\n  userx,\n  user,',
        'paranoid SQL runtime twin schema table list',
      ),
      '  await client.exec(SEED_CONTACTS);',
      [
        "  await client.exec('CREATE SCHEMA IF NOT EXISTS otherschema;');",
        '  await client.exec(',
        "    'CREATE TABLE IF NOT EXISTS otherschema.contacts (id text PRIMARY KEY, label text NOT NULL DEFAULT \\'\\');',",
        '  );',
        '  await client.exec(SEED_CONTACTS);',
      ].join('\n'),
      'paranoid SQL runtime twin schema-qualified table setup',
    ),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/paranoid-sql-runtime-twin.ts'),
    [
      "import { sql, trustedSql } from '@kovojs/drizzle';",
      "import { domain, endpoint, mutation, publicAccess, s, serverValue, write, type MutationContext } from '@kovojs/server';",
      '',
      "import { readonlyAppDb } from './db.js';",
      "import { contacts, userx } from './schema.js';",
      "import type { AppRequest } from './auth.js';",
      '',
      'const paranoidSqlRuntimeTwinError = s.object({ message: s.string() });',
      "const contactsProofDomain = domain('contacts');",
      '',
      'type BlockedResult = { blocked: boolean; case: string; message: string };',
      '',
      'async function expectBlocked(caseName: string, run: () => Promise<unknown>): Promise<BlockedResult> {',
      '  try {',
      '    await run();',
      "    return { blocked: false, case: caseName, message: 'statement unexpectedly executed' };",
      '  } catch (error) {',
      '    const message = error instanceof Error ? error.message : String(error);',
      '    return { blocked: /KV422|KV406|read-only|readonly/iu.test(message), case: caseName, message };',
      '  }',
      '}',
      '',
      'function trustedRuntimeSql(text: string, justification: string) {',
      '  return trustedSql(sql.raw(text), { justification });',
      '}',
      '',
      'const paranoidDeclaredWriteRun = write({',
      "  key: 'paranoid-sql-runtime-twin/declared-write-run',",
      "  tables: ['contacts'],",
      '  touches: [contactsProofDomain],',
      "  async run(db: AppRequest['db'], input: { id: string }) {",
      '    const blocked = [',
      '      await expectBlocked(',
      "        'userx',",
      '        () => db.execute(',
      "          trustedRuntimeSql('insert into ' + 'userx' + \" (id, label) values ('blocked-userx', 'blocked')\", 'paranoid declared-table userx rejection proof'),",
      '        ),',
      '      ),',
      '      await expectBlocked(',
      "        'otherschema.contacts',",
      '        () => db.execute(',
      "          trustedRuntimeSql('update ' + 'otherschema' + '.contacts set label = \\'blocked\\' where id = \\'missing\\'', 'paranoid declared-table schema-qualified rejection proof'),",
      '        ),',
      '      ),',
      '      await expectBlocked(',
      "        'ddl',",
      '        () => db.execute(',
      "          trustedRuntimeSql('create table paranoid_declared_table_gap (id text primary key)', 'paranoid declared-table DDL rejection proof'),",
      '        ),',
      '      ),',
      '      await expectBlocked(',
      "        'pragma',",
      '        () => db.execute(',
      "          trustedRuntimeSql('pragma user_version = 7', 'paranoid declared-table pragma rejection proof'),",
      '        ),',
      '      ),',
      '    ];',
      '    if (!blocked.every((result) => result.blocked && result.message.includes("KV406"))) {',
      "      throw new Error(blocked.map((result) => `${result.case}: ${result.message}`).join('\\n'));",
      '    }',
      '    for (const result of blocked) {',
      '      const id = `${input.id}-${result.case}`;',
      '      await db.insert(contacts).values({',
      "        company: 'Paranoid SQL Runtime',",
      '        email: `${id}@example.test`,',
      '        id: serverValue(id, "server-generated paranoid SQL blocked marker id"),',
      '        name: `blocked:${result.case}`,',
      '      });',
      '    }',
      '    const id = `${input.id}-contacts`;',
      '    await db.insert(contacts).values({',
      "      company: 'Paranoid SQL Runtime',",
      '      email: `${id}@example.test`,',
      '      id: serverValue(id, "server-generated paranoid SQL in-scope contact id"),',
      "      name: 'allowed:contacts',",
      '    });',
      '    return { blocked, inScope: { ok: true } };',
      '  },',
      '});',
      '',
      'export const paranoidDeclaredWriteProof = mutation({',
      "  access: publicAccess('public paranoid declared-table write proof'),",
      '  csrf: false,',
      '  errors: { RUNTIME_SQL_PROOF: paranoidSqlRuntimeTwinError },',
      '  input: s.object({ id: s.string() }),',
      "  registry: { tables: ['contacts'], touches: paranoidDeclaredWriteRun.touches },",
      '  async handler(',
      '    input: { id: string },',
      '    request: AppRequest,',
      '    context: MutationContext<{ RUNTIME_SQL_PROOF: typeof paranoidSqlRuntimeTwinError }>,',
      '  ) {',
      '    try {',
      '      return await paranoidDeclaredWriteRun.run(request.db, input);',
      '    } catch (error) {',
      '      const message = error instanceof Error ? error.message : String(error);',
      "      return context.fail('RUNTIME_SQL_PROOF', {",
      '        message,',
      '      });',
      '    }',
      '  },',
      '});',
      "paranoidDeclaredWriteProof.key = 'paranoid-sql-runtime-twin/declared-write-proof';",
      '',
      "export const paranoidSqlRuntimeTwinEndpoint = endpoint('/api/paranoid-sql-runtime-twin', {",
      "  access: publicAccess('public paranoid SQL runtime twin proof'),",
      "  auth: { justification: 'public paranoid SQL runtime twin proof', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only paranoid SQL runtime twin proof',",
      '  async handler() {',
      '    const legitimateRows = await readonlyAppDb',
      '      .select({ id: contacts.id })',
      '      .from(contacts)',
      '      .limit(1);',
      "    const method = 'execute' as string;",
      '    const db = readonlyAppDb as unknown as Record<string, (statement: unknown) => Promise<unknown>>;',
      '    const unsafe = [',
      '      await expectBlocked(',
      "        'raw-string-execute',",
      "        () => db[method]!('select * from contacts where id = \\'c1\\''),",
      '      ),',
      '      await expectBlocked(',
      "        'trusted-ddl-drop',",
      '        () => db[method]!(trustedRuntimeSql("drop table contacts", "paranoid readonly DDL proof")),',
      '      ),',
      '      await expectBlocked(',
      "        'trusted-pragma-write',",
      '        () => db[method]!(trustedRuntimeSql("pragma user_version = 9", "paranoid readonly pragma proof")),',
      '      ),',
      '    ];',
      '    const contactRows = await readonlyAppDb',
      '      .select({ company: contacts.company, name: contacts.name })',
      '      .from(contacts);',
      "    const markers = contactRows.filter((row) => row.company === 'Paranoid SQL Runtime').map((row) => row.name).sort();",
      '    const userxRows = await readonlyAppDb.select({ id: userx.id }).from(userx);',
      '    return Response.json({',
      '      declaredWrite: {',
      '        markers,',
      '        userxRows: userxRows.length,',
      '      },',
      '      legitimate: { ok: true, rows: legitimateRows.length },',
      '      unsafe,',
      "    }, { headers: { 'Cache-Control': 'no-store' } });",
      '  },',
      "  method: 'GET',",
      "  reason: 'paranoid SQL runtime twin proof',",
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
        "import { paranoidSqlRuntimeTwinEndpoint } from './paranoid-sql-runtime-twin.js';",
        "import { paranoidDeclaredWriteProof } from './paranoid-sql-runtime-twin.js';",
      ].join('\n'),
    )
    .replace(
      'endpoints: [healthEndpoint],',
      'endpoints: [healthEndpoint, paranoidSqlRuntimeTwinEndpoint],',
    )
    .replace(
      'mutations: [addContact, appSignIn, appSignOut],',
      'mutations: [addContact, paranoidDeclaredWriteProof, appSignIn, appSignOut],',
    );
  writeFileSync(appPath, app, 'utf8');
}

async function expectParanoidRuntimeCase(
  origin: string,
  testCase: ParanoidGeneratorAcceptanceCase,
): Promise<void> {
  if (testCase.kind === 'build-env') return;
  if (testCase.route === undefined) throw new Error(`Generated case ${testCase.id} has no route.`);

  const response = await fetch(`${origin}${testCase.route}`);
  const body = await response.text();
  if (testCase.expectation === 'legitimate-build-green') {
    expect(response.status, body).toBe(200);
    expect(body).toContain('paranoid runtime safe');
    expect(response.headers.get('x-kovo-paranoid-proof')).toBe('safe');
    return;
  }

  expect(testCase.expectation).toBe('unsafe-runtime-choke');
  expect(response.status, body).toBe(500);
  expect(response.headers.get('x-kovo-paranoid-proof')).toBeNull();
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(body).toContain('Server Error');
  expect(body).not.toContain('Set-Cookie: paranoid=owned');
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
