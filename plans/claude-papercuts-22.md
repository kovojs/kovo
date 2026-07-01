# Round-3 Papercuts 22

Created 2026-06-30. Source of truth remains `SPEC.md`. Papercuts from the THIRD (deeper + broader)
dogfood round, after the user fixed claude-bugz-22/23 + claude-papercuts-20/21. Confirmed
security/soundness defects are in `plans/claude-bugz-24.md` (B1 closure-read IDOR/secret-leak, B2
import-path XSS-gate bypass, B3 webhook captured-handle audit/idempotency escape, B4 destructured/chained
state alias frozen UI, B5 helper-alias client-derive ReferenceError).

**Meta-theme:** rounds 1–2 fixes mostly hold (the nested-`<Defer>` drain fix and the Reader
receiver-typing fix are COMPLETE bar one sibling each — see Refuted). The new survivors are a reopened
build-tooling OOM, a token-name CSS guard gap, two observability residuals, and the Testing API (§12)
on-ramp, which the last two rounds never exercised.

## Scope

Nine fresh SQLite `create-kovo` starters linked to the local monorepo, on the production node-preset
artifact. 5 deep fix-incompleteness tracks + 4 broad new surfaces (UI/theme/a11y, registry-dynamic,
islands, deploy-skew, testing API). Root causes confirmed first-hand in source; runtime symptoms
reproduced by independent skeptical verifiers with positive controls.

## Issues

### A. UI / theme

- [ ] **A1 — The full `kovo add` UI catalog (44 components) OOMs `kovo build` AND `vp check`: the build-check preflight globs the ENTIRE `src/` tree and runs several full-project ts-morph passes over every file, including unimported copied components.** (high, dev-tooling; found by `ui-theme-a11y`, verified independently; incomplete-fix residual of `papercuts-12` A2)
  - Observed behavior: after `kovo add` of all 44 UI components (a documented workflow), `tsc --noEmit` + sound-subset pass, but `build:prod` dies `FATAL ERROR: Reached heap limit — JS heap out of memory` (peak RSS ~4.4–4.8 GB) and `check` SIGABRTs. Bisect: 0 copied → 4.2s/1.16 GB; 10 → ~4.8 GB; 23 → OOM. The copied files are NOT imported by `app.tsx` yet are still analyzed.
  - Root cause: `packages/server/src/internal/data-plane-static-analysis.ts:214` `buildCheckSourceFiles = sourceFilesUnder(dirname(appModulePath))` recursively globs every `.ts/.tsx` under `src/` (unimported included); `staticDataPlaneBuildFacts` (~`:480-499`) runs several independent full-project ts-morph passes (query/sql-safety/toctou/touch-graph extractors) over that whole set, driven from `cli/src/commands/build-export.ts` (`buildCheckGraph` → `runKovoBuildCheckPreflight`). Memory grows O(n) per heavy-generic UI module (~360 MB/file); `check-parallel.mjs` sets no `--max-old-space-size`.
  - Why it matters: the documented full-catalog workflow still cannot clear the deploy gate (reopens `papercuts-12` A2, marked fixed 2026-06-28), with no actionable Kovo diagnostic, and the O(n)-over-unimported-files scaling also breaks `vp check`.
  - Repro evidence: `kovo add` all 44 → `tsc` clean → `build:prod` FATAL heap OOM exit 1; bisect 10 (builds) vs 23 (OOM); unimported components confirmed (app.tsx imports none of `components/ui`).
  - Acceptance: the build-check static analysis only walks files reachable from the app module (or unimported files are excluded/streamed), and/or the preflight bounds memory + emits a diagnostic instead of OOMing; the full `kovo add` catalog clears `build:prod` + `check`.

