# Fundamental Fixes Followup 12 — check the thing that crosses the boundary, not a proxy of it

Created 2026-07-06. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the engine-choke /
retain-and-prove / capabilities-not-values line (`fundamental-fixes-followup-{6..11}.md` + `postgres-v1-devex.md`).
Responds to the Round-15 findings (`plans/claude-bugz-36.md` B1–B4, `plans/claude-papercuts-34.md` P1–P2). Line
numbers cite `origin/main` (`fd639c8dd`).

## 1. The one foundational issue (round-15 restatement)

followup-10/11 fixed the three axes round-14 exposed, and Round 15 confirms the CORES hold (the direct statement path,
the object-reachability audit, and the runtime-login identity check are all robust). Each remaining fail-open is an
EDGE, and all four edges are ONE deeper error: **the framework checks a PROXY it chose from its own model, not the
actual entity that crosses the security boundary.**

| Finding | The boundary                 | The proxy checked                                   | The actual boundary-crossing entity                                                                      |
| ------- | ---------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| B1      | app SQL → driver             | the statement `.text` string                        | the query VALUE (a node-pg `Submittable` routes around `.text` via `submit()`)                           |
| B2      | app write → side-effect code | triggers on reachable TABLES                        | any writable RELATION incl. VIEWS (INSTEAD OF triggers)                                                  |
| B3      | runtime → engine identity    | the LOGIN role's `rolbypassrls`                     | every ASSUMABLE role (an adopted `BYPASSRLS` reader the login `SET ROLE`s to)                            |
| B4      | secret → egress              | the app EXPORT surface (removed `appRuntimeAuthDb`) | the value the internal consumer MATERIALIZES (the adapter reads secrets as plain strings via `systemDb`) |

**The unifying principle this plan enforces: reason about the entity that actually crosses the boundary —
reconstructed or enumerated FROM the boundary — never a model-chosen projection, subset, or representative of it.** A
`.text` projection, a table-subset, a login-role, an export-surface are all convenient proxies; the fox walks through
the part of the door the proxy didn't describe. This is C7 ("necessary-but-insufficient condition") sharpened: the
insufficiency is always a PROXY standing in for the real boundary-crossing thing.

## 2. The two architectural moves

**Move 1 — the framework OWNS the value that reaches a sink (fixes B1, B4). Reconstruct, don't inspect.** For any value
that crosses into a sink (the DB driver, a secret egress), the framework CONSTRUCTS the exact carrier from validated
primitives and passes ONLY that — it never inspects a projection of an app-provided object and forwards the object.
A reconstructed plain `{ text, values }` cannot carry a `submit()`; a boxed secret cannot be coerced to a plain string.

**Move 2 — the audit/check enumerates the COMPLETE boundary-crossing set from the engine backward (fixes B2, B3).**
Retain-and-prove on two new axes: every writable RELATION that can carry side-effect code (tables AND views AND any
relkind an app role can write), and every ASSUMABLE role the runtime can `SET ROLE` to. Enumerate from the engine's
actual graph (`pg_class` write-privilege, `pg_has_role` membership), not a known subset; unmodeled members fail closed.

## 3. Meta-invariant (extends followup-10 C8)

- **C9 — Check the entity that crosses the security boundary, reconstructed or enumerated FROM the boundary itself,
  never a model-chosen proxy of it.** Two corollaries: (a) VALUE CARRIERS — the framework owns the value that reaches a
  sink, constructing the exact carrier from validated primitives and passing only that; it never forwards an
  app-provided object after validating a projection of it. (b) REACHABLE SETS — the framework enumerates the complete
  set that reaches a boundary from the engine backward (every writable relation, every assumable identity), never a
  known subset; unmodeled members fail closed.

## 4. Decisions / work items

### DEC-A — The framework owns the value that reaches the DB driver (fixes B1; subsumes followup-11 A2)

