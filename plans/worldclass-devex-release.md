# World-class DevEx — release capstone

Status: **active final integration ledger**

Charter: `plans/worldclass-devex.md` release capstone and D2. This ledger closes only when every
applicable G1-G24 proof binds one documented release subject. An evidence artifact whose containing
commit would be self-referential must name its clean predecessor code subject and land in an
explicit later wrapper; that relationship is recorded rather than presented as one SHA.

## Completed release machinery

- [x] Ship cumulative `kovo fix api-v1 --check|--write` rules before removing their old homes;
      make check read-only, write transactional/idempotent, and refuse ambiguous app-context,
      trust, SQL, CSRF, auth, and deployment decisions with exact manual actions.
  - Evidence: focused migration suites and the installed `--api-v1-only` packed consumer cover all
    checked batches and seven semantic refusal categories.
- [x] Publish the task-organized clean-break guide and update `STABILITY.md`, release notes, and
      standing rule evidence without compatibility barrels or legacy protocol guidance.
  - Evidence: `docs/releases/api-v1.md`, `docs/api-migration-protocol.md`, and the three standing
    rules name the current API/commands and rollback/refusal workflow.
- [x] Remove old roots, aliases, overloads, compatibility barrels, and legacy generated emit from
      source and authenticated tarballs.
  - Evidence: decision/migration/API-surface gates report 1,640 reviewed declarations across 1,873
    subpaths and zero recursive-publicness leaks; installed
    `node scripts/check-packed-cli-consumer.mjs --api-v1-only` rejects every removed home/call
    shape from the authenticated package set.
- [x] Define the evaluator contract at exactly N=3 distinct preregistered non-author identities,
      principals, organizations, and Ed25519 keys against one immutable source/manifest subject.
  - Evidence: evaluator and release-workflow security suites reject mutable rosters, duplicated
    identity, unsigned/wrong-subject evidence, intervention, and bounded-input bypasses.
- [x] Seal the current D1 v6 source evidence, certificate policy, and certificate through their
      official fail-closed workflows.
  - Evidence: following process-cleanup checkpoint `f3cee8687`, `49296c4b1` resealed
    posture/certificate inputs and `33a8857cb` → `8d0a17d06` authorized and regenerated the v6
    evidence. `conformance/app-contract-spike/results-v6.json` at checkpoint `15b3514da` selects Arm
    A with every gate green for both arms.

## Candidate prerequisites

The mandatory sequence is ratification seed `S` → N≥5 artifact review → committed budget bindings →
final candidate `R` → exact proof and ordinary DevEx Nightly. Evaluator policy commit `P` must be
an immutable strict ancestor of `R`; neither the ratification-only run nor its seed can authorize a
release.

- [ ] Push one clean seed `S` to `main`, verify its remote SHA, and dispatch the ratification-only
      DevEx Nightly workload on that exact seed.
- [ ] Review the N≥5 benchmark, packed-journey, and full-catalog artifacts and commit only justified
      baseline and G2-G4/G16/full-catalog budget bindings.
- [ ] Introduce three real qualifying evaluator identities/keys as the only change in policy commit
      `P` at `evidence/devex/external-evaluators/policy.json`, then leave it immutable.
  - Blocker: no qualifying external roster or keys exist; generated/self/repeated identities do not
    qualify.
- [ ] Select `R` only after the binding commit and `P`; require `R` to descend both and restart this
      sequence if later code, budget, policy, or release-subject changes land.

## Final candidate proof

- [ ] Run `pnpm run acceptance` at the exact clean candidate with pinned Java/offline TLA posture.
  - Its single `check:publish` execution is the canonical packed-manifest producer. Preserve the
    terminal result, authenticate and hash that manifest/package set, and do not rerun acceptance,
    `check:publish`, or another pack producer after the freeze.
- [ ] Run `pnpm run test:security-fuzz-release` and `pnpm run check:hermetic-proof-stage` at that
      same exact `R`.
- [ ] Run the standing checkout gates at `R`: docs snippets, API decision/migration/snapshot/
      ratchet, test-package budget, framework-export posture, compiler fixpoint/render,
      wire-compatibility, provenance closure, and precision.
  - These gates bind the checkout/build subject; they are not packed-manifest consumers.
