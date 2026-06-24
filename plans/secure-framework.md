# Secure-Framework Plan — Verify What's Real, Then Win

**Date:** 2026-06-24
**Status:** active (successor to `plans/secure-by-construction.md`; that ledger's Phase 0/1 are done, Phases
2–9 are reprioritized here against audit evidence).
**Primary objective:** two things, in order. **(A) Make Kovo's _shipped_ security guarantees actually real**
— close the gap between the diagnostic registry / "100%-complete" plan checkmarks and the production wiring an
evaluating senior engineer will probe first. **(B) Then win** — add the high-leverage gates and floors, ranked
by leverage × uniquely-enabled-by-Kovo × (inverse) effort, that make "most secure web framework" defensible.

This plan is grounded in an adversarial audit (21-agent recon→probe→skeptic→synthesis workflow, 2026-06-24)
whose bypass claims were re-checked by independent skeptics and whose **narrative-critical findings were
re-confirmed by hand** against the cited `file:line`. Every finding below carries its probe/grep evidence.

## Implementation status (live ledger — branch `agent/implement-secure-framework-20260624-114921`)

- [x] **Runtime `Secret` poison wrapper** (§4 / §5 follow-up). `secret()`/`isSecret()`/`revealSecret()`/
      `SecretValue<T>` in `packages/core/src/secret.ts`; poisons toString/toJSON/JSON.stringify/coercion/inspect →
      `[secret]`; module-private `Symbol()` brand (unforgeable); private `#value`; `reveal()`/`map()`/constant-time
      `equals()`. Evidence: `vp exec vitest --run packages/core/src/secret.test.ts` (13 tests). Commit `b4aae9d5`.
- [x] **Pre-allocated diagnostic codes** KV428-434/437 with full help text (so parallel slices don't collide on
      `diagnostics.ts`). Evidence: `packages/core/src/diagnostics.test.ts` (5 tests). Commit `da677eba`.
- [x] **Wave 1 (landed + integrated, 5 parallel slices merged conflict-free):**
  - [x] **SQL KV422** — runtime brands hardened to module-private `Symbol()`, `{text}`-carrier laundering
        rejected, prod floor flipped to `enforce`, KV422 finding family + `compile drizzle-static` exit 1 (the
        primary by-construction gate). Evidence: 133 focused + 846 server/core tests. _Follow-up: real-app-build
        graph merge of `sqlSafetyDiagnostics` so `kovo check` surfaces it too (compile-static gate already fires)._
  - [x] **Free isolation headers** — XFO:DENY, COOP, Permissions-Policy deny-all, Referrer-Policy on every
        document; HSTS prod+HTTPS-gated (wired via the `secure` flag); CORP:same-origin on `/c/__v/` assets.
  - [x] **KV414 join-keyed IDOR** — owner read via a join keyed on the joined table now flags `scope:'args'`;
        session-via-local tracing fixes the prior CRM false-positive. Evidence: 363 drizzle tests.
  - [x] **Named-import secret-emit gate (KV437)** — whole-channel fail-closed; client-safe = callee-position
        or `publishToClient`; 0/47 example FPs.
  - [x] **Cookie floor (KV432) + CSRF Origin/Sec-Fetch floor** — class-derived HttpOnly/Secure(prod)/SameSite
        at the `serializeCookie` sink; `unsafeCookie` escape; forwarded better-auth cookies floored at the
        document sink; cross-site unsafe-verb rejected before the token check. _Follow-up: migrate the framework's
        own classless cookie sites (anonymous-CSRF) to declare a class for default-on coverage._
  - Integration verified: api-surface 0 new violations; tsc at the 34-error pre-existing baseline (no new
    errors in any production file); 2124 touched-package tests pass (1 pre-existing `spec-coverage-map`
    failure, unrelated — examples/reference auth-flow citation).
- [x] **redacted() PII wrapper** — `redacted()`/`isRedacted()`/`revealRedacted()`/`Redacted<T>` in core;
      poison-to-mask DiD sibling of `secret()`. 18 secret/redacted tests. Commit `ce365d08`.
- [x] **Env validation** (`agent/sf-env`, merged) — `createApp` refuses to boot in prod on missing/weak
      framework secret (`CreateAppBootError`); optional `createApp({ env })`; committed-secret heuristic lint.
- [x] **CSP default-on** (`agent/sf-csp`, merged) — strict CSP auto-attached to every document (kept the
      `data-kovo-csp-hash` model); third-party allowlist config shape; non-overridable hardening directives.
      Trusted Types: framework `kovo` policy + module-side sinks routed, shipped **opt-in** (the always-on
      inline-loader `p`/`d` sinks need routing via `inline-loader-build.ts` before default-on — SF-WIRE).
- [x] **KV430 input-shape DoS budget** — iterative depth/breadth/node budget at the `parseSchemaAsync` wire
      entry (`schema.ts`); the 4000-deep array attack is rejected before descent and the check can't itself
      stack-overflow. 7 tests. Commit `52041325`. _Rest of the schema cluster below remains._
- [ ] **Schema cluster remainder:** KV428 upload inline-XSS gate (remove `.mime()`, sniff-based content-type,
  attachment-default); KV434 ReDoS-safe validators; per-schema `.max()` overrides; FormData-breadth +
  sync-parse-entry coverage. _(The agent assigned this session-limited mid-run; worktree discarded.)_
