# Plan: Production wire deltas (partial query JSON + patch fragments)

Created 2026-06-16 (rescoped from the retired `prod-minification` plan). Behavioral source of truth
is `SPEC.md`; this ledger sequences the work and records evidence. The SPEC contract edits are the
load-bearing deliverable — implementation is downstream of agreeing the contract.

## Goal & framing

Today a mutation response re-sends content-proportional payloads: an entire `<kovo-query>` value and
a full `<kovo-fragment>` subtree re-render, even when one field or one row changed. That is real
content, so it does **not** compress away. This plan ships the **minimal change** in prod while
keeping dev fully legible.

**Scope decisions (locked with maintainer, 2026-06-16):**

- [x] **Drop name minification entirely.** Constitution #1 stays fully intact — names are never
      mangled, dev or prod. The earlier minification proposal bought marginal bytes (conceded
      post-brotli) and only weak IP protection (standard minification is not real obfuscation), so
      it spent the strongest invariant for the smallest payoff. Removed from scope.
- [x] **No knobs.** The dev/prod build mode is the only switch (Constitution #2 — no per-call-site
      config). Within prod the runtime picks delta-vs-full per response automatically. No
      `kovo.config` flag.
- [x] **Proceed on the design argument; skip pre-measurement.** Full-HTML-per-mutation is
      self-evidently content-proportional, so the delta win does not need a byte study to justify.
      (Byte measurement is still a nice-to-have, recorded as an open proving command, not a gate.)

## Contract: what changed in SPEC (landed 2026-06-16)

