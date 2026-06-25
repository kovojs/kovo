# Plan: Adversarial Compiler Soundness & Security-Guarantee Audit

**Status:** audit complete; 3 confirmed holes fixed, 1 partial + follow-ups tracked. Goal: stress the
Kovo compiler's *static* security guarantees (the by-construction proofs in `SPEC.md` §5.2, §6.6, §4.8,
§10.2, §11, §6.5) for **soundness holes** — inputs where a stated guarantee can be defeated from
app-authored TSX/config while the build stays green.

**Method.** Two adversarial fan-outs (14 surfaces total) + independent main-thread verification. Each
probe produced an *executable* repro (`compileComponentModule` / drizzle `extractQueryFactsFromProject`
+ `vitest`) and a SPEC-cited expected-vs-observed delta; every candidate was adversarially verified by
a skeptic (reachable from app source? caught by another gate / a sound runtime floor? exploitable
artifact? right honesty tier?). Confirmed holes were fixed in a throwaway worktree.

**Honesty tiers (SPEC §6.6).** by-construction (static proof, unsafe state inexpressible) · runtime-DiD
(fail-closed floor, bypassable by privileged same-process code) · type-only · audit-only. A finding
only counts if it breaks a guarantee at the tier the framework *claims* for it.

**Fixes (throwaway worktree, branch `agent/compiler-soundness-fixes`):**
- `9d9114ac1` F1 — KV236 trusted-brand by AST symbol-identity (3 sites + guard-zone).
- `3967817f2` F2 fix #2 — KV435 secret backstop over the folded read set.
- `f4dfbbc60` P1-1 — `sanitizeNext` fails closed on normalized protocol-relative path.

---

## Findings (14 surfaces)

| ID | Surface | Sev | Tier | Verdict | Status |
| --- | --- | --- | --- | --- | --- |
| **F1** (S1-A/S6-1) | KV236 trusted-brand regex (script/style XSS) | **Critical** | by-construction | real-hole | **FIXED** |
| **F2** (S5-001) | opaque `sql<T>` secret-column leak to client wire | **High** | by-construction | real-hole | **fix #2 LANDED**; fix #1 follow-up |
| **P1-1** | `sanitizeNext` open-redirect via URL normalization | **Medium** | runtime-DiD | real-hole | **FIXED** |
| **P3-1** | `csrf:false` mutation rides ambient cookie session | **High** | by-construction | real-hole | follow-up (multi-surface) |
| P2-1 | primitive `attrs={{…}}` channel skips KV236 | Low | by-construction→DiD | completeness | follow-up (runtime-backed) |
| S4 | static object-spread `style` skips KV236 | Low | by-construction→DiD | completeness | follow-up (runtime-backed) |
| S7-1 | render-equivalence gate normalizes `escapeText` away | Info | gate-honesty | completeness | follow-up |
| P3-3 | `explain --endpoints` omits mutation CSRF posture | Low | audit-only | confirmed | folds into P3-1 |
| P0 | cache key omits `productionRenderPlanGate` | Low | latent (unwired) | partial, not app-reachable | follow-up (cheap) |
| S1-B | dynamic `dangerouslySetInnerHTML` no compile brand | Info | labeling | false-alarm (runtime fail-closed) | doc note |
| P1-2, P4-01, P5-1, P0-tamper, P3-2 | `external` marker / module-URL injection / `@kovojs/*` prefix spoof / cache tamper / endpoint KV418 wrapper | — | — | refuted | ruled out |

### F1 — KV236 trusted-HTML escape hatch was symbol-blind (CRITICAL, FIXED)

