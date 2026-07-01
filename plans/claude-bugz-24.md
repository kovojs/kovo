# Round-3 Soundness Bugz 24

Created 2026-06-30. Source of truth remains `SPEC.md`. Security/soundness defects found in the THIRD
(deeper + broader) dogfood round, after the user fixed claude-bugz-22/23 + claude-papercuts-20/21.
Papercuts from this round are in `plans/claude-papercuts-22.md`.

**Meta-theme:** the fixes from rounds 1–2 are real and mostly complete, but **three of the five
findings are incomplete-fix residuals** — the fix closed the exact reported binding/shape but a SIBLING
shape reaches the same fail-open sink. Freshly-changed code is where the next bug hides.

## Scope

Nine fresh SQLite `create-kovo` starters linked to the local monorepo, on the production node-preset
artifact. Five tracks probed the fresh fixes for incompleteness (`reader-deep`, `schema-sql-deep`,
`endpoint-webhook-deep`, `defer-deep`); the rest hit new surfaces. Root causes confirmed first-hand in
source; the two headline findings (B1, B2) were self-verified by isolation flip; B3–B5 were reproduced
by independent skeptical verifiers with positive controls. Encouraging: the nested-`<Defer>` drain fix
and the Reader receiver-typing fix are COMPLETE for every sibling except the ones below
(see `claude-papercuts-22.md` Refuted).

## Issues

### A. Query-loader read-set erasure (incomplete-fix residual of claude-bugz-23 B1)

- [ ] **B1 — A query loader whose read is performed inside a loader-LOCAL closure (`const run = async () => db.select(...)`) erases the entire static read set, so KV435 secret-to-wire + KV414 owner-scope IDOR + KV310/KV407 all fail OPEN on a green build — even though the `db` handle is the recognized, blessed `Reader<AppDb>`.** (HIGH, framework/security; found by `reader-deep`, SELF-VERIFIED by isolation flip; residual of `claude-bugz-23` B1)
  - Observed: a loader binds the now-correctly-recognized `const db = context!.db!` (the form the B1 fix blesses) but reads inside an ordinary local arrow: `const run = async () => db.select({id:account.id, password:account.password}).from(account); return { items: await run() };`. `kovo build` → GREEN, `tsc` clean, **zero** diagnostics; the booted prod artifact serves the secret-classified `account` scrypt password hash over BOTH the SSR document and `/_q`.
  - Root cause: `packages/drizzle/src/static/project-receivers.ts:1233-1245` `isTouchBodyNode` returns false for any call nested inside a function-like ancestor EXCEPT an inline `transaction` callback or an inline iteration callback (`.map/.filter/.forEach`). `touchBodyCallExpressions` (`:1221`) applies that filter and is the shared loader-read traversal feeding the read-shape/secret extractor (`query-shapes.ts:811`, `summaries.ts:336`) and read derivation (`derivation.ts:2372-2393`). A `.select().from(account)` inside a loader-local async arrow is never visited → empty read set → KV435/KV414/KV310/KV407 get no input. The B1 fix only widened receiver TYPE identity (`schema.ts isKovoReaderOfDrizzleDatabaseType`); the read CALL SITE exclusion is one layer up, untouched.
  - Why it matters: secret-to-wire (KV435) and owner-scope IDOR (KV414) are by-construction guarantees. An author who wraps a read in a trivial local helper/closure (retry, conditional, `Promise.all` of local arrows) — type-clean, recognized handle — ships a green build that silently serves password hashes / cross-tenant rows. The traversal already descends into `.map`/transaction callbacks, so dropping an ordinary local arrow is an under-approximation bug.
  - Repro evidence (SELF-VERIFIED): closure form → `build:prod` exit 0, **0 KV diagnostics**; the IDENTICAL projection at loader top level → exit 1, `KV310 BUILD_FATAL auth/sign-in → queries/leak-probe-query` (read set now recognized). Only the closure call-site differs.
  - Acceptance: `isTouchBodyNode` visits loader-local (non-iteration, non-transaction) closures, OR the read-extraction fails CLOSED (KV406 "un-analyzable read; declare reads") when a recognized `Reader` handle's reads cannot be fully traversed — never an empty read set. A focused test: a secret/owner read inside `const run = async () => db.select(...)` must fire KV435/KV414.

### B. Compile-time XSS gate bypassed by import path

