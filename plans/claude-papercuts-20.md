# Durable Tasks Papercuts 20

Created 2026-06-30. Source of truth remains `SPEC.md` §9.6. This ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the freshly-landed durable-task
surface (`task()` / `request.schedule()` / cron / JobRunner / observability) as an app author.
Confirmed security/soundness defects are in `plans/claude-bugz-22.md` (B1 unaudited task writes, B2
inert runaway backstops, B3 invalid-cron bricks app, B4 silent unregistered-schedule loss).

**Meta-theme:** the durable-task RUNTIME is solid (transactional enqueue, retry/backoff, dead-letter,
idempotency key, priority/concurrency, cron exactly-once, multi-node dedup all check out — see Refuted).
The hot spots are **build-time validation, static-audit representation, and a few contract/diagnostic
edges** — the same "the deploy gate diverges from the runtime" pattern this dogfood series keeps finding.

## Scope

Default postgres/PGlite `create-kovo` scaffold linked to the local monorepo; production node-preset
artifact (`kovo build` → `dist/server/server.mjs`). Durable tasks are fresh ground — no prior ledger
covers §9.6, so all items are novel. Root causes confirmed first-hand in framework source; runtime
symptoms reproduced by an authoring agent + an independent skeptical verifier in a then-healthy build
env (see env note in `claude-bugz-22.md`). Out of scope: the env-artifact KV446 false-trip (see
Refuted) and fixing any production code.

## Issues

### A. Cron validation & semantics

- [ ] **A1 — The cron parser silently deviates from standard cron semantics (`N/step` and day-of-month/day-of-week), mis-scheduling with no diagnostic.** (med, framework; found by `dt-cron`, verified independently)
  - Observed behavior: `'5/15 * * * *'` fires only at minute :05 (not :05/:20/:35/:50); day-of-month and day-of-week are ANDed rather than POSIX-ORed. No warning — the task just runs on a different schedule than written.
  - Root cause: the cron field parser in `packages/server/src/task-cron.ts` (`parseCronExpression`/field expansion) implements a non-standard `N/step` and DOM∧DOW intersection; SPEC §9.6 does not yet pin cron grammar, but the JSDoc (`task.ts:84`) advertises a "five-field UTC cron expression", which authors reasonably read as standard cron.
  - Why it matters: a recurring job silently runs less/more often than intended — a correctness hole with no diagnostic, on a durable side-effect surface (billing, digests, cleanups).
  - Repro evidence: fixed-clock materializer unit repro — `'5/15 * * * *'` yields a single :05 occurrence per hour; `'0 0 1 * 1'` (DOM=1 AND DOW=Mon) fires only when both hold, vs POSIX OR.
  - Acceptance: adopt standard cron semantics (`N/step` = base then every `step`; DOM/DOW OR per POSIX) or reject/diagnose the unsupported forms at build time; document the grammar in SPEC §9.6.

- [ ] **A2 — `cronArgs` is typed optional even when the task `input` schema has required fields, so a recurring task that can never validate type-checks and builds green, then dead-letters every occurrence at runtime.** (med, framework; found by `dt-cron`, verified independently)
  - Observed behavior: `task({ cron, input: s.object({ proofId: s.string() }) })` with no `cronArgs` (or partial `cronArgs`) passes `tsc` and `kovo build`; at each tick the materialized job fails input validation and dead-letters — forever, once per occurrence.
  - Root cause: `TaskDefinition.cronArgs?: InferSchema<InputSchema>` (`packages/server/src/task.ts:88-89`) is unconditionally optional and defaults to `{}`; the type does not require `cronArgs` to satisfy the (required) `input` schema when `cron` is set. `assertTaskCronOptions` (`task.ts:186-206`) only checks `cronArgs` requires `cron`, not that it satisfies `input`.
  - Why it matters: the type is wider than the runtime contract — a recurring task that can never run builds green and silently dead-letters every tick (same class as the cron/atomicity "green build, runtime failure" theme).
  - Repro evidence: omit `cronArgs` on a cron task with a required-field `input` → green build → every occurrence dead-letters on input validation.
  - Acceptance: when `cron` is set, `cronArgs` must type-satisfy `input` (conditional-type requirement), or `kovo build` rejects a cron task whose `cronArgs` cannot validate against `input`.

