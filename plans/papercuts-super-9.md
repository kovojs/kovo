# Papercuts Super 9

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the **default
postgres (PGlite-backed) `create-kovo` template** with five tracks (concurrency/idempotency,
build cache/determinism, the raw-SQL escape-hatch surface, config/env/secrets, and nested
routing), each authored as a real app and adversarially verified. Baseline confirmed on clean
`main`: a fresh scaffold passes `pnpm run check` and the prod enhanced-mutation success body now
works end-to-end (the earlier `bugz-16`/super-8 B2 report was a WIP-tree artifact; it is fixed on
`main`).

**Meta-theme — the raw-SQL escape hatch is a trap: the safe form is unusable, and the unsafe
form is ungated.** Kovo's own `sql`/`staticSql`/`sql.identifier` constructors return brand-only
types that erase Drizzle's `SQL` type and lack a `<T>` parameter, so they fit _no_ Drizzle sink —
including `db.execute()` (§B). That pushes authors onto drizzle-native `sql` + `db.execute(...)` —
which the static analyzer classifies as `UNCLASSIFIED`, so a raw-SQL write contributes no
write/owner facts and the KV414 (IDOR) / KV438 (mass-assignment) gates silently pass (escalated to
`bugz-20` B1). The remaining findings are real but lower-stakes: the prod build is non-hermetic and
byte-nondeterministic (§C), an idempotency status code disagrees with SPEC (§A), and SPEC §6.4's
typed param-dependent route `meta` callback is unwired (§D).

**Security/soundness escalated to `plans/bugz-20.md`** (3 items): B1 — raw `db.execute` write
bypasses KV414/KV438 (fail-open IDOR/mass-assignment); B2 — no-JS idempotency replay omits the body
fingerprint → silent lost-update; B3 — the scaffold ships Better Auth credential tables unclassified
→ `account.password` ships to the wire.

## Scope

- Apps: five fresh `create-kovo` **default postgres** scaffolds + a baseline app, link-local to the
  monorepo, under `/Users/mini/kovo-dogfood-pg9-20260629/` (+ `/Users/mini/kovo-dogfood-pg9-base`).
  Gates per app: `pnpm run check`, `tsc --noEmit`, `vp test`, `build:prod`, plus dev/prod HTTP drives.
- Out of scope: published-npm behavior; the non-default `--sqlite` template; roadmap L4 Live; areas
  covered by super-1…8 + bugz-13…19 + papercuts-16…19. The three escalated items are in `bugz-20.md`.
  Note: the **build-cache staleness** hypothesis (a stale `.kovo/cache` shipping wrong behavior on a
  green build) was probed and **not** reproduced — the cache invalidated correctly on the edits
  tried; the build findings below are about hermeticity/determinism instead. Throwaway apps are safe
  to delete; do **not** re-run `pnpm install` in them without isolation.

## Issues

### A. Idempotency

- [x] **A1 — Enhanced-path idempotency token-collision returns HTTP `409 IDEMPOTENCY_CONFLICT`, but SPEC §9.1:1184 normatively specifies a `422` schema-class failure.** (low, framework; found by `t1-concurrency`)
  - Observed behavior: enhanced (`Kovo-Fragment`) path — submit `idem=X` body A → 200; same `idem=X` different body B → `HTTP/1.1 409` with `<kovo-fragment target="error"><output role="alert" data-error-code="IDEMPOTENCY_CONFLICT">`. SPEC normatively specifies this collision as "answered as a 422 schema-class failure (§9.2)."
  - Root cause: the token-collision status mapping returns 409 (`packages/server/src/mutation.ts:663`; `MutationReplayConflictError` at `replay.ts:399-404`) where SPEC §9.1:1184 requires 422. Behavior is otherwise correct and fail-closed (handler runs once, loud typed error, no silent replay).
  - Why it matters: a framework evaluator cross-checking SPEC §9.1:1184 finds a documented-vs-actual mismatch. Low impact (loud, fail-closed) — it is a SPEC/impl honesty gap. (Contrast the no-JS path, which is the `bugz-20` B2 silent-lost-update defect; this is purely the status code on the correctly-handled enhanced path.)
  - Repro evidence: two enhanced POSTs with the same `Kovo-Idem` and different bodies → second is 409, not 422. Source: `mutation.ts:663`, `replay.ts:399-404`.
  - Acceptance: return 422 for a token collision (or update SPEC §9.1:1184 to permit 409, which is arguably more semantically correct — decide and align one to the other). SPEC §9.1:1184/§9.2.
  - Evidence: `pnpm exec vitest run packages/server/src/mutation-no-js.test.ts packages/server/src/replay.test.ts packages/server/src/mutation-stale-version.test.ts packages/server/src/mutation-wire.test.ts`.