- [x] **KV436 default-deny + access migration** (breaking) — merged to `main`. `deriveAppGraph` classifies
  every surface (guard/public/verified/**missing**); KV436 fails `kovo check` on missing; every app surface
  migrated with a real decision; SPEC §10.2. By-construction that a decision exists (KV414 keeps IDOR).
- [x] **Egress/SSRF private-network deny floor + capability-URL core** (XL) — merged to `main`. Dual-layer
  (undici `dispatch` + `node:http`/`net.connect`), per-hop resolve→normalize→pin-to-IP, module-private
  `metadataAllowed` ALS via `awsCredential`/`gcpCredential`/`azureCredential`, `allowInternal`,
  `EgressBlockedError`, bootstrap self-probe; capability-URL HMAC/verify core; SPEC §6.6. Runtime-DiD floor,
  not a proof. _Open: capability-URL framework download route + `ctx.signUrl` threading._
- [x] **§3 write-reachability foundation → mass-assignment (KV438) / KV429 / KV433 — LANDED** (the big
  by-construction write lever). Governed-column fact + fail-closed write-gate adapter on the Stage-1 extractor;
  KV438 mass-assignment (examples FP-clean via `serverValue`); KV429 single-row TOCTOU; KV433 read-only-query
  Stage-2 (Stage-1 documented-blocked). `server` `kovoAnalyzerSummary` kind + opt-in CallExpression branch
  (inert for KV435/IDOR).
- [x] **Sources-sinks enforce + SF-WIRE follow-ups** (consolidation slice).
  - [x] **KV425 adversarial drift** (audit) — `scanSourceSinkDrift` scans a fixed lexicon broader than the 17
        registered tokens; a new dangerous token → `ERROR KV425` + nonzero exit; real-tree scan clean.
  - [x] **KV426 trust collector** (audit) + **KV424 app dangerous-sink** (error, kept REAL — 0 FPs over 97
        example files) — producers ride `compile drizzle-static` → `deriveAppGraph` → graph facts.
  - [x] **SQL producer→graph merge** — `sqlSafetyDiagnostics` typed through `deriveAppGraph`; raw
        `db.execute("..."+input)` fails `kovo check` end-to-end (by-construction at the gate, not only compile).
  - [x] **`kovo explain --capabilities` / `--cookies`** renderers wired; **CSP third-party allowlist** app
        config threaded; **cookie-class adoption** — framework anonymous-CSRF cookie carries the floor by default.
- [x] **Schema cluster remainder** (schema2 slice) — KV428 upload inline-XSS gate landed fully (byte-sniffer +
  polyglot guard, server-minted random keys, `respond.storedFile`/`verifiedSafe`, `.mime()` removed →
  `accept()`/`accept.unverified()`); KV434 blessed `email`/`url`/`uuid`/`slug` + `pattern()` static-reject +
  step-budget + `unsafeRegex` (compiler-side non-literal-pattern lint deferred).
- [ ] **Remaining (smaller follow-ups):** KV429 runtime CAS/version primitives + the typed 409 path (static
  gate landed); KV433 Stage-1 managed read-only handle (breaking) + interprocedural write-summaries; the
  capability-URL framework download route + `ctx.signUrl`; Trusted Types inline-loader sink routing; explain
  producer threads (publishToClient/egress `allowInternal` → `graph.capabilities`; cookie-downgrade runtime
  drain); `staticExportPathOverride` trust kind; KV434 compiler-side non-literal-pattern lint.

### Verified state of branch `agent/implement-secure-framework-20260624-114921` (2026-06-24)

24 commits on top of `main` (`b7dd0a6a`). Gates: **2655 touched-package tests pass** (1 pre-existing
unrelated `spec-coverage-map` failure); **tsc at the 34-error pre-existing baseline — zero new errors in any
production file**; `check:api-surface` 0 new violations; `git diff --check` clean. Not yet merged to `main`
(scope incomplete; CSP-default-on + cookie floor are intended breaking changes warranting review).

**Cross-file SF-WIRE follow-ups still open** (analyzers/runtime work, surfacing pending): SQL
`sqlSafetyDiagnostics` → real-app-build check graph; cookie-class adoption at the framework's own classless
cookie sites; `kovo explain --cookies`/`--capabilities` rendering; CSP third-party allowlist `createApp` config;
Trusted Types inline-loader sink routing; committed-secret compiler-AST check.

- SPEC normative contracts land WITH each feature (per the plan's "land contracts with each feature" rule),
  not ahead — so `SPEC.md` edits are deferred into the slice that implements the behavior.

## Honesty frame (normative, SPEC §2 / §6.6)

The audit is scored on the SPEC's own four-level vocabulary; this plan uses it everywhere:

- **by-construction** — a sound static proof; the unsafe state is inexpressible or fails the build.
- **runtime-DiD** — a fail-closed runtime floor: sound at its sink, bypassable by privileged same-process code;
  MUST be labeled a floor, never sold as a proof.
- **type-only** — `tsc`-time ergonomics; defeated by `any`/`as`/missing-tsc. The compiler runs **no** type
  checker (`grep getTypeChecker packages/compiler/src` empty), so a brand is **never** the mechanism.
- **audit-only** — surfaced in `kovo explain`; informs review, enforces nothing.

The recurring failure mode this plan exists to fix: **an error-severity diagnostic is defined, a CLI renderer
exists, a plan is checked "complete" — and the analyzer that would make it enforce is missing or unwired.**

---

## §1 — Verification scorecard: what is real today

> "Are the current security guarantees in fact real?" — Mostly **no, except where wired**. One headline gate
> (KV435) is genuinely by-construction and survived every probe. The rest is honest-but-thin: sound analyzers
> that gate nothing, dead renderers fed only by test fixtures, and floors that default to off or warn.

| Guarantee                                                                                               | Verdict       | Real level          | The catch (probe/grep evidence)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KV435 confidentiality** (secret column → client wire)                                                 | **holds**     | **by-construction** | The one solid win. Every bypass refuted by probe (alias/`findMany`/spread/computed-key/`sql<T>`/CTE/join/jsonb/forged-reveal); wired end-to-end (`validate/pipeline.ts:95`). Caveat: depends on correct `kovo({secret})` annotation; un-annotated column is invisible (declare-once contract, not a bypass). Does **not** cover non-Drizzle/hand-rolled loads.                                                                                                         |
| **Phase 0 provenance engine**                                                                           | holds         | by-construction     | Sound, fail-closed (Unknown is absorbing), alias-corpus-proof. **But its only consumer is cache-invalidation derivation — NO shipped security gate (KV435/KV414) calls it.** Foundation built; nothing user-facing depends on it yet. Intra-procedural only (no CallExpression branch → calls = Unknown).                                                                                                                                                              |
| **Secret<T> / JsonValue bound** (Doors 1/2/3)                                                           | partial       | **type-only**       | Probe-confirmed silent leak: `query('x',{load:():any=>({password:secret})})` compiles clean. `JsonSerializable` collapses to `JsonValue` when `Value` is `any` (`json-boundary.ts:8`). No runtime `Secret` object exists; the "wire poison" toString/toJSON is **not in code**. The plan over-claims this as by-construction.                                                                                                                                          |
| **KV422 SQL injection**                                                                                 | **leaky**     | runtime-DiD         | Analyzer is sound + fail-closed but **wired into no blocking gate** (`grep -c KV422 graph-output.ts` = **0**; `compile.ts` returns `exitCode:0` without inspecting `sqlSafetyDiagnostics`). Runtime guard defaults to **warn-only in prod** (`guards.ts:479: production?'warn':'enforce'`), fails open on object-shaped statements, and brands use forgeable `Symbol.for`. **Unsafe raw SQL ships green and executes.** `sql-injection.md` is checked "100% complete." |
| **KV423 source/sink inventory**                                                                         | holds         | audit-only          | Real as a hand-maintained doc pointing at independently-shipped chokepoints. Nothing keeps it synced.                                                                                                                                                                                                                                                                                                                                                                  |
| **KV424 / KV425 / KV426** (app-sink catch / drift / `--trust`)                                          | **not-wired** | audit-only          | All three dead. KV425 drift scan returns hardcoded `unregistered:0` (cannot fail). KV424 `unregisteredSinks` and KV426 `trustEscapes` have **zero production producers** — only test fixtures. Error-severity renderers with no analyzer behind them = false assurance.                                                                                                                                                                                                |
| **KV436 default-deny authorization**                                                                    | **not-wired** | audit-only          | `graph.access` is never populated by the compile pipeline (`app-graph.ts` never references it). KV436 loop never executes. Authz is **default-ALLOW** today — a guardless destructive mutation ships green with only an advisory WARN. (Documented Phase 2 open item, but the SPEC §6.6 "default-deny by construction" claim is materially absent in prod.)                                                                                                            |
| **KV414 owner-table IDOR**                                                                              | partial       | by-construction     | Sound only for the narrow direct-arg-predicate-on-owner-table shape. **Probe-confirmed join-keyed bypass** (read an owner table through a join keyed on the joined table → no fact emitted, ships green). Also false-negative on non-owner tables/unscoped reads, and false-**positive** on the CRM's own correct fix.                                                                                                                                                 |
| **CRM IDOR fix** (`fix-security.md`)                                                                    | partial       | runtime-DiD         | Correct but a **manual one-off**, verified only by hand-written runtime tests. No structural gate; a new app re-introduces the class.                                                                                                                                                                                                                                                                                                                                  |
| **Runtime safe-defaults** (error opacity, proto-pollution-safe coercion, nosniff+attachment, load-shed) | holds         | by-construction     | Genuinely shipped and sound. Residuals: `respond.stream({disposition:'inline'})` serves attacker SVG inline; Content-Length-only body cap; no shape/depth budget.                                                                                                                                                                                                                                                                                                      |
| **CSP hardening directives**                                                                            | partial       | runtime-DiD         | `base-uri`/`object-src`/`form-action`/`frame-ancestors` are genuinely non-overridable — but the **whole CSP is opt-in** (`api/rendering.ts:1` "apps opt into … by passing `document.csp`"; no dispatch-path auto-attach). Apps ship with **no CSP**, no nonce, no strict-dynamic, no Trusted Types.                                                                                                                                                                    |
| **Cookie security floor**                                                                               | **not-wired** | audit-only          | `serializeCookie` emits `HttpOnly`/`Secure`/`SameSite` **only when the caller passes them** (`cookies.ts:57-65`). `serializeCookie('sid','abc')` → bare cookie. Header-injection hardening (CRLF rejection, percent-encoding, KV415) **is** real; the attribute floor is **not**. Behind Rails/Django/Phoenix.                                                                                                                                                         |

**Confirmed live holes (probe- or skeptic-verified), worst first:**

1. **[HIGH] KV422 unwired + prod warn-only** → unsafe raw SQL executes. (`graph-output.ts` has no KV422; `compile.ts:273` exitCode 0; `guards.ts:479` warn.)
2. **[HIGH] Named-import secret → client bundle.** A client handler `() => sendPayment(STRIPE_SECRET_KEY)` capturing a named import re-emits `import { STRIPE_SECRET_KEY }` verbatim into `*.client.js` (`lower/handlers.ts:197` → `emit/client.ts:51`); bundler inlines the evaluated secret. **Probe-confirmed zero diagnostics.** KV435 covers only the query wire. Live in normal handler code today.
3. **[HIGH] KV414 join-keyed IDOR bypass.** `from(orders).innerJoin(items,…).where(eq(items.id,input.itemId))` emits no scope audit for owner domain `orders` (`static.ts:294`). Authenticated attacker reads another principal's rows; `kovo check` green.
4. **[HIGH] KV436 unwired** → default-allow authorization (above).
5. **[MED] `any` defeats Secret/JsonValue** (Doors 1/2 silent leak).
6. **[MED] Cookie floor absent** (XSS-theft/MITM/CSRF on a bare session cookie).
7. **[MED] CSP opt-in** (zero CSP/clickjacking backstop on documents by default).
8. **[MED] `respond.stream` inline SVG** runs script same-origin; `.mime()` trusts client MIME (zero callers).
9. **[MED] SQL brands forgeable** (`Symbol.for` global registry — any dep can stamp the TRUSTED brand).
10. **[MED] Managed-SQL guard fails open** on any non-string object carrying assembled text (`{text:…}` → `ok:true`); only `execute/query/exec/prepare/transaction` wrapped (root `.run()/.any()` unguarded).
11. **[MED] KV425 drift can't fail; KV424 never fires; `--trust` (KV426) blind** — every shipped escape hatch invisible in the audit a reviewer runs pre-ship.

---

## §2 — The work

Tiered by leverage-per-effort. Each **major** item carries a **Trade-off** block (Gain / Cost / Ceiling /
Breaking / Annoys). Items cross-reference `secure-by-construction.md` phases where they originate.

### Tier 0 — Wire what's already built and sound (highest leverage-per-effort; mostly non-breaking)

> These are not research. The analyzers pass their own tests; they gate nothing. This is where "make the
> guarantees real" is cheapest, and it directly de-risks the "100%-complete" credibility gap.

- [ ] **Wire KV422 into `kovo check` + flip prod floor to enforce.** Add `analyzeSqlSafetyFromProject` as a
      KV422 finding family in `graph-output.ts` (peer of KV414/KV436) that fails the build; run it over
      `examples/` + templates in the CI sql-safety job; flip `guards.ts:479` prod default to `enforce` (or
      document warn-only loudly). Switch the four SQL brands from `Symbol.for` to module-private `Symbol()`;
      reject `{text}` objects lacking a separated `values` array; enumerate the full execution-method surface
      per adapter (default-deny by wrapping every function-valued property).
  - **Trade-off** — Gain: turns a sound, fail-closed analyzer from audit-only into **by-construction** with no
    new analysis; closes the most embarrassing "shipped but executes injection" hole. Cost: the analyzer's
    existing false-positives now block builds (measure on `examples/` first). Ceiling: by-construction at the
    static gate + tamper-resistant runtime floor. Breaking: enforce-in-prod changes behavior for apps relying
    on warn. Annoys: anyone with a `trustedSql` they never justified.
- [ ] **Wire KV436 default-deny.** Populate `graph.access` from the compile pipeline (lift `accessFactsFromApp`
      or a static equivalent into `deriveAppGraph`); make `access:` a **required** total field on every
      query/mutation/route/endpoint/webhook; migrate every call site with a **real** decision (no
      `public('TODO')` stubs); record `public()` in a reviewed `kovo explain --access` snapshot.
      (`secure-by-construction.md` Phase 2.)
  - **Trade-off** — Gain: **no mainstream framework ships compile-time authorization-completeness** — a genuine
    differentiator, and it flips authz from default-allow to default-deny. The inhabitants, producer, and
    `--access` renderer all already exist; only wiring + the mandatory-field decision + migration are missing.
    Cost: a large, build-reddening migration touching every surface + all fixtures. Ceiling: by-construction
    that a decision **exists** — **not** that it is correct (a no-op `return true` guard satisfies it; keep
    KV414 for correctness). Breaking: yes (omission won't compile). Annoys: every existing call site once.
    Risk: `public()` reason strings are greppable intent leakage — forbid sensitive operational detail.
- [ ] **Gate the named-import handler-closure secret-emit channel (fail-closed, whole-channel).** Refuse to
      emit **any** captured cross-module import into the client unless it resolves to a serializable literal /
      whitelisted client symbol; `publishToClient(value,{reason})` is the audited escape in
      `kovo explain --capabilities`. Follow the **resolved binding**, not the surface specifier (barrel/re-export
      laundering); cover default + `import * as` capture, not just named imports.
      (`secure-by-construction.md` Phase 4.)
  - **Trade-off** — Gain: closes a **live** secret-exfil channel (probe-confirmed today). Uniquely enabled —
    the compiler already owns the server/client split and the emit decision is a pure AST fact. Cost/Annoys:
    false positives on legitimate client-only util imports captured in handlers → mitigate by recognizing
    client-emittable targets + `publishToClient`. Ceiling: **by-construction** only if whole-channel fail-closed
    — the narrow `process.env`/brand gate is unsound (no CallExpression branch → call-wrapped secrets escape).
    Breaking: no (new diagnostic on a previously-silent leak). FP risk: medium → measure on `examples/`.
- [ ] **Make KV424/425/426 enforce (or relabel).** KV425: make the drift scan **adversarial** — scan a fixed
      lexicon of dangerous DOM/exec tokens **broader** than the registered set; any token not mapped to a
      registry owner/explicit allowlist → KV425 error, nonzero exit. KV424: add a real AST pass flagging
      member-assignments/calls to the dangerous-sink lexicon in app source. KV426: wire a pass collecting every
      `trustedHtml/trustedUrl/trustedSql` call site, raw `endpoint()`, `webhook() verify:'none'`, and
      static-export override into `graph.trustEscapes` with source span + justification.
  - **Trade-off** — Gain: makes `kovo explain --trust` (the audit a reviewer runs pre-ship) actually
    enumerate the app's trust surface, and makes drift detection capable of failing. Cost: real analyzer work
    (KV424 is an imperative-DOM AST pass; KV426 is a call-site collector). Ceiling: KV425 audit-only (internal
    CI assurance over the framework tree); KV424 by-construction-ish; KV426 audit-only. **Cheaper alternative if
    deprioritized: relabel all three audit-only in the plan/docs and stop implying enforcement.** Annoys: nobody
    externally (KV425 is contributor-facing).

### Tier 1 — Close confirmed holes that are table-stakes & low false-positive (mostly non-breaking)

- [ ] **CSRF Origin / `Sec-Fetch-Site` floor at the dispatch chokepoint.** A header-based second floor that
      fail-closed-rejects unsafe-verb cross-site requests **before** the synchronizer-token check, covering
      mutations + endpoints + the `/_q/` channel uniformly. `trustedOrigins` config; strict-vs-compat fallback
      for clients omitting both headers. **(Net-new — not in any plan.)**
  - **Trade-off** — Gain: the **single cheapest catch-up an evaluator notices** — Kovo's CSRF is
    synchronizer-token-only (`grep` empty for Origin/Sec-Fetch); SvelteKit/Remix/Rails all ship this. One
    chokepoint, uniform coverage. Cost: a compat fallback for old/no-header clients (don't break them). Ceiling:
    runtime-DiD (sound at the dispatch sink). Breaking: no. Annoys: legit cross-origin API callers → handled by
    `trustedOrigins`.
- [ ] **Cookie safe-default floor + cookie class + KV432 downgrade gate.** At the single `serializeCookie` sink,
      force `HttpOnly` + `Secure`(prod-gated) + a required `SameSite` from a cookie **class**
      (`session`/`auth`/`app-data`); KV432 errors on an insecure downgrade without
      `unsafeCookie({downgrade, justification})` (audited in `kovo explain --cookies`); normalize forwarded
      better-auth `Set-Cookie` through the floor. (`secure-by-construction.md` Phase 5.)
  - **Trade-off** — Gain: by-construction on the framework path (one Set-Cookie sink); closes XSS-theft/MITM/CSRF
    on bare cookies; table-stakes parity with Rails/Django/Phoenix. Cost/Breaking: `Secure` must be **prod-gated**
    (else breaks localhost-http dev); normalizing forwarded `Set-Cookie` risks dropping `Partitioned`/`Priority`.
    Ceiling: by-construction (floor) + audit (downgrade). Annoys: apps with an intentional `SameSite=None`
    embed → `unsafeCookie`. **Fixation-as-compile-error correctly stays cut** (unsound; Kovo doesn't own session
    identity, §6.5).
- [ ] **Free isolation/hardening headers on every document.** `X-Frame-Options: DENY` (clickjacking companion to
      `frame-ancestors` for pre-CSP3), `Cross-Origin-Opener-Policy: same-origin-allow-popups`,
      `Cross-Origin-Resource-Policy: same-origin` on `/c/__v/` immutable assets, `Permissions-Policy`
      deny-by-default, `Referrer-Policy` (already emitted — confirm), `Strict-Transport-Security` (prod+https
      gated). **(Net-new — absent from every plan.)**
  - **Trade-off** — Gain: the **lowest-FP wins in the whole audit**; near-zero app-shape knowledge; Kovo is
    behind Django (XFO DENY default) and currently has **zero** clickjacking defense (CSP not emitted). Cost:
    almost none. Ceiling: runtime-DiD. Breaking: HSTS must be prod+https-gated (bricks non-HTTPS domains);
    `COEP: require-corp` is explicitly **not** free (breaks cross-origin subresources) → opt-in only. Annoys:
    apps embedding cross-origin iframes/popups → `Permissions-Policy`/allowlist config.
- [ ] **Extend KV414 to close the join-keyed bypass.** Treat a join into an owner table as an owner read;
      require the join chain or a sibling predicate to be `session`/`owns()`-scoped, else flag `scope:'args'`;
      add minimal session-via-local tracing so the CRM's own correct fix stops false-positiving. Reuse the
      touch-graph reads enumeration (already includes the joined owner table).
  - **Trade-off** — Gain: closes a **probe-confirmed authenticated-attacker data-read hole**. Cost: moderate;
    needs the join-chain scoping logic + light local-var tracing. Ceiling: by-construction (narrower than RBAC).
    Breaking: no. FP risk: medium → the session-via-local work is what fixes the existing CRM false-positive.
- [ ] **Input-shape DoS runtime budget (KV430).** Default depth/breadth/node ceiling in the `s.*` parser
      **before descending** (413/422-class, fail fast), covering JSON / FormData key-expansion / `/_q/` args /
      route params through one budget; per-schema `.max()` + global config overrides; KV430 lint nudges an
      explicit bound. (`secure-by-construction.md` Phase 6.)
  - **Trade-off** — Gain: probe-confirmed gap (a 4000-deep `s.array` descends unguarded); one ceiling in the
    shared schema engine protects **every** wire boundary; ahead of Zod/Yup (unbounded recursion). Cost: the
    `.max()`/global-config overrides are **hard co-requisites** (else false 422s on legit bulk imports). Ceiling:
    runtime-DiD. Breaking: no. Annoys: legit large payloads until they declare `.max()`.
- [ ] **File-upload inline-XSS gate (KV428, core slice).** Default `attachment` + `nosniff` everywhere;
      neutralize `respond.stream({disposition:'inline'})` for attacker bytes; mint served `Content-Type` from
      **sniffed** bytes; rasterize/re-encode or attachment-only for SVG; server-generated random storage keys;
      **remove `.mime()`** (zero callers). (`secure-by-construction.md` Phase 6.)
  - **Trade-off** — Gain: closes a **live** inline-SVG-runs-script hole; `.mime()` removal is free. Cost:
    rasterize/re-encode adds a server image dep + CPU/upload. Ceiling: runtime-DiD — honestly "attacker bytes
    never rendered inline as active content," **not** "type unspoofable"; `respond.storedFile(key)` takes a bare
    string so the brand degrades to a runtime sidecar-marker (fail-closed). Breaking: `.mime()` removal +
    inline-by-default→attachment.
- [ ] **Env-schema validation + refuse-to-boot on missing/weak secrets (+ committed-secret lint).** Validate
      env at the `createApp` bootstrap chokepoint; refuse to boot on a missing/short prod `csrf` secret (a bare
      unvalidated string today → an empty/4-char secret silently degrades the HMAC). Committed-secret detection
      rides the existing `process.env`/secret provenance as an audit-grade lint with waiver. **(Net-new.)**
  - **Trade-off** — Gain: by-construction refuse-to-boot at a single chokepoint; table-stakes (T3-env/Pydantic/
    Phoenix); compiler-driven committed-key lint is uniquely-Kovo. Cost: small. Ceiling: by-construction (boot)
    - audit (entropy lint, has FPs → waiver). Breaking: a deploy with a weak secret now fails to boot (intended).

### Tier 2 — Bigger by-construction gates (need the shared interprocedural foundation; see §3)

- [x] **Build the §11.1 write-effect GATE layer on the existing Stage-1 extractor (shared pass, once).**
      Landed: the `governed`-column schema fact (auto for `key:`/`owner:`, explicit `kovo({ governed })`) +
      a fail-closed write-gate adapter over `extractSymbolicEffectsFromProject` (`opaque/input → reject`).
      Evidence: `extractMassAssignmentFromProject` (packages/drizzle/src/static/derivation.ts); the same
      machinery hosts KV429 (`extractToctouFromProject`) and KV433 (`extractQueryWriteReachabilityFromProject`).
      `vp exec vitest --run packages/drizzle/src/index.mass-assignment.test.ts` (14).
- [x] **Mass-assignment gate (Phase 3) — KV438, fully landed + proven.** `governed` fact (auto `key:`/`owner:`,
      explicit `kovo({ governed })`); input/unprovable provenance reaching a governed column is the blocking
      KV438 error (fail-closed). Traces alias/destructure via the Phase-0 engine; `.values(input)`/`{ ...input }`
      spread rejected on a governed table. Two-tier escape: `serverValue(v,reason)` (non-input only) +
      `adminAssign(input.x,reason)` (audited) — `@kovojs/server` (write-governance.ts). Helper FPs resolved by
      `kovoAnalyzerSummary(fn,{returns:{kind:'server'}})` + a minimal opt-in CallExpression branch in
      symbol-provenance (inert for KV435/IDOR — conformance-tested). **FP measure on examples: crm 0, commerce 2
      (both server-derived; discharged with `serverValue` — examples now clean).** Wired end-to-end through
      `kovo check`. SPEC §10.1/§10.3. Evidence: `vp exec vitest --run packages/drizzle/src/index.mass-assignment.test.ts`
      (14, incl. KV435/IDOR conformance) + `packages/cli/src/index.kovo-check.test.ts` (KV438 fires).
- [x] **TOCTOU KV429 — single-row gate landed.** `kovo({ atomic })`/`kovo({ version })` declared columns; a
      self-referential `set({ col: col±x })` to an `atomic` column whose `where()` lacks a CAS eq-guard on that
      column (or a `version` column) is KV429. Single-row by-construction; **opaque/multi-row matches NOT flagged
      (honest ceiling — SERIALIZABLE territory).** Reuses the Stage-1 lowering. Evidence:
      `vp exec vitest --run packages/drizzle/src/index.toctou-readonly.test.ts` (KV429: 6). _Open: typed CAS/
      version primitives + the 409 path were NOT shipped this slice (the static gate + DB-constraint backstop is
      the landed lever); cross-function check-then-act is a false-negative floor until interprocedural summaries._
- [x] **Read-only `query()` handle (KV433) — Stage 2 landed; Stage 1 documented-blocked.** Stage 2: a `query()`
      loader whose body directly reaches a Drizzle write (insert/update/delete) is KV433; `query.elevated(...)`
      is the audited escape. **Stage 1 (managed read-only proxy) BLOCKED** as the audit predicted —
      `QueryLoadContext={request}` threads no db handle (loaders close over module-scope `db`); deferred as a
      breaking change. **Interprocedural residue** (loader→imported `domain()` write via captured handle) needs
      the unbuilt write-summaries — documented gap; v1 covers directly-reachable loader-body writes. SPEC §6.6/§9.4.
      Evidence: `vp exec vitest --run packages/drizzle/src/index.toctou-readonly.test.ts` (KV433: 3).

### Tier 3 — Differentiators & investigate (high ceiling, high cost/uncertainty)

- [ ] **Strict CSP default-on + Trusted Types + third-party allowlist (Phase 7).** Auto-attach the existing
      strong policy in the dispatch path (keep the wired `data-kovo-csp-hash` model); install a framework-sole
      Trusted Types policy (`require-trusted-types-for 'script'`) after routing the ~6 internal `innerHTML` sinks
      through `createHTML`; ship a `script-src`/`frame-src`/`connect-src` + Permissions-Policy allowlist config
      in `kovo explain --capabilities`.
  - **Trade-off** — Gain: free DiD everywhere; Trusted Types is a **genuine first-mover** (works only because
    Kovo is the sole DOM-writer — React/Next can't). Cost: Trusted Types is **not** "add a header" — it bricks
    Kovo's own hydration on Chromium until `morph.ts`/`query-bindings.ts`/`response-fragment-apply.ts`/
    `bind-prop.ts`/`inline-loader.ts` route through the policy. Ceiling: runtime-DiD (Chromium-only for TT; CSP
    is the cross-browser floor). Breaking: yes — **the third-party allowlist is a hard co-requisite** (no
    report-only ramp → every real app with analytics/Stripe is stranded without it; absent it, devs disable CSP
    wholesale, which is worse). Sequence: allowlist config first, then default-on CSP, then TT.
- [ ] **Authorization-gates-DATA completeness — investigate.** Prove the guard principal == the WHERE-predicate
      symbol scoping returned rows (the IDOR-completeness dream beyond `owner:` tables). **(Net-new.)**
  - **Trade-off** — Gain: **the headline no competitor can make** (Rails/Django/Phoenix use runtime unverified
    policy objects); uniquely enabled (guard + loader + Drizzle query are one statically-analyzable handler;
    KV414's `argScopedReads`/`sessionAnchoredReads` are most of the machinery). Cost: XL; high FP (admin
    cross-user reads, join-tenancy, aggregates need a loud audited `crossPrincipalRead`); needs light
    interprocedural session-flow tracing KV414 avoids. **Verdict: investigate the read-path subset; defer write.**
- [x] **Cloud-metadata SSRF: `metadataAllowed` ALS capability + dual-layer private-network deny floor
      (Phase 5) — ship the ALS idea, scope the floor.** Public egress unrestricted; private/loopback/link-local/
      metadata denied by default, reachable only via narrow `host:port` `allowInternal`; metadata reachable only
      inside the module-private `metadataAllowed` AsyncLocalStorage frame entered by per-cloud credential
      factories; enforced at both a custom undici dispatcher and `node:http`/`net.connect`.
  - Evidence: `packages/server/src/{egress,egress-undici,egress-credentials,egress-bootstrap}.ts`;
    `vp exec vitest --run packages/server/src/egress*.test.ts` = 35 pass (metadata denied outside the frame at
    BOTH layers, allowed inside `kovo.awsCredential()`; private 10.x denied unless allowlisted; public egress
    unaffected; pooled-socket reuse still gated via the undici dispatcher; ALS propagates into `net.connect` AND
    the undici connector on Node 24.18 / bundled undici 7.28; self-probe fires when absent; config refuses boot
    on a metadata IP in `allowInternal`). Wired into `createApp({ egress })` (opt-in). Full server suite 833
    pass; tsc at baseline (33); api-surface gate at baseline. Prototype-freezing NOT default-enabled. SPEC §6.6
    "Outbound egress" section added (labeled runtime-DiD). **Residual fail-open (documented, by design):**
    same-process re-patch of `net.connect`/`setGlobalDispatcher`; worker/child/native-socket paths; per-`fetch`
    `dispatcher` option (net layer still catches the first dial); provider-shape drift. **Non-goals:** not
    exfiltration defense (needs a positive allowlist); not a code sandbox.
  - **Trade-off** — Gain: the `metadataAllowed` ALS capability is the **genuinely original idea**
    (provenance-as-current-frame, unforgeable by SSRF, ALS-into-connect-probe confirmed). Cost: the **full floor
    is XL greenfield** monkeypatching two stdlib surfaces the repo has never patched (undici isn't even a dep),
    with documented **fail-open residuals** (workers/child_process/native sockets) and **high FP** (every
    internal service/localhost DB hard-fails until allowlisted). Ceiling: runtime-DiD against SSRF network
    position — explicitly **not** a sandbox against malicious code or external exfiltration. **Redundant on
    Lambda/PaaS/WIF** where IMDSv2 already closes the metadata path; earns its keep only on long-lived
    managed-identity VMs + the internal-service pivot. **Verdict: ship the ALS capability + the deny-floor as
    opt-in with a loud startup self-probe; do NOT default-enable prototype-freezing (breaks Datadog/OTel/nock —
    worse tickets than the holes it closes).**
- [ ] **Capability-URL primitive (`ctx.signUrl`) + framework download route.** HMAC over canonicalized
      `method+key+expiry+scope`, constant-time verify at a framework-owned download endpoint **before** any
      storage read. (`secure-by-construction.md` Phase 5.)
  - PARTIAL — the cryptographic core landed and is proven: `packages/server/src/capability-url.ts`
    (`signCapability`/`verifyCapability`/`createMemoryCapabilityReplayStore`), HMAC over canonicalized
    length-prefixed `(version,method,key,expiry,scope)` (collision-resistant across the key/scope boundary),
    constant-time verify mirroring `verifier.ts#constantTimeEqual`, fail-closed ordered checks, short-TTL
    default, and one-time replay. `vp exec vitest --run packages/server/src/capability-url.test.ts` = 13 pass
    (round-trip; key/method/scope substitution rejected; expiry; tampered/wrong-secret signature; one-time
    replay; canonicalization collision resistance). Public at the root barrel; SPEC §6.6 capability-URL
    paragraph added (labeled by-construction at the verify sink). **OPEN (load-bearing gap, as the plan
    predicted):** there is no framework storage **download route** to host the verify sink, and no
    `ctx.signUrl` context threading; those remain to be built on top of this core.
  - **Trade-off** — Gain: by-construction at the verify sink (object un-dereferenceable without a valid token);
    closes a gap the legible wire amplifies. Cost: **the load-bearing gap is there is no framework storage
    download route to host the verify sink** — that's the real effort, not the HMAC (which exists). Ceiling:
    by-construction (verify) + mitigation (URL-as-credential leakage via Referer/logs/CDN is irreducible →
    short expiry/scope/oneTime). Breaking: no.
- [ ] **ReDoS-safe validators (KV434).** Blessed linear `email`/`url`/`uuid`/`slug` matchers; literal-only
      `pattern()` with static exponential-structure reject + runtime step-budget; `unsafeRegex(re,reason)`
      escape; RE2 deferred. (`secure-by-construction.md` Phase 6.)
  - **Trade-off** — Gain: greenfield and **API-design-safe-before-it-exists** (cheapest possible posture; the
    validator API doesn't exist yet). Cost: low. Ceiling: blessed formats are by-construction; **`pattern()` is
    only by-construction-ish** (the static rejecter is a conservative heuristic; the runtime step-budget is the
    real floor — airtight requires the deferred RE2/DFA engine). **Don't label `pattern()` by-construction.**
- [ ] **Compiler-attested content-addressed client bundle manifest.** A signed manifest of the exact set +
      content hash of every emitted client module (Kovo knows this at compile time). Pairs with npm-provenance on
      Kovo's own packages. **(Net-new.)**
  - **Trade-off** — Gain: **uniquely enabled** by Kovo's sole-emitter position — nobody else can mint this.
    Cost: moderate. Ceiling: audit/tamper-evidence at build+deploy, **not** browser byte-enforcement (`import()`
    can't be SRI-gated — Phase 7 already admits this). Breaking: no.

---

## §3 — The cross-cutting limitation that gates the whole by-construction write story

**The symbol-provenance engine has no `CallExpression` branch — every cross-function value is `Unknown`.** For
the shipped consumers (cache invalidation, KV435) that's sound (`Unknown` = the safe direction). But **every**
future by-construction **write** gate (mass-assignment, KV433 Stage-2, KV429, authz-gates-data) degrades to
either fail-closed **FP storms** or silent **FN** the moment a value flows through a helper. The interprocedural
plan ("reuse the touch-graph's bottom-up write-summaries") is currently **unspecified**.

- [x] **Minimal interprocedural `server` summary kind landed (the write-gate slice).** Added the `server`
      `kovoAnalyzerSummary` return kind + a minimal `CallExpression` branch in `symbol-provenance.ts`, gated on
      an OPT-IN `serverSummaryKeys` set so it is **inert for the KV435/IDOR confidentiality consumers** (they
      never populate it). Conformance-tested: a server-summary helper resolves to `server`, a plain helper stays
      `unknown`, and the branch is inert without the opt-in set; the full drizzle suite (KV435/IDOR bypass corpus)
      stays green. Evidence: `vp exec vitest --run packages/drizzle/src/index.mass-assignment.test.ts` (the
      `symbol-provenance server-summary branch (KV435/IDOR conformance)` block) + `packages/drizzle` (363).
      _Open: the FULL bottom-up write-summaries (a helper that itself performs a write, for KV433 interprocedural
      + authz-gates-data) are NOT built — only the `server`-return interprocedural source landed; that is the
      slice the write-provenance gate needed._

---

## §4 — Honesty / SPEC alignment fixes (do these regardless)

- [ ] Relabel **Secret<T> Doors 2/3 as type-only**, not by-construction (defeated by `any`/casts/missing-tsc).
      The real confidentiality proof is KV435. Optionally add a runtime `Secret` wrapper with poisoning
      `toJSON`/`inspect` as honest DiD.
- [ ] Correct `plans/sql-injection.md` and `plans/sources-sinks.md`: their "100% complete" status is
      **misleading** — KV422 gates nothing and KV424/425/426 are unwired. Either wire (Tier 0) or relabel
      audit-only.
- [ ] Note in `secure-by-construction.md` that **Phase 0 is foundation-only** — no shipped user-facing gate
      consumes the provenance engine yet (KV435/KV414 use separate classifiers).

---

## §5 — Drop / defer (cost exceeds real-world value)

- [ ] **Drop** the standalone runtime **log scrubber** as a security claim — unsound taint on JS strings, high
      FP+FN, gives false confidence. Honest framing + an optional `inspect`/`toJSON` poison only. CWE-532 stays
      a documented residual.
- [ ] **Drop** standalone **`SameSite=Strict` default** — UX-regressing (breaks emailed-link-to-logged-in-page),
      overlaps KV432, and the query GET channel is already well-defended; fold into KV432 with an audited downgrade.
- [ ] **Defer** the **KV427 cloud-credential compile gate** — a bespoke pattern-matcher (no provenance reuse)
      with trivial total FNs (`const C=S3Client; new C()`, factory wrappers, barrels, dynamic import) and medium
      FPs; the runtime fail-closed floor is strictly stronger. Ship as a warning at most, if at all.
- [ ] **Defer** the **tamper-evident runtime audit log** — audit-only (suppressible by same-process code),
      hot-path overhead; sequence behind the prevention items it complements.
- [ ] **Defer** **`query.elevated` GET write escape** — idempotency isn't soundly recognizable; resolve the
      §9.4 Open Design Question (push write-from-read to a mutation instead) first — that likely makes it moot.
- [ ] **Investigate** the **access:/runtime decoupling** — `access.ts` is "not an executable policy engine";
      runtime calls `runGuard(definition.guard)`, not `definition.access`, so a surface can declare
      `access: verified` with no real verifier and nothing catches the lie. The clean fix (make `access:` the
      single source both runtime and audit derive from) is a `runGuard` refactor; scope before building.

---

## §6 — Sequencing, acceptance, verification

**Recommended order:** Tier 0 (wiring — turns "fake" into "real" cheapest) → Tier 1 (table-stakes, low-FP) →
§3 interprocedural foundation → Tier 2 (the write gates it unlocks) → Tier 3 (differentiators) → §4 relabels
land continuously.

- [ ] **Acceptance — no regressions:** KV435 stays green against the full bypass corpus
      (`alias`/`findMany`/spread/computed-key/`sql<T>`/CTE/join/jsonb/forged-reveal); existing
      `fix-security.md` / SQL / endpoint-webhook suites stay green; `git diff --check`.
- [ ] **Acceptance — wiring real:** a guardless destructive mutation, a raw-string `db.execute("..."+input)`,
      a captured-secret client handler, and a join-keyed owner read each **fail `kovo check`** with the
      corresponding KV code (today all four are green).
- [ ] **Acceptance — honesty:** every checkbox marked done cites the verifying test/command; no diagnostic is
      error-severity in `diagnostics.ts` without a production producer (the anti-pattern this plan exists to kill).
- [ ] Keep this ledger compact (CLAUDE.md): as items land, replace prose with the narrowest verifying command.

## Latest verification (audit baseline, 2026-06-24)

- `grep -c KV422 packages/cli/src/graph-output.ts` → **0** (KV422 in no `kovo check` family).
- `packages/cli/src/commands/compile.ts:1238` computes `sqlSafetyDiagnostics`; `:273`/`:1561` return `exitCode:0`.
- `packages/server/src/guards.ts:479` → `process.env.NODE_ENV === 'production' ? 'warn' : 'enforce'`.
- `packages/compiler/src/app-graph.ts` never references `access` → `graph.access` empty → KV436 never fires.
- `packages/server/src/api/rendering.ts:1` — CSP is opt-in ("apps opt into … by passing `document.csp`").
- `packages/server/src/cookies.ts:57-65` — `HttpOnly`/`Secure`/`SameSite` emitted only if the caller passes them.
- KV435 probe corpus (`packages/drizzle/src/__probe_kv435_*.test.ts`, run + removed in `../kovo-sec-verify`):
  every bypass fired KV435 or was a conservative false-positive; none leaked.
- Source: 21-agent recon→probe→skeptic→synthesis workflow (`wf_92bc4ac0-2d3`), narrative-critical findings
  re-confirmed by hand against cited `file:line`.
