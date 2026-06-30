# Durable Tasks & Scheduling (`task()` + `request.schedule()`)

Created 2026-06-30. Design plan. Source of truth remains `SPEC.md`; this primitive requires a new
SPEC section (proposed §9.6 / §10.7) — treat the design below as the proposal to ratify there before
implementation, and cite it from the code/tests once landed.

## Motivation

`bugz-21` B3: the default `mutation({ handler })` runs with **no framework transaction**, so a
throwing multi-step handler leaves a partial write — violating the normative SPEC §10.3:1174
contract (`guard chain → BEGIN tx → handler (Tx-typed db; escaping the tx is a type error) →
COMMIT`). The B3 fix is to make the default handler atomic (Tx-typed db). That fix raises one
question: where do **non-DB side effects** (charge a card, send email, write S3) go, now that the
handler can't do non-transactional work?

The wrong answer is an `atomic: false` opt-out — it contradicts the SPEC contract and Kovo's
stronger-default bias, and it is the same silently-flippable escape hatch this dogfood series keeps
finding abused (`bugz-21` B2 `trustedSql` name-shadow, `bugz-17` B1 `publicAccess`-as-proof). The
right answer is a **durable scheduled-task seam** modeled on Convex's `scheduler.runAfter`: the
schedule call is part of the mutation transaction, so you get exactly-once durability with one-line
ergonomics — collapsing the lossy "after-commit hook" and the boilerplate "transactional outbox"
into a single primitive.

## Design

Three pieces. Default atomicity (B3) is the prerequisite; this plan owns the `task()` seam and runner.

### 1. `task()` — a durable background function (the "action" tier Kovo lacks)

