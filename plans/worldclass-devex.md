# World-class Kovo developer experience and API

Status: **active integration and release ledger**

Created 2026-07-27; compacted 2026-08-01 after diagnostic-evidence checkpoint
`b865601f139dcf9e2e404108be5342631edd8c6d`. Security evidence wrapper `838007981` explicitly
binds clean code subject `6ca604d7c` through its non-self-referential records.

`SPEC.md` is authoritative, especially §§1.1-1.3, §2, §4-§6, §9-§12, and §14.
This plan may reduce proof ceremony, but it may not replace runtime/AST/provenance enforcement
with types, weaken a fail-closed sink, hide the wire, introduce ambient app registration, or make
lowered IR app-authored (`SPEC.md` §5.2).

## Product outcome

Kovo's safe path is now its shortest path: declare app context once, derive current proof from
source, and inspect the same fact through CLI, JSON, GitHub, editor, MCP, or devtool surfaces. The
technical-preview API cut removed framework assembly records, generated protocol carriers, and
inference plumbing from ordinary app vocabulary without adding compatibility barrels.

Concrete benefits already implemented:

- one semantic command model drives parsing, help, completion, references, and stable exit codes;
- `defineKovo` returns an opaque app contract whose receiver methods infer request, session, DB,
  environment, errors, routes, queries, mutations, optimism, and test-harness types;
- public APIs have one task-oriented home, zero recursive-publicness leaks, and checked migration
  rules that refuse security or deployment guesses;
- packed local docs, recipes, component/icon catalogs, diagnostics, and editor/MCP/devtool views
  are generated from authenticated sources rather than a parallel analyzer;
- the packed starter uses public TSX/JSX, UI/style, app-contract, and inferred-harness APIs.

The remaining work is release proof, hosted performance ratification, and genuinely external
evidence. It is not another API redesign.

## Current measured surface

At clean exact release-candidate audit subject `838007981`,
`node scripts/public-api-inventory.mjs --check` reports:

| Unit                            | Count |
| ------------------------------- | ----: |
| Manifest-public subpaths        | 1,873 |
| Analyzed TypeScript entrypoints |   136 |
| Exported declarations           | 1,640 |
| Generated-family members        | 1,737 |

Consumer files with public imports are classified as 105 authored examples, 114 authored docs,
1,892 package internals, 18 generated emitters, 4 conformance files, and 416 tests. The clean run
recorded 47 excluded directories. Counts from a built tree are not accepted as the census because
ignored output directories can change exclusion totals or contaminate consumer evidence.

`node scripts/api-decision-ledger.mjs` validates all 1,640 declarations and reports Core
33/target:60 and Server 116/target:116 at their roots. `pnpm run check:api-surface` remains the
release gate; the counts are health signals, not permission to move concepts into `/types` or
undocumented deep imports.

## Atomic release scorecard

Numeric runner-bound thresholds remain informational until the hosted N≥5 ratification records
the runner, workload identity, sample statistic, measured noise, rationale, and threshold formula.

