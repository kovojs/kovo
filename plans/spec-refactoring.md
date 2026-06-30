# SPEC Refactoring

Active plan ledger for keeping root `SPEC.md` concise without weakening its authority as Kovo's
normative source of truth. The implemented state is a short root spec that preserves the vision,
constitution, architecture invariants, authority model, module index, and compatibility map, with
detailed normative contracts incorporated from `spec/*.md`.

## Implemented State

- [x] Root `SPEC.md` is the entry point and highest-level normative authority.
  - Evidence: `wc -l SPEC.md` -> `300 SPEC.md`; `SPEC.md` §3.2 says `spec/*.md` files are
    incorporated by reference and normative.
- [x] Extracted normative modules live under `spec/`, not `docs/`.
  - Evidence: `pnpm run check:spec-index` verifies all required `spec/*.md` modules exist and are
    linked from root.
- [x] Existing numeric citations remain understandable through a root compatibility map and
      preserved numbered headings in the extracted files.
  - Evidence: `SPEC.md` §3.4 maps old sections to `spec/NN-*.md`; `vp check --fix` preserved
    formatted headings in `spec/*.md`.
- [x] The diagnostic registry has one normative owner.
  - Evidence: `spec/11-diagnostics.md` owns §11.3, and `node site/scripts/diagnostics-ref.mjs`
    verified `diagnostics-ref/v1 codes=86` against `diagnosticDefinitions`.
- [x] Site and agent-facing docs render the complete normative corpus.
  - Evidence: `pnpm --filter @kovojs/site run build` exported 110 HTML pages, and
    `pnpm --filter @kovojs/site run check:links` checked 111 pages with no broken links.

## File Split

- [x] `SPEC.md`: version/status/audience, vision, primary goals, thesis, non-goals, constitution,
      architecture overview, normative module index, compatibility map, and deploy/version summary.
- [x] `spec/04-component-model.md`: former §4 plus §13.1/§13.2, including component identity,
      rendered output, handlers, loader obligations, composition, primitive merging, update plan,
      coverage, registry-bounded dynamic rendering, StyleX/theme-token contracts, and `kovo-key`
      runtime identity.
- [x] `spec/05-compiler.md`: former §5, including pipeline, hard rules, render-plan token,
      prod render-equivalence, and `kovo explain`.
- [x] `spec/06-type-system.md`: former §6, including registries, package prefixes, typed surfaces,
      mutation typing, routes/links, sessions, and soundness boundary.
- [x] `spec/07-navigation.md`: former §7 and §8, including the interaction ladder, MPA spine,
      enhanced navigation, bfcache posture, speculation rules, view transitions, and streaming
      navigation/defer contracts.
- [x] `spec/09-wire-protocol.md`: former §9, including mutation round trips, prod deltas, errors,
      liveness/live, typed reads, request shell, HMR, durable tasks, and scheduling.
- [x] `spec/10-data-plane.md`: former §10, including schema/domain annotations, queries, access
      decisions, SQL safety, mutations/writes, optimism, derivation algebra, and exhaustiveness.
- [x] `spec/11-verification.md`: former §11, excluding §11.3 diagnostics.
- [x] `spec/11-diagnostics.md`: former §11.3 diagnostic registry, completed against the shared
      `diagnosticDefinitions` registry.
- [x] `spec/12-testing.md`: former §12.
- [x] `spec/14-deploy-skew.md`: former §14.
  - Evidence for split: `pnpm run check:spec-index` and `pnpm run check` passed with the extracted
    module set.

## Decisions

- [x] Use numbered filenames matching the old section map and a hand-authored root cross-reference
      map. The lightweight checker validates the map instead of generating it.
- [x] Keep diagnostics as a hybrid root summary plus linked normative registry in
      `spec/11-diagnostics.md`.
- [x] Keep §13.1 StyleX/theme-token contracts and §13.2 `kovo-key` runtime identity in
      `spec/04-component-model.md`; do not create a separate style/identity spec initially.
- [x] Allow new comments/docs to use either old numeric citations (`SPEC §4.8`) or file-qualified
      citations (`spec/04-component-model.md §4.8`) when file qualification prevents ambiguity.

## Acceptance

- [x] `SPEC.md` is reduced to roughly 300-500 lines without deleting normative behavior.
  - Evidence: `wc -l SPEC.md` -> `300 SPEC.md`; detailed sections remain in `spec/*.md`.
- [x] Every extracted normative contract is reachable from the root `SPEC.md` module index.
  - Evidence: `pnpm run check:spec-index` -> `OK spec index is complete`.
- [x] No extracted file lives under `docs/`.
  - Evidence: extracted files are `spec/04-component-model.md`, `spec/05-compiler.md`,
    `spec/06-type-system.md`, `spec/07-navigation.md`, `spec/09-wire-protocol.md`,
    `spec/10-data-plane.md`, `spec/11-verification.md`, `spec/11-diagnostics.md`,
    `spec/12-testing.md`, and `spec/14-deploy-skew.md`.
- [x] Existing `SPEC.md §...` references remain understandable through stable mapping.
  - Evidence: `SPEC.md` §3.4 maps old sections and `site/src/content.ts` rewrites split-module
    links back to `/spec/#...` anchors.
- [x] The diagnostic registry has one clear normative owner and generated documentation verifies
      against it.
  - Evidence: `node site/scripts/diagnostics-ref.mjs` -> `diagnostics-ref/v1 codes=86`.
- [x] The refactor is behavior-preserving: no framework semantics changed as part of the move.
  - Evidence: production/runtime package behavior was not edited; verification covered the spec
    index, docs generation, link checking, and root `pnpm run check`.

## Latest Verification

- [x] `pnpm run check:spec-index`
- [x] `pnpm exec vitest --run scripts/check-spec-index.test.mjs site/src/content.spec-split.test.ts site/scripts/diagnostics-ref.test.mjs`
- [x] `node site/scripts/diagnostics-ref.mjs`
- [x] `pnpm --filter @kovojs/site run build`
- [x] `pnpm --filter @kovojs/site run check:links`
- [x] `pnpm run check`
- [x] `git diff --check`
