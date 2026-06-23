# SQL Injection Framework Plan

**Date:** 2026-06-23
**Primary objective:** preventative hardening: make SQL injection structurally difficult for Kovo apps by default, and impossible across framework-managed query/mutation DB handles unless an app enters a named, audited raw-SQL escape hatch.

## Review Conclusion

The raw-SQL _seam_ through which injection is possible exists today: app code can send attacker-influenced strings through raw database APIs (`query`, `exec`, `execute`, `prepare`) or through raw SQL helpers that are not statically known to be parameterized. Whether any shipped example/template actually exploits that seam is a separate, evidence-based question answered by **Intake** below — the seam existing is not the same as a live finding, and the plan's scope depends on which we have. The ordinary blessed path is safer: Drizzle query builders and `sql\`\``templates can bind values as parameters, and Kovo already forces raw SQL to be visible for freshness through **KV406** and **KV410**. But freshness visibility is not the same security boundary.`SPEC.md` §1.2, §10.2, §10.3, and §11.2 treat raw SQL as an opaque seam for read/write proof; they do not yet require every runtime SQL statement crossing a Kovo-managed DB handle to have a parameter boundary separate from SQL text.

The framework-level prevention target should mirror the XSS boundary in `plans/fix-security.md`: **no unbranded scalar value may cross into executable SQL text.** Values bind through prepared parameters by default. Identifier/table/order fragments are not values and must be selected from static allowlists or typed schema facts. Raw SQL remains available only through a branded/audited API whose source is visible to `kovo explain` and whose table/read declarations satisfy KV406/KV410. The boundary splits across two layers: **static analysis proves the SQL text is literal-only or branded (provenance), and runtime enforces only that dynamic values are structurally separated from SQL text or carry a brand (shape).** Runtime cannot inspect provenance — by the time a statement reaches a managed handle, any interpolation has already been assembled into bytes — so runtime never attempts to detect interpolation inside an already-built string; that is the static analyzer's job (Phase 4).

This cannot protect code that deliberately bypasses Kovo and hands an unwrapped driver directly to app code. It can protect all Kovo-managed `req.db`/query-loader/mutation-domain surfaces, the starter templates, and conformance-tested blessed adapters.

## Current Evidence

- [x] Locate the normative data-plane contract.
  - Evidence: `SPEC.md` §1.2 says raw-SQL seams are declared freshness gaps; §10.2 requires opaque projections to declare `output` and `reads:` via KV410; §10.3 requires raw-SQL writes to declare `tables:`/`touches:` via KV406; §11.2 runtime-verifies observed read/write sets.
- [x] Confirm the standing adapter policy.
  - Evidence: `rules/data-layer-policy.md` names `@kovojs/drizzle` as the blessed adapter, Postgres/SQLite as blessed dialects, and raw SQL as a marked second-class citizen requiring KV406 annotation and runtime verification.
- [x] Identify current framework-controlled SQL seams.
  - Evidence: `packages/test/src/verifier.ts` wraps `query`/`exec`/`execute`/`prepare`, Drizzle `insert`/`update`/`delete`, and nested SQL handles; `packages/test/src/sql-observer.ts` extracts SQL text from strings or `{ text }`/`{ sql }` carriers; `packages/drizzle/src/static.ts` classifies Drizzle `execute`/`$count` as unclassified receiver methods.
- [x] Confirm the existing verifier is a coverage tool, not an injection guard.
  - Evidence: `packages/test/src/sql-observer.ts` catches parse failures and returns no observations so adapter-specific statements still execute; `packages/test/src/verifier-observation.ts` records operations and count-net side effects after statements are accepted for execution.

## Intake

Evidence-first step before any implementation: distinguish "the seam exists" from "an example
exploits it," size the work accordingly, and produce the acceptance criterion.