| Gate                                            | State                | Current proof or exact gap                                                                                                                                                                                |
| ----------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 packed Postgres/PGlite and SQLite journeys   | final proof pending  | Historical report `b0bf20b05` passed the former nine-phase contract; the current create→install→ready→first-200→login→CRUD→ready-warm→check→build→test contract still needs final-subject reconfirmation. |
| G2 ready output and cold/warm time              | ratification pending | Framework-owned ready facts are tested; hosted timing thresholds remain unratified.                                                                                                                       |
| G3 edit-to-diagnostic/result time               | ratification pending | Deterministic driver exists; no accepted hosted N≥5 threshold.                                                                                                                                            |
| G4 cold/warm/incremental check and phase census | ratification pending | All 11 phases are retained; final hosted workload and thresholds remain open.                                                                                                                             |
| G5 help/version/error exits                     | green                | CLI exit-contract suites cover 0/1/2 behavior.                                                                                                                                                            |
| G6 one semantic command model                   | green                | Command-schema derivation suites cover parsing, help, completion, and references.                                                                                                                         |
| G7 current graph truth                          | green                | Adversarial source/artifact identity suite rejects missing, stale, partial, and wrong-app proof.                                                                                                          |
| G8 transactional build                          | green                | Staging/promotion suite preserves the last good `dist` and excludes failed proof from deploy output.                                                                                                      |
| G9 empathetic diagnostics                       | green                | Seven first-run and top-20 authoring classes share safe cause, anchor, and next step.                                                                                                                     |
| G10 styled accessible starter                   | green                | Packed journey records authenticated screenshots and zero pinned WCAG 2.2 A/AA axe violations.                                                                                                            |
| G11 blessed Cloud Run deployment                | externally blocked   | Workflow contract is green; no `g11-cloud-run` environment or successful public-URL artifact exists.                                                                                                      |
| G12 offline agent journey                       | green                | Packed offline scaffold→edit→check→fix uses only JSON diagnostics and installed docs.                                                                                                                     |
| G13 authenticated executable docs               | green                | Packed docs/reference gates reject placeholders/drift and compile the classified corpus.                                                                                                                  |
| G14 first-CRUD concept census                   | green                | Both packed scaffold reports record the concept categories and zero undocumented environment edits.                                                                                                       |
| G15 development-only devtool                    | green                | Mount/ready-line tests and production/static artifact census pass.                                                                                                                                        |
| G16 install time and size                       | ratification pending | Measurements exist; hosted timing/size binding remains unratified.                                                                                                                                        |
| G17 recursive-publicness zero                   | green                | `check:api-surface` reports total zero and rejects widening as a repair.                                                                                                                                  |
| G18 no unapproved app-public `any`              | green                | Packed AST gate and reviewed-exception policy pass.                                                                                                                                                       |
| G19 opaque style values                         | green                | Packed style tests reject forgery and preserve emitted CSS/artifacts.                                                                                                                                     |
| G20 narrow custom-shell installer               | green                | Browser consumer exposes the reviewed three-export client facade with bounded hooks.                                                                                                                      |
| G21 standalone verifier contract                | green                | Packed verifier proves 0/1/2 exits, human/JSON parity, and no Kovo runtime dependency.                                                                                                                    |
| G22 decision-backed Core/Server roots           | green                | Decision ledger reports Core 33 and Server 116 with no recursive leaks.                                                                                                                                   |
| G23 declare app context once                    | green                | Packed starter and CRM app-contract corpora typecheck without manual context plumbing.                                                                                                                    |
| G24 inferred public test harness                | green                | Packed starter harness uses imported app types plus digest-verified runtime graph facts.                                                                                                                  |

## Decisions

- [x] **D1 — select receiver provenance (Arm A).** Both receiver methods and a generated app-scoped
      module passed the preregistered v6 matrix; Arm A won the preference rule.
  - Evidence: `conformance/app-contract-spike/results-v6.json` records `decision: arm-a` with every
    gate green for both arms. After package identities were refreshed at `5595ee4dd`, commits
    `56234f3da` and `2d2fac1f0` authorize and bind the current evidence; D1 passed 44/44 and two
    clean `measure:verify` replays selected Arm A.
- [x] **D2 — one cumulative breaking preview release.** Implementation batches may land on `main`,
      but the registry receives exactly one cumulative technical-preview minor with
      `kovo fix api-v1`; no compatibility barrels or interim stable API are added.
  - Evidence: `STABILITY.md`, `docs/releases/api-v1.md`, and the release workflow contract encode
    the single cumulative preview cut; the external registry-publication checkbox remains open.

## Completed implementation milestones

- [x] **Trustworthy first loop.** One command schema, source-first check, authenticated artifact
      mode, transactional build, loopback-only dev origin, framework-owned ready output/devtool,
      doctor/add workflows, test bootstrap, SQLite posture, and empathetic diagnostics are in
      place.
  - Evidence: `plans/devex-first-loop.md` retains the focused contracts; only its final packed
    journeys/catalog, hosted budgets, and G11 proof remain open.
- [x] **Release measurement infrastructure.** Packed journeys, benchmark/census drivers, the
      ten-ID known-failure register, PR reports, CI minute policy, and fail-closed budget schema are
      implemented.
  - Evidence: `plans/devex-gates.md`; all ten register entries are retired, while hosted
    ratification and the final-candidate full-catalog/nightly reconfirmation remain open rather
    than being inferred from machinery.
