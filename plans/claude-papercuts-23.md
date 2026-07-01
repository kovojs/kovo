# Round-4 Papercuts 23

Created 2026-07-01. Source of truth remains `SPEC.md`. Papercuts from the round-4 dogfood AFTER the
`plans/fundamental-fixes.md` program was implemented. Confirmed security/soundness defects are in
`plans/claude-bugz-25.md` (dialect-blind denylists, KV426 tracer gaps, resolver-edge gaps, the B4 island
residuals, KV435 cross-select laundering).

**Meta-theme:** the program's fixes largely HOLD (see Refuted — a long list of prior items verified fixed).
The residual papercuts are (a) the _friction_ flip-side of the SQLite dialect-blindness (the fail-closed
fires but the escape hatch is Postgres-only), and two low-severity API/audit gaps.

## Scope

Eight fresh SQLite `create-kovo` starters linked to the local monorepo, on the plan-implemented framework,
prod-artifact tested. Root causes confirmed first-hand in source; symptoms reproduced by independent verifiers.

## Issues

- [ ] **A1 — On SQLite, the raw-SQL `KV406` fail-closed cannot be discharged: `db.run`/`db.all`/`db.get` KV406 is not satisfiable by `tables:`/`touches:`/`reads:`/`trustedSql`, so a legitimate raw-SQL SQLite author is stuck.** (med, framework; found by `fail-closed-friction-deep`, verified independently; broadens `claude-papercuts-21` B1, still open)
  - Observed behavior: a SQLite loader/mutation using raw `db.all(sql`…`)`/`db.get(sql`…`)` fires KV406, but the documented discharge mechanisms (declare `tables:`/`touches:`/`reads:`, or wrap in `trustedSql`) do not clear it on the SQLite drizzle methods (they are recognized only for the Postgres `.execute`/`.exec` shapes), and the diagnostic mislabels a raw READ as a "write site".
  - Root cause: the same Postgres-shaped verb/method recognition as `claude-bugz-25` A/B — the static raw-SQL classifier and the escape-hatch discharge both key on `.execute`/`.exec` and miss `better-sqlite3`'s `.run/.get/.all/.values`. So the fail-closed direction over-fires (friction) while the runtime cross-check under-fires (the bug in `claude-bugz-25` B2) — the same dialect blind spot cutting both ways.
  - Why it matters: the fail-closed default (Workstream A) is only humane if the escape hatch works; on the default SQLite dialect the author gets a KV406 they cannot legitimately discharge, with a misleading message.
  - Repro evidence: a SQLite raw `db.all(sql`SELECT …`)` read → KV406 "write site" that no `reads:`/`trustedSql` discharges.
  - Acceptance: the raw-SQL classifier + escape-hatch discharge recognize the SQLite drizzle sinks, so a declared/attested SQLite raw statement builds; and the diagnostic distinguishes read from write. (Fixing `claude-bugz-25` A/B and this together is the coherent dialect-parity slice.)

- [ ] **A2 — `trustedUrl` is unusable from typed TSX (the `AttributeValue` type omits `TrustedUrl`) and has no provenance gate.** (low, framework; found by `trusted-html-deep`, verified independently; new)
  - Observed behavior: an author cannot pass `trustedUrl(...)` where a URL attribute is expected (type error), and there is no KV426-equivalent provenance gate for `trustedUrl` (unlike `trustedHtml`). The escape hatch is simultaneously unusable and ungated.
  - Root cause: the JSX `AttributeValue` union omits the `TrustedUrl` brand, and `trusted-html-provenance` gates only `trustedHtml`, not `trustedUrl`.
  - Why it matters: the documented §4.8 URL escape hatch can't be used through the normal typed path, and if it is reached (e.g. via a raw sink) it has no request-provenance check. Low because the type-omission makes the unsafe path hard to construct today — but it should be gated before it becomes usable.
  - Acceptance: `AttributeValue` accepts `TrustedUrl` for URL attributes, and `trustedUrl` gets the same request/query-provenance gate as `trustedHtml`.

- [ ] **A3 — The mutation write-sink audit under-reports a computed `request['db']` handle: the direct write vanishes from `kovo explain` while still executing.** (low, framework; found by `residual-recognizers-deep`, verified independently; new)
  - Observed behavior: a mutation that writes through `request['db']` (element access) instead of `request.db` executes the write but the write-sink fact is dropped, so `kovo explain` under-reports what the mutation touches.
  - Root cause: the same missing element-access resolution branch as `claude-bugz-25` B6, applied to the write-sink/explain extraction (property-access only).
  - Why it matters: an audit-completeness gap (a reviewer using `kovo explain` misses a real write). Low because it does not itself bypass a write GATE (the write still runs through the audited mutation channel) — it is an explain/visibility gap, distinct from the security fail-opens.
  - Acceptance: element-access `request['db']` (literal key) is resolved for the write-sink audit, so `kovo explain` reports the write; a non-literal computed key fails closed.

## Refuted / Not Carried Forward

The program's fixes largely HOLD — verified this round:

- **A (fail-closed):** a closure-scoped secret read → KV406 (`claude-bugz-24` B1 fix holds); task/webhook/endpoint direct DB writes fail closed (C1 holds); named-helper/typed-receiver read extraction works.
- **B (identity resolver):** alias, namespace-property, and assignment-chain evasion of `trustedHtml`/`sql`/`Reader` are all caught; `trustedSql` local-shadow and aliased Kovo `sql` tag are caught; `escapeText`/`renderMutationCsrfField`/`looksLikeDbTargetIdentity` and the remaining literal recognizers were reviewed and do not decide a defeatable security fact. (The resolver's _computed-access_ and _cross-file re-export_ edges are the exceptions — `claude-bugz-25` B6/B7.)
- **KV426:** the `@kojovs/server` re-export bypass (`claude-bugz-24` B2) is FIXED; the `@internal` raw-HTML sink imported into a plain `.ts` helper (`bugz-21` B1) is caught; brand-forge from wire JSON (`bugz.md` H6) is blocked. (The taint-_tracer_ axes — param name, non-destructured param, operator composition — are the exceptions, `claude-bugz-25` B3/B4/B5.)
- **Capability:** `readonlyAppDb.insert/update/delete/run` are blocked; the `$client` raw-driver escape is caught; `query.elevated()` is removed with no replacement escape; a loader/mutation write via the readonly handle is caught (for the denylisted verbs). (The non-denylisted `.all/.get/.transaction` verbs are the exception — `claude-bugz-25` B1.) The `_kovo/app-runtime-db` non-type-import ban IS enforced (the "only sound-subset, not build" claim was refuted).
- **Raw SQL (Postgres):** `parseSqlWriteTables` does not under-report a Postgres write it can parse; the runtime table allowlist works on the pg path.
- **Islands:** a direct `{state.label}` read is reactive; KV417 deploy-skew retention on the first island holds.
- **E metamorphic harness:** the KV437/KV438 required-code omission was refuted as expected (they are covered elsewhere).

## Latest Verification

- `claude-bugz-25` B1/B6 self-verified (see that ledger); this round's papercuts confirmed first-hand in source (the shared Postgres-shaped recognition in `sql-safe-handle.ts`/`managed-db.ts`; the element-access gap in `framework-identity.ts:262-294`).
- Monorepo repaired (`pnpm install` at root); `git status` shows only the new `plans/claude-*.md` ledgers; stray servers killed. Throwaway apps under `/Users/mini/kovo-dogfood-round4/` — safe to delete (do not re-run `pnpm install` in them without isolation).
