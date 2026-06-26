# Plan: Adversarial Compiler Soundness & Security-Guarantee Audit

**Status:** audit complete; all confirmed holes fixed and merged to `main` (F1, F2, P1-1, P2-1/S4, P3-1,
S7-1, P0). One residual is a by-construction-gate wiring item in the external `vp` toolchain (P3-1's
static KV418 firing); the runtime floor already closes that hole fail-closed. Goal: stress the
Kovo compiler's _static_ security guarantees (the by-construction proofs in `SPEC.md` §5.2, §6.6, §4.8,
§10.2, §11, §6.5) for **soundness holes** — inputs where a stated guarantee can be defeated from
app-authored TSX/config while the build stays green.

**Method.** Two adversarial fan-outs (14 surfaces total) + independent main-thread verification. Each
probe produced an _executable_ repro (`compileComponentModule` / drizzle `extractQueryFactsFromProject`

- `vitest`) and a SPEC-cited expected-vs-observed delta; every candidate was adversarially verified by
  a skeptic (reachable from app source? caught by another gate / a sound runtime floor? exploitable
  artifact? right honesty tier?). Confirmed holes were fixed in a throwaway worktree.

**Honesty tiers (SPEC §6.6).** by-construction (static proof, unsafe state inexpressible) · runtime-DiD
(fail-closed floor, bypassable by privileged same-process code) · type-only · audit-only. A finding
only counts if it breaks a guarantee at the tier the framework _claims_ for it.

**Fixes (all merged to `main`).** Round 1 (branch `agent/compiler-soundness-fixes`):

- `9d9114ac1` F1 — KV236 trusted-brand by AST symbol-identity (3 sites + guard-zone).
- `3967817f2` F2 fix #2 — KV435 secret backstop over the folded read set.
- `f4dfbbc60` P1-1 — `sanitizeNext` fails closed on normalized protocol-relative path.

Round 2 (parallel worktree fan-out, one branch per slice):

- `8d74ba1e9` (`agent/fu-f2reads`) F2 fix #1 — KV410 requires a `reads:` set on every opaque projection.
- `deb3865e6`+`665be8d84` (`agent/fu-p3csrf`) P3-1 — KV418-for-mutations + csrf:false runtime no-ambient-session floor + explain posture.
- `e89a8a647` (`agent/fu-kv236spread`) P2-1/S4 — KV236 direct ≡ spread ≡ attrs-merge channel symmetry.
- `6607efcce`+`675370242` (`agent/fu-eqcache`) P0 cache-key completeness + S7-1 render-equivalence honesty.

---

## Findings (14 surfaces)