- [ ] **A1 — Reconstruct at the WRAPPED DRIVER CLIENT (resolves O2). The framework-owned client that Kovo already passes to `drizzle({ client })` is the sole-door chokepoint: its `query()` receives whatever Drizzle (or app code) hands it, extracts `{ text, values }`, validates (allowlist), RECONSTRUCTS a fresh plain carrier, and calls the REAL driver's PLAIN PARAMETERIZED entry point with ONLY that — then returns raw rows for Drizzle to map.** Drizzle keeps its query-building and typed-result mapping intact; only the wire submission is reconstructed. A node-pg `Submittable` (`submit()`), a mutating `.text`, a thenable/thunk, or any non-plain shape loses its bypass because the wrapped client never routes the app object to the driver's polymorphic dispatch (subsumes followup-11 A2 and O6 by construction — the fix is driver-agnostic).
  - Acceptance: a `Submittable`/`submit()`-bearing value and a value whose `.text` mutates after validation, on EVERY managed path (query/mutation/task/webhook/`rawRead`/`sql` escape/crossOwnerRead), cannot cause any statement other than the reconstructed validated one to reach the driver. A lint proves (i) every Drizzle execution path (query, transaction, prepared, batch) routes through the wrapped client and (ii) the wrapped client calls only the driver's plain parameterized entry point; a per-DRIVER regression test (node-pg config / postgres.js parameterized call / PGlite / Neon) that a `submit`/thenable/thunk input cannot execute out-of-band SQL.
