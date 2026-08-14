# Exact dev edit-to-paint profiling

`benchmarks/corpora/dev-loop.mjs` can bracket Inspector CPU and allocation sampling around the exact
measured source-write-to-destination-paint window. This is diagnostic evidence, not a latency lane:
the report sets `verdict.status` to `diagnostic-only`, preserves all ordinary corpus/state/browser/
RSS/source-integrity gates, and refuses timing claims because both samplers perturb the process.

The authenticated corpus posture is
`refresh-surfaces-sibling-to-local-state/v1`: leaf, entry, and data are separate component roots,
and the local counter is their sibling. Kovo measures query-backed inferred live-target refreshes;
Next.js measures the matching Fast Refresh component topology. This keeps `Count 1` outside every
replacement boundary, as required by SPEC §4.1/§4.9/§9.5.1 and KV420, so a passing state gate
means the edited surface preserved unrelated browser state rather than reconstructing it.

The profile classifies directly observed self samples into module evaluation, Vite transform, SSR
generation, and asynchronous proof convergence. The stack-v3 classifier attributes a leaf sample
only from functions observed in its complete Inspector ancestry; a generic TypeScript scanner below
Kovo's asynchronous project-analysis frame therefore remains proof-convergence work, while the same
scanner under another stack does not. Allocation uses the same ancestry rule. Categories are ranked
by their larger observed CPU/allocation share, never by comparing microseconds with bytes. Every
category receives an explicit ruling: present in the current top five, observed outside it, or
retired because it was absent. Work that matches no reviewed classifier stays in the raw profiles and
the census as unattributed; it is never assigned by guess.

Inspector keeps one `timeDeltas` integer for every sample; the first delta is relative to profile
start and later deltas are between adjacent samples. Under load V8 can serialize a small signed delta
when sample timestamps arrive out of order. Following Chromium's
[`CPUProfileDataModel`](https://chromium.googlesource.com/devtools/devtools-frontend/+/main/front_end/models/cpu_profile/CPUProfileDataModel.ts),
Kovo reconstructs timestamps and stably sorts only the derived timestamp/sample pairs before
attribution. It never rewrites the retained `.cpuprofile`. Validation still requires exact
sample/delta cardinality, safe-integer deltas and timestamps, every cumulative timestamp inside the
authenticated `[startTime, endTime]` range, and a valid node graph with known sample and child IDs.
The report calls the exact anomaly count `negativeCpuTimeDeltas`; it does not mislabel that count as
the number of samples moved by sorting. The stack-v3 identity prevents summaries produced by the old
nonnegative-delta rule from passing the current audit.

The hosted diagnostic census is three measured windows per edit class after three warmups (15 raw
CPU/heap pairs per corpus). A clean N=24 calibration at `8afdec2c9` retained 379 MiB for only one
window per class, which projects to about 11.4 GiB at 30 iterations before the repository,
dependencies, browser, or upload staging. A standard `ubuntu-24.04` GitHub-hosted runner has 14 GB of
SSD ([runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)),
so a 30-window profile census is not fail-closed evidence. The separate unprofiled comparison keeps
30 measured edits per class and owns every latency claim; the bounded profile census owns only the
current ranking and hypothesis retirements.

## Current hosted evidence

Run [`31766167951`](https://github.com/kovojs/kovo/actions/runs/31766167951) checked out clean commit
`dae339e930dde6bc0526894b69ec7312ca20f576`. Its N=216
[artifact `9206701075`](https://github.com/kovojs/kovo/actions/runs/31766167951/artifacts/9206701075)
expires on 2026-09-13 and authenticates as follows:

- downloaded ZIP SHA-256 (also the Actions API digest):
  `0d4f662cc5285d858b2c7520cf5ce67883d5c831ddfb4eb15895573b89f23100`
- `report.json` SHA-256:
  `a89d28b195b9dd2bfea6a477402100584d8e736733bd44328a4a779ebff59799`
- `audit.json` SHA-256:
  `8e971dd09395710414a50a7b9fd91212a44e3451fbaf1d61946c26e853c179b0`

The artifact retained all 15 requested CPU/heap pairs: eight passed the former validator and seven
were quarantined with their original bytes. All 30 raw files match their declared byte counts and
SHA-256 digests. Every CPU profile has equal sample/delta counts, valid graph and sample identities,
safe-integer values, and reconstructed timestamps within its profile range. The seven quarantined
profiles contain 13 negative deltas from -1 through -57 microseconds and no second structural defect.

Replaying those exact 1.4 GiB of raw evidence through stack-v3 accepted 15/15 windows and then
reproduced the summary by re-reading 30/30 authenticated files. The resulting audit bound the set as
`sha256:3d532cfe624b7c08162c502ac61e212baecbfa20d1861eabbb1dc4caa85e0243` and the summary as
`sha256:c3e1513e2e9860674dfeace2d80fb50e8c20e4495549f1104f1e1d7d3f8f012c`, with
`negativeCpuTimeDeltas: 13`. The original hosted report remains unproven; this replay authenticates
the repair but does not substitute for a clean hosted N=24/N=216 rerun.

## Run

Generate the authenticated N=24 and N=216 corpora using `benchmarks/corpora/generate.mjs`, then run
one Kovo corpus at a time from a clean committed worktree. Profile directories must be outside both
the corpus and source worktree so raw artifacts cannot dirty or alter either identity.

```sh
node benchmarks/corpora/dev-loop.mjs \
  --manifest /absolute/corpus/kovo/n24/manifest.json \
  --iterations 3 \
  --ready-iterations 1 \
  --warmups 3 \
  --port 49120 \
  --inspector-port 50120 \
  --profile-dir /tmp/kovo-dev-profile-n24 \
  --out /tmp/kovo-dev-profile-n24.json
```

The dev port is the base of the adapter's exact per-session range: this example uses 49120 for its
fresh-ready session and 49121 for its edit session. Keep the Inspector port outside that entire
range. The adapter samples only the three measured edits per class; the three warmups remain
unprofiled. Raw `.cpuprofile` and `.heapprofile` files are mode `0600` and each is bound into the
report by name, byte count, and SHA-256. Re-read and reproduce the report from those retained bytes
before publication:

```sh
node scripts/perf-dev-edit-profile-audit.mjs \
  --report /tmp/kovo-dev-profile-n24.json \
  --profile-dir /tmp/kovo-dev-profile-n24 \
  --out /tmp/kovo-dev-profile-n24-audit.json
```

Hosted CI additionally passes `--require-provider github-actions`, binding the report to its GitHub
run identity and exact runner-image cohort. The audit rejects a missing/surplus profile, a byte-count
or SHA-256 mismatch, a non-regular file, a stale classifier, or a ranking that cannot be reproduced
from the raw Inspector payloads.

Do not compare the profiled durations with the unprofiled Kovo/Next baseline or use them to accept a
spike. Use the diagnostic ranking to select or retire hypotheses, then measure any implementation in
the ordinary serialized `Kovo, Next, Next, Kovo` or `baseline, spike, spike, baseline` lane.
