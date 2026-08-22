# Publication campaign operator

`scripts/perf-publication-campaign.mjs` owns the metrics-blind registration boundary for the fixed
24-pulse publication campaign described in `baseline-collection.md`. It never requests or prints a
run outcome, job, log, artifact, summary, or report payload. The existing collector and live gate
remain the only payload authorities.

Use a clean checkout at the final frozen PR head. Put the state file in a pre-existing directory
outside that checkout. Every command fails closed if the checkout, PR head, workflow identity,
non-trigger labels, or exact-source workflow census changes.

If the campaign uses `perf-baseline-cpu-amd-7763`, apply it and let its pre-boundary PR run register
and finish before declaration. Otherwise declare `none`. All `perf-baseline-focus-*` labels and the
`perf-measure-baselines` trigger must be absent.

```sh
vp exec node scripts/perf-publication-campaign.mjs declare \
  --checkout /absolute/path/to/clean-final-checkout \
  --repository kovojs/kovo \
  --pr 7 \
  --source <exact-final-source-sha> \
  --cpu-alias none \
  --state /external/custody/campaign-state.json

vp exec node scripts/perf-publication-campaign.mjs preflight \
  --state /external/custody/campaign-state.json
```

`declare` creates the state file exclusively with mode `0600` and binds its canonical absolute path
into the state. Every later command re-proves that the canonical path is unchanged and remains
outside the measured checkout. State reads use a no-follow file descriptor with before/after file
identity and size checks. Writes hold a sibling single-writer lock for the whole command and require
the expected inode and content digest immediately before atomic replacement. An existing path,
symlink, hardlink, wrong custody path, in-repository path, concurrent replacement, dirty checkout,
forbidden label, or current exact-source census plus 24 greater than 100 is rejected. `preflight`
proves the declaration has not changed.

The lock is `<state>.lock`. A command never guesses whether an existing lock belongs to a live,
stale, or crashed process. If the original process is still live, let that invocation finish. If it
crashed or lock ownership cannot be authenticated, do not delete the lock or reuse the state;
abandon that custody path and declare a fresh campaign at a new external state path.

Invoke `launch-or-resume` exactly 24 times. `--execute` is required because this is the only phase
that changes GitHub labels:

```sh
vp exec node scripts/perf-publication-campaign.mjs launch-or-resume \
  --state /external/custody/campaign-state.json \
  --execute
```

Each invocation atomically journals its pre-add census as an **armed** pulse, adds one trigger label,
admits exactly one new first-attempt `pull_request` run for `Perf Realistic Tier`, durably records its
seven immutable identity fields, removes the trigger, and proves removal before returning.

An armed pulse may proceed only inside the invocation that created it. If execution stops before the
exact registered run is durably journaled—including before the add call, after a possibly successful
add, or after observing registration—the next invocation invalidates the entire campaign without
calling add/remove or accepting any label or run created externally. Do not retry, infer whether the
add succeeded, or reuse that state. Restore the frozen labels under separate operator custody, then
declare a fresh 24-pulse campaign at a new state path. This deliberately sacrifices even a provably
pre-call pulse because the persisted state cannot authenticate which side of the GitHub mutation it
represents.

Resume is allowed only after the exact registered run was durably journaled. From that boundary the
operator may finish trigger removal or finalize an already removed trigger without adding again.
Zero or multiple registrations, foreign identity, immutable tuple drift, or other label/source
activity invalidate or fail the campaign closed; none can be converted into campaign evidence.

After the 24th successful invocation, seal before looking at terminal status:

```sh
vp exec node scripts/perf-publication-campaign.mjs seal \
  --state /external/custody/campaign-state.json
```

Sealing fetches the complete one-page exact-source census, binds the inclusive first/last run IDs,
and requires the boundary to contain exactly the 24 journaled runs and nothing else. Monitoring uses
only the run `status` field and prints only a terminal count:

```sh
vp exec node scripts/perf-publication-campaign.mjs monitor \
  --state /external/custody/campaign-state.json
```

Once monitoring reports `24/24 terminal`, run the final handoff immediately before the collector:

```sh
vp exec node scripts/perf-publication-campaign.mjs handoff \
  --state /external/custody/campaign-state.json
```

Handoff rechecks the clean checkout, frozen PR/labels, terminal status, and the complete ordered tuple
census byte-for-byte, then prints only the exact repeated `--run <id>` arguments. Supply those IDs,
the sealed first/last IDs in the external state, and `--campaign-pulses 24` to the collector command
documented in `baseline-collection.md`. Do not manually open the state's run IDs in Actions before
collection, add a top-up pulse, rerun a workflow run, or replace a failed sample.
