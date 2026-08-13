# Fresh-generation A/B spike

This runner decides whether the historical narrow fresh-generation candidate improves Kovo's real
browser-visible developer loop. It does not compare bundle-byte or module-count proxies, and it does
not modify tracked source in either comparison worktree. Preparation writes the ignored dependency
installation and generated corpus needed by the real adapter.

## Candidate binding

`scripts/perf-dev-generation-spike.mjs` is deliberately bound to commit
`44da3f3449dcbac2cc29951604b89488c90faa6f`:

- stable patch ID: `720cc725f5ef5707db3097d6d70476ff89710a66`
- raw patch SHA-256: `e468dfbf2d7d2e0dca95db51a4c9fbd607316896a508db56f97b9d3eb5c4e5d4`
- changed files: `packages/cli/src/commands/dev.ts`,
  `packages/server/src/internal/vite-security-profile.ts`, and
  `packages/server/src/security-bootstrap.test.ts`

The baseline and spike must be distinct clean committed worktree roots. Spike `HEAD` must be exactly
one commit above baseline `HEAD`, with byte-identical patch content, the same stable patch ID, and
the same simple-modification path census as the historical candidate. This permits rebasing the
candidate onto the chosen baseline while preventing unrelated changes from entering the comparison.

Create disposable worktrees from the baseline chosen by the performance owner, then apply only the
candidate:

```sh
git worktree add ../kovo-perf-devgen-baseline -b spike/perf-devgen-baseline <baseline-sha>
git worktree add ../kovo-perf-devgen-candidate -b spike/perf-devgen-candidate <baseline-sha>
git -C ../kovo-perf-devgen-candidate cherry-pick 44da3f3449dcbac2cc29951604b89488c90faa6f
```

If the cherry-pick needs conflict resolution, do not measure it. The resolved patch would no longer
be the authenticated historical candidate; select a compatible baseline or define and review a new
candidate identity.

## Authenticate and prepare

Preparation performs frozen offline installs, generates the N=24 or N=216 Kovo corpus independently
in each worktree, and proves matching root/Next.js/harness lock digests, package-manager versions,
corpus source/shape/manifest digests, and byte-identical generator/dev-loop adapters. It launches no
timed development process.

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
  --measure \
  --out /tmp/kovo-dev-generation-n216.json
```

The runner samples host load before every block, enforces literal `localhost`, and verifies source
and lock stability before and after every adapter run. Raw adapter reports remain embedded in the
comparison report.

## Decision rule

The report aggregates baseline and spike median, MAD, p95, sample count, and paired bootstrap 95%
confidence intervals for:

- leaf, route-entry, data-plane, syntax-error, and recovery edit-to-paint latency
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
