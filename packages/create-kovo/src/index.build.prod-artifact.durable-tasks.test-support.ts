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
  freshProductionArtifactIdempotencyToken,
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
  const origin = `http://127.0.0.1:${port}`;
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
        BETTER_AUTH_URL: origin,
        HOST: '127.0.0.1',
        NODE_ENV: 'test',
        PORT: String(port),
      },
    });
    const output = collectOutput(server);
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
        '  kovo((columns) => ({',
        '    authzPolicy: sql`TRUE`,',
        "    domain: 'task-proof',",
        '    key: columns.eventId,',
        '  })),',
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
      "import { account, contacts, rateLimit, session, user, verification } from '../schema.js';",
      [
        'import {',
        '  account,',
        '  contacts,',
        '  rateLimit,',
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

  writeDurableTaskProofModules(root);

  writeFileSync(
    join(root, 'src/durable-task-proof-form.tsx'),
    [
      '/** @jsxImportSource @kovojs/server */',
      "import { component } from '@kovojs/core';",
      "import { scheduleTaskProof } from './durable-task-schedule.js';",
      "import { scheduleCancelledTaskProof } from './durable-task-schedule-cancel.js';",
      "import { scheduleDelayedTaskProof } from './durable-task-schedule-delay.js';",
      "import { scheduleFlakyTaskProof } from './durable-task-schedule-flaky.js';",
      "import { scheduleReplacementTaskProof } from './durable-task-schedule-replace.js';",
      "import { scheduleRollbackTaskProof } from './durable-task-schedule-rollback.js';",
      "import { scheduleSelfRescheduleTaskProof } from './durable-task-schedule-self.js';",
      '',
      'export const DurableTaskProofForm = component({',
      '  mutations: {',
      '    scheduleCancelledTaskProof,',
      '    scheduleDelayedTaskProof,',
      '    scheduleFlakyTaskProof,',
      '    scheduleReplacementTaskProof,',
      '    scheduleRollbackTaskProof,',
      '    scheduleSelfRescheduleTaskProof,',
      '    scheduleTaskProof,',
      '  },',
      '  render: () => (',
      '    <>',
      '      <form mutation={scheduleTaskProof} enhance><input type="hidden" name="proofId" value="artifact-proof" /></form>',
      '      <form mutation={scheduleCancelledTaskProof} enhance><input type="hidden" name="proofId" value="artifact-proof" /></form>',
      '      <form mutation={scheduleDelayedTaskProof} enhance><input type="hidden" name="proofId" value="artifact-proof" /></form>',
      '      <form mutation={scheduleFlakyTaskProof} enhance><input type="hidden" name="proofId" value="artifact-proof" /></form>',
      '      <form mutation={scheduleReplacementTaskProof} enhance><input type="hidden" name="proofId" value="artifact-proof" /></form>',
      '      <form mutation={scheduleRollbackTaskProof} enhance><input type="hidden" name="proofId" value="artifact-proof" /></form>',
      '      <form mutation={scheduleSelfRescheduleTaskProof} enhance><input type="hidden" name="proofId" value="artifact-proof" /></form>',
      '    </>',
      '  )',
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
        "import { recordDurableTask } from './durable-task-record.js';",
        "import { flakyDurableTask } from './durable-task-retry.js';",
        "import { scheduleTaskProof } from './durable-task-schedule.js';",
        "import { scheduleCancelledTaskProof } from './durable-task-schedule-cancel.js';",
        "import { scheduleDelayedTaskProof } from './durable-task-schedule-delay.js';",
        "import { scheduleFlakyTaskProof } from './durable-task-schedule-flaky.js';",
        "import { scheduleReplacementTaskProof } from './durable-task-schedule-replace.js';",
        "import { scheduleRollbackTaskProof } from './durable-task-schedule-rollback.js';",
        "import { scheduleSelfRescheduleTaskProof } from './durable-task-schedule-self.js';",
        "import { selfRescheduleTask } from './durable-task-self-reschedule.js';",
        "import { taskProofCountEndpoint } from './durable-task-count-endpoint.js';",
      ].join('\n'),
    )
    .replace('endpoints: [healthEndpoint],', 'endpoints: [healthEndpoint, taskProofCountEndpoint],')
    .replace(
      'mutations: [addContact, appSignIn, appSignOut],',
      'mutations: [addContact, scheduleTaskProof, scheduleCancelledTaskProof, scheduleDelayedTaskProof, scheduleFlakyTaskProof, scheduleReplacementTaskProof, scheduleRollbackTaskProof, scheduleSelfRescheduleTaskProof, appSignIn, appSignOut],',
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

function writeDurableTaskProofModules(root: string): void {
  writeFileSync(
    join(root, 'src/durable-task-record.ts'),
    [
      "import { domain, mutation, publicAccess, s } from '@kovojs/server'\nimport { task } from '@kovojs/server/tasks'\nimport { trustedAssign } from '@kovojs/server/write-safety';",
      '',
      "import type { AppRequest } from './auth.js';",
      "import { taskProofs } from './schema.js';",
      '',
      "const taskProof = domain('task-proof');",
      "const publicProof = publicAccess('public durable task regression proof');",
      '',
      "async function insertTaskProof(db: AppRequest['db'], eventId: string, proofId: string) {",
      "  await db.insert(taskProofs).values({ eventId: trustedAssign(eventId, { evidence: { digest: 'sha256:50bdcf18fca1a51200dab11f42ace64b20ae8d42194762c00cd14f9e0596ad73', kind: 'test', reference: 'starter-tests/durable-job-id' }, invariant: 'governed-write.authorized-principal', why: { kind: 'policy', policy: 'starter.durable-job-id/v1' } }), proofId });",
      '}',
      '',
      'export const recordTaskEffect = mutation({',
      '  access: publicProof,',
      '  input: s.object({ eventId: s.string(), proofId: s.string() }),',
      "  registry: { tables: ['task_proofs'], touches: [taskProof] },",
      '  async handler(input: { eventId: string; proofId: string }, request: AppRequest) {',
      '    await insertTaskProof(request.db, input.eventId, input.proofId);',
      "    return { status: 'recorded' };",
      '  },',
      '});',
      '',
      "export const recordDurableTask = task('durable-task-proofs/record', {",
      '  input: s.object({ proofId: s.string() }),',
      '  async run(input, context) {',
      "    await context.actAs('durable-task-proof-fixture').runMutation(recordTaskEffect, {",
      '      eventId: context.jobId,',
      '      proofId: input.proofId,',
      '    });',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-retry.ts'),
    [
      "import { domain, mutation, publicAccess, s } from '@kovojs/server'\nimport { task } from '@kovojs/server/tasks'\nimport { trustedAssign } from '@kovojs/server/write-safety';",
      '',
      "import type { AppRequest } from './auth.js';",
      "import { taskProofs } from './schema.js';",
      '',
      "const taskProof = domain('task-proof');",
      "const publicProof = publicAccess('public durable task retry regression proof');",
      '',
      "async function insertTaskProof(db: AppRequest['db'], eventId: string, proofId: string) {",
      "  await db.insert(taskProofs).values({ eventId: trustedAssign(eventId, { evidence: { digest: 'sha256:50bdcf18fca1a51200dab11f42ace64b20ae8d42194762c00cd14f9e0596ad73', kind: 'test', reference: 'starter-tests/durable-job-id' }, invariant: 'governed-write.authorized-principal', why: { kind: 'policy', policy: 'starter.durable-job-id/v1' } }), proofId });",
      '}',
      '',
      'export const recordFlakyTaskEffect = mutation({',
      '  access: publicProof,',
      '  input: s.object({',
      '    attempt: s.number().int().min(1),',
      '    eventId: s.string(),',
      '    failTimes: s.number().int().min(0),',
      '    proofId: s.string(),',
      '  }),',
      "  registry: { tables: ['task_proofs'], touches: [taskProof] },",
      '  async handler(input: { attempt: number; eventId: string; failTimes: number; proofId: string }, request: AppRequest) {',
      '    if (input.attempt <= input.failTimes) {',
      "      throw new Error('durable flaky proof retry');",
      '    }',
      '    await insertTaskProof(request.db, input.eventId, input.proofId);',
      "    return { status: 'recorded' };",
      '  },',
      '});',
      '',
      "export const flakyDurableTask = task('durable-task-proofs/flaky', {",
      '  input: s.object({ failTimes: s.number().int().min(0), proofId: s.string() }),',
      "  retry: { backoff: 'linear', maxAttempts: 4 },",
      '  async run(input, context) {',
      "    await context.actAs('durable-task-proof-fixture').runMutation(recordFlakyTaskEffect, {",
      '      attempt: context.attempt,',
      '      eventId: context.jobId,',
      '      failTimes: input.failTimes,',
      '      proofId: input.proofId,',
      '    });',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-self-reschedule.ts'),
    [
      "import { domain, mutation, publicAccess, s } from '@kovojs/server'\nimport { task } from '@kovojs/server/tasks'\nimport { trustedAssign } from '@kovojs/server/write-safety';",
      '',
      "import type { AppRequest } from './auth.js';",
      "import { taskProofs } from './schema.js';",
      '',
      "const taskProof = domain('task-proof');",
      "const publicProof = publicAccess('public durable self-reschedule regression proof');",
      '',
      "async function insertTaskProof(db: AppRequest['db'], eventId: string, proofId: string) {",
      "  await db.insert(taskProofs).values({ eventId: trustedAssign(eventId, { evidence: { digest: 'sha256:50bdcf18fca1a51200dab11f42ace64b20ae8d42194762c00cd14f9e0596ad73', kind: 'test', reference: 'starter-tests/durable-job-id' }, invariant: 'governed-write.authorized-principal', why: { kind: 'policy', policy: 'starter.durable-job-id/v1' } }), proofId });",
      '}',
      '',
      'export const recordSelfRescheduleEffect = mutation({',
      '  access: publicProof,',
      '  input: s.object({ eventId: s.string(), proofId: s.string() }),',
      "  registry: { tables: ['task_proofs'], touches: [taskProof] },",
      '  async handler(input: { eventId: string; proofId: string }, request: AppRequest) {',
      '    await insertTaskProof(request.db, input.eventId, input.proofId);',
      "    return { status: 'recorded' };",
      '  },',
      '});',
      '',
      "export const selfRescheduleTask = task('durable-task-proofs/self-reschedule', {",
      '  input: s.object({ generation: s.number().int().min(0), proofId: s.string() }),',
      '  maxGenerations: 1,',
      '  async run(input, context) {',
      "    await context.actAs('durable-task-proof-fixture').runMutation(recordSelfRescheduleEffect, {",
      '      eventId: context.jobId,',
      '      proofId: input.proofId,',
      '    });',
      '    await context.schedule(selfRescheduleTask, { generation: input.generation + 1, proofId: input.proofId }, { afterMs: 1 });',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-schedule.ts'),
    [
      "import { domain, mutation, publicAccess, s } from '@kovojs/server'\nimport { type TaskSchedulingRequest } from '@kovojs/server/tasks';",
      '',
      "import type { AppRequest } from './auth.js';",
      "import { recordDurableTask } from './durable-task-record.js';",
      '',
      "const taskProof = domain('task-proof');",
      "const publicProof = publicAccess('public immediate durable task proof');",
      '',
      'export const scheduleTaskProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['task_proofs', '_kovo_jobs'], touches: [taskProof] },",
      '  async handler(input: { proofId: string }, request: AppRequest & TaskSchedulingRequest) {',
      '    await request.schedule(recordDurableTask, { proofId: input.proofId });',
      "    return { status: 'scheduled' };",
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-schedule-rollback.ts'),
    [
      "import { mutation, publicAccess, s } from '@kovojs/server'\nimport { type TaskSchedulingRequest } from '@kovojs/server/tasks';",
      "import type { AppRequest } from './auth.js';",
      "import { recordDurableTask } from './durable-task-record.js';",
      "const publicProof = publicAccess('public durable task rollback proof');",
      'export const scheduleRollbackTaskProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['_kovo_jobs'], touches: [] },",
      '  async handler(input: { proofId: string }, request: AppRequest & TaskSchedulingRequest) {',
      '    await request.schedule(recordDurableTask, { proofId: input.proofId });',
      "    throw new Error('durable rollback proof');",
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-schedule-delay.ts'),
    [
      "import { mutation, publicAccess, s } from '@kovojs/server'\nimport { type TaskSchedulingRequest } from '@kovojs/server/tasks';",
      "import type { AppRequest } from './auth.js';",
      "import { recordDurableTask } from './durable-task-record.js';",
      "const publicProof = publicAccess('public delayed durable task proof');",
      'export const scheduleDelayedTaskProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['_kovo_jobs'], touches: [] },",
      '  async handler(input: { proofId: string }, request: AppRequest & TaskSchedulingRequest) {',
      '    await request.schedule(recordDurableTask, { proofId: input.proofId }, { afterMs: 700 });',
      "    return { status: 'scheduled-delay' };",
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-schedule-cancel.ts'),
    [
      "import { mutation, publicAccess, s } from '@kovojs/server'\nimport { type TaskSchedulingRequest } from '@kovojs/server/tasks';",
      "import type { AppRequest } from './auth.js';",
      "import { recordDurableTask } from './durable-task-record.js';",
      "const publicProof = publicAccess('public cancelled durable task proof');",
      'export const scheduleCancelledTaskProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['_kovo_jobs'], touches: [] },",
      '  async handler(input: { proofId: string }, request: AppRequest & TaskSchedulingRequest) {',
      '    const handle = await request.schedule(recordDurableTask, { proofId: input.proofId }, { afterMs: 5_000 });',
      '    return { cancelled: await request.cancel(handle) };',
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-schedule-replace.ts'),
    [
      "import { mutation, publicAccess, s } from '@kovojs/server'\nimport { publicScopedKey } from '@kovojs/core'\nimport { type TaskSchedulingRequest } from '@kovojs/server/tasks';",
      "import type { AppRequest } from './auth.js';",
      "import { recordDurableTask } from './durable-task-record.js';",
      "const publicProof = publicAccess('public replaced durable task proof');",
      'export const scheduleReplacementTaskProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['_kovo_jobs'], touches: [] },",
      '  async handler(input: { proofId: string }, request: AppRequest & TaskSchedulingRequest) {',
      '    await request.schedule(recordDurableTask, { proofId: `${input.proofId}-old` }, {',
      '      afterMs: 5_000,',
      "      key: publicScopedKey('durable-task-proof-replacement'),",
      '    });',
      '    await request.schedule(recordDurableTask, { proofId: `${input.proofId}-new` }, {',
      "      key: publicScopedKey('durable-task-proof-replacement'),",
      '    });',
      "    return { status: 'scheduled-replacement' };",
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-schedule-flaky.ts'),
    [
      "import { mutation, publicAccess, s } from '@kovojs/server'\nimport { type TaskSchedulingRequest } from '@kovojs/server/tasks';",
      "import type { AppRequest } from './auth.js';",
      "import { flakyDurableTask } from './durable-task-retry.js';",
      "const publicProof = publicAccess('public flaky durable task proof');",
      'export const scheduleFlakyTaskProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['_kovo_jobs'], touches: [] },",
      '  async handler(input: { proofId: string }, request: AppRequest & TaskSchedulingRequest) {',
      '    await request.schedule(flakyDurableTask, { failTimes: 2, proofId: input.proofId });',
      "    return { status: 'scheduled-flaky' };",
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-schedule-self.ts'),
    [
      "import { mutation, publicAccess, s } from '@kovojs/server'\nimport { type TaskSchedulingRequest } from '@kovojs/server/tasks';",
      "import type { AppRequest } from './auth.js';",
      "import { selfRescheduleTask } from './durable-task-self-reschedule.js';",
      "const publicProof = publicAccess('public self-rescheduled durable task proof');",
      'export const scheduleSelfRescheduleTaskProof = mutation({',
      '  access: publicProof,',
      '  input: s.object({ proofId: s.string() }),',
      "  registry: { tables: ['_kovo_jobs'], touches: [] },",
      '  async handler(input: { proofId: string }, request: AppRequest & TaskSchedulingRequest) {',
      '    await request.schedule(selfRescheduleTask, { generation: 0, proofId: input.proofId });',
      "    return { status: 'scheduled-self-reschedule' };",
      '  },',
      '});',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    join(root, 'src/durable-task-count-endpoint.ts'),
    [
      "import { eq } from 'drizzle-orm';",
      "import { endpoint, publicAccess } from '@kovojs/server'\nimport { type EndpointDbContext } from '@kovojs/server/routing';",
      '',
      "import type { AppDb } from './db.js';",
      "import { taskProofs } from './schema.js';",
      '',
      "const publicProof = publicAccess('public durable task proof count');",
      '',
      "export const taskProofCountEndpoint = endpoint('/api/task-proof-count', {",
      '  access: publicProof,',
      "  auth: { justification: 'public durable task proof count', kind: 'none' },",
      '  csrf: false,',
      "  csrfJustification: 'read-only durable task proof count',",
      '  db: true,',
      '  async handler(request, context: EndpointDbContext<AppDb>) {',
      "    const scoped = await context.actAs('durable-task-proof-fixture');",
      '    const db = scoped.db.read;',
      '    const proofId = new URL(request.url).searchParams.get("id");',
      '    const rows = proofId',
      '      ? await db.select().from(taskProofs).where(eq(taskProofs.proofId, proofId))',
      '      : await db.select().from(taskProofs);',
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
  const actionByMode: Record<string, string> = {
    cancel: '/_m/durable-task-schedule-cancel/schedule-cancelled-task-proof',
    delay: '/_m/durable-task-schedule-delay/schedule-delayed-task-proof',
    flaky: '/_m/durable-task-schedule-flaky/schedule-flaky-task-proof',
    immediate: '/_m/durable-task-schedule/schedule-task-proof',
    replace: '/_m/durable-task-schedule-replace/schedule-replacement-task-proof',
    'self-reschedule': '/_m/durable-task-schedule-self/schedule-self-reschedule-task-proof',
    throw: '/_m/durable-task-schedule-rollback/schedule-rollback-task-proof',
  };
  const action = actionByMode[mode];
  if (!action) throw new Error(`Unknown durable task proof mode: ${mode}`);
  let form: string;
  try {
    form = formHtmlByAction(pageHtml, action);
  } catch (error) {
    const renderedForms = pageHtml.match(/<form\b[^>]*>/g) ?? [];
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${cause} Page status: ${pageResponse.status}. Rendered forms: ${JSON.stringify(renderedForms)}.`,
    );
  }
  return fetch(`${origin}${action}`, {
    body: new URLSearchParams({
      csrf: fieldValue(form, 'csrf'),
      proofId,
      'Kovo-Idem': freshProductionArtifactIdempotencyToken(),
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