- [x] **Version-matched agent loop.** Authenticated local docs, atomic `update-docs`, bounded
      CLI/MCP retrieval, deterministic `llms` output, and the offline repair journey are complete.
  - Evidence: the retired `plans/devex-agent-loop.md` is summarized in `plans/archive.md`.
- [x] **App contract.** Opaque `KovoApp`, app-scoped declarations, access algebra, keyed optimism,
      inference fixtures, compiler provenance, duplicate-package refusal, and packed G23/G24
      consumers are complete.
  - Evidence: final D1 v6 evidence plus the retired `plans/app-contract.md` summary.
- [x] **Public API cut.** Style, UI/headless/icons, verifier, Browser, Core, Server, Better Auth,
      optimism, test harness, and typed Drizzle implementations have landed with checked migration
      rules and no legacy compatibility homes.
  - Evidence: `plans/api-surface-5a.md`, `plans/api-surface-5b.md`, and
    `plans/api-surface-drizzle.md` retain only final same-manifest integration proof.
- [x] **Feedback and teaching.** Shared source anchors, safe runtime-cause taxonomy, live devtool,
      presentation-only VS Code extension, projection parity, authenticated API references,
      compiled recipes, and generated catalogs/front doors are complete.
  - Evidence: `plans/devex-feel-and-teach.md`; only final packed CRM/commerce proof remains.

## Remaining implementation work

Each open action names its authoritative or coordinating child ledgers. Do not close a box from an
earlier package-local run or from a different packed manifest.

- [ ] **Seal one final integrated packed manifest and run every named consumer from it.** Include
      both current ten-phase scaffold journeys, CRM/commerce examples, 44-component copy-in
      catalog, Drizzle Postgres/SQLite peer fixtures, custom shell/adapter, verifier-only,
      Node/presets, and inferred harness.
  - Benefit: proves package topology and generated metadata work as installed, not only in the
    monorepo. Risk: a stale or mixed tarball set can falsely pass; every runner must authenticate
    the same manifest/source subject. Owner: `plans/worldclass-devex-release.md` and API child
    ledgers.
- [ ] **Reconfirm KF-DEVEX-007 on the final release manifest.** Copy all 44 components, retain
      unimported files, and require typecheck/check/build exit 0 with peak RSS ≤2.0 GiB; then
      require the nightly known-failure run to record `retired-pass` for that same subject.
  - Benefit: ordinary copy-in no longer exhausts developer/CI memory. Risk: a below-cap partial
    run is not closure. Owner: `plans/devex-first-loop.md` and `plans/devex-gates.md`.
- [ ] **Run the final local release proof at the exact candidate.** Complete root acceptance,
      security/adversarial fuzz release, hermetic proof stage, compiler fixpoint/render and wire
      equivalence, publish/docs/API/type/browser/accessibility gates, and release-artifact
      inspection. Inspect emitted server/client modules, graph, diagnostics, HTML, CSS, and wire
      frames and confirm app components remain authored TSX/JSX.
  - Benefit: replaces a collection of focused successes with one release-level subject. Risk:
    pack, D1, certificate, or hermetic identities must be regenerated only through their official
    fail-closed workflows. Owner: `plans/worldclass-devex-release.md`.
- [ ] **Push the final candidate and make exact-SHA GitHub checks terminal-green.** Treat queued or
      failed checks as open; inspect and repair in-scope failures before advancing.
  - Benefit: proves the committed candidate rather than a local tree. Risk: a later commit makes
    prior CI inapplicable.
- [ ] **Ratify G2-G4, G16, and full-catalog budgets on the hosted final workload.** Dispatch the
      ratification-only DevEx Nightly path, collect N≥5 samples, review noise and threshold
      derivation, then commit accepted bindings. Do not turn measurements into authority merely
      because the workflow completed.
  - Benefit: performance becomes a release contract. Risk: noisy or workload-mismatched baselines
    institutionalize false thresholds. Owner: `plans/devex-gates.md`.

## External release gates