- [ ] **A2 — `defineTheme` custom color NAMES are emitted into the stylesheet with no CSS-name validation, so a name containing `}`/`{`/`:` closes the `:root` block early and injects arbitrary CSS (and drops every later theme var).** (med, framework; found by `ui-theme-a11y`, verified independently; residual of `bugz-4` L10)
  - Observed behavior: `defineTheme({ colors: { 'evil: red} body{display:none': '#047857' } })` builds GREEN and emits `--kovo-theme-custom-evil:-red}-body{display:none-color: #006b5e;` inside the `:root` block — the `}` ends the block, subsequent theme vars are lost, and a no-space payload injects a clean global rule. A malformed VALUE is correctly rejected; only the NAME path is unguarded.
  - Root cause: `packages/style/src/theme.ts:775-784` `themeVar`/`toKebabCase` only capital-split + `.replace(/[_\s]+/g,'-')` — no CSS-significant-char strip/escape; `customDeclarations` (`:700-712`) passes the raw user key. The sibling `style.defineVars`/`createTheme` paths in `engine.ts` (`:376-378`,`:435-436`) call `assertCssNameSafe`/`assertCssCustomPropertyNameSafe`, which `defineTheme` custom colors bypass.
  - Why it matters: a malformed/hostile token name silently corrupts the entire emitted stylesheet on a green build, breaking the framework's own consistent token-name fail-closed contract. (Not bugz: the name is author-controlled at build time, not runtime attacker input — a robustness/consistency footgun.)
  - Repro evidence: `defineTheme` color key `'evil: red} body{display:none'` → green build; `dist/.../styles.css` contains the raw `}`/`{` inside `:root`. Source: `theme.ts:775-784,700-712` vs guarded `engine.ts:376-378,435-436,615,655-666`.
  - Acceptance: `defineTheme` custom color names route through the same `assertCssCustomPropertyNameSafe` guard as `defineVars`/`createTheme` (fail closed on CSS-significant chars).

### B. Observability residuals

- [ ] **B1 — A webhook handler exception is a silent 500 on the default config — nothing on stdout/stderr.** (low, framework; found by `endpoint-webhook-deep`, verified independently; residual of `claude-papercuts-21` D1 / `super-10` D1)
  - Observed behavior: a webhook handler that throws returns a 500 but the prod server log shows only the "listening" line. The D1 fix (logging at the node `createServer` boundary for ESCAPING errors) does not cover framework-caught webhook/endpoint/mutation/query handler throws; the starter wires no `onError`.
  - Root cause: handler throws are caught and routed through `reportServerError(app.onError, …)` (`app-request.ts`), and `diagnostics.ts:42-47` `if (!onError) return;` has no default stderr fallback; `logUnhandledNodeError` only fires for escaping errors.
  - Why it matters: the most common 500 cause still emits nothing on the default config — the same class as super-10 D1, on the webhook/handler path.
  - Repro evidence: throwing webhook → 500; log shows only "listening".
  - Acceptance: a default-config handler throw logs to stderr (framework default `onError` or a `reportServerError` stderr fallback).

- [ ] **B2 — A throwing or timed-out `<Defer>` region's exception is silently swallowed: `onError` never fires and nothing is logged (dev or prod).** (low, framework; found by `defer-deep`, verified independently)
  - Observed behavior: the nested-`<Defer>` DRAIN fix is COMPLETE (nested/triple/loop regions stream, per-region isolation + timeout work — all verified). But when a Defer region throws or times out, the framework renders the error/timeout placeholder WITHOUT invoking `onError` or logging the underlying exception, so the operator never sees the cause.
  - Root cause: the deferred-region settle path (`deferred-stream.ts`/`deferred-region.ts`) handles a region rejection by emitting the region's error state but does not route the error through `reportServerError`/`onError` (same swallow class as super-5 B3 / super-10 D1 for the deferred branch).
  - Why it matters: a per-region isolation feature (correctly contains the failure) hides the failure entirely — a stranded/errored region is invisible to logs.
  - Repro evidence: a `<Defer>` whose loader throws → page renders the error placeholder; server stderr has no error line and `onError` is not called.
  - Acceptance: a Defer region rejection/timeout is reported through `onError`/stderr (the region still isolates visually, but the cause is logged).

### C. Schema

