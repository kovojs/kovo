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
generation, and asynchronous proof convergence. The stack-v2 classifier attributes a leaf sample
only from functions observed in its complete Inspector ancestry; a generic TypeScript scanner below
Kovo's asynchronous project-analysis frame therefore remains proof-convergence work, while the same
scanner under another stack does not. Allocation uses the same ancestry rule. Categories are ranked
by their larger observed CPU/allocation share, never by comparing microseconds with bytes. Every
category receives an explicit ruling: present in the current top five, observed outside it, or
retired because it was absent. Work that matches no reviewed classifier stays in the raw profiles and
the census as unattributed; it is never assigned by guess.

The hosted diagnostic census is three measured windows per edit class after three warmups (15 raw
CPU/heap pairs per corpus). A clean N=24 calibration at `8afdec2c9` retained 379 MiB for only one
window per class, which projects to about 11.4 GiB at 30 iterations before the repository,
dependencies, browser, or upload staging. A standard `ubuntu-24.04` GitHub-hosted runner has 14 GB of
SSD ([runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)),
so a 30-window profile census is not fail-closed evidence. The separate unprofiled comparison keeps
30 measured edits per class and owns every latency claim; the bounded profile census owns only the
current ranking and hypothesis retirements.

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
  --inspector-port 49121 \
  --profile-dir /tmp/kovo-dev-profile-n24 \
  --out /tmp/kovo-dev-profile-n24.json
```

Use distinct dev and Inspector ports. The adapter samples only the three measured edits per class;
the three warmups remain unprofiled. Raw `.cpuprofile` and `.heapprofile` files are mode `0600` and
each is bound into the report by name, byte count, and SHA-256. Re-read and reproduce the report from
those retained bytes before publication:

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