- [ ] **A2 — App-provided STREAMING is rejected for v1 (any `submit`-bearing value is refused). A framework-owned SQL-level cursor (`DECLARE`/`FETCH` with reconstructed carriers around the app's validated `SELECT`) is the POST-V1 path for large owner-scoped reads — never a blessed driver-`Submittable`.** (resolves O1; deferred per the v1 decision)
  - Acceptance: an app cursor/stream value is rejected on every managed path; SPEC notes streaming is a post-v1 framework-owned SQL-cursor feature.

### DEC-B — The attached-code audit enumerates every writable relation (fixes B2)

- [ ] **B1 — Extend the no-unexpected-attached-code audit (followup-10 DEC-D) to every app-role-WRITABLE relation of any relkind — tables, partitions, AND VIEWS — and every trigger class: DML triggers (tables), INSTEAD OF triggers (views), and CONSTRAINT triggers. An app-writable relation carrying a non-vetted (definer / non-`security_invoker`) trigger/rule/constraint/default/index function is REFUSED; unmodeled trigger classes fail closed.**
  - Acceptance: a definer INSTEAD OF trigger on a writable view, and a definer constraint trigger, make `kovo db check` REFUSE; a framework-owned FK/`updated_at` trigger passes. Add the view-trigger + constraint-trigger classes to the DEC-F fuzzer mechanism axis.

### DEC-C — The identity check validates every assumable role (fixes B3)

- [ ] **C1 — The least-privilege posture check enumerates EVERY role the runtime login can `SET ROLE` to (via `pg_has_role(login, role, 'MEMBER')` over `pg_roles`, transitively — covers `NOINHERIT` chains) and asserts each is `NOSUPERUSER` + `NOBYPASSRLS`. Adopted roles (`KOVO_DB_READER_ROLE`/`WRITER_ROLE`/`ADMIN_ROLE`/`SYSTEM_ROLE`) are validated for these ATTRIBUTES, not just existence (`postgres-runtime.ts:2395-2407`). Provision, `kovo db check`, and boot all run it.** ALSO assert the login role holds NO `ADMIN OPTION` on any role (resolves O3's only runtime-reachable variant: otherwise the login could `GRANT` itself a `BYPASSRLS` role and `SET ROLE` to it within a request). Out-of-band `GRANT` to the login after provision is unsupported (same deploy-boundary contract as followup-9 O3).
  - Acceptance: an adopted `BYPASSRLS`/`SUPERUSER` reader/writer, or a login with `ADMIN OPTION` on any role, makes provision/check/boot REFUSE with the offending role named; a correctly-attributed adopted role passes; a test covers the assumable-role attribute check + the `ADMIN OPTION` check on the adopted-role path.

### DEC-D — The framework owns the value at every capability egress (fixes B4; + papercut P2)

- [ ] **D1 — TRUSTED-PLAINTEXT ZONE + prove-non-egress (resolves O4). Better Auth is third-party and its adapter contract returns plain strings, so the value it needs cannot be a box; instead: (a) box auth secret columns EVERYWHERE EXCEPT the adapter's own read path, so the rest of the framework/app can never materialize a plain auth secret; (b) make the auth adapter a minimal, TCB-enrolled module (`security/TCB.md`); (c) add a lint/test proving the adapter's plaintext secrets reach ONLY their intended sinks (the session cookie and the DB) and never a log, error, or wire response.** The adapter is an audited trusted zone, not a place we pretend to box a value a dependency needs plain.
  - Acceptance: outside the adapter, no code path yields a plain-string auth secret (a boxed read everywhere else); the adapter is enrolled in the TCB; a lint/test asserts the adapter's plaintext values do not reach a log/error/wire. (Post-v1 north star: DB-side comparison — verify password/token in SQL so only a boolean/opaque session id crosses to JS and the secret never leaves the engine — deferred as too large a Better-Auth divergence for v1.)
- [ ] **D2 — Engine companion (papercut P2): column-REVOKE the secret columns from `kovo_writer` (with a narrow write grant), so a secret column is engine-unreadable by the writer role, not only the reader.**
  - Acceptance: a `kovo_writer` `SELECT` of a secret column is engine-denied or boxed; the writer's legitimate writes still work.

### DEC-E — SPEC + the meta-principle

- [ ] **E1 — SPEC §10.3 states C9 and its two corollaries; document that the DB driver receives only a framework-reconstructed carrier, the attached-code + identity audits enumerate the complete writable-relation / assumable-role sets, and secret values cross every boundary boxed. Reclassify the relevant codes in `security-markers.ts` as `runtime-choke`/`by-construction`.**
  - Acceptance: SPEC names the reconstructed-carrier + complete-enumeration + boxed-egress boundaries; the registry has no authorization/confidentiality code resting on a proxy check.

### DEC-F — C9 completeness: the sink inventory (promoted from O5; HIGHEST priority)

- [ ] **F1 — Inventory EVERY framework sink where an app value crosses to an external boundary, and for each, verify (a) a reconstruct/box mechanism EXISTS and (b) it is the SOLE door.** The sink set is finite and enumerable: DB driver (DEC-A), HTTP response body, response headers, redirect URL, `Set-Cookie`, blob/file write, durable-task payload, webhook payload, HTML/render output, log/error output, outbound egress request. For each, a "reconstruct/own" mechanism must be the only path (render = escape-by-default; headers = the header-bag type; secrets = the box; DB = the reconstructed carrier).
  - Acceptance: a documented sink inventory in SPEC; each sink names its reconstruct/box mechanism and the lint/test proving it is the sole door.
- [ ] **F2 — Per-sink HOSTILE-VALUE test: pass an app value with EXTRA SURFACE — a getter-backed field, a `toString`/`toJSON` side effect, a `Submittable`-analog, a `Proxy`, a thenable — and assert the framework reconstructs/neutralizes it (the sink sees only the validated projection, never the object's extra surface).** This is the C9-completeness harness, the sink-axis analog of the DEC-F grant-shape fuzzer that stabilized the object axis.
  - Acceptance: every sink has a hostile-value test; re-introducing a B1-style "forward the object" at any sink turns its test RED. C9 becomes a checked invariant, not a principle.

## 5. Resolved design decisions (was "open issues"; decided 2026-07-06)

All six are decided; each folds into a DEC above. Recorded here with rationale.

- **O1 (streaming) → DEFERRED post-v1 (DEC-A2).** App-provided streaming (`Submittable` cursors) is rejected for v1; a framework-owned SQL-level `DECLARE`/`FETCH` cursor is the post-v1 path — never a blessed driver-`Submittable`. Kovo's owner-scoped loader model does not need streaming on the v1 hot path.
- **O2 (reconstruct-vs-Drizzle) → RESOLVED into DEC-A1: wrap the driver CLIENT** (the object Kovo already passes to `drizzle({client})`). Drizzle keeps its result mapping; only the wire submission is reconstructed; the wrapped client is the sole door. Least-disruptive-to-Drizzle and most-sound.
- **O3 (assumable-role TOCTOU) → RESOLVED into DEC-C1: point-in-time check at provision/check/boot + the deploy-boundary contract (followup-9 O3) + an `ADMIN OPTION` assertion** to close the only runtime-reachable self-escalation.
- **O4 (boxing an auth secret that must be compared) → RESOLVED into DEC-D1: trusted-plaintext zone + prove-non-egress** (box everywhere except the adapter; enroll the adapter in the TCB; lint/test the adapter's plaintext reaches only cookie+DB). Not a safe-unbox API (fights Better Auth's string contract). DB-side comparison is the post-v1 north star.
- **O5 (is C9 applied to EVERY sink?) → PROMOTED to DEC-F (sink inventory + hostile-value tests), HIGHEST priority.** This is C9's own completeness — the mechanism that stops round 16 finding "the next sink," analogous to the fuzzer for the object axis. Until every sink is inventoried and hostile-value-tested, C9 is a principle, not a guarantee.
- **O6 (other driver dispatch escapes) → RESOLVED: subsumed by DEC-A1** (the wrapped client calls only each driver's plain parameterized entry point, so driver input-polymorphism is irrelevant by construction) + per-driver regression tests.

## 6. Probes before committing

- [ ] **DEC-A:** a `Submittable` and a mutating-`.text` value on every managed path cannot execute any statement but the reconstructed validated one; the driver `query()` is called only with the plain carrier (lint).
- [ ] **DEC-B:** a definer INSTEAD OF trigger on a writable view + a constraint trigger make `kovo db check` REFUSE; the fuzzer mechanism axis turns RED on a re-introduced B2.
- [ ] **DEC-C:** an adopted `BYPASSRLS` reader/writer fails provision/check/boot with the role named.
- [ ] **DEC-D:** outside the auth adapter no path yields a plain-string secret; the adapter is TCB-enrolled and its plaintext reaches only cookie+DB; `kovo_writer` cannot `SELECT` a secret column.
- [ ] **DEC-F:** every framework sink has a hostile-value test; a value with extra surface (getter/`toString` side effect/`Submittable`/`Proxy`/thenable) is neutralized at each sink; re-introducing "forward the object" turns a sink test RED.

## 7. Resolved design forks (recorded for provenance)

- **Inspect-and-forward vs reconstruct-and-own (B1/B4)** — chose RECONSTRUCT/OWN (DEC-A/D): validate a projection of an
  app object and forward it and the sink sees more than you checked; construct the carrier from validated primitives
  and pass only that.
- **Known-subset vs enumerate-from-the-engine (B2/B3)** — chose ENUMERATE (DEC-B/C): the audit must cover every
  writable relation / assumable role the engine actually exposes, not the tables/login-role the framework modeled.
- **Removing the export vs boxing the output (B4)** — chose BOX-THE-OUTPUT everywhere except the adapter, + a proven
  trusted-plaintext zone for the adapter (DEC-D); a third-party lib's string contract cannot be handed a box.
- **Reconstruct where: driver boundary vs Drizzle interceptor vs wrapped client (O2)** — chose the WRAPPED CLIENT (DEC-A1):
  Drizzle keeps its mapping, the wrapped client is the sole door, driver polymorphism is irrelevant by construction.
- **C9 completeness: address-found-sinks vs sink-inventory (O5)** — chose the SINK INVENTORY + hostile-value tests
  (DEC-F): the sink set is finite; testing it converts C9 from a principle into a checked invariant — the sink-axis
  analog of the grant-shape fuzzer.
- **Streaming: forbid vs blessed-cursor vs SQL-cursor (O1)** — chose FORBID for v1, framework-owned SQL `DECLARE`/`FETCH`
  cursor post-v1 (never a trusted driver-`Submittable`).
