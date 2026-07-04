---
title: Background tasks
description: Send the email after the order commits, with durable scheduling, retries, and graph-visible edges.
order: 2.6
---

# Background tasks

Use a task when the side effect should happen after the write commits: email, webhooks, cache warm,
report generation, or recurring cleanup. Reach for a mutation when the work must finish before the
user gets a response.

## Define a task

Start with one durable function:

```text
// Source-verified shape from packages/server/src/task.ts
import { s, task } from '@kovojs/server';

export const sendWelcomeEmail = task('email/send-welcome', {
  input: s.object({ email: s.string().email(), userId: s.string() }),
  async run({ email }) {
    await fetch('https://api.resend.com/emails', { body: JSON.stringify({ to: email }), method: 'POST' });
  },
});
```

The task input is schema-checked before it enters the queue. The task body gets no ambient request
transaction, so background work cannot quietly reuse the caller's DB handle.

## Schedule it from a mutation

Schedule it where the write commits:

```text
// Source-verified shape from packages/server/src/task.ts
import { mutation, publicAccess, s } from '@kovojs/server';

declare const sendWelcomeEmail: any;

export const createAccount = mutation({
  access: publicAccess('demo sign-up route'),
  input: s.object({ email: s.string().email(), userId: s.string() }),
  async handler(input, request) {
    await request.schedule(sendWelcomeEmail, input);
    return { ok: true };
  },
});
```

What matters here is the transaction boundary. The queue row is written with the mutation's commit.
If the mutation rolls back, the task never becomes runnable.

## Run it

On the node preset, task draining is part of the shipped runtime. You can inspect the graph shape
after a build:

```sh
kovo explain --tasks dist/.kovo/graph.json
kovo explain task email/send-welcome dist/.kovo/graph.json
```

The CLI prints the discovered task keys, cron schedules, and the mutation/query edges it saw:

```text
kovo-explain/v1
TASKS
TASK email/send-receipt cron=0 2 * * * runMutations=order/mark-sent runQueries=order/by-id schedules=email/send-receipt
SUMMARY total=1
```

## Coalesce bursts

Keyed schedules let you collapse repeated work:

```text
// Source-verified shape from packages/server/src/task.ts
await request.schedule(sendWelcomeEmail, input, {
  key: `welcome:${input.userId}`,
});
```

That default is debounce: the latest ready job wins. Use throttle when the first ready job should
stay put and later duplicates should be ignored:

```text
// Source-verified shape from packages/server/src/task.ts
await request.schedule(sendWelcomeEmail, input, {
  coalesce: 'throttle',
  key: `welcome:${input.userId}`,
});
```

## Run it on a schedule

Recurring tasks are declared on the task itself:

```text
// Source-verified shape from packages/server/src/task.ts
import { s, task } from '@kovojs/server';

export const nightlyCleanup = task('maintenance/nightly-cleanup', {
  catchUp: 'backfill',
  cron: '0 2 * * *',
  input: s.object({ kind: s.string().default('nightly') }),
  run() {},
});
```

Use `catchUp: 'skip'` when a missed run should be dropped. Use `backfill` when each missed window
still matters.

## Deploy the runner

Durable tasks need a preset with a real drainer. The node preset ships one by default, and it
persists queue rows in Postgres.

For inspection or custom operational views, adapt your DB client and read `_kovo_jobs` through the
framework surface:

```text
// Source-verified shape from packages/server/src/task-queue.ts and task-observability.ts
import { createDurableTaskSqlExecutor, createDurableTaskStatus } from '@kovojs/server';

declare const db: { query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }> };

const status = createDurableTaskStatus(createDurableTaskSqlExecutor(db));
await status.listFailures({ includeArgs: true, limit: 20 });
```

## Handle failure

Task failures retry according to the task definition. Cancellation is explicit:

```text
// Source-verified shape from packages/server/src/task.ts
const handle = await request.schedule(sendWelcomeEmail, input, { afterMs: 5_000 });
await request.cancel(handle);
```

If a task throws after exhausting retries, it stays visible in the durable status surface. Treat
that like any other dead-letter queue: alert on it, inspect the args deliberately, and replay only
after you understand the root cause.

## Next

- [Deployment](/guides/deployment/) — choose a preset that can actually drain tasks.
- [Endpoints & webhooks](/guides/endpoints-webhooks/) — wire external machine ingress into the same app.

<details>
<summary>Spec & diagnostics</summary>

Task declarations, scheduling, keyed coalescing, cron, and retries: `packages/server/src/task.ts`
and `spec/09-wire-protocol.md` §9.6. Node runner behavior: `packages/server/src/task-runner.ts`
and `packages/server/src/task-runtime.ts`. Durable queue/status helpers:
`packages/server/src/task-queue.ts` and `packages/server/src/task-observability.ts`. CLI task
explain output: `packages/cli/src/index.kovo-explain.test.ts`. Builds fail closed when a preset has
no runner capability or the default node runner would land on an unsupported SQLite queue path.

</details>