A registry primitive next to `query()`/`mutation()`/`endpoint()`/`webhook()`. Non-transactional,
MAY do external I/O, framework-managed retries + exactly-once. External I/O is legal **only** inside
`task.run` (the Tx-typed mutation db makes it a type/gate error elsewhere — keeps "no side effects in
a tx" by construction).

```ts
export const sendOrderEmail = task({
  input: s.object({ orderId: s.string() }),
  retry: { maxAttempts: 5, backoff: 'exponential' },
  async run({ orderId }, ctx) {
    const order = await ctx.runQuery(getOrder, { orderId }); // fresh read
    await email.send(order.email, 'Order confirmed', { order }); // external I/O allowed HERE
    await ctx.runMutation(markEmailed, { orderId }); // a FRESH transaction
  },
});
```

**`ctx` surface (decided): composition only — no raw `db`.** A task gets `runQuery`, `runMutation`,
`schedule` (chain more tasks), `fetch`/external I/O, `storage`, and secrets — but **not** a raw
transactional `db`. Every DB write a task makes flows through `ctx.runMutation(...)`, so it reuses the
_one_ atomic, KV414/438/407-audited, idempotent write path; the analyzer also sees `runQuery`/
`runMutation` calls so the touch/invalidation graph and registry stay complete. The "ceremony" of
defining a mutation per write is the feature — no second write path to re-prove the gates on.

**A task MAY schedule both immediate fan-out and _delayed_ tasks** (`ctx.schedule(t, args, { afterMs })`)
— this is what enables polling loops, sagas/workflows (step N → step N+1), custom backoff, and
self-reschedule. Two distinct runaway backstops:

- **Synchronous fan-out within one `run` is capped by chain depth** (a task can't enqueue unbounded
  work in one execution).
- **Delayed scheduling is bounded by a _lineage generation_ counter, not depth** (each delayed job is
  a fresh execution with depth reset, so the depth cap doesn't catch a self-reschedule loop). A
  scheduled job carries a `lineage` (root id) + `generation`; a (re)schedule from within a task
  increments `generation`; past a **conservative default ceiling (`maxGenerations = 64`, per-task
  overridable)** the job is **dead-lettered with a diagnostic** rather than looping forever. The
  default is intentionally low — it covers sagas and short polls comfortably, and a legitimately
  long-running poller raises it **explicitly** (`task({ maxGenerations: 240 })`), making the unbounded
  case a visible, opt-in decision. A **delay floor** (self-reschedule `afterMs ≥ 1s`, clamped)
  prevents a zero-delay self-loop from becoming a hot loop hammering Postgres.

### 2. `request.schedule(task, args, opts?)` — enqueue _inside_ the mutation tx

```ts
export const createOrder = mutation({
  input: s.object({ items: s.array(/* … */) }),
  registry: { touches: [order, orderItem] },
  async handler({ items }, request) {
    const [{ id }] = await request.db
      .insert(orders)
      .values({
        /* … */
      })
      .returning({ id: orders.id });
    for (const it of items) await request.db.insert(orderItems).values({ orderId: id, ...it });

    request.schedule(sendOrderEmail, { orderId: id }); // ≈ Convex runAfter(0, …)
    // a delayed job, debounce-keyed so re-scheduling replaces the pending one:
    const h = request.schedule(
      chargeReminder,
      { orderId: id },
      { afterMs: 86_400_000, key: `reminder:${id}` },
    );
    // ... in a LATER mutation (e.g. on completion): request.cancel(h) — or schedule the same key again
    return { orderId: id };
  },
});
```

Semantics (normative once SPEC'd):

- The job row is written to the durable queue **in the same transaction** as the data. **Commit ⇒
  runs exactly-once; rollback ⇒ never enqueued.** No outbox table or drainer for the author to write.
- Args are typed against the task's `input` (no opaque closures); the task runs in a clean context
  (DB writes via `ctx.runMutation`), so an after-commit effect can never touch the caller's Tx-typed db.
- `opts`: `{ afterMs?, at?, key? }`. Delayed execution is a `run_at` column.
- **`schedule()` returns a typed handle** (the row id, known synchronously since it's written in the
  tx). **`request.cancel(handle)`** cancels a still-`ready` job (transactional, in a mutation tx) and
  **returns whether it cancelled** — cancellation is honestly _best-effort_ (a `running`/already-run
  job can't be cancelled). A **`key`** gives debounce/coalesce: scheduling the same key upserts the
  pending job, so reminders reschedule without the app tracking ids.
- **`key` coalescing semantics (decided):** default `{ key }` is **debounce** — upsert the pending
  job, **reset `run_at`** to the new time, **replace args** with the latest ("latest state, N after
  the last trigger"). `{ key, coalesce: 'throttle' }` keeps the **earliest `run_at`** and **first
  args** (leading-edge rate limit). If the existing keyed job is already `running` (not `ready`), a
  re-schedule **enqueues a fresh pending job** (never mutate a running execution; the latest state
  runs after). `key` overrides the default per-`(schedule-site, args)` idem dedup — it _is_ the
  logical identity. Mechanism: a partial unique index `(key) WHERE status='ready'` + `INSERT … ON
CONFLICT … DO UPDATE`, atomic against the SKIP-LOCKED claimer.

This unification is strictly better than offering both seams:

|                   | after-commit hook | hand-rolled outbox     | `request.schedule(task,…)`   |
| ----------------- | ----------------- | ---------------------- | ---------------------------- |
| Delivery          | at-most-once      | exactly-once           | **exactly-once**             |
| Boilerplate       | none              | outbox table + drainer | **none**                     |
| Atomic with data  | yes               | yes                    | **yes (enqueue in tx)**      |
| Typed args        | opaque closure    | manual JSON            | **typed**                    |
| Effect DB access  | footgun (Tx db)   | fresh tx               | **fresh tx by construction** |
| Delayed/scheduled | no                | DIY                    | **`afterMs`/`at` built in**  |

### 3. The runner is a Postgres-table queue (storage) + a `JobRunner` preset capability (dispatch)

**The queue is just a DB table.** The job row is written transactionally with the data; in
multi-node both app servers point at the same Postgres and see the same table. The only non-trivial
part is _who runs the loop without double-executing_ — and Postgres `FOR UPDATE SKIP LOCKED` solves
that with no extra infra (the pattern behind pg-boss / Oban / River / Solid Queue):

```sql
WITH claimed AS (
  SELECT id FROM _kovo_jobs
  WHERE status = 'ready' AND run_at <= now()
  ORDER BY run_at LIMIT 10
  FOR UPDATE SKIP LOCKED                  -- concurrent runners get DISJOINT rows, never block
)
UPDATE _kovo_jobs j
SET status = 'running', lease_until = now() + interval '30 s', attempts = attempts + 1
FROM claimed WHERE j.id = claimed.id
RETURNING j.*;
```

Plus, all still in the table: a **lease reaper** (`status='running' AND lease_until < now()` →
`ready`, gives at-least-once on a node crash), **retry/backoff** (`run_at = now() + backoff`;
`> max_attempts` → `dead` dead-letter), and **exactly-once at the effect** via the existing
`Kovo-Idem` replay store (SPEC §9.1:1182). Single-node and multi-node-on-node-preset run **identical
code**; `LISTEN/NOTIFY` on enqueue upgrades polling to push on real Postgres.

**`JobRunner` as a preset capability.** The enqueue API and table schema are identical everywhere;
only the _drainer_ differs by deployment — so it slots into the same preset mechanism that declares
KV417 retention:

| Strategy                                                                             | When                                                | Pros                                                                                    | Cons                                                                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **A. In-process pollers on every node** (SKIP LOCKED + lease + NOTIFY) — **default** | node preset, single or multi-node                   | zero extra infra; same code single→multi; transactional enqueue; scales by adding nodes | poll latency w/o NOTIFY; every node polls; long job holds a connection; no fit for serverless |
| **B. Leader-elected dispatcher** (`pg_try_advisory_lock`)                            | need one authoritative scheduler (cron-style dedup) | one clock; less redundant scanning                                                      | leader is bottleneck/SPOF w/ failover; more parts than A                                      |
| **C. External broker via outbox-relay** (Redis/BullMQ, SQS)                          | very high throughput; separate worker fleet         | purpose-built infra; native scheduling/dashboards                                       | reintroduces dual-write → outbox-relay bridge (HA, 2nd hop); extra infra vs "just Postgres"   |
| **D. Serverless: cron-drain or platform queue** (Cloudflare/Vercel)                  | presets with no long-lived process                  | uses platform durable primitives                                                        | latency (cron) or relay complexity; the only case needing genuinely new infra                 |

Default ships **A**; presets that can't host a poller bring their own drainer (D), and **C** is an
opt-in scale adapter. "Real infra work" only appears in **D** (no process to poll) — _not_ in
multi-node on the node preset, where the table + SKIP LOCKED is the whole queue.

**Decided (KV417-style fail-closed):** the **node preset defaults the in-process poller ON** (it can
genuinely host it — Convex-like ergonomics, no config). A preset that declares **no** `JobRunner`
must make `task()`/`schedule()` a **fail-closed build error** with an actionable message (e.g.
"this preset declares no JobRunner; declare a cron-drain or queue adapter") — never a silent no-op,
which would be the same green-build-dead-artifact class as KV417. The binary also supports a
**runner-only** mode (a dedicated worker fleet that drains but doesn't serve HTTP) so job execution
need not starve request serving under load; default = serve-and-poll, scale = add runner-only nodes.

**Operational knobs (decided, all fail-closed on unbounded use):**

- **Lease = per-task `timeout`** (default ~30 s, hard ceiling), with the runner **heartbeating** to
  extend `lease_until` for a legitimately-long job up to the ceiling; past the ceiling → kill +
  retry/dead-letter (backstop against a hung task pinning a worker — cf. the `bugz-21` D3 hang class).
- **Max-in-flight per node is bounded by the DB connection pool** (each running task may hold
  connections via `runMutation`): default `≈ poolSize − reserve`, configurable, never unbounded; the
  claim `LIMIT` respects remaining capacity.
- **Backpressure: grow the table, never fail the producer.** `schedule()` must not reject on queue
  depth (that would fail the _order_ because the _email_ queue is deep). Use **priority lanes**
  (`task({ priority })`, claim ordered by priority then `run_at`) and **per-task-type concurrency
  caps** so one slow task type can't starve the pool; expose queue-depth/oldest-job metrics (Phase 4).

## Implementation checklist (phased)

- [x] **Phase 0 (prerequisite — `bugz-21` B3).** Default `mutation({ handler })` runs in a
      framework-opened transaction with a **Tx-typed db** that rolls back on throw, per SPEC §10.3:1174;
      external I/O in a mutation handler becomes a type/gate error. Lands independently; this plan builds
      on it. Acceptance: an end-to-end prod-artifact test where a handler that writes then throws leaves
      the DB unchanged (per the close-out rule — artifact layer, not a unit proxy).
      Evidence: `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts`
      passes, proving a production artifact write-then-throw mutation leaves the DB unchanged.
- [x] **Phase 1 — `task()` + `request.schedule()` + Postgres queue + node-preset runner (MVP).**
      Added the `task()` registry primitive (typed `input`, `run(args, ctx)` with composition-only
      `ctx`: `runQuery`/`runMutation`/`schedule`/`fetch`, no raw db); `request.schedule(task, args,
      { afterMs?, at?, key? })` writes a `_kovo_jobs` row in the mutation tx and returns a typed
      handle; `request.cancel(handle)` + keyed debounce/throttle are backed by the Postgres queue,
      SKIP-LOCKED claim loop, lease reaper, and `run_at` scheduling. `ctx.storage` remains deferred
      under the storage open question below.
      Evidence: `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.durable-tasks.test.ts`
      passes, proving a production artifact schedules-then-throws without enqueueing, runs a
      successful task exactly once, respects `afterMs`, cancels a pending job, and replaces a keyed
      pending job.
- [ ] **Phase 2 — exactly-once, retries, dead-letter, knobs, low-latency.** Dedup via the `Kovo-Idem`
      replay store (SPEC §9.1:1182) with the per-`(schedule-site, args)` idem key, and **expose the job
      id as the external-API idempotency key**; retry/backoff with `max_attempts → dead` dead-letter;
      per-task `timeout`→lease + heartbeat + hard ceiling; pool-bounded max-in-flight; priority lanes +
      per-task concurrency caps; the **lineage `generation` ceiling** (`maxGenerations = 64` default,
      per-task overridable) + self-reschedule **delay floor** for delayed-task recursion; `LISTEN/NOTIFY`
      wakeup. Acceptance: a task that fails twice then succeeds runs its effect once; a permanently-failing
      task lands in dead-letter; a duplicate delivery does not re-execute; a hung task is killed at the
      ceiling and retried, not pinned; a self-rescheduling task that exceeds `maxGenerations` dead-letters
      with a diagnostic instead of looping forever.
- [ ] **Phase 3 — `JobRunner` preset capability + adapters.** Factor the runner behind a
      `JobRunner` capability declared by presets (parallel to KV417 retention). Ship the serverless
      cron-drain adapter (Cloudflare Cron / Vercel Cron drains the outbox via SKIP LOCKED) and an
      optional external-broker outbox-relay adapter; support a **runner-only** binary mode (drain without
      serving HTTP) for dedicated worker fleets. Acceptance: a scaffold builds and runs scheduled tasks on
      the node preset by default; a serverless preset declares a drainer and runs the same tasks; a
      `task()`/`schedule()` on a preset with **no** declared `JobRunner` **fails the build** with an
      actionable diagnostic (KV417-style), never a silent no-op.
- [ ] **Phase 4 — observability.** Job status/inspection surface and dead-letter visibility (and fix
      `bugz-21` D1 — the prod server logging nothing — so a stuck/failed task is not invisible).
      Acceptance: failed and dead-lettered jobs are queryable/logged in the deployed artifact.
- [ ] **Phase 5 (follow-on) — cron / recurring tasks.** A thin layer over the one-shot queue
      (`task({ cron: '0 2 * * *' })` or a `recurring()` declaration). Exactly-once-per-tick via
      unique-occurrence-key materialization — `INSERT … ON CONFLICT (cron_name, occurrence_ts) DO NOTHING`
      with `occurrence_ts` from the **DB clock** (no leader, no SPOF); per-cron `catchUp: 'skip' |
'backfill'` (default `skip`, bounded backfill). Acceptance: with N runner nodes, a recurring task
      fires exactly once per occurrence (no duplicate, no miss while the fleet is up); a missed occurrence
      during a full outage is skipped (or bounded-backfilled) per policy.

## Security / soundness invariants (must hold)

- The `task` is a typed registry function — no opaque closures cross the boundary.
- External I/O is legal **only** inside `task.run`; a mutation handler's Tx-typed db makes
  out-of-tx/external work a type or KV-gate error — preserving "no side effects in a transaction."
- `request.schedule()` writes the job **in the caller's transaction** — atomic with the data, so a
  rolled-back mutation never schedules; a committed one schedules exactly once.
- The runner claim is fail-closed: a leased job whose holder dies is reclaimed (lease timeout), and
  exactly-once at the effect rides on the `Kovo-Idem` replay store (at-least-once delivery + idempotent
  task = effectively-once).
- No `atomic: false` and no silent escape: the _only_ path to a non-DB side effect is a scheduled
  `task`, keeping the §10.3:1174 atomicity contract unbreakable.
- **Delivery model is at-least-once + idempotent (exactly-once _delivery_ is impossible; at-most-once
  loses data).** The framework derives an idem key per `(schedule-site, args)` and dedups via the
  replay store, so the common case is automatically once. For a **non-idempotent external call**
  (charge a card), the framework exposes the **job id as a stable idempotency key** the task passes
  to the external API (e.g. Stripe `Idempotency-Key`) — a first-class, documented affordance so a
  retry cannot double-charge. Task authors must treat `run` as retryable.

## SPEC / rules touch points

- New SPEC section (proposed) for `task()`/`request.schedule()` semantics, the durable-queue
  contract, and the `JobRunner` preset capability; cross-reference §10.3:1174 (mutation tx lifecycle),
  §9.1:1182 (atomic replay reservation = exactly-once basis), §9.1:902 (webhook `COMMIT → emit` +
  `outbox` precedent), §14 (deploy-skew / preset capability model).
- `rules/api-surface.md`: `task()` and `request.schedule()` are new public exports — run the API
  surface gate when they land.
- Reuses existing machinery: the `Kovo-Idem` replay store, the webhook outbox concept
  (`packages/server/src/webhook.ts:573`), the typed registry, and the post-commit change-record
  lifecycle.

## Resolved design decisions

1. **`ctx` surface = composition only, no raw db** — `runQuery`/`runMutation`/`schedule`/`fetch`/
   `storage`/secrets; DB writes flow through the one gated atomic mutation path; chain depth capped.
   _Rationale:_ a single provably-gated write path; no second surface to re-prove KV414/438 on.
2. **`schedule()` returns a handle + supports `key`** — `request.cancel(handle)` (best-effort,
   returns whether it cancelled) and a `key` for debounce/coalesce (upsert pending). _Rationale:_
   covers the reminder/debounce use case without app-tracked ids; honest about best-effort cancel.
3. **Operational knobs are bounded/fail-closed** — per-task `timeout`→lease with heartbeat + hard
   ceiling; max-in-flight bounded by the connection pool; grow-don't-fail backpressure with priority
   lanes + per-task concurrency caps + depth metrics. _Rationale:_ never pin a worker on a hung task,
   never exhaust the pool, never couple producer success to consumer health.
4. **Runner = preset capability; node preset defaults it ON; no-runner + `task()` = fail-closed build
   error** (KV417-style); support runner-only worker instances. _Rationale:_ Convex-like ergonomics
   where a poller is hostable, but the serverless gap is loud, not a silent no-op.
5. **At-least-once + idempotent; framework idem key; job id exposed as the external-API idempotency
   key.** _Rationale:_ exactly-once delivery is impossible; this is the only robust, crash-safe model,
   and it makes non-idempotent external calls (charges) safe under retry.
6. **`key` coalescing = debounce by default** (reset `run_at`, latest args); **`coalesce: 'throttle'`**
   keeps earliest `run_at` + first args; a re-schedule against a `running` keyed job enqueues a fresh
   job; partial unique index `(key) WHERE ready`. _Rationale:_ debounce is the common ask; throttle is
   the explicit rate-limit opt; never mutate a running execution.
7. **Tasks may schedule delayed tasks**, bounded by a **lineage `generation` ceiling
   (`maxGenerations = 64` default, conservative, per-task overridable)** + a self-reschedule delay
   floor — _not_ the synchronous chain-depth cap. _Rationale:_ enables sagas/polling/backoff while a
   runaway self-reschedule dead-letters fast; the long-running case is an explicit, visible opt-in.
8. **Cron/recurring is a follow-on; "exactly one fire per tick" uses a unique occurrence key, NOT
   leader election** — each node races to `INSERT … ON CONFLICT (cron_name, occurrence_ts) DO NOTHING`
   with `occurrence_ts` computed from the **DB clock** (not local clocks → no skew), so exactly one row
   materializes with no leader/SPOF; per-cron `catchUp: 'skip' | 'backfill'` (default `skip`).
   _Rationale:_ reuses the idempotency principle, keeps "just Postgres, no SPOF"; leader election
   (strategy B) stays available for cases that genuinely need one authoritative scanner — cron doesn't.

## Remaining open questions

- [ ] `catchUp: 'backfill'` upper bound — how many missed occurrences to replay before giving up
      (a bounded backfill, not an unbounded catch-up storm after a long outage).
- [ ] `ctx.storage` scoping inside a task (which capability/bucket; signed-URL access) — defer to the
      storage-capability surface.
- [ ] Whether `task()` can also be triggered directly (HTTP/event) or only via `schedule()`/cron —
      likely out of scope for v1 (that is what `endpoint()`/`webhook()` are for).
