# Cold first-ready diagnostic

`scripts/perf-dev-ready-profile.mjs` is a diagnostic-only follow-up to the rejected query-identity
candidate documented in [`dev-query-identity-spike.md`](./dev-query-identity-spike.md). It does not
rerun or weaken that candidate's acceptance decision.

The controller accepts only the exact clean baseline `01b2c7594…` and sealed candidate
`64abadb44…`, prepares separate frozen packed products and matched external N=216 corpora, and runs
one cold first-ready window in fixed `baseline, spike, spike, baseline` order. Before each packed
CLI evaluates user code, `--inspect-brk` pauses it while the controller authenticates the PID,
process marker, Inspector target, and exact pause flag. The controller then starts a 500 µs CPU
profile and precise function coverage with call counts, resumes the process, and stops both at the
existing browser-visible ready fence.

Run it from a clean committed controller worktree on a quiet host:

```sh
node scripts/perf-dev-ready-profile.mjs \
  --diagnose \
  --baseline-root /absolute/path/to/clean-baseline-worktree \
  --spike-root /absolute/path/to/clean-candidate-worktree \
  --profile-dir /absolute/path/outside/either-worktree/raw \
  --out /absolute/path/outside/either-worktree/report.json
```

The report authenticates the controller commit/tree, dirty-path census, lock digests, and runtime
script Git-blob/SHA-256 digests before preparation and after all four cells. Every cell rechecks
source/locks, corpus bytes, and packed-product bytes before and after use. Its `.cpuprofile` and raw
coverage JSON use exclusive filenames and carry byte length and SHA-256 custody. Named call counts
retain every V8 range and bind the containing packed JavaScript and sibling source map by digest.

Successful reports end with `verdict.status: "diagnostic-only"`. Inspector startup, sampling,
coverage, and serialization perturb wall time and RSS, so `durationMs`, `paintFenceMs`,
`peakRssBytes`, and `rssSamples` are explicitly excluded from acceptance. Use the profiles and call
counts only to select or reject the next production-path hypothesis; any implementation still needs
the complete unprofiled N=24/N=216 acceptance contract in `plans/good-perf.md`.
