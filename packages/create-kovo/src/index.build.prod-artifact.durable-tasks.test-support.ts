import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  mergeCookies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import {
  buildReusableProductionArtifact,
  fieldValue,
  formHtmlByAction,
} from './index.build.test-support.js';

interface DurableTaskArtifactServer {
  origin: string;
  output: () => string;
  root: string;
}

export async function withDurableTaskArtifactServer(
  options: { name: string; tempPrefix: string },
  run: (server: DurableTaskArtifactServer) => Promise<void>,
): Promise<void> {
  const tempParent = tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const root = mkdtempSync(join(tempParent, options.tempPrefix));
  const port = await reservePort();
  let server: ChildProcessWithoutNullStreams | undefined;

  try {
    writeKovoProject(root, { name: options.name });
    linkStarterBuildDependencies(root);
    addDurableTaskProofs(root);

    buildReusableProductionArtifact(root);

    server = spawn(process.execPath, ['dist/server/server.mjs'], {
      cwd: root,
      detached: process.platform !== 'win32',
      env: {
        ...withRepoBinOnPath(),
        HOST: '127.0.0.1',
        NODE_ENV: 'test',
        PORT: String(port),
      },
    });
    const output = collectOutput(server);
    const origin = `http://127.0.0.1:${port}`;
    await fetchTextWhenReady(`${origin}/api/task-proof-count`, output);

    await run({ origin, output, root });
  } finally {
    await stopProcess(server);
    rmSync(root, { force: true, recursive: true });
  }
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
        'export const taskProofs = pgTable(',
        "  'task_proofs',",
        '  {',
        "    eventId: text('eventId').primaryKey(),",
        "    proofId: text('proofId').notNull(),",
        '  },',
        '  kovo({',
        "    authzPolicy: 'durable task proof rows are fixture-controlled regression evidence',",
        "    domain: 'task-proof',",
        "    key: 'eventId',",
        '  }),',
        ');',
        '',
        '// --- Auth infrastructure',
      ].join('\n'),
    ),
    'utf8',
  );

  const runtimeDbPath = join(root, 'src/_kovo/app-runtime-db.ts');
  const runtimeDb = readFileSync(runtimeDbPath, 'utf8')
    .replace(
      "import { account, contacts, session, user, verification } from '../schema.js';",
      [
        'import {',
        '  account,',
        '  contacts,',
        '  session,',
        '  taskProofs,',
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
        '  taskProofs,',
        '  user,',
      ].join('\n'),
    );
  writeFileSync(runtimeDbPath, runtimeDb, 'utf8');

  writeFileSync(
    join(root, 'src/durable-task-proofs.ts'),
    [
      "import { eq } from 'drizzle-orm';",
      "import { domain, endpoint, mutation, publicAccess, s, serverValue, task, type TaskSchedulingRequest } from '@kovojs/server';",
      '',
      "import { readonlyAppDb } from './db.js';",
      "import { taskProofs } from './schema.js';",
      "import type { AppRequest } from './auth.js';",
      '',
      "const taskProof = domain('task-proof');",
      "const publicProof = publicAccess('public durable task regression proof');",
      'const flakyTaskAttempts = new Map<string, number>();',
      '',
      "async function insertTaskProofRow(db: AppRequest['db'], proofId: string) {",
      '  await db.insert(taskProofs).values({',
      "    eventId: serverValue(crypto.randomUUID(), 'server-generated durable task proof event id'),",
      '    proofId,',
      '  });',
      '}',
      '',
      'export const recordTaskEffect = mutation({',
      '  access: publicProof,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['task_proofs'], touches: [taskProof] },",
      '  async handler(input: { proofId: string }, request: AppRequest) {',
      '    await insertTaskProofRow(request.db, input.proofId);',
      "    return { status: 'recorded' };",
      '  },',
      '});',
      '',
      "export const recordDurableTask = task('durable-task-proofs/record', {",
      '  input: s.object({ proofId: s.string() }),',
      '  async run(input: { proofId: string }, context) {',
      "    await context.actAs('durable-task-proof-fixture').runMutation(recordTaskEffect, {",
      '      proofId: input.proofId,',
      '    });',
      '  },',
      '});',
      '',
      "export const flakyDurableTask = task('durable-task-proofs/flaky', {",
      '  input: s.object({',
      '    failTimes: s.number().int().min(0),',
      '    proofId: s.string(),',
      '  }),',
      "  retry: { backoff: 'linear', maxAttempts: 4 },",
      '  async run(input: { failTimes: number; proofId: string }, context) {',
      '    const attempt = (flakyTaskAttempts.get(input.proofId) ?? 0) + 1;',
      '    flakyTaskAttempts.set(input.proofId, attempt);',
      '    if (attempt <= input.failTimes) {',
      '      throw new Error(`durable flaky proof failed attempt ${attempt}`);',
      '    }',
      "    await context.actAs('durable-task-proof-fixture').runMutation(recordTaskEffect, {",
      '      proofId: input.proofId,',
      '    });',
      '  },',
      '});',
      '',
      "export const selfRescheduleTask = task('durable-task-proofs/self-reschedule', {",
      '  input: s.object({ proofId: s.string() }),',
      '  maxGenerations: 1,',
      '  async run(input: { proofId: string }, context) {',
      "    await context.actAs('durable-task-proof-fixture').runMutation(recordTaskEffect, {",
      '      proofId: input.proofId,',
      '    });',
      '    await context.schedule(selfRescheduleTask, { proofId: input.proofId }, { afterMs: 1 });',
      '  },',
      '});',
      '',
      'export const scheduleTaskProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({',
      '    proofId: s.string(),',
      '    mode: s.string(),',
      '  }),',
      "  registry: { tables: ['task_proofs', '_kovo_jobs'], touches: [taskProof] },",
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
      "    if (input.mode === 'flaky') {",
      '      await request.schedule(flakyDurableTask, { failTimes: 2, proofId: input.proofId });',
      "      return { status: 'scheduled-flaky' };",
      '    }',
      "    if (input.mode === 'self-reschedule') {",
      '      await request.schedule(selfRescheduleTask, { proofId: input.proofId });',
      "      return { status: 'scheduled-self-reschedule' };",
      '    }',
      '    await request.schedule(recordDurableTask, { proofId: input.proofId });',
      "    return { status: 'scheduled' };",
      '  },',
      '});',
      '',
      "export const taskProofCountEndpoint = endpoint('/api/task-proof-count', {",
      '  access: publicProof,',
      "  auth: { justification: 'public durable task proof count', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only durable task proof count',",
      '  async handler(request) {',
      '    const url = new URL(request.url);',
      "    const proofId = url.searchParams.get('id');",
      '    const rows = proofId',
      '      ? await readonlyAppDb.select().from(taskProofs).where(eq(taskProofs.proofId, proofId))',
      '      : await readonlyAppDb.select().from(taskProofs);',
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

  writeFileSync(
    join(root, 'src/durable-task-proof-form.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { mutationFormAttributes } from '@kovojs/server';",
      "import { scheduleTaskProof } from './durable-task-proofs.js';",
      '',
      'export const DurableTaskProofForm = component({',
      '  mutations: { scheduleTaskProof },',
      '  render: () => <form data-proof="durable-task-schedule" {...mutationFormAttributes(scheduleTaskProof)} />',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace(
      "import { ContactsRegion } from './components/contacts.js';",
      [
        "import { ContactsRegion } from './components/contacts.js';",
        "import { DurableTaskProofForm } from './durable-task-proof-form.js';",
      ].join('\n'),
    )
    .replace(
      "import { addContact } from './mutations.js';",
      [
        "import { addContact } from './mutations.js';",
        'import {',
        '  flakyDurableTask,',
        '  recordDurableTask,',
        '  recordTaskEffect,',
        '  scheduleTaskProof,',
        '  selfRescheduleTask,',
        '  taskProofCountEndpoint,',
        "} from './durable-task-proofs.js';",
      ].join('\n'),
    )
    .replace('endpoints: [healthEndpoint],', 'endpoints: [healthEndpoint, taskProofCountEndpoint],')
    .replace(
      'mutations: [addContact, appSignIn, appSignOut],',
      'mutations: [addContact, recordTaskEffect, scheduleTaskProof, appSignIn, appSignOut],',
    )
    .replace('stylesheets: options.stylesheets ?? [],', 'stylesheets: options.stylesheets ?? [],')
    .replace(
      'routes: [',
      'tasks: [recordDurableTask, flakyDurableTask, selfRescheduleTask],\n  routes: [',
    )
    .replace(
      "  routes: [\n    route('/', {",
      [
        '  routes: [',
        "    route('/durable-task-proof', {",
        "      access: publicAccess('public durable task scheduling regression proof'),",
        '      page() {',
        '        return <DurableTaskProofForm />;',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

export async function postScheduleMode(
  origin: string,
  proofId: string,
  mode: string,
): Promise<Response> {
  const jar = new Map<string, string>();
  const pageResponse = await fetch(`${origin}/durable-task-proof`);
  mergeCookies(jar, pageResponse.headers.getSetCookie());
  const pageHtml = await pageResponse.text();
  const form = formHtmlByAction(pageHtml, '/_m/durable-task-proofs/schedule-task-proof');
  return fetch(`${origin}/_m/durable-task-proofs/schedule-task-proof`, {
    body: new URLSearchParams({
      csrf: fieldValue(form, 'csrf'),
      mode,
      proofId,
      'Kovo-Idem': uniqueProofId(`idem-${mode}`),
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  });
}

export async function expectEventuallyCount(
  origin: string,
  id: string,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 8_000;
  let actual = await taskProofCount(origin, id);
  while (actual !== expected && Date.now() < deadline) {
    await sleep(100);
    actual = await taskProofCount(origin, id);
  }
  expect(actual).toBe(expected);
}

export async function expectCountForDuration(
  origin: string,
  id: string,
  expected: number,
  durationMs: number,
): Promise<void> {
  const deadline = Date.now() + durationMs;
  do {
    expect(await taskProofCount(origin, id)).toBe(expected);
    await sleep(100);
  } while (Date.now() < deadline);
}

export async function taskProofCount(origin: string, id: string): Promise<number> {
  const response = await fetch(`${origin}/api/task-proof-count?id=${encodeURIComponent(id)}`);
  const payload = (await response.json()) as { count: number };
  return payload.count;
}

export function uniqueProofId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
