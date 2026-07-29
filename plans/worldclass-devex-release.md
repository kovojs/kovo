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
- [ ] Prove ambiguous security, app-context, SQL, auth, CSRF, and deployment choices are refused
      with exact manual actions.
  - Current gap: removed-batch fixtures exercise ambiguous binding, app context, trust, and
    deployment posture. No checked removed rule currently emits auth, CSRF, or SQL posture, so
    those categories cannot be claimed from synthetic formatter-only coverage.
- [x] Publish a task-organized breaking guide with posture changes, before/after source, and
      `kovo explain` output.
  - Evidence: `docs/releases/api-v1.md` owns the cumulative workflow, task migrations, refusal
    actions, proof output, rollback, and the no-compatibility-alias boundary.
- [ ] Ship exactly one cumulative breaking technical-preview minor under D2.
- [ ] Remove old roots, aliases, overloads, compatibility barrels, and legacy generated emit.
- [x] Update `STABILITY.md`, release notes, and invalidated standing-rule evidence.
  - Evidence: `STABILITY.md`, `rules/v1-acceptance.md`, `rules/prelaunch-checklist.md`,
    `rules/docs-style.md`, and `docs/api-migration-protocol.md` name the current command and
    versioned protocols.
- [ ] Pass packed scaffold, advanced example, UI catalog, custom shell/adapter, verifier-only,
      Node/preset, and harness consumers.
  - Current blocker: the unscoped packed CLI journey reaches and passes the cumulative migration,
    then times out in the later packed dev-readiness smoke with empty stdout/stderr.
- [ ] Pass full security/adversarial, compiler fixpoint/render equivalence, wire, publicness,
      publish, docs, type, browser, accessibility, and performance suites.
- [ ] Inspect emitted server/client modules, graph, diagnostics, HTML, CSS, and wire frames.
- [ ] Prove authored app components remain TSX/JSX and no app-authored lowered IR was introduced.
- [ ] Set the external evaluator count and collect the non-author packed-journey transcripts.
- [ ] Triage evaluator findings into the known-failure register.
- [ ] Compact/archive superseded API and DevEx ledgers without contradictory open ownership.
- [ ] Close every applicable scorecard gate with one current command or authoritative artifact.

## Latest verification

- Packed gate: `scripts/check-packed-cli-consumer.mjs --api-v1-only` under the install egress floor.
- `pnpm run check:api-surface`
- `pnpm --filter @kovojs/cli run build:dist`
- `node scripts/generate-cli-command-request.mjs --check`
