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

`declare` creates the state file exclusively with mode `0600`; an existing path, symlink, hardlink,
in-repository path, dirty checkout, forbidden label, or current exact-source census plus 24 greater
than 100 is rejected. `preflight` proves the declaration has not changed.

Invoke `launch-or-resume` exactly 24 times. `--execute` is required because this is the only phase
that changes GitHub labels:

```sh
vp exec node scripts/perf-publication-campaign.mjs launch-or-resume \
  --state /external/custody/campaign-state.json \
  --execute
```

Each invocation atomically journals its pre-add census, adds one trigger label, admits exactly one
new first-attempt `pull_request` run for `Perf Realistic Tier`, records its seven immutable identity
fields, removes the trigger, and proves removal before returning. Repeating the same command after a
crash resumes safely across the add, registration, and removal boundaries; it does not add a second
pulse. Zero registrations time out without inventing evidence. Multiple registrations, foreign
identity, immutable tuple drift, or other label/source activity fail closed.

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