- [ ] **C1 — `schemaMaxUploadBytes` ignores array multiplicity, so a multi-file `s.array(s.file().maxBytes(N))` upload still hits a bare pre-validation 413.** (low, framework; found by `schema-sql-deep`; residual of `papercuts-super-6` B2)
  - Observed behavior: the per-field `s.file().maxBytes(N)` is not multiplied by array length when computing the body-size pre-check, so a legitimate multi-file upload under the per-file limit is rejected with a bare 413 before validation. [VERIFIER CAVEAT: the verifier agent failed structured output for this candidate; the author repro + the cited source mechanism are recorded, but this item is author-reported, not independently re-verified — treat as needs-verification.]
  - Root cause: `packages/server/src/schema.ts` `schemaMaxUploadBytes` sums field maxBytes without accounting for `s.array(...)` multiplicity (residual of the super-6 B2 fix for object fields).
  - Why it matters: multi-file uploads silently hit a 413 the per-file limit did not advertise.
  - Repro evidence: author-reported — `s.array(s.file().maxBytes(N))` of K files totaling < K·N → 413. (Re-verify before fixing.)
  - Acceptance: `schemaMaxUploadBytes` multiplies an array-of-files field's per-file cap by a bounded array length (or documents the aggregate cap).

### D. Testing API (§12) — new surface, never previously dogfooded

- [ ] **D1 — `@kovojs/test` is not a `create-kovo` starter dependency, so the documented browser-free Testing API is unreachable out of the box.** (med, template; found by `testing-api`, verified independently; new)
  - Observed behavior: `grep @kovojs/test package.json` → absent; `import('@kovojs/test/harness')` → `ERR_MODULE_NOT_FOUND`; `node_modules/@kovojs/` has no `test`. The starter's `app.test.ts` hand-rolls vitest with `requestHandler`/`createAppDb` imports and never uses the harness, while `site/content/guides/testing.md` instructs importing `createKovoTestHarness`/`assertMutationError`/`propertyTest`/`createPgliteTestDb` from `@kovojs/test/*` with no install step.
  - Root cause: `packages/create-kovo/templates/package.json` devDependencies omit `@kovojs/test`; SPEC §12 delegates harness guidance to the guide, but the scaffold ships a divergent pattern and no on-ramp.
  - Why it matters: the headline documented testing path is unreachable from a fresh scaffold with no install hint.
  - Repro evidence: `grep @kovojs/test package.json` (none); `import('@kovojs/test/harness')` → `ERR_MODULE_NOT_FOUND`; `ls node_modules/@kovojs` (no `test`).
  - Acceptance: the starter declares `@kovojs/test` in devDependencies and ships a harness-based example test (or the guide gives an install step).

- [ ] **D2 — `harness.exec(mutation, input)` cannot test a real default-CSRF mutation: the `csrf` exec knob is both type-forbidden (`{csrf:false}` is a `TS2322`) and runtime-shadowed (the per-exec override is only consulted when the mutation declares NO csrf).** (med, framework; found by `testing-api`, verified independently; new)
  - Observed behavior: `harness.exec(addContact, {...})` → `{error:{code:'CSRF'},ok:false,status:422}` (handler never runs); `{csrf:false}` → `TS2322: Type 'boolean' is not assignable to CsrfOptions`; `csrf:false as never` still returns CSRF 422. The starter's own `addContact` declares `csrf: appCsrf`, so the exec csrf knob is structurally dead.
  - Root cause: `packages/test/src/harness.ts:104` types `KovoTestExecOptions.csrf` as `CsrfValidationOptions<Request>` with no `| false`; `packages/server/src/csrf.ts:349-350` `mutationCsrfOptions` returns `definition.csrf ?? defaultOptions` (consumed at `mutation.ts:408`), so the per-exec override applies only when the mutation declares no csrf. The intended seam exists only internally (`commerce-fixtures.ts commerceCsrfInput`), and the framework's own harness tests sidestep it with `csrf:false` on the definition.
  - Why it matters: an author cannot use `harness.exec` to test the default-CSRF mutations they actually ship — the documented unit path doesn't reach the handler. (Fails closed — no security hole — but a real DX wall.)
  - Repro evidence: vitest → CSRF 422 (even `csrf:false as never`); `tsc` → `TS2322` on `{csrf:false}`. Source `harness.ts:104`, `csrf.ts:349-350`, `mutation.ts:408`.
  - Acceptance: `harness.exec` can run a default-CSRF mutation handler — mint/inject a valid token automatically (or accept `{csrf:false}` AND invert `mutationCsrfOptions` precedence so the exec override wins), with a documented example.