- [ ] Run all packed consumers from the one frozen `R` manifest/package set: scaffold,
      CRM/commerce, 44-component UI copy-in, packed docs/public declarations, Drizzle
      Postgres/SQLite peers, custom shell/adapter, verifier-only, Node build, supported presets,
      offline agent, and inferred harness.
- [ ] Run the full-catalog reproducer from that manifest with typecheck/check/build exit 0 and all
      measured process-tree RSS values ≤2.0 GiB; then run
      `node scripts/known-failure-register.mjs --run-available --cadence all` with
      `--packed-manifest .release/packed-packages.json` and require all ten entries to report
      `retired-pass`.
- [ ] Verify certificate/module identity and then pack security against the frozen package set
      without regenerating the canonical manifest.
- [ ] Run `scripts/release-artifact-inspection.mjs` into a fresh output directory and inspect
      emitted server/client modules, graph, diagnostics, HTML, CSS, and wire frames.
- [ ] Prove app components remain authored TSX/JSX and no app-authored lowered IR exists
      (`SPEC.md` §5.2/KV235).

## Hosted and external proof

- [ ] Push exact `R` to `main`, verify the remote SHA, and make every applicable exact-SHA GitHub
      check terminal-green.
- [ ] Complete one ordinary DevEx Nightly run at exact `R` with package-producer, benchmark,
      packed-journeys, and full-catalog terminal-green.
  - A ratification-only run for seed `S` deliberately lacks that job set and cannot authorize
    release `R`.
- [ ] Complete G11 through the reviewed `g11-cloud-run` environment and retain the successful
      public-URL/exact-`R`-SHA/build-token/retention/cleanup artifact.
  - Blocker: the GitHub environment and required GCP variables/IAM authority are absent. Do not
    dispatch or create cloud state until they are explicitly configured.
  - Current check (2026-08-02): the environment is absent, no manual G11 dispatch exists, and the
    latest exact-`main` run passed only the contract job with deployment/retention skipped and no
    artifact.
- [ ] Collect signed no-intervention packed journeys from policy `P`'s three evaluators against
      exact `R` and triage every finding into the known-failure register.
  - Blocker: policy `P` and qualifying external evidence do not exist; generated/self/repeated
    identities or another subject do not qualify.
  - Current check (2026-08-02): neither required path exists in the checkout or any Git ref.
- [ ] Publish exactly one cumulative breaking technical-preview minor with immutable registry
      versions and provenance.
  - Blocker: exact-SHA CI, committed hosted bindings, `R`'s ordinary Nightly, G11, evaluators,
    registry credentials, release environment, version, and tag must all be ready. Local tarballs
    are not publication evidence.
  - Current check (2026-08-02): historical `0.2.0` publication and the protected `release`
    environment exist, but all `0.3.0` versions are absent and `@kovojs/verify` has no public
    package; trusted-publisher coverage for all fourteen names remains unconfirmed.
- [ ] Close the capstone only when every applicable G1-G24 row has one current authoritative proof
      and all final candidate, hosted, external, and publication boxes above are complete.

## Latest integrated evidence

- Evidence wrapper `838007981` deliberately binds clean code subject `6ca604d7c`; its convergence
  artifact check passed 495 mutants, P=9,966, 18 green rows, and C13 24/357, while its decided-
  surface artifact check passed 2,877/2,877.
- At exact `838007981`, `pnpm run test:security-fuzz-release` passed 7 families, 21 cases, and
  495/495 mutants; after the official publish build supplied CI's package-dist prerequisite,
  pinned/offline `pnpm run check:hermetic-proof-stage` passed with a closed sandbox and bound
  signed certificate. The required rerun at the eventual final candidate remains open above.
- `pnpm run check:spec-conformance-closure` at `b865601f1` passed 92 codes, 72 error classes, and
  204 sites; the evidence ledger covers 37 files, 108 witnesses, and all 6 mandatory categories.
- Final-candidate acceptance, consumer matrix, catalog, artifact inspection, fuzz, hermetic,
  hosted, evaluator, and registry proof remain open above and are not inferred from these focused
  results.
