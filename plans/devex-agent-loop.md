# World-class DevEx — version-matched agent loop

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 3. Gates: G12-G13. Generated context is derived
reference material; `SPEC.md` remains normative.

## Snapshot

- [ ] Generate one complete authored-doc/API snapshot at CLI pack time.
- [ ] Include a file manifest, Kovo version, source commit, public-manifest digest, and per-file
      SHA-256 digests.
- [ ] Ratify compressed tarball and installed-size budgets through `devex-budgets.json`.
- [ ] Make snapshot generation deterministic across two clean temporary directories.

## Local retrieval

- [ ] Make `kovo update-docs` atomically install the exact bundled snapshot under `.kovo/docs`.
- [ ] Prove the command performs no mutable live-doc fetch.
- [ ] Reject placeholder-only, digest-mismatched, partial, or wrong-version snapshots rather than
      report success.
- [ ] Add bounded `kovo docs <task>` retrieval with version and digest in results.
- [ ] Expose the same bounded retrieval through MCP without a second index or analyzer.
- [ ] Generate `llms.txt` and `llms-full.txt` from the same snapshot by reusing
      `site/scripts/llms.mjs`.

## Agent acceptance

- [ ] Add an offline scaffold→edit→check→fix journey using only JSON diagnostics and installed
      local docs.
- [ ] Regenerate and verify the snapshot in every breaking public-API batch.
- [ ] Track 3 exit: the packed offline journey passes and no placeholder snapshot can report
      success.

## Latest verification

No implementation checkbox has been closed in this ledger yet.