### B. Runner ergonomics & diagnostics

- [ ] **B1 — `retry: { backoff }` without `maxAttempts` is a silent no-op (no retries); `maxAttempts: 0` is silently coerced to 1.** (low, framework; found by `dt-runner`, verified independently)
  - Observed behavior: a task declaring only `retry: { backoff: 'exponential' }` is not retried on failure; `maxAttempts: 0` runs once anyway. No diagnostic in either case.
  - Root cause: the runner's retry policy in `packages/server/src/task-runner.ts` treats a missing `maxAttempts` as "no retry budget" and clamps `0→1`, so the partial `retry` config reads as configured-but-inert.
  - Why it matters: an author who sets a backoff strategy reasonably expects retries; silently getting none (or one) defeats the at-least-once intent and is easy to ship unnoticed.
  - Repro evidence: flaky task with `retry:{backoff}` only → fails once, never retried; with `maxAttempts:0` → runs exactly once.
  - Acceptance: `retry: { backoff }` implies a sensible default `maxAttempts`, or `task()` rejects a `retry` object without `maxAttempts`; `maxAttempts:0` is either rejected or honored (zero attempts) rather than coerced.

- [ ] **B2 — A non-`Error` thrown from a task body is persisted as `"[object Object]"` in the dead-letter `last_error`, losing the diagnostic.** (low, framework; found by `dt-runner`, verified independently)
  - Observed behavior: `throw { code: 'X', detail: … }` in a task → the dead-letter row's `last_error` is the literal string `"[object Object]"`.
  - Root cause: the runner stringifies the thrown value with `String(err)`/template coercion instead of structured serialization (`packages/server/src/task-runner.ts` error capture path; `task-runtime.ts:178-199` reporting).
  - Why it matters: dead-letter rows are the operator's only post-mortem; a stringified `[object Object]` erases the cause for any task that throws a non-`Error`.
  - Repro evidence: task throws a plain object → `_kovo_jobs.last_error = "[object Object]"`.
  - Acceptance: non-`Error` throws are serialized (JSON / `util.inspect`-style) into `last_error`.

- [ ] **B3 — `concurrency: 1` does not serialize a task under `timeoutMs`: the runner frees the concurrency slot when the deadline fires while the abandoned body keeps running, so the same job overlaps itself and is marked `dead` while its effect actually committed.** (low, framework; found by `dt-runner`; double-charge framing refuted, residual confirmed)
  - Observed behavior: `concurrency:1, timeoutMs:300, maxAttempts:2`, body sleeps 1500ms — two attempts of the same job run with ~130ms physical overlap, both run to completion (~1502ms each, far past 300ms) and both commit; the job ends `status:dead`.
  - Root cause: `runWithDeadline` races `task.run` against a timeout (`packages/server/src/task-runner.ts:198-229,349-360`) but cannot cancel the body (JS limitation); `runTrackedJob` (`:134-145`) decrements `inFlightByTask` in `finally` as soon as `runJob` returns (right after the timeout `markFailed`), freeing the slot while the abandoned body still runs, so `claimableTaskKeys` (`:120-132`) re-admits the task → self-overlap.
  - Why it matters: `concurrency:1` is the obvious mutual-exclusion primitive but silently fails to serialize under timeout, and a `dead` row while the effect actually ran misleads operators. NOTE: the "double-charge" framing is **refuted** — SPEC §9.6 is at-least-once + `ctx.idempotencyKey` (stable == jobId) is the exactly-once mechanism; a transactional idempotency key defeats the overlap, and the probe app did not use it. The residual papercut is the self-overlap + misleading status, not a framework double-charge.
  - Repro evidence: server log shows the same `jobId` with two overlapping START/END spans; proof count 2; status `dead`.
  - Acceptance: either hold the concurrency slot until the abandoned body settles (no self-overlap), or document that `concurrency` is a capacity bound (not mutual exclusion) and that `timeoutMs` does not bound a non-cancellable body; reflect committed effects in the job's final status.