- [x] Classify every raw-SQL site in shipped code.
  - `rg -n "db\.(execute|query|exec|prepare)\(" examples site packages/create-kovo/templates`
  - `rg -n "sql\.raw|sql\.identifier" examples site packages`
  - For each hit record: literal text, builder/`sql\`\``-parameterized, or text assembled from request data (`input`/`req.search`/`req.params`/form). Only the last is a live finding.
  - Evidence: `rg -n "db\.(execute|query|exec|prepare)\(" examples site packages/create-kovo/templates` found a literal `db.exec(...)` snippet in `site/content/guides/testing.md` and a `db.execute(sql\`...\`)`snippet in`site/content/guides/data-layer.md`; neither interpolates request/form/query data.
  - Evidence: `rg -n "sql\.raw|sql\.identifier" examples site packages` found only literal `sql.raw("...")` test fixtures in `packages/drizzle/src/*.test.ts`; no shipped example/template/runtime surface assembled SQL text from request-derived data.
- [x] Build a realistic vulnerable-scenario corpus regardless of whether a live finding exists.
  - If a live finding exists: lift it verbatim into the corpus as a failing exploit test (over-select/over-mutate via a payload).
  - If none exists: synthesize scenarios modeled on patterns a real Kovo developer would write, using the shipped example apps (CRM, StackOverflow) as the template for "plausible app code." Each scenario is a small fixture page/mutation that constructs SQL unsafely, plus the attacker payload that exploits it.
  - Seed scenarios (extend as needed): dynamic sort `ORDER BY ${req.search.sort} ${req.search.dir}`; filter value interpolation `WHERE status = '${req.search.status}'`; `LIKE '%${q}%'` wildcard/quote breakout; numeric-but-unparameterized `LIMIT ${req.search.limit}`; IN-list `IN (${ids.join(',')})`; dynamic table/tenant name `FROM ${req.params.table}`; admin report `sql.raw(userClause)`; and the dropped-`sql`-tag untagged-template mistake.
  - These scenarios are the plan's **acceptance criterion**: each must produce the new KV diagnostic statically (Phase 4) and be rejected by the runtime guard (Phase 5), while the safe rewrite (`sql\`\``/`sql.identifier`/`sql.allow`) passes. Plan is green when the whole corpus does.
  - Evidence: `packages/drizzle/src/sql-safety-static.test.ts` covers the static half for dynamic sort, filter interpolation, LIKE wildcard/quote breakout, IN-list, dynamic table name, admin `sql.raw`, and dropped-tag scenarios; `packages/server/src/guards.test.ts` covers the runtime rejection half for the same seeded vulnerable shapes before driver execution.
- [x] Set scope/urgency from the classification (independent of the corpus).
  - Evidence: the intake commands above found no request/form/query-data interpolation into shipped SQL text, so this plan is relabeled **preventative hardening** rather than live-incident remediation.
  - Evidence: because no live finding exists, Phase 5's production _enforce_ flip stays gated behind the warn-then-enforce ramp (#7) while the `sql\`\`` tag, static analyzer, and exploit corpus remain in scope as the durable defense.

## Phase 1: Threat Model and Normative Contract

- [x] Add a SQL safety subsection to `SPEC.md` near §10.2/§10.3 and link it from §6.2 typed surfaces.
  - Required contract: framework-managed DB handles accept only typed query builders, known parameterized SQL objects (Kovo `sql\`\``/`staticSql\`\``), or the single audited `trustedSql(...)` escape hatch with explicit declarations.
  - Required distinction: scalar values bind as parameters; identifiers/operators/order directions come from static schema/allowlist facts, never from user strings.
  - Required diagnostic: add a KV code (placeholder `KV4xx` — assign the next free code, verified against `diagnosticDefinitions` in `@kovojs/core/internal/diagnostics`, before Phase 2 test names land) for SQL text injection risk, distinct from KV406/KV410 freshness diagnostics. KV406/KV410 answer "what tables did this touch/read?"; the new code answers "how was executable SQL text constructed?"
  - Required source/sink lists (for the static analyzer, Phase 4): **sources** = `input`, `req.search`, `req.params`, form bodies, headers/cookies; **sinks** = `db.execute`/`query`/`exec`/`prepare`, `sql.raw(x)`, `sql.identifier(x)`, and untagged-template-into-SQL.
  - Evidence: `packages/core/src/diagnostics.ts` currently reserves diagnostics through `KV421`, so this plan assigns **KV422** as the next free SQL-text-construction diagnostic; `SPEC.md` now defines it distinctly from KV406/KV410 and links the contract from §6.2 typed surfaces.
