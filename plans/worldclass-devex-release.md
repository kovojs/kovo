# World-class DevEx — release capstone

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` release capstone and D2. This ledger closes only after every
applicable G1-G24 proof is current.

- [x] Finalize `kovo fix api-v1 --check|--write` from the checked decision ledger.
  - Evidence: the installed `--api-v1-only` packed gate proves the cumulative command, explicit
    modes, read-only check, transactional write, refusal-wide no-write, and idempotence.
- [x] Prove every mechanical rewrite before its corresponding export/call shape is removed.
  - Evidence: the focused migration/analyzer suite covers all nine removed checked-ledger batches;
    the packed gate rewrites one installed-consumer fixture for each batch with a mechanical rule.
- [x] Prove ambiguous security, app-context, SQL, auth, CSRF, and deployment choices are refused
      with exact manual actions.
  - Evidence: `pnpm exec vitest run packages/cli/src/commands/fix.test.ts -t 'reports every
security refusal category'` proves all seven semantic categories through real removed API
    rules, including category-specific actions and task-guide anchors.
- [x] Publish a task-organized breaking guide with posture changes, before/after source, and
      `kovo explain` output.
  - Evidence: `docs/releases/api-v1.md` owns the cumulative workflow, task migrations, refusal
    actions, proof output, rollback, and the no-compatibility-alias boundary.
- [ ] Publish exactly one cumulative breaking technical-preview minor to the package registry
      under D2.
  - Required proof: immutable registry versions and provenance for the exact release commit;
    authenticated local tarballs and the release workflow contract are necessary but not external
    publication evidence.
- [x] Remove old roots, aliases, overloads, compatibility barrels, and legacy generated emit from
      source and authenticated tarballs.
  - Evidence: `pnpm run check:api-surface`, all nine checked migration batches, and
    `node scripts/check-packed-cli-consumer.mjs --api-v1-only` prove the cumulative clean cut and
    reject removed homes/call shapes from an installed consumer.
- [x] Update `STABILITY.md`, release notes, and invalidated standing-rule evidence.
  - Evidence: `STABILITY.md`, `rules/v1-acceptance.md`, `rules/prelaunch-checklist.md`,
    `rules/docs-style.md`, and `docs/api-migration-protocol.md` name the current command and
    versioned protocols.
- [ ] Pass packed scaffold, advanced example, UI catalog, custom shell/adapter, verifier-only,
      Node/preset, and harness consumers.
  - Current gap: individual packed contracts and the cumulative migration pass, but the complete
    named matrix has not been recorded from one final integrated release manifest at this HEAD.
- [ ] Pass full security/adversarial, compiler fixpoint/render equivalence, wire, publicness,
      publish, docs, type, browser, accessibility, and performance suites.
- [ ] Inspect emitted server/client modules, graph, diagnostics, HTML, CSS, and wire frames.
- [ ] Prove authored app components remain TSX/JSX and no app-authored lowered IR was introduced.
- [x] Fix the evaluator contract at exactly N=3 distinct preregistered non-author identities,
      principals, organizations, and Ed25519 keys against one exact source/packed subject.
  - Evidence: `scripts/external-evaluator-evidence.test.mjs` and
    `scripts/release-workflow-security.test.mjs` prove immutable preregistration, signed subject
    identity, no-intervention attestations, bounded input, and an unconditional release gate.
- [ ] Preregister the three actual evaluator identities/keys and collect their signed
      packed-journey transcripts against the exact release subject.
- [ ] Triage evaluator findings into the known-failure register.
- [x] Compact/archive superseded API and DevEx ledgers without contradictory open ownership.
  - Evidence: `plans/archive.md` records the completed foundations, app-contract, agent-loop,
    devtool, fast-check, and alternative-plan ledgers; all remaining active ledgers own distinct
    open integration or release gates.
- [ ] Close every applicable scorecard gate with one current command or authoritative artifact.

## Latest verification

- Packed gate: `scripts/check-packed-cli-consumer.mjs --api-v1-only` under the install egress floor.
- `pnpm run check:api-surface`
- `pnpm --filter @kovojs/cli run build:dist`
- `node scripts/generate-cli-command-request.mjs --check`
