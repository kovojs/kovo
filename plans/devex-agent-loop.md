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
- [x] Ratify compressed tarball and installed-size budgets through `devex-budgets.json`.
  - Evidence: `node scripts/devex-benchmark.mjs --check-budgets` authenticates the recorded
    clean-source packed baseline and reports two ratified packed-artifact metrics: 1,077,819 bytes
    compressed against 1.25 MiB, and 4,291,085 bytes installed against 5 MiB.
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

- [x] Add an offline scaffold→edit→check→fix journey using only JSON diagnostics and installed
      local docs.
  - Evidence: `node scripts/golden-journey.mjs --scenario offline-agent --packed-manifest
<authenticated-packed-packages.json>` completed the deny-all-network journey with one KV436
    authored-source diagnostic, five authenticated local-doc results, and an empty diagnostic
    envelope after the source-only fix; `pnpm run test:devex-offline-agent` covers the exact packed
    command sequence and adversarial JSON/docs/network cases.
- [ ] Regenerate and verify the snapshot in every breaking public-API batch.
- [x] Track 3 exit: the packed offline journey passes and no placeholder snapshot can report
      success.
  - Evidence: the packed journey above is green; `packages/cli/src/docs-store.test.ts` and
    `packages/cli/src/index.update-docs.test.ts` reject placeholder, partial, digest-mismatched,
    and wrong-version snapshots before atomic installation can report success.

## Latest verification

- **Agent-docs suite:** `pnpm exec vitest run` over snapshot generation, storage, CLI/MCP
  retrieval, update, llms generation, benchmark binding, and CI policy passed (9 files, 57 tests).
- **Offline-agent suite:** `pnpm run test:devex-offline-agent` passed (3 files, 24 tests), including
  the exact `check source` edit/fix sequence and denial of network and prose diagnostics.
- **Budget proof:** `node scripts/devex-benchmark.mjs --check-budgets` validated the recorded
  deterministic artifact report and both snapshot byte ratifications without claiming a runner.
- `pnpm run check:publish` generated an authenticated 77-file snapshot, packed all 14 public
  packages, and passed the offline packed CLI consumer. The digest remains source-revision-bound
  rather than copied into this evolving ledger.