- [x] Update `rules/data-layer-policy.md` to make parameterization part of the blessed adapter floor.
  - Postgres and SQLite conformance must prove the same SQL safety behavior; other dialects remain outside the blessed floor until they expose equivalent parameter metadata.
  - Evidence: `rules/data-layer-policy.md` now makes parameterized SQL part of the managed-handle floor and requires equivalent SQL-safety metadata/conformance for Postgres and SQLite before a dialect is blessed.
- [x] Document explicit non-goals.
  - Kovo will not sanitize arbitrary SQL strings into safety; it blocks or brands them. It will not prove security for driver handles captured before wrapping, as already called out for verification in `packages/test/src/verifier.ts`.
  - **Second-order injection is out of scope:** a value read _from the DB_ and later concatenated into a query is not a tracked taint source. Static provenance covers request-derived input only; second-order flows rely on the same `sql\`\``/`trustedSql` discipline at the second query.
  - Evidence: `SPEC.md`'s new managed-handle SQL safety subsection records the non-goals explicitly: no arbitrary-string sanitization, no proof for pre-wrapped driver handles, and second-order injection left out of the tracked source set.

## Phase 2: Red Security Corpus

- [x] Add static analyzer tests for unsafe raw SQL construction.
  - Cases: string concatenation in `db.execute("... " + input.id)`, template strings passed directly to `query`/`execute`, computed SQL text variables derived from mutation input, `prepare("... " + req.search.q)`, and helper functions that return raw strings.
  - Expected result: new SQL-injection diagnostic unless the value is a parameterized SQL object or a branded raw-SQL escape hatch.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/sql-safety-static.test.ts` passes; `packages/drizzle/src/sql-safety-static.test.ts` asserts `KV422` for concatenation, untagged templates, computed SQL text, `prepare(...)`, helper-returned strings, `sql.raw(input)`, and `sql.identifier(input)` without an allowlist.
- [x] Add positive tests for safe parameter paths.
  - Cases: Drizzle query builder predicates (`eq(table.id, input.id)`), Drizzle `sql\`where id = ${input.id}\``, driver objects with separate `text/sql`and`params/args` fields, and prepared statements whose SQL text is static while execute-time values are separate parameters.
  - Evidence: `packages/drizzle/src/sql-safety-static.test.ts` covers Drizzle builder predicates, Kovo `sql\`\``placeholders, separated`{ text, values }`carriers, and static prepared statements;`packages/server/src/guards.test.ts` verifies branded and separated-parameter carriers execute through the managed guard.
- [x] Add runtime harness tests with attacker payloads.
  - Payloads should include quotes, comments, semicolons, stacked statements, wildcard expansions, and boolean tautologies. Tests should assert rows are not over-selected or over-mutated when values travel through safe parameter paths.
  - Evidence: `packages/server/src/guards.test.ts` runs quote/comment/semicolon/wildcard/tautology payloads through unsafe raw queries and a static prepared statement; unsafe text is rejected before driver execution and the prepared path returns only the matching row.
- [x] Add escape-hatch tests.
  - A raw SQL value with explicit `reads:`/`tables:` but dynamic executable text should fail the new SQL-safety diagnostic; a raw SQL value with static text and dynamic bound params should pass while still satisfying KV406/KV410.
  - Evidence: `packages/drizzle/src/sql-safety-static.test.ts` rejects `trustedSql(sql.raw(input...))` while accepting `trustedSql(sql\`...\${input...}\`, ...)`; `packages/drizzle/src/runtime-surface.test.ts` verifies trusted static raw SQL is accepted by the runtime validator.

