# Round-8 Papercuts 27

Created 2026-07-02. Source of truth remains `SPEC.md`. Meta-failures + over-block/robustness items from the round-8
dogfood AFTER `plans/fundamental-fixes-followup-3.md`. Security fail-opens are in `plans/claude-bugz-29.md`.

**Meta-theme — the plan's own acceptance apparatus was unsound, which is WHY the `bugz-29` fail-opens shipped as
`[x]`.** followup-3 promised soundness rested on three mechanisms: (A9a/DEC-H) paranoid mode disables ALL static
security gates so the runtime choke is proven as sole enforcement; (A10/DEC-K) a small, verified TCB contains all
enforcement; (§9) a paranoid generative dogfood finds zero leaks. Round 8 shows all three are hollow as built: (P1)
paranoid mode disables only 3 of the security codes, so the confidentiality/injection/read runtime chokes were never
actually tested alone; (P2) the "verified TCB" excludes the real enforcement; (P3) the same name-match box that
under-boxes (`bugz-29` B1) also over-boxes legit reads. The re-architecture's *principle* is right; its *acceptance
and TCB accounting* are the enumerate-and-allow failure, now in the proof machinery itself.

## Issues

- [ ] **P1 — `KOVO_PARANOID=1` downgrades ONLY `{KV406, KV422, KV438}` to advisory; the DEC-A/C/D security codes `KV435`/`KV426`/`KV433`/`KV437` stay build-fatal — so paranoid mode never disabled static for the properties the runtime chokes were built to own, and "runtime is sole enforcement" was never actually tested.** (HIGH-impact / dev-tooling+honesty, architectural; found by `secret-source-completeness` + `paranoid-and-tcb-honesty`, self-verified)
  - Observed: the plan (A9a/DEC-H) says paranoid mode "forces EVERY static security classifier to `proven-safe`." In reality, rebuilding the *simple* builder alias `email: session.token` under `KOVO_PARANOID=1` still fails with `ERROR KV435 … Secret query value reaches the client wire` (exit 1). So static KV435 remains the thing catching the simple case — the runtime box is never exercised as sole enforcement for confidentiality, which is exactly why its incompleteness (`bugz-29` B1) shipped undetected.
  - Root cause (self-verified): `packages/cli/src/graph-output.ts:630` `staticAdvisoryCodes = new Set(['KV406','KV422','KV438'])`; `packages/cli/src/commands/build-export.ts:465` and `packages/server/src/vite.ts:568` repeat the same three-code set. `KV435`/`KV426`/`KV433`/`KV437` are absent from all three, so `staticFindingFails` still fails the build on them with `paranoidStaticAdvisory=true`. This contradicts A9a/DEC-H and A4/A7 (no invariant may depend on static soundness): confidentiality/injection/read-only were "moved to runtime" in name while their static gates stayed load-bearing.
  - Why it matters: every Phase 2/3 checkbox — "runtime-twin deletion proof," "paranoid acceptance," "KV435 → advisory" — was GREEN only because static KV435/KV426 was still catching the cases the runtime choke misses. The plan's central proof ("with static off, the runtime chokes alone hold") was never run for the codes that matter. This invalidates the acceptance of Phases 2, 3 (and the §9 finish line).
  - Repro evidence: source sets at the three cited lines; behaviorally, `KOVO_PARANOID=1 pnpm run build:prod` on a `db.select({ email: session.token })` loader → exit 1 `KV435` (static still fatal under paranoid).
  - Acceptance: paranoid mode downgrades EVERY static security code (`KV426/KV433/KV435/KV437/…`, not a 3-code allowlist) to advisory; a test asserts the advisory set equals the full security-code set. Then re-run the Phase 2/3 paranoid acceptances — they will (correctly) fail on `bugz-29` B1/B2/B3 until the runtime chokes are made provenance-sound.

