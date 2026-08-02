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
  - Evidence: `5595ee4dd` refreshed the framework identities, certificate policy, and certificate;
    `56234f3da`→`2d2fac1f0` authorized and recorded the current D1 v6 evidence, and `6ca604d7c`
    sealed the final pack inventory. At clean `6ca604d7c`, posture passed 10/10, the pack snapshot
    matched twice, certificate passed 101/101, module identity passed 8/8, and D1 passed 44/44 plus
    two clean Arm-A verification replays.

## Final candidate proof

- [ ] Generate/authenticate one final packed manifest and run all consumer classes from it:
      scaffold, CRM/commerce examples, 44-component UI copy-in, Drizzle Postgres/SQLite peer
      fixtures, custom shell, custom adapter, verifier-only, Node build, supported presets, and
      inferred test harness.
- [ ] Run the full-catalog reproducer from that manifest with typecheck/check/build exit 0 and all
      measured process-tree RSS values ≤2.0 GiB; then require all ten nightly known failures to
      report `retired-pass`.
- [ ] Run `pnpm run acceptance` at the exact clean candidate with pinned Java/offline TLA posture.
  - Do not infer this from earlier candidate or focused gates. Preserve the command subject and
    terminal result.
- [ ] Run `pnpm run test:security-fuzz-release` and `pnpm run check:hermetic-proof-stage` at that
      same exact candidate.
- [ ] Run final publish/docs/API/publicness/type/browser/accessibility, compiler fixpoint/render,
      wire-compatibility, pack-security, certificate, module-identity, provenance-closure, and
      precision gates from the final manifest.
- [ ] Run `scripts/release-artifact-inspection.mjs` into a fresh output directory and inspect
      emitted server/client modules, graph, diagnostics, HTML, CSS, and wire frames.
- [ ] Prove app components remain authored TSX/JSX and no app-authored lowered IR exists
      (`SPEC.md` §5.2/KV235).

## Hosted and external proof

- [ ] Push the final candidate to `main`, verify the remote exact SHA, and make every applicable
      exact-SHA GitHub check terminal-green.
- [ ] Dispatch the ratification-only DevEx Nightly path for the final SHA; review the N≥5 artifact
      and commit only justified G2-G4/G16/full-catalog budget bindings.
- [ ] Complete G11 through the reviewed `g11-cloud-run` environment and retain the successful
      public-URL/source/build-token/retention/cleanup artifact.
  - Blocker: the GitHub environment and required GCP variables/IAM authority are absent. Do not
    dispatch or create cloud state until they are explicitly configured.
- [ ] Preregister three actual qualifying evaluator identities/keys, collect signed no-intervention
      packed journeys for the exact release subject, and triage every finding into the known-
      failure register.
  - Blocker: no real N=3 external roster or evidence exists; generated/self/repeated identities do
    not qualify.
- [ ] Publish exactly one cumulative breaking technical-preview minor with immutable registry
      versions and provenance.
  - Blocker: exact-SHA CI/ratification, G11, evaluators, registry credentials, release environment,
    version, and tag must all be ready. Local tarballs are not publication evidence.
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