- [x] **Constitution #4** — environment-conditional payloads: named POSTs + schema-shaped JSON in
      every env; full self-describing HTML in dev; size-optimized deltas in prod against a
      version-validated base. Names never mangled (#1 untouched).
      Evidence: `SPEC.md` §2 row 4.
- [x] **§4.5 (line ~201)** — "a fragment fully describes its DOM" is literal in dev; in prod it may
      be a delta against a version-validated base. Slot-hole rejection stands (a delta still
      describes the whole target subtree, incrementally). Evidence: `SPEC.md` §4.5.
- [x] **§9.1.1 (new)** — prod delta encoding: delta query JSON (object-by-key, **arrays by
      `kovo-key` identity**), patch fragments (same morph machinery, smaller input), mandatory
      base-version validation (loud fail + refetch full on skew), automatic full-vs-delta selection,
      `kovo explain` reconstruction. Evidence: `SPEC.md` §9.1.1.
- [x] **§5.1** — prod build stamps a render-plan version token into module URLs + delta/patch
      responses; minify footnote restated (names verbatim in prod). Evidence: `SPEC.md` §5.1.
- [x] **§15** — new risk row: prod delta against stale base → version token fails loud. Evidence:
      `SPEC.md` §15.
- [x] **§16.2** — legibility criterion scoped: holds on dev frames directly; prod frames are deltas
      with verbatim names and `kovo explain` reconstruction. Evidence: `SPEC.md` §16.

## Hazards (each has a SPEC answer; implementation must honor it)

- [ ] **Stale-base skew.** Prerendered/cached base + newer build = silently wrong patch. **Answer:**
      render-plan version token on every delta; mismatch → discard, fail loud, refetch full. Must be
      runtime-validated, no opt-out (there is no knob to fall back to).
- [ ] **Array delta ambiguity.** Position-based array merge breaks under reorder/removal. **Answer:**
      keyed operations over the existing `kovo-key` identity contract (§4.8, §13.2). No new identity
      concept — reuse.
- [ ] **Fixpoint / render-equivalence (§5.2.3).** Prod render is no longer byte-identical to dev.
      **Answer:** the prod gate becomes `apply_delta(base, render_prod(Δ)) ≡ render_dev(full)` over
      the corpus; full-vs-delta selection must be deterministic.
- [ ] **First-render / patched-in islands.** No base exists yet. **Answer:** automatic fallback to
      full for first render of any island; delta only when a known base is present.

## Sequencing

1. [x] SPEC contract edits (above) — landed, reviewed as a unit.
2. [x] **Shared delta protocol** — `@kovojs/core` `buildQueryDelta`/`applyQueryDelta`/
       `queryDeltaIsSmaller` + `QueryDelta`/`QueryDeltaListMeta`. Evidence:
       `packages/core/src/query-delta.ts`, 15 tests in `query-delta.test.ts`.
3. [x] **Render-plan version token**: build-global token = SHA-256 over sorted client-module
       `path@version` (first 16 hex), stamped as `<meta name="kovo-build">` in `<head>` and
       `Kovo-Build` response header; client reads page token + response header. Evidence:
       `packages/server/src/client-modules.ts` (`buildToken()`), `document-core.ts`,
       `mutation.ts`; `packages/runtime/src/build-token.ts`, `mutation-fetch.ts`.
4. [x] **Delta query JSON**: server emits `<kovo-query ... delta>` (change-record-scoped,
       auto full-vs-delta via `queryDeltaIsSmaller`); client merges into the held base by
       `kovo-key` and runs the existing §4.8 update plan. Evidence:
       `packages/server/src/mutation.ts` + `wire-html.ts` + `mutation-delta.test.ts` (11);
       `packages/runtime/src/query-apply.ts` + `wire-parser.ts` + `query-apply.test.ts`.
5. [x] **Base-version validation + refetch-full, wired through the production submit path**:
       missing base or build-token skew → `onDeltaMiss` → `/_q/<wireKey>` GET, never a silent
       drop. Evidence: `packages/runtime/src/mutation-submit.ts` (`defaultDeltaMissRefetcher`),
       `mutation-apply.ts`, `query-refetch.ts` (`createDeltaMissRefetcher`);
       `mutation-apply.test.ts` (apply-on-match / skew→miss / no-base→miss).
6. [x] **Round-trip + skew gates** (the `apply_delta(base, Δ) ≡ full` gate): proven at the core
       unit level (round-trip scenarios) and through the real apply path. Evidence:
       `query-delta.test.ts` round-trip block; `mutation-apply.test.ts` + `apply-mutation-response-delta.test.ts`.
7. [x] **Reference commerce proof**: `orderHistoryQuery` marked delta-eligible; test proves a
       payment ships only the new order row and round-trips. Evidence:
       `examples/commerce/src/queries.ts`, `queries-delta.test.ts` (2).
8. [ ] **Smaller fragments — keyed-row windowing** (deferred). The fragment byte-win for
       plan-grammar subtrees is delivered by the query-delta path above; server-computed DOM
       diffing is explicitly out of scope (not stateless-sound — SPEC §9.1.1, §4.5). Dedicated
       keyed-row `<kovo-fragment>` windowing + auto fragment full-vs-delta selection remain open.
9. [ ] **Zero-config on default interactive flows** (deferred — the gating gap). Auto-on deltas
       need (a) compiler-derived `QueryDeltaListMeta` from `data-bind-list`/`kovo-key` stamps,
       and (b) row-level invalidation keys on interactive mutations (commerce's interactive
       mutations currently invalidate with `keys: null`; only the payment webhook carries keys).
       Today delta meta is declared explicitly per query; the protocol + wiring are complete.
10. [ ] **`kovo explain`/MCP delta reconstruction CLI wrapper** (deferred — convenience). The
        reconstruction _mechanism_ is the exported `applyQueryDelta(base, delta)`; a thin
        `kovo explain` argv wrapper over runtime base+delta artifacts is not yet added (SPEC
        §9.1.1 names this a convenience, not load-bearing — names are never mangled).

## Proving commands

- [x] core delta logic + `apply_delta ≡ full` round-trip: `npx vitest --run packages/core/src/query-delta.test.ts` (15)
- [x] server emits change-record-scoped delta, auto full-vs-delta, `Kovo-Build` header:
      `npx vitest --run packages/server/src/mutation-delta.test.ts packages/server/src/wire-html.test.ts`
- [x] client merges delta by `kovo-key` + runs update plan; parser reads `delta` attr:
      `npx vitest --run packages/runtime/src/query-apply.test.ts packages/runtime/src/wire-parser.test.ts`
- [x] base skew / missing base refetch full through the submit path, base untouched:
      `npx vitest --run packages/runtime/src/mutation-apply.test.ts packages/runtime/src/apply-mutation-response-delta.test.ts`
- [x] real commerce query ships a scoped delta + round-trips:
      `npx vitest --run examples/commerce/src/queries-delta.test.ts` (2)
- [ ] byte win measured on the commerce app, post-brotli, query stream (nice-to-have, not a gate — open)
