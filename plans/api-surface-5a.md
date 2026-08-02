# World-class DevEx — contract-independent API batches

Status: **implementation complete; final same-manifest packed seal pending**

Charter: `plans/worldclass-devex.md` Track 5a. Gates: G17-G22. Every public batch follows the
standing SPEC, manifest, exports/build, reference, example, compiler-identity, snapshot, migration,
ratchet, release-note, publish, canonical-import, and packed-consumer checklist.

## Completed batches

- [x] **Style:** replace public representation records/raw tuples with module-private runtime-
      validated opaque handles; retain `defineTheme` as the sole theme constructor; remove
      `$$css`, `data-style-src`, `__rules`, `__styleKey`, and raw tuples while preserving CSS,
      source maps, attrs, and rule artifacts.
  - Evidence: Style engine/public-types/packed-api and copied-UI suites prove the 14-name facade,
    same-instance acceptance, forgery refusal, and emitted equivalence.
- [x] **UI/headless/icons:** keep separate owning generators with one catalog schema; align the
      six-part Card anatomy; remove the empty UI root; classify zero-reachable transition ABI and
      38 runtime helpers; return canonical `ComponentRenderResult`; keep deterministic generation
      and type/timing coverage for all 1,737 glyphs.
  - Evidence: owning manifests, reachability/audit JSON, Card/copy-in/catalog suites, and icon
    generation/type/timing gates cover 44 components plus 1,737 glyphs.
- [x] **Verifier:** keep the coherent 11-export runtime-independent package and stabilize help,
      flag order, human/JSON findings, and 0/1/2 exits.
  - Evidence: packed verifier acceptance exercises all 24 documented flag orders and reports zero
    Kovo runtime dependencies.
- [x] **Browser:** replace manual client assembly with the three-export custom-shell installer;
      define ready/drain/abort/dispose/session-reset behavior; retain framework ownership of
      security-bearing requests and module allowlists; infer handle-backed derives; require
      structured trusted HTML/URL review metadata.
  - Evidence: browser/compiler/security/migration and packed client suites cover adversarial hooks,
    generated parity, zero Node builtins, and the ratified inline-loader budget.
- [x] **Core:** reduce the root to 33 decision-backed names, internalize registry/inference/audit
      plumbing, narrow storage/verifier surfaces, and require door-specific validated
      declassification policies with type/runtime/compiler/explain parity.
  - Evidence: `node scripts/api-decision-ledger.mjs`, Core storage/verifier/secret/component tests,
    migration suites, and `check:api-surface` report zero recursive leaks.

## Remaining integration proof

- [ ] Run the canonical packed starter consumer from the final integrated release manifest and
      preserve its authenticated source/manifest identity.
- [ ] Run the canonical packed 44-component/1,737-glyph catalog consumer from that same manifest;
      require exact Card anatomy, generated metadata, copied-source compilation, and no stale
      headless publish output.
- [ ] Close Track 5a only after those consumers and the standing API/migration/snapshot/ratchet,
      `check:publish`, pack-security, and certificate gates pass from the same final subject.

Package-local implementation tests and prior tarballs are not a substitute for these final boxes.