- [ ] **D3 — The testing guide's flagship "the commerce reference app's own test shape" proof uses zero `createKovoTestHarness`/touch-graph harness APIs.** (low, docs; found by `testing-api`, verified independently; new)
  - Observed behavior: the guide presents the commerce app's tests as the canonical Testing-API proof, but those tests hand-roll vitest and never call the documented harness/touch-graph surface.
  - Root cause: docs/guide-vs-example divergence (`site/content/guides/testing.md` vs `examples/commerce`).
  - Why it matters: the flagship proof doesn't demonstrate the API it documents, undermining the §12 on-ramp.
  - Acceptance: the guide's reference proof uses the actual harness API, or the claim is corrected.

- [ ] **D4 — The testing guide documents only `createPgliteTestDb`; `createSqliteTestDb` is undocumented for the SQLite starter.** (low, docs; found by `testing-api`, verified independently; new)
  - Observed behavior: the SQLite starter author has no documented test-db factory; the guide only shows the PGlite one.
  - Acceptance: document `createSqliteTestDb` (or a dialect-agnostic factory) for the SQLite starter.

## Refuted / Not Carried Forward

Encouraging — the round-1/2 fixes largely HOLD, verified this round:

- **Nested-`<Defer>` drain fix (claude-papercuts-21 A1) is COMPLETE:** singly-, triply-nested, Defer-in-`.map()`-loop, throwing inner region (per-region isolation), and hung inner region (per-region timeout) all REFUTED as working. Only the swallowed-exception-not-logged residual (B2) survives.
- **Reader receiver-typing fix (claude-bugz-23 B1) is COMPLETE for receiver identity:** inline `!`, destructure, optional-chain, ternary, nullish, inferred/annotated/aliased helpers, module-scope `Reader<AppDb>` helpers, and `.map` iteration reads all now fire KV407/KV310. Only the closure call-site residual (bugz-24 B1) survives.
- Islands inert in prod (super-6 A1/super-7 A1) + two-island state (super-7 A2/bugz-14 B3) + KV417 island-deploy retention (super-8 A1) fixes HOLD.
- `trustedHtml`/`trustedUrl` wire-JSON forge (bugz.md H6) blocked; the §4.10 registry allowlist is NOT escapable by a client/LLM-controlled component name; `renderTree` renders stored rich text correctly (no `[object Promise]`, no corruption); `s.string().optional()/.default()` + `s.number().optional()` work.
- UI scalar double-escape / raw-children XSS (bugz-3 M7, bugz-4 M15), command/listbox dangling `aria-activedescendant` + duplicate ids (bugz-3 M13/L17), enumerated ARIA boolean SSR (super-7 E1), `kovo add` copy-in correctness (formatter/deps/tsc) — all FIXED.
- Webhook `recordChange` undeclared-domain smuggle via alias/helper (claude-bugz-23 B4) is blocked; HEAD-on-GET endpoint (claude-papercuts-21 D2) fixed; L15/L16 endpoint CSRF, response-posture prod-vs-dev divergence, §7 events, static-export asset/CSP floor, KV417 framework-module exemption, `s.file().accept` siblings (array/object/optional) sniff correctly, KV422 tagged-template alias-blindness (claude-papercuts-20 B5) — all REFUTED as fixed/expected/sound.
- `schema-sql-deep-1` (s.file accept matches only ~7 sniffable MIME types → CSV/JSON/SVG/Office rejected): refuted as by-design (sniffable-types-only) rather than a defect.
- Testing harness does NOT give false confidence (it catches an introduced IDOR/stale binding); `propertyTest`, `assertMutationError`, `page().fragment()`, integration `boot-fixture`/`semantic-snapshot` work.

## Latest Verification

- Fresh SQLite baseline on the fixed framework: `check`/`build:prod` green (build 21.5s).
- bugz-24 B1 + B2 self-verified by isolation/import flips (see `claude-bugz-24.md`).
- Source confirmations: `data-plane-static-analysis.ts:214,480-499` (A1), `theme.ts:775-784,700-712` vs `engine.ts` (A2), `diagnostics.ts:42-47` (B1), `harness.ts:104`+`csrf.ts:349-350` (D2), template `package.json` + `testing.md` (D1).
- Monorepo repaired (`pnpm install` at root); `git status` shows only the new `plans/claude-*.md` ledgers; stray servers killed. Throwaway apps under `/Users/mini/kovo-dogfood-round3/` — safe to delete (do not re-run `pnpm install` in them without isolation).
