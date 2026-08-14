# Fresh-generation A/B spike

This runner decides whether the reviewed narrow fresh-generation candidate improves Kovo's real
browser-visible developer loop. It does not compare bundle-byte or module-count proxies, and it does
not modify tracked source in either comparison worktree. Preparation writes the ignored dependency
installation and generated corpus needed by the real adapter.

## Candidate binding

`scripts/perf-dev-generation-spike.mjs` is deliberately bound to commit
`7a20bf6664c6b601a07a4525d90570bcefb9c55c` on durable ref
`refs/heads/perf-spike/dev-generation-profile-repaired-20260814`:

- parent: `9618120c2f3bc779168c10e927dac4118b9f2ed1`
- tree: `65e39bf38862ea4bab4dfc03d0d6abf2078117fe`
- stable patch ID: `3621461f4e7d8ae3ff1724ed3a85413cb32d1281`
- 7,191-byte raw binary/full-index patch SHA-256:
  `50c335d49c910d861656cacbb77c071907e120e6ab1f52c3728a5682f65fb1ee`
- changed files: `packages/cli/src/commands/dev.ts`,
  `packages/server/src/internal/vite-security-profile.ts`, and
  `packages/server/src/security-bootstrap.test.ts`

The prior exact candidate `44da3f3449dcbac2cc29951604b89488c90faa6f` is retired as
correctness-incomplete. Its narrowed trusted profile omitted
`bindKovoAppShellViteDevLiveTargetAttestationSecret`, so fresh-generation validation could fail
before app import. The repaired candidate retains that binder alongside the dispatcher, generation
preparer, generated-live-target registry, compiler client-module installer, and compiler epoch
identities. Runs `31755725077` and `31761498991` were already unproven due harness timeout defects;
run `31763345652` was launched against the retired candidate and is diagnostic-only. No eventual
status from that run can authorize the retired patch.

The baseline and spike must be distinct clean committed worktree roots. Spike `HEAD` must be exactly
one commit above baseline `HEAD`, with byte-identical patch content, the same stable patch ID, and
the same simple-modification path census as the repaired candidate. This permits rebasing the
candidate onto the chosen baseline while preventing unrelated changes from entering the comparison.

Create disposable worktrees from the baseline chosen by the performance owner, then apply only the
candidate:

```sh
git worktree add ../kovo-perf-devgen-baseline -b spike/perf-devgen-baseline <baseline-sha>
git worktree add ../kovo-perf-devgen-candidate -b spike/perf-devgen-candidate <baseline-sha>
git -C ../kovo-perf-devgen-candidate cherry-pick 7a20bf6664c6b601a07a4525d90570bcefb9c55c
```

If the cherry-pick needs conflict resolution, do not measure it. The resolved patch would no longer
be the authenticated candidate; select a compatible baseline or define and review a new candidate
identity.

## Authenticate and prepare

Preparation performs frozen offline installs, generates the N=24 or N=216 Kovo corpus independently
in each worktree, and proves matching root/Next.js/harness lock digests, package-manager versions,
corpus source/shape/manifest digests, and byte-identical generator/dev-loop adapters. It launches no
timed development process.

The shape digest binds the matched `refresh-surfaces-sibling-to-local-state/v1` posture. Leaf,
entry, and data edits are distinct component refresh surfaces, Kovo's sources compile to proven
query-backed live targets, and the stateful counter is a sibling outside all three targets (SPEC
§4.1/§4.9/§9.5.1, KV420). Reports from the former document-refresh topology have a different
shape digest and cannot be reused.

```sh
node scripts/perf-dev-generation-spike.mjs \
  --baseline-root ../kovo-perf-devgen-baseline \
  --spike-root ../kovo-perf-devgen-candidate \
  --size 24 \
  --prepare-only \
  --out /tmp/kovo-dev-generation-prepare.json
```

A usable preparation report has `verdict.status: "prepared"` and
`integrity.complete: true`. Any dirty path, lock mismatch, source drift, non-`localhost` command, or
candidate mismatch fails closed.

## Measure on a quiet host

Do not run timing while other builds, tests, benchmarks, or agents are active. `--measure` is an
explicit timing authorization; omitting both `--measure` and `--prepare-only` is an error. A global
timing lock prevents another cooperating Kovo performance lane from running concurrently.

Use the short smoke only to verify the end-to-end adapter and report contract:

```sh
node scripts/perf-dev-generation-spike.mjs \
  --baseline-root ../kovo-perf-devgen-baseline \
  --spike-root ../kovo-perf-devgen-candidate \
  --size 24 \
  --quick-smoke \
  --measure \
  --out /tmp/kovo-dev-generation-smoke.json
```

For a decision run, omit `--quick-smoke`. The full policy measures 30 edit samples and 15 fresh-ready
samples per lane, with three warmups per lane. Samples are split over serialized
`baseline, spike, spike, baseline` blocks, one process tree at a time. Repeat the decision run at
both corpus sizes:

```sh
node scripts/perf-dev-generation-spike.mjs \
  --baseline-root ../kovo-perf-devgen-baseline \
  --spike-root ../kovo-perf-devgen-candidate \
  --size 216 \
  --ready-timeout-ms 600000 \
  --timeout-ms 3600000 \
  --measure \
  --out /tmp/kovo-dev-generation-n216.json
```

The runner samples host load before every block, enforces literal `localhost`, and verifies source
and lock stability before and after every adapter run. Raw adapter reports remain embedded in the
comparison report and, when `--out` is used, persist beside it under `raw/`. A nonzero child report
retains its SHA-256, byte count, schema, verdict, readiness failures, and first integrity errors so
an outer `unproven` result remains diagnosable.

Every fresh-ready and edit session also has a fail-closed lifecycle fence. Teardown signals the
entire detached dev process group, escalates to `SIGKILL` when necessary, and then requires two
consecutive successful binds of the same authenticated `localhost` port. A lingering process group,
an unavailable strict port, or an unexpected bind error makes the adapter and outer report
`unproven`; the runner never substitutes another port to conceal a leak.

## Decision rule

The report aggregates baseline and spike median, MAD, p95, sample count, and paired bootstrap 95%
confidence intervals for:

- leaf, entry-surface, data-surface, syntax-error, and recovery edit-to-paint latency
- optional framework-owned server-generation spans for those edit classes
- fresh-ready latency and process-tree peak RSS
- edit-session process-tree peak RSS

The candidate is accepted only when every required browser-visible edit metric improves by at least
10% at the median and its paired bootstrap lower bound is greater than zero. It must also have zero
adapter errors, misses, unexpected browser errors, request failures, or state-loss events; every
syntax-error sample must expose a diagnostic. Fresh-ready latency and ready/edit peak RSS may not
regress by more than 5% at the median.

`bundleBytes`, `emittedBytes`, and `moduleCount` are explicitly excluded from acceptance. A complete
run that misses the performance threshold is `reject`; incomplete, load-shed, unstable, or incorrect
evidence is `unproven`. Neither result authorizes merging the production patch.
