# Round-5 Papercuts 24

Created 2026-07-01. Source of truth remains `SPEC.md`. Papercuts from the round-5 dogfood AFTER
`plans/fundamental-fixes-followup.md` was implemented. Confirmed security/soundness defects are in
`plans/claude-bugz-26.md` (DDL parser bypass, KV426 object-literal member, KV435 arrow-closure + mutation-handler).

**Meta-theme:** the followup's enumerated guards largely HOLD (see Refuted). The headline papercut is that the
census's own completeness gate does not enforce a required-set for the two hand-enumerated kinds — the root
reason the round-5 bugz hid from the census that was supposed to guarantee coverage.

## Scope

Eight fresh SQLite `create-kovo` starters on the followup-implemented framework, prod-artifact tested. Root
causes confirmed first-hand in source; symptoms reproduced by independent verifiers.

## Issues

- [ ] **P1 — The census `--require-complete` gate does not enforce a required-set for `write-capable-handle` / `output-wire-sink`, so it reports `complete: true` while whole write/wire families are unenumerated — the meta-root that let the round-5 fail-opens hide.** (med, dev-tooling; found by `census-completeness`, verified; new)
  - Observed behavior: `node scripts/fundamental-fixes-census-gate.mjs --require-complete` prints `passed (138 rows; complete: true)`, yet `grep -i 'task\|schedule\|durable' scripts/fundamental-fixes-census.manifest.json` returns zero durable-task rows — the entire SPEC §9.6 durable-task write surface (`task`, `createDurableTaskSqlExecutor`, `request.schedule`, `TaskRunContext.runMutation/.schedule/.fetch`, all public in `@kovojs/server`) has NO census rows. The census also has no row for the mutation-handler wire channel (`claude-bugz-26` B4) or the DDL statement class (`claude-bugz-26` B1).
  - Root cause: `scripts/fundamental-fixes-census-gate.mjs` enforces a required-SET only for `resolver-expression-kind` (`REQUIRED_RESOLVER_EXPRESSION_KINDS`) and `dialect-sink` (`REQUIRED_DIALECT_MATRIX_*`). For `write-capable-handle`/`output-wire-sink` the denominator is just the hand-authored plan rows (`PLAN_CENSUS_SECTIONS`), and `requireComplete` (`:158`) only forces LISTED rows to `closed` — an _unlisted_ handle/channel is invisible. So the census gate certifies "complete" without proving the list is complete — the same enumerate-and-allow failure the census was built to eliminate, now in the completeness proof itself.
  - Why it matters: the followup's M4/M5 soundness argument ("completeness by census; no deferral") rests on the census enumerating every sink. Because the gate cannot detect a _missing_ row, the census provides false assurance — and the round-5 bugz (DDL statement type, mutation-handler wire channel, durable-task family) are exactly the un-enumerated cells it could not catch. (Not escalated: the specific durable-task queue-persistence path uses framework-constant, fully-parameterized SQL — `task-queue.ts:238-355` — so it is not app-injectable, and the task-body write channel routes through the audited `ctx.runMutation`; the defect is the _unsound completeness gate_, not that particular path.)
  - Repro evidence: `--require-complete` → `complete: true` with 0 durable-task rows; the gate has `REQUIRED_*` sets only for resolver + dialect kinds.
  - Acceptance: the census gate derives the `write-capable-handle` and `output-wire-sink` denominators from framework source (discover every managed-handle construction / every response-emitting channel) and fails when a discovered sink has no row — so "complete: true" actually proves completeness. Add the durable-task family, the DDL statement class, and the mutation-handler wire channel as rows.

- [ ] **P2 — `createDurableTaskStatus` exposes `lastError` un-redacted while `args` is redacted by default, so a secret in a task's thrown error reaches the status surface.** (low, framework; found by `uncovered-surfaces-deep`, verified independently; new)
  - Observed behavior: the durable-task observability status redacts `args` by default but returns `lastError` verbatim; a task that throws an error embedding a secret (a token, a connection string) exposes it through `createDurableTaskStatus`.
  - Root cause: the status projection (`packages/server/src/task-observability.ts`) redacts the args field but passes `lastError` through unredacted — asymmetric handling of two fields that can both carry sensitive data.
  - Why it matters: an operator-facing status surface can leak a secret embedded in an error message; low because it requires a task to throw a secret-bearing error and an exposed status endpoint.
  - Acceptance: `lastError` is redacted/scrubbed on the same footing as `args` (or documented as sensitive), so `createDurableTaskStatus` does not surface raw error contents.