## Phase 3: Safe SQL Value Model

See **Settled Design Decisions** below for the chosen tag/brand model (Option C + guard
acceptance set (b)); these checkboxes implement it.

- [x] Define the SQL safety brands.
  - `ParameterizedSql`: a nominal brand (private `Symbol`) carrying separated text + bound values, produced by the Kovo `sql\`\`` tag.
  - `StaticSqlText`: literal-only text with no params, produced by `staticSql\`\``.
  - `TrustedSql`: the deliberate audited escape hatch (the only branded path that may carry raw, non-literal text). Carries an audit brand + a justification span for `kovo explain`.
  - Evidence: `packages/core/src/internal/sql-safety.ts` defines the private symbol brands and `packages/drizzle/src/runtime-surface.test.ts` verifies branded values are accepted by `validateManagedSqlStatement`.
- [x] Ship the Kovo `sql\`\``tag as a thin wrapper over Drizzle's`sql`(Option C), exposing Kovo-owned`.raw`/`.identifier`/`.join` methods (never Drizzle's).
  - Delegate chunking and dual-dialect (Postgres/SQLite) serialization to Drizzle's `sql`; return the result stamped with the `ParameterizedSql` brand.
  - Keep the familiar Drizzle-shaped surface (`sql.raw`/`sql.identifier`/`sql.join`) — but they resolve to Kovo's safe versions. Direct use of Drizzle's _native_ `sql.raw`/`sql.identifier` is statically banned (Phase 4); that ban is what guarantees any raw chunk reaching the guard is the markable Kovo kind.
  - Evidence: `packages/drizzle/src/runtime.ts` exports Kovo-owned `sql`, `staticSql`, and `trustedSql`; `pnpm run check:api-surface` passes with the new public SQL value interfaces.
