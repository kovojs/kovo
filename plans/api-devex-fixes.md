# API DevEx Fixes — verified spec↔impl & structural gaps

Remediation ledger for the six highest-confidence findings from `plans/api-devex.md`, each
**directly verified against source** (not just inferred from the audit). Three are
security/correctness spec↔impl contradictions, one is a spec↔example mismatch, two are
packaging/structure cleanups.

- **Source of truth:** `SPEC.md` governs intended behavior. Where code and SPEC disagree, the
  fix is *either* implement to spec *or* amend the spec — each item below carries an explicit
  **Decision** checkbox; do not code through the conflict without resolving it.
- **Rule dependencies:** compiler/codegen edits follow `rules/compiler-hard-rules.md`;
  public-export edits follow `rules/api-surface.md` (and the `check:api-surface` /
  `public-packages.test.mjs` gates). Items 1–3 touch the compiler; 2/3/5/6 touch the public
  surface.
- **Status:** all items open. Mark `[x]` only when this repo verifies the cited test/command in
  the same session (per `CLAUDE.md` progress discipline). Shared gates are in
  [Latest verification](#latest-verification).

Suggested order: 1 → 3 → 2 (security/correctness first; 2 and 3 share the column-selector
mechanism) → 4 → 5 → 6.

---

## 1. Ship `trustedUrl` (or strike it from SPEC) — security escape hatch — **High**

**Gap (verified):** SPEC defines a *pair* `trustedHtml(value)` / `trustedUrl(value)` as the only
KV236 suppressor, including for URL-scheme attributes (`SPEC.md:355`, `SPEC.md:1264`). Only
`trustedHtml` exists (`packages/browser/src/security-output.ts:34`); `trustedUrl` is exported
nowhere (`grep -rn trustedUrl packages` → none; 3 SPEC hits). The runtime URL sanitizer
`kovoSafeUrl` (`security-output.ts:85`) rewrites unsafe-scheme URLs to `'#'` with **no author
opt-out** — so a legitimately-trusted `data:`/custom-scheme URL is undismissable.

- [ ] **Decision:** ship `trustedUrl`, or remove `trustedUrl` from SPEC §4.8/§5.2 #10/KV236 and
      document that URL-scheme trust is deferred. (Security-critical path — needs an owner call.)
- [ ] **If shipping — runtime:** add `trustedUrl(value: string): TrustedUrl` branding
      `__kovoTrustedUrl: true` in `security-output.ts`, beside `trustedHtml`; export from the
      `@kovojs/browser` public barrel (mirror `trustedHtml`'s entrypoints).
- [ ] **If shipping — sanitizer:** make `kovoSafeUrl` pass a `trustedUrl`-branded value through
      unchanged instead of rewriting to `'#'`.
- [ ] **If shipping — compiler (KV236):** suppress KV236 for URL-scheme attribute sinks
      (`href`/`src`/`action`/`formaction`/`xlink:href`/`ping`/`poster`/CSS `url()`) when the
      lowered binding value is `trustedUrl`-branded; brand must be author-written, never
      compiler-derived (mirror `trustedHtml`). Follow `rules/compiler-hard-rules.md`.
- [ ] **If shipping — tests:** (a) a `trustedUrl`-branded value reaches an `href` with **no**
      KV236 and **no** `'#'` rewrite; (b) the same unbranded value is still KV236 +
      `kovoSafeUrl`-sanitized. Add to the compiler output-context suite
      (`packages/compiler/src/output-context-*.test.ts`).
- [ ] **If striking:** delete the `trustedUrl` references from `SPEC.md:355`, the §5.2 #10
      contract, and the KV236 row (`SPEC.md:1264`); record the deferral in SPEC and in
      `plans/api-devex.md`.

## 2. drizzle `key` accepts a column selector `(t) => t.id` (or amend SPEC + add a key check) — **High**

**Gap (verified):** SPEC §10.1 shows `kovo({ domain: 'product', key: (t) => t.id })`
(`SPEC.md:968`); the impl types it `key?: string` in both `KovoTableAnnotation` and
`KovoDomainTableAnnotation` (`packages/drizzle/src/drizzle-surface.ts:29,46`); all three example
schemas use the string form (`examples/*/src/schema.ts`). String keys are not checked against the
table's columns and silently break on column rename — the opposite of Drizzle's `(t)=>t.col`
rename-safety. `kovo()` already returns a Drizzle extra-config callback that receives the table,
so the typed columns object is available at that seam.

- [ ] **Decision:** accept the `(t) => t.col` selector (recommended, matches SPEC §10.1 + Drizzle
      idiom), or amend SPEC to the string form **and** add a compile-time diagnostic validating
      the key string against the table's real columns.
- [ ] **If selector — public type:** widen `key` on `KovoTableAnnotation`/`KovoDomainTableAnnotation`
      to accept a column selector (optionally `| string` for back-compat). Keep all supporting
      types public per `rules/api-surface.md` (no internal type leak into the signature).
- [ ] **If selector — codegen:** resolve the selected column's name at extraction
      (`packages/drizzle/src/static.ts` / `internal/derive-codegen`) so the generated reverse
      index / `DomainKey` / key extractor read the column the selector returns.
- [ ] **If selector — examples + docs:** migrate the 3 example schemas to `key: (t) => t.id`;
      refresh `site/gen/api/drizzle.md`.
- [ ] **Tests:** a selector-keyed table generates the same key extractor as the string form did;
      a stale/renamed column selector is a type error (or diagnostic). Extend the drizzle
      extraction tests.

## 3. drizzle `owner:` table annotation + one ownership path (or amend SPEC) — **High**

**Gap (verified):** SPEC §10.1 defines `kovo({ domain: 'cart', owner: (t) => t.userId })`
(`SPEC.md:972`) and wires it into the **blocking** KV414 IDOR audit, the `owns()` combinator, and
`--unscoped` (`SPEC.md:1069,1087,1297`). The annotation type has **no `owner` field**
(`drizzle-surface.ts`); ownership is instead declared via a separate app-level string path
`createApp({ ownerDomains: [{ domain: 'user', owner: 'session.user.id' }] })`
(`examples/reference/src/app.ts:218`). Two inconsistent mechanisms; the spec's column-selector
one is unimplemented. (Not verified: whether KV414 currently fires through `ownerDomains` — the
audit may function via that path; this item resolves the contradiction + duplication, not a known
audit break.)

- [ ] **Decision:** add the table-level `owner: (t) => t.col` annotation (recommended) and define
      its relationship to `ownerDomains` (deprecate the app-level string path, or specify
      precedence) — **or** strike `owner:` from SPEC §10.1 and standardize on `ownerDomains`,
      updating KV414/`owns()`/§10.3 wording to match.
- [ ] **If adding — public type:** add `owner?: (t) => Column` to the domain annotation (shares
      the item-2 selector mechanism).
- [ ] **If adding — audit wiring:** confirm/route KV414, `owns()`, and `kovo explain --unscoped`
      to read the table `owner:` annotation per SPEC §10.3/§11.2 (compiler + server). Follow
      `rules/compiler-hard-rules.md`.
- [ ] **If adding — reconcile paths:** migrate `examples/reference` off `ownerDomains` (or
      document the precedence); update `site/gen/api/drizzle.md`.
- [ ] **Tests:** a query/write keyed into an `owner:`-annotated table without a session-traceable
      key or `owns()` guard fails KV414; an `owns()`-guarded one passes. Extend the IDOR/unscoped
      audit suite.

## 4. Reconcile `kovoTest` signature with SPEC §12 — **Low–Med (likely a doc fix)**

**Gap (verified):** SPEC §12 calls `kovoTest('cart mutations', async ({exec,page,db}) => {…})`
with **two** args (`SPEC.md:1336`); the shipped function requires a third positional `options`
(`packages/test/src/test-case.ts:27`). The manual `it(case.name, case.run)` step *is* in the spec
(`SPEC.md:1356`), so that is not a divergence — only the missing `options` arg is. The harness
genuinely needs config, so the spec snippet (not the code) is the likely thing to fix.

- [ ] **Decision:** update the SPEC §12 snippet to pass `options` (recommended, cheapest), or make
      `options` optional with sensible defaults / a `kovoTest.configure(options)` form so
      `kovoTest(name, fn)` compiles as written.
- [ ] **Apply** the chosen change (edit `SPEC.md:1336` or `test-case.ts`), keeping the `@example`
      typecheck gate green.
- [ ] **Note (out of scope, related):** SPEC §12's `res.queries.*` / `res.error.code` /
      `html.fragment()` result shapes vs `createKovoTestHarness`'s actual return are a separate
      `plans/api-devex.md` (M) finding — reconcile there, not here.

## 5. Drop the empty `@kovojs/headless-ui` `.` barrel — **Low (packaging)**

**Gap (verified):** `packages/headless-ui/src/index.ts` is `export {};` and `package.json` maps
`.` → it, so a bare `import … from '@kovojs/headless-ui'` resolves to an empty module with no
hint to use the per-primitive subpaths (Radix ships no root barrel at all).

- [ ] Remove the `.` entry from `packages/headless-ui/package.json#exports` (and delete/repurpose
      `src/index.ts`); confirm no consumer imports the root `.` (the audit found it empty).
- [ ] Verify `pnpm run check:api-surface`, `public-packages.test.mjs`, and the build still pass,
      and that `@kovojs/ui` + examples only import per-primitive subpaths. Follow
      `rules/api-surface.md`.

## 6. Move `@kovojs/better-auth` public API out of `internal.ts` — **Low (maintainer legibility)**

**Gap (verified):** `packages/better-auth/src/index.ts` re-exports all 13 public symbols
`from './internal.js'`, where they sit intermixed with ~65 `@internal` schema-bridge symbols —
the public/internal line is invisible at the source and the file name misdescribes its contents.
Consumer-facing imports are unaffected (pure refactor).

- [ ] Move the 13 public declarations (`authed`, `betterAuthSession`, the 3 sign-in/up/out
      mutations, `mount`, `role`, + 6 public types) into named source files (e.g. `session.ts`,
      `mutations.ts`, `guards.ts`, `mount.ts`); keep `internal.ts` (or `internal/`) for the
      `@internal` machinery; `index.ts` re-exports from the named files.
- [ ] Verify the public surface is byte-identical: `pnpm run check:api-surface`,
      `@kovojs/better-auth` tests, and build pass with no surface diff.

---

## Latest verification

_(none yet — populate when items land; keep to the shortest proof per checkbox.)_

Shared gates to run before any checkpoint that touches these:
`pnpm run check:api-surface` · `public-packages.test.mjs` · the focused package tests
(`@kovojs/browser`, `@kovojs/drizzle`, `@kovojs/test`, `@kovojs/better-auth`, `@kovojs/headless-ui`)
· compiler output-context suite (items 1, 3) · `git diff --check`.

## Risks / notes

- Items 1–3 require **product decisions** (implement vs amend spec) before coding; they are
  security/correctness-relevant, so route the decision explicitly rather than defaulting.
- Items 2 and 3 share the column-selector codegen mechanism — do 2 first, then 3 reuses it.
- Item 1 (KV236 suppression) and item 3 (KV414 wiring) are compiler-hard-rule changes — expect
  fixture/gate churn; add red→green tests, don't loosen existing KV236/KV414 coverage.
- None of these are pure renames, so the STABILITY.md deprecation-cycle concern (from the broader
  `api-devex.md` rename set) does not apply here — these are additive (1–3), a doc/signature
  reconciliation (4), or non-breaking structure cleanups (5–6).
