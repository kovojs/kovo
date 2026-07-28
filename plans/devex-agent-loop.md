# World-class DevEx — version-matched agent loop

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 3. Gates: G12-G13. Generated context is derived
reference material; `SPEC.md` remains normative.

## Snapshot

- [x] Generate one complete authored-doc/API snapshot at CLI pack time.
  - Evidence: `pnpm run check:publish` generated and packed the authenticated 77-file snapshot.
- [x] Include a file manifest, Kovo version, source commit, public-manifest digest, and per-file
      SHA-256 digests.
  - Evidence: `scripts/agent-docs-snapshot.test.mjs` verifies every authenticated manifest field
    and file digest.
- [ ] Ratify compressed tarball and installed-size budgets through `devex-budgets.json`.
- [x] Make snapshot generation deterministic across two clean temporary directories.
  - Evidence: the agent-docs suite in Latest verification byte-compares independent clean-root
    generations.

## Local retrieval

- [x] Make `kovo update-docs` atomically install the exact bundled snapshot under `.kovo/docs`.
  - Evidence: `packages/cli/src/index.update-docs.test.ts` proves staged validation and atomic
    replacement.
- [x] Prove the command performs no mutable live-doc fetch.
  - Evidence: the packed CLI consumer completes `update-docs` under the egress floor using only
    its bundled snapshot.
- [x] Reject placeholder-only, digest-mismatched, partial, or wrong-version snapshots rather than
      report success.
  - Evidence: `packages/cli/src/docs-store.test.ts` covers all four fail-closed cases.
- [x] Add bounded `kovo docs <task>` retrieval with version and digest in results.
  - Evidence: `packages/cli/src/commands/docs.test.ts` proves bounded authenticated results.
- [x] Expose the same bounded retrieval through MCP without a second index or analyzer.
  - Evidence: `packages/cli/src/mcp-docs.test.ts` proves MCP delegates to the shared docs store.
- [x] Generate `llms.txt` and `llms-full.txt` from the same snapshot by reusing
      `site/scripts/llms.mjs`.
  - Evidence: `site/scripts/llms.test.mjs` and the snapshot-generator tests prove the shared
    canonical corpus.

## Agent acceptance

- [ ] Add an offline scaffold→edit→check→fix journey using only JSON diagnostics and installed
      local docs.
- [ ] Regenerate and verify the snapshot in every breaking public-API batch.
- [ ] Track 3 exit: the packed offline journey passes and no placeholder snapshot can report
      success.

## Latest verification

- **Agent-docs suite:** `pnpm exec vitest run` over snapshot generation, storage, CLI/MCP
  retrieval, update, and llms generation passed (7 files, 29 tests).
- `pnpm run check:publish` generated a 77-file snapshot
  (`sha256:f47894b042e4e5e814eecac4e05dfc55aededcc27794c8b10e05861f22cab57a`),
  packed all 14 public packages, and passed the offline packed CLI consumer.