| ID                                 | Surface                                                                                                     | Sev          | Tier                          | Verdict                           | Status                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| **F1** (S1-A/S6-1)                 | KV236 trusted-brand regex (script/style XSS)                                                                | **Critical** | by-construction               | real-hole                         | **FIXED**                                                                 |
| **F2** (S5-001)                    | opaque `sql<T>` secret-column leak to client wire                                                           | **High**     | by-construction               | real-hole                         | **FIXED** (fix #1 + #2)                                                   |
| **P1-1**                           | `sanitizeNext` open-redirect via URL normalization                                                          | **Medium**   | runtime-DiD                   | real-hole                         | **FIXED**                                                                 |
| **P3-1**                           | `csrf:false` mutation rides ambient cookie session                                                          | **High**     | by-construction + runtime-DiD | real-hole                         | **FIXED** (runtime floor closes it; static gate landed, producer-pending) |
| P2-1                               | primitive `attrs={{…}}` channel skips KV236                                                                 | Low          | by-construction→DiD           | completeness                      | **FIXED**                                                                 |
| S4                                 | static object-spread `style` skips KV236                                                                    | Low          | by-construction→DiD           | completeness                      | **FIXED**                                                                 |
| S7-1                               | render-equivalence gate normalizes `escapeText` away                                                        | Info         | gate-honesty                  | completeness                      | **FIXED**                                                                 |
| P3-3                               | `explain --endpoints` omits mutation CSRF posture                                                           | Low          | audit-only                    | confirmed                         | **FIXED** (in P3-1)                                                       |
| P0                                 | cache key omits `productionRenderPlanGate`                                                                  | Low          | latent (unwired)              | partial, not app-reachable        | **FIXED**                                                                 |
| S1-B                               | dynamic `dangerouslySetInnerHTML` no compile brand                                                          | Info         | labeling                      | false-alarm (runtime fail-closed) | doc note                                                                  |
| P1-2, P4-01, P5-1, P0-tamper, P3-2 | `external` marker / module-URL injection / `@kovojs/*` prefix spoof / cache tamper / endpoint KV418 wrapper | —            | —                             | refuted                           | ruled out                                                                 |

### F1 — KV236 trusted-HTML escape hatch was symbol-blind (CRITICAL, FIXED)

**Defeated:** SPEC §6.6(1) ("symbol-identity provenance … never a text heuristic"), §5.2 rule 9
(typed facts, not source strings), §4.8 (the brand "is the only thing that suppresses KV236 … never
derivable by the compiler"). KV236 is the by-construction gate making a dynamic value in a
`<script>`/`<style>` rawtext sink unrepresentable in a green build.

**Mechanism.** `isTrustedHtmlExpression` gated suppression with `/^trustedHtml\s*\(/.test(expression.expression.trim())`
— a regex over raw expression text. Two defects: **(a) symbol-blind** — a shadowing local
`const trustedHtml = (s)=>s` or `import { trustedHtml } from './my-utils'` suppressed the gate;
**(b) prefix-only** — `trustedHtml("x") + product.code`, _even with the genuine `@kovojs/browser`
import_, whitelisted the raw `product.code` suffix into `<script>`. The same `call.name === 'trustedHtml'`
text check existed at `structural-jsx.ts:1363`. The hard-rule #9 kovo-check guard _excluded_
`packages/compiler/src/security/`, so it never policed this file.

**Proof (executable, identical structure, only the name differs):** case B `<script>{product.name}</script>`
→ KV236 (build red); case C `<script>{trustedHtml(product.name)}</script>` (undefined/arbitrary local)
→ **KV236:0, build green**, server render emits `product.name` raw, unencoded. Confirmed XSS.

**Fix (`9d9114ac1`).** `output-context-facts.ts:trustedHtmlBrandLocalNames(model)` resolves the local
names bound to the real `@kovojs/browser` `trustedHtml`/`safeRichHtml` exports from typed import facts
(`model.namedImports`). The rawtext gate now suppresses only when `expression.callName` (a single bare
call — `undefined` for concat/method/optional-chain → fails closed) is in that set; same resolution at
`structural-jsx.ts:1363`. Extended the hard-rule #9 guard to police `security/`.

### F2 — opaque `sql<T>` projection leaks a secret column to the client wire (HIGH)

**Defeated:** SPEC §10.2 — opaque projections must declare a `reads:` set folded into KV435/KV411 so
"an opaque projection cannot smuggle an exempt/outbox read past the static pass"; KV435 is the
by-construction confidentiality backstop.

**Mechanism (two gaps).** **(1)** `db.select({ stolen: sql<string>`(SELECT password_hash FROM users LIMIT 1)` }).from(sessions)`
with an `output` schema and **no `reads:`** builds green: the secret table `users` lives only in raw
SQL text (invisible to `tableExpressions`, correctly per hard-rule #9), `opaqueProjectionDiagnostics`
suppresses KV410 on the `output` schema alone, and the value reaches the client as a plain string.
**(2)** Even an honest `reads: [users]` declaration didn't fire KV435 — `secretProjectionBackstopDiagnostics`
keyed its secret-table check on `tableExpressions` only, ignoring `declaredReadExpressions`.

**Proof (executable):** CASE B (honest `reads:[users]`) and CASE A (omitted reads) both shipped the
`password_hash` with zero diagnostics; CONTROL `.from(users)` correctly fired KV435.

**Fix #2 LANDED (`3967817f2`).** Fold `declaredReadExpressions` into the read set the KV435 backstop
checks (`static.ts`). Closes the conformant (declared-`reads:`) path — CASE B now fires KV435.

**Fix #1 LANDED (`8d74ba1e9`, branch `agent/fu-f2reads`).** `opaqueProjectionDiagnostics`
(`query-shapes.ts`) suppresses KV410 only when `hasOutput && hasDeclaredReads`; `static.ts` passes
`query.declaredReadExpressions.length > 0`. Closes residual CASE A — an omitted-`reads:` raw-SQL-only
secret projection now fails the build (KV410). Migrated the opaque-projection unit fixtures + conformance
source-fixtures (`selectShape`, `sqlitePortability`) to declare `reads:`.

### P1-1 — `sanitizeNext` open-redirect via URL normalization (MEDIUM, FIXED)

**Defeated:** SPEC §6.5 — `next` MUST be a same-origin single-leading-slash path (no `//`),
re-validated, so login/redirect flows "cannot consume an open-redirect target".

**Mechanism.** `sanitizeNext` rejected raw `//`/`/\` inputs, then ran the value through
`new URL(next, base)` whose WHATWG normalization collapses `/..//evil.com` (and `/%2e%2e//evil.com`)
to pathname `//evil.com` while origin stays the base — both guards pass, and `//evil.com` is returned.
A base-less `Location: //evil.com` resolves cross-origin.

**Proof:** `sanitizeNext('/..//evil.com') === '//evil.com'`; `new URL('//evil.com','https://app').href === 'https://evil.com/'`.

**Fix (`f4dfbbc60`).** Re-apply the scheme-relative guard to the _normalized_ path the Location header
will carry; any non-strict-single-leading-slash result fails closed to `/`.

### Ruled out (with evidence)

- **S2 url-dynamic:** dynamic URL sinks (`href={user.url}` etc.) ARE neutralized on all four runtime
  paths (server `safeRuntimeAttribute`, client `kovoSafeUrl`, inline loader, fragment morph); the
  literal-only compile check is correctly labeled DiD, not by-construction. Protocol-relative `//host`
  is a SPEC-allowed relative path (KV220 catches literals). `srcset`/meta-refresh aren't JS-URL sinks.
- **S3 css-style:** object-form `style={{…}}` is backstopped at SSR + loader by the `kovoStyleProperty`
  value-grammar allowlist; no attacker bytes reach a CSS sink.
- **P1-2 `external`:** not a trust bypass — the KV236 unsafe-scheme check runs before the `external` branch.
- **P4 module-URL:** handler-ref/bootstrap module URLs are compiler-file-derived, never data-derived; KV236 refuses data into `on*`/handler sinks.
- **P5 `@kovojs/*` prefix:** the npm scope is registry-owned; the reservation is sink-less.
- **P0 tamper:** the on-disk compile cache shares the source/local-FS trust boundary; no SPEC text claims it as an adversarial boundary.
- **S1-B:** dynamic `dangerouslySetInnerHTML={expr}` has no compile-time brand check but is fail-closed
  at runtime (`kovoTrustedHtmlContent` returns `''` for unbranded) — a tier-labeling nuance, not a live hole.

## Open follow-ups

- [x] **F2 fix #1 — KV410 requires a `reads:` set on every opaque projection (SPEC §10.2).** Done in
      `8d74ba1e9` (branch `agent/fu-f2reads`). `opaqueProjectionDiagnostics` suppresses KV410 only when
      `hasOutput && hasDeclaredReads`; `static.ts` passes `query.declaredReadExpressions.length > 0`.
      Migrated 8 drizzle unit tests + conformance `source-fixtures.ts` (`selectShape`, `sqlitePortability`)
      to declare `reads:`; CASE A flipped from `it.todo` to a passing KV410 assertion. (CRM
      `pipelineByStage` was a no-op: its local `query()` factory has no `output`, so the new `hasOutput`
      branch never applies.) Evidence: `vitest --run packages/drizzle/src packages/conformance-fixtures/src`
      → 617 passed / 0 failed.
- [x] **P3-1 — KV418 for mutations + a runtime "no ambient session" floor for `csrf:false` (HIGH).**
      Done in `deb3865e6` + `665be8d84` (branch `agent/fu-p3csrf`). Three parts:
      (1) **Runtime floor (the load-bearing protection, VERIFIED end-to-end).** `app-mutation-request.ts`
      omits `sessionProvider` from `resolveLifecycleRequest` when the mutation is csrf-exempt
      (`!mutationRequiresPreBodyCsrf(mutation, app)`, read from the real mutation option), so `req.session`
      is genuinely absent — a `csrf:false` mutation cannot ride the victim's ambient cookie. Proven by
      `app-mutation-request.test.ts` ("with an app `sessionProvider` configured, the provider is never
      invoked and `req.session`" is absent). This closes the hole fail-closed regardless of the static gate.
      (2) **Static KV418 (by-construction).** `MutationExplain.csrf: 'checked'|'exempt'` (+ justification) on
      `core/graph.ts`; `graph-output.ts` raises KV418 when `mutation.csrf === 'exempt' && mutationReferencesSession(mutation)`
      (session read, session-derived guard `authed`/`role()`/`owns()`, or session auth posture — fails
      closed; `verifier:*`/`custom:*` machine-auth correctly excluded). Shared `isSessionDerivedGuard` with
      the endpoint gate. (3) **P3-3 audit:** `kovo explain --endpoints` now lists every mutation with its
      CSRF posture. ⚠ The static gate fires only once the graph **producer** populates `mutation.csrf:'exempt'`
      — the `KovoGraph` is emitted by the external `vp`/vite-plus toolchain (the CLI reads it from a file),
      the same emitter that already populates `endpoint.csrf`. Confirm/extend that emitter to set
      `mutation.csrf` (see the new follow-up below). Until then the by-construction gate is latent, but the
      runtime floor still fails closed (a session-reading `csrf:false` mutation gets `req.session===undefined`
      → its guard fails → unauthorized, never insecure).
- [x] **P2-1 / S4 — close the compile-time KV236 completeness gap for the primitive `attrs={{…}}` merge
      channel and static object-spread `style`.** Fixed in `security/output-context.ts`: spread and attrs
      channels unified onto `validateStaticObjectEntrySinks` (over `ObjectLiteralEntry`) with a `style`→
      `validateStyleAttribute` branch and the direct path's exact `isDirectHtmlEventHandlerAttribute`
      predicate, so direct ≡ spread ≡ attrs-merge for every sink (URL scheme, CSS-url, raw-HTML, on*,
      srcdoc). `validatePrimitiveAttrsEntries` gates on component-tag + inline `expressionObjectEntries`
      (matching `primitiveCompositionCandidates`), avoiding plain-element false positives. Union-merge of a
      primitive static `style`/`class` with an author dynamic object `style` still lowers each piece through
      the `kovoStyleProperty` floor (verified: `data-bind:style` derive, not raw concat). Evidence:
      `output-context-security.test.ts` "KV236 direct ≡ spread ≡ attrs-merge channel symmetry (P2-1 / S4)"
      (javascript: CSS url(), javascript: href, raw-HTML, onclick all fire across all three channels; safe +
      plain-element guard green). Residual (pre-existing, out of scope): the direct `isDirectHtmlEventHandlerAttribute`
      predicate is `/^on[a-z]/` (no `i` flag), so a static camelCase `onClick`/uppercase `ONCLICK` handler is
      unflagged in *all\* channels — the symmetry fix mirrors the direct form rather than introducing this gap.
- [x] **S7-1 — make the §5.2 #3 render-equivalence gate honest.** Done in `675370242` (branch
      `agent/fu-eqcache`). Removed the `escapeText(x) → x` encoder-stripping normalization from
      `render-equivalence.ts:normalizeGeneratedSemanticExpression`, so the gate compares the actual encoded
      output and fails closed on any encoder asymmetry. No genuine divergence surfaced (both sides already
      carry `escapeText`); the two genuinely-generated-only mutation-field normalizations are kept.
- [x] **P0 — fold `productionRenderPlanGate` into the compile cache key.** Done in `6607efcce` (branch
      `agent/fu-eqcache`). `compileComponentCacheKeyInput` projects the option to a stable
      `{ hasTokenFn, previous }` form and `compileCacheKey` includes it, so the key is now a total function
      of compile-affecting options. Regression test asserts inputs differing only in the gate (presence /
      `previous` / `tokenFn` presence) produce distinct keys.

## Remaining follow-ups

- [ ] **Confirm/extend the `vp`/vite-plus graph emitter to populate `mutation.csrf:'exempt'`** (the
      producer that already emits `endpoint.csrf`), so the by-construction KV418-for-mutations gate fires at
      compile time. The runtime floor already closes the hole fail-closed; this makes it a compile error too.
      External to this repo (vite-plus dependency).
- [ ] **Case-insensitive static event-handler detection (adjacent to P2-1/S4, low).** `isDirectHtmlEventHandlerAttribute`
      is `/^on[a-z]/` (no `i`), so a static literal `onClick="…"`/`ONCLICK="…"` is unflagged in all channels
      (author-self-XSS only; the dynamic/attacker path uses `/^on/i` and is covered). Tighten without
      breaking legit JSX `onClick={handler}` handler-refs.
- [ ] **Run the heavy `pnpm acceptance` / `conformance` build gates** once (not run in-session; they need
      a full build). All package-level vitest suites are green on `main`.

## Latest verification (full suites on `main`'s real toolchain, post-merge)

All round-2 slices merged to `main` and re-verified on the real toolchain (which resolves the worktree
symlink/env noise — `package-styles`/`argon2` failures seen in worktrees do **not** occur on `main`):

- **Drizzle: 442 passed / 0 failed** (F2 fix #1 + the migrated `reads:` fixtures; CASE A fires KV410).
- **Compiler: 697 passed / 0 failed** (P2-1/S4 channel symmetry, S7-1 gate, P0 cache key).
- **CLI: 213 passed / 1 skipped / 0 failed** (P3-1 KV418-mutation gate + `explain --endpoints` posture —
  the cross-package `MutationExplain.csrf` type resolves on `main`).
- **Server: 1026 passed / 8 failed** — the 8 are the **pre-existing** `password.test.ts` argon2-mock
  failures (verified identical at the pre-merge commit; unrelated to this work). P3-1's runtime-floor
  test passes (`app-mutation-request.test.ts` 11/11: a `csrf:false` mutation never invokes
  `sessionProvider`, so `req.session` is absent).
- Round-1 regressions (F1 `output-context-trusted-brand-identity` 9/9, F2 `confidentiality-folded-read-set`,
  P1-1 `guards` 36/36) all pass on `main`.
- **Not run in-session:** the broad `pnpm acceptance` / `conformance` build gates (heavy; need a full
  build) and the external-`vp` graph emit confirming `mutation.csrf` — both tracked under Remaining follow-ups.