- [ ] **G11 Cloud Run deployment.** Create/configure the reviewed `g11-cloud-run` GitHub
      environment with `KOVO_G11_GCP_PROJECT`, `KOVO_G11_GCP_REGION`,
      `KOVO_G11_GCP_ARTIFACT_REPOSITORY`, `KOVO_G11_GCP_SERVICE_ACCOUNT`, and
      `KOVO_G11_GCP_WORKLOAD_IDENTITY_PROVIDER`; then run the manual journey and retain its public
      URL, source SHA, build token, retention posture, and cleanup artifact.
  - Blocker: the environment and cloud/IAM authority do not exist. Do not auto-create an
    unprotected environment or cloud resources without explicit authorization.
- [ ] **Preregister N=3 independent evaluators.** Record three real non-author identities,
      principals, organizations, and Ed25519 keys, then collect signed no-intervention packed
      journeys against the exact release subject and triage every finding.
  - Blocker: no qualifying external roster/evidence exists. Generated identities, self-dogfood,
    repeated principals/keys, or another HEAD do not count.
- [ ] **Publish the cumulative preview minor.** Publish immutable package versions and provenance
      only after exact-SHA CI, hosted ratification, G11, the evaluator gate, and registry/release
      credentials are ready.
  - Blocker: external gates and publication authority remain absent; local tarballs are not
    registry evidence.
- [ ] **Capstone exit.** All applicable G1-G24 rows are green with current evidence, all final
      local/hosted/external gates above are complete, and the one cumulative release is published.

## Risks that still govern release

| Risk                              | Release control                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Convenience weakens security      | Runtime validation, compiler symbol identity, fail-closed sinks, and emitted-artifact inspection remain authoritative; types are defense-in-depth only (`SPEC.md` §2/§6.6).                                                                                         |
| Public-surface reduction is gamed | The decision ledger, real examples, contract tests, zero recursive-publicness ratchet, and no `/types` junk drawer gate every public home.                                                                                                                          |
| Browser/server boundary regresses | Packed per-entry bundle and Node-builtin scans cover custom-shell and generated bootstrap paths.                                                                                                                                                                    |
| Cache or graph proof is stale     | Every admitted artifact binds source/config/compiler/app/completion/posture identities; explicit artifact mode rejects mismatches.                                                                                                                                  |
| Local defaults leak to deploy     | Only loopback development origin is derived; production origin, DB, retention, and preset posture remain explicit and fail closed.                                                                                                                                  |
| Diagnostics disclose secrets      | One bounded safe-cause registry and correlation ID project to every surface; raw causes stay server-side and redacted.                                                                                                                                              |
| Documentation drifts              | API/docs/catalog/recipe output binds source and manifest digests and compiles against packed exports.                                                                                                                                                               |
| Ratification blesses noise        | Named runner, exact workload fingerprint, N≥5, measured noise, statistic, rationale, and reviewed formula are mandatory.                                                                                                                                            |
| Migration rewrites intent         | `kovo fix api-v1` performs mechanical edits only and refuses app-context, trust, SQL, CSRF, auth, or deployment decisions.                                                                                                                                          |
| Release evidence crosses commits  | Packed, CI, hosted, evaluator, and registry proof must bind one documented release subject. A self-referential evidence artifact instead names its clean predecessor code subject and lands in an explicit later wrapper; the two must never be silently conflated. |

## Active ownership

- `plans/devex-first-loop.md`: final journeys/catalog/KF-DEVEX-007, hosted G2-G4/G16 budgets, and
  G11.
- `plans/devex-gates.md`: final same-manifest/nightly proof and hosted budget ratification.
- `plans/api-surface-5a.md`: final Style/UI catalog and contract-independent API seal.
- `plans/api-surface-5b.md`: final Server/Better Auth/harness standing seal.
- `plans/api-surface-drizzle.md`: final packed typed-annotation and peer matrix.
- `plans/devex-feel-and-teach.md`: final packed CRM/commerce example proof.
- `plans/worldclass-devex-release.md`: integrated consumers, acceptance/security/artifact proof,
  exact-SHA CI, evaluators, publication, and capstone.

Completed foundations, app-contract, agent-loop, devtool, and fast-check ledgers are recorded in
`plans/archive.md`. Adjacent component/example/design plans retain their own scope; this ledger does
not silently close them.
