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
2. [ ] Render-plan version token: emit into module URLs + a delta/patch response header; client
       validates and fails loud on mismatch.
3. [ ] Delta query JSON: server emits changed-fields payload; client deep-merge (objects by key,
       arrays by `kovo-key`); re-run the existing §4.8 update plan.
4. [ ] Patch fragments: server emits subtree patch; feed the existing morph path; deterministic
       full-vs-delta selection with full fallback.
5. [ ] Gates: extend fixpoint + render-equivalence to the `apply_delta` form; prove deploy-skew
       fails loud.
6. [ ] `kovo explain` reconstruction of a prod delta → dev-equivalent full fragment/query.
7. [ ] Reference commerce app: prove prod responses are deltas, morph/merge correct, skew loud.

## Proving commands (to fill in as slices land)

- [ ] fixpoint + render-equivalence green in `apply_delta` form (name a test/command)
- [ ] delta query JSON merges objects by key and arrays by `kovo-key` correctly (name a test)
- [ ] patch fragment morphs equivalently to full fragment over the corpus (name a test)
- [ ] stale-base version mismatch fails loud and refetches full (name a test)
- [ ] `kovo explain` reconstructs a prod delta to dev-equivalent legibility (name a test)
- [ ] byte win measured on the reference commerce app, post-brotli, fragment + query streams
      (name the artifact — nice-to-have, not a gate)
