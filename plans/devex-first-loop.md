# World-class DevEx — first loop

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 1. Gates: G1-G11 and G15. `SPEC.md` and the
standing rules remain authoritative. Each checkbox closes only with the named behavior-level
proof; shared root verification belongs in the latest-verification block.

## Command contract

- [x] Define one semantic command/discriminant model for all current CLI capabilities.
  - Evidence: `packages/cli/src/command-schema.ts` owns all 14 commands; the CLI semantic suite in
    Latest verification proves the generated exhaustive request union.
- [x] Derive argv parsing from that model, including aliases, required values, enums, defaults,
      repeatability, categories, examples, and exit behavior.
  - Evidence: `packages/cli/src/command-contract.test.ts` proves aliases, exact value grammars,
    repeatables, defaults, and schema-correlated requests.
- [x] Derive root and subcommand help from that model.
  - Evidence: the CLI semantic and exit suites prove root/subcommand help is rendered from the
    command schema.
- [x] Derive shell-completion data and the authored command-reference input from that model.
  - Evidence: `packages/cli/src/commands-manifest.test.ts` and `site/scripts/cli-ref.mjs` prove both
    derived surfaces use the same manifest.
- [ ] Publish the framework-owned `kovo-diagnostic/v1` record and render human, JSON, and GitHub
      adapters without re-deriving severity, help, or source ranges.
- [x] Make root help, `help`, command help, and version write to stdout and exit 0.
  - Evidence: the CLI exit suite in Latest verification passes the stdout/exit-zero matrix.
- [x] Make usage/config errors exit 2 and proof/build findings exit 1.
  - Evidence: `packages/cli/src/commands/build-export-exit-contract.test.ts` plus the CLI exit suite
    prove configuration failures exit 2 and findings exit 1.
- [ ] Normalize `kovo explain` on one subcommand/discriminant grammar while preserving or
      explicitly versioning `kovo-explain/v1`.

## Source truth and transactional output

- [x] Make source-backed `kovo check` reject missing graph input rather than return vacuous `OK`.
  - Evidence: `packages/cli/src/index.source-check.test.ts` proves a focused missing graph is an
    error and bare `kovo check` re-derives current type/compiler facts.
- [x] Separate source/check proof from deployment-only preset, retention, and skew proof.
  - Evidence: both starter source-check fixtures pass without deployment posture while the same
    focused CLI suite proves `kovo build` still rejects missing SPEC §14 retention.
- [ ] Stamp graph/cache facts with source-set, compiler, config, app-build, completion, and posture
      identities.
- [ ] Require explicit `--artifact <path>` plus matching identities for built-graph inspection.
- [ ] Stage builds outside `dist`, atomically promote a complete build, and preserve the last
      known-good `dist` after failure.
- [ ] Keep failed-build debug facts redacted under `.kovo/debug/<build-id>` and out of deploy
      output.
- [ ] Add stale, partial, wrong-app, wrong-compiler, wrong-config, and failed-build adversarial
      fixtures.

## Ready loop and starter

- [x] Print bound local/network URL, mode, app entry, DB posture, devtool URL, and readiness
      duration from framework-owned `kovo dev` output.
  - Evidence: `packages/cli/src/index.kovo-dev.test.ts` proves the complete post-listen report.
- [x] Auto-mount `/__kovo` in development without app Vite configuration.
  - Evidence: the dev-server route fixtures prove the framework-owned mount and ready-line link.
- [x] Prove the devtool route and implementation are absent from Node production and static-export
      artifacts.
  - Evidence: the production/static-export artifact census in `pnpm run check:publish` passes.
- [x] Derive a complete loopback development origin from the bound URL while keeping non-loopback
      and production origins explicit, fixed, and HTTPS-validated.
  - Evidence: Better Auth environment/runtime-authority tests plus KF-DEVEX-001 prove the
    post-listen loopback handoff and fail-closed deployment boundary.
- [ ] Move lifecycle, sound-subset, endpoint-posture, and parallel scheduling algorithms from the
      starter scripts into versioned Kovo commands.
- [x] Remove `vp` from the app-facing command vocabulary and update the three standing-rule
      evidence contracts in the same checkpoint.
  - Evidence: the focused creator metadata test and 3-test `kovo test` suite prove the generated
    scripts use `kovo check`, `kovo test`, and `kovo build`; the template/docs/rule census found no
    app-facing `vp` command, and the 201-snippet packed-docs gate passed.
- [x] Make framework test bootstrap establish runtime ordering before eager app evaluation, then
      remove the starter classifier mock and `isKovoApp` assertion.
  - Evidence: the starter scaffold census proves the generated test owns a bootstrap-first public
    HTTP journey with no setup mock/internal import; the DDL proof locks the runtime before loading
    authored modules.
- [ ] Drive creator prompts and non-interactive flags from one schema.
- [ ] Record the supported v1 host-OS posture and add the chosen smoke journey or explicit
      non-support statement.
- [ ] Make creator success instructions conditional on install state and exact for the selected
      scaffold.
- [ ] Refuse unacknowledged experimental SQLite with zero filesystem writes and show the
      single-principal/KV447 posture on accepted SQLite journeys.
- [ ] Render the packed starter through public UI/style APIs and pass the named WCAG check.

## Diagnostics, doctor, add, deploy, and speed

- [ ] Cover the seven first-run failures with one safe cause, source/config anchor, and executable
      next step.
- [ ] Cover the top 20 authoring diagnostics with the same three fields.
- [ ] Add `kovo doctor` checks for toolchain, duplicate packages, peers, config/preset, origin, DB
      roles, migrations, retention, writable paths, and stale caches.
- [ ] Add `kovo add --list`, typo suggestions, `--dry-run`, and `--install=auto|never`.
- [ ] Prove `kovo add --dry-run` performs zero filesystem or process writes.
- [ ] Stage add/install mutations so output distinguishes completed work from planned work after
      failure.
- [ ] Fix source-closure scanning so the packed 44-component copy-in fixture typechecks, checks,
      and builds within the ratified RSS budget.
- [ ] Publish an instrumented `kovo check` phase census and meet the ratified cold/warm/one-file
      budgets without dropping a diagnostic-producing phase.
- [ ] Complete one packed create→build→deploy→public-200 journey on the selected Node host.

## Exit

- [ ] Track 1 exit is proven through the Track 2 packed journeys and ratified budgets, with G1-G9,
      G11, and G15 green.

## Latest verification

- **CLI semantic suite:** `pnpm exec vitest run` over the 11 command/schema/docs boundary files
  passed (11 files, 67 tests).
- **CLI exit suite:** `pnpm exec vitest run` over command-contract, build/export-exit, and export
  behavior passed (3 files, 34 tests).
- **Starter scaffold census:** focused `packages/create-kovo/src/index.test.ts` passed (1 test,
  35 skipped).
- **Starter DDL proof:** focused `packages/create-kovo/src/index.build.runtime.test.ts` passed
  (1 test, 5 skipped), including initial, additive, reordered-FK, and serial-column boot.
- **First-loop proof:** `pnpm run test:devex-known-failures-available` passes all ten registered
  probes with eight retired behaviors and two explicit expected failures; no reproducer is pending.
- `pnpm run check:publish` packed and attested all 14 public packages; the packed CLI consumer
  installed with 265 production dependencies and zero advisories.
- `pnpm run check:spec-conformance-closure` passed (92 codes, 72 error classes, 201 throw sites;
  37 evidence files, 108 witnesses, 6 mandatory cases).
