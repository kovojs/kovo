# Cold first-ready diagnostic

`scripts/perf-dev-ready-profile-bootstrap.mjs` is the only supported entry point for the
diagnostic-only follow-up to the rejected query-identity
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
node scripts/perf-dev-ready-profile-bootstrap.mjs \
  --diagnose \
  --baseline-root /absolute/path/to/clean-baseline-worktree \
  --spike-root /absolute/path/to/clean-candidate-worktree \
  --profile-dir /absolute/path/outside/either-worktree/raw \
  --out /absolute/path/outside/either-worktree/report.json
```

The built-in-only bootstrap captures one controller commit, derives its tree and every named blob
from that commit, compares stable no-follow filesystem reads to the committed blob bytes, guards
HEAD/ref identity, and materializes a private read-only `git archive`. Only then does it import the
controller. The final report is withheld until the child exits and the original HEAD/ref and source
identities still match. Local checkout paths are capabilities used by the bootstrap, not report
authority.

The report authenticates immutable controller commit/tree, lock digests, package-manager identity,
and runtime script Git-blob/SHA-256/inode evidence before preparation and after all four cells.
Every cell rechecks source/locks, corpus bytes, and packed-product bytes before and after use. CPU
and coverage envelopes cross-bind the exact cell, PID, process-marker digest, Inspector target and
pause port, product digest, named calls/ranges, and script assets. Before packed consumers are
cleaned, the controller reopens every artifact with `O_NOFOLLOW`, requires its original device/inode,
size and digest, parses its schema, recomputes calls from retained coverage, and accepts only the
exact eight-file directory census. Every file-backed CPU/coverage URL under the packed consumer or
corpus has retained source bytes plus inline/file source-map evidence for later frame attribution.

Successful reports end with `verdict.status: "diagnostic-only"`. Inspector startup, sampling,
coverage, and serialization perturb wall time and RSS, so `durationMs`, `paintFenceMs`,
`peakRssBytes`, and `rssSamples` are explicitly excluded from acceptance. Use the profiles and call
counts only to select or reject the next production-path hypothesis; any implementation still needs
the complete unprofiled N=24/N=216 acceptance contract in `plans/good-perf.md`.
