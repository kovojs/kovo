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
      addParanoidSqlRuntimeTwinProof(root);
      addRuntimeSecretBoundaryProof(root);
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
  const response = await fetch(`${origin}/api/paranoid-sql-runtime-twin`);
  const body = (await response.json()) as {
    legitimate: { ok: boolean; rows: number };
    unsafe: { blocked: boolean; message: string };
  };
  expect(response.status).toBe(200);
  expect(body.legitimate.ok).toBe(true);
  expect(body.legitimate.rows).toBeGreaterThanOrEqual(0);
  expect(body.unsafe.blocked).toBe(true);
  expect(body.unsafe.message).toContain('KV422');
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
  writeFileSync(
    join(root, 'src/paranoid-sql-runtime-twin.ts'),
    [
      "import { endpoint, publicAccess } from '@kovojs/server';",
      '',
      "import { readonlyAppDb } from './db.js';",
      "import { contacts } from './schema.js';",
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
      '    try {',
      "      const method = 'execute' as string;",
      '      const db = readonlyAppDb as unknown as Record<string, (statement: unknown) => Promise<unknown>>;',
      "      await db[method]!('select * from contacts where id = \\'c1\\'');",
      '      return Response.json({',
      '        legitimate: { ok: true, rows: legitimateRows.length },',
      "        unsafe: { blocked: false, message: 'raw SQL string reached managed DB handle' },",
      "      }, { status: 500, headers: { 'Cache-Control': 'no-store' } });",
      '    } catch (error) {',
      '      const message = error instanceof Error ? error.message : String(error);',
      '      return Response.json({',
      '        legitimate: { ok: true, rows: legitimateRows.length },',
      '        unsafe: { blocked: /KV422/u.test(message), message },',
      "      }, { headers: { 'Cache-Control': 'no-store' } });",
      '    }',
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
      ].join('\n'),
    )
    .replace(
      'endpoints: [healthEndpoint],',
      'endpoints: [healthEndpoint, paranoidSqlRuntimeTwinEndpoint],',
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
