# SPEC Refactoring

Active plan ledger for making `SPEC.md` concise without weakening its authority as Kovo's
normative source of truth. The intended end state is a short root spec that preserves the vision,
constitution, architecture invariants, and authority model, with detailed normative contracts moved
into explicitly referenced sub-spec files.

## Current State

`SPEC.md` is 1,563 lines and mixes several jobs:

- [ ] Root contract: vision, non-goals, constitution, and architecture overview.
- [ ] Normative module contracts: component model, compiler, type system, navigation, wire protocol,
      data plane, static analysis, testing, and deploy skew.
- [ ] Lookup material: diagnostic registry, command examples, wire examples, merge tables, and
      detailed lowering examples.
- [ ] Roadmap and plan pointers that are useful but increase the apparent size of the normative
      contract.

Initial sizing evidence:

- `wc -l SPEC.md` -> `1563 SPEC.md`.
- `awk` section sizing over `SPEC.md` shows the largest sections are §4 Component Model & Authoring
  at 397 lines, §10 Data Plane at 287 lines, §9 Wire Protocol at 227 lines, §6 Type System at
  224 lines, and §11 Static Analysis & Verification at 163 lines.

## Authority Model

- [ ] Keep `SPEC.md` as the entry point and highest-level normative authority.
- [ ] Create a `spec/` directory for extracted normative modules rather than using `docs/`, because
      repo instructions treat `docs/` as explanatory reference unless authority is explicitly
      delegated.
- [ ] Add root `SPEC.md` language that files under `spec/` are incorporated by reference and are
      normative.
- [ ] Preserve existing section anchors or add compatibility anchors where practical so current
      references to `SPEC.md` sections remain understandable during the transition.
- [ ] Keep `rules/` as standing agent/release/conformance rules; link them from the relevant
      extracted sub-specs instead of duplicating their full content.

## Proposed File Split

- [ ] `SPEC.md`: version/status/audience, vision, primary goals, thesis, non-goals, constitution,
      architecture overview, normative module index, and deploy/version authority note.
- [ ] `spec/04-component-model.md`: current §4 plus §13.1/§13.2, including component identity,
      rendered output, handlers, loader obligations, composition, primitive merging, update plan,
      coverage, registry-bounded dynamic rendering, StyleX/theme-token contracts, and `kovo-key`
      runtime identity.
- [ ] `spec/05-compiler.md`: current §5, including pipeline, hard rules, render-plan token,
      prod render-equivalence, and `kovo explain`.
- [ ] `spec/06-type-system.md`: current §6, including registries, package prefixes, typed surfaces,
      mutation typing, routes/links, sessions, and soundness boundary.
- [ ] `spec/07-navigation.md`: current §7 and §8, including the interaction ladder, MPA spine,
      enhanced navigation, bfcache posture, speculation rules, view transitions, and streaming
      navigation/defer contracts.
- [ ] `spec/09-wire-protocol.md`: current §9, including mutation round trips, prod deltas, errors,
      liveness/live, typed reads, request shell, HMR, durable tasks, and scheduling.
- [ ] `spec/10-data-plane.md`: current §10, including schema/domain annotations, queries, access
      decisions, SQL safety, mutations/writes, optimism, derivation algebra, and exhaustiveness.
- [ ] `spec/11-verification.md`: current §11, excluding any diagnostics table split out below.
- [ ] `spec/11-diagnostics.md`: current diagnostic registry from §11.3, organized for lookup and
      generated-reference comparison.
- [ ] `spec/12-testing.md`: current §12.
- [ ] `spec/14-deploy-skew.md`: current §14.

## Editing Plan

- [ ] Inventory all inbound references to `SPEC.md` section numbers across `packages/`, `site/`,
      `docs/`, `rules/`, `plans/`, and tests before moving text.
- [x] Decide the anchor strategy: use numbered filenames matching the current section map plus a
      root cross-reference map in `SPEC.md`; add explicit anchors only where moved section references
      cannot otherwise remain understandable.
      Evidence: this ledger's Proposed File Split now uses numbered `spec/NN-*.md` filenames, and
      Open Decisions records the section-numbering decision.
- [ ] Move one section family at a time, preserving text first and shortening only after links and
      authority are stable.
- [ ] Replace each moved section in root `SPEC.md` with a short summary, normative link, and the
      strongest local invariant readers need before opening the sub-spec.
- [ ] Move expanded rationale and tutorial-grade examples out of normative files only when an
      existing or new docs guide is the right owner.
- [ ] Keep diagnostic codes in one authoritative registry and update generated docs/tests to compare
      against that source.
- [ ] After each section move, run link/reference checks narrow enough to catch broken anchors before
      continuing.
- [ ] Add a lightweight spec-index check after the split lands: every `spec/*.md` file must be linked
      from root `SPEC.md`, and every root module-index link must resolve.
- [ ] After the final move, run broad verification covering markdown links, docs generation if
      affected, TypeScript/test gates if source comments or generated references changed, and
      `git diff --check`.

## Acceptance Criteria

- [ ] `SPEC.md` is reduced to roughly 300-500 lines without deleting normative behavior.
- [ ] Every extracted normative contract is reachable from the root `SPEC.md` module index.
- [ ] No extracted file lives under `docs/` unless `SPEC.md` explicitly delegates authority to that
      docs file for a narrowly scoped explanatory artifact.
- [ ] Existing `SPEC.md §...` references are either updated or remain understandable through stable
      anchors/cross-reference mapping.
- [ ] The diagnostic registry has one clear normative owner and generated documentation can verify
      against it.
- [ ] The refactor is behavior-preserving: no framework semantics are changed as part of the move.

## Decisions

- [x] Do not create `spec/style-and-identity.md` initially. Move §13.1 StyleX/theme-token contracts
      and §13.2 `kovo-key` runtime identity into `spec/04-component-model.md`, with cross-links from
      wire/data-plane sections where keyed deltas, morph identity, append/prepend, and optimistic
      updates depend on the identity contract.
      Evidence: Proposed File Split assigns §13.1/§13.2 to `spec/04-component-model.md` and removes
      the standalone style/identity file.
- [x] Make diagnostics a hybrid root-summary plus linked normative registry. Root `SPEC.md` should
      name diagnostic families and authority; `spec/11-diagnostics.md` should own the full
      normative diagnostic table and generated-reference comparison target.
      Evidence: Proposed File Split defines `spec/11-diagnostics.md` as the diagnostic registry, and
      Acceptance Criteria requires one clear normative diagnostic owner.
- [x] Preserve old section numbers in extracted filenames for the first refactor.
      Evidence: Proposed File Split now uses numbered filenames such as `spec/04-component-model.md`,
      `spec/09-wire-protocol.md`, and `spec/10-data-plane.md`.
- [x] Add a lightweight spec-index check after the split lands, instead of starting with a broad
      anchor validator.
      Evidence: Editing Plan now includes the spec-index check as a post-split implementation item.

## Open Decisions

- [ ] Decide whether the root cross-reference map should be hand-authored Markdown or generated by
      the lightweight spec-index check.
- [ ] Decide whether renamed section references should use old numeric citations (`SPEC §4.8`) or
      file-qualified citations (`spec/04-component-model.md §4.8`) in new comments/docs after the
      split.

## Latest Verification

- [ ] Not yet run for implementation. This ledger only records the proposed refactor; no spec content
      has been moved.