- [ ] **B2 — KV426 (the `trustedHtml` stored-XSS provenance gate) only recognizes the brand when imported from `@kovojs/browser`; the framework's OWN `@kovojs/server` re-export — the import the §4.10 render-tree guide tells authors to use — silently disables the gate.** (HIGH, framework/security; found by `registry-dynamic`, SELF-VERIFIED by import flip; distinct from `bugz-4` M3 / `super-1` E3)
  - Observed: two byte-identical components branding request-derived `input.body` via `trustedHtml`, differing ONLY in the import specifier, build differently. `import { trustedHtml } from '@kovojs/browser'` → `KV426` build error. `import { trustedHtml } from '@kovojs/server'` → GREEN build, shipping the unsanitized raw-HTML sink.
  - Root cause: `packages/compiler/src/validate/trusted-html-provenance.ts:88` collects brand local names only when `imported.moduleSpecifier === '@kovojs/browser'`. But `trustedHtml` is publicly re-exported from `@kovojs/server` (`packages/server/src/api/rendering.ts:6`, `index.ts:356`), and the render-tree guide (`site/content/guides/render-tree.md`) tells §4.10 authors to import it from `@kovojs/server` next to `renderTree`. Server-imported brands are never added to the brand set, so `classifyExpression`/KV426 never runs. (The gate's own error message at `trusted-html-provenance.ts:430` even says `trustedHtml` is "exported from @kovojs/browser and @kovojs/server" — yet recognition keys on browser only.)
  - Why it matters: KV426 is the by-construction stored/reflected-XSS safety net for the `trustedHtml` pure brand. The framework's recommended §4.10 entrypoint (server import) ships request-derived bytes to a raw-HTML sink with a green build and zero diagnostic. The runtime brand is identical (server just re-exports browser's), so the gate's protection is simply absent on the documented path.
  - Repro evidence (SELF-VERIFIED): `xss-probe.tsx` branding `input.body`; import from `@kovojs/server` → `build:prod` exit 0, **KV426 count 0**; flip ONLY the import to `@kovojs/browser` → exit 1, `KV426 ... brands request-derived data without sanitization`.
  - Acceptance: KV426 brand recognition follows the real export identity (resolve `trustedHtml`/`trustedUrl` through the `@kovojs/server` re-export and any alias), so the gate runs regardless of which public entrypoint the author imports.

### C. Webhook write through a captured handle escapes the idempotency floor + audit

- [ ] **B3 — A webhook with NO `transaction` and NO `writes` whose handler writes through the captured module-level `appDb` builds green, is reported as non-writing by `kovo explain`, and skips the §10.3 idempotency/replay floor — so provider redelivery silently double-executes the write.** (HIGH, framework/soundness; found by `endpoint-webhook-deep`, verified independently; distinct from `bugz` H8/H9 + `claude-bugz-23` B4)
  - Observed: a `webhook({ verify:'none' })` whose handler does `await appDb.insert(contacts)...` (no `writes`/`transaction`/`idempotency`) → `kovo build` passes with zero diagnostics; `kovo explain --endpoints` shows `writes=-`; `POST {id:fresh1}` → 200 (row written), identical replay `POST {id:fresh1}` → 500 PK conflict (the handler RE-EXECUTED — no replay dedup). The declared-writes control deduplicates the replay.
  - Root cause: `packages/server/src/webhook.ts:631-652` `assertWebhookWritePosture` decides "write-capable" purely from declaration shape (`transaction !== undefined || writes.length > 0`); a handler writing via an external db reference is neither, so the SPEC §10.3 atomic idempotency-reservation floor is never required and the write is absent from the §11.4 audit — contradicting the fix's own comment (`:627-629`) that "a write-capable webhook without idempotency()+replayStore cannot exist". A no-transaction webhook exposes no managed db handle, so capturing `appDb` is the natural (only) write path.
  - Why it matters: machine-ingress fail-open — provider redelivery (the norm for webhooks) silently double-executes the effect (double-charge / duplicate ledger row on upsert or non-PK-constrained tables), and the write is invisible to the security-review audit. Distinct from H8/H9 (which gate the `transaction`-exposing path) and from claude-bugz-23 B4 (`recordChange` to an undeclared domain).
  - Repro evidence: `webhook` capturing `appDb`, no writes/tx/idempotency → green build; `kovo explain --endpoints` → `writes=-`; replay POST re-executes (500 PK conflict); declared-writes control dedups.
  - Acceptance: a webhook handler that performs a DB write (including via a captured `appDb`/external handle) must require the §10.3 idempotency floor and appear in the §11.4 write audit, OR `kovo build` fails closed steering the write onto the managed/declared path — no green build for an unprotected, unaudited webhook write.

### D. Island reactive-coverage holes (around the bugz-13 B2 / bugz-19 B1 fix)