- [ ] **P2 — The "verified ~350-line TCB" (A10/DEC-K) EXCLUDES the real confidentiality/integrity enforcement: the actual boxing + declared-write logic lives in the ~683-line-per-dialect GENERATED starter adapter, which `check:tcb-boundary` does not scan.** (MED, honesty, architectural; found by `paranoid-and-tcb-honesty`, self-verified)
  - Observed: `security/TCB.md` enrolls 77 framework entries (~353 verified lines), but the code that actually decides secrecy and write-scope at runtime is `packages/create-kovo/templates/src/_kovo/app-runtime-db.{sqlite,postgres}.ts` — **683 lines each**, generated per app, NOT in the manifest and NOT scanned by `scripts/check-tcb-boundary.mjs` (grep for `app-runtime-db`/`templates`/`starter` in the lint → no match).
  - Root cause: the TCB manifest + boundary lint cover framework `packages/` but the enforcement was implemented in the per-app generated adapter (the "starter adapter fallback" the plan's own evidence repeatedly cites). So the A10 reduction — "is Kovo sound? = are these few hundred verified lines correct?" — is false: the real enforcement is an order of magnitude larger, un-manifested, unverified, and re-generated into every app.
  - Why it matters: the headline soundness argument (a tiny verified TCB behind a sole door) does not hold, because the door's logic isn't in the verified set. `bugz-29` B1 is a bug in exactly this un-verified generated code.
  - Repro evidence: `wc -l app-runtime-db.sqlite.ts` = 683; `TCB.md` framework-only; `check-tcb-boundary.mjs` has no reference to the generated adapter.
  - Acceptance: move the confidentiality/integrity enforcement out of the generated per-app adapter INTO the framework core (a single `@kovojs/server` choke), enroll it in the TCB manifest, and have `check:tcb-boundary` scan it; the generated adapter should only wire config, not decide security. Then the A10 budget + verification bar actually covers the real boundary.

- [ ] **P3 — The same result-name-match box that under-boxes (`bugz-29` B1) also OVER-boxes: any aliased/computed projection from a table that merely CONTAINS a secret column whole-row-refuses (KV435 / HTTP 500), breaking legitimate reads.** (MED, over-block, architectural; found by `integrity-overblock-and-regression`, reproduced, paranoid-confirmed)
  - Observed: a legitimate query projecting a non-secret computed/aliased column from a table that has a secret column (e.g. `select id, upper(name) as label from session_owner`) trips the `rawWholeRowSecret` whole-row backstop and the whole row is refused at wire egress → HTTP 500, under paranoid mode.
  - Root cause: the whole-row backstop fires on "reads from a table containing a secret column" without proving the projection excludes the secret — the coarse dual of B1's name-match. Same file/mechanism as `bugz-29` B1.
  - Why it matters: the confidentiality choke fails BOTH ways — it leaks aliased secrets (B1) and 500s legit projections (P3) — the classic incomplete-enumeration signature. Provenance tagging (B1 acceptance) fixes both: box exactly the values from secret columns, nothing more, nothing less.
  - Acceptance: with provenance tagging, a projection that does not materialize a secret column serves normally; only a materialized secret value is boxed.

- [ ] **P4 — The SQLite starter reader is not truly engine-enforced read-only (contra DEC-A); the KV433 message misattributes a framework SQL-text parse to "the database engine rejected it."** (LOW, honesty, architectural; found by `engine-vs-fallback-integrity`, PARTIAL)
  - Observed: DEC-A claims readers run in a DB-native read-only context ("the database engine rejects the write"). On the SQLite starter the rejection is produced by the framework's own SQL-text classification, and the KV433 diagnostic says the engine rejected it — a misattribution. (The engine `query_only`/`readonly` connection may not be the actual gate for all shapes.)
  - Root cause: the starter reader path relies on the framework parse/choke rather than a strictly engine-enforced read-only connection for every shape; the diagnostic wording overstates engine involvement.
  - Why it matters: A3 ("use the platform's own enforcement") is the soundness argument for integrity; where it is actually the framework choke again, the argument is weaker than stated and the diagnostic is dishonest about which layer caught it.
  - Acceptance: readers run on a genuinely engine-read-only connection (`PRAGMA query_only`/`readonly:true`) that rejects writes for ALL shapes; the KV433 message accurately names the enforcing layer.

- [ ] **P5 — Inline `style={{...}}` object is silently dropped by the renderer (no style output) — a legitimate React-ism produces nothing.** (LOW, over-block/DX, not architectural; found by `renderer-default-deny-generality`, PARTIAL)
  - Observed: `<span style={{ color: 'red', background: '#eee' }}>` emits no style attribute; the object form is dropped rather than serialized.
  - Acceptance: the object style form serializes to a safe inline style string (with the contextual escaping), or emits a clear diagnostic; silently dropping is a papercut.

## Refuted / Not Carried Forward

- **Renderer generality (F1/F2) — held** for the tested novel positions under paranoid mode (see `bugz-29` Refuted); `bugz-28` B2 meta-refresh is fixed.
- **Raw-endpoint Response egress (SDE-2) — held**: boxed secrets are refused there.

## Latest Verification

- P1 self-verified: advisory set is exactly `{KV406,KV422,KV438}` at `graph-output.ts:630`, `build-export.ts:465`, `vite.ts:568`; `KV435`/`KV426`/`KV433` absent; `KOVO_PARANOID=1` build still KV435-fatal on a secret-to-wire loader. P2 self-verified: `app-runtime-db.sqlite.ts` = 683 lines, not in `TCB.md`/`check-tcb-boundary.mjs`. P3/P4/P5 reproduced by verifiers.
- Throwaway apps under `/Users/mini/kovo-dogfood-round8/` — safe to delete. No framework source or `SPEC.md` changed; no servers left running.
