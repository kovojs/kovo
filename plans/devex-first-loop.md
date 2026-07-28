# World-class DevEx — first loop

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 1. Gates: G1-G11 and G15. `SPEC.md` and the
standing rules remain authoritative. Each checkbox closes only with the named behavior-level
proof; shared root verification belongs in the latest-verification block.

## Command contract

- [ ] Define one semantic command/discriminant model for all current CLI capabilities.
- [ ] Derive argv parsing from that model, including aliases, required values, enums, defaults,
      repeatability, categories, examples, and exit behavior.
- [ ] Derive root and subcommand help from that model.
- [ ] Derive shell-completion data and the authored command-reference input from that model.
- [ ] Publish the framework-owned `kovo-diagnostic/v1` record and render human, JSON, and GitHub
      adapters without re-deriving severity, help, or source ranges.
- [ ] Make root help, `help`, command help, and version write to stdout and exit 0.
- [ ] Make usage/config errors exit 2 and proof/build findings exit 1.
- [ ] Normalize `kovo explain` on one subcommand/discriminant grammar while preserving or
      explicitly versioning `kovo-explain/v1`.

## Source truth and transactional output

- [ ] Make source-backed `kovo check` reject missing graph input rather than return vacuous `OK`.
- [ ] Separate source/check proof from deployment-only preset, retention, and skew proof.
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

- [ ] Print bound local/network URL, mode, app entry, DB posture, devtool URL, and readiness
      duration from framework-owned `kovo dev` output.
- [ ] Auto-mount `/__kovo` in development without app Vite configuration.
- [ ] Prove the devtool route and implementation are absent from Node production and static-export
      artifacts.
- [ ] Derive a complete loopback development origin from the bound URL while keeping non-loopback
      and production origins explicit, fixed, and HTTPS-validated.
- [ ] Move lifecycle, sound-subset, endpoint-posture, and parallel scheduling algorithms from the
      starter scripts into versioned Kovo commands.
- [ ] Remove `vp` from the app-facing command vocabulary and update the three standing-rule
      evidence contracts in the same checkpoint.
- [ ] Make framework test bootstrap establish runtime ordering before eager app evaluation, then
      remove the starter classifier mock and `isKovoApp` assertion.
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

No implementation checkbox has been closed in this ledger yet.
