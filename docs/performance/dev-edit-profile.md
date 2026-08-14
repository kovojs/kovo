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
generation, and asynchronous proof convergence. Allocation is collected from the same window with
Inspector's sampling heap profiler. Every category receives an explicit ruling: present in the
current top five, observed outside it, or retired because it was absent. Work that matches no reviewed
classifier stays in the raw profiles and the census as unattributed; it is never assigned by guess.

## Run

Generate the authenticated N=24 and N=216 corpora using `benchmarks/corpora/generate.mjs`, then run
one Kovo corpus at a time from a clean committed worktree. Profile directories must be outside both
the corpus and source worktree so raw artifacts cannot dirty or alter either identity.

```sh
node benchmarks/corpora/dev-loop.mjs \
  --manifest /absolute/corpus/kovo/n24/manifest.json \
  --iterations 30 \
  --ready-iterations 15 \
  --warmups 3 \
  --port 49120 \
  --inspector-port 49121 \
  --profile-dir /tmp/kovo-dev-profile-n24 \
  --out /tmp/kovo-dev-profile-n24.json
```

Use distinct dev and Inspector ports. The adapter samples only the 30 measured edits per class; the
three warmups remain unprofiled. Raw `.cpuprofile` and `.heapprofile` files are mode `0600` and each
is bound into the report by name, byte count, and SHA-256.

Do not compare the profiled durations with the unprofiled Kovo/Next baseline or use them to accept a
spike. Use the diagnostic ranking to select or retire hypotheses, then measure any implementation in
the ordinary serialized `Kovo, Next, Next, Kovo` or `baseline, spike, spike, baseline` lane.