- [ ] **B4 — `createDurableTaskSqlExecutor` (the `{text,values}` adapter the public `createDurableTaskStatus` needs) is not exported, forcing a ~5-line hand-rolled executor.** (low, framework; found by `dt-runner`; "unusable" framing refuted, residual confirmed)
  - Observed behavior: `createDurableTaskStatus(executor)` requires a `{ execute({text,values})→{rows} }` executor; the obvious call-site `appDb.$client.query(stmt.text, [...stmt.values])` trips KV422 (unknown-provenance SQL). The internal bridge `createDurableTaskSqlExecutor` (`packages/server/src/task-queue.ts:99`) is not re-exported from `@kovojs/server` (`index.ts:156-167` exports `createDurableTaskStatus` + types only).
  - Why it matters: the blessed observability surface needs an author-written adapter even though the framework already has one. NOTE: the "cannot be wired through any gate-clean path" framing is **refuted** — the verifier built green by authoring the executor in the module where the driver client is `new`-constructed (the SPEC §10.2 raw-driver-handle exemption, `static.ts:809-822`), reusing the managed connection. The residual is purely the unexported adapter.
  - Repro evidence: KV422 at the property-access call-site; green `build:prod` (exit 0, 0 KV422) when the executor is authored at the `new`-driver-handle module.
  - Acceptance: re-export `createDurableTaskSqlExecutor` (or accept a Drizzle client directly), so `createDurableTaskStatus` is wirable without a hand-rolled `{text,values}` adapter.

- [ ] **B5 — KV422 tagged-template recognition is alias-blind: an aliased Kovo `sql`/`staticSql` tag fails the build as unknown-provenance, blocking safe parameterized SQL.** (med, framework; found via `dt-runner` observability authoring, verified independently)
  - Observed behavior: `import { sql as sqlTag } from '@kovojs/drizzle'; appDb.execute(sqlTag\`… where k = ${v}\`)`→ KV422 build failure; the identical statement with the unaliased`import { sql }` builds green.
  - Root cause: `packages/drizzle/src/static.ts:1455-1463` — the `TaggedTemplateExpression` branch treats a tag as safe only when `tag.getText() === 'sql' | 'staticSql'` (literal callee text), so an alias defeats recognition. This is the false-positive twin of the (fixed) `bugz.md` H4 alias false-negative; it over-blocks safe code rather than under-blocking unsafe code.
  - Why it matters: a normal TS rename/alias breaks an otherwise-safe parameterized query with a security-flavored error and no remedy except dropping the alias — the alias-hardening applied to `kovo()`/`route()`/`domain()` is missing here.
  - Repro evidence: aliased Kovo `sql` template → KV422; unaliased → green.
  - Acceptance: KV422's tagged-template provenance follows import bindings (like the alias-hardened `kovo()`/`route()` recognizers), so an aliased Kovo `sql`/`staticSql` tag is recognized as safe.

### C. Static-analysis / audit representation

- [ ] **C1 — `kovo explain` / `graph.json` have no durable-task surface: task→mutation→table composition edges and task-driven writes are unrepresentable, so KV407 cannot reason about task invalidation and scheduling-mutation `touches` are unverifiable.** (med, dev-tooling; found by `dt-analyzer`, verified independently)
  - Observed behavior: `graph.json` has no `tasks` key; no `kovo explain` mode lists tasks, their `ctx.runMutation`/`ctx.runQuery` edges, or their effect on the invalidation graph.
  - Root cause: tasks are absent from the build model (`packages/compiler/src/scan/parse.ts:134-141` — see `claude-bugz-22.md` B1); the verification/explain surface (SPEC §11.4) has no task node type. (The _security_ half — a task `appDb` write bypassing the audit — is filed as B1 in the bugz ledger; this item is the audit-visibility/observability gap, analogous to `bugz-9` B2 webhook `recordChange` omitted from `kovo explain`.)
  - Why it matters: an author/reviewer cannot inspect what a task reads/writes or which queries it invalidates; KV407 cannot prove a scheduling mutation's hand-declared `touches` are complete.
  - Repro evidence: `kovo explain --unscoped/--endpoints/--access` show no task rows; `graph.json` lacks `tasks`.
  - Acceptance: tasks (and their `runMutation`/`runQuery` composition + cron schedule) appear in `graph.json` and `kovo explain`, feeding KV407.