### B. The raw-SQL / `sql` escape hatch is unusable (the safe form)

- [x] **B1 — Kovo's `@kovojs/drizzle` SQL constructors (`sql`/`staticSql`/`sql.identifier`/`sql.allow`) return brand-only types that erase Drizzle's `SQL`/`SQLWrapper` type and lack a `<T>` parameter, so they are unusable in EVERY Drizzle sink — including `db.execute()` — while the managed handle rejects drizzle-native `sql` at runtime.** (med, framework; found by `t3-sql-surface`)
  - Observed behavior: importing `sql` from `@kovojs/drizzle` and using it: `kovoSql<number>` → `TS2558 "Expected 0 type arguments"`; feeding the result to a Drizzle sink (`.where(...)`, a projection, `db.execute(...)`) → type error, because the brand interfaces are not `SQL`/`SQLWrapper`. The framework also rejects drizzle-native `sql` on the managed read handle at runtime — so neither Kovo's `sql` (type-incompatible) nor drizzle's `sql` (runtime-rejected on the managed handle) cleanly works.
  - Root cause: `packages/drizzle/src/runtime.ts:85-90` declares `SqlTag` returning bare brand interfaces (`KovoParameterizedSql`/`KovoStaticSql`/`KovoSqlIdentifier`/`KovoSqlKeyword`, `:43-83` — each only `{ readonly __kovoSqlBrand?… }`), with no `SQL<T>` shape and no type parameter, so they satisfy no Drizzle method signature.
  - Why it matters: SPEC §10.2 lists Kovo `sql`/`staticSql` as the ordinary accepted forms on managed handles, and KV422 pushes authors onto them — but they fit nowhere in the Drizzle API surface. The practical consequence is the security half: authors fall back to drizzle-native `sql` + `db.execute(...)`, which is the **ungated** path (`bugz-20` B1). The framework's safe escape being unusable is what makes the unsafe one attractive.
  - Repro evidence: `t3-sql-surface` — `tsc --noEmit` on a probe importing `sql` from `@kovojs/drizzle` → `TS2558` and sink type errors. Source: `runtime.ts:43-90`.
  - Acceptance: Kovo's `sql`/`staticSql` constructors return a Drizzle-`SQL<T>`-compatible (branded) type usable in Drizzle sinks including `db.execute`, with a working `<T>` parameter. Prove with a `tsc` fixture: ``db.execute(sql`…`)`` and ``.where(sql`…`)`` type-check with Kovo's `sql`. SPEC §10.2. (Pairs with `bugz-20` B1: fixing this is the prerequisite for steering authors onto a gated raw-SQL path.)
  - Evidence: `pnpm exec vitest run packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/raw-sql-static.test.ts packages/drizzle/src/index.writes-receivers.test.ts`; prod-artifact raw-SQL gates include ``db.execute(sql`...`)`` and `trustedSql(...)`.

### C. The production build is non-hermetic and non-deterministic

- [x] **C1 — The default `kovo build` ships a dev-JSX server bundle that leaks absolute build-host source paths, because the server bundle's JSX transform doesn't force production mode (content depends on ambient `NODE_ENV`).** (med, framework; found by `t2-build-cache`)
  - Observed behavior: default `pnpm run build:prod` (`kovo build ./src/app.tsx`, `NODE_ENV` unset as the starter ships it) emits `dist/server/server/handler.mjs` containing 62 `jsxDEV` calls and 66 `_jsxFileName` entries with **absolute build-host paths** (and OS username). The bundle content differs by ambient `NODE_ENV`.
  - Root cause: `packages/cli/src/commands/build-export.ts` `bundleKovoServerHandler` (the vite `build()` call, ~`:2148-2195`) passes `oxc:{ jsx:{ importSource:'@kovojs/server', runtime:'automatic' } }` (`:2169-2174`) with **no `development:false`**, so the JSX transform follows ambient `NODE_ENV` and defaults to dev (`jsxDEV` + `_jsxFileName`).
  - Why it matters: the shipped server bundle (deployed to prod) leaks the build host's filesystem layout and OS username, carries dev-mode JSX overhead, and is non-hermetic — the deploy artifact's content depends on an env var the starter doesn't set. (Also undercuts the determinism the whole "prove the artifact" effort depends on.)
  - Repro evidence: `t2-build-cache` — `grep jsxDEV/_jsxFileName dist/server/server/handler.mjs` → 62/66 hits with absolute paths. Source: `build-export.ts:2169-2174` (no `development:false`).
  - Acceptance: the server bundle's JSX transform is pinned to production (`development:false`) regardless of ambient `NODE_ENV`, so the artifact carries no `jsxDEV`/host-path leakage. Prove with a build test asserting no `_jsxFileName`/absolute path in `handler.mjs`.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "server handler bundles"`.