- [ ] **B4 — `const {count} = state` (destructured) and `const b = a` (chained bare-identifier) state aliases in a client island ship FROZEN UI on a green build: no client derive is emitted AND no KV311 fires.** (HIGH, framework/soundness; found by `islands-ladder`, verified independently; incomplete-fix residual of `bugz-13` B2 / `bugz-19` B1)
  - Observed: in the prod artifact, an island stamps reactive `data-bind` on `{state.count}` and `const a=state.count;{a}`, but emits NO `data-bind` on `const {count:d}=state;{d}` or `const b=a;{b}`; the client module has no derive for them. `kovo build` + `vp check` both GREEN, no KV311. The two unstamped spans are permanently frozen while the others update.
  - Root cause: `packages/compiler/src/scan/parse.ts:1836` gates alias capture on `ts.isIdentifier(node.name)`, excluding an `ObjectBindingPattern` (`const {count}=state`); `:1840` drops any alias whose initializer has zero property accesses (`const b=a`). Both then read as free identifiers, so `analyze/reactive-aliases.ts` finds no reactive dependency → no derive AND the §4.9 coverage walk records no uncovered position → no KV311.
  - Why it matters: §4.9 demands reactive coverage OR a diagnostic; destructuring state and chaining a local are idiomatic L1 TSX. The simple-direct-alias fix (`const a=state.count`, now reactive) did not extend to these siblings, so silent stale UI ships through a green deploy gate.
  - Repro evidence: prod artifact — `#chained`/`#destructured` spans have no `data-bind`; `counter.client.js` has no derive for them; `vp check` + `kovo build` green, no KV311; control `#direct`/`#alias` carry `data-bind`.
  - Acceptance: alias capture handles `ObjectBindingPattern` and chained bare-identifier aliases (transitively resolving to a state/query access), OR §4.9/KV311 flags the uncovered reactive position — no silent frozen UI.

- [ ] **B5 — A render-local alias whose initializer calls a module-scope helper (`const label = format(state.count)`) is inlined verbatim into the generated client derive, but the helper is never bundled into the client module — so the island's update derive throws `ReferenceError` at hydration, on a green build with no diagnostic.** (HIGH, framework/soundness; found by `islands-ladder`, verified independently; over-reach of the `bugz-13` B2 alias-expansion fix)
  - Observed: `const label = format(state.count); {label}` IS recognized reactive and stamps a derive `derive(["state"], (state) => (format(state.count)))`, but the served `counter.client.js` has no `format` import/definition; running the derive throws `ReferenceError: format is not defined`. `kovo build` + `vp check` GREEN. The SSR stamp wires the broken derive to the span, so it executes at hydration/update.
  - Root cause: `packages/compiler/src/analyze/reactive-aliases.ts:24-40` string-substitutes the alias name with its initializer text verbatim (`label` → `(format(state.count))`) into the client derive body; the derive emitter never bundles referenced module-scope helpers into the client module and never validates that a generated derive references only state/query/client-bundled identifiers — no diagnostic flags the unbound free identifier.
  - Why it matters: a common formatting pattern ships a reactive island whose update cycle throws, behind a green deploy gate (green-build dead artifact). Even if helper calls in client derives are unsupported, the missing fail-closed diagnostic is itself the defect (cf. `bugz-14` B4 ReferenceError class).
  - Repro evidence: served `counter.client.js` derive `(format(state.count))` with no `format`; `node` import + `derive.run({count:5})` → `ReferenceError: format is not defined`; control derive (`state.count`) runs fine; build green.
  - Acceptance: a generated client derive either bundles/serializes referenced module-scope helpers, OR `kovo build` fails closed (a KV diagnostic) when a derive references an identifier that is not state/query/client-bundled — no green build over a guaranteed-throwing derive.

## Latest Verification

- Baseline: fresh SQLite scaffold on the fixed framework — `check`/`build:prod` green (build 21.5s).
- B1 SELF-VERIFIED (isolation flip): closure-scoped secret read → `build:prod` exit 0, 0 KV diagnostics; identical top-level read → exit 1, `KV310 BUILD_FATAL`. Source confirmed `project-receivers.ts:1221,1233-1245`.
- B2 SELF-VERIFIED (import flip): `trustedHtml` from `@kovojs/server` → exit 0, KV426 count 0; from `@kovojs/browser` → exit 1, KV426 fires. Source confirmed `trusted-html-provenance.ts:88` + re-export `rendering.ts:6`/`index.ts:356`.
- B3/B4/B5 root causes confirmed first-hand in source (`webhook.ts:631-652`; `parse.ts:1836,1840`; `reactive-aliases.ts:24-40`); runtime symptoms reproduced by independent verifiers with positive controls (declared-writes dedup control; `#direct`/`#alias` data-bind control; working `state.count` derive control).
- Monorepo repaired (`pnpm install` at root); `git status` shows only the new `plans/claude-*.md` ledgers; stray servers killed. Throwaway apps under `/Users/mini/kovo-dogfood-round3/` — safe to delete.