### D. Atomicity contract honesty (type-level)

- [ ] **D1 — SPEC §10.3 "handler receives Tx-typed db; escaping the tx is a type error" is not implemented — `request.db` carries no Tx brand.** (med, framework; found by `dt-atomicity`, verified independently)
  - Observed behavior: capturing `request.db` to module scope and calling it after the handler returns, and calling `request.db.transaction()`, both pass `tsc` and `build:prod`; the runtime then fails with an opaque "Failed query". The _runtime_ atomicity (bugz-21 B3) is sound (write-then-throw rolls back; nested `request.db.transaction` is a savepoint; task `ctx` exposes no raw db — all verified), but the documented compile-time guardrail is absent.
  - Root cause: `request.db` is a plain Drizzle handle with no branded Tx type, so SPEC §10.3:1211's "escaping the tx is a type error" promise is unmet (no `unique symbol`/branded Tx surface gating capture/escape).
  - Why it matters: SPEC advertises an author-time guardrail (per CLAUDE.md's type-level-security-ergonomics bias) that does not exist; the failure mode is a runtime error instead of a compile error.
  - Repro evidence: module-scope capture of `request.db` + `request.db.transaction()` both type-check and build; runtime "Failed query".
  - Acceptance: `request.db` is a branded Tx type whose escape/capture is a type error (defense-in-depth; runtime fail-closed still owns enforcement), per SPEC §10.3.

- [ ] **D2 — The durable-tasks plan's "external I/O is a type/gate error outside `task.run`" is unimplemented — a mutation handler `fetch()` builds clean.** (low, docs; found by `dt-atomicity`, verified independently)
  - Observed behavior: a `fetch()` (or other external I/O) inside a `mutation({ handler })` builds green and runs, governed only by the uniform outbound-egress floor — there is no mutation-specific type/gate error.
  - Root cause: `plans/durable-tasks.md` §"Security/soundness invariants" claims a mutation handler's Tx-typed db makes external work "a type or KV-gate error"; no such gate exists, and SPEC §9.6/§10.3 do not actually mandate it.
  - Why it matters: a plan/docs overclaim — readers may believe external I/O in a mutation is prevented when only the egress floor applies.
  - Repro evidence: mutation handler with `fetch()` → green build + runs.
  - Acceptance: either implement the gate (a KV diagnostic steering external I/O into `task.run`) or correct the plan/SPEC to describe egress-floor-only governance.

### E. Runtime robustness

- [ ] **E1 — A single task-runtime `start()` failure permanently bricks ALL requests: `ensureStarted` runs on the universal request path and caches the rejected start promise with no retry.** (med, framework; found by `dt-failclosed`, verified independently; shared amplifier behind bugz B3)
  - Observed behavior: with one task registered, a `start()` failure 500s **every** request including the dependency-free `/api/health` probe, permanently (until process restart) — verified live via the SQLite-incompatibility trigger; by inspection it also bites a transient Postgres cold-start blip on the supported path.
  - Root cause: `createRequestHandler`/`app.ts:332-335` awaits `taskRuntime.ensureStarted(request)` before dispatch for every request; `task-runtime.ts:73-77` does `this.startPromise ??= this.start(request); await this.startPromise` with no try/catch that resets `startPromise` on failure, and `this.runner` is set only after the await — so a rejected `start()` is cached and re-thrown forever. `start()` runs `ensureDurableTaskSchema` (a live DB `CREATE TABLE`) on first request, so a transient DB blip becomes a permanent total outage.
  - Why it matters: (1) blast radius — task-subsystem health is coupled to unrelated endpoints, so a liveness probe can't distinguish "app down" from "task DB hiccup"; (2) no retry — a transient failure is permanent. This is the amplifier that turns the bugz B3 cron typo into a whole-app outage. Fail-closed is the right _direction_ (hence papercut, not bugz), but the blast radius + no-retry are robustness defects.
  - Repro evidence: prod artifact with a registered task → `/api/health` 500 on every request; `task-runtime.ts:73-77` cached-rejection path by inspection.
  - Acceptance: task-runtime start failures don't 500 unrelated routes (decouple from the universal dispatch path, or degrade tasks-only), and a transient `start()` failure is retried (reset `startPromise` on rejection) rather than cached permanently.

## Refuted / Not Carried Forward

Encouraging refutations — the durable-task runtime is largely sound:

- **SQLite + `node()` + `task()` does NOT build green (DT-FC-1 refuted, first-hand).** It **fails closed with KV446** — an actionable message naming the task(s) and the SQLite/Postgres mismatch — caught by BOTH `build:prod` and `check`, emitting no bootable `dist/server/` artifact (verified twice, incl. a clean `rm -rf dist .kovo`). The `dt-failclosed` agent's "green build" report was a stale-artifact artifact; the §9.6 fail-closed gate works for the SQLite dialect. (Residual robustness item E1 stands.)
- `ctx.idempotencyKey` is stable (== jobId) across retries; dead-letter rows + their errors are observable; `createApp({ onError })` reports runner/task failures; the runner does NOT swallow errors (logs `[kovo] durable task failed {…}` to stderr); priority lanes and per-task concurrency caps work.
- A valid `'* * * * *'` cron fires immediately and exactly-once per occurrence (DB-unique occurrence dedup), recurs each minute, delivers `cronArgs`, and is multi-node safe; `catchUp:'backfill'` is correctly bounded to 16.
- `request.schedule({ afterMs, at })` correctly throws `TypeError` when both are given (`task-runtime.ts:240-242`).
- Mutation atomicity (bugz-21 B3) holds in the shipped artifact: a default handler that writes then throws (or hits a constraint) rolls back fully; `request.schedule` writes the job in the mutation tx so rollback un-enqueues it; a nested `request.db.transaction()` is a savepoint; task `ctx` exposes no raw db.
- `task()` rejects unknown/misspelled definition fields (fail-closed at import, `task.ts:167-184`); `ctx.fetch` in a task is still subject to the outbound-egress floor; `runMutation`/`runQuery` to an unregistered mutation/query throws.
- **ENV artifact (NOT a finding):** the throwaway link-local dogfood apps later developed a KV446 _false-trip_ (`better-sqlite3` string leaking into `serverHandlerBuild.source`) from multi-app pnpm store churn — the clean single-app smoke and the workflow builds were green, the neutral bundle has zero `better-sqlite3`, and `base` can no longer resolve `better-auth`, confirming local env degradation rather than a product defect.

## Latest Verification

- Baseline (clean default PGlite scaffold): `check` (19.2s) / `test` (6) / `build:prod` all green; durable-task happy path verified first-hand on the prod artifact (schedule→runs once; throw→rollback; flaky→retry-to-success; runner logs failures).
- First-hand source confirmation of every root cause: `task-runtime.ts:73-159,239-246`, `task-runner.ts:102-263`, `task.ts:84,167-206`, `parse.ts:134-141`, `build.ts:430-478,523`, `static.ts:809-822,1455-1463`.
- First-hand refutation of DT-FC-1: SQLite+task `build:prod` and `check` both fail KV446 (exit 1), no artifact emitted.
- Monorepo health: `pnpm install` at root (transitive deps resolve to the monorepo store); `task-runner.test.ts` + `task-cron.test.ts` = 16/16 pass. `git status` shows only the new `plans/claude-*.md` ledgers.
- Throwaway dogfood apps live under `/Users/mini/kovo-dogfood-20260630/` (base + dt-\* tracks) — safe to delete; do NOT re-run `pnpm install` in them without isolation (it repoints the monorepo store).