- [x] **C2 — The prod server bundle is byte-nondeterministic: a random `mkdtemp` directory leaks into a rollup `//#region` comment, so two builds of byte-identical source produce different `handler.mjs`.** (low, framework; found by `t2-build-cache`)
  - Observed behavior: two consecutive builds of identical source produce different `dist/server/server/handler.mjs` (`cmp` differs); the diff is a random temp-dir path embedded in a rollup region comment. (This also initially masked the cache test — warm vs `--no-cache` differed for this reason, not staleness.)
  - Root cause: `build-export.ts:2136` `mkdtempSync(join(tmpdir(),'kovo-build-'))` creates a random temp dir; `:2138` writes `runtime-registry.mjs` there as a rollup input; `:2151-2152` set `minify:false`, so rollup emits the random path into a `//#region` comment in the output.
  - Why it matters: defeats reproducible builds and artifact-hash verification — you can't byte-compare two builds of identical source, which is precisely what deploy-skew/supply-chain attestation and a deterministic prod-artifact gate need.
  - Repro evidence: `t2-build-cache` — build twice, `cmp dist/server/server/handler.mjs` differs only in the temp-dir region comment. Source: `build-export.ts:2136-2138,2151-2152`.
  - Acceptance: the bundle is byte-reproducible for identical source (stable internal input path, or stripped region comments). Prove with a test that builds twice and asserts identical `handler.mjs`.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "server handler bundles"`.

### D. Routing / head metadata

- [x] **D1 — SPEC §6.4's typed `meta: ({ params }, queries) => RouteMeta` callback is neither type-checkable nor wired: `route().meta` accepts only a static object or a query-only `{ queries, resolve }` factory, so a param-dependent document title is inexpressible.** (med, framework; found by `t5-nested-routing`)
  - Observed behavior: ``route('/contacts/:id', { params: s.object({ id: s.string() }), meta: ({ params }) => ({ title: `Contact ${params.id}` }) })`` → `TS2322: Type '({ params }) => {…}' is not assignable to …`. A per-entity document title (the obvious use of a dynamic-segment route) cannot be authored.
  - Root cause: `RouteMetaSource = RouteMeta | RouteMetaFactory` (`packages/server/src/hints.ts:39`); `PageHintOptions.meta` is `RouteMetaSource | readonly RouteMetaSource[]` (`:111`); the factory form is query-only (`{ queries, resolve }`), with no `({ params }) => …` signature — so the SPEC §6.4 param-dependent callback type-errors and is unwired.
  - Why it matters: SPEC §6.4 presents `meta: ({ params }, queries) => ({…}) // typed, fed by queries` as a flagship part of typed routing; per-entity titles/OG tags are a baseline need for any detail route, and the documented shape doesn't compile.
  - Repro evidence: `t5-nested-routing` — the `meta` callback above fails `tsc`. Source: `hints.ts:39,111`.
  - Acceptance: `route().meta` accepts (and types) a `({ params }, queries) => RouteMeta` callback per SPEC §6.4, so a param-dependent title type-checks and renders. SPEC §6.4/§13.5.
  - Evidence: `pnpm exec vitest run packages/server/src/route-meta-callback.test.ts packages/server/src/route.test.ts packages/server/src/document.test.ts packages/server/src/app.test.ts packages/server/src/meta.test.ts`.

## Refuted / Not Carried Forward

- **t5-1 — "KV228 false-positive: a static route overlapping a sibling param route is internally inconsistent"** — refuted. The mechanism reproduces, but KV228 here is intentional, SPEC-mandated, and explicitly unit-tested behavior (static/param sibling overlap is a real ambiguity the gate is designed to reject), not a framework inconsistency. Recorded as correct-by-design.
- **Build-cache staleness** — probed (the track's headline hypothesis) and **not** reproduced: edits to schema/queries/components/mutations each invalidated the cache correctly; warm-vs-`--no-cache` differences traced to the C2 nondeterministic temp path, not stale behavior. Encouraging: the cache tracks source on the edits tried.

## Latest Verification

- **A1/B1/C1/C2/D1:** closed with the evidence nested above; latest shared checks also include `pnpm exec vp check --no-lint --no-error-on-unmatched-pattern ...` and `git diff --check`.
- **bugz-20 B1:** closed in `plans/bugz-20.md`; latest raw SQL gates cover KV406/KV414/KV438, trusted raw SQL suppression, and the runtime owner-write cross-tenant check.