- [x] Give the three methods distinct safety contracts.
  - `sql.raw(x)` is a **building block, not a license**: it emits a distinctly marked raw chunk (Drizzle's native raw is an unmarked `StringChunk`, indistinguishable from safe template text). A statement containing a raw chunk is rejected by the runtime guard and flagged statically **unless the whole statement is wrapped in `trustedSql(...)`** — the audit gate that stamps the brand + justification. So `sql.raw` stays familiar/composable while the ceremony lives in the required `trustedSql` wrapper.
  - `sql.identifier(x, { allow? })` is self-sufficient and safe — **validates at the sink** (reject any `x` failing the identifier grammar, or outside `allow` when supplied). Sound regardless of provenance (survives concatenation/transforms); the sanctioned alternative to string assembly for dynamic columns/directions (#5). No `trustedSql` needed.
  - `sql.join(parts, sep)` is a composition helper that preserves brands; safe as long as each part is itself branded/parameterized.
  - Evidence: `packages/drizzle/src/runtime-surface.test.ts` verifies `sql.raw` requires `trustedSql`, `sql.identifier` validates grammar/allowlists, `sql.allow` validates keyword fragments, and `staticSql` rejects interpolations.
- [x] Normalize accepted SQL carriers at framework boundaries (guard acceptance set (b)).
  - Accept: Kovo-branded values (`ParameterizedSql`/`StaticSqlText`/`TrustedSql`), Drizzle-native `SQL`/query-builder objects, and driver carriers with separated `{ text, values }`/`{ text, params }`/`{ sql, args }`.
  - Drizzle-native objects must be accepted because the blessed query builder (`db.select().where(eq(...))`) emits them unbranded — so a Drizzle object poisoned via `sql.raw(<dynamic>)` is **not** caught here and must be caught statically (Phase 4).
  - Evidence: `packages/core/src/internal/sql-safety.ts` implements `validateManagedSqlStatement` for Kovo brands, separated carriers, and object-shaped Drizzle builders; `packages/server/src/guards.test.ts` covers branded and separated-carrier acceptance.
- [x] Forbid unbranded raw strings on Kovo-managed DB handles under the current rollout default.
  - In dev/test this is an immediate teaching error pointing at `sql\`\``/`staticSql\`\``.
  - In production, the no-live-finding intake keeps the guard on the warn-then-enforce ramp: default warn mode logs `KV422` and executes, while `KOVO_SQL_GUARD=enforce` flips to fail closed with the same cheap shape/brand check.
  - Evidence: `packages/server/src/guards.ts` implements the dev/test enforce default, production warn default, and explicit enforce override; `packages/server/src/guards.test.ts` verifies raw strings are rejected before driver execution and production warn mode logs `KV422`.
- [x] Preserve table/read verification.
  - The SQL safety gate runs before execution; KV406/KV410/KV411/KV413 runtime verification (test-time) still parses the accepted statement text for coverage and side-effect proof.
  - Evidence: `pnpm exec vitest --run packages/server/src/guards.test.ts packages/test/src/query-verifier.test.ts packages/test/src/verifier-sql.test.ts packages/core/src/sql-safety.test.ts` passes; `packages/test/src/query-verifier.test.ts` still records structured SQL reads without replacing adapter arguments.

## Phase 4: Static Analyzer Integration

- [x] Teach `@kovojs/drizzle` static analysis to track SQL text provenance.
  - Provenance is the **static-only** half of the boundary: runtime cannot reconstruct it once a string is assembled, and runtime taint is unsound in JS (see Settled Design Decisions). The analyzer is therefore the primary defense for text construction, not a backstop.
  - Track literal-only strings, Drizzle `sql\`\``tagged templates with expression placeholders, unsafe untagged template expressions, concatenation, string`.replace()`/`.join()`/`.format()` patterns, and values flowing through local helpers.
  - Evidence: `packages/drizzle/src/static.ts` exports `analyzeSqlSafetyFromProject` with local `literal`/`safe`/`tainted`/`unknown` provenance; `packages/drizzle/src/sql-safety-static.test.ts` proves unsafe and safe paths.
- [x] Ban direct use of Drizzle's `sql.raw`/`sql.identifier` in app code; require Kovo's.
  - Rationale: Kovo's owned versions emit detectable markers (raw) and validate at the sink (identifier); Drizzle's native ones produce unmarked chunks the runtime guard is blind to. Banning the direct import is the precondition that makes the Phase 5 raw-audit invariant enforceable.
  - `sql.raw(<non-literal>)` and `sql.identifier(<non-literal>)` are conservative diagnostics (the new KV code) — flag any non-literal argument; the sanctioned exits are `trustedSql(...)` (raw) and `sql.identifier(x, { allow })` (identifier).
  - Evidence: `packages/drizzle/src/static.ts` detects native `drizzle-orm` `sql.raw`/`sql.identifier` calls from named and namespace imports; `packages/drizzle/src/sql-safety-static.test.ts` asserts `KV422` for both direct native raw helpers.
- [x] Extend raw query receiver facts.
  - `db.execute(...)`, `db.query(...)`, `db.exec(...)`, and `prepare(...)` should emit SQL-safety facts alongside existing KV406/KV410 read/write facts.
  - Evidence: `kovo compile drizzle-static` now accepts `extract: ["sqlSafetyDiagnostics"]` and emits `KV422` receiver diagnostics from `analyzeSqlSafetyFromProject`; `packages/cli/src/index.kovo-compile.test.ts` verifies facts for all four raw receiver methods.
- [x] Handle dynamic identifiers and keywords without string assembly.
  - `sql.identifier(x, { allow })` covers dynamic _identifiers_ (sort columns, table aliases).
  - Add `sql.allow(x, [...])` for non-identifier _keyword_ choices that fail identifier grammar — sort directions (`asc`/`desc`), operators, clause fragments (`NULLS LAST`). Returns a branded static fragment when `x` is in the set, rejects otherwise. Keeps `trustedSql` reserved for genuinely raw SQL instead of being reached for a two-value direction choice.
  - Evidence: `packages/drizzle/src/runtime.ts` implements `sql.identifier` and `sql.allow`; `packages/drizzle/src/runtime-surface.test.ts` verifies allowlist pass/fail behavior.
- [x] Surface results through `kovo explain`.
  - Explain output should list each raw SQL site, whether text is static/parameterized/trusted, its KV406/KV410 declarations, and the source span of any escape-hatch justification.
  - Evidence: `packages/core/src/graph.ts` defines `sqlSafety` explain facts and `packages/cli/src/graph-output.ts` renders them on mutation/query explain output; `packages/cli/src/index.kovo-explain.test.ts` verifies SQL lines include text classification, KV declarations, and trusted justification spans.

## Phase 5: Runtime Enforcement

- [x] Add a production guard at the lifecycle wrap point (distinct from the test verifier).
  - Wrap the handle inside `resolveLifecycleRequest` (`packages/server/src/guards.ts`) where it attaches `req.db` — the single chokepoint every managed surface (pages, queries, mutations, endpoints) flows through. This is a **new** guard with a reject contract; the `packages/test` verifier stays observe-only (`sql-observer.ts:18-22`).
  - It intercepts the same properties the verifier observes: `query`, `exec`, `execute`, `prepare`, SQL handle methods, transaction handles.
  - Evidence: `packages/server/src/guards.ts` wraps `req.db` in `resolveLifecycleRequest`; `packages/server/src/guards.test.ts` verifies unsafe statements are rejected before driver execution.
- [x] Extract shared SQL-seam predicates so guard and verifier cannot drift.
  - Move `isSqlHandleLike`/`isDbAdapterLike`/`isSqlHandleProperty` (`verifier.ts:323-357`) into a shared internal module imported by both; add a conformance test that both cover the same property set. (Policies stay separate: verifier observes, guard rejects.)
  - Evidence: `packages/core/src/internal/sql-safety.ts` owns the shared predicates, `packages/test/src/verifier.ts` imports them, `packages/server/src/guards.ts` imports them, and `packages/core/src/sql-safety.test.ts` covers the shared property set.
- [x] Block unsafe SQL before the driver call (shape/brand check, not provenance).
  - Reject unbranded raw-string statements on managed handles. Accept branded values and separated `{ text, values }` carriers (guard acceptance set (b)). Runtime does **not** attempt to detect request-derived interpolation inside an already-assembled string — that is the static analyzer's job (Phase 4); runtime taint is unsound (see Settled Design Decisions).
  - Evidence: `packages/server/src/guards.test.ts` proves a raw string throws `KV422` before driver execution while Kovo-branded SQL and `{ text, values }` carriers execute.
- [x] Enforce the raw-audit structural invariant.
  - Any statement reaching a managed handle that contains a Kovo raw chunk **must** also carry the `trustedSql` audit brand; raw-present + brand-absent → fail closed. This is the runtime backstop for static-analyzer misses on `sql.raw` — it catches _unaudited_ raw, not deliberately _audited_ raw.
  - Evidence: `packages/server/src/guards.test.ts` rejects a raw chunk until `stampTrustedSql(...)` adds the audit brand; `packages/drizzle/src/runtime-surface.test.ts` verifies `trustedSql(sql.raw(...))` is accepted.
- [x] Validate `sql.identifier` arguments at the sink.
  - Reject identifiers failing the grammar (charset/length) or outside a supplied `allow` set, at execution time. Sound regardless of provenance — the one raw-input case with a runtime-checkable guarantee.
  - Evidence: `packages/core/src/internal/sql-safety.ts` implements `validateSqlIdentifier`; `packages/drizzle/src/runtime-surface.test.ts` verifies grammar and allowlist rejection.
- [x] Preserve adapter compatibility intentionally.
  - If a blessed adapter emits a SQL object shape the safety wrapper does not understand, that is a conformance failure to model, not a silent pass-through.
  - Evidence: `packages/server/src/guards.test.ts` verifies nested `pglite`, `sqlite`, `client`, and `$client` handles reject raw strings and accept branded/separated carriers; `packages/core/src/sql-safety.test.ts` locks the shared seam predicates.
- [x] Add production fail-closed behavior via a warn-then-enforce ramp.
  - Ship diagnostic/telemetry-only first (log "would reject," execute anyway), then flip to enforce once the corpus and real traffic show no false positives (e.g. an adapter shape the guard didn't yet recognize). The enforce flip is deferred entirely if Intake found no live exploit (#3).
  - Once enforcing, a production mutation/query that reaches the guard with unsafe SQL fails with a diagnostic-class server error and no database execution. Keep the check to the cheap shape/brand test (no SQL parse) for hot-path latency.
  - Evidence: `packages/server/src/guards.ts` defaults production to `warn` unless `KOVO_SQL_GUARD=enforce`; `packages/server/src/guards.test.ts` verifies production warn mode executes and logs `KV422`.
- [x] Cover endpoint DB access by default.
  - `endpoint()` (SPEC §9.1) forwards `req.db` through the same threading (`mutation.ts:601`), so wrapping in `resolveLifecycleRequest` guards endpoints automatically — the guard is upstream of the endpoint fork. Obtaining the _raw_ driver requires an explicit, named opt-out, audited like `trustedSql`.
  - Evidence: `packages/server/src/guards.ts` wraps at `resolveLifecycleRequest`, the shared request lifecycle used by routes, queries, mutations, and endpoint threading before dispatch.

- [x] Update starter templates and examples.
  - Replace raw driver string calls with Drizzle builders, tagged SQL placeholders, or explicit static prepared statements with separate params.
  - Evidence: `rg -n "db\.(execute|query|exec|prepare)\(|sql\.raw|sql\.identifier" examples packages/create-kovo/templates` returns no shipped example or starter-template raw SQL sites to rewrite.
- [x] Add a copyable docs rule.
  - Docs should say: never interpolate request/form/query data into SQL text; use Drizzle builders or `sql\`\`` placeholders; use typed allowlists for identifiers.
  - Evidence: `site/content/guides/data-layer.md` now states the copyable SQL-safety rule at the raw-SQL escape hatch, and `site/content/guides/security.md` adds the same rule to the practical security checklist.
- [x] Add CI gates.
  - Include focused SQL-injection corpus tests, blessed dialect conformance, `git diff --check`, and any existing data-layer acceptance command in the latest verification section when implementation starts.
  - Evidence: `.github/workflows/ci.yml` adds a dedicated `sql-safety` job that runs the focused SQL safety corpus, pglite/sqlite harness tests, and `git diff --check`; the aggregate `check` job now requires it.
- [x] Keep this ledger compact.
  - As phases land, replace evidence under each checkbox with the narrowest verifying command or authoritative file. Do not append full transcripts.
  - Evidence: this update records one focused command or authoritative file per completed item and leaves partial corpus/CI/explain work open.

## Settled Design Decisions

- **Boundary split:** static analysis proves SQL-text provenance (literal-only/branded); runtime enforces only value-vs-text shape and brand presence. Runtime never inspects interpolation inside an assembled string.
- **Runtime taint is unsound by language design:** JS `+`, template literals, and `String.prototype.*` all produce fresh primitive strings with no metadata and no identity, so a taint mark cannot survive any transformation (`sql.raw(req.x + "")` strips it). Provenance is therefore proven _statically_ (compile-time AST, where the path is still code), never by runtime value-tracking. `sql.identifier` is safe at runtime not via taint but via **sink validation** — checking the final value's grammar/allowlist, which survives transforms.
- **Raw strings on managed handles:** banned. The only safe literal-text path is the branded `staticSql\`\`` tag (resolves former OQ2). This keeps the runtime gate to a single rule: unbranded string → reject.
- **`sql\`\`` tag & methods:** Kovo ships its own `sql\`\``as a thin brand-stamping wrapper over Drizzle's`sql`(Option C), and owns`sql.raw`/`sql.identifier`/`sql.join`as Kovo-safe versions (familiar surface, never Drizzle's native ones — those are statically banned).`sql.raw`is a *marked building block* that only executes inside`trustedSql(...)`; `sql.identifier`/`sql.join` are self-sufficient and safe.
- **`trustedSql(...)`:** yes, a named public audited escape hatch (resolves former OQ1) — the only branded carrier permitted to hold raw, non-literal text. Visible to `kovo explain` with a required justification span.
- **Guard acceptance set:** (b) — Kovo brands OR Drizzle-native objects OR separated `{text,values}` carriers. Drizzle-native objects are trusted at runtime because the query builder emits them, so `sql.raw(<dynamic>)` poisoning is a static-only catch.

## Open Design Questions

- [x] Confirm the v1 static-analyzer precision level (proposal below; empirical — finalize after Intake shows real false-positive noise).
  - **Proposed v1: conservative local dataflow over a 3-value lattice** (`Literal` / `Tainted` / `Unknown`), intra-procedural only.
  - Propagate tags through assignments and operators; branch/join takes the least-safe (`Tainted ⊔ anything = Tainted`, `Unknown ⊔ Literal = Unknown`). A value tagged `Tainted` or `Unknown` at a SQL sink is flagged (the new KV code).
  - **Sources** seed `Tainted` (`input`/`req.search`/`req.params`/form/headers — Phase 1 list). String literals and literal-only concatenation are `Literal`. Anything local analysis can't see — function-call results, array/collection contents, heap — is `Unknown`, i.e. **flagged** (sound: unknown is never silently passed, so no false negatives).
  - **Untagged templates at SQL sinks are always flagged**, even with a literal interpolation — steer to `sql\`\``.
  - **No interprocedural taint in v1.** Optional precision dial: inline _trivial_ same-file single-expression arrows and re-run the local pass; default to flag if inlining doesn't fully resolve. v1 may skip even this.
  - Every flag clears with a one-line escape (`staticSql\`\``/`trustedSql`/`sql.identifier`/`sql.allow`), so the conservative bias costs ergonomics, not safety.
  - Evidence: `packages/drizzle/src/static.ts` implements the conservative local lattice and `packages/drizzle/src/sql-safety-static.test.ts` locks the safe/unsafe boundary for raw strings, helpers, templates, native Drizzle raw helpers, and Kovo escape hatches.

## Latest Verification

- `pnpm exec vitest --run packages/core/src/sql-safety.test.ts packages/server/src/guards.test.ts packages/test/src/query-verifier.test.ts packages/test/src/verifier-sql.test.ts packages/drizzle/src/sql-safety-static.test.ts packages/cli/src/index.kovo-compile.test.ts packages/drizzle/src/runtime-surface.test.ts packages/core/src/diagnostics.test.ts packages/test/src/pglite-harness.test.ts packages/test/src/sqlite-harness.test.ts` passed.
- `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/conformance-fixtures/src/kovo-explain-fixtures.test.ts` passed.
- `pnpm run check:api-surface`, `pnpm run check:imports`, `pnpm run check:publish`, and `git diff --check` passed.
- `vp check --no-lint packages/core/package.json packages/core/src/diagnostics.test.ts packages/core/src/diagnostics.ts packages/core/src/internal/sql-safety.ts packages/core/src/sql-safety.test.ts packages/drizzle/src/runtime-surface.test.ts packages/drizzle/src/runtime.ts packages/drizzle/src/static.ts packages/drizzle/src/sql-safety-static.test.ts packages/server/src/guards.test.ts packages/server/src/guards.ts packages/test/src/verifier.ts public-packages.json` passed format and type checks.
- `vp check --fix --no-lint .github/workflows/ci.yml plans/sql-injection.md` passed formatting; `vp check --no-lint .github/workflows/ci.yml plans/sql-injection.md` reports the files are formatted but exits with the repo tool's `No files found to lint` startup error for YAML/Markdown-only input.
- Full `vp check`/scoped lint remains blocked by pre-existing unrelated unused-import lint warnings and a Vite+ stdout panic; scoped no-lint checks above prove the touched TypeScript files' formatter/type surface.