**Defeated:** SPEC §6.6(1) ("symbol-identity provenance … never a text heuristic"), §5.2 rule 9
(typed facts, not source strings), §4.8 (the brand "is the only thing that suppresses KV236 … never
derivable by the compiler"). KV236 is the by-construction gate making a dynamic value in a
`<script>`/`<style>` rawtext sink unrepresentable in a green build.

**Mechanism.** `isTrustedHtmlExpression` gated suppression with `/^trustedHtml\s*\(/.test(expression.expression.trim())`
— a regex over raw expression text. Two defects: **(a) symbol-blind** — a shadowing local
`const trustedHtml = (s)=>s` or `import { trustedHtml } from './my-utils'` suppressed the gate;
**(b) prefix-only** — `trustedHtml("x") + product.code`, *even with the genuine `@kovojs/browser`
import*, whitelisted the raw `product.code` suffix into `<script>`. The same `call.name === 'trustedHtml'`
text check existed at `structural-jsx.ts:1363`. The hard-rule #9 kovo-check guard *excluded*
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

### P1-1 — `sanitizeNext` open-redirect via URL normalization (MEDIUM, FIXED)

**Defeated:** SPEC §6.5 — `next` MUST be a same-origin single-leading-slash path (no `//`),
re-validated, so login/redirect flows "cannot consume an open-redirect target".

**Mechanism.** `sanitizeNext` rejected raw `//`/`/\` inputs, then ran the value through
`new URL(next, base)` whose WHATWG normalization collapses `/..//evil.com` (and `/%2e%2e//evil.com`)
to pathname `//evil.com` while origin stays the base — both guards pass, and `//evil.com` is returned.
A base-less `Location: //evil.com` resolves cross-origin.

**Proof:** `sanitizeNext('/..//evil.com') === '//evil.com'`; `new URL('//evil.com','https://app').href === 'https://evil.com/'`.

**Fix (`f4dfbbc60`).** Re-apply the scheme-relative guard to the *normalized* path the Location header
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

- [ ] **F2 fix #1 — KV410 must require a `reads:` set on every opaque projection (SPEC §10.2).** Closes
  the residual CASE A (omitted-`reads:` raw-SQL-only secret leak). Exact change: `opaqueProjectionDiagnostics`
  (`query-shapes.ts`) suppresses KV410 only when `hasOutput && hasDeclaredReads`; pass
  `query.declaredReadExpressions.length > 0` from the call site (`static.ts`). **Blast radius
  (cross-package SPEC-conformance migration):** 8 drizzle unit tests (`index.query-shapes.test.ts` ×7,
  `index.serialization.test.ts` ×1) that encode the old "output-only is green" behavior, plus example
  opaque projections (`examples/crm/src/queries.ts:165` `pipelineByStage`) and conformance fixtures
  (`source-fixtures.ts` sql<T> fixtures) that must declare `reads:`. Land with all fixture/example
  updates + `acceptance`/`conformance` gate verification. (Tracked as `it.todo` CASE A in
  `confidentiality-folded-read-set.test.ts`.)
- [ ] **P3-1 — KV418 for mutations + a runtime "no ambient session" floor for `csrf:false` (HIGH).**
  KV418 is implemented only for endpoints (`graph-output.ts:880`); the compiler does **zero** csrf
  processing for mutations and there is no runtime floor, so a `csrf:false` mutation that reads
  `req.session`/runs a session guard rides the victim's ambient cookie — the unsound exemption §6.6/§9.1
  forbid. Fix: typed `csrf: 'checked'|'exempt'` posture on `MutationExplain` (`core/graph.ts`) + KV418
  for mutations + serve a `csrf:false` mutation with no ambient `req.session` (cookies uninterpreted).
  Folds in **P3-3** (surface the posture in `explain --endpoints`).
- [ ] **P2-1 / S4 — close the compile-time KV236 completeness gap for the primitive `attrs={{…}}` merge
  channel and static object-spread `style`.** Both currently rely on the sound runtime sink-policy floor
  (`decideRuntimeAttributeWrite` + `kovoStyleProperty`), so not exploitable, but they break the
  audit-visible-brand guarantee and leave a CSS-text-injection residual the direct form catches. Add the
  `style`/url-scheme/raw-HTML branches to `validateStaticSpreadEntries` and the primitive-merge attrs path.
- [ ] **S7-1 — make the §5.2 #3 render-equivalence gate honest.** It normalizes `escapeText(x) → x`
  before comparing (`render-equivalence.ts:495`), so a real encoder presence/absence asymmetry (the
  lowered pipeline double-escapes) is silently equated and the byte-identical claim is unproven. Remove
  the encoder-stripping normalization so the gate fails closed on encoder drift.
- [ ] **P0 — fold `productionRenderPlanGate` into the compile cache key (cheap, latent).** It is the one
  compile-affecting option dropped from `compileComponentCacheKeyInput`/`compileCacheKey`; it flips the
  prod KV435-missing-shape + KV416 gates. Currently unreachable (no build wires the gate), but the key
  should be a total function of compile-affecting inputs. Add a canonical projection of the option.

## Latest verification (in `agent/compiler-soundness-fixes` worktree)

- **F1:** `output-context-trusted-brand-identity.test.ts` 9/9 (legit single-call + aliased import
  suppress; shadow/foreign-import/undefined/concat/method-wrapper/style-shadow all fire KV236).
  `_adv-guard-coverage` proves the fixed file is clean under the hard-rule #9 guard and the guard would
  have flagged the old regex. **Full compiler suite: 682 passed** (the only failures, 4 in
  `package-styles.test.ts`, reproduce identically on clean source — environmental `@kovojs/ui`
  resolution in worktrees, not this change).
- **F2 fix #2:** `confidentiality-folded-read-set.test.ts` — CONTROL + CASE B + NEGATIVE pass, CASE A
  `it.todo` (follow-up). **Full drizzle suite: 429 passed, 1 todo, 0 failed.**
- **P1-1:** `guards.test.ts` 36/36 (incl. `/..//evil.com`, `/a/../..//evil.com`, `/%2e%2e//evil.com` → `/`).
  **Full server suite: 1005 tests passed** (2 test *files* fail to load on the `@node-rs/argon2` native
  binding — an `onlyBuiltDependencies` postinstall absent in the symlinked worktree, unrelated).
- **Not run in-session:** the broad `pnpm acceptance` / `conformance` gates (heavy; required before the
  F2 fix #1 migration). All changes live in the throwaway worktree; nothing landed on `main`.