- [ ] **P3 — KV310 green-certifies a hand-written optimistic transform that is absent from the shipped prod runtime for fragment-target regions (never applied).** (low, framework; found by `wide-regression`, verified independently; residual of `papercuts-super-5` C1)
  - Observed behavior: a hand-written optimistic transform is recorded in `graph.json` and passes KV310, but the prod client runtime (inline loader) for a server-fragment region ships no optimism, so the transform never runs — a green build over dead, certified author code.
  - Root cause: fragment-target regions use the inline loader (no client optimism); KV310 certifies coverage from the graph without proving the transform is delivered to the shipped runtime for that app shape (SPEC §8:442 makes the fragment path "1 RTT, no optimistic update" by design — so the runtime no-op is intended; the residual is the false-green certification, exactly `papercuts-super-5` C1's scope).
  - Why it matters: an author sees a green KV310 and believes their optimistic transform is live; it is silently dead for the fragment path. Low (by-design no-op; the gap is the honesty of the certification).
  - Acceptance: KV310 warns (not certifies-clean) when a hand-written transform's only consumers are fragment-target regions that ship no client optimism — extending the `papercuts-super-5` C1 fix from the no-consumer case to the fragment-consumer case.

## Refuted / Not Carried Forward

The followup's enumerated guards HOLD — verified this round:

- **Read handles (H):** `readonlyAppDb.all(DELETE)/.get/.transaction/.with/$client` fail closed (H holds — the DDL bypass in `claude-bugz-26` B1 is a distinct statement-TYPE gap, not these method escapes); method-extraction (`const {all}=readonlyAppDb`), the relational query builder (`.query.contacts.findMany`), and passing the handle to a write-calling helper all fail closed; `CREATE TRIGGER`/`REINDEX` on the read handle caught.
- **Statement parser (H/I):** parse-failure fails closed; row-level under-report via CTE / `INSERT…SELECT` / `UPDATE…FROM` / `DELETE…USING` is caught (DML tables correctly extracted); a forgeable/undefined-text carrier does not skip the table check.
- **Resolver (B):** identifier alias (`const t = trustedHtml`), `as`-cast, and comma-operator callees are all caught (only the object-literal member `claude-bugz-26` B2 escapes).
- **Value-flow (C2):** KV426 trusted-HTML/trusted-URL taint is fail-closed for the tested forms; the component-layer shape-based KV435 is genuine; reading a full row / `SELECT *` over a secret table is caught (only the arrow-closure `claude-bugz-26` B3 escapes).
- **Headers/wire:** `/_q` query wire is served `cache-control: private, no-store` + `Vary: Cookie` (no shared-cache leak, bugz-17 B1 holds); an unauthenticated `/_q` read → 303 to `/login` (guard-at-read holds, no IDOR); the 404/500 shells do not reflect the request path (no XSS); redirect `Location` / Set-Cookie / CRLF are sanitized; the raw-endpoint cookie security floor holds; Host/X-Forwarded-Host smuggling into redirects caught; capability-URL tamper / cross-scope / expiry-oracle rejected before read.
- **Wide regressions — none:** auth login/session/sign-out (bugz-15), enhanced add-contact success renders the new row (bugz-14/16/17), no-JS 422 FormError, CSRF on mutations, per-principal cache floor on guarded responses, error-shell escaping — all HOLD (no fix-churn regression).
- **Egress/tasks:** `ctx.fetch` task egress is governed by the default outbound-egress deny floor (cloud metadata blocked) — not this census, intended; the durable-task `_kovo_jobs` SQL is framework-constant/parameterized (not app-injectable); a task cannot write outside `ctx.runMutation` (the module-`appDb` write is closed).
- **census-completeness durable-task-path exploitability:** refuted — the specific path is framework-safe; only the _completeness-gate soundness_ (P1) is the defect.
- **header-cookie Set-Cookie attribute injection:** refuted — the raw-endpoint cookie floor neutralizes it.

## Latest Verification

- `claude-bugz-26` B1 self-verified (both enforcement sites); P1 verified by `--require-complete` reporting `complete: true` with 0 durable-task rows; other items confirmed first-hand in source.
- Monorepo repaired (`pnpm install` at root); `git status` shows only the new `plans/claude-*.md` ledgers; stray servers killed. Throwaway apps under `/Users/mini/kovo-dogfood-round5/` — safe to delete (do not re-run `pnpm install` in them without isolation).
