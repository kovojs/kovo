# API DevEx Fixes — verified spec↔impl & structural gaps

Remediation ledger for the six highest-confidence findings from `plans/api-devex.md`, each
**directly verified against source** (not just inferred from the audit). Three are
security/correctness spec↔impl contradictions, one is a spec↔example mismatch, two are
packaging/structure cleanups.

- **Source of truth:** `SPEC.md` governs intended behavior. The four ship-vs-amend calls were
  **decided 2026-06-19** (recorded per item); the chosen direction is "implement to spec" in 3 of
  4, so SPEC stays authoritative and the code moves to it.
- **Rule dependencies:** compiler/codegen edits follow `rules/compiler-hard-rules.md`;
  public-export edits follow `rules/api-surface.md` (and the `check:api-surface` /
  `public-packages.test.mjs` gates). Items 1–3 touch the compiler; 2/3/5/6 touch the public
  surface.
- **Status:** all items open. Mark `[x]` only when this repo verifies the cited test/command in
  the same session (per `CLAUDE.md`). Shared gates: [Latest verification](#latest-verification).

**Sequencing:** **2 → 3** (3 reuses 2's column-selector codegen), with **1** independent and
landable in parallel, then **4 → 5 → 6** (cleanups). **3 is the heaviest** (net-new security
feature on a blocking gate) and may be split into its own sub-plan.

---

## 1. Ship `trustedUrl` — security escape hatch — **High** · Decided: **Ship**

**Gap (verified):** SPEC defines a *pair* `trustedHtml`/`trustedUrl` as the only KV236 suppressor,
incl. URL-scheme attributes (`SPEC.md:355`, `SPEC.md:1264`). Only `trustedHtml` exists
(`packages/browser/src/security-output.ts:34`); `trustedUrl` is exported nowhere. `kovoSafeUrl`
(`security-output.ts:85`) rewrites unsafe-scheme URLs to `'#'` with no author opt-out, so a
legitimately-trusted dynamic `data:`/custom-scheme URL is undismissable.

**Decided 2026-06-19 — Ship:** cheap (mirrors existing `trustedHtml`), spec-committed, mirrors
Trusted Types' `TrustedHTML`/`TrustedScriptURL` split, and closes a no-recourse dead-end on a
security sink.

- [ ] **Runtime:** add `trustedUrl(value: string): TrustedUrl` branding `__kovoTrustedUrl: true`
      in `security-output.ts`, beside `trustedHtml`; export from the `@kovojs/browser` public
      barrel (mirror `trustedHtml`'s entrypoints).
- [ ] **Sanitizer:** make `kovoSafeUrl` pass a `trustedUrl`-branded value through unchanged
      instead of rewriting to `'#'`.
- [ ] **Compiler (KV236):** suppress KV236 for URL-scheme sinks
      (`href`/`src`/`action`/`formaction`/`xlink:href`/`ping`/`poster`/CSS `url()`) when the
      lowered binding value is `trustedUrl`-branded; the brand must be author-written, never
      compiler-derived (mirror `trustedHtml`). Follow `rules/compiler-hard-rules.md`.
- [ ] **Tests:** (a) a `trustedUrl`-branded value reaches an `href` with **no** KV236 and **no**
      `'#'` rewrite; (b) the same unbranded value is still KV236 + sanitized. Add to
      `packages/compiler/src/output-context-*.test.ts`.

## 2. drizzle `key` accepts a column selector `(t) => t.id` — **High** · Decided: **Ship selector**

**Gap (verified):** SPEC §10.1 shows `key: (t) => t.id` (`SPEC.md:968`); impl types it `key?: string`
(`packages/drizzle/src/drizzle-surface.ts:29,46`); all examples use the string. String keys aren't
checked against columns and break silently on rename. `kovo()` already returns a Drizzle
extra-config callback that receives the table, so the typed columns object is available.

**Decided 2026-06-19 — Ship the selector:** spec-conformant + Drizzle-idiomatic + strictly better
ergonomics (type-safe, rename-safe, autocomplete). **Land before #3** (shared mechanism).

- [x] **Public type:** added `export type KovoColumnRef = string | ((table: Record<string, unknown>)
      => unknown)` (documented) and widened `key` on `KovoTableAnnotation`/`KovoDomainTableAnnotation`
      and `via` on `KovoFanAnnotation` to it (`packages/drizzle/src/drizzle-surface.ts`). All
      supporting types public; api-surface gate stays at baseline 1571.
- [x] **Codegen:** added `columnRefName` + `columnNamePropertyFromObject` in
      `packages/drizzle/src/static.ts` (handles string literal, `(t) => t.col`, block-body, and
      `t['col']` bracket forms) and routed `key` + fan `via` extraction through it. Downstream
      consumes the resolved column **name string** unchanged — this is the reusable selector seam #3
      reuses for `owner:`.
- [x] **Examples:** migrated all 3 example schemas (commerce/crm/stackoverflow, 9 sites) to
      `key: (t) => t.id`. `site/gen/api/drizzle.md` regenerates from the updated `kovo` `@example`
      (now selector form) — verified by the `@example` gate.
- [x] **Tests:** new `packages/drizzle/src/index.key-selector.test.ts` — a selector-keyed read
      derives the **same `instanceKey` (`arg:cartId`)** as the string form (full query-fact parity),
      plus block-body + bracket-access variants. **Note:** TS-level rename-safety isn't achievable
      for the SPEC `kovo({ key: (t) => t.id })` shape (kovo can't infer the table type, so `t` is a
      permissive record); the column is resolved **statically by the compiler**, so the selector is
      at parity with the string form. A column-existence diagnostic (true rename-error) is a possible
      follow-up, not added here.

  **Verified:** `vitest run packages/drizzle` 261 pass (string regression) + new selector test 2/2;
  example graph/invalidation tests (`crm/graph`, `stackoverflow/kovo-graph`, `commerce/app.add-to-cart`,
  `commerce/app.queries`) 13/13 with the migrated selector schemas; `api-surface-gate.mjs` exit 0;
  `@kovojs/site api:check` 37 @example blocks typecheck; `vp check` typecheck clean (the only `vp check`
  failure is pre-existing formatting drift on 21 base files; my files reformatted clean).

## 3. Build the SPEC ownership model (`owner:` + `owns()` + KV414) — **High** · Decided: **Build full model** → split to sub-plan

Net-new security feature: the SPEC §10.1/§10.3 ownership/IDOR model (`owner:` annotation,
`owns()` combinator, `ownerColumn`, KV414 as an enforced gate) is **spec-only** today; what ships
is an app-level `ownerDomains` audit. Too large for this ledger — **tracked in
[`plans/ownership-idor.md`](./ownership-idor.md)**.

Decisions locked 2026-06-19: replace `ownerDomains` with the per-table `owner:` annotation as the
sole source; `owns()` lives in `@kovojs/server` guards. **Depends on item 2** (column-selector
codegen) landing first. See the sub-plan for the phased checklist and the multi-table-domain
expressibility risk.

- [ ] Execute `plans/ownership-idor.md` (Phases 0–5).

## 4. Make `kovoTest` `options` optional / add `configure()` — **Low–Med** · Decided: **Change the signature**

**Gap (verified):** SPEC §12 calls `kovoTest('cart mutations', async ({exec,page,db}) => {…})` with
two args (`SPEC.md:1336`); the shipped function requires a third positional `options`
(`packages/test/src/test-case.ts:27`). The manual `it(case.name, case.run)` step *is* in the spec
(`SPEC.md:1356`), so only the missing `options` arg diverges.

**Decided 2026-06-19 — change the code so `kovoTest(name, fn)` works.** Bonus: this makes the SPEC
§12 two-arg snippet compile **as written**, so no spec edit is needed.

- [x] **Mechanism: `kovoTest.configure(options)`** (the zero-config-default path is unsound — the
      harness `db` is genuinely required). `configure` binds the harness once and returns a typed
      `test(name, fn, runner?)`; the bare `options` arg is now optional so `kovoTest(name, fn)` is
      also a legal call. Both keep full back-compat with the existing 3-arg callers.
- [x] **Implemented** in `packages/test/src/test-case.ts` (added `configure`, made `options?`
      optional; `createKovoTestHarness` called with `options ?? {}`). Guide
      `site/content/guides/testing.md` updated to the `kovoTest.configure(...)` per-case form.
- [x] **Verified:** `vitest run packages/test/src/test-case.test.ts` 4/4 (back-compat); `vp check`
      typecheck clean (no errors in `test-case.ts`/`harness.ts`); `api-surface-gate.mjs` exit 0
      (baseline 1571 — `configure` is documented, no new undocumented export); `@kovojs/site`
      `api:check` green (37 @example blocks typecheck). **SPEC.md left unchanged** (per the
      decision): the bare 2-arg `kovoTest(name, fn)` call now compiles; the *typed* per-case
      ergonomic form is `kovoTest.configure(opts)` (a fully-typed `ctx` needs `options`, so the
      typed body uses `configure`, demonstrated in the guide). §12 result-shape finding stays in
      `plans/api-devex.md`.

## 5. Drop the empty `@kovojs/headless-ui` `.` barrel — **Low (packaging)** · no decision

**Gap (verified):** `packages/headless-ui/src/index.ts` is `export {};` and `package.json` maps
`.` → it, so a bare `import … from '@kovojs/headless-ui'` resolves to an empty module with no hint
to use the per-primitive subpaths (Radix ships no root barrel at all).

- [x] Removed `.` from `packages/headless-ui/package.json` `exports` + `publishConfig.exports` +
      `build:dist`, dropped `.` from `public-packages.json` headless-ui `apiBoundary.public`, and
      deleted the empty `src/index.ts`. No consumer imports the root `.` (grep over
      packages/examples/site found none).
- [x] Green: `vitest run scripts/public-packages.test.mjs scripts/api-surface-gate.test.mjs`
      (17 pass), `api-surface-gate.mjs` + `exported-symbols.mjs --duplicates --check` exit 0, and
      `pnpm --filter @kovojs/headless-ui build:dist` builds 154 files with no `dist/index.*`.
      (`import-boundary.mjs` fails pre-existing on the base commit — unrelated
      `site/scripts/export-static.mjs` → `@kovojs/compiler/package-styles`.)

## 6. Move `@kovojs/better-auth` public API out of `internal.ts` — **Low (maintainer legibility)** · no decision

**Gap (verified):** `packages/better-auth/src/index.ts` re-exports all 13 public symbols
`from './internal.js'`, intermixed with ~65 `@internal` symbols — the public/internal line is
invisible at the source. Consumer imports are unaffected (pure refactor).

- [ ] Move the 13 public declarations (`authed`, `betterAuthSession`, the 3 sign-in/up/out
      mutations, `mount`, `role`, + 6 public types) into named files (e.g. `session.ts`,
      `mutations.ts`, `guards.ts`, `mount.ts`); keep `internal.ts` for the `@internal` machinery;
      `index.ts` re-exports from the named files.
- [ ] Verify the public surface is byte-identical: `pnpm run check:api-surface`,
      `@kovojs/better-auth` tests, and build pass with no surface diff.

---

## Latest verification

_(none yet — populate when items land; keep to the shortest proof per checkbox.)_

Shared gates before any checkpoint touching these: `pnpm run check:api-surface` ·
`public-packages.test.mjs` · focused package tests (`@kovojs/browser`, `@kovojs/drizzle`,
`@kovojs/test`, `@kovojs/better-auth`, `@kovojs/headless-ui`) · compiler output-context + IDOR/
unscoped audit suites (items 1, 3) · `git diff --check`.

## Risks / notes

- **Item 3 is a net-new security feature on a blocking gate (KV414)**, not a small fix: new
  `owns()` combinator, new `owner:` annotation, audit rewiring, and a reference-app migration.
  Add red→green tests; don't loosen existing KV414/KV407/KV411 coverage. Split to its own sub-plan
  if it grows. Confirm no differently-named ownership guard already ships before building `owns()`.
- **Item 2 precedes item 3** — 3's `owner:` annotation reuses 2's column-selector codegen seam.
- **Item 1** (KV236 suppression) is an independent compiler-hard-rule change; landable in parallel.
- **Item 4** is a code change (default harness / `configure()`); chosen partly because it makes the
  SPEC §12 snippet self-consistent with no spec edit.
- **Items 5–6** are non-breaking cleanups (packaging key removal; internal file reorg) with no
  consumer-facing surface change.
